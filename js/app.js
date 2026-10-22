import { lookupParcel, lookupRoads, lookupTSP, lookupSeptic, countSubdivisionLots, ping, LINKS, normalizeApn, lookupSplit } from './lookup.js?v=cf0bac48';
import { renderReportHTML, renderReportMD, findPlat, platSetbacks } from './report.js?v=cf0bac48';
import { settings, setSharedRelay } from './net.js?v=cf0bac48';
import { gh, readFile, writeFile, listDir, testAccess, storageWorks, clearDirCache } from './github.js?v=cf0bac48';
import { DISTRICTS, normalizeDistrict, ACCESSORY_RULES, SEPTIC_SAMPLE_SETBACKS, MCZO_URL } from './standards.js?v=cf0bac48';
import { CHECKLISTS } from './checklists.js?v=cf0bac48';
import { loadDraft, saveDraft, blankReview, computeFindings, checklistRows, buildMarkdown } from './review.js?v=cf0bac48';
import { DIRECTIVES, MCSR_QUICK } from './refdata.js?v=cf0bac48';
import { findPlatDoc, platPdfLink, fetchPlatPdf, ocrPlat } from './platocr.js?v=cf0bac48';

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
  S.dbSha = f.sha; S.dbDirty = false; S.dbStamp = S.db.updated || '';
  $('#db-source').textContent = `Last saved ${S.db.updated ? String(S.db.updated).replace('T', ' ').slice(0, 16) : '—'}`;
  renderDB();
}

// One line per lot range / standard (structured table first, else split the text at "Lots …").
function setbackCell(s) {
  const t = Array.isArray(s.setbackTable) ? s.setbackTable.filter(r => ['front', 'rear', 'side', 'street'].some(k => r[k] !== '' && r[k] != null)) : [];
  const lines = t.length
    ? t.map(r => `${t.length > 1 || (r.lots && !/^all$/i.test(r.lots)) ? `<b>Lots ${esc(r.lots)}${r.district ? ` (${esc(r.district)})` : ''}:</b> ` : ''}${[r.front, r.rear, r.side, r.street].map(v => (v === '' || v == null ? '—' : v)).join(' / ')} ft`)
    : String(s.setbacks || '—').split(/\.\s+(?=Lots)/).map(x => esc(x.replace(/\.$/, '')));
  return `<div class="sb-lines">${lines.map(l => `<div>${l}</div>`).join('')}</div>${t.length ? '<div class="sub">Front / Rear / Side / Street-side</div>' : ''}`;
}
// ⚠ icon whose explanation shows on mouseover (and on tap/focus for phones).
const warnIco = (tip) => `<span class="warnico" tabindex="0" role="img" aria-label="${esc(tip)}" data-tip="${esc(tip)}">⚠</span>`;
// Pull the ⚠ sentences out of free-text notes (each runs to the next ⚠ or sentence end).
function noteWarnings(text) {
  return (String(text || '').match(/⚠[^⚠]*/g) || []).map(w => {
    const t = w.replace(/^⚠\s*/, '').replace(/\s*\(The [^)]*pruned[^)]*\)\s*/g, ' ').trim();
    const sent = t.split(/(?<=\.)\s+(?=[A-Z])/); // the warning sentence, plus a follow-on instruction (Pull/Verify/Confirm…) if present
    return (sent[0] + (sent[1] && /^(Pull|Verify|Confirm|Check|Open)\b/.test(sent[1]) ? ' ' + sent[1] : '')).trim();
  }).filter(Boolean);
}
// Show a zoning label compactly; if it records a conflict, keep the district codes and move the detail to a ⚠.
function zoningCell(z) {
  const t = String(z || ''); if (!t) return '';
  if (!/unresolved|\bvs\b|conflict|\?/i.test(t)) return esc(t);
  const keys = [...new Set(t.split(/[\/,;]|\bvs\b/i).map(x => normalizeDistrict(x.trim())).filter(Boolean))];
  return `${esc(keys.join(' / ') || t)} ${warnIco(`Zoning unresolved — ${t.replace(/\s*[—-]\s*unresolved\s*$/i, '')}. Confirm which applies.`)}`;
}
// Lot coverage per lot range: plat figure, any later change (and the case that made it); else base-zoning maximum.
function coverageCell(s) {
  const t = Array.isArray(s.setbackTable) ? s.setbackTable.filter(r => r.coverage || r.coverageNow) : [];
  if (t.length) return t.map(r => {
    const label = t.length > 1 || (r.lots && !/^all$/i.test(r.lots)) ? `<b>Lots ${esc(r.lots)}:</b> ` : '';
    const chg = r.coverageNow ? ` → <b class="chg">${esc(r.coverageNow)}</b> ${warnIco(`Changed from ${r.coverage || 'the plat figure'} to ${r.coverageNow}${r.coverageBy ? ` by ${r.coverageBy}` : ''}. Verify against the case file.`)}` : '';
    return `<div>${label}${esc(r.coverage || '—')} <span class="sub">plat</span>${chg}</div>`;
  }).join('').replace(/^/, '<div class="sb-lines">') + '</div>';
  const keys = String(s.baseZoning || '').split(/[\/,;]|\bvs\b/i).map(z => normalizeDistrict(z.trim())).filter(Boolean);
  const uniq = [...new Set(keys)];
  if (!uniq.length) return '—';
  if (uniq.length > 1) return `${uniq.map(k => `${DISTRICTS[k].cov}%`).join(' or ')} <span class="sub">base zoning</span> ${warnIco(`Zoning unresolved — confirm which applies: ${uniq.map(k => `${k} ${DISTRICTS[k].cov}%`).join(' vs ')}`)}`;
  return `${DISTRICTS[uniq[0]].cov}% <span class="sub">${uniq[0]} base zoning</span>`;
}
function renderDB() {
  const q = ($('#db-q').value || '').toLowerCase();
  const rows = (S.db?.subdivisions || []).filter(s => !q || JSON.stringify(s).toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  $('#db-count').textContent = `${S.db?.subdivisions.length || 0} subdivisions`;
  $('#db-dirty').hidden = !S.dbDirty;
  $('#db-body').innerHTML = rows.map(s => `<tr data-name="${esc(s.name)}">
    <td><b>${esc(s.name)}</b>${noteWarnings(s.notes).length ? ' ' + warnIco(noteWarnings(s.notes).join(' • ')) : ''}<div class="sub">${zoningCell(s.baseZoning)}</div></td>
    <td>${esc(s.mcr)}</td>
    <td>${s.rec ? `<a href="${esc(s.platUrl)}" target="_blank" rel="noopener noreferrer">${esc(s.docType)} #${esc(s.rec)}</a><div class="sub">${esc(s.recorded)}</div>` : `<a href="${esc(s.platUrl || '#')}" target="_blank" rel="noopener noreferrer">Find plat (MCR ${esc(s.mcr || '?')})</a> ${warnIco('Recording number not recorded yet — open the plat (the PLAT MAP row), then Edit this subdivision and enter its recording number and date.')}`}</td>
    <td>${s.totalLots ?? `— ${warnIco('Lot count not taken yet — open Edit and use "Count lots from Assessor".')}`}</td><td>${setbackCell(s)}</td><td>${coverageCell(s)}</td><td>${esc(s.lastUpdated)}</td>
    <td><button class="btn sm" data-edit="${esc(s.name)}">Edit</button></td></tr>`).join('') || '<tr><td colspan="8">No matches.</td></tr>';
}
$('#db-q').addEventListener('input', renderDB);
$('#db-body').addEventListener('click', (e) => { const n = e.target.dataset.edit; if (n) openEditor(S.db.subdivisions.find(s => s.name === n)); });
$('#db-new').addEventListener('click', () => openEditor(null));
$('#db-reload').addEventListener('click', () => loadDB().then(() => toast('Reloaded')));
$('#db-export').addEventListener('click', () => download('subdivision-plats.json', JSON.stringify(S.db, null, 2)));

const STBL = [['lots', 'Lots'], ['district', 'District'], ['front', 'Front ft'], ['rear', 'Rear ft'], ['side', 'Side ft'], ['street', 'Street-side ft'], ['height', 'Height'], ['coverage', 'Coverage (plat)'], ['coverageNow', 'Coverage now'], ['coverageBy', 'Changed by (case)'], ['width', 'Min width ft'], ['other', 'Other']];
const FIELDS = [
  ['name', 'Subdivision name (exact Assessor SubdivisionName)'], ['mcr', 'MCR book-page (e.g. 754-39)'], ['docType', 'Document type (PLAT MAP / SUR MAP)'],
  ['rec', 'Recording number'], ['recorded', 'Recorded date (YYYY-MM-DD)'], ['totalLots', 'Total lots (current Assessor count)'],
  ['baseZoning', 'Base zoning'], ['setbacks', 'Recorded setbacks (Front / Rear / Side / Street-side)'], ['height', 'Height limit'],
  ['controllingCases', 'Controlling cases (DMP / rezoning / CPA, with dates)'], ['easements', 'Easements recorded on the plat'], ['notes', 'Notes'], ['parcelsChecked', 'Parcels checked (comma-separated APNs)'],
];
function openEditor(rec, prefill = {}) {
  const d = $('#db-editor'); const isNew = !rec;
  const r = rec ? { ...rec } : { docType: 'PLAT MAP', lastUpdated: new Date().toISOString().slice(0, 10), ...prefill };
  $('#ed-title').textContent = isNew ? 'Add subdivision' : `Edit — ${r.name}`;
  $('#ed-form').innerHTML = FIELDS.map(([k, l]) => {
    const v = Array.isArray(r[k]) ? r[k].join(', ') : (r[k] ?? '');
    const big = ['notes', 'controllingCases', 'setbacks', 'height', 'easements'].includes(k);
    return `<label>${l}${big ? `<textarea name="${k}" rows="${k === 'notes' ? 5 : 2}">${esc(v)}</textarea>` : `<input name="${k}" value="${esc(v)}">`}</label>`;
  }).join('') + `<label class="row"><input type="checkbox" name="platControls" ${r.platControls ? 'checked' : ''}> Plat standards confirmed controlling (no newer case supersedes)</label>`
    + `<fieldset class="stbl"><legend>Recorded setback table (shown as the controlling table in Section 3)</legend><p class="sub">One row per lot range. Leave empty if the plat shows no setbacks. Lots: "All", "1-268", or "1-10, 15".</p><div class="tw"><table class="edit"><thead><tr>${STBL.map(([, l]) => `<th>${l}</th>`).join('')}<th></th></tr></thead><tbody id="ed-stbl"></tbody></table></div><button class="btn sm" type="button" id="ed-stbl-add">+ Add lot range</button></fieldset>`;
  const rowsIn = Array.isArray(r.setbackTable) && r.setbackTable.length ? r.setbackTable : [];
  const addRow = (x = {}) => $('#ed-stbl').insertAdjacentHTML('beforeend', `<tr>${STBL.map(([k]) => `<td><input data-s="${k}" value="${esc(x[k] ?? '')}" ${['front', 'rear', 'side', 'street', 'width'].includes(k) ? 'inputmode="decimal"' : ''}></td>`).join('')}<td><button class="btn sm ghost" type="button" data-sdel>✕</button></td></tr>`);
  rowsIn.forEach(addRow);
  $('#ed-stbl-add').onclick = () => addRow({ lots: rowsIn.length ? '' : 'All' });
  $('#ed-stbl').onclick = (e) => { if (e.target.hasAttribute('data-sdel')) e.target.closest('tr').remove(); };
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
  if (!r.name) { toast('Subdivision name is required', 'error'); return; }
  r.totalLots = r.totalLots === '' ? null : +r.totalLots;
  r.parcelsChecked = r.parcelsChecked ? r.parcelsChecked.split(/[,\s]+/).map(normalizeApn).filter(Boolean) : [];
  r.platControls = !!f.get('platControls');
  r.setbackTable = $$('#ed-stbl tr').map(tr => Object.fromEntries($$('input[data-s]', tr).map(i => { const k = i.dataset.s, v = i.value.trim(); return [k, ['front', 'rear', 'side', 'street', 'width'].includes(k) && v !== '' && !isNaN(+v) ? +v : v]; }))).filter(x => ['front', 'rear', 'side', 'street'].some(k => x[k] !== ''));
  if (r.setbackTable.length) { const m = r.setbackTable; r.setbacks = m.map(x => `${m.length > 1 ? `Lots ${x.lots}${x.district ? ` (${x.district})` : ''}: ` : ''}${x.front} ft / ${x.rear} ft / ${x.side} ft / ${x.street} ft`).join('. ') + (m.length === 1 ? ' (Front / Rear / Side / Street-side)' : ''); }
  r.platUrl = r.rec ? LINKS.recDoc(r.rec) : (r.mcr && r.mcr.includes('-') ? LINKS.recBook(...r.mcr.split('-')) : '');
  if (r.rec) r.autoAdded = false;
  r.platOcr = null;
  r.lastUpdated = new Date().toISOString().slice(0, 10);
  const orig = $('#db-editor').dataset.orig;
  const i = S.db.subdivisions.findIndex(s => s.name === (orig || r.name));
  if (i >= 0) S.db.subdivisions[i] = { ...S.db.subdivisions[i], ...r }; else S.db.subdivisions.push(r);
  S.dbDirty = true; $('#db-editor').close(); renderDB();
  toast('Changed locally — click "Save to GitHub" to commit');
});
$('#db-save').addEventListener('click', async () => {
  try {
    const latest = await readFile('data/subdivision-plats.json').then(f => (f.text ? JSON.parse(f.text).updated : '')).catch(() => '');
    if (latest && S.dbStamp && latest !== S.dbStamp && !confirm('The database was saved from another browser after you opened it. Saving now will overwrite those changes. Continue? (Cancel, then Reload, to get the latest first.)')) return;
    S.db.updated = new Date().toISOString();
    await writeFile('data/subdivision-plats.json', JSON.stringify(S.db, null, 2) + '\n', `Update subdivision database (${S.db.subdivisions.length} entries)`);
    S.dbDirty = false; S.dbStamp = S.db.updated; renderDB(); toast('Saved to GitHub — the published site updates in about a minute', 'ok');
  } catch (e) { toast(e.message, 'error'); }
});

// ---------------- lookup ----------------
// New subdivision found in a lookup → find its plat at the Recorder, open the plat PDF, add it to the database
// (no prompt), then OCR the scanned plat in the background and store the setbacks if they can be read.
const titleCase = (t) => String(t || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Mcr|Ii|Iii|Iv)\b/g, (m) => m.toUpperCase());
const sameName = (a, b) => String(a || '').toUpperCase() === String(b || '').toUpperCase();
// Merge one record onto the latest published database (so another browser's edits aren't lost) and commit it.
async function saveSubdivision(rec, message) {
  const f = await readFile('data/subdivision-plats.json'); const latest = f.text ? JSON.parse(f.text) : null;
  const base = latest && Array.isArray(latest.subdivisions) ? latest : S.db;
  const i = base.subdivisions.findIndex(x => sameName(x.name, rec.name));
  if (i >= 0) base.subdivisions[i] = { ...base.subdivisions[i], ...rec }; else base.subdivisions.push(rec);
  base.updated = new Date().toISOString();
  await writeFile('data/subdivision-plats.json', JSON.stringify(base, null, 2) + '\n', message);
  S.db = base; S.dbStamp = base.updated; S.dbDirty = false; renderDB();
}
function ocrStatus(msg, kind = '') {
  let el = $('#ocr-status');
  if (!el) { el = document.createElement('p'); el.id = 'ocr-status'; el.className = 'status'; $('#report').before(el); }
  el.hidden = !msg; el.className = `status ${kind}`; el.textContent = msg || '';
}
async function autoAddSubdivision(R) {
  const p = R.parcel; const [book, page] = String(p.MCRNumber || '').split('-');
  const searchUrl = book && page ? LINKS.recBook(book, page) : 'https://recorder.maricopa.gov/recording/document-search.html#tab-map-search';
  // open the tab now (while the click still counts as a user action); it is pointed at the plat once found
  let tab = null; try { tab = window.open('', '_blank'); if (tab) { tab.opener = null; tab.document.title = 'Opening plat…'; tab.document.body.textContent = 'Finding the recorded plat at the County Recorder…'; } } catch {}
  const [doc, lots] = await Promise.all([findPlatDoc(p.SubdivisionName, book, page).catch(() => null), countSubdivisionLots(p.SubdivisionName).catch(() => null)]);
  if (tab) {
    if (doc) platPdfLink(doc.rec).then(u => { tab.location.href = u; }).catch(() => { tab.location.href = LINKS.recDoc(doc.rec); });
    else tab.location.href = searchUrl;
  }
  const today = new Date().toISOString().slice(0, 10);
  const rec = {
    name: titleCase(p.SubdivisionName), mcr: p.MCRNumber || '', docType: 'PLAT MAP', rec: doc ? doc.rec : '', recorded: doc ? doc.recorded : '', totalLots: lots,
    baseZoning: R.zoning.map(z => z.zone).join(', '),
    controllingCases: [...R.currentCases, ...R.historicCases].filter(c => /Rezoning|Zoning Case|Development Master|Comprehensive|Overlay/.test(c.type)).map(c => `${c.permit} (${c.date || '?'}, ${c.status || '?'})`).join('; '),
    setbacks: 'Not yet reviewed', height: 'Not yet reviewed', easements: '', platControls: false, setbackTable: [],
    notes: `⚠ Plat not yet reviewed — added automatically from a lookup of ${R.apn} on ${today}. Open the plat and record its ${doc ? '' : 'recording number, '}setbacks, height and easements.`,
    parcelsChecked: [R.apn], platUrl: doc ? LINKS.recDoc(doc.rec) : searchUrl, autoAdded: true, lastUpdated: today,
  };
  S.db = S.db || { schema: 1, subdivisions: [] };
  if (S.db.subdivisions.some(x => sameName(x.name, rec.name))) return;
  S.db.subdivisions.push(rec); renderDB();
  let saved = false;
  if (gh.canWrite) {
    try { await saveSubdivision(rec, `Add subdivision ${rec.name} (auto, from ${R.apn})`); saved = true; }
    catch (e) { S.dbDirty = true; renderDB(); toast(`Added ${rec.name} locally, but saving failed: ${e.message}`, 'error'); }
  } else { S.dbDirty = true; renderDB(); }
  toast(`New subdivision "${rec.name}" added${saved ? ' and saved' : ' (not saved — connect GitHub)'}${doc ? ` · plat #${doc.rec}` : ' · plat not found by name'}${tab ? '' : ' · popup blocked — use the plat link in the report'}.`, saved ? 'ok' : 'info');
  if (doc) readPlat(rec.name, doc.rec); // background — the report renders now
}
// OCR the plat; if setbacks are found, store them (flagged for verification) and save to GitHub.
const ocrRunning = new Set();
async function readPlat(name, recNo) {
  if (ocrRunning.has(name)) return; ocrRunning.add(name);
  const say = (m) => ocrStatus(`Reading the ${name} plat (OCR): ${m}…`);
  try {
    say('downloading the plat from the Recorder');
    const bytes = await fetchPlatPdf(recNo);
    const res = await ocrPlat(bytes, { onStep: say });
    const P = res.parsed; const r = S.db.subdivisions.find(x => sameName(x.name, name));
    if (!r) return ocrStatus('');
    if (!P.rows.length) { ocrStatus(`OCR could not find a setback table on sheet${res.pagesRead > 1 ? `s 1–${res.pagesRead}` : ' 1'} of the ${name} plat — read it manually and update the database.`, 'warn'); return; }
    const today = new Date().toISOString().slice(0, 10);
    const rows = P.rows.map(x => ({ lots: x.lots, district: x.district || '', front: x.front ?? '', rear: x.rear ?? '', side: x.side ?? '', street: x.street ?? '', height: P.height || '', coverage: P.coverage || '', coverageNow: '', coverageBy: '', width: '', other: 'Read by OCR — verify' }));
    const upd = {
      setbackTable: rows,
      setbacks: rows.map(x => `${rows.length > 1 ? `Lots ${x.lots}${x.district ? ` (${x.district})` : ''}: ` : ''}${x.front || '?'} ft / ${x.rear || '?'} ft / ${x.side || '?'} ft / ${x.street || '?'} ft`).join('. ') + (rows.length === 1 ? ' (Front / Rear / Side / Street-side)' : ''),
      height: P.height || r.height, easements: r.easements || P.easements.join('; '),
      notes: `⚠ Setbacks read automatically by OCR from sheet${res.pagesRead > 1 ? `s 1–${res.pagesRead}` : ' 1'} of the plat on ${today} — verify against the plat, then save the record from the editor to clear this flag. OCR text: "${P.excerpt.trim().slice(0, 240)}"`,
      platOcr: { date: today, rec: recNo, pagesRead: res.pagesRead, pageCount: res.pageCount }, lastUpdated: today,
    };
    Object.assign(r, upd); renderDB();
    if (gh.canWrite) {
      await saveSubdivision({ ...r }, `Plat OCR: setbacks for ${r.name} (verify)`);
      ocrStatus(`Setbacks read from the ${name} plat and saved to the database — flagged "verify" until you check them against the plat.`, 'ok');
    } else { S.dbDirty = true; renderDB(); ocrStatus(`Setbacks read from the ${name} plat (not saved — connect GitHub, then Save in the SubdivisionDB tab). Verify against the plat.`, 'ok'); }
    if (S.R && sameName(S.R.parcel.SubdivisionName, name)) { $('#report').innerHTML = renderReportHTML(S.R, S.db); S.md = renderReportMD(S.R, S.db, S.extras); }
  } catch (e) { ocrStatus(`Couldn't read the ${name} plat automatically: ${e.message}. Open it from the report and update the database manually.`, 'warn'); }
  finally { ocrRunning.delete(name); }
}
const lookupCache = new Map(); // APN → { R, t } — avoids re-querying county GIS for 15 min
async function runLookup(apn, { force = false } = {}) {
  const out = $('#report'); const st = $('#lookup-status');
  out.innerHTML = ''; $('#report-actions').hidden = true; st.hidden = false; st.className = 'status';
  try {
    if (!S.db) await loadDB().catch(() => {});
    S.extras = {};
    const key = normalizeApn(apn); const hit = key && lookupCache.get(key);
    if (!force && hit && Date.now() - hit.t < 15 * 60000) S.R = hit.R;
    else { S.R = await lookupParcel(apn, { onStep: (m) => (st.textContent = `Querying: ${m}…`) }); lookupCache.set(S.R.apn, { R: S.R, t: Date.now() }); }
    st.hidden = true;
    if (S.R.parcel.SubdivisionName && !findPlat(S.R, S.db) && !S.R.outsideCounty) await autoAddSubdivision(S.R);
    out.innerHTML = renderReportHTML(S.R, S.db);
    const age = Math.round((Date.now() - lookupCache.get(S.R.apn).t) / 60000);
    if (age >= 1) out.insertAdjacentHTML('afterbegin', `<p class="meta">Cached result from ${age} min ago · <button class="link" data-act="refresh">refresh from county GIS</button></p>`);
    S.md = renderReportMD(S.R, S.db, S.extras);
    $('#report-actions').hidden = false;
    drawMap(S.R);
    $('#lookup-apn').value = S.R.apn;
    history.replaceState(null, '', `?apn=${S.R.apn}#lookup`);
    // carry context into the plan review
    const z = S.R.zoning[0]?.zone; const k = normalizeDistrict(z);
    Object.assign(S.review, { apn: S.R.apn, lotArea: S.R.parcel.areaSqFt, district: k || S.review.district });
    const plat = findPlat(S.R, S.db);
    const ps = platSetbacks(plat, S.R.parcel.Lot);
    if (ps.match) { S.review.platSetbacks = { front: ps.match.front ?? '', rear: ps.match.rear ?? '', side: ps.match.side ?? '', street: ps.match.street ?? '' }; $('#plat-hint').innerHTML = `Recorded plat setbacks filled in from <b>${esc(plat.name)}</b>${ps.rows.length > 1 ? ` (lots ${esc(ps.match.lots)})` : ''}.`; }
    else { S.review.platSetbacks = { front: '', rear: '', side: '', street: '' }; $('#plat-hint').innerHTML = plat ? (ps.rows.length ? `Plat <b>${esc(plat.name)}</b> has several lot ranges — enter the applicable BSLs below.` : `Plat <b>${esc(plat.name)}</b> shows no setbacks — MCZO governs.`) : ''; }
    saveDraft(S.review); renderReview();
  } catch (e) { st.className = 'status err'; st.textContent = e.message; }
}
$('#lookup-form').addEventListener('submit', (e) => { e.preventDefault(); runLookup($('#lookup-apn').value); });
$('#report').addEventListener('click', async (e) => {
  const act = e.target.dataset.act; if (!act || !S.R) return;
  if (act === 'refresh') { runLookup(S.R.apn, { force: true }); return; }
  if (act === 'edit-plat') { const rec = (S.db?.subdivisions || []).find(x => x.name === e.target.dataset.name); if (rec) { showTab('p-subs'); renderDB(); openEditor(rec); } else toast('That subdivision is no longer in the database', 'error'); return; }
  if (act === 'multi') { const open = e.target.getAttribute('aria-expanded') !== 'true'; e.target.setAttribute('aria-expanded', open); e.target.textContent = e.target.textContent.replace(/^[▸▾]/, open ? '▾' : '▸'); $$(`#report tr.multi-row[data-grp="${e.target.dataset.grp}"]`).forEach(tr => (tr.hidden = !open)); return; }
  if (act === 'addl') { const open = e.target.getAttribute('aria-expanded') !== 'true'; e.target.setAttribute('aria-expanded', open); e.target.textContent = `${open ? '▾' : '▸'} Additional Info`; $$('#report tr.addl').forEach(tr => (tr.hidden = !open)); return; }
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
  try { await writeFile(`data/parcels/${S.R.apn}.md`, S.md + '\n', `Parcel report ${S.R.apn} (${S.R.lookupDate})`); clearDirCache(); toast('Report saved to GitHub', 'ok'); } catch (e) { toast(e.message, 'error'); }
});
$('#rep-print').addEventListener('click', () => window.print());

let leafletP = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (!leafletP) leafletP = new Promise((res, rej) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.append(css);
    const js = document.createElement('script'); js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'; js.onload = res; js.onerror = rej; document.head.append(js);
  });
  return leafletP;
}
async function drawMap(R) {
  if (!R.wgsRings) { $('#map').hidden = true; return; }
  try { await loadLeaflet(); } catch { $('#map').hidden = true; return; }
  $('#map').hidden = false;
  if (!S.map) {
    S.map = L.map('map', { zoomControl: true, attributionControl: true });
    const img = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' });
    const st = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 19, attribution: '© Esri' });
    img.addTo(S.map); L.control.layers({ Aerial: img, Streets: st }).addTo(S.map);
  }
  if (S.layer) S.layer.remove();
  S.layer = L.polygon(R.wgsRings.map(r => r.map(([x, y]) => [y, x])), { color: '#2ec4d0', weight: 3, fillOpacity: 0.12 }).addTo(S.map);
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
  let tmr; const upd = () => { saveDraft(S.review); clearTimeout(tmr); tmr = setTimeout(renderOutput, 120); };
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
  $('#rv-copy').addEventListener('click', () => { renderOutput(); copy($('#rv-md').value); });
  $('#rv-dl').addEventListener('click', () => renderOutput() || download(`review-${S.review.apn || 'plan'}-${S.review.date}.md`, $('#rv-md').value));
  $('#rv-save').addEventListener('click', async () => {
    renderOutput();
    try { const p = `data/reviews/${S.review.apn || 'no-apn'}-${S.review.date}-${S.review.type}.md`; await writeFile(p, $('#rv-md').value + '\n', `Plan review ${S.review.apn} ${S.review.type}`); await writeFile(p.replace(/\.md$/, '.json'), JSON.stringify(S.review, null, 2), `Plan review data ${S.review.apn}`); clearDirCache(); toast('Review saved to GitHub', 'ok'); } catch (e) { toast(e.message, 'error'); }
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

// ---------------- lot-split legality screen ----------------
async function checkSplit(apnIn) {
  const st = $('#ls-status'), out = $('#ls-out'); out.innerHTML = ''; st.hidden = false; st.className = 'status';
  try {
    const key = normalizeApn(apnIn); if (!key) throw new Error('Enter an APN like 401-52-034C.');
    st.textContent = 'Looking up the parcel…';
    const hit = lookupCache.get(key);
    const R = hit && Date.now() - hit.t < 15 * 60000 ? hit.R : await lookupParcel(key);
    lookupCache.set(R.apn, { R, t: Date.now() });
    if (R.outsideCounty) { st.hidden = true; out.innerHTML = `<div class="note">${esc(R.apn)} is inside ${esc(R.city || 'an incorporated city')} — county land-division rules don't apply; the city's rules govern.</div>`; return; }
    st.textContent = 'Finding parcels split from the same parent…';
    const S2 = await lookupSplit(R); st.hidden = true;
    const zone = R.zoning[0]?.zone; const dk = normalizeDistrict(zone); const d = dk ? DISTRICTS[dk] : null;
    const ps = S2.parcels; const n = ps.length; const suffixed = ps.filter(p => /[A-Z]$/.test(p.apn)).length;
    const all36 = n > 0 && ps.every(p => p.acres >= 36);
    const small = d ? ps.filter(p => p.sqft < d.area) : [];
    const subj = ps.find(p => p.apn === R.apn) || { sqft: R.parcel.areaSqFt, acres: R.parcel.areaAcres };
    const platted = !!R.parcel.SubdivisionName;
    const owners = [...new Set(ps.map(p => p.owner).filter(Boolean))];
    const findings = []; // [status, text]
    let verdict, cls; const noSplit = n <= 1 && !/[A-Z]$/.test(R.apn);
    if (n <= 1 && !/[A-Z]$/.test(R.apn)) { verdict = 'No split detected'; cls = 'ok'; findings.push(['ok', `No other parcels share ${S2.base}; the Assessor record shows no split of this parcel.`]); }
    else if (all36) { verdict = 'Exempt — all parcels are 36 acres or more'; cls = 'ok'; findings.push(['ok', `All ${n} parcels from ${S2.base} are ≥ 36 ac, so this is neither a subdivision nor a minor land division (MCSR §105.24/.38).`]); }
    else if (n >= 6) { verdict = 'Possible illegal subdivision — refer for review'; cls = 'bad'; findings.push(['bad', `${n} parcels have been created from parent ${S2.base} and not all are ≥ 36 ac. Six or more lots requires a recorded subdivision plat (MCSR §103, §105.38; A.R.S. 32-2101).${platted ? ' Inside a recorded subdivision, 6+ adjoining lots requires a replat (MCSR §204).' : ''} Per DD-2013-10, no zoning approval unless ADRE confirms in writing that the split is lawful.`]); }
    else { verdict = small.length ? 'Split count OK — but lot size problem' : 'Appears consistent with a lawful minor land division'; cls = small.length ? 'warn' : 'ok'; findings.push(['ok', `${n} parcel${n > 1 ? 's' : ''} from parent ${S2.base} — within the 5-lot minor land division limit (MCSR §105.24; DD-2013-10).`]); }
    if (d) {
      if (small.length) findings.push(['bad', `${small.length} parcel${small.length > 1 ? 's are' : ' is'} below the ${dk} minimum of ${d.area.toLocaleString()} sq ft: ${small.map(p => `${p.apn} (${p.sqft.toLocaleString()} sf)`).join(', ')}. A lot created below the minimum after zoning applied is not a lawful lot; one created earlier may be legal nonconforming — check the deed date.`]);
      else if (n) findings.push(['ok', `All parcels meet the ${dk} minimum lot area of ${d.area.toLocaleString()} sq ft.`]);
      if (d.width && !noSplit && !all36) findings.push(['verify', `Lot width minimum ${d.width} ft (${dk}) — measure each new lot on the survey; not computed here.`]);
    } else findings.push(['verify', `Zoning "${zone || '—'}" not matched to a standards table — check lot area and width manually.`]);
    if (S2.street?.error) findings.push(['verify', `Street access not checked (${S2.street.error}).`]);
    else if (S2.street && S2.street.d <= 60) findings.push(['ok', `Street frontage likely: ${S2.street.name} is ~${S2.street.d} ft from the parcel.`]);
    else findings.push(['verify', `No street centerline within ~60 ft${S2.street ? ` (nearest: ${S2.street.name}, ~${S2.street.d} ft)` : ''}. Each lot needs legal access — confirm a recorded ingress/egress easement (MCR #) (MCSR §105.21).`]);
    if (!all36 && owners.length && owners.length < n && n > 1) findings.push(['verify', `${n} parcels, ${owners.length} owner${owners.length > 1 ? 's' : ''} — parcels sold by one owner or a group acting together can count as one common promotional plan (MCSR §105.10).`]);
    if (!noSplit && !all36) findings.push(['verify', 'Confirm the division was made by recorded deeds and that existing buildings meet setbacks to the new lot lines (DD-2013-10 ¶2).']);
    if (noSplit) findings.push(['verify', 'Some splits get new Assessor item numbers instead of suffix letters — if this lot looks carved from a neighbor, check the Assessor parcel history.']);
    else if (suffixed < n - 1) findings.push(['verify', 'Some splits may carry new Assessor item numbers instead of suffix letters; check the Assessor parcel history for parcels not listed here.']);
    const icon = { ok: '✅', bad: '❌', verify: '⚠️' };
    out.innerHTML = `<div class="card result ${cls}"><h3>${esc(verdict)}</h3><p class="sub">${esc(R.apn)} · ${esc(zone || 'zoning ?')} · ${subj.sqft?.toLocaleString?.() || '—'} sf (${subj.acres} ac)${platted ? ` · ${esc(R.parcel.SubdivisionName)}${R.parcel.Lot ? ` lot ${esc(R.parcel.Lot)}` : ''}` : ''}</p>
      <ul class="findings">${findings.map(([k, t]) => `<li class="${k === 'bad' ? 'deficient' : k}">${icon[k]} ${esc(t)}</li>`).join('')}</ul></div>
      <div class="tw"><table><thead><tr><th>Parcel</th><th>Area</th><th>Owner</th><th>Deed date</th><th>Address</th></tr></thead><tbody>${ps.map(p => `<tr${p.apn === R.apn ? ' class="me"' : ''}><td><a href="?apn=${p.apn}#lookup">${esc(p.apn)}</a></td><td>${p.sqft.toLocaleString()} sf · ${p.acres} ac${d && p.sqft < d.area ? ' <b class="bad">below min</b>' : ''}</td><td>${esc(p.owner || '—')}</td><td>${esc(p.deedDate || '—')}</td><td>${esc(p.addr || '—')}</td></tr>`).join('')}</tbody></table></div>
      <p class="sub">Screening based on Assessor records, not a legal determination. Basis: MCSR §103, §105.10, §105.21, §105.24, §105.38, §204; <a href="https://www.maricopa.gov/6416/Subdivisions---Replats-and-Lot-Splits-20" target="_blank" rel="noopener">DD-2013-10</a>; A.R.S. 11-831, 32-2101.</p>`;
  } catch (e) { st.className = 'status err'; st.textContent = e.message; }
}
$('#ls-form').addEventListener('submit', (e) => { e.preventDefault(); checkSplit($('#ls-apn').value); });

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
  const off = !location.hostname.endsWith('github.io') && !/localhost|127\.0\.0\.1/.test(location.hostname);
  $('#st-host').hidden = !off;
  $('#st-proxy').value = settings.localProxy || settings.sharedProxy; $('#st-force').checked = settings.forceProxy;
  $('#st-relay-note').textContent = settings.sharedProxy ? (settings.localProxy && settings.localProxy !== settings.sharedProxy ? `This browser overrides the shared relay (${settings.sharedProxy}).` : '✓ Shared relay — filled in automatically on every browser.') : 'Not shared yet — after Test GitHub succeeds here, this address is saved for all your browsers.';
  $('#st-owner').value = gh.owner; $('#st-repo').value = gh.repo; $('#st-branch').value = gh.branch; $('#st-token').value = gh.token ? '••••••••' : ''; $('#st-pass').value = gh.passphrase ? '••••••••' : '';
  $('#gh-badge').textContent = gh.canWrite ? `✓ Saving to ${gh.owner}/${gh.repo}${gh.viaRelay ? ' (relay)' : ''}` : '⚙ Connect GitHub to save';
  $('#gh-badge').className = `badge ${gh.canWrite ? 'ok' : ''}`;
}
$('#st-save').addEventListener('click', () => {
  { const v = $('#st-proxy').value.trim().replace(/\/+$/, ''); settings.proxy = v && v !== settings.sharedProxy ? v : ''; } settings.forceProxy = $('#st-force').checked;
  if (!storageWorks()) { toast('This browser is blocking site storage (private/incognito mode or an in-app browser), so the token cannot be kept. Open the site in regular Safari or Chrome.', 'error'); return; }
  const pass = $('#st-pass').value; if (!pass.startsWith('••')) gh.passphrase = pass.trim();
  const tok = $('#st-token').value.trim();
  if (tok && !tok.startsWith('••') && !/^(github_pat_|ghp_)/.test(tok)) { toast('That does not look like a GitHub token — it should start with github_pat_', 'error'); return; }
  gh.save({ owner: $('#st-owner').value.trim(), repo: $('#st-repo').value.trim(), branch: $('#st-branch').value.trim() || 'main', token: tok.startsWith('••') ? undefined : tok });
  renderSettings();
  if (gh.canWrite) { toast(`Saved — connected to ${gh.owner}/${gh.repo}. Now tap Test GitHub.`, 'ok'); }
  else toast(`Not connected yet: ${gh.passphrase && !settings.proxy ? 'add the Relay URL (the passphrase works through the relay)' : !gh.token && !gh.passphrase ? 'enter your passphrase (or a token)' : 'owner and repository are required'}.`, 'error');
  loadDB().catch(() => {});
});
$('#st-forget').addEventListener('click', () => { gh.save({ owner: $('#st-owner').value, repo: $('#st-repo').value, branch: $('#st-branch').value, token: '' }); gh.passphrase = ''; renderSettings(); toast('Passphrase and token removed from this browser'); });
$('#st-copy-relay').addEventListener('click', async () => {
  try { const t = await (await fetch(`worker/cors-proxy.js?t=${Date.now()}`, { cache: 'no-store' })).text(); await navigator.clipboard.writeText(t); toast(`Relay code copied (${t.split('\n').length} lines) — paste it into Cloudflare and Deploy`, 'ok'); }
  catch (e) { toast('Copy blocked by the browser — use "View relay code", then select all and copy', 'error'); }
});
$('#st-test-gis').addEventListener('click', async () => { const o = $('#st-test-out'); o.textContent = 'Testing county GIS…'; try { o.textContent = `County GIS reachable (${await ping()} ms).`; } catch (e) { o.textContent = e.message; } });
$('#st-test-gh').addEventListener('click', async () => { const o = $('#st-test-out'); o.textContent = 'Testing GitHub…'; try { const r = await testAccess(); o.textContent = `${r.name}: ${r.canPush ? 'write access OK' : 'READ-ONLY — on GitHub, edit the token: Repository access must include randalkidd/MC and Contents must be Read and write'}${r.private ? ' (private repo — Pages needs a paid plan)' : ''}`; if (r.canPush && gh.viaRelay) { try { if (await shareRelayIfNeeded()) { o.textContent += ' · Relay address shared — other browsers now need only the passphrase.'; renderSettings(); } } catch (e) { o.textContent += ` · Couldn't share relay address: ${e.message}`; } } } catch (e) { o.textContent = e.message; } });

$('#gh-badge').addEventListener('click', () => { showTab('p-settings'); setTimeout(() => $('#st-pass').focus(), 50); });

function syncThemeBtn() { const light = document.documentElement.dataset.theme === 'light'; $('#theme-btn').textContent = light ? '☾' : '☀'; document.querySelector('meta[name=theme-color]').content = light ? '#f2f6f7' : '#0d1418'; }
$('#theme-btn').addEventListener('click', () => {
  const light = document.documentElement.dataset.theme !== 'light';
  if (light) document.documentElement.dataset.theme = 'light'; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('mc.theme', light ? 'light' : 'dark'); } catch {}
  syncThemeBtn();
});
syncThemeBtn();

// Recorder search links: copy the number so it can be pasted into "Recorded Document Number" (the page can't be pre-filled).
document.addEventListener('click', (e) => { const l = e.target.closest('a.rec-copy'); if (!l) return; navigator.clipboard?.writeText(l.dataset.num).then(() => toast(`${l.dataset.num} copied — paste it into "Recorded Document Number" on the Recorder page`, 'ok'), () => toast(`Type ${l.dataset.num} into "Recorded Document Number" on the Recorder page`)); });
document.addEventListener('click', (e) => { const j = e.target.closest('[data-jump]'); if (!j) return; e.preventDefault(); showTab('p-ref'); setTimeout(() => document.getElementById(j.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); });

// Floating tooltip for ⚠ icons: fixed to the window and clamped to its edges, so it is never clipped by tables.
(() => {
  let tip = null, owner = null, shownAt = 0;
  const hide = () => { tip?.remove(); tip = null; owner = null; };
  const show = (el) => {
    if (owner === el) return; hide(); owner = el; shownAt = Date.now();
    tip = document.createElement('div'); tip.className = 'floattip'; tip.textContent = el.dataset.tip; document.body.append(tip);
    const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect(), pad = 8;
    let left = r.left + r.width / 2 - t.width / 2; left = Math.max(pad, Math.min(left, window.innerWidth - t.width - pad));
    let top = r.top - t.height - 8; if (top < pad) top = r.bottom + 8;
    tip.style.left = `${left}px`; tip.style.top = `${top}px`;
  };
  document.addEventListener('mouseover', (e) => { const w = e.target.closest('.warnico'); if (w) show(w); else if (owner && !e.target.closest('.floattip')) hide(); });
  document.addEventListener('focusin', (e) => { const w = e.target.closest('.warnico'); if (w) show(w); });
  document.addEventListener('focusout', (e) => { if (e.target.closest('.warnico')) hide(); });
  document.addEventListener('click', (e) => { const w = e.target.closest('.warnico'); if (w) { if (owner === w && Date.now() - shownAt > 400) hide(); else show(w); } else hide(); });
  window.addEventListener('scroll', hide, true); window.addEventListener('resize', hide);
})();

window.addEventListener('error', (e) => { if (e.message && !/ResizeObserver/.test(e.message)) toast(`Something went wrong: ${e.message}`, 'error'); });
window.addEventListener('unhandledrejection', (e) => { const m = (e.reason && (e.reason.message || String(e.reason))) || 'unknown error'; toast(`Something went wrong: ${m}`, 'error'); });

// ---------------- init ----------------
async function loadSharedConfig() {
  try { const f = await readFile('data/site-config.json'); if (f.text) { const c = JSON.parse(f.text); setSharedRelay(c.relayUrl); } } catch {}
  renderSettings();
}
// After a successful relay test, publish the relay address for every browser (address only — never the passphrase or token).
async function shareRelayIfNeeded() {
  if (!settings.localProxy || settings.localProxy === settings.sharedProxy) return false;
  await writeFile('data/site-config.json', JSON.stringify({ relayUrl: settings.localProxy, updated: new Date().toISOString().slice(0, 10) }, null, 2) + '\n', 'Share relay address with all browsers');
  setSharedRelay(settings.localProxy); return true;
}

bindReview(); renderReview(); renderReference(); renderSettings(); classify(); loadSharedConfig();
loadDB().catch(e => { $('#db-source').textContent = `Could not load database: ${e.message}`; });
const qApn = new URLSearchParams(location.search).get('apn');
const hashTab = location.hash ? `p-${location.hash.slice(1)}` : null;
let start = 'p-lookup'; try { start = localStorage.getItem('mc.tab') || start; } catch {}
showTab(document.getElementById(hashTab || '') ? hashTab : start);
if (qApn) { showTab('p-lookup'); $('#lookup-apn').value = qApn; runLookup(qApn); }
