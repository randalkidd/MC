// Review Verification — walks the reviewer through the review one item at a time in its own window:
// every checklist item for the submittal type, each measured standard (setbacks, height, coverage, lot area),
// each plan-vs-record mismatch or other finding, and each value the reader marked hard to read.
// Decisions are written straight into the review (checklist statuses/notes/corrections, reviewer overrides of the
// measured checks in s.verified, and markup rows in s.extra), so the Checklist box and Markup Table fill as you go.
import { CHECKLISTS } from './checklists.js?v=cae01958';
import { computeFindings } from './review.js?v=cae01958';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const yn = (v) => (v === true ? 'Yes' : v === false ? 'No' : null);
const STATUS = { ok: ['OK', 'ok'], deficient: ['Missing / deficient', 'bad'], verify: ['Verify', 'warn'], na: ['N/A', 'na'], '': ['Not set', 'unset'] };
// Measured checks the reviewer can correct right here (each maps to a field of the review form).
const FIELD = [
  [/^Lot area$/, 'lotArea', 'Lot area (sq ft)'],
  [/^Front setback \(primary\)/, 'primary.front', 'Front setback (ft)'],
  [/^Rear setback \(primary\)/, 'primary.rear', 'Rear setback (ft)'],
  [/side A$/, 'primary.sideA', 'Side A setback (ft)'],
  [/side B$/, 'primary.sideB', 'Side B setback (ft)'],
  [/^Side-street setback \(primary\)/, 'primary.street', 'Side-street setback (ft)'],
  [/^Building height \(primary\)/, 'primary.height', 'Height (ft)'],
  [/^Front-facing garage plane/, 'primary.garage', 'Garage plane to front lot line (ft)'],
];
const getF = (s, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), s);
const setF = (s, path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((o, k) => o[k], s)[last] = v; };

// What the plan reader found that bears on a checklist item (shown as evidence beside it).
function evidence(id, s) {
  const r = (s.ai && s.ai.result) || {}; const P = r.parcel || {}, pl = r.plan || {}, cv = r.coverage || {}, pr = r.primary || {};
  const out = []; const add = (k, v) => { if (v != null && v !== '') out.push([k, String(v)]); };
  const cmp = (rx) => (s.ai && s.ai.compare || []).filter(c => rx.test(c[0])).forEach(c => add(c[0], `plan ${c[1]} · record ${c[2]}${c[3] === 'ok' ? ' ✅' : ' ❌'}`));
  const key = id.replace(/^[a-z]-/, '');
  if (/scale|format/.test(key)) { add('Scale', pl.scale_stated ? `${pl.scale_stated}${pl.scale_is_standard === false ? ' (non-standard)' : ''}` : null); add('Scale bar', yn(pl.scale_bar)); }
  if (/north|format/.test(key)) { add('North arrow', yn(pl.north_arrow)); add('Vicinity map', yn(pl.vicinity_map)); }
  if (/apn|id$/.test(key)) { add('APN shown', P.apn); add('Owner shown', P.owner_name); add('Address shown', P.site_address); cmp(/APN|Owner|Address|Lot|Subdivision/i); }
  if (/^pl$|lots|area/.test(key)) { add('Lot dimensions', P.lot_dimensions); add('Lot area shown', P.lot_area_sf && `${(+P.lot_area_sf).toLocaleString()} sf`); add('Zoning shown', P.zoning_shown); }
  if (/ease|patent|vnae|sight/.test(key)) add('Easements', (r.easements || []).map(e => [e.type, e.width, e.recording && `MCR ${e.recording}`, e.location].filter(Boolean).join(' ')).join('; ') || (s.ai ? 'none shown' : null));
  if (/row|streets|access|sight|dw/.test(key)) add('Streets / ROW', (r.streets || []).map(x => [x.name, x.row_width && `ROW ${x.row_width}`, x.jurisdiction].filter(Boolean).join(' ')).join('; ') || (s.ai ? 'none shown' : null));
  if (/adj/.test(key)) add('Adjacent uses', (r.adjacent_uses || []).join('; ') || (s.ai ? 'none labeled' : null));
  if (/future/.test(key)) add('Invalidating notes', (pl.invalidating_notes || []).join('; ') || (s.ai ? 'none found' : null));
  if (/setall|existing|yards/.test(key)) add('Residence setbacks read', ['front', 'rear', 'side_a', 'side_b', 'side_street'].map(k => pr[k] != null ? `${k.replace('_', ' ')} ${pr[k]} ft` : null).filter(Boolean).join(', ') || null);
  if (/bldg|num|yards/.test(key)) add('Structures read', (r.structures || []).map(x => [x.name, x.sqft && `${x.sqft} sf`].filter(Boolean).join(' ')).join('; ') || null);
  if (/cov/.test(key)) add('Coverage shown on plan', cv.lot_coverage_pct_shown != null ? `${cv.lot_coverage_pct_shown}%${cv.total_covered_sf_shown ? ` (${(+cv.total_covered_sf_shown).toLocaleString()} sf)` : ''}` : (s.ai ? 'not shown' : null));
  if (/water|septic|wells|aws/.test(key)) add('Water / wastewater', [P.water_source, P.wastewater].filter(Boolean).join(' / ') || null);
  if (/legal|id$|lot$/.test(key)) add('Legal description', P.legal_description);
  if (/flood/.test(key)) add('Floodplain', P.flood_zone || null);
  return out;
}

export function buildSteps(s) {
  const steps = [];
  const items = CHECKLISTS[s.type]?.items || [];
  for (const [id, item, citeLabel, url, fix] of items) {
    const c = s.checks[id] || {};
    steps.push({ key: `c:${id}`, kind: 'check', group: 'Checklist', id, title: item, cite: citeLabel, url, defFix: fix, status: c.status || '', flag: c.status === 'ok' || c.status === 'na' ? '' : c.status || 'unset' });
  }
  const { F } = computeFindings(s);
  for (const f of F) steps.push({ key: `f:${f.item}`, kind: 'finding', group: 'Measured Standards', title: f.item, f, status: f.status, flag: f.status === 'ok' ? '' : f.status });
  (s.extra || []).forEach((e, i) => { if (e.item && !e.vf) steps.push({ key: `e:${e.item}`, kind: 'extra', group: /plan vs\. record/.test(e.item) ? 'Plan vs. Record' : 'Other Findings', title: e.item, i, status: e.status, flag: e.status === 'ok' || e.status === 'na' ? '' : e.status || 'verify' }); });
  ((s.ai && s.ai.result && s.ai.result.uncertain) || []).forEach((u, i) => { if (u) { const e = (s.extra || []).find(x => x.vf === `u:${i}`); steps.push({ key: `u:${i}`, kind: 'uncertain', group: 'Hard to Read', title: String(u), i, status: e ? e.status : '', flag: 'verify' }); } });
  return steps;
}

export function progress(s) {
  const steps = buildSteps(s); const v = s.verified || {};
  const done = steps.filter(x => v[x.key] && v[x.key].done).length;
  const flagged = steps.filter(x => x.flag).length;
  const open = steps.filter(x => x.flag && !(v[x.key] && v[x.key].done)).length;
  return { total: steps.length, done, flagged, open, first: Math.max(0, steps.findIndex(x => !(v[x.key] && v[x.key].done))) };
}

// ---------------- the window ----------------
const W = { dlg: null, s: null, steps: [], keys: new Set(), i: 0, only: false, onChange: null, onViewPlan: null };
// “Flagged only” keeps the set chosen when it was switched on, so an item doesn't vanish the moment you clear its flag.
function view() { return W.only ? W.steps.filter(x => W.keys.has(x.key)) : W.steps; }
function pinFlags() { W.keys = new Set(W.steps.filter(x => x.flag).map(x => x.key)); }
function rebuild() { const keep = (view()[W.i] || {}).key; W.steps = buildSteps(W.s); const j = view().findIndex(x => x.key === keep); if (j >= 0) W.i = j; W.i = Math.min(W.i, Math.max(0, view().length - 1)); }
function changed() { W.onChange && W.onChange(); }

function ensure() {
  if (W.dlg) return W.dlg;
  const d = document.createElement('dialog'); d.id = 'vf'; d.className = 'vf';
  d.innerHTML = `<div class="vf-head"><b>Review Verification</b><span class="sub vf-pos"></span>
      <label class="rowc vf-only"><input type="checkbox" data-vf="only"> Flagged items only</label>
      <button class="btn sm ghost" data-vf="close" aria-label="Close" title="Close (progress is kept)">✕</button></div>
    <div class="vf-bar"><i></i></div>
    <div class="vf-body"></div>
    <div class="vf-foot"><button class="btn" data-vf="prev" type="button">‹ Back</button><select class="vf-jump" aria-label="Jump to item"></select><span class="grow"></span>
      <button class="btn ghost" data-vf="skip" type="button" title="Leave this item unverified for now">Skip</button><button class="btn primary" data-vf="next" type="button">Confirm &amp; Next ›</button></div>`;
  document.body.appendChild(d);
  d.addEventListener('click', onClick); d.addEventListener('input', onInput); d.addEventListener('change', onInput);
  d.addEventListener('keydown', (e) => {
    if (/TEXTAREA|INPUT|SELECT/.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); next(true); } else if (e.key === 'ArrowLeft') { e.preventDefault(); go(W.i - 1); }
    else { const b = d.querySelector(`.vf-st [data-k="${e.key}"]`); if (b) b.click(); }
  });
  d.addEventListener('close', () => { document.documentElement.classList.remove('vf-open'); changed(); });
  return (W.dlg = d);
}

export function openVerify(s, { onChange, onViewPlan, onFinish, flaggedOnly = false } = {}) {
  W.s = s; s.verified = s.verified || {}; W.onChange = onChange; W.onViewPlan = onViewPlan; W.onFinish = onFinish; W.only = flaggedOnly;
  const d = ensure(); W.steps = buildSteps(s);
  d.querySelector('[data-vf=only]').checked = W.only; pinFlags();
  const v = view(); W.i = Math.max(0, v.findIndex(x => !(s.verified[x.key] || {}).done)); if (W.i < 0 || W.i >= v.length) W.i = 0;
  render(); if (!d.open) { d.showModal(); document.documentElement.classList.add('vf-open'); }
}

function stButtons(cur, opts) {
  return `<div class="vf-st" role="radiogroup">${opts.map(([v, l], n) => `<button type="button" class="pill-btn ${STATUS[v] ? STATUS[v][1] : ''} ${cur === v ? 'on' : ''}" data-st="${v}" data-k="${n + 1}" role="radio" aria-checked="${cur === v}"><kbd>${n + 1}</kbd> ${esc(l)}</button>`).join('')}</div>`;
}
function flagPill(x) {
  if (!x.flag) return '<span class="pill okp">No flag</span>';
  return x.flag === 'deficient' ? '<span class="pill badp">Flagged: deficient</span>' : x.flag === 'unset' ? '<span class="pill unsetp">Not yet reviewed</span>' : '<span class="pill warnp">Flagged: verify</span>';
}

function render() {
  const d = W.dlg; const s = W.s; const v = view();
  const p = progress(s);
  d.querySelector('.vf-pos').textContent = v.length ? ` · item ${Math.min(W.i + 1, v.length)} of ${v.length} · ${p.done} of ${p.total} verified${p.open ? ` · ${p.open} flagged left` : ''}` : '';
  d.querySelector('.vf-bar i').style.width = `${p.total ? (p.done / p.total) * 100 : 0}%`;
  d.querySelector('.vf-jump').innerHTML = v.map((x, j) => `<option value="${j}" ${j === W.i ? 'selected' : ''}>${(s.verified[x.key] || {}).done ? '✓' : x.flag ? '⚑' : '·'} ${j + 1}. ${esc(x.group)} — ${esc(x.title.slice(0, 70))}</option>`).join('') + `<option value="${v.length}" ${W.i >= v.length ? 'selected' : ''}>Finish — summary</option>`;
  d.querySelector('[data-vf=prev]').disabled = W.i <= 0;
  const body = d.querySelector('.vf-body');
  const foot = d.querySelector('.vf-foot');
  if (W.i >= v.length) { foot.querySelector('[data-vf=next]').textContent = 'Finish'; foot.querySelector('[data-vf=skip]').hidden = true; body.innerHTML = summary(); return; }
  foot.querySelector('[data-vf=next]').innerHTML = 'Confirm &amp; Next ›'; foot.querySelector('[data-vf=skip]').hidden = false;
  const x = v[W.i]; const done = (s.verified[x.key] || {}).done;
  const plan = s.ai && s.ai.file ? `<button class="btn sm" type="button" data-vf="plan">🔍 Show on plan</button>` : '';
  let h = `<div class="vf-meta"><span class="vf-group">${esc(x.group)}</span> ${flagPill(x)} ${done ? '<span class="pill okp">✓ Verified</span>' : ''} ${plan}</div><h3 class="vf-title">${esc(x.title)}</h3>`;
  if (x.kind === 'check') {
    const c = s.checks[x.id] || {};
    const ev = evidence(x.id, s);
    h += `<p class="sub">${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.cite)}</a>` : esc(x.cite)}</p>`;
    if (c.status && s.ai) h += `<p class="vf-reader">Plan reader marked this <b>${esc(STATUS[c.status] ? STATUS[c.status][0] : c.status)}</b>${c.note ? ` — “${esc(c.note)}”` : ''}. Confirm it on the plan.</p>`;
    if (ev.length) h += `<table class="vf-ev"><tbody>${ev.map(([k, val]) => `<tr><td>${esc(k)}</td><td>${esc(val)}</td></tr>`).join('')}</tbody></table>`;
    h += stButtons(c.status || '', [['ok', 'OK'], ['deficient', 'Missing / deficient'], ['verify', 'Verify'], ['na', 'N/A']]);
    h += `<label>Plan shows<textarea data-vf-c="note" rows="2" placeholder="What the plan shows">${esc(c.note || '')}</textarea></label>`;
    h += `<label class="vf-fix" ${c.status === 'deficient' || c.status === 'verify' ? '' : 'hidden'}>Required correction (goes in the markup and comment letter)<textarea data-vf-c="fix" rows="2">${esc(c.fix || x.defFix)}</textarea></label>`;
  } else if (x.kind === 'finding') {
    const f = x.f; const vv = s.verified[x.key] || {};
    const fld = FIELD.find(([rx]) => rx.test(f.item));
    h += `<p class="sub">${esc(f.cite.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'))} · ${esc(f.loc)}</p>`;
    h += `<table class="vf-ev"><tbody><tr><td>Plan shows</td><td>${esc(f.shows)}</td></tr><tr><td>Required</td><td>${esc(f.req)}</td></tr><tr><td>Computed result</td><td>${f.computed === 'ok' ? '✅ Meets' : f.computed === 'verify' ? '⚠️ Verify' : '❌ Does not meet'}</td></tr></tbody></table>`;
    if (fld) h += `<label class="vf-measure">${esc(fld[2])} — measured on the plan<input data-vf-field="${fld[1]}" inputmode="decimal" value="${esc(getF(s, fld[1]) ?? '')}"></label>`;
    h += `<p class="sub">Confirm the computed result, or override it if the plan shows something the numbers miss.</p>`;
    h += stButtons(vv.status || '', [['', 'Use computed result'], ['ok', 'Override: OK'], ['deficient', 'Override: deficient'], ['verify', 'Verify']]);
    h += `<label>Reviewer note<textarea data-vf-v="note" rows="2" placeholder="Optional — added to “Plan shows” in the markup">${esc(vv.note || '')}</textarea></label>`;
    h += `<label class="vf-fix" ${(vv.status || f.computed) === 'ok' ? 'hidden' : ''}>Required correction<textarea data-vf-v="fix" rows="2">${esc(vv.fix || (f.fix !== '—' ? f.fix : ''))}</textarea></label>`;
  } else if (x.kind === 'extra') {
    const e = s.extra[x.i];
    h += `<p class="sub">${esc(e.cite)} · ${esc(e.loc)}</p><table class="vf-ev"><tbody><tr><td>Plan shows</td><td>${esc(e.shows)}</td></tr><tr><td>Required</td><td>${esc(e.req)}</td></tr></tbody></table>`;
    h += stButtons(e.status || 'verify', [['ok', 'Resolved — OK'], ['deficient', 'Confirmed deficient'], ['verify', 'Still verify']]);
    h += `<label>Plan shows<textarea data-vf-e="shows" rows="2">${esc(e.shows)}</textarea></label>`;
    h += `<label class="vf-fix" ${e.status === 'ok' ? 'hidden' : ''}>Required correction<textarea data-vf-e="fix" rows="2">${esc(e.fix)}</textarea></label>`;
  } else {
    const e = (s.extra || []).find(y => y.vf === x.key) || {};
    h += `<p class="sub">The plan reader could not read this clearly or inferred it. Check it on the plan.</p>`;
    h += stButtons(e.status || '', [['', 'Confirmed — no comment'], ['deficient', 'Needs correction'], ['verify', 'Leave to verify']]);
    h += `<label>Plan shows<textarea data-vf-u="shows" rows="2" placeholder="What the plan actually shows">${esc(e.shows || '')}</textarea></label>`;
    h += `<label class="vf-fix" ${e.status ? '' : 'hidden'}>Required correction<textarea data-vf-u="fix" rows="2">${esc(e.fix || 'Make this legible and verifiable on the plan.')}</textarea></label>`;
  }
  body.innerHTML = h;
}

function summary() {
  const s = W.s; const v = W.steps; const ver = s.verified || {};
  const left = v.filter(x => !(ver[x.key] || {}).done);
  const bad = v.filter(x => x.status === 'deficient').length, chk = v.filter(x => x.status === 'verify').length;
  return `<h3 class="vf-title">Verification Summary</h3>
    <p>${v.length - left.length} of ${v.length} items verified. <b>${bad}</b> deficient · <b>${chk}</b> still to verify.</p>
    ${left.length ? `<div class="warn"><b>Not verified yet:</b><ul>${left.slice(0, 12).map(x => `<li><button type="button" class="link" data-vf-goto="${W.steps.indexOf(x)}">${esc(x.group)} — ${esc(x.title)}</button></li>`).join('')}${left.length > 12 ? `<li>…and ${left.length - 12} more</li>` : ''}</ul></div>` : '<p class="ok-line">✅ Every item has been verified.</p>'}
    <p class="sub">Your decisions are already in the Checklist box and the Markup Table. Click <b>Finish</b> to close and jump to the markup.</p>`;
}

function cur() { return view()[W.i]; }
function mark(x) { W.s.verified[x.key] = { ...(W.s.verified[x.key] || {}), done: true, at: new Date().toISOString() }; }
function setStatus(x, st) {
  const s = W.s;
  if (x.kind === 'check') { const c = s.checks[x.id] || {}; s.checks[x.id] = { ...c, status: st, ...((st === 'deficient' || st === 'verify') && !c.fix ? { fix: x.defFix } : {}) }; }
  else if (x.kind === 'finding') s.verified[x.key] = { ...(s.verified[x.key] || {}), status: st };
  else if (x.kind === 'extra') s.extra[x.i].status = st;
  else upsertU(x, { status: st });
}
// Hard-to-read values become a markup row only when the reviewer says they need a comment.
function upsertU(x, patch) {
  const s = W.s; s.extra = s.extra || [];
  let j = s.extra.findIndex(e => e.vf === x.key);
  const base = j >= 0 ? s.extra[j] : { ai: true, vf: x.key, loc: 'Site plan', item: x.title, shows: '', req: 'Legible and verifiable on the plan', cite: 'Plan read — reviewer verified', status: '', fix: 'Make this legible and verifiable on the plan.' };
  const e = { ...base, ...patch };
  if (!e.status) { if (j >= 0) s.extra.splice(j, 1); return; }
  if (j >= 0) s.extra[j] = e; else s.extra.push(e);
}

function onClick(e) {
  const t = e.target.closest('button'); if (!t) return;
  const x = cur();
  if (t.dataset.st != null && x) { setStatus(x, t.dataset.st); changed(); rebuild(); render(); return; }
  if (t.dataset.vfGoto != null) { W.only = false; W.dlg.querySelector('[data-vf=only]').checked = false; go(+t.dataset.vfGoto); return; }
  const a = t.dataset.vf;
  if (a === 'close') W.dlg.close();
  else if (a === 'prev') go(W.i - 1);
  else if (a === 'skip') go(W.i + 1);
  else if (a === 'next') next(true);
  else if (a === 'plan' && x) W.onViewPlan && W.onViewPlan(planTitle(x));
}
// The title the Plan Viewer lists this item under (so “Show on plan” lands on its box).
function planTitle(x) {
  if (x.kind === 'extra') { const m = x.title.match(/^(.*) — plan vs\. record$/); return m ? `${m[1]}: plan ≠ record` : x.title; }
  return x.title;
}
function onInput(e) {
  const t = e.target; const x = cur(); const s = W.s;
  if (t.dataset.vf === 'only') { W.only = t.checked; pinFlags(); const k = (x || {}).key; const j = view().findIndex(y => y.key === k); W.i = j >= 0 ? j : 0; render(); return; }
  if (t.classList.contains('vf-jump')) { go(+t.value); return; }
  if (!x) return;
  if (t.dataset.vfC) { s.checks[x.id] = { ...(s.checks[x.id] || {}), [t.dataset.vfC]: t.value }; changed(); }
  else if (t.dataset.vfV) { s.verified[x.key] = { ...(s.verified[x.key] || {}), [t.dataset.vfV]: t.value }; changed(); }
  else if (t.dataset.vfE) { s.extra[x.i][t.dataset.vfE] = t.value; changed(); }
  else if (t.dataset.vfU) { const e2 = s.extra.find(y => y.vf === x.key); if (e2) { e2[t.dataset.vfU] = t.value; changed(); } }
  else if (t.dataset.vfField && e.type === 'change') { setF(s, t.dataset.vfField, t.value.trim()); changed(); rebuild(); render(); const inp = W.dlg.querySelector('[data-vf-field]'); if (inp) inp.focus(); }
}
function next(confirm) {
  const v = view();
  if (W.i >= v.length) { W.dlg.close(); W.onFinish && W.onFinish(); return; }
  const x = v[W.i];
  if (confirm && x) {
    if (x.kind === 'check' && !(W.s.checks[x.id] || {}).status) { flash('Pick a status first (1–4), or click Skip.'); return; }
    mark(x); changed();
  }
  go(W.i + 1);
}
function go(i) { rebuild(); W.i = Math.max(0, Math.min(i, view().length)); render(); W.dlg.querySelector('.vf-body').scrollTop = 0; }
function flash(msg) { let n = W.dlg.querySelector('.vf-msg'); if (!n) { n = document.createElement('p'); n.className = 'vf-msg'; W.dlg.querySelector('.vf-body').prepend(n); } n.textContent = msg; }
