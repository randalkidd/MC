// Every recorded subdivision in Maricopa County (Parcel MapServer layer 0 "Subdivision", ~32,000 records),
// fetched in pages of 2,000 and cached in IndexedDB for a day.
import { arcgis } from './net.js?v=4cc821ae';
import { EP } from './lookup.js?v=4cc821ae';

const PAGE = 2000, CACHE_KEY = 'all-subdivisions-v1', TTL = 24 * 3600 * 1000;

function idb(mode, fn) {
  return new Promise((res, rej) => {
    let open; try { open = indexedDB.open('mc-cache', 1); } catch (e) { return rej(e); }
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => rej(open.error);
    open.onsuccess = () => { const tx = open.result.transaction('kv', mode); const r = fn(tx.objectStore('kv')); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); };
  });
}
const cacheGet = () => idb('readonly', (st) => st.get(CACHE_KEY)).catch(() => null);
const cachePut = (v) => idb('readwrite', (st) => st.put(v, CACHE_KEY)).catch(() => null);

export async function loadAllSubdivisions({ force = false, onProgress = () => {} } = {}) {
  if (!force) { const c = await cacheGet(); if (c && Date.now() - c.t < TTL && Array.isArray(c.rows) && c.rows.length) return { rows: c.rows, t: c.t, cached: true }; }
  const url = `${EP.subdivision}/query`;
  const { count } = await arcgis(url, { where: '1=1', returnCountOnly: 'true' });
  const pages = Math.ceil((count || 0) / PAGE); const out = new Array(pages); let done = 0;
  const fetchPage = async (i) => {
    const d = await arcgis(url, { where: '1=1', outFields: 'OBJECTID,SubdivisionName,SubdivisionLevel,MCRNumber,MCRWebLink', returnGeometry: 'false', orderByFields: 'OBJECTID', resultOffset: String(i * PAGE), resultRecordCount: String(PAGE) });
    out[i] = (d.features || []).map(f => f.attributes); onProgress(++done, pages);
  };
  const queue = [...Array(pages).keys()];
  await Promise.all([0, 1, 2, 3].map(async () => { while (queue.length) await fetchPage(queue.shift()); }));
  // one row per subdivision name + MCR (some plats have several polygons)
  const seen = new Map();
  for (const a of out.flat()) {
    const name = String(a.SubdivisionName || '').trim(); if (!name) continue;
    const mcr = String(a.MCRNumber || '').trim(); const k = `${name.toUpperCase()}|${mcr}`;
    const cur = seen.get(k);
    if (cur) { cur.n++; if (!cur.link && a.MCRWebLink) cur.link = a.MCRWebLink; }
    else seen.set(k, { name, mcr, link: a.MCRWebLink || '', n: 1 });
  }
  const rows = [...seen.values()].sort((x, y) => x.name.localeCompare(y.name));
  const t = Date.now(); await cachePut({ t, rows, count });
  return { rows, t, cached: false };
}
