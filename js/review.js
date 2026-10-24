// Plan review: measurement checks (setbacks, coverage, height) + checklist → markup table (Markdown).
import { DISTRICTS, normalizeDistrict, MCZO_URL } from './standards.js?v=cccb7524';
import { CHECKLISTS } from './checklists.js?v=cccb7524';
import { signFindings, blankSign, blankSignCtx } from './signs.js?v=cccb7524';

const DD2021 = 'https://www.maricopa.gov/6459/Lot-Coverage-Calculations---DD-2021-01';
const DD3012 = 'https://www.maricopa.gov/6353/Accessory-Structures-Equipment-and-Setba';
const KEY = 'mc.review.draft';

// The reviewer's name/email carry over to new reviews (seeded from the comment-letter template).
export function rememberedReviewer() {
  try { const v = JSON.parse(localStorage.getItem('mc.reviewer') || 'null'); if (v && v.name) return v; } catch {}
  return { name: 'Randal Kidd', email: 'randal.kidd@maricopa.gov' };
}
export function rememberReviewer(name, email) { try { localStorage.setItem('mc.reviewer', JSON.stringify({ name, email })); } catch {} }
export function blankReview() {
  return {
    type: 'residential', apn: '', district: '', adjRes: false, lotArea: '', lotW: '', lotD: '', planTitle: '', permit: '', reviewer: rememberedReviewer().name, reviewerEmail: rememberedReviewer().email, date: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10),
    platSetbacks: { front: '', rear: '', side: '', street: '' },
    primary: { front: '', rear: '', sideA: '', sideB: '', street: '', height: '', garage: '' },
    structures: [
      { name: 'Residence (livable)', kind: 'primary', sf: '', cover: 'solid', height: '', front: '', rear: '', side: '', street: '', inYard: false },
      { name: 'Garage', kind: 'primary', sf: '', cover: 'solid', height: '', front: '', rear: '', side: '', street: '', inYard: false },
      { name: 'Covered patio', kind: 'primary', sf: '', cover: 'solid', height: '', front: '', rear: '', side: '', street: '', inYard: false },
    ],
    checks: {},
    extra: [],
    verified: {},
    signs: [blankSign(1)],
    signCtx: blankSignCtx(),
  };
}
export function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY)) || blankReview();
    // Data read from plans is kept at most 45 days, in this browser too.
    if (d.ai && d.ai.at && Date.now() - Date.parse(d.ai.at) > 45 * 86400000) delete d.ai;
    return d;
  } catch { return blankReview(); }
}
export function saveDraft(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }

const num = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);
const fmt = (n) => (n == null ? 'not shown' : `${(+n).toLocaleString()} ft`);

// Effective minimum: the recorded plat's figure controls when entered (it may reflect an approved RUPD/UPD); otherwise zoning.
function minOf(zoning, plat) { const p = num(plat); return p != null ? p : zoning; }

export function computeFindings(s) {
  const key = normalizeDistrict(s.district);
  const d = key ? DISTRICTS[key] : null;
  const F = [];
  const cite = (sec) => `[MCZO §${sec}](${MCZO_URL})`;
  const push = (loc, item, shows, req, c, ok, fix) => F.push({ loc, item, shows, req, cite: c, status: ok === null ? 'verify' : ok ? 'ok' : 'deficient', fix: ok ? '—' : fix });
  if (!d) { F.push({ loc: 'General', item: 'Zoning district', shows: s.district || 'not set', req: 'A district in MCZO Ch. 5', cite: cite('502'), status: 'verify', fix: 'Set the district (run a parcel lookup) so dimensional checks can run.' }); return { F: applyVerified(s, F), key, d }; }
  // Sign permits are checked against MCZO Chapter 11 instead of the site-plan standards.
  if (String(s.type).startsWith('sign')) return { F: applyVerified(s, signFindings(s, key, d)), key, d };
  const sec = d.section; const p = s.primary;

  // Lot area / width
  const area = num(s.lotArea);
  if (area != null && d.area) push('Site', 'Lot area', `${area.toLocaleString()} sq ft`, `≥ ${d.area.toLocaleString()} sq ft`, cite(sec), area >= d.area, 'Lot is below the district minimum — confirm lawful nonconforming status or seek a variance (MCZO §302).');

  // Primary setbacks
  const sideMin = d.side == null ? (s.adjRes ? d.sideAdjRes ?? null : null) : d.side;
  const rearMin = d.rear == null ? (s.adjRes ? d.rearAdjRes ?? null : null) : (s.adjRes && d.rearAdjRes ? d.rearAdjRes : d.rear);
  const pairs = [
    ['Front setback (primary)', p.front, minOf(d.front, s.platSetbacks.front)],
    ['Rear setback (primary)', p.rear, minOf(rearMin, s.platSetbacks.rear)],
    ['Side-interior setback (primary) — side A', p.sideA, minOf(sideMin, s.platSetbacks.side)],
    ['Side-interior setback (primary) — side B', p.sideB, minOf(sideMin, s.platSetbacks.side)],
    ['Side-street setback (primary)', p.street, minOf(d.street, s.platSetbacks.street)],
  ];
  for (const [label, shown, req] of pairs) {
    if (req == null && num(shown) == null) continue;
    if (label.startsWith('Side-street') && num(shown) == null) continue; // interior lot
    const v = num(shown);
    const platNote = num(s.platSetbacks[{ 'Front setback (primary)': 'front', 'Rear setback (primary)': 'rear', 'Side-street setback (primary)': 'street' }[label] || 'side']) != null ? ' (recorded plat)' : '';
    push('Site plan — residence', label, fmt(v), req == null ? 'None required' : `≥ ${req} ft${platNote}`, platNote ? `Recorded plat; ${cite(sec)}` : cite(sec), v == null ? false : req == null ? true : v >= req,
      v == null ? `Dimension the ${label.toLowerCase().replace(' (primary)', '')} from the residence to the property line.` : `Increase to ≥ ${req} ft (relocate or reduce the structure), or seek a variance.`);
  }
  if (d.frontGarage && num(p.garage) != null) push('Site plan — garage', 'Front-facing garage plane to front lot line', fmt(num(p.garage)), `≥ ${d.frontGarage} ft`, cite(sec), num(p.garage) >= d.frontGarage, `Set the front-facing garage plane back ≥ ${d.frontGarage} ft.`);
  if (num(p.height) != null) push('Elevations', 'Building height (primary)', fmt(num(p.height)), `≤ ${d.height} ft`, cite(sec), num(p.height) <= d.height, `Reduce the height to ≤ ${d.height} ft.`);

  // Coverage (DD-2021-01)
  const rows = s.structures.filter(x => num(x.sf) != null);
  if (rows.length && area) {
    const covered = rows.reduce((t, x) => t + num(x.sf) * (x.cover === 'open' ? 0.5 : 1), 0);
    const pct = (covered / area) * 100;
    const detail = rows.map(x => `${x.name} ${num(x.sf).toLocaleString()}${x.cover === 'open' ? '×50%' : ''}`).join(' + ');
    push('Coverage table', 'Lot coverage', `${pct.toFixed(1)}% (${Math.round(covered).toLocaleString()} sf: ${detail})`, `≤ ${d.cov}%`, `${cite(sec)}; [DD-2021-01](${DD2021})`, pct <= d.cov,
      `Reduce covered area by ${Math.ceil(covered - area * d.cov / 100).toLocaleString()} sf or seek a variance; confirm overhang exclusions (2 ft primary / 1 ft accessory).`);
  }

  // Accessory structures
  if (d.acc) for (const x of s.structures.filter(x => x.kind !== 'primary')) {
    const adu = x.kind === 'adu'; const nm = x.name || (adu ? 'ADU' : 'Accessory structure');
    const sideRear = adu ? 5 : 3;
    for (const [lab, val, req] of [['rear', x.rear, sideRear], ['side-interior', x.side, sideRear], ['front', x.front, d.acc.front], ['side-street', x.street, d.acc.street]]) {
      const v = num(val); if (v == null) continue;
      push(`Site plan — ${nm}`, `${nm} ${lab} setback`, fmt(v), `≥ ${req} ft`, `${cite('806.2')}${adu ? '; Art. 602.3' : ''}; [DD-3012-01](${DD3012})`, v >= req, `Move the ${nm.toLowerCase()} to ≥ ${req} ft from the ${lab} lot line.`);
    }
    const h = num(x.height);
    if (h != null) { const max = adu && x.inYard ? 18 : d.height; push(`Elevations — ${nm}`, `${nm} height`, fmt(h), `≤ ${max} ft${adu && x.inYard ? ' (ADU within rear/side setback)' : ''}`, `${cite('811.6')}${adu ? '; Art. 602.3' : ''}`, h <= max, `Reduce height to ≤ ${max} ft.`); }
    if (num(x.front) == null && num(x.rear) == null && num(x.side) == null) push(`Site plan — ${nm}`, `${nm} setbacks`, 'not shown', '2 setback dimensions to lot lines', 'Residential Site Plan Checklist item 9', false, `Dimension at least two setbacks from the ${nm.toLowerCase()} to the property lines.`);
  }

  // Required rear and side yards (MCZO §806.2, §810.4): detached accessory buildings may sit in a required rear/side yard but
  // may cover ≤ 30% of it and stay ≥ 3 ft from the line (checked above); none in a corner lot's street-side yard; the rest of
  // each required yard stays open to the sky (eaves, sills, chimneys may project ≤ 2 ft). Yards are computed from the
  // effective setbacks (recorded plat wins) and the lot's width × depth.
  const yc = `${cite('806.2')}; ${cite('810.4')}`;
  const rearReq = minOf(rearMin, s.platSetbacks.rear), sideReq = minOf(sideMin, s.platSetbacks.side), frontReq = minOf(d.front, s.platSetbacks.front), streetReq = minOf(d.street, s.platSetbacks.street);
  const W = num(s.lotW), D = num(s.lotD);
  const acc = s.structures.filter(x => x.kind !== 'primary');
  const nm = (x) => x.name || (x.kind === 'adu' ? 'ADU' : 'Accessory structure');
  const inRear = acc.filter(x => rearReq && num(x.rear) != null && num(x.rear) < rearReq);
  const inSide = acc.filter(x => !inRear.includes(x) && sideReq && num(x.side) != null && num(x.side) < sideReq);
  const yard = (label, list, area, areaTxt) => {
    if (!list.length) return;
    const missing = list.filter(x => num(x.sf) == null);
    const fp = list.reduce((t2, x) => t2 + (num(x.sf) || 0), 0);
    const names = list.map(x => `${nm(x)}${num(x.sf) != null ? ` ${num(x.sf).toLocaleString()} sf` : ''}`).join(' + ');
    if (!area || missing.length) { F.push({ loc: `Site plan — ${label} yard`, item: `Accessory coverage of the required ${label} yard`, shows: `${names} in the required ${label} yard${!area ? ' — lot width/depth not entered' : ' — square footage missing'}`, req: '≤ 30% of the required yard', cite: yc, status: 'verify', fix: `Enter the lot width × depth and each structure's square footage (or measure on the plan), then confirm the accessory footprint is ≤ 30% of the required ${label} yard.` }); return; }
    const pct = fp / area * 100;
    push(`Site plan — ${label} yard`, `Accessory coverage of the required ${label} yard`, `${pct.toFixed(1)}% (${names} ÷ ${areaTxt})`, '≤ 30% of the required yard', yc, pct <= 30, `Reduce the accessory footprint in the required ${label} yard by ${Math.ceil(fp - area * 0.3).toLocaleString()} sf (to ≤ 30%), or move structures out of the yard.`);
  };
  yard('rear', inRear, W && rearReq ? W * rearReq : null, `${W || '?'} ft × ${rearReq} ft yard`);
  // Side yards run between the front and rear yards; structures are counted against one side yard (conservative).
  const sideLen = D && frontReq != null && rearReq != null ? D - frontReq - rearReq : null;
  yard('side', inSide, sideLen > 0 && sideReq ? sideLen * sideReq : null, `${sideLen > 0 ? sideLen : '?'} ft × ${sideReq} ft yard`);
  // Corner lots: no accessory building in the street-side yard (§806.2.2).
  for (const x of acc) { const v = num(x.street); if (v != null && streetReq && v < streetReq) push(`Site plan — ${nm(x)}`, `${nm(x)} in the corner lot's street-side yard`, fmt(v), `Not within the ${streetReq} ft street-side yard`, cite('806.2'), false, `Move the ${nm(x).toLowerCase()} out of the street-side yard (≥ ${streetReq} ft from the side-street lot line).`); }
  // Anything flagged "in yard" by hand that the numbers didn't place: confirm on the plan.
  const manual = acc.filter(x => x.inYard && !inRear.includes(x) && !inSide.includes(x));
  if (manual.length) F.push({ loc: 'Site plan — rear/side yard', item: 'Accessory coverage of the required rear/side yard', shows: `${manual.map(nm).join(', ')} marked as in a required yard (setbacks not entered)`, req: '≤ 30% of that required yard', cite: yc, status: 'verify', fix: 'Dimension the setbacks of each structure in a required yard and confirm its footprint is ≤ 30% of that yard.' });
  return { F: applyVerified(s, F), key, d };
}
// Reviewer decisions from Review Verification override the computed status of a measured check.
function applyVerified(s, F) {
  const V = s.verified || {};
  for (const f of F) {
    f.computed = f.status; const v = V[`f:${f.item}`]; if (!v) continue;
    if (v.status) f.status = v.status;
    if (f.status === 'ok') f.fix = '—'; else if (v.fix) f.fix = v.fix;
    if (v.note) f.shows = `${f.shows} (reviewer: ${v.note})`;
  }
  return F;
}

export function checklistRows(s) {
  const list = CHECKLISTS[s.type]?.items || [];
  return list.map(([id, item, citeLabel, url, fix]) => {
    const c = s.checks[id] || {};
    return { id, item, cite: url ? `[${citeLabel}](${url})` : citeLabel, status: c.status || '', note: c.note || '', fix: c.fix || fix };
  });
}


// Structured markup rows for the comment letter. status: 'incomplete' (checklist item missing), 'deficient', 'verify', 'ok'.
export function markupRows(s) {
  const { F, key, d } = computeFindings(s);
  const out = [];
  for (const r of checklistRows(s).filter(r => r.status && r.status !== 'na')) out.push({ group: 'Submittal Requirements (Completeness)', loc: 'Submittal', item: r.item, shows: r.note || (r.status === 'ok' ? 'Shown' : 'Not shown'), req: 'Per checklist', cite: r.cite, status: r.status === 'deficient' ? 'incomplete' : r.status, fix: r.fix });
  for (const f of F) out.push({ group: 'Zoning Standards (Setbacks, Height, Coverage)', loc: f.loc, item: f.item, shows: f.shows, req: f.req, cite: f.cite, status: f.status, fix: f.fix });
  for (const e of s.extra || []) if (e.item) out.push({ group: /record/i.test(e.item) ? 'Ownership & Parcel Information' : 'Other Comments', loc: e.loc || '—', item: e.item, shows: e.shows || '—', req: e.req || '—', cite: e.cite || '—', status: e.status, fix: e.status === 'ok' ? '—' : (e.fix || '—') });
  return { rows: out, district: key, section: d ? d.section : null };
}

const ICON = { ok: '✅ OK', deficient: '❌ Deficient', verify: '⚠️ Verify', na: 'N/A', incomplete: '❌ Incomplete' };

export function buildMarkdown(s) {
  const { F, key, d } = computeFindings(s);
  const cl = checklistRows(s).filter(r => r.status && r.status !== 'na');
  const rows = [];
  let n = 0;
  for (const r of cl) rows.push([++n, 'Submittal', r.item, r.note || (r.status === 'ok' ? 'Shown' : 'Not shown / not compliant'), 'Per checklist', r.cite, ICON[r.status === 'deficient' ? 'incomplete' : r.status] || r.status, r.status === 'ok' ? '—' : r.fix]);
  for (const f of F) rows.push([++n, f.loc, f.item, f.shows, f.req, f.cite, ICON[f.status], f.fix]);
  for (const e of s.extra) if (e.item) rows.push([++n, e.loc || '—', e.item, e.shows || '—', e.req || '—', e.cite || '—', ICON[e.status] || e.status, e.status === 'ok' ? '—' : (e.fix || '—')]);
  const def = rows.filter(r => /Deficient|Incomplete/.test(r[6])).length;
  const inc = cl.filter(r => r.status === 'deficient').length;
  const ver = rows.filter(r => /Verify/.test(r[6])).length;
  const md = [];
  md.push(`## Plan Review — ${s.apn || '<APN>'} — ${CHECKLISTS[s.type]?.label || s.type} — ${s.date}`, '');
  md.push(`**Plan reviewed:** ${s.planTitle || '—'}  **Reviewer:** ${s.reviewer || '—'}`);
  if (s.ai && s.ai.result) md.push(`**Plan read:** ${s.ai.file} read ${s.ai.engine === 'free' ? 'by Superficial Review (in-browser text reader)' : s.ai.engine === 'queued' ? 'by Queued Review (Claude)' : `by In-Depth Review (Claude, ${s.ai.model || 'AI'})`} on ${String(s.ai.at).slice(0, 10)}; the reviewer verified the values before issuing these comments.`);
  md.push(`**Controlling standards:** ${key ? `${key} per [MCZO Ch. 5 §${d.section}](${MCZO_URL}) (Dec 10, 2025 edition — confirm per DD-3014-01)` : 'district not set'}${Object.values(s.platSetbacks).some(v => v) ? `; recorded plat BSL F/R/S/SS = ${['front', 'rear', 'side', 'street'].map(k => s.platSetbacks[k] || '—').join('/')} ft` : ''}`);
  const vd = Object.values(s.verified || {}).filter(v => v && v.done);
  if (vd.length) md.push(`**Review verification:** ${vd.length} item${vd.length === 1 ? '' : 's'} verified one by one by the reviewer (last ${vd.map(v => v.at || '').sort().pop().slice(0, 10)}).`);
  md.push(`**Completeness:** ${inc ? `**Incomplete** (${inc} item${inc > 1 ? 's' : ''})` : (cl.length ? 'Complete' : 'Not screened')}`, '');
  md.push('| # | Sheet / location | Item | Plan shows | Required | Citation | Status | Required correction |', '|---|---|---|---|---|---|---|---|');
  for (const r of rows) md.push(`| ${r.map(c => String(c ?? '').replace(/\|/g, '\\|')).join(' | ')} |`);
  md.push('', `**Summary:** ${def} deficienc${def === 1 ? 'y' : 'ies'} (${inc} completeness, ${def - inc} compliance)${ver ? `; ${ver} item(s) to verify` : ''}. ${def ? 'Revise & resubmit.' : ver ? 'Approve after verification items are cleared.' : 'Approve.'}`);
  return md.join('\n');
}
