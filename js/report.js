// Renders a lookup result in the project's parcel-report-template structure (HTML + Markdown).
import { LINKS } from './lookup.js';
import { DISTRICTS, normalizeDistrict, overlaySuffixes, MCZO_URL } from './standards.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dash = (v) => (v == null || v === '' ? '—' : v);
const mdLink = (t, u) => `[${t}](${u})`;
const ftDir = (l) => l ? `≈ ${l.distance.toLocaleString()} ft ${l.dir} (${l.type} line, ${l.orient})${l.fallback ? ' — no plain "Section" feature in range; nearest higher-order PLSS line (likely coincident with the section grid)' : ''}` : null;

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
      ['Recorded setbacks', esc(plat.setbacks)], ['Height limit', esc(plat.height)],
      ['Controlling cases', esc(dash(plat.controllingCases))], ['Notes', esc(plat.notes)], ['Last updated', esc(plat.lastUpdated)],
    ]);
    const platYear = +String(plat.recorded).slice(0, 4);
    const newer = [...R.currentCases, ...R.historicCases].filter(c => /Rezoning|Zoning Case|Development Master|Comprehensive|Overlay/.test(c.type) && c.date && new Date(c.date).getFullYear() >= platYear);
    out.push(newer.length
      ? `<div class="warn">⚠ ${newer.length} DMP / rezoning / CPA / overlay case(s) dated on or after the plat (${platYear}): ${newer.map(c => esc(`${c.permit} (${c.date}, ${c.status || 'status ?'})`)).join(', ')}. Verify whether an approved newer case supersedes the plat's standards.</div>`
      : `<p class="ok">No DMP / rezoning / CPA case postdates the ${platYear} plat in GIS.</p>`);
  } else {
    out.push(`<div class="note">Platted (<b>${esc(p.SubdivisionName)}</b>, MCR ${esc(dash(p.MCRNumber))}) but not yet in the subdivision database. Open the plat via the ${p.MCRNumber ? a('Recorder book/page search', LINKS.recBook(...p.MCRNumber.split('-'))) : 'Recorder'} (row coded PLAT MAP), then <button class="link" data-act="add-sub">add it to the database</button>.</div>`);
  }

  h('5. Overlay Districts');
  table(R.overlays.map(o => [esc(o.name), o.hit ? '<b class="bad">Yes</b>' : 'No', esc(o.notes || '—')]), ['Overlay', 'Intersects?', 'Notes']);
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
  L.push('### 3. Setbacks & Development Standards (per base district)', '');
  for (const z of zones) { const k = normalizeDistrict(z); if (!k) continue; L.push(`**[${k} (MCZO Ch. 5 §${DISTRICTS[k].section})](${MCZO_URL}):**`, ''); t(standardsRows(k), ['Standard', 'Requirement']); }
  L.push(`Rear/side required yard coverage maximum per [§806](${MCZO_URL}).`, '');
  L.push('### 4. Subdivision Plat (MCR) — setback check', '');
  if (!p.SubdivisionName) L.push('Not platted — N/A.', '');
  else if (plat) t([['Subdivision name', plat.name], ['Book / Map', plat.mcr], ['Plat recording # / date', mdLink(`${plat.docType} #${plat.rec}, recorded ${plat.recorded}`, plat.platUrl)], ['Setback line (BSL) shown on plat? (Y/N)', /N\/A|None/i.test(plat.setbacks) ? 'N' : 'Y'], ['If yes — dimension(s) and location', plat.setbacks], ['Notes', plat.notes]]);
  else L.push(`${p.SubdivisionName} (MCR ${p.MCRNumber || '—'}) — not yet in the subdivision database; plat not checked.`, '');
  L.push('### 5. Overlay Districts', ''); t(R.overlays.map(o => [o.name, o.hit ? 'Yes' : 'No', o.notes || '—']), ['Overlay', 'Intersects parcel?', 'Notes']);
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
  L.push(`- Base district: ${zones.join(', ') || '—'}`, `- Plat setback (if platted): ${plat ? plat.setbacks : (p.SubdivisionName ? 'not checked' : 'N/A')}`,
    `- Overlays: ${R.overlays.filter(o => o.hit).map(o => o.name).join(', ') || 'none'}`,
    `- Pending cases: ${R.currentCases.map(c => c.permit).join(', ') || 'None'}`, `- Historical cases: ${R.historicCases.length}`,
    `- Flags needing verification: ${[zones.length > 1 && 'split zoning', zones.some(z => overlaySuffixes(z).length) && 'overlay stipulations', R.errors.length && 'some sources failed'].filter(Boolean).join('; ') || 'none'}`);
  return L.join('\n');
}
