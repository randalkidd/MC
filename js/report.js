// Renders a lookup result in the project's parcel-report-template structure (HTML + Markdown).
import { LINKS } from './lookup.js?v=4b715c96';
import { DISTRICTS, normalizeDistrict, overlaySuffixes, MCZO_URL } from './standards.js?v=4b715c96';

// Only allow http(s) URLs into href attributes; everything else becomes "#".
const safeUrl = (u) => { try { const x = new URL(String(u), location.href); return /^https?:$/.test(x.protocol) ? x.href : '#'; } catch { return '#'; } };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dash = (v) => (v == null || v === '' ? '—' : v);
const mdLink = (t, u) => `[${t}](${u})`;
const ftDir = (l) => l ? `≈ ${l.distance.toLocaleString()} ft ${l.dir} (${l.type} line, ${l.orient})${l.fallback ? ' — no plain "Section" feature in range; nearest higher-order PLSS line (likely coincident with the section grid)' : ''}` : null;

// ---------- recorded-plat setbacks ----------
const num = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);
function inRange(lot, spec) {
  const n = parseInt(String(lot || '').replace(/\D+/g, ''), 10); if (!n) return false;
  if (/^all$/i.test(String(spec).trim())) return true;
  return String(spec).split(/[,;]/).some(part => { const m = part.match(/(\d+)\s*[-–]\s*(\d+)/); if (m) return n >= +m[1] && n <= +m[2]; const k = part.match(/\d+/); return k ? +k[0] === n : false; });
}
// Structured table if the DB row has one; otherwise parse "20 ft / 15 ft / 5 ft / 10 ft" style text.
export function platSetbacks(plat, lot) {
  if (!plat) return { rows: [], match: null };
  let rows = Array.isArray(plat.setbackTable) ? plat.setbackTable.filter(r => ['front', 'rear', 'side', 'street'].some(k => num(r[k]) != null)) : [];
  if (!rows.length && plat.setbacks && !/N\/A|none/i.test(plat.setbacks)) {
    const segs = String(plat.setbacks).split(/\.\s+(?=Lots)/);
    for (const seg of segs) {
      const m = seg.match(/(\d+)\s*ft\s*\/\s*(\d+)\s*ft\s*\/\s*(\d+)\s*ft\s*\/\s*(\d+)\s*ft/i);
      if (!m) continue;
      const lots = (seg.match(/Lots?\s+([\d–\-, ]+)/i) || [])[1] || 'All';
      const dist = (seg.match(/\(([A-Z0-9-]+)\)/) || [])[1] || '';
      rows.push({ lots: lots.trim(), district: dist, front: +m[1], rear: +m[2], side: +m[3], street: +m[4], height: plat.height && !/N\/A/.test(plat.height) ? plat.height : '' });
    }
  }
  const match = rows.length === 1 ? rows[0] : rows.find(r => inRange(lot, r.lots)) || null;
  return { rows, match };
}
const PLAT_FIELDS = [['Front setback', 'front', ' ft'], ['Rear setback', 'rear', ' ft'], ['Side-interior setback', 'side', ' ft'], ['Side-street setback', 'street', ' ft'], ['Height maximum', 'height', ''], ['Lot coverage maximum', 'coverage', ''], ['Lot width minimum', 'width', ' ft'], ['Other recorded restrictions', 'other', '']];
export function platRows(rows) {
  const val = (r, k, u) => {
    if (k === 'coverage' && r.coverageNow) return `${r.coverage || '—'} on plat → ${r.coverageNow} now${r.coverageBy ? ` (changed by ${r.coverageBy})` : ''}`;
    return r[k] == null || r[k] === '' ? '—' : `${r[k]}${typeof r[k] === 'number' ? u : ''}`;
  };
  return PLAT_FIELDS.filter(([, k]) => rows.some(r => r[k] != null && r[k] !== '')).map(([lab, k, u]) => [lab, ...rows.map(r => val(r, k, u))]);
}
const platHead = (rows) => ['Standard', ...rows.map(r => rows.length > 1 ? `Lots ${r.lots}${r.district ? ` (${r.district})` : ''}` : `Recorded plat${r.district ? ` (${r.district})` : ''}`)];
// Plat values looser than base zoning are only valid through an approved RUPD/UPD/case — list them for verification.
function looserThanZoning(row, zoneKey) {
  const d = DISTRICTS[zoneKey]; if (!d || !row) return [];
  const pairs = [['front', 'front setback', d.front], ['rear', 'rear setback', d.rear], ['side', 'side-interior setback', d.side], ['street', 'side-street setback', d.street], ['width', 'lot width', d.width]];
  return pairs.filter(([k, , z]) => num(row[k]) != null && z != null && num(row[k]) < z).map(([k, lab, z]) => `${lab} ${row[k]} ft vs ${z} ft`);
}
function newerCases(R, plat) {
  const y = +String(plat.recorded || '').slice(0, 4);
  if (!y) return { y: '?', list: [] };
  return { y, list: [...R.currentCases, ...R.historicCases].filter(c => /Rezoning|Zoning Case|Development Master|Comprehensive|Overlay/.test(c.type) && c.date && new Date(c.date).getFullYear() >= y) };
}

// Mapped easements from the lookup, plus easements recorded on this parcel's subdivision plat (from the subdivision DB).
export function easementList(R, plat) {
  const list = [...(R.easements || [])];
  if (plat && plat.easements && String(plat.easements).trim()) list.push({ kind: 'Subdivision plat easement', detail: `${plat.easements} (recorded on the plat for this subdivision — confirm which affect this lot)`, source: `${plat.docType} #${plat.rec}`, platUrl: plat.platUrl });
  return list;
}

// District layers grouped for the report (ZIP code layer 55 intentionally omitted).
const DISTRICT_GROUPS = [
  { key: 'sup', label: 'Supervisor district', ids: [41] },
  { key: 'school', label: 'School districts', ids: [42, 43, 44, 45], collapse: true },
  { key: 'aoi', label: 'Area of interest', ids: [46], collapse: true },
  { key: 'water', label: 'Irrigation & ADWR', ids: [47, 49, 48, 50], collapse: true },
  { key: 'fire', label: 'Fire district', ids: [52] },
  { key: 'pm10', label: 'PM10 non-attainment', ids: [54] },
];
const shortLayer = (n) => String(n || '').replace(/^District\s*[→>-]\s*/i, '').replace(/ School District$/i, '').replace(/^ADWR /, 'ADWR ');
export function groupDistricts(list) {
  return DISTRICT_GROUPS.map(g => {
    const items = (list || []).filter(x => g.ids.includes(x.layerId))
      .sort((a, b) => g.ids.indexOf(a.layerId) - g.ids.indexOf(b.layerId))
      .map(x => ({ layer: shortLayer(x.layer), value: String(x.value ?? '').trim() || '—' }))
      .filter((x, i, arr) => arr.findIndex(y => y.layer === x.layer && y.value === x.value) === i);
    return { ...g, items };
  }).filter(g => g.items.length);
}

// Case/permit numbers that point at Recorder documents:
//  • 11 digits (a recording number) → that document's detail page
//  • starts with a year, "CPA" or "MCP" → Recorder document search (number is copied for pasting)
export const REC_SEARCH = 'https://recorder.maricopa.gov/recording/document-search.html#tab-doc-search';
export function permitLink(permit) {
  const n = String(permit || '').trim();
  if (/^\d{11}$/.test(n)) return { url: LINKS.recDoc(n), direct: true };
  if (/^(\d{4}|CPA|MCP)/i.test(n)) return { url: REC_SEARCH, direct: false };
  return null;
}
const permitHTML = (permit) => {
  const n = String(permit || '').trim(); const L = permitLink(n);
  if (!L) return esc(n || '—');
  return L.direct
    ? `<a href="${esc(safeUrl(L.url))}" target="_blank" rel="noopener noreferrer" title="Open recorded document ${esc(n)}">${esc(n)}</a>`
    : `<a href="${esc(safeUrl(L.url))}" target="_blank" rel="noopener noreferrer" class="rec-copy" data-num="${esc(n)}" title="Opens Recorder document search — ${esc(n)} is copied; paste it into Recorded Document Number">${esc(n)}</a>`;
};

export function findPlat(R, db) {
  const n = (R.parcel.SubdivisionName || '').trim().toUpperCase();
  if (!n || !db) return null;
  return db.subdivisions.find(s => s.name.toUpperCase() === n) || null;
}

export function standardsRows(key) {
  const d = DISTRICTS[key]; if (!d) return [];
  const v = (x, unit = ' ft') => (x == null ? 'None required' : `${typeof x === 'number' ? x.toLocaleString() : x}${typeof x === 'number' ? unit : ''}`);
  const rows = [
    ['Lot area minimum', d.area ? `${d.area.toLocaleString()} sq ft` : '—'],
    ...(d.perDU ? [['Lot area per dwelling unit', `${d.perDU.toLocaleString()} sq ft`]] : []),
    ['Lot width minimum', v(d.width)],
    ['Lot coverage maximum', `${d.cov}%`],
    ['Front setback' + (d.acc ? ' (primary)' : ''), v(d.front) + (d.frontGarage ? ` (≥ ${d.frontGarage} ft to front-facing garage plane)` : '')],
    ['Side-street setback' + (d.acc ? ' (primary)' : ''), v(d.street)],
    ['Side-interior setback' + (d.acc ? ' (primary)' : ''), d.side == null && d.sideAdjRes ? `None required / ${d.sideAdjRes} ft adjacent to Rural or Residential` : v(d.side)],
    ['Rear setback' + (d.acc ? ' (primary)' : ''), d.rear == null && d.rearAdjRes ? `None required / ${d.rearAdjRes} ft adjacent to Rural or Residential` : v(d.rear) + (d.rear != null && d.rearAdjRes ? ` / ${d.rearAdjRes} ft adjacent to Rural or Residential` : '')],
    ['Height maximum' + (d.acc ? ' (primary)' : ''), v(d.height)],
  ];
  if (d.acc) rows.push(
    ['Front setback (accessory)', v(d.acc.front)], ['Side-street setback (accessory)', v(d.acc.street)],
    ['Side-interior setback (accessory)', '3 ft (detached ADU 5 ft)'], ['Rear setback (accessory)', '3 ft (detached ADU 5 ft)'],
    ['Height maximum (accessory)', 'Same as primary (detached ADU 18 ft within rear/side setbacks)'],
    ['Rear/side required yard coverage maximum', '30% (§806)'],
  );
  (d.notes || []).forEach(n => rows.push(['Note', n]));
  return rows;
}

export function renderReportHTML(R, db) {
  const p = R.parcel; const out = [`<h2 class="rep-title">Parcel ${esc(p.APNDash || R.apn)}</h2>`];
  const plat = findPlat(R, db);
  let secN = 0; const h = (t) => out.push(`<h3>${++secN}. ${t}</h3>`);
  const table = (rows, head = ['Field', 'Value']) => out.push(`<div class="tw"><table><thead><tr>${head.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map(r => r.raw ? r.raw : `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
  const a = (t, u) => `<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>`;

  if (R.errors.length) out.push(`<div class="warn"><b>Some sources didn't respond:</b><ul>${R.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>Those sections show "—"; retry, or enable the relay in Settings.</div>`);
  out.push(`<p class="meta">Lookup ${R.lookupDate} · direct ArcGIS REST queries against the exact parcel polygon (Assessor Parcel + PND/PlanNet), per the project workflow standards.</p>`);

  const zonesAll = (R.zoning || []).map(z => z.zone);
  const zoningRowsHTML = () => [
    ['Base zoning district(s)', `<b>${esc(zonesAll.join(', ') || '—')}</b> · ${a("What's My Zoning?", LINKS.zoningApp)}`],
    ['Split zoning?', zonesAll.length > 1 ? '<b class="bad">Y — Needs Verification</b> (intersect only confirms overlap; MCZO §405 50%/25 ft rule)' : 'N'],
    ['Jurisdiction (zoning layer)', esc([...new Set((R.zoning || []).map(z => z.juris).filter(Boolean))].join(', ') || '—')],
  ];
  h('Property &amp; Owner');
  const owner = [p.OwnerAddressLine1, p.OwnerAddressLine2, [p.OwnerCity, p.OwnerState, p.OwnerZipCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const juris = R.outsideCounty ? `Incorporated — ${esc(R.city || 'city not identified')}` : 'Unincorporated Maricopa County';
  const valuation = esc(p.FullCashValue ? `FCV $${Number(p.FullCashValue).toLocaleString()} · LPV $${Number(p.LimitedPropertyValue || 0).toLocaleString()} (${p.ParcelValuationYear || ''})` : '—');
  const schools = esc(dash([p.ElementarySchoolDistrict, p.HighSchoolDistrict].filter(Boolean).join(' / ')));
  const mainRows = [
    ['APN', `${esc(p.APNDash)} · ${a('Assessor', LINKS.assessorParcel(p.APNDash))} · ${a('Parcel Viewer', LINKS.assessor)}`],
    ['Owner name', esc(dash(p.OwnerName))], ['Owner mailing address', esc(dash(owner))],
    ['Site address', esc(dash([p.PropertyFullStreetAddress, p.PropertyCity, p.PropertyZipCode].filter(Boolean).join(', ')))],
    ...(R.outsideCounty ? [['Jurisdiction', `<b class="bad">${juris}</b>`], ['Zoning', 'N/A — city zoning applies, not the MCZO']] : zoningRowsHTML()),
    ['Legal description', esc(dash(p.PropertyDescription))],
    ['Subdivision / Lot / Block / Tract', esc([p.SubdivisionName, p.Lot && `Lot ${p.Lot}`, p.Block && `Block ${p.Block}`, p.Tract && `Tract ${p.Tract}`].filter(Boolean).join(' · ') || '—')],
    ['MCR (plat book/page)', p.MCRNumber ? `${esc(p.MCRNumber)} · ${a('Recorder book/page search', LINKS.recBook(...p.MCRNumber.split('-')))}` : '—'],
    ['Deed (# / date)', p.DeedNumber ? a(`#${p.DeedNumber}, recorded ${p.DeedDate || '—'}`, LINKS.recDoc(p.DeedNumber)) : '—'],
    ['Township / Range / Section / Quarter', esc([p.Township, p.Range, p.Section, p.QuarterSection].map(dash).join(' / '))],
    [`Nearest section line${(R.sectionLines || []).length > 1 ? 's' : ''}`, (R.sectionLines && R.sectionLines.length ? R.sectionLines.map(l => esc(ftDir(l))).join('<br>') : esc(dash(ftDir(R.sectionLine))))],
    ...(R.midsectionLine ? [['Nearest midsection line', esc(ftDir(R.midsectionLine))]] : []),
    ['Lot size (GIS polygon)', `${p.areaSqFt.toLocaleString()} sq ft (${p.areaAcres} ac)`],
    ['Property use / legal class', esc(dash([p.LandLegalClassDescription, p.ImprovementLegalClassDescription].filter(Boolean).join(' / ')))],
  ];
  // Hidden until "Additional Info" is clicked. Jurisdiction stays visible above when the parcel is inside a city.
  const extraRows = [...(R.outsideCounty ? [] : [['Jurisdiction', juris]]), ['Valuation', valuation], ['School districts', schools]];
  out.push(`<div class="tw"><table class="s1"><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>
    ${mainRows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}
    <tr class="addl-toggle"><td colspan="2"><button type="button" class="link addl-btn" aria-expanded="false" data-act="addl">▸ Additional Info</button></td></tr>
    ${extraRows.map(r => `<tr class="addl" hidden><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}
  </tbody></table></div>`);

  if (R.outsideCounty) {
    out.push(`<div class="note">Zoning, setbacks, overlays and cases: <b>N/A — outside Maricopa County jurisdiction (${esc(R.city || 'incorporated city')})</b>. The city's own ordinance governs; MCZO does not apply.</div>`);
    return out.join('');
  }

  const zones = zonesAll;

  h('Setbacks &amp; Development Standards');
  const ps = platSetbacks(plat, p.Lot);
  const nc = plat ? newerCases(R, plat) : { list: [] };
  if (ps.rows.length) {
    const shown = ps.match ? [ps.match] : ps.rows;
    out.push(`<p><b>${a(`Recorded plat — ${plat.name} (${plat.docType} #${plat.rec}, ${plat.recorded})`, plat.platUrl)}</b> <span class="pill">controlling standard</span></p>`);
    if (ps.match && ps.rows.length > 1) out.push(`<p class="sub">Lot ${esc(p.Lot)} falls in lot range ${esc(ps.match.lots)}. Other ranges on this plat: ${ps.rows.filter(r => r !== ps.match).map(r => esc(`Lots ${r.lots}${r.district ? ` (${r.district})` : ''}`)).join('; ')}.</p>`);
    else if (!ps.match && ps.rows.length > 1) out.push(`<p class="sub">Lot number ${p.Lot ? esc(p.Lot) + ' not matched to a range' : 'unknown'} — confirm which lot range applies.</p>`);
    table(platRows(shown).map(r => r.map(esc)), platHead(shown));
    const zk = normalizeDistrict(zones[0]); const loose = shown.flatMap(r => looserThanZoning(r, normalizeDistrict(r.district) || zk));
    if (loose.length) out.push(`<div class="note">Plat is less restrictive than base ${esc(zk || 'zoning')} for: ${esc([...new Set(loose)].join('; '))}. That is valid only through an approved RUPD/UPD or zoning case — confirm the controlling case${plat.controllingCases ? ` (${esc(plat.controllingCases)})` : ''}.</div>`);
    if (nc.list.length) out.push(`<div class="warn">⚠ ${nc.list.length} DMP / rezoning / CPA / overlay case(s) dated on or after the ${nc.y} plat: ${nc.list.map(c => esc(`${c.permit} (${c.date}, ${c.status || 'status ?'})`)).join(', ')}. Verify these plat figures are still current before relying on them.</div>`);
    out.push('<h4>Standard Zoning (MCZO) — Baseline</h4>');
  }
  for (const z of zones) {
    const key = normalizeDistrict(z); const ov = overlaySuffixes(z);
    if (!key) { out.push(`<p>${esc(z)}: no table match — check ${a('MCZO', MCZO_URL)} manually.</p>`); continue; }
    out.push(`<p><b>${a(`${key} (MCZO Ch. 5 §${DISTRICTS[key].section})`, MCZO_URL)}</b>${ov.length ? ` <span class="pill warn-pill">${ov.join(', ')} overlay — case stipulations may modify these</span>` : ''}</p>`);
    table(standardsRows(key), ['Standard', 'Requirement']);
  }

  if (p.SubdivisionName) h('Subdivision Plat (MCR)');
  if (!p.SubdivisionName) { /* not platted — section hidden */ }
  else if (plat) {
    const editBtn = ` <button type="button" class="btn sm gated" data-act="edit-plat" data-name="${esc(plat.name)}">✎ Edit in SubdivisionDB</button>`;
    table([
      ['Subdivision', esc(plat.name)], ['MCR', esc(plat.mcr)],
      ['Plat', plat.rec ? a(`${plat.docType} #${plat.rec}, recorded ${plat.recorded}`, plat.platUrl) : `${a(`Find plat at the Recorder (MCR ${plat.mcr || '?'})`, plat.platUrl)} — recording number not entered yet`],
      ['Recorded setbacks', ps.rows.length ? (plat.platOcr ? '<b class="chg">⚠ Read automatically (OCR) from the plat — verify</b> before relying on them; shown as the controlling table in the Setbacks section' + editBtn : 'Yes — shown as the controlling table in the Setbacks section') : (/not yet reviewed/i.test(plat.setbacks || '') ? '<b class="chg">⚠ Plat not yet reviewed</b> — MCZO standards shown; check the plat for a building setback line and update the database' + editBtn : 'None on plat — MCZO standards govern')],
      ['Controlling cases', esc(dash(plat.controllingCases))], ['Notes', esc(plat.notes)], ['Last updated', esc(plat.lastUpdated)],
    ]);
    if (!ps.rows.length) out.push(nc.list.length
      ? `<div class="warn">⚠ ${nc.list.length} DMP / rezoning / CPA / overlay case(s) dated on or after the plat (${nc.y}): ${nc.list.map(c => esc(`${c.permit} (${c.date}, ${c.status || 'status ?'})`)).join(', ')}. Verify whether an approved newer case changes the standards.</div>`
      : (nc.y === '?' ? '<p class="sub">Plat recording date not entered — the newer-case check runs once it is.</p>' : `<p class="ok">No DMP / rezoning / CPA case postdates the ${nc.y} plat in GIS.</p>`));
  } else {
    out.push(`<div class="note">Platted (<b>${esc(p.SubdivisionName)}</b>, MCR ${esc(dash(p.MCRNumber))}) but not yet in the subdivision database. <span class="gated">It has been added to the <b>Plat Automation Waitlist</b> in SubdivisionDB — use <b>Process with Claude</b> there to read the plat and fill it in, or </span>Open the plat via the ${p.MCRNumber ? a('Recorder book/page search', LINKS.recBook(...p.MCRNumber.split('-'))) : 'Recorder'} (row coded PLAT MAP)<span class="gated"> and <button class="link" data-act="add-sub">add it by hand</button></span>.</div>`);
  }

  h('Overlay Districts');
  const ovHit = R.overlays.filter(o => o.hit), ovMiss = R.overlays.filter(o => !o.hit);
  if (ovHit.length) table(ovHit.map(o => [esc(o.name), esc(o.notes || '—')]), ['Intersecting overlay', 'Notes']);
  else out.push('<p class="ok">No overlay districts intersect this parcel.</p>');
  if (ovMiss.length) out.push(`<details class="miss"><summary>${ovMiss.length} other overlay${ovMiss.length > 1 ? 's' : ''} checked — no intersection</summary><p class="sub">${ovMiss.map(o => esc(o.name)).join(' · ')}</p></details>`);

  h('Easements');
  const ez = easementList(R, plat);
  if (ez.length) {
    table(ez.map(e => [`<b>${esc(e.kind)}</b>`, `${esc(e.detail)}${e.rec ? ` · ${a(`Rec. #${e.rec}`, e.url || LINKS.recDoc(e.rec))}` : ''}${e.platUrl ? ` · ${a('plat', e.platUrl)}` : ''}`, esc(e.source)]), ['Intersecting easement', 'Details', 'Source']);
    if (ez.some(e => e.patent)) out.push(`<div class="warn">Patent easement: structures inside it can be removed without compensation, and yard setbacks are measured from the easement line, not the property line (<a href="https://www.maricopa.gov/6446/Patent-Easements-DD-2015-09" target="_blank" rel="noopener">DD-2015-09</a>).${ez.some(e => e.pab && e.abandoned && !e.related) ? ' <b>An abandonment is recorded for this parcel</b> (listed above) — open the resolution to confirm which easement strips it released before applying the setback.' : ''}</div>`);
  } else out.push('<p><b>None found, verify</b></p>');
  out.push(pabLine(R, true));
  const rc = R.recorder || {};
  if (rc.error) out.push(`<p class="sub">⚠ County Recorder not checked (${esc(rc.error)}).</p>`);
  else {
    const d = rc.deed;
    if (d) out.push(`<p class="sub">Deed ${a(`#${d.rec}`, LINKS.recDoc(d.rec))} (${esc(d.codes.join(', ') || 'type n/a')}${d.date ? `, ${esc(d.date)}` : ''}${d.pages ? `, ${d.pages} pp.` : ''}) checked: ${d.hasEasement ? 'recorded with an easement — listed above.' : 'no easement recorded with it.'} Easements written into the deed's text ("subject to…", reservations) aren't read automatically — open the deed to check its exceptions.</p>`);
    if (rc.owner) out.push(`<p class="sub">Recorder searched for easements recorded by <b>${esc(rc.owner.label)}</b> since the deed${rc.easements && rc.easements.length ? ` — ${rc.easements.length} found (listed above; name match, confirm each covers this parcel)` : ' — none found'}.</p>`);
  }
  out.push('<p class="sub">Also checked: patent easements, MCDOT\'s Patent Easement Abandonment Tracker, Flood Control District easements, MCDOT right-of-way, and easements recorded on plats in the subdivision database. Public utility, shared-well, ingress/egress and other private easements are not mapped — check the deed, the title report and the recorded plat.</p>');

  h('Zoning / Planning Cases');
  const caseTable = (list) => list.length ? table(list.map(c => [esc(c.type), permitHTML(c.permit), esc(dash(c.name)), esc(dash(c.status)), esc(dash(c.date)), esc(dash(c.request))]), ['Type', 'Permit #', 'Name', 'Status', 'Date', 'Request']) : out.push('<p>None found.</p>');
  out.push('<h4>Current / Pending</h4>'); caseTable(R.currentCases);
  out.push('<h4>Historical (before June 2024)</h4>'); caseTable(R.historicCases);

  h('Additional Data');
  const rows = [];
  if (R.flood.hit) {
    const z = [...R.flood.effective.filter(x => String(x.FloodZoneCode).toUpperCase() !== 'X').map(x => `${x.FloodZoneCode}${x.FIRMPanelNumber ? ` (FIRM ${x.FIRMPanelNumber})` : ''}`), ...R.flood.preliminary.map(x => `Preliminary: ${x.FloodZoneCode}`)];
    rows.push(['Floodplain', `<b class="bad">Hit</b>${R.flood.floodway ? ' — <b>FLOODWAY</b>' : ''}: ${esc(z.join('; ') || '—')}${R.flood.certs.length ? `; elevation certificate(s): ${esc(R.flood.certs.map(c => c.ElevCertNumber).join(', '))}` : ''} · ${a('Floodplain Viewer', LINKS.flood)}`]);
  }
  const dl = (list) => esc(list.map(x => `${x.layer}: ${x.value}`).join(' · ') || '—');
  const lines = (list) => (list && list.length ? [...new Set(list.map(x => { const l = shortLayer(x.layer).replace(/^(Military|Planning|Development|Natural Resource)\s*[→>-]\s*/i, ''); const v = String(x.value ?? '').trim(); return !v || v.toLowerCase() === l.toLowerCase() ? l : `${l}: ${v}`; }))].map(esc).join('<br>') : '—');
  rows.push(['Planning layers', lines(R.planning)], ['Development layers', lines(R.development)]);
  const dRows = [];
  for (const g of groupDistricts(R.district)) {
    const one = g.items.length === 1;
    const label = g.ids.length > 1 ? (it) => `${esc(it.layer)}: ${esc(it.value)}` : (it) => esc(it.value);
    if (one || !g.collapse) dRows.push(`<tr><td>${g.label}</td><td>${g.items.map(label).join('<br>')}</td></tr>`);
    else dRows.push(`<tr><td>${g.label}</td><td><button type="button" class="link multi-btn" data-act="multi" data-grp="${g.key}" aria-expanded="false">▸ MULTIPLE (${g.items.length})</button></td></tr>`
      + g.items.map(it => `<tr class="multi-row" data-grp="${g.key}" hidden><td class="sub">↳ ${esc(it.layer)}</td><td>${esc(it.value)}</td></tr>`).join(''));
  }
  rows.push({ raw: dRows.length ? `<tr class="grp-head"><td colspan="2">Districts</td></tr>${dRows.join('')}` : '<tr><td>Districts</td><td>—</td></tr>' });
  // Noise contours (Luke 74, Luke Aux1 77, Gila Bend 79): keep only the highest contour for each airfield.
  const NOISE = [74, 77, 79]; const dB = (x) => { const m = String(x.value ?? '').match(/\d+(\.\d+)?/g); return m ? Math.max(...m.map(Number)) : -1; };
  const military = (R.military || []).filter(x => !NOISE.includes(x.layerId) || !(R.military || []).some(y => y.layerId === x.layerId && dB(y) > dB(x)))
    .filter((x, i, arr) => !NOISE.includes(x.layerId) || arr.findIndex(y => y.layerId === x.layerId) === i);
  rows.push(['Natural resource', dl(R.natural)], ['Military', lines(military)]);
  rows.push(['Septic', `<span id="septic-cell">Not yet checked — <button class="link" data-act="septic">check EDMS</button> (needs relay) · ${a('Septic Search', LINKS.septic)} · ${a('Permit Center (6/15/2024+)', LINKS.permitCenter)}</span>`]);
  rows.push(['Roads (RIT)', `<span id="roads-cell"><button class="link" data-act="roads">Look up frontage roads</button></span>`]);
  rows.push(['TSP2040 corridor projects', `<span id="tsp-cell"><button class="link" data-act="tsp">Check</button></span>`]);
  table(rows);
  return out.join('');
}

export function renderReportMD(R, db, extras = {}) {
  const p = R.parcel; const L = [];
  const plat = findPlat(R, db);
  const t = (rows, head = ['Field', 'Value']) => { L.push(`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`); rows.forEach(r => L.push(`| ${r.map(c => String(c ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`)); L.push(''); };
  L.push(`## Parcel ${p.APNDash}`, '', `**Lookup date:** ${R.lookupDate}`, `**Method:** Direct ArcGIS REST query against the exact parcel polygon (Assessor Parcel service + PND/PlanNet MapServer), via the Unofficial Maricopa County Zoning Hub.`, '');
  let mdN = 0; const H = (title) => L.push(`### ${++mdN}. ${title}`, '');
  H('Property & Owner');
  t([
    ['APN', p.APNDash], ['Owner name', dash(p.OwnerName)],
    ['Owner mailing address', dash([p.OwnerAddressLine1, p.OwnerAddressLine2, [p.OwnerCity, p.OwnerState, p.OwnerZipCode].filter(Boolean).join(' ')].filter(Boolean).join(', '))],
    ['Site address', dash([p.PropertyFullStreetAddress, p.PropertyCity, p.PropertyZipCode].filter(Boolean).join(', '))],
    ['Jurisdiction', R.outsideCounty ? `Incorporated — ${R.city || '?'}` : 'Unincorporated Maricopa County'],
    ...(R.outsideCounty ? [['Zoning', 'N/A — city zoning applies']] : [['Base zoning district(s)', (R.zoning || []).map(z => z.zone).join(', ') || '—'], ['Split zoning? (Y/N)', (R.zoning || []).length > 1 ? 'Y — Needs Verification' : 'N'], ['Jurisdiction (per zoning layer)', [...new Set((R.zoning || []).map(z => z.juris).filter(Boolean))].join(', ') || '—']]),
    ['Legal description', dash(p.PropertyDescription)],
    ['Subdivision / Lot / Block / Tract', [p.SubdivisionName, p.Lot, p.Block, p.Tract].map(dash).join(' / ')],
    ['Book / Map (plat)', dash(p.MCRNumber)],
    ['Deed (# / date)', p.DeedNumber ? mdLink(`#${p.DeedNumber}, recorded ${p.DeedDate}`, LINKS.recDoc(p.DeedNumber)) : '—'],
    ['Township / Range / Section / Quarter Section', [p.Township, p.Range, p.Section, p.QuarterSection].map(dash).join(' / ')],
    ['Nearest section lines (direction & distance)', R.sectionLines && R.sectionLines.length ? R.sectionLines.map(ftDir).join('; ') : dash(ftDir(R.sectionLine))],
    ...(R.midsectionLine ? [['Nearest midsection line (direction & distance)', ftDir(R.midsectionLine)]] : []),
    ['Lot size (sq ft / acres)', `${p.areaSqFt.toLocaleString()} / ${p.areaAcres}`],
    ['Property use description', dash([p.LandLegalClassDescription, p.ImprovementLegalClassDescription].filter(Boolean).join(' / '))],
  ]);
  if (R.outsideCounty) { L.push(`Sections 2–6: N/A — outside Maricopa County jurisdiction (${R.city || 'incorporated city'}).`, ''); return L.join('\n'); }
  const zones = R.zoning.map(z => z.zone);
  const ps = platSetbacks(plat, p.Lot);
  H('Setbacks & Development Standards');
  if (ps.rows.length) {
    const shown = ps.match ? [ps.match] : ps.rows;
    L.push(`**${mdLink(`Recorded plat — ${plat.name} (${plat.docType} #${plat.rec}, recorded ${plat.recorded})`, plat.platUrl)}** — controlling standard${ps.match && ps.rows.length > 1 ? ` (lot ${p.Lot}: lots ${ps.match.lots})` : ''}:`, '');
    t(platRows(shown), platHead(shown));
    const loose = shown.flatMap(r => looserThanZoning(r, normalizeDistrict(r.district) || normalizeDistrict(zones[0])));
    if (loose.length) L.push(`Note: plat is less restrictive than base zoning for ${[...new Set(loose)].join('; ')} — valid only through an approved RUPD/UPD or zoning case; confirm.`, '');
    const nc = newerCases(R, plat);
    if (nc.list.length) L.push(`⚠️ Case(s) dated on/after the ${nc.y} plat: ${nc.list.map(c => `${c.permit} (${c.date})`).join(', ')} — verify the plat figures are still current.`, '');
    L.push('**Standard zoning (MCZO) — baseline:**', '');
  }
  for (const z of zones) { const k = normalizeDistrict(z); if (!k) continue; L.push(`**[${k} (MCZO Ch. 5 §${DISTRICTS[k].section})](${MCZO_URL}):**`, ''); t(standardsRows(k), ['Standard', 'Requirement']); }
  L.push(`Rear/side required yard coverage maximum per [§806](${MCZO_URL}).`, '');
  if (p.SubdivisionName) H('Subdivision Plat (MCR) — setback check');
  if (!p.SubdivisionName) { /* not platted — section omitted */ }
  else if (plat) t([['Subdivision name', plat.name], ['Book / Map', plat.mcr], ['Plat recording # / date', plat.rec ? mdLink(`${plat.docType} #${plat.rec}, recorded ${plat.recorded}`, plat.platUrl) : `Not entered yet — ${mdLink('find plat', plat.platUrl)}`], ['Setback line (BSL) shown on plat? (Y/N)', ps.rows.length ? (plat.platOcr ? 'Y (read by OCR — verify) — see Setbacks section (controlling table)' : 'Y — see Setbacks section (controlling table)') : (/not yet reviewed/i.test(plat.setbacks || '') ? 'Not yet reviewed — check the plat' : 'N — MCZO governs')], ['Notes', plat.notes]]);
  else L.push(`${p.SubdivisionName} (MCR ${p.MCRNumber || '—'}) — not yet in the subdivision database; plat not checked.`, '');
  H('Overlay Districts');
  { const hit = R.overlays.filter(o => o.hit); hit.length ? t(hit.map(o => [o.name, o.notes || '—']), ['Intersecting overlay', 'Notes']) : L.push('No overlay districts intersect this parcel.', ''); L.push(`_${R.overlays.length - hit.length} other overlays checked — no intersection._`, ''); }
  H('Easements');
  { const ez = easementList(R, plat); ez.length ? t(ez.map(e => [e.kind, `${e.detail}${e.rec ? ` · ${mdLink(`Rec. #${e.rec}`, e.url || LINKS.recDoc(e.rec))}` : ''}`, e.source]), ['Intersecting easement', 'Details', 'Source']) : L.push('None found, verify', '');
    const d = R.recorder && R.recorder.deed; if (d) L.push(`Deed ${mdLink(`#${d.rec}`, LINKS.recDoc(d.rec))} (${d.codes.join(', ')}) checked: ${d.hasEasement ? 'recorded with an easement.' : 'no easement recorded with it;'} deed text exceptions not read automatically — review the deed.`, ''); 
    L.push(pabLine(R, false), ''); }
  H('Zoning / Planning Cases'); L.push('**Current / pending:**', '');
  const pmd = (n) => { const k = permitLink(n); return k ? mdLink(n, k.url) : dash(n); };
  R.currentCases.length ? t(R.currentCases.map(c => [c.type, pmd(c.permit), c.name, c.status, c.date]), ['Case type', 'Permit #', 'Name', 'Status', 'Date']) : L.push('None found.', '');
  L.push('**Historical (before June 2024):**', '');
  R.historicCases.length ? t(R.historicCases.map(c => [c.type, pmd(c.permit), c.name, c.status, c.date]), ['Case type', 'Permit #', 'Name', 'Status', 'Date']) : L.push('None found.', '');
  H('Additional Data');
  const add = [];
  if (R.flood.hit) add.push(['Floodplain', `Hit${R.flood.floodway ? ' (FLOODWAY)' : ''}: ${R.flood.effective.map(x => x.FloodZoneCode).join(', ')} — ${mdLink('Floodplain and Elevation Certificate Viewer', LINKS.flood)}`]);
  add.push(['Septic', extras.septic || `Not checked — ${mdLink('Septic Search', LINKS.septic)}`]);
  if (extras.roads) add.push(['Roads (RIT)', extras.roads]);
  if (extras.tsp) add.push(['TSP2040', extras.tsp]);
  for (const g of groupDistricts(R.district)) add.push([g.label, g.items.map(it => (g.ids.length > 1 ? `${it.layer}: ${it.value}` : it.value)).join('; ')]);
  t(add);
  L.push('---', '', '## Compliance-ready summary', '');
  L.push(`- Base district: ${zones.join(', ') || '—'}`, `- Plat setback (if platted): ${ps.match ? `F ${ps.match.front} / R ${ps.match.rear} / S ${ps.match.side} / SS ${ps.match.street} ft (lots ${ps.match.lots})` : plat ? plat.setbacks : (p.SubdivisionName ? 'not checked' : 'N/A')}`,
    `- Overlays: ${R.overlays.filter(o => o.hit).map(o => o.name).join(', ') || 'none'}`,
    `- Pending cases: ${R.currentCases.map(c => c.permit).join(', ') || 'None'}`, `- Historical cases: ${R.historicCases.length}`,
    `- Flags needing verification: ${[zones.length > 1 && 'split zoning', zones.some(z => overlaySuffixes(z).length) && 'overlay stipulations', R.errors.length && 'some sources failed'].filter(Boolean).join('; ') || 'none'}`);
  return L.join('\n');
}

// One line in the Easements section saying whether the parcel is in MCDOT's Patent Easement Abandonment Tracker.
function pabLine(R, html) {
  const p = R.pab || {}; const url = p.url || 'https://www.maricopa.gov/DocumentCenter/View/111506/Patent-Easement-Abandonment-Tracking-PDF';
  const lk = (t) => (html ? `<a href="${url}" target="_blank" rel="noopener">${t}</a>` : mdLink(t, url));
  const b = (t) => (html ? `<b>${esc(t)}</b>` : `**${t}**`);
  if (!R.pab) return '';
  if (p.error) return html ? `<p class="sub">⚠ ${lk('Patent Easement Abandonment Tracker')} not checked (${esc(p.error)}).</p>` : `${lk('Patent Easement Abandonment Tracker')} not checked (${p.error}).`;
  const hits = p.hits || [], rel = p.related || [];
  const msg = hits.length ? b(`Parcel listed — ${hits.map(h => `PAB-${h.pab}`).join(', ')}`) + ' (details above)' : b('Parcel not listed') + ' — no patent-easement abandonment has been applied for on this APN';
  const relMsg = rel.length ? `; another split of the same parent is listed (${rel.map(h => `PAB-${h.pab} ${h.apn}`).join('; ')})` : '';
  const txt = `${lk('MCDOT Patent Easement Abandonment Tracker')} (snapshot ${html ? esc(p.fetched) : p.fetched}, ${p.count} cases): ${msg}${html ? esc(relMsg) : relMsg}.`;
  return html ? `<p class="sub">${txt}</p>` : txt;
}
