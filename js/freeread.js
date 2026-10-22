// Free site-plan reader: runs entirely in the browser with pdf.js. It reads the PDF's own text (plans exported from
// CAD or Word/Excel have real text; scans don't) and pulls out labeled values: APN, owner, address, lot area, zoning,
// scale, area table, coverage, setbacks, easements and notes. It returns the same shape as the Claude reader, so the
// rest of the page treats both the same. It never marks an item deficient just because it couldn't find it.
import { loadPdfjs } from './planviewer.js?v=00fcfa75';
import { CHECKLISTS } from './checklists.js?v=00fcfa75';

const PDFJS = './js/vendor/pdfjs-3.2.146/';
const U = (s) => String(s ?? '').toUpperCase().replace(/\s+/g, ' ').trim();

// Text runs → lines (runs sharing a baseline and direction), each with a box in page fractions.
async function readLines(doc) {
  const pages = [];
  for (let p = 1; p <= Math.min(doc.numPages, 40); p++) {
    const pg = await doc.getPage(p); const vp = pg.getViewport({ scale: 1 });
    const tc = await pg.getTextContent();
    const runs = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const [a, b, c, d, e, f] = it.transform; const fs = Math.hypot(c, d) || Math.hypot(a, b) || 8;
      const ang = Math.round(Math.atan2(b, a) * 180 / Math.PI);
      const w = it.width || it.str.length * fs * 0.5; const ux = Math.cos(ang * Math.PI / 180), uy = Math.sin(ang * Math.PI / 180), nx = -uy, ny = ux;
      const pts = [[e, f], [e + w * ux, f + w * uy], [e + nx * fs, f + ny * fs], [e + w * ux + nx * fs, f + w * uy + ny * fs]].map(([x, y]) => vp.convertToViewportPoint(x, y));
      const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
      // position along / across the text direction, for grouping into lines
      const along = e * ux + f * uy, across = -e * uy + f * ux;
      runs.push({ s: it.str, fs, ang, along, across, end: along + w, box: [Math.min(...xs) / vp.width, Math.min(...ys) / vp.height, Math.max(...xs) / vp.width, Math.max(...ys) / vp.height] });
    }
    runs.sort((r1, r2) => r1.ang - r2.ang || r2.across - r1.across || r1.along - r2.along);
    const lines = [];
    for (const r of runs) {
      const L = lines[lines.length - 1];
      if (L && L.ang === r.ang && Math.abs(L.across - r.across) < r.fs * 0.5 && r.along - L.end < r.fs * 2.5 && r.along >= L.start - r.fs) {
        L.s += (r.along - L.end > r.fs * 0.15 ? ' ' : '') + r.s; L.end = Math.max(L.end, r.end);
        L.box = [Math.min(L.box[0], r.box[0]), Math.min(L.box[1], r.box[1]), Math.max(L.box[2], r.box[2]), Math.max(L.box[3], r.box[3])];
      } else lines.push({ s: r.s, ang: r.ang, across: r.across, start: r.along, end: r.end, fs: r.fs, box: r.box.slice(), page: p });
    }
    lines.forEach(l => { l.u = U(l.s); });
    pages.push({ lines, runs: runs.length });
  }
  return pages;
}

const DIM = String.raw`(\d{1,3}(?:\.\d+)?)\s*(?:'|FT\b|FEET\b)\s*(?:-?\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|IN\b))?`;
const ft = (m, i = 1) => (m ? +(+m[i] + (m[i + 1] ? +m[i + 1] / 12 : 0)).toFixed(2) : null);
const num = (s) => +String(s).replace(/,/g, '');
const STD_SCALES = /^1"\s*=\s*(10|20|30|40|50|60|80|100|200)'|^(1\/16|3\/32|1\/8|3\/16|1\/4|3\/8|1\/2|3\/4|1|1 1\/2|3)"\s*=\s*1'/;

export async function freeReadSitePlan(file, type) {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, standardFontDataUrl: `${PDFJS}standard_fonts/` }).promise;
  try {
    const pages = await readLines(doc);
    const lines = pages.flatMap(p => p.lines);
    const runs = pages.reduce((t, p) => t + p.runs, 0);
    const ann = []; const uncertain = [];
    const mark = (ref, l, note) => l && ann.push({ ref, page: l.page, box: l.box, note: note || '' });
    // first line (with index) matching rx; prefer lines containing a label
    const first = (rx, pref) => { let hit = null; for (const l of lines) { const m = l.u.match(rx); if (m) { if (!pref || pref.test(l.u)) return { l, m }; hit = hit || { l, m }; } } return hit; };
    const after = (l) => { // the next line below l on the same page, roughly left-aligned
      const c = lines.filter(x => x.page === l.page && x.ang === l.ang && x !== l && x.across < l.across && l.across - x.across < l.fs * 2.2 && Math.abs(x.start - l.start) < l.fs * 8);
      return c.sort((a, b) => b.across - a.across)[0] || null; };
    const all = lines.map(l => l.u).join('\n');
    const plan = {}, parcel = {}, primary = {}, coverage = {};

    // ---- title block ----
    const title = lines.filter(l => l.page === 1 && /SITE PLAN|PLOT PLAN|GRADING|PLAN\b/.test(l.u) && l.u.length < 70).sort((a, b) => b.fs - a.fs)[0];
    if (title) plan.title = title.s.trim();
    const rev = first(/\bREV(?:ISION)?\.?\s*(?:NO\.?|#)?\s*[:\-]?\s*([A-Z0-9]{1,3})\b/); if (rev) plan.revision = rev.m[1];
    const dt = first(/\b(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})\b/, /DATE/); if (dt) plan.date = dt.m[1];
    plan.sheets = doc.numPages;
    // ---- APN ----
    const apn = first(/\b(\d{3})[-\s.]?(\d{2})[-\s.]?(\d{3})([A-Z])?\b/, /APN|A\.P\.N|PARCEL|TAX/);
    if (apn && (/APN|A\.P\.N|PARCEL|TAX/.test(apn.l.u) || /\d{3}-\d{2}-\d{3}/.test(apn.l.u))) { parcel.apn = `${apn.m[1]}-${apn.m[2]}-${apn.m[3]}${apn.m[4] || ''}`; mark('parcel:apn', apn.l); }
    // ---- owner ----
    const ow = first(/\b(?:PROPERTY\s+)?OWNER(?:\(S\)|S)?(?:\s+NAME)?\s*[:\-]?\s*(.*)$/);
    if (ow) { let v = ow.m[1].replace(/^(INFORMATION|INFO)\s*:?/, '').trim(); let l = ow.l; if (!v || v.length < 3) { const n = after(ow.l); if (n) { v = n.u; l = n; } } if (v && !/^(ADDRESS|PHONE|APN)/.test(v)) { parcel.owner_name = v.split(/\s{2,}|\s+(?:PHONE|TEL|PH|EMAIL|APN|ADDRESS)\b/)[0].trim(); mark('parcel:owner_name', l); } }
    // ---- address ----
    const STREET = String.raw`(\d{2,6}\s+(?:[NSEW]\.?\s+)?[A-Z0-9 .']+?\s(?:ST|STREET|AVE|AVENUE|RD|ROAD|DR|DRIVE|LN|LANE|WAY|BLVD|CT|COURT|PL|PLACE|TRL|TRAIL|CIR|CIRCLE|PKWY|HWY|LOOP|PATH|RUN)\b\.?(?:,?\s*[A-Z][A-Z .]*?(?:,?\s*AZ\b\.?|(?=\s+\d{5})|$))?(?:\s+\d{5}(?:-\d{4})?)?)`;
    const ad = first(new RegExp(String.raw`(?:SITE|PROPERTY|PROJECT|JOB)?\s*(?:ADDRESS|LOCATION)\s*[:\-]?\s*` + STREET), /SITE|PROPERTY|PROJECT|JOB/) || first(new RegExp('^' + STREET));
    if (ad) { parcel.site_address = ad.m[1].trim(); mark('parcel:site_address', ad.l); }
    // ---- lot area ----
    const la = first(/\b(?:NET\s+|GROSS\s+)?(?:LOT|PARCEL|SITE|PROPERTY)\s+(?:AREA|SIZE)\s*[:=\-]?\s*([\d,]+(?:\.\d+)?)\s*(S\.?\s?F\.?|SQ\.?\s*FT\.?|SQUARE FEET|AC\.?|ACRES?)?/);
    if (la) { const v = num(la.m[1]); const ac = /^AC/.test(la.m[2] || '') || (!la.m[2] && v < 200); parcel.lot_area_sf = ac ? Math.round(v * 43560) : v; if (ac) parcel.lot_area_acres = v; mark('parcel:lot_area_sf', la.l); }
    // ---- zoning ----
    const zn = first(/\bZON(?:ING|ED)(?:\s+DISTRICT)?\s*[:\-]?\s*((?:RU|R|C|IND|IR|RS)[-\d A-Z\/.]{0,10})/);
    if (zn) { parcel.zoning_shown = zn.m[1].trim().split(/\s/)[0]; mark('parcel:zoning_shown', zn.l); }
    // ---- legal / subdivision / lot ----
    const lg = first(/LEGAL DESCRIPTION\s*[:\-]?\s*(.*)$/);
    if (lg) { let v = lg.m[1]; if (v.length < 10) { const n = after(lg.l); if (n) v = n.u; } parcel.legal_description = v.slice(0, 300); mark('parcel:legal_description', lg.l); }
    const sl = first(/\bLOT\s+(\d+[A-Z]?)\s*(?:,|OF)\s*(?:BLOCK\s+\w+\s*,?\s*)?([A-Z][A-Z0-9 '&-]{3,60}?)(?:,|\s+ACCORDING|\s+AS\s+RECORDED|\s+MCR|\s+BOOK|$)/);
    if (sl) { parcel.lot = sl.m[1]; parcel.subdivision = sl.m[2].trim(); mark('parcel:subdivision', sl.l); }
    // ---- scale / north / vicinity ----
    const sc = first(/\bSCALE\s*[:\-]?\s*(1"\s*=\s*\d+'(?:\s*-\s*0")?|\d+(?:\/\d+)?"\s*=\s*1'(?:\s*-\s*0")?|N\.?T\.?S\.?|NOT TO SCALE)/);
    if (sc) { plan.scale_stated = sc.m[1]; plan.scale_is_standard = STD_SCALES.test(sc.m[1].replace(/\s+/g, ' ')); mark('plan:scale', sc.l); }
    plan.scale_bar = /GRAPHIC SCALE|SCALE BAR/.test(all) || null;
    const nv = first(/^(?:TRUE\s+)?NORTH$|^N$/); plan.north_arrow = nv ? true : null; if (nv) mark('plan:north_arrow', nv.l);
    const vm = first(/VICINITY MAP|LOCATION MAP|VICINITY\b/); plan.vicinity_map = vm ? true : null; if (vm) mark('plan:vicinity_map', vm.l);
    plan.invalidating_notes = [...new Set(lines.filter(l => /\bFUTURE\b|NOT FOR CONSTRUCTION|FOR REFERENCE ONLY|PRELIMINARY - NOT/.test(l.u)).map(l => l.s.trim().slice(0, 120)))].slice(0, 10);
    // ---- water / wastewater ----
    const wa = first(/\bWATER\s*(?:SOURCE|SUPPLY|PROVIDER|SERVICE)?\s*[:\-]\s*(.+)$/) || first(/\b(PRIVATE WELL|SHARED WELL|DOMESTIC WELL|HAULED WATER|EPCOR|CITY OF [A-Z ]+ WATER|GLOBAL WATER|JOHNSON UTILITIES|ARIZONA WATER)\b/);
    if (wa) parcel.water_source = wa.m[1].trim().slice(0, 80);
    parcel.wastewater = /\bSEPTIC\b/.test(all) ? 'Septic' : /\bSEWER\b/.test(all) ? 'Sewer' : null;
    // ---- area table → structures ----
    const structures = [];
    for (const l of lines) {
      if (/\b(LOT|SITE|PARCEL|TOTAL|NET|GROSS)\b.*(AREA|COVERAGE|SIZE)|COVERAGE|TOTAL\b/.test(l.u)) continue;
      const m = l.u.match(/^(.*?\b(LIVABLE|LIVING|HOUSE|RESIDENCE|DWELLING|HOME|GARAGE|CARPORT|PATIO|PORCH|RAMADA|SHED|CASITA|GUEST|ADU|BARN|STORAGE|SHADE|WORKSHOP|SHOP|STABLE|ARENA|ACCESSORY|ADDITION|POOL HOUSE)\b[A-Z \(\)\/\-.#\d]*?)\s*[:=\-]?\s*([\d,]{2,7}(?:\.\d+)?)\s*(?:S\.?\s?F\.?|SQ\.?\s*FT\.?|SQUARE FEET)\b/);
      if (!m) continue;
      const name = m[1].replace(/\s+/g, ' ').trim(); const w = m[2];
      const kind = /CASITA|GUEST|ADU/.test(w) && !/ATTACHED/.test(l.u) ? 'adu' : /SHED|BARN|STORAGE|SHADE|WORKSHOP|SHOP|STABLE|ARENA|ACCESSORY|DETACHED|POOL HOUSE/.test(l.u) ? 'accessory' : 'primary';
      structures.push({ name: name.charAt(0) + name.slice(1).toLowerCase(), kind, status: /\bEXIST/.test(l.u) ? 'existing' : /\bNEW|PROPOSED/.test(l.u) ? 'new' : 'unknown', sqft: num(m[3]), sqft_source: 'table', cover: /LATTICE|SHADE/.test(l.u) ? 'open' : 'solid', _line: l });
    }
    structures.forEach((s, i) => { mark(`structure:${i}:sqft`, s._line); delete s._line; });
    // ---- coverage ----
    const cv = first(/\b(?:LOT\s+)?COVERAGE\s*(?:\(%\)|%)?\s*[:=\-]?\s*(?:PROVIDED|PROPOSED|ACTUAL)?\s*[:=\-]?\s*([\d.]+)\s*%/);
    if (cv) { coverage.lot_coverage_pct_shown = +cv.m[1]; mark('coverage', cv.l); }
    const tc = first(/\bTOTAL\s+(?:COVERED|ROOF|UNDER ROOF|BUILDING|LOT COVERAGE)[A-Z ]*\s*[:=\-]?\s*([\d,]{3,7})\s*(?:S\.?\s?F|SQ)/);
    if (tc) coverage.total_covered_sf_shown = num(tc.m[1]);
    // ---- setbacks / height (labeled text only) ----
    const SB = { front: /\bFRONT\b/, rear: /\bREAR\b|\bBACK\b/, side_street: /STREET\s*SIDE|SIDE\s*STREET|CORNER SIDE/, side_a: /\b(?:INTERIOR\s+)?SIDE\b/ };
    for (const [k, rx] of Object.entries(SB)) {
      const hits = lines.filter(l => rx.test(l.u) && /SETBACK|S\/B|YARD|B\.?S\.?L/.test(l.u) && !/REQUIRED|REQ'?D|MIN(IMUM)?\b|ALLOWED|MAX/.test(l.u) && new RegExp(DIM).test(l.u) && !(k === 'side_a' && /STREET/.test(l.u)));
      if (!hits.length) continue;
      const vals = hits.map(l => ({ l, v: ft(l.u.match(new RegExp(DIM))) })).filter(x => x.v != null);
      if (!vals.length) continue;
      if (k === 'side_a') { primary.side_a = vals[0].v; mark('primary:side_a', vals[0].l); if (vals[1]) { primary.side_b = vals[1].v; mark('primary:side_b', vals[1].l); } }
      else { primary[k] = vals[0].v; mark(`primary:${k}`, vals[0].l); }
    }
    if (Object.keys(primary).length) uncertain.push('Setbacks were taken from text labels on the plan (e.g. "FRONT SETBACK 25\'") — confirm each is the dimension from the residence to the property line, not the required minimum.');
    const ht = first(new RegExp(String.raw`\b(?:BUILDING\s+|MAX\.?\s+|OVERALL\s+)?HEIGHT\s*[:=\-]?\s*(?:PROVIDED|PROPOSED)?\s*[:=\-]?\s*` + DIM));
    if (ht && !/REQUIRED|ALLOWED|MAX(IMUM)? ALLOWED/.test(ht.l.u)) { primary.height = ft(ht.m); mark('primary:height', ht.l); }
    // ---- easements / streets / wells / adjacent ----
    const easements = lines.filter(l => /EASEMENT|\bP\.?U\.?E\b|\bV\.?N\.?A\.?E\b/.test(l.u)).slice(0, 15).map(l => { const w = l.u.match(new RegExp(DIM)); const rec = l.u.match(/(?:MCR|DOC(?:UMENT)?\.?\s*(?:NO\.?|#)?|BK\.?\s*\d+\s*PG\.?)\s*[:#]?\s*([\d\-\/ ]{4,})/); return { type: l.s.trim().slice(0, 80), width: w ? `${ft(w)} ft` : null, recording: rec ? rec[1].trim() : null, location: null }; });
    const streets = lines.filter(l => /\bR\.?O\.?W\.?\b|RIGHT[- ]OF[- ]WAY/.test(l.u)).slice(0, 8).map(l => { const w = l.u.match(new RegExp(DIM)); return { name: l.s.trim().slice(0, 80), row_width: w ? `${ft(w)} ft` : null, jurisdiction: /MCDOT|MARICOPA COUNTY/.test(l.u) ? 'MCDOT' : /PRIVATE/.test(l.u) ? 'Private' : null }; });
    const adjacent_uses = [...new Set(lines.filter(l => /ADJACENT|ADJ\.|NEIGHBOR/.test(l.u) || /^(VACANT|RESIDENTIAL|COMMERCIAL|AGRICULTURAL)\b/.test(l.u)).map(l => l.s.trim().slice(0, 60)))].slice(0, 8);
    const wells = /\bWELL\b/.test(all);
    // boxes for the checklist items the free reader can point at
    lines.filter(l => /\bFUTURE\b|NOT FOR CONSTRUCTION|FOR REFERENCE ONLY|PRELIMINARY - NOT/.test(l.u)).slice(0, 6).forEach(l => mark('checklist:c-future', l));
    lines.filter(l => /EASEMENT|\bP\.?U\.?E\b|\bV\.?N\.?A\.?E\b/.test(l.u)).slice(0, 6).forEach(l => mark('checklist:c-ease', l));
    lines.filter(l => /\bR\.?O\.?W\.?\b|RIGHT[- ]OF[- ]WAY/.test(l.u)).slice(0, 4).forEach(l => mark('checklist:c-row', l));
    lines.filter(l => /\bWELL\b/.test(l.u)).slice(0, 4).forEach(l => mark('checklist:c-wells', l));
    lines.filter(l => /\bSEPTIC\b/.test(l.u)).slice(0, 4).forEach(l => mark('checklist:r-septic', l));

    // ---- checklist (ok / verify only; deficient only when something wrong is actually shown) ----
    const ids = new Set((CHECKLISTS[type] || CHECKLISTS.residential).items.map(i => i[0]));
    const checklist = []; const ck = (id, status, shows, correction) => ids.has(id) && checklist.push({ id, status, shows, ...(correction ? { correction } : {}) });
    if (sc) ck('c-scale', plan.scale_is_standard ? 'ok' : 'deficient', `Scale ${plan.scale_stated}${plan.scale_bar ? ' with graphic scale' : ''}`, plan.scale_is_standard ? null : 'Use a standard engineer/architect scale (1"=10\', 20\', 30\'…) with a scale bar.');
    else ck('c-scale', 'verify', 'Scale not found in the PDF text');
    ck('c-north', plan.vicinity_map && plan.north_arrow ? 'ok' : 'verify', `${plan.north_arrow ? 'North arrow label found' : 'North arrow not found in text (may be a graphic)'}; ${plan.vicinity_map ? 'vicinity map found' : 'vicinity map not found in text'}`);
    const have = [parcel.apn && 'APN', parcel.site_address && 'address', parcel.owner_name && 'owner'].filter(Boolean);
    ck('c-apn', have.length === 3 ? 'ok' : 'verify', have.length ? `Found: ${have.join(', ')}${have.length < 3 ? `; not found: ${['APN', 'address', 'owner'].filter(x => !have.includes(x)).join(', ')}` : ''}` : 'APN, address and owner not found in the PDF text');
    if (plan.invalidating_notes.length) ck('c-future', 'deficient', plan.invalidating_notes.join('; '), 'Remove future buildings and invalidating notes ("future", "not for construction").');
    else ck('c-future', 'verify', 'No "future"/"not for construction" text found — check graphics');
    if (easements.length) ck('c-ease', 'verify', `${easements.length} easement label(s): ${easements.map(e => e.type).slice(0, 3).join('; ')}`);
    if (streets.length) ck('c-row', 'verify', streets.map(s => s.name).slice(0, 3).join('; '));
    if (wells) ck('c-wells', 'verify', 'Well mentioned on the plan — check distances');
    if (structures.length) ck('r-cov', coverage.lot_coverage_pct_shown != null ? 'ok' : 'verify', `Area table: ${structures.map(s => `${s.name} ${s.sqft.toLocaleString()} sf`).join(', ')}${coverage.lot_coverage_pct_shown != null ? `; coverage ${coverage.lot_coverage_pct_shown}%` : '; coverage % not found'}`);
    if (parcel.water_source) ck('r-water', 'ok', `Water: ${parcel.water_source}`);
    if (parcel.wastewater === 'Septic') ck('r-septic', 'verify', 'Septic shown — check tank/field locations and setbacks');

    // ---- quality: did the free reader get enough to be useful? ----
    const keys = { APN: !!parcel.apn, owner: !!parcel.owner_name, address: !!parcel.site_address, 'lot area': parcel.lot_area_sf != null, scale: !!plan.scale_stated, 'area table': structures.length > 0, setbacks: Object.keys(primary).some(k => k !== 'height') };
    const found = Object.entries(keys).filter(([, v]) => v).map(([k]) => k);
    const missing = Object.entries(keys).filter(([, v]) => !v).map(([k]) => k);
    const quality = !runs ? 'none' : found.length >= 4 ? 'good' : found.length >= 2 ? 'partial' : 'poor';
    if (missing.includes('setbacks')) uncertain.push('Setback dimensions to the property lines were not found as text — they are usually drawn as graphic dimensions. Measure them on the plan or use Read with Claude.');
    const summary = !runs ? 'This PDF has no selectable text (scanned or flattened). The free reader can\'t read it.'
      : `Free text reader: found ${found.join(', ') || 'nothing useful'}${missing.length ? `; not found: ${missing.join(', ')}` : ''}.`;
    return { result: { plan, parcel, primary, structures, coverage, easements, streets, adjacent_uses, checklist, other_findings: [], uncertain, annotations: ann, summary }, quality, found, missing, textRuns: runs, pages: doc.numPages };
  } finally { doc.destroy(); }
}
