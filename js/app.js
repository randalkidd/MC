import { lookupParcel, lookupRoads, lookupTSP, lookupSeptic, countSubdivisionLots, ping, LINKS, normalizeApn } from './lookup.js';
import { renderReportHTML, renderReportMD, findPlat } from './report.js';
import { settings } from './net.js';
import { gh, readFile, writeFile, listDir, testAccess } from './github.js';
import { DISTRICTS, normalizeDistrict, ACCESSORY_RULES, SEPTIC_SAMPLE_SETBACKS, MCZO_URL } from './standards.js';
import { CHECKLISTS } from './checklists.js';
import { loadDraft, saveDraft, blankReview, computeFindings, checklistRows, buildMarkdown } from './review.js';
import { DIRECTIVES, MCSR_QUICK } from './refdata.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mdInline = (s) => esc(s).replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

function toast(msg, kind = 'info') {
  const t = document.createElement('div'); t.className = `toast ${kind}`; t.textContent = msg;
  $('#toasts').append(t); setTimeout(() => t.remove(), kind === 'error' ? 8000 : 3500);
}
async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Copy failed — select and copy manually', 'error'); } }
function download(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }

// ---------------- state ----------------
const S = { R: null, md: '', extras: {}, db: null, dbSha: null, dbDirty: false, map: null, layer: null, review: loadDraft() };

// ---------------- tabs ----------------
function showTab(id) {
  $$('.tab').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === id));
  $$('.panel').forEach(p => (p.hidden = p.id !== id));
  try { localStorage.setItem('mc.tab', id); } catch {}
  if (id === 'p-lookup' && S.map) setTimeout(() => S.map.invalidateSize(), 50);
  if (id === 'p-saved') renderSaved();
  history.replaceState(null, '', `#${id.slice(2)}`);
}
$$('.tab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---------------- subdivision DB ----------------
async function loadDB() {
  const f = await readFile('data/subdivision-plats.json');
  S.db = f.text ? JSON.parse(f.text) : { schema: 1, subdivisions: [] };
  S.dbSha = f.sha; S.dbDirty = false;
  $('#db-source').textContent = f.source === 'github' ? `Loaded live from ${gh.owner}/${gh.repo}@${gh.branch}` : 'Loaded from the published site copy (add GitHub settings for live data)';
  renderDB();
}

function renderDB() {
  const q = ($('#db-q').value || '').toLowerCase();
  const rows = (S.db?.subdivisions || []).filter(s => !q || JSON.stringify(s).toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  $('#db-count').textContent = `${S.db?.subdivisions.length || 0} subdivisions`;
  $('#db-dirty').hidden = !S.dbDirty;
  $('#db-body').innerHTML = rows.map(s => `<tr data-name="${esc(s.name)}">
    <td><b>${esc(s.name)}</b><div class="sub">${esc(s.baseZoning || '')}</div></td>
    <td>${esc(s.mcr)}</td>
    <td><a href="${esc(s.platUrl)}" target="_blank" rel="noopener">${esc(s.docType)} #${esc(s.rec)}</a><div class="sub">${esc(s.recorded)}</div></td>
    <td>${s.totalLots ?? '—'}</td><td>${esc(s.setbacks)}</td><td>${esc(s.lastUpdated)}</td>
    <td><button class="btn sm" data-edit="${esc(s.name)}">Edit</button></td></tr>`).join('') || '<tr><td colspan="7">No matches.</td></tr>';
}
$('#db-q').addEventListener('input', renderDB);
$('#db-body').addEventListener('click', (e) => { const n = e.target.dataset.edit; if (n) openEditor(S.db.subdivisions.find(s => s.name === n)); });
$('#db-new').addEventListener('click', () => openEditor(null));
$('#db-reload').addEventListener('click', () => loadDB().then(() => toast('Reloaded')));
$('#db-export').addEventListener('click', () => download('subdivision-plats.json', JSON.stringify(S.db, null, 2)));

const FIELDS = [
  ['name', 'Subdivision name (exact Assessor SubdivisionName)'], ['mcr', 'MCR book-page (e.g. 754-39)'], ['docType', 'Document type (PLAT MAP / SUR MAP)'],
  ['rec', 'Recording number'], ['recorded', 'Recorded date (YYYY-MM-DD)'], ['totalLots', 'Total lots (current Assessor count)'],
  ['baseZoning', 'Base zoning'], ['setbacks', 'Recorded setbacks (Front / Rear / Side / Street-side)'], ['height', 'Height limit'],
  ['controllingCases', 'Controlling cases (DMP / rezoning / CPA, with dates)'], ['notes', 'Notes'], ['parcelsChecked', 'Parcels checked (comma-separated APNs)'],
];
function openEditor(rec, prefill = {}) {
  const d = $('#db-editor'); const isNew = !rec;
  const r = rec ? { ...rec } : { docType: 'PLAT MAP', lastUpdated: new Date().toISOString().slice(0, 10), ...prefill };
  $('#ed-title').textContent = isNew ? 'Add subdivision' : `Edit — ${r.name}`;
  $('#ed-form').innerHTML = FIELDS.map(([k, l]) => {
    const v = Array.isArray(r[k]) ? r[k].join(', ') : (r[k] ?? '');
    const big = ['notes', 'controllingCases', 'setbacks', 'height'].includes(k);
    return `<label>${l}${big ? `<textarea name="${k}" rows="${k === 'notes' ? 5 : 2}">${esc(v)}</textarea>` : `<input name="${k}" value="${esc(v)}">`}</label>`;
  }).join('') + `<label class="row"><input type="checkbox" name="platControls" ${r.platControls ? 'checked' : ''}> Plat standards confirmed controlling (no newer case supersedes)</label>`;
  d.dataset.orig = isNew ? '' : rec.name;
  $('#ed-delete').hidden = isNew;
  $('#ed-count').onclick = async () => { const n = $('#ed-form [name=name]').value.trim(); if (!n) return; try { $('#ed-form [name=totalLots]').value = await countSubdivisionLots(n.toUpperCase()); } catch (e) { toast(e.message, 'error'); } };
  d.showModal();
}
$('#ed-cancel').addEventListener('click', () => $('#db-editor').close());
$('#ed-delete').addEventListener('click', () => {
  const orig = $('#db-editor').dataset.orig;
  if (!confirm(`Remove "${orig}" from the database? (Takes effect when you save to GitHub.)`)) return;
  S.db.subdivisions = S.db.subdivisions.filter(s => s.name !== orig); S.dbDirty = true; $('#db-editor').close(); renderDB();
});
$('#ed-save').addEventListener('click', (e) => {
  e.preventDefault();
  const f = new FormData($('#ed-form')); const r = {};
  for (const [k] of FIELDS) r[k] = (f.get(k) || '').trim();
  if (!r.name || !r.rec) { toast('Name and recording number are required', 'error'); return; }
  r.totalLots = r.totalLots === '' ? null : +r.totalLots;
  r.parcelsChecked = r.parcelsChecked ? r.parcelsChecked.split(/[,\s]+/).map(normalizeApn).filter(Boolean) : [];
  r.platControls = !!f.get('platControls');
  r.platUrl = LINKS.recDoc(r.rec);
  r.lastUpdated = new Date().toISOString().slice(0, 10);
  const orig = $('#db-editor').dataset.orig;
  const i = S.db.subdivisions.findIndex(s => s.name === (orig || r.name));
  if (i >= 0) S.db.subdivisions[i] = { ...S.db.subdivisions[i], ...r }; else S.db.subdivisions.push(r);
  S.dbDirty = true; $('#db-editor').close(); renderDB();
  toast('Changed locally — click "Save to GitHub" to commit');
});
$('#db-save').addEventListener('click', async () => {
  try {
    S.db.updated = new Date().toISOString().slice(0, 10);
    await writeFile('data/subdivision-plats.json', JSON.stringify(S.db, null, 2) + '\n', `Update subdivision database (${S.db.subdivisions.length} entries)`);
    S.dbDirty = false; renderDB(); toast('Saved to GitHub — the published site updates in about a minute', 'ok');
  } catch (e) { toast(e.message, 'error'); }
});

// ---------------- lookup ----------------
async function runLookup(apn) {
  const out = $('#report'); const st = $('#lookup-status');
  out.innerHTML = ''; $('#report-actions').hidden = true; st.hidden = false; st.className = 'status';
  try {
    if (!S.db) await loadDB().catch(() => {});
    S.extras = {};
    S.R = await lookupParcel(apn, { onStep: (m) => (st.textContent = `Querying: ${m}…`) });
    st.hidden = true;
    out.innerHTML = renderReportHTML(S.R, S.db);
    S.md = renderReportMD(S.R, S.db, S.extras);
    $('#report-actions').hidden = false;
    drawMap(S.R);
    $('#lookup-apn').value = S.R.apn;
    history.replaceState(null, '', `?apn=${S.R.apn}#lookup`);
    // carry context into the plan review
    const z = S.R.zoning[0]?.zone; const k = normalizeDistrict(z);
    Object.assign(S.review, { apn: S.R.apn, lotArea: S.R.parcel.areaSqFt, district: k || S.review.district });
    const plat = findPlat(S.R, S.db);
    if (plat) $('#plat-hint').innerHTML = `Recorded plat on file: <b>${esc(plat.name)}</b> — ${esc(plat.setbacks)}. Enter the BSLs below if they're more restrictive.`;
    saveDraft(S.review); renderReview();
  } catch (e) { st.className = 'status err'; st.textContent = e.message; }
}
$('#lookup-form').addEventListener('submit', (e) => { e.preventDefault(); runLookup($('#lookup-apn').value); });
$('#report').addEventListener('click', async (e) => {
  const act = e.target.dataset.act; if (!act || !S.R) return;
  const cell = (id, html) => { const c = $(id); if (c) c.innerHTML = html; };
  try {
    if (act === 'septic') {
      cell('#septic-cell', 'Checking…');
      const rows = await lookupSeptic(S.R.apn);
      const txt = rows.length ? rows.map(r => r.name).join('; ') : 'N/A';
      S.extras.septic = `${txt} ([Septic Search](${LINKS.septic}))`;
      cell('#septic-cell', `${esc(txt)} · <a href="${LINKS.septic}" target="_blank" rel="noopener">Septic Search</a>${rows.length ? '' : ' — no pre-6/15/2024 record; check the <a href="' + LINKS.permitCenter + '" target="_blank" rel="noopener">Permit Center</a> for newer permits'}`);
    } else if (act === 'roads') {
      cell('#roads-cell', 'Checking…');
      const r = await lookupRoads(S.R);
      const txt = r.classification.map(x => `${x.Street || x.FullRouteName || 'Road'}: ${x.Classification || '—'}${x.RoadWidth ? `, ${x.RoadWidth} ft` : ''}`).join('; ') || 'No classified road segment within 120 ft';
      const m = r.maintained.length ? ` · MCDOT-maintained: ${r.maintained.map(x => `${x.Street || x.FullRouteName || ''}${x.CourtesyMaintained ? ' (courtesy)' : ''}`).join(', ')}` : ' · not MCDOT-maintained';
      S.extras.roads = txt + m; cell('#roads-cell', `${esc(txt + m)} · <a href="${LINKS.rit}" target="_blank" rel="noopener">RIT</a>`);
    } else if (act === 'tsp') {
      cell('#tsp-cell', 'Checking…');
      const r = await lookupTSP(S.R);
      const txt = r.hits.length ? r.hits.map(h => { const n = (r.needs || []).find(x => String(x.NeedID) === String(h.needId)); return `${h.layer}${n ? ` — ${n.OnRoad || ''} ${n.FromRoad ? `(${n.FromRoad} to ${n.ToRoad})` : ''} ${n.Need || ''}` : ''}`; }).join('; ') : 'No Capacity/Drainage/Bridge corridor project — omit from report';
      if (r.hits.length) S.extras.tsp = txt; cell('#tsp-cell', `${esc(txt)} · <a href="${LINKS.tsp}" target="_blank" rel="noopener">TSP2040</a>`);
    } else if (act === 'add-sub') {
      showTab('p-subs');
      const p = S.R.parcel; let lots = null;
      try { lots = await countSubdivisionLots(p.SubdivisionName); } catch {}
      openEditor(null, { name: p.SubdivisionName, mcr: p.MCRNumber || '', totalLots: lots, baseZoning: S.R.zoning.map(z => z.zone).join(', '), parcelsChecked: [S.R.apn],
        controllingCases: [...S.R.currentCases, ...S.R.historicCases].filter(c => /Rezoning|Zoning Case|Development Master|Comprehensive/.test(c.type)).map(c => `${c.permit} (${c.date || '?'}, ${c.status || '?'})`).join('; ') });
      return;
    }
    S.md = renderReportMD(S.R, S.db, S.extras);
  } catch (err) { toast(err.message, 'error'); cell(`#${act}-cell`, `<span class="bad">${esc(err.message)}</span>`); }
});
$('#rep-copy').addEventListener('click', () => copy(S.md));
$('#rep-dl').addEventListener('click', () => download(`${S.R.apn}.md`, S.md));
$('#rep-save').addEventListener('click', async () => {
  try { await writeFile(`data/parcels/${S.R.apn}.md`, S.md + '\n', `Parcel report ${S.R.apn} (${S.R.lookupDate})`); toast('Report saved to GitHub', 'ok'); } catch (e) { toast(e.message, 'error'); }
});
$('#rep-print').addEventListener('click', () => window.print());

function drawMap(R) {
  if (!window.L || !R.wgsRings) { $('#map').hidden = true; return; }
  $('#map').hidden = false;
  if (!S.map) {
    S.map = L.map('map', { zoomControl: true, attributionControl: true });
    const img = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' });
    const st = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 19, attribution: '© Esri' });
    img.addTo(S.map); L.control.layers({ Aerial: img, Streets: st }).addTo(S.map);
  }
  if (S.layer) S.layer.remove();
  S.layer = L.polygon(R.wgsRings.map(r => r.map(([x, y]) => [y, x])), { color: '#ff3b30', weight: 3, fillOpacity: 0.08 }).addTo(S.map);
  S.map.fitBounds(S.layer.getBounds(), { padding: [30, 30], maxZoom: 19 });
  setTimeout(() => S.map.invalidateSize(), 50);
}

// ---------------- plan review ----------------
function renderReview() {
  const s = S.review;
  $('#rv-type').innerHTML = Object.entries(CHECKLISTS).map(([k, v]) => `<option value="${k}" ${k === s.type ? 'selected' : ''}>${v.label}</option>`).join('');
  $('#rv-district').innerHTML = '<option value="">— select —</option>' + Object.keys(DISTRICTS).map(k => `<option ${k === s.district ? 'selected' : ''}>${k}</option>`).join('');
  for (const k of ['apn', 'lotArea', 'planTitle', 'reviewer', 'date']) $(`#rv-${k}`).value = s[k] ?? '';
  $('#rv-adjRes').checked = !!s.adjRes;
  for (const k of Object.keys(s.primary)) $(`#rv-p-${k}`).value = s.primary[k] ?? '';
  for (const k of Object.keys(s.platSetbacks)) $(`#rv-b-${k}`).value = s.platSetbacks[k] ?? '';
  const site = ['residential', 'commercial'].includes(s.type);
  $$('.site-only').forEach(el => (el.hidden = !site));
  renderStructures(); renderChecklist(); renderOutput();
}
function renderStructures() {
  $('#rv-structs').innerHTML = S.review.structures.map((x, i) => `<tr data-i="${i}">
    <td><input data-k="name" value="${esc(x.name)}"></td>
    <td><select data-k="kind">${[['primary', 'Primary / attached'], ['accessory', 'Detached accessory'], ['adu', 'Detached ADU']].map(([v, l]) => `<option value="${v}" ${x.kind === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
    <td><input data-k="sf" inputmode="decimal" value="${esc(x.sf)}"></td>
    <td><select data-k="cover"><option value="solid" ${x.cover !== 'open' ? 'selected' : ''}>Solid roof / &gt;50% opaque (100%)</option><option value="open" ${x.cover === 'open' ? 'selected' : ''}>Lattice / ≤50% opaque (50%)</option></select></td>
    <td><input data-k="height" inputmode="decimal" value="${esc(x.height)}"></td>
    ${['front', 'rear', 'side', 'street'].map(k => `<td>${x.kind === 'primary' ? '<span class="sub">above</span>' : `<input data-k="${k}" inputmode="decimal" value="${esc(x[k])}">`}</td>`).join('')}
    <td>${x.kind === 'primary' ? '' : `<input type="checkbox" data-k="inYard" ${x.inYard ? 'checked' : ''} title="In a required rear/side yard">`}</td>
    <td><button class="btn sm ghost" data-del="${i}" aria-label="Remove">✕</button></td></tr>`).join('');
}
function renderChecklist() {
  const rows = checklistRows(S.review);
  $('#rv-check').innerHTML = rows.map(r => `<tr data-id="${r.id}">
    <td>${esc(r.item)}<div class="sub">${mdInline(r.cite)}</div></td>
    <td><select data-c="status">${[['', '—'], ['ok', 'OK'], ['deficient', 'Missing / deficient'], ['verify', 'Verify'], ['na', 'N/A']].map(([v, l]) => `<option value="${v}" ${r.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
    <td><input data-c="note" placeholder="What the plan shows" value="${esc(r.note)}"></td>
    <td><input data-c="fix" value="${esc(r.fix)}"></td></tr>`).join('');
}
function renderOutput() {
  const { F } = computeFindings(S.review);
  $('#rv-findings').innerHTML = F.map(f => `<li class="${f.status}"><b>${esc(f.item)}</b>: ${esc(f.shows)} — required ${esc(f.req)} ${f.status === 'ok' ? '✅' : f.status === 'verify' ? '⚠️' : '❌'}</li>`).join('') || '<li class="sub">Enter measurements to run checks.</li>';
  $('#rv-md').value = buildMarkdown(S.review);
}
function bindReview() {
  const upd = () => { saveDraft(S.review); renderOutput(); };
  $('#rv-type').addEventListener('change', (e) => { S.review.type = e.target.value; saveDraft(S.review); renderReview(); });
  $('#rv-district').addEventListener('change', (e) => { S.review.district = e.target.value; upd(); });
  for (const k of ['apn', 'lotArea', 'planTitle', 'reviewer', 'date']) $(`#rv-${k}`).addEventListener('input', (e) => { S.review[k] = e.target.value; upd(); });
  $('#rv-adjRes').addEventListener('change', (e) => { S.review.adjRes = e.target.checked; upd(); });
  for (const k of Object.keys(S.review.primary)) $(`#rv-p-${k}`).addEventListener('input', (e) => { S.review.primary[k] = e.target.value; upd(); });
  for (const k of Object.keys(S.review.platSetbacks)) $(`#rv-b-${k}`).addEventListener('input', (e) => { S.review.platSetbacks[k] = e.target.value; upd(); });
  $('#rv-structs').addEventListener('input', (e) => { const tr = e.target.closest('tr'); const k = e.target.dataset.k; if (!tr || !k) return; S.review.structures[+tr.dataset.i][k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; if (k === 'kind') { saveDraft(S.review); renderStructures(); } upd(); });
  $('#rv-structs').addEventListener('click', (e) => { const i = e.target.dataset.del; if (i == null) return; S.review.structures.splice(+i, 1); saveDraft(S.review); renderStructures(); renderOutput(); });
  $('#rv-add').addEventListener('click', () => { S.review.structures.push({ name: 'Shed', kind: 'accessory', sf: '', cover: 'solid', height: '', front: '', rear: '', side: '', street: '', inYard: true }); saveDraft(S.review); renderStructures(); });
  $('#rv-check').addEventListener('input', (e) => { const tr = e.target.closest('tr'); const k = e.target.dataset.c; if (!tr || !k) return; const id = tr.dataset.id; S.review.checks[id] = { ...(S.review.checks[id] || {}), [k]: e.target.value }; upd(); });
  $('#rv-allok').addEventListener('click', () => { for (const r of checklistRows(S.review)) if (!S.review.checks[r.id]?.status) S.review.checks[r.id] = { ...(S.review.checks[r.id] || {}), status: 'ok' }; saveDraft(S.review); renderChecklist(); renderOutput(); });
  $('#rv-reset').addEventListener('click', () => { if (!confirm('Clear this review?')) return; S.review = blankReview(); saveDraft(S.review); renderReview(); });
  $('#rv-copy').addEventListener('click', () => copy($('#rv-md').value));
  $('#rv-dl').addEventListener('click', () => download(`review-${S.review.apn || 'plan'}-${S.review.date}.md`, $('#rv-md').value));
  $('#rv-save').addEventListener('click', async () => {
    try { const p = `data/reviews/${S.review.apn || 'no-apn'}-${S.review.date}-${S.review.type}.md`; await writeFile(p, $('#rv-md').value + '\n', `Plan review ${S.review.apn} ${S.review.type}`); await writeFile(p.replace(/\.md$/, '.json'), JSON.stringify(S.review, null, 2), `Plan review data ${S.review.apn}`); toast('Review saved to GitHub', 'ok'); } catch (e) { toast(e.message, 'error'); }
  });
}

// ---------------- land division classifier ----------------
function classify() {
  const f = Object.fromEntries(new FormData($('#ld-form')));
  const lots = +f.lots || 0, minAc = f.minAc === '' ? null : +f.minAc;
  const inSub = f.inSub === 'yes', street = !!f.street, aband = !!f.aband, condo = !!f.condo, ag = !!f.ag, septicSmall = !!f.septic, tract = !!f.tract;
  const out = [];
  const R = (cls, proc, cites, warn = []) => out.push({ cls, proc, cites, warn });
  if (!lots) { $('#ld-out').innerHTML = '<p class="sub">Enter the number of resulting lots.</p>'; return; }
  if (minAc != null && minAc >= 36 && !condo) R('Not a subdivision or minor land division', "Every resulting parcel is ≥ 36 ac (to the centerline of contiguous roads/easements), so it is outside both definitions. Deeds plus MCZO compliance.", 'MCSR §105.24, §105.38; A.R.S. 32-2101');
  else if (ag) R('Excluded (agricultural lease/sale under A.R.S. 11-830)', 'Not regulated as a land division; confirm the A.R.S. 11-830 conditions.', 'MCSR §105.24');
  else if (inSub) {
    if (lots >= 6 || tract || street || aband) {
      const pre = street || aband || lots > 6;
      R('Replat (amended final plat)', `${pre ? 'Preliminary plat (MCSR §202) + final plat (§203); the Director may waive the preliminary stage' : 'Process as a final plat (MCSR §203)'}.`, 'MCSR §204.1–3; DD-2013-10 ¶3',
        [aband && 'Abandoning a street, alley or easement needs MCDOT/utility review.', tract && 'Altering a tract designated for a specific use is a replat.'].filter(Boolean));
    } else R('Minor land division within a recorded subdivision', '5 or fewer adjoining lots. Done by deed; each lot must meet MCZO area, width and access; existing structures must meet setbacks to the new lines.', 'DD-2013-10 ¶3; MCSR §105.24');
  } else if (lots >= 6 || condo) R('Subdivision', 'Pre-application → preliminary plat (P&Z, valid 24 mo) → final plat (BOS / administrative under the 2024 amendment) → record. Assurances, assured water (AMA), improvements per MCSR Ch. 3.', 'MCSR §103, §105.38, §202–203; A.R.S. 11-806.01',
    [condo && 'Residential condominiums count as a subdivision.', septicSmall && 'Lots < 1 net acre may not use individual on-lot septic (DD-3018-01) — sewer, larger lots, or a waiver with an ESD Certificate of Geological Report.'].filter(Boolean));
  else R('Minor land division (lot split)', 'Up to 5 lots, all < 36 ac. Done by recorded deeds; the MCSR does not apply, but each lot must meet MCZO lot area, width and legal access, and A.R.S. 11-831. Staff check Assessor history for serial splits at site-plan review.', 'MCSR §105.24; DD-2013-10 ¶2, ¶4; A.R.S. 11-831',
    ['Count prior splits of the same parent / common promotional plan — 6+ in total makes it a subdivision.']);
  $('#ld-out').innerHTML = out.map(o => `<div class="card result"><h3>${esc(o.cls)}</h3><p>${esc(o.proc)}</p><p class="sub">Basis: ${esc(o.cites)}</p>${o.warn.map(w => `<p class="warn">${esc(w)}</p>`).join('')}</div>`).join('');
}
$('#ld-form').addEventListener('input', classify);

// ---------------- saved (GitHub) ----------------
async function renderSaved() {
  const el = $('#saved-list');
  if (!gh.owner || !gh.repo) { el.innerHTML = '<p class="sub">Connect your GitHub repo in Settings to list saved reports and reviews.</p>'; return; }
  el.innerHTML = 'Loading…';
  try {
    const [p, r] = await Promise.all([listDir('data/parcels'), listDir('data/reviews')]);
    const pagesBase = location.origin + location.pathname.replace(/[^/]*$/, '');
    const li = (f) => `<li><a href="${pagesBase}${f.path}" target="_blank" rel="noopener">${esc(f.name)}</a> · <a href="${f.html_url}" target="_blank" rel="noopener">GitHub</a></li>`;
    el.innerHTML = `<h3>Parcel reports (${p.length})</h3><ul>${p.map(li).join('') || '<li class="sub">None yet</li>'}</ul><h3>Plan reviews (${r.filter(f => f.name.endsWith('.md')).length})</h3><ul>${r.filter(f => f.name.endsWith('.md')).map(li).join('') || '<li class="sub">None yet</li>'}</ul>`;
  } catch (e) { el.innerHTML = `<p class="bad">${esc(e.message)}</p>`; }
}

// ---------------- reference ----------------
function renderReference() {
  $('#ref-mcsr').innerHTML = MCSR_QUICK.map(r => `<tr><td>${esc(r.topic)}</td><td>${esc(r.std)}</td><td>${esc(r.cite)}</td></tr>`).join('');
  $('#ref-dirs').innerHTML = DIRECTIVES.map(d => `<li><a href="${d.u}" target="_blank" rel="noopener">${esc(d.t)}</a></li>`).join('');
  $('#ref-acc').innerHTML = ACCESSORY_RULES.map(r => `<li>${esc(r)}</li>`).join('');
  $('#ref-septic').innerHTML = SEPTIC_SAMPLE_SETBACKS.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
  const keys = Object.keys(DISTRICTS);
  const row = (lab, fn) => `<tr><th>${lab}</th>${keys.map(k => `<td>${fn(DISTRICTS[k]) ?? '—'}</td>`).join('')}</tr>`;
  const s = (v, d, adj) => v == null ? (adj ? `0 / ${adj}*` : '0') : v;
  $('#ref-districts').innerHTML = `<thead><tr><th></th>${keys.map(k => `<th>${k}</th>`).join('')}</tr></thead><tbody>
    ${row('Lot area (sf)', d => d.area?.toLocaleString())}${row('Per DU (sf)', d => d.perDU?.toLocaleString())}${row('Width (ft)', d => d.width)}${row('Coverage', d => d.cov + '%')}
    ${row('Front', d => d.front + (d.frontGarage ? '/18**' : ''))}${row('Side-street', d => d.street)}${row('Side-interior', d => s(d.side, d, d.sideAdjRes))}${row('Rear', d => d.rear == null ? `0 / ${d.rearAdjRes}*` : d.rear + (d.rearAdjRes ? ` / ${d.rearAdjRes}*` : ''))}${row('Height', d => d.height)}
    ${row('Acc. front', d => d.acc?.front)}${row('Acc. side-street', d => d.acc?.street)}</tbody>`;
}

// ---------------- settings ----------------
function renderSettings() {
  $('#st-proxy').value = settings.proxy; $('#st-force').checked = settings.forceProxy;
  $('#st-owner').value = gh.owner; $('#st-repo').value = gh.repo; $('#st-branch').value = gh.branch; $('#st-token').value = gh.token ? '••••••••' : '';
  $('#gh-badge').textContent = gh.canWrite ? `✓ Saving to ${gh.owner}/${gh.repo}` : '⚙ Connect GitHub to save';
  $('#gh-badge').className = `badge ${gh.canWrite ? 'ok' : ''}`;
}
$('#st-save').addEventListener('click', () => {
  settings.proxy = $('#st-proxy').value; settings.forceProxy = $('#st-force').checked;
  const tok = $('#st-token').value; gh.save({ owner: $('#st-owner').value.trim(), repo: $('#st-repo').value.trim(), branch: $('#st-branch').value.trim() || 'main', token: tok.startsWith('••') ? undefined : tok.trim() });
  renderSettings(); toast('Settings saved in this browser'); loadDB().catch(() => {});
});
$('#st-forget').addEventListener('click', () => { gh.save({ owner: $('#st-owner').value, repo: $('#st-repo').value, branch: $('#st-branch').value, token: '' }); renderSettings(); toast('Token removed from this browser'); });
$('#st-test-gis').addEventListener('click', async () => { const o = $('#st-test-out'); o.textContent = 'Testing county GIS…'; try { o.textContent = `County GIS reachable (${await ping()} ms).`; } catch (e) { o.textContent = e.message; } });
$('#st-test-gh').addEventListener('click', async () => { const o = $('#st-test-out'); o.textContent = 'Testing GitHub…'; try { const r = await testAccess(); o.textContent = `${r.name}: ${r.canPush ? 'write access OK' : 'READ-ONLY — token lacks Contents: write'}${r.private ? ' (private repo — Pages needs a paid plan)' : ''}`; } catch (e) { o.textContent = e.message; } });

$('#gh-badge').addEventListener('click', () => { showTab('p-settings'); setTimeout(() => $('#st-token').focus(), 50); });

// ---------------- init ----------------
bindReview(); renderReview(); renderReference(); renderSettings(); classify();
loadDB().catch(e => { $('#db-source').textContent = `Could not load database: ${e.message}`; });
const qApn = new URLSearchParams(location.search).get('apn');
const hashTab = location.hash ? `p-${location.hash.slice(1)}` : null;
let start = 'p-lookup'; try { start = localStorage.getItem('mc.tab') || start; } catch {}
showTab(document.getElementById(hashTab || '') ? hashTab : start);
if (qApn) { showTab('p-lookup'); $('#lookup-apn').value = qApn; runLookup(qApn); }
