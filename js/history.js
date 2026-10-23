// Historical Aerials viewer (Parcel Lookup → "Historical Aerials"): the parcel over Maricopa County aerial imagery by year.
// Years are discovered from the County's imagery servers each time (the same imagery the County's Historical Aerials app
// uses — https://gis.maricopa.gov/GIO/HistoricalAerial/index.html). Only imagery after 1995 is offered, and footprint /
// flight-date layers are never shown: the viewer draws each year's cached imagery tiles, not its feature layers.
const SOURCES = [
  { base: 'https://gis.maricopa.gov/Imagery/rest/services', who: 'County GIO' },
  { base: 'https://gis.mcassessor.maricopa.gov/arcgis/rest/services', who: 'County Assessor' },
];
// Used if the service directories can't be listed from this browser.
const KNOWN = [
  { name: 'Imagery/Aerials2026', base: SOURCES[1].base, who: 'County Assessor' },
  { name: 'Aerials2022', base: SOURCES[1].base, who: 'County Assessor' },
  { name: 'Aerials2021', base: SOURCES[1].base, who: 'County Assessor' },
  { name: 'Aerials2019', base: SOURCES[1].base, who: 'County Assessor' },
];
export const HIST_APP = 'https://gis.maricopa.gov/GIO/HistoricalAerial/index.html';
const MIN_YEAR = 1996; // "after 1995"
const SKIP = /foot\s*print|footprint|flight|date|index|boundar|label|grid|tile.?index/i;
const yearOf = (name) => { const m = String(name).match(/(19[3-9]\d|20[0-9]\d)/g); return m ? +m[m.length - 1] : null; };
const getJSON = (u) => fetch(u, { cache: 'force-cache' }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });

let yearsP = null;
export function discoverYears() {
  if (yearsP) return yearsP;
  yearsP = (async () => {
    const found = [];
    await Promise.all(SOURCES.map(async (src) => {
      try {
        const root = await getJSON(`${src.base}?f=json`);
        const lists = [root, ...(await Promise.all((root.folders || []).filter(f => !SKIP.test(f)).slice(0, 12).map(f => getJSON(`${src.base}/${f}?f=json`).catch(() => ({ services: [] })))))];
        for (const l of lists) for (const s of l.services || []) {
          if (!/^(MapServer|ImageServer)$/.test(s.type) || SKIP.test(s.name)) continue;
          const y = yearOf(s.name.split('/').pop()); if (!y || y < MIN_YEAR) continue;
          found.push({ year: y, name: s.name, type: s.type, base: src.base, who: src.who });
        }
      } catch { /* directory not reachable from this browser */ }
    }));
    const list = found.length ? found : KNOWN.map(k => ({ ...k, type: 'MapServer', year: yearOf(k.name) }));
    // one entry per year: prefer the County GIO's historical imagery, then the Assessor's
    const byYear = new Map();
    for (const x of list.sort((a, b) => (a.who === 'County GIO' ? -1 : 1) - (b.who === 'County GIO' ? -1 : 1))) if (!byYear.has(x.year)) byYear.set(x.year, x);
    return [...byYear.values()].sort((a, b) => b.year - a.year).map(x => ({ ...x, url: `${x.base}/${x.name}/${x.type}`, fallback: !found.length }));
  })();
  yearsP.catch(() => { yearsP = null; });
  return yearsP;
}

// A Leaflet layer for one year's imagery. Cached map services: their own tile levels mapped to Web Mercator zooms
// (read from tileInfo). Image services, or map services without a cache: exportImage/export per 256-px tile.
const WM = 20037508.342789244, SCALE0 = 591657527.591555;
export async function yearLayer(L, svc) {
  const info = await getJSON(`${svc.url}?f=json`);
  const lods = (info.tileInfo && info.tileInfo.lods) || []; const wkid = info.tileInfo && info.tileInfo.spatialReference && (info.tileInfo.spatialReference.latestWkid || info.tileInfo.spatialReference.wkid);
  const zLevel = {};
  if (info.singleFusedMapCache && lods.length && (wkid === 3857 || wkid === 102100)) for (const l of lods) { const z = Math.round(Math.log2(SCALE0 / l.scale)); if (Math.abs(SCALE0 / 2 ** z - l.scale) / l.scale < 0.02) zLevel[z] = l.level; }
  const zs = Object.keys(zLevel).map(Number);
  if (zs.length) {
    const T = L.TileLayer.extend({ getTileUrl(c) { const lv = zLevel[c.z]; return lv == null ? L.Util.emptyImageUrl : `${svc.url}/tile/${lv}/${c.y}/${c.x}`; } });
    return new T('', { minZoom: 0, maxZoom: 21, minNativeZoom: Math.min(...zs), maxNativeZoom: Math.max(...zs), attribution: `${svc.year} imagery © Maricopa County (${svc.who})`, className: 'hist-tiles' });
  }
  if (svc.type === 'MapServer' && !(info.capabilities || '').includes('Map')) throw new Error('This year has no viewable imagery.');
  const E = L.TileLayer.extend({ getTileUrl(c) {
    const size = (2 * WM) / 2 ** c.z; const x0 = -WM + c.x * size, y1 = WM - c.y * size; const bbox = [x0, y1 - size, x0 + size, y1].join(',');
    return svc.type === 'ImageServer' ? `${svc.url}/exportImage?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=256,256&format=jpgpng&f=image`
      : `${svc.url}/export?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&transparent=false&f=image`;
  } });
  return new E('', { maxZoom: 21, attribution: `${svc.year} imagery © Maricopa County (${svc.who})`, className: 'hist-tiles' });
}

// The viewer dialog.
const H = { dlg: null, map: null, layer: null, outline: null, years: [], i: 0 };
export async function openHistory(L, R) {
  const d = H.dlg || (H.dlg = Object.assign(document.createElement('dialog'), { id: 'hist', className: 'hist' }));
  if (!d.isConnected) {
    d.innerHTML = `<div class="hist-head"><b>Historical Aerials</b> <span class="sub hist-apn"></span>
      <span class="hist-tools"><button class="btn sm" data-h="prev" type="button" aria-label="Older">◀</button><select class="hist-year" aria-label="Year"></select><button class="btn sm" data-h="next" type="button" aria-label="Newer">▶</button>
      <label class="rowc"><input type="checkbox" data-h="outline" checked> Parcel outline</label>
      <a class="btn sm ghost" href="${HIST_APP}" target="_blank" rel="noopener">County app ↗</a><button class="btn sm ghost" data-h="close" type="button" aria-label="Close">✕</button></span></div>
      <div class="hist-map"></div><p class="sub hist-msg"></p>`;
    document.body.appendChild(d);
    d.addEventListener('click', (e) => { const b = e.target.closest('[data-h]'); if (!b) return; if (b.dataset.h === 'close') d.close(); if (b.dataset.h === 'prev') show(H.i + 1); if (b.dataset.h === 'next') show(H.i - 1); });
    d.addEventListener('change', (e) => { if (e.target.classList.contains('hist-year')) show(+e.target.value); if (e.target.dataset.h === 'outline' && H.outline) { if (e.target.checked) H.outline.addTo(H.map); else H.outline.remove(); } });
  }
  d.querySelector('.hist-apn').textContent = `· Parcel ${R.apn}`;
  const msg = d.querySelector('.hist-msg'); msg.textContent = 'Finding the available years…';
  if (!d.open) d.showModal();
  if (!H.map) { H.map = L.map(d.querySelector('.hist-map'), { zoomControl: true }); }
  const ll = R.wgsRings.map(r => r.map(([x, y]) => [y, x]));
  if (H.outline) H.outline.remove();
  H.outline = L.polygon(ll, { color: '#ffd43b', weight: 3, fill: false }).addTo(H.map);
  setTimeout(() => { H.map.invalidateSize(); H.map.fitBounds(H.outline.getBounds(), { padding: [60, 60], maxZoom: 19 }); }, 30);
  try { H.years = await discoverYears(); } catch { H.years = []; }
  const sel = d.querySelector('.hist-year');
  sel.innerHTML = H.years.map((y, i) => `<option value="${i}">${y.year}${y.who === 'County Assessor' ? ' (Assessor)' : ''}</option>`).join('');
  if (!H.years.length) { msg.innerHTML = `No imagery services could be reached from this browser. Open the <a href="${HIST_APP}" target="_blank" rel="noopener">County's Historical Aerials app</a>.`; return; }
  await show(0);
}
async function show(i) {
  if (i < 0 || i >= H.years.length) return; H.i = i;
  const d = H.dlg; const y = H.years[i]; d.querySelector('.hist-year').value = String(i);
  d.querySelector('[data-h=prev]').disabled = i >= H.years.length - 1; d.querySelector('[data-h=next]').disabled = i <= 0;
  const msg = d.querySelector('.hist-msg'); msg.textContent = `Loading ${y.year}…`;
  try {
    const lyr = await yearLayer(window.L, y);
    if (H.layer) H.layer.remove(); H.layer = lyr.addTo(H.map); // the outline sits in the overlay pane, above the imagery
    msg.textContent = `${y.year} imagery from the ${y.who}${y.fallback ? ' (built-in list — the service directory could not be read)' : ''}. Years after 1995 only; footprint layers are not shown. The service year is usually the year after the flight (e.g. 2021 imagery was flown late 2020).`;
  } catch (e) { msg.textContent = `Couldn't load ${y.year}: ${e.message}. Try another year or the County app.`; }
}
