// Plan viewer: shows the site-plan PDF with Claude's issue/value locations drawn on top. Click an item in the list to
// jump to it on the plan; click a box on the plan to find it in the list. Uses vendored pdf.js (same origin, lazy).
import { CHECKLISTS } from './checklists.js?v=667cf2dd';

const PDFJS = './js/vendor/pdfjs-3.2.146/';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- keep the last PDF so the viewer still works after a reload ----------
const DB = 'mc-siteplan';
const idb = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('pdf'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
export async function savePdf(file) {
  try { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction('pdf', 'readwrite'); t.objectStore('pdf').put({ name: file.name, size: file.size, blob: file }, 'last'); t.oncomplete = res; t.onerror = () => rej(t.error); }); } catch {}
}
export async function loadPdf(name) {
  try { const db = await idb(); const v = await new Promise((res) => { const q = db.transaction('pdf').objectStore('pdf').get('last'); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); return v && (!name || v.name === name) ? v.blob : null; } catch { return null; }
}

let libP = null;
export function loadPdfjs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!libP) libP = new Promise((res, rej) => {
    const s = Object.assign(document.createElement('script'), { src: `${PDFJS}pdf.min.js`, async: true });
    s.onload = () => { if (!window.pdfjsLib) return rej(new Error('PDF viewer failed to load')); window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.js`; res(window.pdfjsLib); };
    s.onerror = () => { libP = null; rej(new Error('PDF viewer failed to load')); };
    document.head.appendChild(s);
  });
  return libP;
}

// ---------- issues & values → list items with their plan locations ----------
const PRIMARY_REF = [[/^Front setback/, 'primary:front'], [/^Rear setback/, 'primary:rear'], [/side A$/, 'primary:side_a'], [/side B$/, 'primary:side_b'], [/^Side-street setback/, 'primary:side_street'], [/^Building height/, 'primary:height'], [/garage plane/i, 'primary:garage_plane'], [/^Lot area$/, 'parcel:lot_area_sf'], [/^Lot coverage$/, 'coverage']];
const COMPARE_REF = { 'APN': ['parcel:apn'], 'Owner name': ['parcel:owner_name'], 'Site address': ['parcel:site_address'], 'Lot area': ['parcel:lot_area_sf'], 'Zoning district': ['parcel:zoning_shown'], 'Subdivision / lot': ['parcel:subdivision', 'parcel:lot', 'parcel:legal_description'] };
const LABEL = { 'parcel:apn': 'APN', 'parcel:owner_name': 'Owner name', 'parcel:site_address': 'Site address', 'parcel:lot_area_sf': 'Lot area', 'parcel:zoning_shown': 'Zoning shown', 'parcel:subdivision': 'Subdivision', 'parcel:lot': 'Lot', 'parcel:legal_description': 'Legal description',
  'primary:front': 'Residence front setback', 'primary:rear': 'Residence rear setback', 'primary:side_a': 'Residence side A setback', 'primary:side_b': 'Residence side B setback', 'primary:side_street': 'Residence side-street setback', 'primary:height': 'Residence height', 'primary:garage_plane': 'Garage plane',
  coverage: 'Coverage table / note', 'plan:scale': 'Scale', 'plan:north_arrow': 'North arrow', 'plan:vicinity_map': 'Vicinity map' };

function valueOf(r, ref) {
  const [a, b, c] = ref.split(':');
  const ft = (v) => (v == null ? '' : `${v} ft`);
  if (a === 'parcel') { const v = (r.parcel || {})[b]; return v == null ? '' : b === 'lot_area_sf' ? `${(+v).toLocaleString()} sf` : String(v); }
  if (a === 'primary') return ft((r.primary || {})[b]);
  if (a === 'structure') { const s = (r.structures || [])[+b] || {}; return c ? (c === 'sqft' ? (s.sqft != null ? `${s.sqft} sf` : '') : ft(s[c])) : `${s.sqft != null ? `${s.sqft} sf` : ''}`; }
  if (ref === 'coverage') { const cv = r.coverage || {}; return cv.lot_coverage_pct_shown != null ? `${cv.lot_coverage_pct_shown}%` : ''; }
  if (ref === 'plan:scale') return (r.plan || {}).scale_stated || '';
  return '';
}
function refLabel(r, ref) {
  if (LABEL[ref]) return LABEL[ref];
  const ck = ref.match(/^checklist:(.+)$/); if (ck) { for (const t of Object.values(CHECKLISTS)) { const it = t.items.find(i => i[0] === ck[1]); if (it) return `Checklist: ${it[1]}`; } }
  const m = ref.match(/^structure:(\d+)(?::(\w+))?$/);
  if (m) { const s = (r.structures || [])[+m[1]] || {}; const f = { sqft: 'area', front: 'front setback', rear: 'rear setback', side: 'side setback', street: 'side-street setback', height: 'height' }[m[2]] || 'footprint'; return `${s.name || `Structure ${+m[1] + 1}`} ${f}`; }
  return ref;
}

export function buildItems(ai, review, F) {
  const r = ai.result || {};
  const ann = (r.annotations || []).map(normAnn).filter(Boolean);
  const used = new Set();
  const find = (refs, prefix = false) => ann.filter(a => refs.some(x => a.ref === x || (prefix && a.ref.startsWith(`${x}:`)))).map(a => (used.add(a), a));
  const items = [];
  const add = (group, sev, title, detail, boxes) => items.push({ group, sev, title, detail, boxes });
  // 1. plan vs. records
  for (const [label, plan, rec, st, note] of ai.compare || []) if (st !== 'ok') add('Plan vs. records', st, `${label}: plan ≠ record`, `Plan: ${plan} · Record: ${rec}${note ? ` — ${note}` : ''}`, find(COMPARE_REF[label] || []));
  // 2. measured checks that fail (setbacks, height, coverage, accessory)
  for (const f of F || []) {
    if (f.status === 'ok') continue;
    let refs = []; const pr = PRIMARY_REF.find(([rx]) => rx.test(f.item)); let prefix = false;
    if (pr) { refs = [pr[1]]; if (pr[1] === 'coverage') { refs.push('structure'); prefix = true; } }
    const nm = (f.loc.match(/—\s*(.+)$/) || [])[1];
    const j = nm ? review.structures.findIndex(x => x.name === nm) : -1;
    if (!pr && j >= 0) { const k = /rear/.test(f.item) ? 'rear' : /side-interior/.test(f.item) ? 'side' : /side-street/.test(f.item) ? 'street' : /front/.test(f.item) ? 'front' : /height/.test(f.item) ? 'height' : ''; refs = k ? [`structure:${j}:${k}`, `structure:${j}`] : [`structure:${j}`]; prefix = !k; }
    add('Setbacks, height & coverage', f.status, f.item, `Plan: ${f.shows} · Required: ${f.req}${f.fix && f.fix !== '—' ? ` — ${f.fix}` : ''}`, find(refs, prefix));
  }
  // 3. checklist (current reviewer statuses)
  const labels = Object.fromEntries((CHECKLISTS[review.type]?.items || []).map(i => [i[0], i[1]]));
  for (const [id, c] of Object.entries(review.checks || {})) if (labels[id] && (c.status === 'deficient' || c.status === 'verify')) add('Checklist', c.status, labels[id], [c.note, c.status === 'deficient' && c.fix].filter(Boolean).join(' — '), find([`checklist:${id}`]));
  // 4. other red-lines Claude found
  (r.other_findings || []).forEach((f, i) => f && f.item && add('Other findings', f.status === 'deficient' ? 'deficient' : 'verify', f.item, [f.shows && `Plan: ${f.shows}`, f.required && `Required: ${f.required}`, f.correction].filter(Boolean).join(' · '), find([`finding:${i}`])));
  // 5. hard-to-read values
  (r.uncertain || []).forEach((u, i) => add('Hard to read — verify', 'verify', u, '', find([`uncertain:${i}`])));
  // 6. every other value Claude read, so each can be checked on the plan
  for (const a of ann) if (!used.has(a)) add('Values read from the plan', 'info', refLabel(r, a.ref), [valueOf(r, a.ref), a.note].filter(Boolean).join(' — '), [a]);
  items.forEach((it, i) => (it.n = i + 1));
  return items;
}
function normAnn(a) {
  if (!a || !Array.isArray(a.box) || a.box.length !== 4 || !a.ref) return null;
  let b = a.box.map(Number); if (b.some(isNaN)) return null;
  if (Math.max(...b) > 1.0001) { if (Math.max(...b) <= 100) b = b.map(v => v / 100); else return null; }
  let [x0, y0, x1, y1] = b; if (x1 < x0) [x0, x1] = [x1, x0]; if (y1 < y0) [y0, y1] = [y1, y0];
  const cl = (v) => Math.max(0, Math.min(1, v));
  return { ref: String(a.ref), page: Math.max(1, parseInt(a.page, 10) || 1), box: [cl(x0), cl(y0), cl(x1), cl(y1)], note: a.note || '' };
}

// ---------- fallback: find values by matching the PDF's own text (CAD-exported plans have real text) ----------
const up = (x) => String(x ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
async function pageTexts(doc) {
  const pages = [];
  for (let i = 1; i <= Math.min(doc.numPages, 40); i++) {
    const pg = await doc.getPage(i); const vp = pg.getViewport({ scale: 1 });
    const tc = await pg.getTextContent();
    const runs = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const [a, b, c, d, e, f] = it.transform; const fs = Math.hypot(c, d) || Math.hypot(a, b) || 8;
      const ang = Math.atan2(b, a); const w = it.width || it.str.length * fs * 0.5;
      const ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
      const pts = [[e, f], [e + w * ux, f + w * uy], [e + nx * fs, f + ny * fs], [e + w * ux + nx * fs, f + w * uy + ny * fs]].map(([x, y]) => vp.convertToViewportPoint(x, y));
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); const pad = fs * 0.15;
      runs.push({ s: up(it.str), box: [(Math.min(...xs) - pad) / vp.width, (Math.min(...ys) - pad) / vp.height, (Math.max(...xs) + pad) / vp.width, (Math.max(...ys) + pad) / vp.height] });
    }
    pages.push(runs);
  }
  return pages;
}
function dimPatterns(v) {
  if (v == null || v === '' || isNaN(+v)) return null;
  const ft = Math.floor(+v), inch = Math.round((+v - ft) * 12);
  const alts = inch ? [`${ft}'\\s*-?\\s*${inch}"`, `${(+v).toFixed(1)}'`, `${+v}'`, `${+v}\\s*FT`] : [`${ft}'(?:\\s*-?\\s*0"?)?`, `${ft}\\.0+'`, `${ft}\\s*FT\\b`, `${ft}\\s*FEET`];
  return new RegExp(`(^|[^0-9.])(${alts.join('|')})`, 'i');
}
export async function textLocate(doc, r, have) {
  const pages = await pageTexts(doc);
  const total = pages.reduce((t, p) => t + p.length, 0);
  const out = []; if (!total) return { ann: out, textRuns: 0 };
  const P = r.parcel || {};
  const find = (ref, test, max = 3) => {
    if (have.has(ref)) return;
    const hits = [];
    pages.forEach((runs, i) => runs.forEach(t => { if (test(t.s)) hits.push({ ref, page: i + 1, box: t.box, note: 'found by matching text on the plan' }); }));
    if (hits.length && hits.length <= max) out.push(...hits);
  };
  const apnD = String(P.apn || '').replace(/\D/g, '');
  if (apnD.length >= 8) find('parcel:apn', s => s.replace(/\D/g, '').includes(apnD.slice(0, 8)), 4);
  const owner = up(P.owner_name).replace(/[^A-Z0-9 ]/g, ' ').split(' ').filter(t => t.length >= 3 && !['THE', 'AND', 'LLC', 'TRUST', 'INC'].includes(t));
  if (owner.length) find('parcel:owner_name', s => { const hit = owner.filter(t => s.includes(t)).length; return hit >= Math.min(2, owner.length); }, 4);
  const addr = up(P.site_address).match(/^(\d+)\s+(?:[NSEW]\s+)?([A-Z0-9]+)/);
  if (addr) find('parcel:site_address', s => s.includes(addr[1]) && s.includes(addr[2]), 4);
  if (P.lot_area_sf) { const n = Math.round(P.lot_area_sf), a = n.toLocaleString('en-US'); find('parcel:lot_area_sf', s => s.includes(a) || new RegExp(`(^|\\D)${n}(\\D|$)`).test(s), 4); }
  if (P.zoning_shown) { const z = up(P.zoning_shown); find('parcel:zoning_shown', s => new RegExp(`(^|[^A-Z0-9-])${z.replace(/[-]/g, '\\-')}([^A-Z0-9-]|$)`).test(s), 3); }
  const pr = r.primary || {};
  for (const k of ['front', 'rear', 'side_a', 'side_b', 'side_street', 'height', 'garage_plane']) { const rx = dimPatterns(pr[k]); if (rx) find(`primary:${k}`, s => rx.test(s), 2); }
  (r.structures || []).forEach((x, i) => {
    if (x.sqft) { const n = Math.round(x.sqft), a = n.toLocaleString('en-US'); find(`structure:${i}:sqft`, s => (s.includes(a) || new RegExp(`(^|\\D)${n}(\\D|$)`).test(s)) && /S\.?\s?F|SQ/.test(s) || s === a || s === String(n), 2); }
    for (const k of ['front', 'rear', 'side', 'street', 'height']) { const rx = dimPatterns(x[k]); if (rx) find(`structure:${i}:${k}`, s => rx.test(s), 2); }
  });
  return { ann: out, textRuns: total };
}

// ---------- viewer ----------
const V = { dlg: null, doc: null, page: 1, zoom: 1, items: [], sel: null, showInfo: false, fileName: '', renderTask: null };
function ensureDialog() {
  if (V.dlg) return V.dlg;
  const d = document.createElement('dialog'); d.className = 'pv'; d.id = 'pv';
  d.innerHTML = `<div class="pv-head">
      <b class="pv-title">Plan Viewer</b><span class="sub pv-file"></span>
      <span class="pv-tools">
        <button class="btn sm" data-pv="prev" aria-label="Previous page">‹</button><span class="pv-pg">1 / 1</span><button class="btn sm" data-pv="next" aria-label="Next page">›</button>
        <button class="btn sm" data-pv="out" aria-label="Zoom out">−</button><button class="btn sm" data-pv="fit">Fit</button><button class="btn sm" data-pv="in" aria-label="Zoom in">+</button>
        <label class="rowc sub"><input type="checkbox" data-pv="info"> Show values read</label>
        <button class="btn sm ghost" data-pv="close" aria-label="Close">✕</button>
      </span></div>
    <div class="pv-diag sub" hidden></div><div class="pv-body"><div class="pv-main"><div class="pv-note" hidden></div><div class="pv-scroll"><div class="pv-page"><canvas></canvas><div class="pv-layer"></div></div><p class="pv-msg sub"></p></div></div><aside class="pv-list" aria-label="Issues"></aside></div>`;
  document.body.appendChild(d);
  d.addEventListener('click', (e) => {
    if (e.target.closest('.pv-note-x')) { d.querySelector('.pv-note').hidden = true; return; }
    const b = e.target.closest('[data-pv]'); const box = e.target.closest('.pv-box'); const li = e.target.closest('.pv-item');
    if (b) { const k = b.dataset.pv;
      if (k === 'close') d.close();
      if (k === 'prev' && V.page > 1) { V.page--; render(); }
      if (k === 'next' && V.doc && V.page < V.doc.numPages) { V.page++; render(); }
      if (k === 'in') { V.zoom = Math.min(V.zoom * 1.25, 6); render(); }
      if (k === 'out') { V.zoom = Math.max(V.zoom / 1.25, 0.3); render(); }
      if (k === 'fit') { V.zoom = 1; render(); }
      return; }
    if (box) { select(+box.dataset.n, false); return; }
    if (li) select(+li.dataset.n, true);
  });
  d.querySelector('[data-pv=info]').addEventListener('change', (e) => { V.showInfo = e.target.checked; list(); render(); });
  d.addEventListener('keydown', (e) => { if (e.target.closest('input')) return; if (e.key === 'ArrowRight' || e.key === 'PageDown') d.querySelector('[data-pv=next]').click(); if (e.key === 'ArrowLeft' || e.key === 'PageUp') d.querySelector('[data-pv=prev]').click(); });
  d.addEventListener('close', () => { V.doc && V.doc.destroy(); V.doc = null; document.documentElement.classList.remove('pv-open'); });
  // Scrolling past the bottom of a page goes to the next page; past the top goes to the previous one. Ctrl/⌘ + wheel zooms.
  const sc = d.querySelector('.pv-scroll'); let wheelLock = 0, push = 0;
  sc.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); V.zoom = Math.min(6, Math.max(0.3, V.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); render(); return; }
    if (!V.doc || Date.now() < wheelLock) { if (V.doc && Date.now() < wheelLock) e.preventDefault(); return; }
    const atBottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2, atTop = sc.scrollTop <= 1;
    if (e.deltaY > 0 && atBottom && V.page < V.doc.numPages) { push += e.deltaY; if (push > 120) { e.preventDefault(); push = 0; wheelLock = Date.now() + 500; V.page++; render().then(() => sc.scrollTo({ top: 0 })); } }
    else if (e.deltaY < 0 && atTop && V.page > 1) { push += e.deltaY; if (push < -120) { e.preventDefault(); push = 0; wheelLock = Date.now() + 500; V.page--; render().then(() => sc.scrollTo({ top: sc.scrollHeight })); } }
    else push = 0;
  }, { passive: false });
  window.addEventListener('resize', () => { if (d.open) render(); });
  V.dlg = d; return d;
}
const visible = () => V.items.filter(it => V.showInfo || it.sev !== 'info');
function list() {
  const el = V.dlg.querySelector('.pv-list'); let html = ''; let g = '';
  const its = visible();
  const counts = { deficient: its.filter(i => i.sev === 'deficient').length, verify: its.filter(i => i.sev === 'verify').length };
  html += `<p class="sub pv-sum">${counts.deficient} deficienc${counts.deficient === 1 ? 'y' : 'ies'} · ${counts.verify} to verify${V.showInfo ? ` · ${its.length - counts.deficient - counts.verify} values` : ''}. Click an item to find it on the plan. ${V.engine === 'free' ? 'Boxes are exact positions of the plan text.' : 'Boxes are Claude\'s estimate of the location; boxes from text matching are exact.'}</p>`;
  for (const it of its) {
    if (it.group !== g) { if (g) html += '</ol>'; g = it.group; html += `<h3>${esc(g)}</h3><ol class="pv-ol">`; }
    const where = it.boxes.length ? `p. ${[...new Set(it.boxes.map(b => b.page))].join(', ')}` : 'location not marked';
    html += `<li class="pv-item ${it.sev}${V.sel === it.n ? ' active' : ''}" data-n="${it.n}" tabindex="0"><span class="pv-num">${it.n}</span><div><b>${esc(it.title)}</b>${it.detail ? `<div class="sub">${esc(it.detail)}</div>` : ''}<div class="pv-where">${esc(where)}</div></div></li>`;
  }
  if (g) html += '</ol>'; else html += '<p class="sub">No issues found. Tick “Show values read” to check each value Claude read.</p>';
  el.innerHTML = html;
}
async function render() {
  if (!V.doc) return;
  const d = V.dlg; const pg = await V.doc.getPage(V.page);
  const wrap = d.querySelector('.pv-scroll'); const canvas = d.querySelector('canvas'); const layer = d.querySelector('.pv-layer');
  const base = pg.getViewport({ scale: 1 });
  const fit = Math.max(0.2, (wrap.clientWidth - 24) / base.width);
  const vp = pg.getViewport({ scale: fit * V.zoom });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(vp.width * dpr); canvas.height = Math.floor(vp.height * dpr);
  canvas.style.width = `${Math.floor(vp.width)}px`; canvas.style.height = `${Math.floor(vp.height)}px`;
  const page = d.querySelector('.pv-page'); page.style.width = canvas.style.width; page.style.height = canvas.style.height;
  if (V.renderTask) try { V.renderTask.cancel(); } catch {}
  V.renderTask = pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
  try { await V.renderTask.promise; } catch (e) { if (e && e.name === 'RenderingCancelledException') return; throw e; }
  d.querySelector('.pv-pg').textContent = `${V.page} / ${V.doc.numPages}`;
  layer.innerHTML = visible().flatMap(it => it.boxes.filter(b => b.page === V.page).map(b => {
    const [x0, y0, x1, y1] = b.box;
    return `<button type="button" class="pv-box ${it.sev}${V.sel === it.n ? ' active' : ''}" data-n="${it.n}" title="${esc(`${it.n}. ${it.title}`)}" style="left:${(x0 * 100).toFixed(2)}%;top:${(y0 * 100).toFixed(2)}%;width:${Math.max(0.6, (x1 - x0) * 100).toFixed(2)}%;height:${Math.max(0.6, (y1 - y0) * 100).toFixed(2)}%"><span>${it.n}</span></button>`;
  })).join('');
}
async function select(n, fromList) {
  V.sel = n; const it = V.items.find(i => i.n === n); if (!it) return;
  if (!V.showInfo && it.sev === 'info') { V.showInfo = true; V.dlg.querySelector('[data-pv=info]').checked = true; }
  list();
  // keep the comment in view in the list (clicking a box on the plan brings its comment up)
  const li = V.dlg.querySelector(`.pv-item[data-n="${n}"]`); const aside = V.dlg.querySelector('.pv-list');
  if (li) { const top = li.offsetTop - aside.clientHeight / 2 + li.offsetHeight / 2; if (!fromList || li.offsetTop < aside.scrollTop || li.offsetTop + li.offsetHeight > aside.scrollTop + aside.clientHeight) aside.scrollTo({ top: Math.max(0, top), behavior: 'smooth' }); }
  const b = it.boxes[0];
  if (b && b.page !== V.page) V.page = b.page;
  // zoom in so a small box is easy to see (never zooms out from where the reviewer set it)
  if (b && fromList) { const w = Math.max(0.01, b.box[2] - b.box[0], b.box[3] - b.box[1]); V.zoom = Math.max(V.zoom, Math.min(2.5, Math.max(1, 0.12 / w))); }
  await render();
  const box = V.dlg.querySelector(`.pv-box[data-n="${n}"]`);
  if (box) {
    const sc = V.dlg.querySelector('.pv-scroll'); const pageEl = V.dlg.querySelector('.pv-page');
    const x = pageEl.offsetLeft + box.offsetLeft + box.offsetWidth / 2, y = pageEl.offsetTop + box.offsetTop + box.offsetHeight / 2;
    sc.scrollTo({ left: Math.max(0, x - sc.clientWidth / 2), top: Math.max(0, y - sc.clientHeight / 2), behavior: 'smooth' });
    V.dlg.querySelectorAll('.pv-box.ripple').forEach(x2 => x2.classList.remove('ripple'));
    void box.offsetWidth; box.classList.add('ripple');
  }
  const note = V.dlg.querySelector('.pv-note');
  if (box) note.hidden = true;
  else {
    // Nothing on the plan to point at (missing item, or one that covers the whole submittal): say so and flash the sheet.
    note.innerHTML = `<button type="button" class="pv-note-x" aria-label="Dismiss">✕</button><b>${n}. ${esc(it.title)}</b> — not tied to one spot on this plan${it.sev === 'info' ? '' : ' (it is either missing from the plan or covers the whole submittal)'}. Check it on the sheets yourself${V.engine === 'free' ? ', or use <b>Read with Claude</b> to have it located' : ''}.`;
    note.hidden = false; const pgEl = V.dlg.querySelector('.pv-page'); pgEl.classList.remove('flash'); void pgEl.offsetWidth; pgEl.classList.add('flash');
    V.dlg.querySelector('.pv-scroll').scrollTo({ top: 0, behavior: 'smooth' });
  }
}

export async function openViewer(blob, ai, review, F, fileName) {
  const d = ensureDialog();
  V.engine = ai.engine || 'claude'; V.items = buildItems(ai, review, F); V.sel = null; V.page = 1; V.zoom = 1; V.fileName = fileName || '';
  d.querySelector('.pv-file').textContent = fileName ? ` · ${fileName}` : '';
  d.querySelector('.pv-msg').textContent = 'Loading the plan…';
  const diag = d.querySelector('.pv-diag'); diag.hidden = true;
  list(); if (!d.open) { d.showModal(); document.documentElement.classList.add('pv-open'); }
  try {
    const lib = await loadPdfjs();
    const data = new Uint8Array(await blob.arrayBuffer());
    V.doc = await lib.getDocument({ data, isEvalSupported: false, standardFontDataUrl: `${PDFJS}standard_fonts/` }).promise;
    const r = ai.result || {};
    const claudeAnn = (r.annotations || []).map(normAnn).filter(Boolean);
    let extra = [], runs = 0;
    try { const t = await textLocate(V.doc, r, new Set(claudeAnn.map(a => a.ref))); extra = t.ann; runs = t.textRuns; } catch {}
    V.items = buildItems({ ...ai, result: { ...r, annotations: [...(r.annotations || []), ...extra] } }, review, F);
    const old = ai.engine !== 'free' && (!ai.relay || +ai.relay < 12);
    const msgs = [];
    if (ai.engine === 'free') msgs.push(`Free text reader: ${claudeAnn.length} location${claudeAnn.length === 1 ? '' : 's'} marked on the plan (exact text positions; tick “Show values read”). Items it couldn't find show “location not marked” — use <b>Read with Claude</b> for those.`);
    else if (!claudeAnn.length) msgs.push(old ? `This plan was read before the relay could return locations (relay ${ai.relay ? `v${ai.relay}` : 'v11 or older'}). Deploy the latest relay (v13) in Cloudflare and click <b>Read with Claude</b> again to get Claude's boxes.` : 'Claude did not return any locations for this plan — try <b>Read with Claude</b> again.');
    else if (ai.engine !== 'free') msgs.push(`Claude marked ${claudeAnn.length} location${claudeAnn.length === 1 ? '' : 's'}.`);
    if (extra.length) msgs.push(`${extra.length} ${claudeAnn.length ? 'more ' : ''}value${extra.length === 1 ? '' : 's'} located by matching the plan's own text (exact positions; tick “Show values read”).`);
    else if (!runs) msgs.push('This PDF has no selectable text (scanned or flattened), so values can only be located by Claude.');
    diag.innerHTML = msgs.join(' '); diag.hidden = false;
    list();
    d.querySelector('.pv-msg').textContent = '';
    await render();
    const first = (visible().find(i => i.boxes.length) || {}).n;
    if (first) select(first, false);
  } catch (e) { d.querySelector('.pv-msg').textContent = `Couldn't open the PDF: ${e.message}`; }
}
