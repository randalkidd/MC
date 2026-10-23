// Free site-plan reader: runs entirely in the browser with pdf.js. It reads the PDF's own text (plans exported from
// CAD or Word/Excel have real text; scans don't) and pulls out labeled values (APN, owner, address, lot size, zoning,
// scale, area table, coverage, legal description) plus the residence setbacks from the dimension text drawn around
// the house. It returns the same shape as the Claude reader, so the rest of the page treats both the same. It never
// marks an item deficient just because it couldn't find it.
import { loadPdfjs } from './planviewer.js?v=16c6e229';
import { CHECKLISTS } from './checklists.js?v=16c6e229';

const PDFJS = './js/vendor/pdfjs-3.2.146/';
const U = (s) => String(s ?? '').toUpperCase().replace(/\s+/g, ' ').trim();

// Text runs → lines (runs sharing a baseline and direction). Each line: text, page, box (page fractions),
// centre (cx, cy in page points, y down), font size, direction.
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
      runs.push({ s: it.str, fs, ang, along: e * ux + f * uy, across: -e * uy + f * ux, end: e * ux + f * uy + w, px: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
    }
    runs.sort((r1, r2) => r1.ang - r2.ang || r2.across - r1.across || r1.along - r2.along);
    const lines = [];
    for (const r of runs) {
      // join onto an open line with the same direction and baseline whose end is just before this run
      const L = lines.slice(-6).reverse().find(x => x.ang === r.ang && Math.abs(x.across - r.across) < r.fs * 0.45 && r.along - x.end < r.fs * 1.6 && r.along >= x.start - r.fs);
      if (L) { L.s += (r.along - L.end > r.fs * 0.15 ? ' ' : '') + r.s; L.end = Math.max(L.end, r.end); L.px = [Math.min(L.px[0], r.px[0]), Math.min(L.px[1], r.px[1]), Math.max(L.px[2], r.px[2]), Math.max(L.px[3], r.px[3])]; }
      else lines.push({ s: r.s, ang: r.ang, across: r.across, start: r.along, end: r.end, fs: r.fs, px: r.px.slice(), page: p });
    }
    for (const l of lines) {
      l.u = U(l.s); l.box = [l.px[0] / vp.width, l.px[1] / vp.height, l.px[2] / vp.width, l.px[3] / vp.height];
      l.cx = (l.px[0] + l.px[2]) / 2; l.cy = (l.px[1] + l.px[3]) / 2; l.vert = Math.abs(Math.abs(l.ang) - 90) < 20;
    }
    pages.push({ lines, runs: runs.length, w: vp.width, h: vp.height });
  }
  return pages;
}

const DIM = String.raw`(\d{1,4}(?:\.\d+)?)\s*(?:'|FT\b|FEET\b)\s*(?:-?\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|IN\b))?`;
const ft = (m, i = 1) => (m ? +(+m[i] + (m[i + 1] ? +m[i + 1] / 12 : 0)).toFixed(2) : null);
const num = (s) => +String(s).replace(/,/g, '');
const STD_SCALE = (v) => [10, 20, 30, 40, 50, 60, 80, 100, 200].includes(+v);
const AREA = String.raw`([\d,]+(?:\.\d+)?)\s*(S\.?\s?F\.?|SQ\.?\s*FT\.?|SQFT|SQUARE\s+FEET|AC\.?|ACRES?)\b`;

export async function freeReadSitePlan(file, type) {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, standardFontDataUrl: `${PDFJS}standard_fonts/` }).promise;
  try {
    const pages = await readLines(doc);
    const lines = pages.flatMap(p => p.lines);
    const runs = pages.reduce((t, p) => t + p.runs, 0);
    const ann = []; const uncertain = [];
    const mark = (ref, l, note) => { if (l && !ann.some(a => a.ref === ref && a.page === l.page && a.box === l.box)) ann.push({ ref, page: l.page, box: l.box, note: note || '' }); };
    const same = (a, b) => a.page === b.page && a.ang === b.ang;
    const below = (l, n = 1) => { // the next n lines under l, left-aligned (title-block style "LABEL:" then value lines)
      const out = []; let cur = l;
      for (let i = 0; i < n; i++) {
        const c = lines.filter(x => same(x, cur) && x !== cur && x.across < cur.across && cur.across - x.across < cur.fs * 2.6 && Math.abs(x.start - l.start) < l.fs * 4);
        const nx = c.sort((a, b) => b.across - a.across)[0]; if (!nx) break; out.push(nx); cur = nx;
      }
      return out; };
    const HEADING = /:\s*$|^(LEGAL DESCRIPTION|BENCHMARK|ENGINEER|SURVEYOR|SURVEY DATE|OWNER|SITE ADDRESS|ZONING|LOT SIZE|LOT COVERAGE|PARCEL|APN|NOTES?|GENERAL NOTES|VICINITY MAP|LEGEND|DATE|REVISIONS?)\b/;
    const rightOf = (l) => lines.filter(x => same(x, l) && x !== l && !HEADING.test(x.u) && Math.abs(x.across - l.across) < l.fs * 0.6 && x.start > l.end - l.fs && x.start - l.end < l.fs * 10).sort((a, b) => a.start - b.start)[0] || null;
    // "LABEL: value" on one line, or the value to the right, or on the line(s) below.
    const labeled = (labelRx, valueRx, { lines: nBelow = 2 } = {}) => {
      for (const l of lines) {
        const lm = l.u.match(labelRx); if (!lm) continue;
        const rest = l.u.slice(lm.index + lm[0].length).trim();
        if (rest) { const m = valueRx ? rest.match(valueRx) : [rest, rest]; if (m) return { m, l, v: rest, label: l }; if (rest.length > 3) continue; }
        const r = rightOf(l); if (r) { const m = valueRx ? r.u.match(valueRx) : [r.u, r.u]; if (m) return { m, l: r, v: r.u, label: l }; }
        const bl = below(l, nBelow);
        for (let k = 0; k < bl.length; k++) { const txt = bl.slice(0, k + 1).map(x => x.u).join(', '); const m = valueRx ? bl[k].u.match(valueRx) : [txt, txt]; if (m) return { m, l: bl[k], v: valueRx ? bl[k].u : txt, label: l, block: bl.slice(0, k + 1) }; }
      }
      return null; };
    const first = (rx, pref) => { let hit = null; for (const l of lines) { const m = l.u.match(rx); if (m) { if (!pref || pref.test(l.u)) return { l, m }; hit = hit || { l, m }; } } return hit; };
    const all = lines.map(l => l.u).join('\n');
    const plan = {}, parcel = {}, primary = {}, coverage = {};

    // ---- title ----
    const title = lines.filter(l => l.page === 1 && /SITE PLAN|PLOT PLAN|GRADING|DRAINAGE|PLAN\b/.test(l.u) && l.u.length < 70).sort((a, b) => b.fs - a.fs)[0];
    if (title) { const nxt = lines.filter(x => same(x, title) && x !== title && x.across < title.across && title.across - x.across < title.fs * 3.5 && Math.abs(x.cx - title.cx) < title.fs * 6).sort((a, b) => b.across - a.across).slice(0, 2);
      plan.title = [title.s, ...nxt.map(x => x.s)].join(' ').replace(/\s+/g, ' ').trim(); }
    const rev = first(/\bREV(?:ISION)?\.?\s*(?:NO\.?|#)?\s*[:\-]?\s*([A-Z0-9]{1,3})\b(?!\w)/); if (rev && !/REVISION\(S\)/.test(rev.l.u)) plan.revision = rev.m[1];
    const dt = labeled(/^(?:DATE|PLAN DATE|SURVEY DATE)\s*[:\-]?\s*/, /(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})/); if (dt) plan.date = dt.m[1];
    plan.sheets = doc.numPages;

    // ---- APN ----
    const APN = /(\d{3})\s*[-.\s]\s*(\d{2})\s*[-.\s]\s*(\d{3})([A-Z])?\b|\b(\d{3})(\d{2})(\d{3})([A-Z])?\b/;
    const apn = labeled(/\b(?:APN|A\.P\.N\.?|ASSESSOR'?S?\s+PARCEL(?:\s+(?:NO\.?|NUMBER))?|TAX\s+PARCEL(?:\s+(?:NO\.?|NUMBER))?|PARCEL\s*(?:NO\.?|NUMBER|#)|PARCEL)\s*[#:\-]?\s*/, APN);
    if (apn) { const m = apn.m; parcel.apn = m[1] ? `${m[1]}-${m[2]}-${m[3]}${m[4] || ''}` : `${m[5]}-${m[6]}-${m[7]}${m[8] || ''}`; mark('parcel:apn', apn.label); if (apn.l !== apn.label) mark('parcel:apn', apn.l); }

    // ---- owner ----
    const ow = labeled(/^(?:PROPERTY\s+)?OWNER(?:S|\(S\))?(?:\s+NAME)?(?:\s*\/\s*APPLICANT)?\s*[:\-]?\s*$|^(?:PROPERTY\s+)?OWNER(?:S|\(S\))?(?:\s+NAME)?\s*[:\-]\s*/, /^(?!\d)([A-Z][A-Z .,'&\/-]{2,80})$/, { lines: 1 });
    if (ow) { parcel.owner_name = ow.m[1].split(/\s{2,}|\s+(?:PHONE|TEL|PH|EMAIL|APN|ADDRESS)\b/)[0].trim(); mark('parcel:owner_name', ow.l); }

    // ---- site address ----
    const STREET = String.raw`(\d{2,6}\s+(?:[NSEW]\.?\s+)?[A-Z0-9 .']+?\s(?:ST|STREET|AVE|AVENUE|RD|ROAD|DR|DRIVE|LN|LANE|WAY|BLVD|CT|COURT|PL|PLACE|TRL|TRAIL|CIR|CIRCLE|PKWY|HWY|LOOP|PATH|RUN)\b\.?(?:,?\s*[A-Z][A-Z .]*?(?:,?\s*AZ\b\.?|(?=\s+\d{5})|$))?(?:\s+\d{5}(?:-\d{4})?)?)`;
    const ad = labeled(/^(?:SITE|PROPERTY|PROJECT|JOB)\s+(?:ADDRESS|LOCATION)\s*[:\-]?\s*/, new RegExp('^' + STREET + '|^(\\d{2,6}\\s+[NSEW]?\\.?\\s*[A-Z0-9 .]+)$'), { lines: 1 });
    if (ad) {
      let v = (ad.m[1] || ad.m[2] || '').trim();
      const city = below(ad.l, 1)[0]; if (city && /^[A-Z][A-Z .]+,?\s*AZ\b/.test(city.u) && !/AZ\b/.test(v)) { v += `, ${city.u}`; mark('parcel:site_address', city); }
      parcel.site_address = v; mark('parcel:site_address', ad.l);
    } else { const a2 = first(new RegExp('^' + STREET)); if (a2) { parcel.site_address = a2.m[1].trim(); mark('parcel:site_address', a2.l); } }

    // ---- lot size / area ----
    const la = labeled(/^(?:NET\s+|GROSS\s+|TOTAL\s+)?(?:LOT|PARCEL|SITE|PROPERTY)\s+(?:AREA|SIZE)(?:\s*\([^)]*\))?\s*[:=\-]?\s*/, new RegExp(AREA));
    if (la) {
      const v = num(la.m[1]); const ac = /^AC/.test(la.m[2]);
      parcel.lot_area_sf = ac ? Math.round(v * 43560) : v;
      const acm = la.v.match(/([\d.]+)\s*AC/); if (ac) parcel.lot_area_acres = v; else if (acm) parcel.lot_area_acres = +acm[1];
      mark('parcel:lot_area_sf', la.label); if (la.l !== la.label) mark('parcel:lot_area_sf', la.l);
    }

    // ---- zoning ----
    const zn = labeled(/^(?:EXISTING\s+)?(?:ZONING|ZONED)(?:\s+DISTRICT)?\s*[:\-]?\s*/, /(RURAL\s*\(\s*R?U?\s*-?\s*\d+\s*\)|RURAL[- ]?\d+|RU-?\d+|R1-\d+|R-[2-5]|R-?43|C-[123OS]|IND-[123]|[A-Z]{1,4}-\d{1,3}[A-Z]*)/, { lines: 1 });
    if (zn) { parcel.zoning_shown = zn.m[1].replace(/RURAL\s*\(\s*R?U?\s*-?\s*(\d+)\s*\)/, 'RU-$1').replace(/^RURAL[- ]?/, 'RU-'); mark('parcel:zoning_shown', zn.label); if (zn.l !== zn.label) mark('parcel:zoning_shown', zn.l); }

    // ---- legal description / lot / recording ----
    const lg = labeled(/^LEGAL\s+DESCRIPTION\s*[:\-]?\s*/, null, { lines: 4 });
    if (lg) { parcel.legal_description = (lg.block ? lg.block.map(x => x.u).join(' ') : lg.v).slice(0, 400); mark('parcel:legal_description', lg.label); (lg.block || []).forEach(x => mark('parcel:legal_description', x)); }
    const legal = parcel.legal_description || '';
    const lotm = legal.match(/\bLOT\s+(\d+[A-Z]?)\b/) || all.match(/\bLOT\s+(\d+[A-Z]?)\s*(?:,|OF)\b/); if (lotm) parcel.lot = lotm[1];
    const bk = legal.match(/BOOK\s+(\d+)\s+OF\s+MAPS,?\s+PAGE\s+(\d+)/) || legal.match(/\bMCR\s*#?\s*(\d+)\s*[-\/]\s*(\d+)/) || all.match(/BOOK\s+(\d+)\s+OF\s+MAPS,?\s+PAGE\s+(\d+)/);
    if (bk) parcel.mcr = `${bk[1]}-${bk[2]}`;
    const sm = legal.match(/\bLOT\s+\d+[A-Z]?\s*,?\s*(?:OF\s+)?(?:BLOCK\s+\w+\s*,?\s*)?(?!ACCORDING|AS\b|OF\b|PER\b|RECORDED)([A-Z][A-Z0-9 '&-]{3,60}?)(?:,|\s+ACCORDING|\s+AS\s+RECORDED|\s+MCR|\s+BOOK|$)/);
    if (sm && !/LOT SPLIT|SURVEY|SECTION|TOWNSHIP/.test(sm[1])) { parcel.subdivision = sm[1].trim(); }
    if (parcel.lot || parcel.mcr) { const l = lines.find(x => /\bLOT\s+\d/.test(x.u) && (x.page === (lg && lg.label.page))) || (lg && lg.label); mark('parcel:subdivision', l); }

    // ---- scale / north / vicinity ----
    // Scale: "SCALE: 1"=20'", "1 inch = 20 ft.", "H: 1"= 20'", or the same split across text pieces ("1 inch =" "20" "ft.").
    const SCRX = /(1\s*(?:"|''|IN(?:CH)?\.?)\s*=\s*(\d+)\s*(?:'|FT\.?|FEET))/;
    let sc = first(/\bSCALE\s*[:\-]?\s*(1\s*"\s*=\s*(\d+)\s*'(?:\s*-\s*0")?|\d+\/\d+"\s*=\s*1'(?:\s*-\s*0")?|N\.?T\.?S\.?|NOT TO SCALE)/) || first(SCRX);
    if (!sc) for (const l of lines) { // join a line with its right-hand neighbours on the same baseline
      if (!/^1\s*(?:"|IN(?:CH)?\.?)?\s*=?$|^1\s*(?:"|IN(?:CH)?)/.test(l.u)) continue;
      const row = [l, ...lines.filter(x => same(x, l) && x !== l && Math.abs(x.across - l.across) < l.fs * 0.6 && x.start > l.start && x.start - l.end < l.fs * 6).sort((a, b) => a.start - b.start).slice(0, 4)];
      const m = row.map(x => x.u).join(' ').match(SCRX); if (m) { sc = { l, m }; break; }
    }
    if (sc) { plan.scale_stated = sc.m[1].replace(/\s+/g, ' '); plan.scale_is_standard = sc.m[2] ? STD_SCALE(sc.m[2]) : /\/\d+"\s*=\s*1'/.test(sc.m[1]) ? true : /N\.?T\.?S|NOT TO/.test(sc.m[1]) ? false : null; mark('plan:scale', sc.l); }
    const gs = (() => { for (const l of lines) { const c = l.u.replace(/[\s.]/g, ''); if (/GRAPHICSCALE|SCALEBAR|^\(?INFEET\)?$/.test(c)) return { l }; } return null; })();
    plan.scale_bar = gs ? true : null; if (gs) mark('plan:scale', gs.l);
    const nv = first(/^(?:TRUE\s+)?NORTH$|^N$/); plan.north_arrow = nv ? true : null; if (nv) mark('plan:north_arrow', nv.l);
    const vm = first(/VICINITY MAP|LOCATION MAP/); plan.vicinity_map = vm ? true : null; if (vm) mark('plan:vicinity_map', vm.l);
    const inval = lines.filter(l => /\bFUTURE\b|NOT FOR CONSTRUCTION|FOR REFERENCE ONLY|PRELIMINARY - NOT/.test(l.u) && !/^\d+\.\s/.test(l.u));
    plan.invalidating_notes = [...new Set(inval.map(l => l.s.trim().slice(0, 120)))].slice(0, 10);

    // ---- water / wastewater ----
    const wa = labeled(/^WATER(?:\s+(?:SOURCE|SUPPLY|PROVIDER|SERVICE|COMPANY))?\s*[:\-]\s*/, null, { lines: 1 }) || (() => { const f = first(/\b(PRIVATE WELL|SHARED WELL|DOMESTIC WELL|HAULED WATER|EPCOR|GLOBAL WATER|JOHNSON UTILITIES|ARIZONA WATER|CITY OF [A-Z ]+ WATER)\b/); return f && { v: f.m[1], l: f.l }; })();
    if (wa) { parcel.water_source = String(wa.v).slice(0, 80); mark('checklist:r-water', wa.l); }
    parcel.wastewater = /\bSEPTIC\b|\bLEACH|DISPOSAL FIELD|\bPRIMARY\b.*\bRESERVE\b|^RESERVE$/m.test(all) ? 'Septic' : /\bSEWER\b/.test(all) ? 'Sewer' : null;

    // ---- area table → structures ----
    const structures = [];
    for (const l of lines) {
      if (/\b(LOT|SITE|PARCEL|TOTAL|NET|GROSS)\b.*(AREA|COVERAGE|SIZE|DISTURBANCE)|COVERAGE|DISTURBANCE|TOTAL\b|\//.test(l.u)) continue;
      const m = l.u.match(new RegExp(String.raw`^(.*?\b(LIVABLE|LIVING|HOUSE|RESIDENCE|DWELLING|HOME|MFH|MANUFACTURED|MOBILE|GARAGE|CARPORT|PATIO|PORCH|RAMADA|SHED|CASITA|GUEST|ADU|BARN|STORAGE|SHADE|WORKSHOP|SHOP|STABLE|ARENA|ACCESSORY|ADDITION|POOL HOUSE)\b[A-Z \(\)\/\-.#\d]*?)\s*[:=\-]?\s*([\d,]{2,7}(?:\.\d+)?)\s*(?:S\.?\s?F\.?|SQ\.?\s*FT\.?|SQFT|SQUARE FEET)\b`));
      if (!m) continue;
      const name = m[1].replace(/[\s\-:]+$/, '').replace(/\s+/g, ' ').trim(); const w = m[2];
      const kind = /CASITA|GUEST|ADU/.test(w) && !/ATTACHED/.test(l.u) ? 'adu' : /SHED|BARN|STORAGE|SHADE|WORKSHOP|SHOP|STABLE|ARENA|ACCESSORY|DETACHED|POOL HOUSE/.test(l.u) ? 'accessory' : 'primary';
      structures.push({ name: name.charAt(0) + name.slice(1).toLowerCase(), kind, status: /\bEXIST/.test(l.u) ? 'existing' : /\bNEW|PROPOSED/.test(l.u) ? 'new' : 'unknown', sqft: num(m[3]), sqft_source: 'table', cover: /LATTICE|SHADE/.test(l.u) ? 'open' : 'solid', _line: l });
    }
    structures.forEach((s, i) => { mark(`structure:${i}:sqft`, s._line); mark('checklist:r-cov', s._line); delete s._line; });

    // ---- coverage ----
    const cv = labeled(/^(?:LOT\s+|SITE\s+|BUILDING\s+)?COVERAGE\b[^:%\d]*[:=\-]?\s*/, /([\d.]+)\s*%/, { lines: 1 });
    if (cv) { coverage.lot_coverage_pct_shown = +cv.m[1]; mark('coverage', cv.label); mark('checklist:r-cov', cv.label); }
    const tc = first(/\bTOTAL\s+(?:COVERED|ROOF|UNDER ROOF|BUILDING|LOT COVERAGE)[A-Z ]*\s*[:=\-]?\s*([\d,]{3,7})\s*(?:S\.?\s?F|SQ)/) || first(/^([\d,]{3,7})\s*(?:SQFT|SF|SQ\.?\s*FT\.?)\s*\/\s*[\d,]{3,9}\s*(?:SQFT|SF|SQ)/);
    if (tc) { coverage.total_covered_sf_shown = num(tc.m[1]); mark('coverage', tc.l); }

    // ---- setbacks / height written as labels ----
    const SB = { front: /\bFRONT\b/, rear: /\bREAR\b|\bBACK\b/, side_street: /STREET\s*SIDE|SIDE\s*STREET|CORNER SIDE/, side_a: /\b(?:INTERIOR\s+)?SIDE\b/ };
    let labeledSetbacks = false;
    for (const [k, rx] of Object.entries(SB)) {
      const hits = lines.filter(l => rx.test(l.u) && /SETBACK|S\/B|YARD|B\.?S\.?L/.test(l.u) && !/REQUIRED|REQ'?D|MIN(IMUM)?\b|ALLOWED|MAX/.test(l.u) && new RegExp(DIM).test(l.u) && !(k === 'side_a' && /STREET/.test(l.u)));
      const vals = hits.map(l => ({ l, v: ft(l.u.match(new RegExp(DIM))) })).filter(x => x.v != null);
      if (!vals.length) continue;
      labeledSetbacks = true;
      if (k === 'side_a') { primary.side_a = vals[0].v; mark('primary:side_a', vals[0].l); if (vals[1]) { primary.side_b = vals[1].v; mark('primary:side_b', vals[1].l); } }
      else { primary[k] = vals[0].v; mark(`primary:${k}`, vals[0].l); }
    }
    if (labeledSetbacks) uncertain.push('Setbacks were taken from text labels on the plan (e.g. "FRONT SETBACK 25\'") — confirm each is the dimension from the residence to the property line, not the required minimum.');

    // ---- setbacks from the dimension text drawn around the residence ----
    if (!labeledSetbacks) {
      const g = inferSetbacks(pages);
      if (g) {
        for (const [k, x] of Object.entries(g.vals)) { primary[k] = x.v; mark(`primary:${k}`, x.l, 'dimension text next to the residence'); }
        mark('structure:0', g.anchor);
        uncertain.push(`Setbacks were inferred from the dimension text drawn around the residence ("${g.anchor.s.trim()}", sheet ${g.anchor.page}): front = the side toward ${g.frontWhy}. Confirm each dimension runs from the residence to the property line and that front/rear/side are assigned correctly.`);
      }
    }
    const ht = first(new RegExp(String.raw`\b(?:BUILDING\s+|MAX\.?\s+|OVERALL\s+)?HEIGHT\s*[:=\-]?\s*(?:PROVIDED|PROPOSED)?\s*[:=\-]?\s*` + DIM));
    if (ht && !/REQUIRED|ALLOWED|MAX(IMUM)? ALLOWED/.test(ht.l.u)) { primary.height = ft(ht.m); mark('primary:height', ht.l); }

    // ---- easements / streets / wells / adjacent ----
    const easeL = lines.filter(l => /EASEMENT|\bP\.?U\.?E\b|\bV\.?N\.?A\.?E\b/.test(l.u) && !/^\d+\.\s/.test(l.u));
    const easements = easeL.slice(0, 15).map(l => { const w = l.u.match(new RegExp(DIM)); const rec = l.u.match(/(?:MCR|DOC(?:UMENT)?\.?\s*(?:NO\.?|#)?|BK\.?\s*\d+\s*,?\s*PG\.?)\s*[:#]?\s*([\d\-\/ ]{4,})/) || l.u.match(/BK\.?\s*(\d+)\s*,?\s*PG\.?\s*(\d+)/); return { type: l.s.trim().slice(0, 80), width: w ? `${ft(w)} ft` : null, recording: rec ? rec.slice(1).filter(Boolean).join('/').trim() : null, location: null }; });
    const streetL = lines.filter(l => (/\bR\.?O\.?W\.?\b|RIGHT[- ]OF[- ]WAY|INGRESS|EGRESS|ACCESS EASEMENT|\bD\/W\b|DRIVEWAY/.test(l.u) || /^[A-Z0-9 .]+\s(?:ST|STREET|AVE|AVENUE|RD|ROAD|DR|DRIVE|LN|LANE|WAY|BLVD|TRL|PKWY|HWY)\.?$/.test(l.u)) && !/^\d+\.\s/.test(l.u));
    const streets = streetL.slice(0, 10).map(l => { const w = l.u.match(new RegExp(DIM)); return { name: l.s.trim().slice(0, 80), row_width: w ? `${ft(w)} ft` : null, jurisdiction: /MCDOT|MARICOPA COUNTY/.test(l.u) ? 'MCDOT' : /PRIVATE/.test(l.u) ? 'Private' : null }; });
    const adjL = lines.filter(l => /ADJACENT|ADJ\.|NEIGHBOR/.test(l.u) || /^(VACANT|RESIDENCE|RESIDENTIAL|COMMERCIAL|AGRICULTURAL|UNDEVELOPED)$/.test(l.u));
    const adjacent_uses = [...new Set(adjL.map(l => { const apnNear = lines.find(x => same(x, l) && x !== l && /^\d{3}-\d{2}-\d{3}/.test(x.u) && Math.hypot(x.cx - l.cx, x.cy - l.cy) < l.fs * 4); return `${apnNear ? `${apnNear.u}: ` : ''}${l.s.trim()}`; }))].slice(0, 8);
    const wellL = lines.filter(l => /\bWELL\b/.test(l.u) && !/^\d+\.\s/.test(l.u));

    // ---- checklist (ok / verify only; deficient only when something wrong is actually shown) ----
    const ids = new Set((CHECKLISTS[type] || CHECKLISTS.residential).items.map(i => i[0]));
    const checklist = []; const ck = (id, status, shows, correction) => ids.has(id) && checklist.push({ id, status, shows, ...(correction ? { correction } : {}) });
    if (sc) ck('c-scale', plan.scale_is_standard === false ? 'deficient' : plan.scale_is_standard ? 'ok' : 'verify', `Scale ${plan.scale_stated}${plan.scale_bar ? ' with graphic scale' : ''}`, plan.scale_is_standard === false ? 'Use a standard engineer/architect scale (1"=10\', 20\', 30\'…) with a scale bar.' : null);
    else ck('c-scale', plan.scale_bar ? 'ok' : 'verify', plan.scale_bar ? 'Graphic scale shown (written ratio not found — confirm it is a standard engineer scale)' : 'Scale not found in the PDF text — check the drawing for a graphic scale');
    if (sc) mark('checklist:c-scale', sc.l); if (gs) mark('checklist:c-scale', gs.l);
    ck('c-north', plan.vicinity_map && plan.north_arrow ? 'ok' : 'verify', `${plan.north_arrow ? 'North arrow label found' : 'North arrow not found in text (it may be a graphic — look for it)'}; ${plan.vicinity_map ? 'vicinity map found' : 'vicinity map not found in text'}`);
    if (vm) mark('checklist:c-north', vm.l); if (nv) mark('checklist:c-north', nv.l);
    const have = [parcel.apn && 'APN', parcel.site_address && 'address', parcel.owner_name && 'owner'].filter(Boolean);
    ck('c-apn', have.length === 3 ? 'ok' : 'verify', have.length ? `Found: ${have.join(', ')}${have.length < 3 ? `; not found: ${['APN', 'address', 'owner'].filter(x => !have.includes(x)).join(', ')}` : ''}` : 'APN, address and owner not found in the PDF text');
    ann.filter(a => /^parcel:(apn|owner_name|site_address)$/.test(a.ref)).forEach(a => ann.push({ ...a, ref: 'checklist:c-apn' }));
    if (plan.invalidating_notes.length) { ck('c-future', 'deficient', plan.invalidating_notes.join('; '), 'Remove future buildings and invalidating notes ("future", "not for construction").'); inval.slice(0, 6).forEach(l => mark('checklist:c-future', l)); }
    else ck('c-future', 'verify', 'No "future"/"not for construction" text found — check the drawing');
    if (easements.length) { ck('c-ease', 'verify', `${easements.length} easement label(s): ${easements.map(e => e.type).slice(0, 3).join('; ')}`); easeL.slice(0, 8).forEach(l => mark('checklist:c-ease', l)); }
    if (streets.length) { ck('c-row', 'verify', `Street/access labels: ${streets.map(s => s.name).slice(0, 4).join('; ')} — confirm the street is named, ROW dimensioned and jurisdiction noted`); streetL.slice(0, 6).forEach(l => mark('checklist:c-row', l)); }
    if (adjL.length) { ck('c-adj', adjacent_uses.length >= 3 ? 'ok' : 'verify', adjacent_uses.join('; ')); adjL.slice(0, 6).forEach(l => mark('checklist:c-adj', l)); }
    if (wellL.length) { ck('c-wells', 'verify', 'Well mentioned on the plan — check distances'); wellL.slice(0, 4).forEach(l => mark('checklist:c-wells', l)); }
    if (structures.length || coverage.lot_coverage_pct_shown != null) ck('r-cov', structures.length && coverage.lot_coverage_pct_shown != null ? 'ok' : 'verify', `${structures.length ? `Area table: ${structures.map(s => `${s.name} ${s.sqft.toLocaleString()} sf`).join(', ')}` : 'No area table found'}${coverage.lot_coverage_pct_shown != null ? `; coverage ${coverage.lot_coverage_pct_shown}%` : '; coverage % not found'}`);
    if (parcel.water_source) ck('r-water', 'ok', `Water: ${parcel.water_source}`);
    if (parcel.wastewater === 'Septic') { ck('r-septic', 'verify', 'Septic shown — check tank/field locations and setbacks'); lines.filter(l => /\bSEPTIC\b|^PRIMARY$|^RESERVE$|LEACH|DISPOSAL FIELD/.test(l.u)).slice(0, 4).forEach(l => mark('checklist:r-septic', l)); }
    const fl = lines.filter(l => /FEMA|FLOOD\s*(ZONE|PLAIN)|FLOODWAY|ZONE A[EOH]?\b|ZONE X\b/.test(l.u));
    if (fl.length) { const fw = /FLOODWAY/.test(fl.map(l => l.u).join(' ')); ck('r-flood', 'verify', `Floodplain labels: ${[...new Set(fl.map(l => l.s.trim()))].slice(0, 4).join('; ')}${fw ? ' — floodway on the parcel: confirm nothing is built in it' : ''}`); fl.slice(0, 6).forEach(l => mark('checklist:r-flood', l)); }
    if (/PATENT EASEMENT/.test(all)) { ck('r-patent', 'verify', 'Patent easement on the plan — setbacks must be measured from the easement line'); lines.filter(l => /PATENT EASEMENT/.test(l.u)).slice(0, 3).forEach(l => mark('checklist:r-patent', l)); }

    // ---- quality: did the free reader get enough to be useful? ----
    const keys = { APN: !!parcel.apn, owner: !!parcel.owner_name, address: !!parcel.site_address, 'lot size': parcel.lot_area_sf != null, scale: !!plan.scale_stated || !!plan.scale_bar, 'area table': structures.length > 0, setbacks: Object.keys(primary).some(k => k !== 'height') };
    const found = Object.entries(keys).filter(([, v]) => v).map(([k]) => k);
    const missing = Object.entries(keys).filter(([, v]) => !v).map(([k]) => k);
    const quality = !runs ? 'none' : found.length >= 4 ? 'good' : found.length >= 2 ? 'partial' : 'poor';
    if (missing.includes('setbacks')) uncertain.push('Setback dimensions to the property lines were not found as text near the residence. Measure them on the plan or use In-Depth Review.');
    const summary = !runs ? 'This PDF has no selectable text (scanned or flattened). The free reader can\'t read it.'
      : `Free text reader: found ${found.join(', ') || 'nothing useful'}${missing.length ? `; not found: ${missing.join(', ')}` : ''}.`;
    return { result: { plan, parcel, primary, structures, coverage, easements, streets, adjacent_uses, checklist, other_findings: [], uncertain, annotations: ann, summary }, quality, found, missing, textRuns: runs, pages: doc.numPages };
  } finally { doc.destroy(); }
}

// Residence setbacks from the dimension strings drawn around the house: find the residence label, then the farthest
// dimension text in each direction whose orientation matches (vertical text above/below, horizontal text left/right).
// Front = the side facing the driveway / access easement / street; rear = opposite; the other two are sides.
const DIMONLY = /^±?\s*(\d{1,4}(?:\.\d{1,2})?)\s*'(?:\s*-?\s*(\d{1,2}(?:\.\d+)?)\s*")?\s*±?$/;
function inferSetbacks(pages) {
  let best = null;
  for (const pg of pages) {
    const dims = pg.lines.filter(l => DIMONLY.test(l.u)).map(l => { const m = l.u.match(DIMONLY); return { l, v: +(+m[1] + (m[2] ? +m[2] / 12 : 0)).toFixed(2) }; }).filter(d => d.v >= 1 && d.v <= 2000);
    if (dims.length < 2) continue;
    const anchors = pg.lines.filter(l => /\bLIVABLE\b|\b(NEW|PROPOSED|\(N\))\s+(RESIDENCE|HOME|HOUSE|SFR|DWELLING|MFH)\b|^(RESIDENCE|HOUSE|SFR|HOME|DWELLING|MFH|MANUFACTURED HOME|MOBILE HOME|PROPOSED RESIDENCE)\b/.test(l.u) && !/\d{3}-\d{2}-\d{3}|VACANT|SQFT|S\.F\.|SQ\.? ?FT/.test(l.u));
    const R = Math.hypot(pg.w, pg.h) * 0.3;
    for (const a of anchors) {
      const near = dims.filter(d => Math.hypot(d.l.cx - a.cx, d.l.cy - a.cy) < R);
      if (!best || near.length > best.near.length) best = { a, near, pg };
    }
  }
  if (!best || best.near.length < 2) return null;
  const { a, near, pg } = best;
  const pick = (dir) => {
    const c = near.filter(({ l }) => {
      const dx = l.cx - a.cx, dy = l.cy - a.cy;
      if (dir === 'up') return l.vert && dy < -a.fs * 1.5 && Math.abs(dx) < Math.max(-dy * 0.7, a.fs * 6);
      if (dir === 'down') return l.vert && dy > a.fs * 1.5 && Math.abs(dx) < Math.max(dy * 0.7, a.fs * 6);
      if (dir === 'left') return !l.vert && dx < -a.fs * 2 && Math.abs(dy) < Math.max(-dx * 0.5, a.fs * 4);
      return !l.vert && dx > a.fs * 2 && Math.abs(dy) < Math.max(dx * 0.5, a.fs * 4);
    });
    return c.sort((p, q) => Math.hypot(q.l.cx - a.cx, q.l.cy - a.cy) - Math.hypot(p.l.cx - a.cx, p.l.cy - a.cy))[0] || null;
  };
  const got = { up: pick('up'), down: pick('down'), left: pick('left'), right: pick('right') };
  if (Object.values(got).filter(Boolean).length < 2) return null;
  // Which way is the front? Toward the nearest driveway / access easement / ROW / street label.
  const acc = pg.lines.filter(l => /INGRESS|EGRESS|ACCESS|DRIVEWAY|\bD\/W\b|R\.?O\.?W|RIGHT[- ]OF[- ]WAY|\b(ST|STREET|AVE|AVENUE|RD|ROAD|LANE|LN|DR|DRIVE)\b\.?$/.test(l.u) && l !== a)
    .map(l => ({ l, d: Math.hypot(l.cx - a.cx, l.cy - a.cy) })).sort((p, q) => p.d - q.d)[0];
  let front = 'down', frontWhy = 'the bottom of the sheet (no driveway/street label found — assumed)';
  if (acc) { const dx = acc.l.cx - a.cx, dy = acc.l.cy - a.cy; front = Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? 'down' : 'up') : (dx > 0 ? 'right' : 'left'); frontWhy = `"${acc.l.s.trim()}"`; }
  const opp = { up: 'down', down: 'up', left: 'right', right: 'left' }[front];
  const sides = front === 'up' || front === 'down' ? ['left', 'right'] : ['up', 'down'];
  const vals = {};
  if (got[front]) vals.front = got[front]; if (got[opp]) vals.rear = got[opp];
  if (got[sides[0]]) vals.side_a = got[sides[0]]; if (got[sides[1]]) vals.side_b = got[sides[1]];
  return { vals, anchor: a, frontWhy };
}
