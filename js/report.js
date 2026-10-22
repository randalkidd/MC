// Renders a lookup result in the project's parcel-report-template structure (HTML + Markdown).
import { LINKS } from './lookup.js';
import { DISTRICTS, normalizeDistrict, overlaySuffixes, MCZO_URL } from './standards.js';

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
  const val = (r, k, u) => (r[k] == null || r[k] === '' ? '—' : `${r[k]}${typeof r[k] === 'number' ? u : ''}`);
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
  const y = +String(plat.recorded).slice(0, 4);
  return { y, list: [...R.currentCases, ...R.historicCases].filter(c => /Rezoning|Zoning Case|Development Master|Comprehensive|Overlay/.test(c.type) && c.date && new Date(c.date).getFullYear() >= y) };
}

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
  const p = R.parcel; const out = [];
  const plat = findPlat(R, db);
  const h = (t) => out.push(`<h3>${t}</h3>`);
  const table = (rows, head = ['Field', 'Value']) => out.push(`<div class="tw"><table><thead><tr>${head.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
  const a = (t, u) => `<a href="${u}" target="_blank" rel="noopener">${esc(t)}</a>`;

  if (R.errors.length) out.push(`<div class="warn"><b>Some sources didn't respond:</b><ul>${R.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>Those sections show "—"; retry, or enable the relay in Settings.</div>`);
  out.push(`<p class="meta">Lookup ${R.lookupDate} · direct ArcGIS REST queries against the exact parcel polygon (Assessor Parcel + PND/PlanNet), per the project workflow standards.</p>`);

  h('1. Property &amp; Owner');
  const owner = [p.OwnerAddressLine1, p.OwnerAddressLine2, [p.OwnerCity, p.OwnerState, p.OwnerZipCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const juris = R.outsideCounty ? `Incorporated — ${esc(R.city || 'city not identified')}` : 'Unincorporated Maricopa County';
  table([
    ['APN', `${esc(p.APNDash)} · ${a('Assessor', LINKS.assessorParcel(p.APNDash))} · ${a('Parcel Viewer', LINKS.assessor)}`],
    ['Owner name', esc(dash(p.OwnerName))], ['Owner mailing address', esc(dash(owner))],
    ['Site address', esc(dash([p.PropertyFullStreetAddress, p.PropertyCity, p.PropertyZipCode].filter(Boolean).join(', ')))],
    ['Jurisdiction', juris], ['Legal description', esc(dash(p.PropertyDescription))],
    ['Subdivision / Lot / Block / Tract', esc([p.SubdivisionName, p.Lot && `Lot ${p.Lot}`, p.Block && `Block ${p.Block}`, p.Tract && `Tract ${p.Tract}`].filter(Boolean).join(' · ') || '—')],
    ['MCR (plat book/page)', p.MCRNumber ? `${esc(p.MCRNumber)} · ${a('Recorder book/page search', LINKS.recBook(...p.MCRNumber.split('-')))}` : '—'],
    ['Deed (# / date)', p.DeedNumber ? a(`#${p.DeedNumber}, recorded ${p.DeedDate || '—'}`, LINKS.recDoc(p.DeedNumber)) : '—'],
    ['Township / Range / Section / Quarter', esc([p.Township, p.Range, p.Section, p.QuarterSection].map(dash).join(' / '))],
    ['Nearest section line', esc(dash(ftDir(R.sectionLine)))],
    ['Nearest midsection line', esc(R.midsectionLine ? ftDir(R.midsectionLine) : 'Not available in county PLSS data for this section')],
    ['Lot size (GIS polygon)', `${p.areaSqFt.toLocaleString()} sq ft (${p.areaAcres} ac)`],
    ['Property use / legal class', esc(dash([p.LandLegalClassDescription, p.ImprovementLegalClassDescription].filter(Boolean).join(' / ')))],
    ['Valuation', esc(p.FullCashValue ? `FCV $${Number(p.FullCashValue).toLocaleString()} · LPV $${Number(p.LimitedPropertyValue || 0).toLocaleString()} (${p.ParcelValuationYear || ''})` : '—')],
    ['School districts', esc(dash([p.ElementarySchoolDistrict, p.HighSchoolDistrict].filter(Boolean).join(' / ')))],
  ]);

  if (R.outsideCounty) {
    out.push(`<div class="note">Zoning, setbacks, overlays and cases: <b>N/A — outside Maricopa County jurisdiction (${esc(R.city || 'incorporated city')})</b>. The city's own ordinance governs; MCZO does not apply.</div>`);
    return out.join('');
  }

  h('2. Zoning');
  const zones = R.zoning.map(z => z.zone);
  table([
    ['Base zoning district(s)', `${esc(zones.join(', ') || '—')} · ${a("What's My Zoning?", LINKS.zoningApp)}`],
    ['Split zoning?', zones.length > 1 ? '<b class="bad">Y — Needs Verification</b> (intersect only confirms overlap; MCZO §405 50%/25 ft rule)' : 'N'],
    ['Jurisdiction (zoning layer)', esc([...new Set(R.zoning.map(z => z.juris).filter(Boolean))].join(', ') || '—')],
  ]);

  h('3. Setbacks &amp; Development Standards');
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
    out.push('<h4>Standard zoning (MCZO) — baseline</h4>');
  }
  for (const z of zones) {
    const key = normalizeDistrict(z); const ov = overlaySuffixes(z);
    if (!key) { out.push(`<p>${esc(z)}: no table match — check ${a('MCZO', MCZO_URL)} manually.</p>`); continue; }
    out.push(`<p><b>${a(`${key} (MCZO Ch. 5 §${DISTRICTS[key].section})`, MCZO_URL)}</b>${ov.length ? ` <span class="pill warn-pill">${ov.join(', ')} overlay — case stipulations may modify these</span>` : ''}</p>`);
    table(standardsRows(key), ['Standard', 'Requirement']);
  }

  h('4. Subdivision Plat (MCR)');
  if (!p.SubdivisionName) out.push('<p>Not platted (no SubdivisionName) — N/A.</p>');
  else if (plat) {
    table([
      ['Subdivision', esc(plat.name)], ['MCR', esc(plat.mcr)],
      ['Plat', a(`${plat.docType} #${plat.rec}, recorded ${plat.recorded}`, plat.platUrl)],
      ['Recorded setbacks', ps.rows.length ? 'Yes — shown as the controlling table in Section 3' : 'None on plat — MCZO standards in Section 3 govern'],
      ['Controlling cases', esc(dash(plat.controllingCases))], ['Notes', esc(plat.notes)], ['Last updated', esc(plat.lastUpdated)],
    ]);
    if (!ps.rows.length) out.push(nc.list.length
      ? `<div class="warn">⚠ ${nc.list.length} DMP / rezoning / CPA / overlay case(s) dated on or after the plat (${nc.y}): ${nc.list.map(c => esc(`${c.permit} (${c.date}, ${c.status || 'status ?'})`)).join(', ')}. Verify whether an approved newer case changes the standards.</div>`
      : `<p class="ok">No DMP / rezoning / CPA case postdates the ${nc.y} plat in GIS.</p>`);
  } else {
    out.push(`<div class="note">Platted (<b>${esc(p.SubdivisionName)}</b>, MCR ${esc(dash(p.MCRNumber))}) but not yet in the subdivision database. Open the plat via the ${p.MCRNumber ? a('Recorder book/page search', LINKS.recBook(...p.MCRNumber.split('-'))) : 'Recorder'} (row coded PLAT MAP), then <button class="link" data-act="add-sub">add it to the database</button>.</div>`);
  }

  h('5. Overlay Districts');
  const ovHit = R.overlays.filter(o => o.hit), ovMiss = R.overlays.filter(o => !o.hit);
  if (ovHit.length) table(ovHit.map(o => [esc(o.name), esc(o.notes || '—')]), ['Intersecting overlay', 'Notes']);
  else out.push('<p class="ok">No overlay districts intersect this parcel.</p>');
  if (ovMiss.length) out.push(`<details class="miss"><summary>${ovMiss.length} other overlay${ovMiss.length > 1 ? 's' : ''} checked — no intersection</summary><p class="sub">${ovMiss.map(o => esc(o.name)).join(' · ')}</p></details>`);
  if (R.overlays.find(o => o.id === 24 && o.hit)) out.push(`<div class="warn">Patent easement: yard setbacks are measured from the easement line (DD-2015-09).</div>`);

  h('6. Zoning / Planning Cases');
  const caseTable = (list) => list.length ? table(list.map(c => [esc(c.type), esc(dash(c.permit)), esc(dash(c.name)), esc(dash(c.status)), esc(dash(c.date)), esc(dash(c.request))]), ['Type', 'Permit #', 'Name', 'Status', 'Date', 'Request']) : out.push('<p>None found.</p>');
  out.push('<h4>Current / pending</h4>'); caseTable(R.currentCases);
  out.push('<h4>Historical (before June 2024)</h4>'); caseTable(R.historicCases);

  h('7. Additional Data');
  const rows = [];
  if (R.flood.hit) {
    const z = [...R.flood.effective.filter(x => String(x.FloodZoneCode).toUpperCase() !== 'X').map(x => `${x.FloodZoneCode}${x.FIRMPanelNumber ? ` (FIRM ${x.FIRMPanelNumber})` : ''}`), ...R.flood.preliminary.map(x => `Preliminary: ${x.FloodZoneCode}`)];
    rows.push(['Floodplain', `<b class="bad">Hit</b>${R.flood.floodway ? ' — <b>FLOODWAY</b>' : ''}: ${esc(z.join('; ') || '—')}${R.flood.certs.length ? `; elevation certificate(s): ${esc(R.flood.certs.map(c => c.ElevCertNumber).join(', '))}` : ''} · ${a('Floodplain Viewer', LINKS.flood)}`]);
  }
  const dl = (list) => esc(list.map(x => `${x.layer}: ${x.value}`).join(' · ') || '—');
  rows.push(['Planning layers', dl(R.planning)], ['Development layers', dl(R.development)], ['Districts', dl(R.district)], ['Natural resource', dl(R.natural)], ['Military', dl(R.military)]);
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
  L.push(`## Parcel ${p.APNDash}`, '', `**Lookup date:** ${R.lookupDate}`, `**Method:** Direct ArcGIS REST query against the exact parcel polygon (Assessor Parcel service + PND/PlanNet MapServer), via the MC Zoning Review site.`, '');
  L.push('### 1. Property & Owner', '');
  t([
    ['APN', p.APNDash], ['Owner name', dash(p.OwnerName)],
    ['Owner mailing address', dash([p.OwnerAddressLine1, p.OwnerAddressLine2, [p.OwnerCity, p.OwnerState, p.OwnerZipCode].filter(Boolean).join(' ')].filter(Boolean).join(', '))],
    ['Site address', dash([p.PropertyFullStreetAddress, p.PropertyCity, p.PropertyZipCode].filter(Boolean).join(', '))],
    ['Jurisdiction', R.outsideCounty ? `Incorporated — ${R.city || '?'}` : 'Unincorporated Maricopa County'],
    ['Legal description', dash(p.PropertyDescription)],
    ['Subdivision / Lot / Block / Tract', [p.SubdivisionName, p.Lot, p.Block, p.Tract].map(dash).join(' / ')],
    ['Book / Map (plat)', dash(p.MCRNumber)],
    ['Deed (# / date)', p.DeedNumber ? mdLink(`#${p.DeedNumber}, recorded ${p.DeedDate}`, LINKS.recDoc(p.DeedNumber)) : '—'],
    ['Township / Range / Section / Quarter Section', [p.Township, p.Range, p.Section, p.QuarterSection].map(dash).join(' / ')],
    ['Nearest section line (direction & distance)', dash(ftDir(R.sectionLine))],
    ['Nearest midsection line (direction & distance)', R.midsectionLine ? ftDir(R.midsectionLine) : 'Not available in county PLSS data for this section'],
    ['Lot size (sq ft / acres)', `${p.areaSqFt.toLocaleString()} / ${p.areaAcres}`],
    ['Property use description', dash([p.LandLegalClassDescription, p.ImprovementLegalClassDescription].filter(Boolean).join(' / '))],
  ]);
  if (R.outsideCounty) { L.push(`Sections 2–6: N/A — outside Maricopa County jurisdiction (${R.city || 'incorporated city'}).`, ''); return L.join('\n'); }
  const zones = R.zoning.map(z => z.zone);
  L.push('### 2. Zoning', ''); t([['Base zoning district(s)', zones.join(', ') || '—'], ['Split zoning? (Y/N)', zones.length > 1 ? 'Y — Needs Verification' : 'N'], ['Jurisdiction (per zoning layer)', [...new Set(R.zoning.map(z => z.juris).filter(Boolean))].join(', ') || '—']]);
  const ps = platSetbacks(plat, p.Lot);
  L.push('### 3. Setbacks & Development Standards', '');
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
  L.push('### 4. Subdivision Plat (MCR) — setback check', '');
  if (!p.SubdivisionName) L.push('Not platted — N/A.', '');
  else if (plat) t([['Subdivision name', plat.name], ['Book / Map', plat.mcr], ['Plat recording # / date', mdLink(`${plat.docType} #${plat.rec}, recorded ${plat.recorded}`, plat.platUrl)], ['Setback line (BSL) shown on plat? (Y/N)', ps.rows.length ? 'Y — see Section 3 (controlling table)' : 'N — MCZO governs (Section 3)'], ['Notes', plat.notes]]);
  else L.push(`${p.SubdivisionName} (MCR ${p.MCRNumber || '—'}) — not yet in the subdivision database; plat not checked.`, '');
  L.push('### 5. Overlay Districts', '');
  { const hit = R.overlays.filter(o => o.hit); hit.length ? t(hit.map(o => [o.name, o.notes || '—']), ['Intersecting overlay', 'Notes']) : L.push('No overlay districts intersect this parcel.', ''); L.push(`_${R.overlays.length - hit.length} other overlays checked — no intersection._`, ''); }
  L.push('### 6. Zoning / Planning Cases', '', '**Current / pending:**', '');
  R.currentCases.length ? t(R.currentCases.map(c => [c.type, c.permit, c.name, c.status, c.date]), ['Case type', 'Permit #', 'Name', 'Status', 'Date']) : L.push('None found.', '');
  L.push('**Historical (before June 2024):**', '');
  R.historicCases.length ? t(R.historicCases.map(c => [c.type, c.permit, c.name, c.status, c.date]), ['Case type', 'Permit #', 'Name', 'Status', 'Date']) : L.push('None found.', '');
  L.push('### 7. Additional Data', '');
  const add = [];
  if (R.flood.hit) add.push(['Floodplain', `Hit${R.flood.floodway ? ' (FLOODWAY)' : ''}: ${R.flood.effective.map(x => x.FloodZoneCode).join(', ')} — ${mdLink('Floodplain and Elevation Certificate Viewer', LINKS.flood)}`]);
  add.push(['Septic', extras.septic || `Not checked — ${mdLink('Septic Search', LINKS.septic)}`]);
  if (extras.roads) add.push(['Roads (RIT)', extras.roads]);
  if (extras.tsp) add.push(['TSP2040', extras.tsp]);
  add.push(['Districts', R.district.map(x => `${x.layer}: ${x.value}`).join('; ') || '—']);
  t(add);
  L.push('---', '', '## Compliance-ready summary', '');
  L.push(`- Base district: ${zones.join(', ') || '—'}`, `- Plat setback (if platted): ${ps.match ? `F ${ps.match.front} / R ${ps.match.rear} / S ${ps.match.side} / SS ${ps.match.street} ft (lots ${ps.match.lots})` : plat ? plat.setbacks : (p.SubdivisionName ? 'not checked' : 'N/A')}`,
    `- Overlays: ${R.overlays.filter(o => o.hit).map(o => o.name).join(', ') || 'none'}`,
    `- Pending cases: ${R.currentCases.map(c => c.permit).join(', ') || 'None'}`, `- Historical cases: ${R.historicCases.length}`,
    `- Flags needing verification: ${[zones.length > 1 && 'split zoning', zones.some(z => overlaySuffixes(z).length) && 'overlay stipulations', R.errors.length && 'some sources failed'].filter(Boolean).join('; ') || 'none'}`);
  return L.join('\n');
}
