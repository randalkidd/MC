// Plan review → "Read a site plan PDF": sends the PDF through the relay to Claude (POST /ai/siteplan), maps the
// structured result onto the review form, and checks the plan's APN / owner / address / lot area / zoning against
// the Assessor record and the recorded deed.
import { relayFetch } from './github.js?v=70349faf';
import { request } from './net.js?v=70349faf';
import { EP, normalizeApn } from './lookup.js?v=70349faf';
import { CHECKLISTS } from './checklists.js?v=70349faf';
import { normalizeDistrict } from './standards.js?v=70349faf';

export const MAX_PDF_MB = 30;
const b64 = (str) => { const b = new TextEncoder().encode(str); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };

export async function readSitePlan(file, type) {
  if (!file) throw new Error('Choose a PDF first.');
  if (file.size > MAX_PDF_MB * 1024 * 1024) throw new Error(`That PDF is ${(file.size / 1048576).toFixed(1)} MB; the limit is ${MAX_PDF_MB} MB. Export just the site plan sheets.`);
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (String.fromCharCode(...head) !== '%PDF-') throw new Error('That file is not a PDF.');
  const cl = CHECKLISTS[type] || CHECKLISTS.residential;
  const ctx = { type, label: cl.label, checklist: cl.items.map(([id, item]) => ({ id, item })) };
  return relayFetch('/ai/siteplan', { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-MC-Context': b64(JSON.stringify(ctx)) }, body: file });
}

// Grantee/grantor names on the recorded deed (County Recorder public API). Best effort: null when unavailable.
export async function deedNames(rec) {
  if (!rec) return null;
  try {
    const d = await request(`${EP.recorderApi}/documents/${encodeURIComponent(rec)}`);
    const raw = (d && (d.names || d.grantees || d.parties)) || [];
    const names = raw.map(n => typeof n === 'string' ? n : (n && (n.name || n.fullName || [n.lastName, n.firstName].filter(Boolean).join(' ')))).filter(Boolean);
    return names.length ? [...new Set(names.map(s => s.trim()))] : null;
  } catch { return null; }
}

// ---------- name matching ----------
const NOISE = new Set(['THE', 'AND', 'OF', 'TR', 'TRS', 'TRUST', 'TRUSTEE', 'TRUSTEES', 'REVOCABLE', 'REV', 'LIVING', 'FAMILY', 'ETAL', 'ET', 'AL', 'JT', 'JTWROS', 'TEN', 'TENANTS', 'COMMUNITY', 'PROPERTY', 'CPWROS', 'WROS', 'HUSBAND', 'WIFE', 'MR', 'MRS', 'MS', 'DATED', 'DTD', 'U', 'A', 'UTD', 'LLC', 'INC', 'LP', 'LLP', 'CO', 'CORP', 'OWNER', 'OWNERS']);
const toks = (s) => String(s || '').toUpperCase().replace(/&/g, ' ').replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length > 1 && !NOISE.has(t) && !/^\d+$/.test(t));
export function nameMatch(plan, record) {
  const a = new Set(toks(plan)), b = new Set(toks(record));
  if (!a.size || !b.size) return { status: 'verify', common: [] };
  const common = [...a].filter(t => b.has(t));
  const small = Math.min(a.size, b.size);
  if (common.length >= Math.min(2, small) && common.length / small >= 0.5) return { status: 'ok', common };
  if (common.length) return { status: 'verify', common };
  return { status: 'deficient', common };
}
const addrToks = (s) => String(s || '').toUpperCase().replace(/\b\d{5}(-\d{4})?\s*$/, ' ').replace(/\b(STREET|ST|AVENUE|AVE|ROAD|RD|DRIVE|DR|LANE|LN|WAY|BOULEVARD|BLVD|COURT|CT|PLACE|PL|CIRCLE|CIR|TRAIL|TRL|PARKWAY|PKWY|AZ|ARIZONA|N|S|E|W|NORTH|SOUTH|EAST|WEST)\b/g, ' ').replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

// Rows: [check, plan shows, record shows, status, note]
export function compareToRecords(res, R, deed) {
  const P = (res && res.parcel) || {}; const p = (R && R.parcel) || {};
  const rows = [];
  const planApn = normalizeApn(P.apn);
  const recApn = R ? R.apn : null;
  rows.push(['APN', P.apn || 'not shown', recApn ? `${recApn} (Assessor; current deed #${p.DeedNumber || '?'})` : 'no parcel looked up',
    !P.apn ? 'deficient' : !recApn ? 'verify' : planApn === recApn ? 'ok' : 'deficient',
    !P.apn ? 'Add the APN to the site plan.' : planApn === recApn ? '' : `Plan APN ${P.apn} does not match the parcel reviewed (${recApn}) — confirm the correct parcel.`]);
  const deedList = deed && deed.length ? deed : null;
  const recOwner = p.OwnerName || '';
  const vsDeed = deedList ? deedList.map(n => nameMatch(P.owner_name, n)).sort((x, y) => ['ok', 'verify', 'deficient'].indexOf(x.status) - ['ok', 'verify', 'deficient'].indexOf(y.status))[0] : null;
  const vsAssessor = nameMatch(P.owner_name, recOwner);
  const best = !P.owner_name ? { status: 'deficient' } : vsDeed && vsDeed.status === 'ok' ? vsDeed : vsAssessor.status === 'ok' ? vsAssessor : (vsDeed || vsAssessor);
  rows.push(['Owner name', P.owner_name || 'not shown',
    `${recOwner || '—'} (Assessor)${deedList ? `; deed #${p.DeedNumber}${p.DeedDate ? ` (${p.DeedDate})` : ''} names: ${deedList.join('; ')}` : p.DeedNumber ? `; deed #${p.DeedNumber}${p.DeedDate ? ` (${p.DeedDate})` : ''} — names not available from the Recorder` : ''}`,
    best.status, !P.owner_name ? 'Add the owner name to the site plan.' : best.status === 'ok' ? '' : best.status === 'verify' ? 'Names only partly match — confirm ownership; if it changed recently, attach the recorded deed.' : 'Owner on the plan does not match the deed/Assessor owner — provide the recorded deed showing current ownership or an owner authorization.']);
  const recAddr = [p.PropertyFullStreetAddress, p.PropertyCity].filter(Boolean).join(', ');
  if (P.site_address || recAddr) {
    const a = addrToks(P.site_address), b = new Set(addrToks(p.PropertyFullStreetAddress));
    const num = a.find(t => /^\d+$/.test(t)); const hit = a.filter(t => b.has(t)).length;
    const st = !P.site_address ? 'deficient' : !recAddr ? 'verify' : num && b.has(num) && hit >= 2 ? 'ok' : hit ? 'verify' : 'deficient';
    rows.push(['Site address', P.site_address || 'not shown', recAddr || '— (no situs address on record)', st, st === 'ok' ? '' : !P.site_address ? 'Add the site address.' : 'Address differs from the Assessor situs address — confirm.']);
  }
  if (P.lot_area_sf != null || p.areaSqFt) {
    const gis = p.areaSqFt; const v = P.lot_area_sf; const diff = v && gis ? Math.abs(v - gis) / gis : null;
    rows.push(['Lot area', v != null ? `${Math.round(v).toLocaleString()} sf${P.lot_area_acres ? ` (${P.lot_area_acres} ac)` : ''}` : 'not shown', gis ? `${gis.toLocaleString()} sf (GIS polygon, approx.)` : '—',
      v == null ? 'verify' : diff == null ? 'verify' : diff <= 0.05 ? 'ok' : 'verify', v == null ? 'Show the lot area on the plan.' : diff != null && diff > 0.05 ? `Plan differs from GIS by ${(diff * 100).toFixed(0)}% — confirm against the survey/legal description (GIS area is approximate).` : '']);
  }
  const zs = (R && R.zoning || []).map(z => z.zone);
  if (P.zoning_shown || zs.length) {
    const k = normalizeDistrict(P.zoning_shown);
    const st = !P.zoning_shown ? 'verify' : zs.some(z => normalizeDistrict(z) === k) ? 'ok' : 'deficient';
    rows.push(['Zoning district', P.zoning_shown || 'not shown', zs.join(', ') || '—', st, st === 'deficient' ? `Plan shows ${P.zoning_shown}; GIS shows ${zs.join(', ')} — correct the plan.` : st === 'verify' ? 'Consider adding the zoning district to the plan.' : '']);
  }
  if (P.subdivision || P.lot || P.mcr || p.SubdivisionName) {
    const mcrN = (v) => String(v || '').replace(/[^0-9-]/g, '').replace(/^0+/, '').replace(/-0+(?=\d)/, '-');
    const mcrOk = P.mcr && p.MCRNumber ? mcrN(P.mcr) === mcrN(p.MCRNumber) : null;
    const sOk = P.subdivision && p.SubdivisionName ? nameMatch(P.subdivision, p.SubdivisionName).status : null;
    const lOk = P.lot && p.Lot ? String(P.lot).replace(/\D/g, '') === String(p.Lot).replace(/\D/g, '') : null;
    const survey = /LOT SPLIT|SURVEY|LAND DIVISION/i.test(P.legal_description || '');
    let st;
    if (lOk === false || sOk === 'deficient' || mcrOk === false) st = 'deficient';
    else if (mcrOk || sOk === 'ok' || (!p.SubdivisionName && survey && !P.subdivision)) st = 'ok';
    else st = 'verify';
    const plan = [P.subdivision || (survey ? 'Lot-split survey' : ''), P.lot && `Lot ${P.lot}`, P.mcr && `MCR ${P.mcr}`].filter(Boolean).join(' · ') || 'not shown';
    const rec = [p.SubdivisionName, p.Lot && `Lot ${p.Lot}`, p.MCRNumber && `MCR ${p.MCRNumber}`].filter(Boolean).join(' · ') || '— (not platted)';
    rows.push(['Subdivision / lot', plan, rec, st, st === 'deficient' ? `Subdivision/lot/recording on the plan does not match the Assessor record (${rec}).` : st === 'verify' ? 'Confirm the lot and recording against the Assessor record.' : '']);
  }
  return rows;
}

// ---------- map the result onto the review form ----------
const n = (v) => (v == null || v === '' || isNaN(+v) ? '' : String(+(+v).toFixed(2)));
export function applyToReview(s, res, compare, { merge = false } = {}) {
  const P = res.parcel || {}, pl = res.plan || {}, pr = res.primary || {};
  const title = [pl.title, pl.revision && `rev. ${pl.revision}`, pl.date].filter(Boolean).join(' · ');
  if (title) s.planTitle = title;
  if (!s.apn && P.apn) s.apn = normalizeApn(P.apn) || P.apn;
  if (!s.lotArea && P.lot_area_sf) s.lotArea = String(Math.round(P.lot_area_sf));
  if (!s.district && P.zoning_shown) s.district = normalizeDistrict(P.zoning_shown) || s.district;
  const P2 = { front: n(pr.front), rear: n(pr.rear), sideA: n(pr.side_a), sideB: n(pr.side_b), street: n(pr.side_street), height: n(pr.height), garage: n(pr.garage_plane) };
  // The free reader only fills what it found and keeps what the reviewer already entered.
  s.primary = merge ? Object.fromEntries(Object.entries(P2).map(([k, v]) => [k, v !== '' ? v : (s.primary[k] ?? '')])) : P2;
  const st = (res.structures || []).filter(x => x && x.name);
  if (st.length) s.structures = st.map(x => ({
    name: `${x.name}${/\b(new|exist)/i.test(x.name) ? '' : x.status === 'existing' ? ' (existing)' : x.status === 'new' ? ' (new)' : ''}`, kind: ['primary', 'accessory', 'adu'].includes(x.kind) ? x.kind : 'accessory',
    sf: n(x.sqft), cover: x.cover === 'open' ? 'open' : 'solid', height: n(x.height),
    front: n(x.front), rear: n(x.rear), side: n(x.side), street: n(x.street), inYard: !!x.in_required_yard,
  }));
  const ids = new Set((CHECKLISTS[s.type]?.items || []).map(i => i[0]));
  for (const c of res.checklist || []) {
    if (!ids.has(c.id)) continue;
    const cur = s.checks[c.id] || {};
    s.checks[c.id] = { ...cur, status: c.status, note: c.shows || cur.note || '', ...(c.status === 'deficient' && c.correction ? { fix: c.correction } : {}) };
  }
  // Record comparisons and extra AI findings become rows of the markup table.
  s.extra = (s.extra || []).filter(e => !e.ai);
  for (const [item, shows, rec, status, note] of compare || []) if (status !== 'ok') s.extra.push({ ai: true, loc: 'Title block / owner info', item: `${item} — plan vs. record`, shows, req: `Match record: ${rec}`, cite: 'Residential Site Plan Checklist (owner/APN); recorded deed', status, fix: note || 'Confirm.' });
  for (const f of res.other_findings || []) if (f && f.item) s.extra.push({ ai: true, loc: f.location || 'Site plan', item: f.item, shows: f.shows || '—', req: f.required || '—', cite: 'Plan read (Claude) — verify', status: f.status === 'deficient' ? 'deficient' : 'verify', fix: f.correction || 'Verify.' });
  return s;
}
