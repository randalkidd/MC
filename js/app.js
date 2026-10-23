import { lookupParcel, lookupRoads, lookupTSP, lookupSeptic, countSubdivisionLots, ping, LINKS, EP, normalizeApn, lookupSplit } from './lookup.js?v=9bac9315';
import { renderReportHTML, renderReportMD, findPlat, platSetbacks } from './report.js?v=9bac9315';
import { settings, setSharedRelay } from './net.js?v=9bac9315';
import { ACCENTS, currentAccent } from './accents.js?v=9bac9315';
import { gh, readFile, writeFile, listDir, testAccess, storageWorks, clearDirCache, perms, hasPerm, relayFetch } from './github.js?v=9bac9315';
import { DISTRICTS, normalizeDistrict, ACCESSORY_RULES, SEPTIC_SAMPLE_SETBACKS, MCZO_URL } from './standards.js?v=9bac9315';
import { CHECKLISTS } from './checklists.js?v=9bac9315';
import { loadDraft, saveDraft, blankReview, computeFindings, checklistRows, buildMarkdown, markupRows, rememberReviewer, rememberedReviewer } from './review.js?v=9bac9315';
let REF = null; // js/refdata.js (76 KB) loads the first time the Reference tab opens
import { findPlatDoc } from './recorder.js?v=9bac9315';
import { loadAllSubdivisions } from './subdivisions.js?v=9bac9315';

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
const SITE_TITLE = 'Unofficial Maricopa County Zoning Hub';
const S = { R: null, md: '', extras: {}, db: null, dbSha: null, dbDirty: false, map: null, layer: null, review: loadDraft() };

// ---------------- tabs ----------------
// ---------------- access gate ----------------
// Plan review, Land division, SubdivisionDB and Saved Parcels appear only after this browser has a passphrase and a relay that
// passed "Test GitHub" (write access through the relay). Client-side only: it hides the tools, it does not secure
// public data — saving is what the relay's passphrase actually protects.
const GATED = ['p-review', 'p-subs', 'p-saved', 'p-profile'];
let unlocked = false;
const ACCESS_KEY = 'mc.access';
async function accessFingerprint() {
  if (!gh.viaRelay) return '';
  const data = new TextEncoder().encode(`${settings.proxy}\n${gh.passphrase}`);
  const d = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// Top-right badge: "Connected" once passphrase + relay have passed Test GitHub, otherwise "Not Connected" (yellow).
function renderBadge() {
  const b = $('#gh-badge'); if (!b) return;
  b.textContent = unlocked ? 'Connected' : 'Not Connected';
  b.className = `badge ${unlocked ? 'ok' : 'no'}`;
  b.title = unlocked ? `${userName()} - Profile Page` : 'Not signed in: click to sign in with your name and passphrase';
}
const PERM_LIST = ['review', 'write', 'queue', 'rapid', 'admin'];
// ---------------- account type / user name ----------------
function userName() { let n = ''; try { n = localStorage.getItem('mc.name') || ''; } catch {} const l = perms().label; return (l && l !== 'Super account' ? l : '') || n || l || 'Signed in'; }
function accountType(pp = perms()) {
  const p = new Set(pp.perms || []);
  if (pp.super) return 'a Super Account';
  if (p.has('admin')) return 'an Administrator account';
  if (['review', 'write', 'queue', 'rapid'].every(x => p.has(x))) return 'a Senior Reviewer account';
  if (['review', 'write', 'queue'].every(x => p.has(x)) && p.size === 3) return 'a Reviewer account';
  if (p.size === 1 && p.has('review')) return 'a Read-Only account';
  return 'a custom account';
}

function applyAccess(on) {
  unlocked = !!on; renderBadge();
  document.documentElement.classList.toggle('locked', !unlocked);
  const mine = unlocked ? perms().perms : [];
  PERM_LIST.forEach(p => document.documentElement.classList.toggle(`perm-${p}`, mine.includes(p)));
  document.documentElement.classList.toggle('perm-settings', unlocked && (mine.includes('admin') || !!perms().legacy));
  if (S.tab === 'p-signin') renderSignin();
  $$('.tab.gated').forEach(b => (b.hidden = !unlocked));
  $('#landing').hidden = unlocked;
  if (!unlocked && GATED.includes(S.tab)) showTab('p-lookup');
  else if (S.tab && !tabAllowed(S.tab)) showTab('p-lookup');
  if (unlocked && hasPerm('admin')) renderKeys(false);
}
function tabAllowed(id) { const b = document.querySelector(`.tab[data-tab="${id}"]`); const need = b && b.dataset.perm; if (!need) return true; if (need === 'settings') return unlocked && (hasPerm('admin') || !!perms().legacy); return unlocked && hasPerm(need); }
function storePerms(r) {
  try { if (r && Array.isArray(r.perms)) localStorage.setItem('mc.perms', JSON.stringify({ perms: r.perms, label: r.label || '', super: !!r.super })); else localStorage.removeItem('mc.perms'); } catch {}
  // The name an administrator set for this key is the user's name everywhere (badge, reviewer, comment letter).
  if (r && r.label && r.label !== 'Super account') { try { if (localStorage.getItem('mc.name') !== r.label) { localStorage.setItem('mc.name', r.label); const who = rememberedReviewer(); rememberReviewer(r.label, who.email); if (S.review && (!S.review.reviewer || S.review.reviewer === who.name)) { S.review.reviewer = r.label; saveDraft(S.review); } } } catch {} }
}
async function grantAccess(r) {
  if (r) storePerms(r);
  try { localStorage.setItem(ACCESS_KEY, await accessFingerprint()); } catch {}
  applyAccess(true);
}
function revokeAccess() { try { localStorage.removeItem(ACCESS_KEY); localStorage.removeItem('mc.perms'); } catch {} applyAccess(false); }
// On load (and after settings change): unlock at once if this passphrase + relay were tested before, then re-check quietly.
async function checkAccess() {
  let saved = ''; try { saved = localStorage.getItem(ACCESS_KEY) || ''; } catch {}
  const fp = await accessFingerprint().catch(() => '');
  if (!fp || fp !== saved) return applyAccess(false);
  applyAccess(true);
  verifyAccess(); // network re-check runs in the background; it can only lock, never delay the page
}
let verifying = null;
function verifyAccess() {
  if (verifying) return verifying;
  return (verifying = testAccess().then((r) => { const okay = Array.isArray(r.perms) ? r.perms.length > 0 : r.canPush; if (!okay) return revokeAccess(); const before = JSON.stringify(perms().perms); storePerms(r); if (JSON.stringify(perms().perms) !== before) applyAccess(true); })
    .catch((e) => { if (/passphrase|token|GitHub \d|not the relay|old code/i.test(e.message)) { revokeAccess(); toast(`Locked staff tools: ${e.message}`, 'error'); } }) // offline → keep the tested state
    .finally(() => { verifying = null; }));
}

function showTab(id) {
  if (!unlocked && GATED.includes(id)) { id = 'p-lookup'; toast('Sign in first (your name and passphrase, then Test GitHub) to use this tool.'); }
  else if (unlocked && !tabAllowed(id)) { id = 'p-lookup'; toast('Your access key doesn\'t include this tool.'); }
  S.tab = id;
  $$('.tab').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === id));
  $$('.panel').forEach(p => (p.hidden = p.id !== id));
  try { localStorage.setItem('mc.tab', id); } catch {}
  if (id === 'p-lookup' && S.map) setTimeout(() => { S.map.invalidateSize(); S.map2?.invalidateSize(); if (S.mapRefit) refitMap(); }, 50);
  if (id === 'p-saved') renderSaved();
  if (id === 'p-review') { renderQueued(); (window.requestIdleCallback || setTimeout)(() => { import('./freeread.js?v=9bac9315').catch(() => {}); import('./siteplan.js?v=9bac9315').catch(() => {}); }); }
  if (id === 'p-signin') renderSignin();
  if (id === 'p-profile') renderProfile();
  if (id === 'p-games') renderGames();
  if (id === 'p-settings' && hasPerm('admin')) loadFolderUsers();
  if (id === 'p-ref') renderReference();
  if (id === 'p-subs') { if (!$('#allsubs').classList.contains('collapsed')) openAllSubs(); fitDbRows(); }
  history.replaceState(null, '', `#${id.slice(2)}`);
}
$$('.tab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
document.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) { showTab(g.dataset.goto); if (g.dataset.goto === 'p-settings') setTimeout(() => $('#st-pass')?.focus(), 50); } });

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
const safeUrl = (u) => { try { const x = new URL(String(u), location.href); return /^https?:$/.test(x.protocol) ? x.href : '#'; } catch { return '#'; } };
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
    <td>${s.rec ? `<a href="${esc(safeUrl(s.platUrl))}" target="_blank" rel="noopener noreferrer">${esc(s.docType)} #${esc(s.rec)}</a><div class="sub">${esc(s.recorded)}</div>` : `<a href="${esc(safeUrl(s.platUrl || '#'))}" target="_blank" rel="noopener noreferrer">Find plat (MCR ${esc(s.mcr || '?')})</a> ${warnIco('Recording number not recorded yet — open the plat (the PLAT MAP row), then Edit this subdivision and enter its recording number and date.')}`}</td>
    <td>${s.totalLots ?? `— ${warnIco('Lot count not taken yet — open Edit and use "Count lots from Assessor".')}`}</td><td>${setbackCell(s)}</td><td>${coverageCell(s)}</td><td>${esc(s.lastUpdated)}</td>
    <td><button class="btn sm" data-edit="${esc(s.name)}">Edit</button></td></tr>`).join('') || '<tr><td colspan="8">No matches.</td></tr>';
  fitDbRows();
  renderQueue();
}
// SubdivisionDB shows at most 5 rows; the rest scroll under a sticky header.
function fitDbRows() {
  requestAnimationFrame(() => {
    const box = $('.db-scroll'); if (!box || box.offsetParent === null) return;
    const rows = $$('#db-body tr').slice(0, 5); const head = box.querySelector('thead');
    box.style.maxHeight = rows.length ? `${Math.ceil((head?.offsetHeight || 0) + rows.reduce((h, r) => h + r.offsetHeight, 0)) + 2}px` : '';
  });
}
$('#db-q').addEventListener('input', renderDB);
$('#db-body').addEventListener('click', (e) => { const n = e.target.dataset.edit; if (n) openEditor(S.db.subdivisions.find(s => s.name === n)); });
$('#db-new').addEventListener('click', () => openEditor(null));
$('#db-reload').addEventListener('click', () => loadDB().then(loadQueue).then(() => toast('Reloaded')));
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
// Subdivisions a lookup finds that aren't in SubdivisionDB go on a review list (data/subdivision-queue.json).
// Nothing opens automatically; "Process with Claude" in SubdivisionDB hands the list to Claude, which reads each
// plat, adds it to SubdivisionDB and removes it from the list.
const titleCase = (t) => String(t || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Mcr|Ii|Iii|Iv)\b/g, (m) => m.toUpperCase());
const sameName = (a, b) => String(a || '').toUpperCase() === String(b || '').toUpperCase();
const inDB = (name) => (S.db?.subdivisions || []).some(x => sameName(x.name, name));
const QUEUE = 'data/subdivision-queue.json';
const parseQueue = (f) => { let q = null; try { q = f && f.text ? JSON.parse(f.text) : null; } catch {} return q && Array.isArray(q.items) ? q : { schema: 1, items: [] }; };
async function loadQueue() {
  S.queue = parseQueue(await readFile(QUEUE).catch(() => null));
  S.queueGone = new Set();
  renderQueue();
}
// Read the latest published list, apply fn, drop anything already in SubdivisionDB or removed here, commit.
// Waitlist saves: changes apply locally at once, then quick successive changes are batched into ONE commit and
// commits run strictly one after another (parallel writes to the same file collide on GitHub with a 409).
let qPending = [], qWaiters = [], qTimer = null, qChain = Promise.resolve();
function saveQueue(fn, message) {
  S.queue = S.queue || { schema: 1, items: [] }; S.queueGone = S.queueGone || new Set();
  fn(S.queue);
  S.queue.items = S.queue.items.filter(x => !inDB(x.name) && !S.queueGone.has(x.name.toUpperCase()));
  renderQueue();
  if (!gh.canWrite) { toast('Waitlist updated in this browser only — connect GitHub to save it', 'info'); return Promise.resolve(); }
  qPending.push(message);
  return new Promise((res, rej) => { qWaiters.push({ res, rej }); clearTimeout(qTimer); qTimer = setTimeout(flushQueue, 900); });
}
function flushQueue() {
  const waiters = qWaiters.splice(0), msgs = qPending.splice(0);
  if (!waiters.length) return;
  qChain = qChain.then(async () => {
    const write = async () => {
      const q = parseQueue(await readFile(QUEUE).catch(() => null));
      // published copy + everything this browser knows (Pages lags ~1 min); removals made here stay removed
      for (const it of q.items) if (!S.queue.items.some(x => sameName(x.name, it.name))) S.queue.items.push(it);
      S.queue.items = S.queue.items.filter(x => !inDB(x.name) && !S.queueGone.has(x.name.toUpperCase()));
      S.queue.updated = new Date().toISOString();
      const msg = msgs.length === 1 ? msgs[0] : `Plat Automation Waitlist: ${msgs.length} changes — ${msgs.map(m => m.replace(/^Plat Automation Waitlist:\s*/, '')).join('; ')}`.slice(0, 200);
      await writeFile(QUEUE, JSON.stringify(S.queue, null, 2) + '\n', msg);
    };
    try { await write(); }
    catch (e) { if (!/409|422|does not match|expected/i.test(e.message)) throw e; await new Promise(r => setTimeout(r, 1500)); await write(); } // one retry on a version collision
    renderQueue();
  }).then(() => waiters.forEach(w => w.res()), (e) => { waiters.forEach(w => w.rej(e)); });
  qChain = qChain.catch(() => {}); // keep the chain alive after a failure
}
async function queueSubdivision(R) {
  if (!hasPerm('write')) return;
  const p = R.parcel; const name = p.SubdivisionName;
  if (!name || inDB(name)) return;
  if (!S.queue) await loadQueue();
  const today = new Date().toISOString().slice(0, 10);
  const have = S.queue.items.find(x => sameName(x.name, name));
  if (have) { if (!have.apns.includes(R.apn)) { have.apns.push(R.apn); have.lastSeen = today; renderQueue(); } return; } // no commit for a repeat
  const [book, page] = String(p.MCRNumber || '').split('-');
  const [doc, lots] = await Promise.all([findPlatDoc(name, book, page).catch(() => null), countSubdivisionLots(name).catch(() => null)]);
  const item = {
    name, displayName: titleCase(name), mcr: p.MCRNumber || '', rec: doc ? doc.rec : '', recorded: doc ? doc.recorded : '', totalLots: lots,
    baseZoning: R.zoning.map(z => z.zone).join(', '),
    controllingCases: [...R.currentCases, ...R.historicCases].filter(c => /Rezoning|Zoning Case|Development Master|Comprehensive|Overlay/.test(c.type)).map(c => `${c.permit} (${c.date || '?'}, ${c.status || '?'})`).join('; '),
    apns: [R.apn], firstSeen: today, lastSeen: today, status: 'pending',
  };
  S.queueGone.delete(name.toUpperCase());
  try { await saveQueue(q => { if (!q.items.some(x => sameName(x.name, name))) q.items.push(item); }, `Plat Automation Waitlist: add ${item.displayName} (from ${R.apn})`); toast(`"${item.displayName}" isn't in SubdivisionDB — added to the Plat Automation Waitlist`, 'info'); }
  catch (e) { toast(`Couldn't save the waitlist: ${e.message}`, 'error'); }
}
async function queueByName(name, mcr) {
  if (!hasPerm('write')) throw new Error('Your access key can\'t change the waitlist (needs "write").');
  if (inDB(name)) return toast(`${titleCase(name)} is already in SubdivisionDB`);
  if (!S.queue) await loadQueue();
  if (S.queue.items.some(x => sameName(x.name, name))) return toast(`${titleCase(name)} is already on the Plat Automation Waitlist`);
  const [book, page] = String(mcr || '').split('-'); const today = new Date().toISOString().slice(0, 10);
  const [doc, lots] = await Promise.all([findPlatDoc(name, book, page).catch(() => null), countSubdivisionLots(name).catch(() => null)]);
  const item = { name: name.toUpperCase(), displayName: titleCase(name), mcr: mcr || '', rec: doc ? doc.rec : '', recorded: doc ? doc.recorded : '', totalLots: lots,
    baseZoning: '', controllingCases: '', apns: [], firstSeen: today, lastSeen: today, status: 'pending', note: 'Added from All Subdivisions (no parcel lookup yet)' };
  S.queueGone?.delete(item.name);
  await saveQueue(q => { if (!q.items.some(x => sameName(x.name, name))) q.items.push(item); }, `Plat Automation Waitlist: add ${item.displayName} (from All Subdivisions)`);
  toast(`${item.displayName} added to the Plat Automation Waitlist`, 'ok');
}
function claudeRequest() {
  const items = (S.queue?.items || []).filter(x => !inDB(x.name));
  return `Process my SubdivisionDB Plat Automation Waitlist (${items.length} subdivision${items.length === 1 ? '' : 's'}: ${items.map(x => x.displayName || x.name).join('; ')}).\n\nFollow the routine in https://github.com/randalkidd/MC/blob/main/tools/process-subdivision-queue.md (repo randalkidd/MC; files data/subdivision-queue.json and data/subdivision-plats.json). Read each plat in the built-in browser on my computer, add the subdivision to SubdivisionDB, remove it from the review list when it's done, then commit and push to main.`;
}
function renderQueue() {
  const box = $('#queue'); if (!box) return;
  if (typeof AS !== 'undefined' && AS.rows && !$('#p-subs').hidden) renderAllSubs();
  const items = (S.queue?.items || []).filter(x => !inDB(x.name)).sort((a, b) => (a.firstSeen < b.firstSeen ? -1 : 1));
  $('#queue-count').textContent = items.length;
  $('#queue-run').disabled = $('#queue-copy').disabled = !items.length;
  $('#queue-body').innerHTML = items.map(x => `<tr>
    <td><b>${esc(x.displayName || x.name)}</b>${x.status === 'needs-manual' ? ' ' + warnIco(x.note || 'Claude could not read this plat — review it manually') : ''}<div class="sub">${zoningCell(x.baseZoning)}</div></td>
    <td>${esc(x.mcr)}</td>
    <td>${x.rec ? `<a href="${esc(LINKS.recDoc(x.rec))}" target="_blank" rel="noopener noreferrer">#${esc(x.rec)}</a><div class="sub">${esc(x.recorded)}</div>` : (String(x.mcr).includes('-') ? `<a href="${esc(LINKS.recBook(...x.mcr.split('-')))}" target="_blank" rel="noopener noreferrer">Find</a>` : '—')}</td>
    <td>${x.totalLots ?? '—'}</td><td class="sub">${esc((x.apns || []).join(', '))}</td><td>${esc(x.firstSeen)}</td>
    <td><button class="btn sm ghost" data-qdel="${esc(x.name)}" title="Remove from the waitlist">✕</button></td></tr>`).join('') || '<tr><td colspan="7" class="sub">Nothing waiting — every subdivision found by a lookup is in SubdivisionDB.</td></tr>';
}
$('#queue-body').addEventListener('click', async (e) => {
  const n = e.target.dataset.qdel; if (!n) return;
  S.queueGone.add(n.toUpperCase());
  try { await saveQueue(q => { q.items = q.items.filter(x => x.name !== n); }, `Plat Automation Waitlist: remove ${titleCase(n)}`); toast('Removed from the waitlist'); }
  catch (err) { toast(err.message, 'error'); }
});
$('#queue-copy').addEventListener('click', () => copy(claudeRequest()));
$('#queue-run').addEventListener('click', () => {
  const text = claudeRequest();
  navigator.clipboard?.writeText(text).catch(() => {});
  const w = window.open(`https://claude.ai/new?q=${encodeURIComponent(text)}`, '_blank'); if (w) w.opener = null;
  toast('Opening Claude with the request (also copied — paste it if the box is empty). Keep the Claude desktop app open so Claude can read the plats in its browser.', 'ok');
});
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
    if (unlocked && S.R.parcel.SubdivisionName && !findPlat(S.R, S.db) && !S.R.outsideCounty) queueSubdivision(S.R); // background
    out.innerHTML = renderReportHTML(S.R, S.db);
    const age = Math.round((Date.now() - lookupCache.get(S.R.apn).t) / 60000);
    if (age >= 1) (out.querySelector('.rep-title') || out).insertAdjacentHTML(out.querySelector('.rep-title') ? 'afterend' : 'afterbegin',`<p class="meta">Cached result from ${age} min ago · <button class="link" data-act="refresh">refresh from county GIS</button></p>`);
    S.md = renderReportMD(S.R, S.db, S.extras);
    $('#report-actions').hidden = false;
    drawMap(S.R);
    $('#lookup-apn').value = S.R.apn;
    history.replaceState(null, '', `?apn=${S.R.apn}#lookup`);
    document.title = `${S.R.apn} - ${SITE_TITLE}`;
    carryToReview(S.R);
  } catch (e) { st.className = 'status err'; st.textContent = e.message; }
}
// Carry a lookup's APN, district, lot area and recorded plat setbacks into the plan review.
function carryToReview(R) {
  const z = R.zoning[0]?.zone; const k = normalizeDistrict(z);
  Object.assign(S.review, { apn: R.apn, lotArea: R.parcel.areaSqFt, district: k || S.review.district });
  const plat = findPlat(R, S.db);
  const ps = platSetbacks(plat, R.parcel.Lot);
  if (ps.match) { S.review.platSetbacks = { front: ps.match.front ?? '', rear: ps.match.rear ?? '', side: ps.match.side ?? '', street: ps.match.street ?? '' }; $('#plat-hint').innerHTML = `Recorded plat setbacks filled in from <b>${esc(plat.name)}</b>${ps.rows.length > 1 ? ` (lots ${esc(ps.match.lots)})` : ''}.`; }
  else { S.review.platSetbacks = { front: '', rear: '', side: '', street: '' }; $('#plat-hint').innerHTML = plat ? (ps.rows.length ? `Plat <b>${esc(plat.name)}</b> has several lot ranges — enter the applicable BSLs below.` : `Plat <b>${esc(plat.name)}</b> shows no setbacks — MCZO governs.`) : ''; }
  saveDraft(S.review); renderReview();
}
$('#lookup-form').addEventListener('submit', (e) => { e.preventDefault(); runLookup($('#lookup-apn').value); });
$('#report').addEventListener('click', async (e) => {
  const act = e.target.dataset.act; if (!act || !S.R) return;
  if (act === 'refresh') { runLookup(S.R.apn, { force: true }); return; }
  if ((act === 'edit-plat' || act === 'add-sub') && !unlocked) { showTab('p-subs'); return; }
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
  try { const qm = await import('./queue.js?v=9bac9315'); await qm.putMine(`parcels/${S.R.apn}.md`, S.md + '\n'); toast('Saved to your Saved Items (private)', 'ok'); } catch (e) { toast(e.message, 'error'); }
});
$('#rep-pdf').addEventListener('click', async (e) => {
  const b = e.currentTarget; if (b.disabled || !S.md) return;
  b.disabled = true; const label = b.textContent; b.textContent = 'Building PDF…';
  try { const { reportPDF } = await import('./pdf.js?v=9bac9315'); await reportPDF(S.md, { apn: S.R.apn }); toast('PDF saved', 'ok'); }
  catch (err) { toast(`PDF failed: ${err.message}`, 'error'); }
  finally { b.disabled = false; b.textContent = label; }
});
// Printing: put the two maps under the report's "Parcel …" heading at a fixed print width, refit them
// to the parcel and (from the Print button) wait for tiles, then put everything back afterwards.
const PR = { on: false, home: null, view: null };
function printMapsIn() {
  if (PR.on || !S.map || !S.layer || $('#maps').hidden || $('#p-lookup').hidden) return false;
  const h = $('#report .rep-title'); if (!h) return false;
  PR.on = true; PR.view = { c: S.map.getCenter(), z: S.map.getZoom() };
  PR.home = document.createComment('maps'); $('#maps').before(PR.home); h.after($('#maps'));
  document.documentElement.classList.add('printing');
  S.map.invalidateSize({ animate: false }); S.map2.invalidateSize({ animate: false });
  S.map.fitBounds(S.layer.getBounds(), { padding: [20, 20], maxZoom: 19, animate: false });
  S.refreshLines?.();
  return true;
}
function printMapsOut() {
  if (!PR.on) return; PR.on = false;
  document.documentElement.classList.remove('printing');
  PR.home.replaceWith($('#maps'));
  S.map.invalidateSize({ animate: false }); S.map2.invalidateSize({ animate: false });
  S.map.setView(PR.view.c, PR.view.z, { animate: false });
}
function tilesSettled(ms = 4000) {
  const layers = []; [S.map, S.map2].forEach(m => m.eachLayer(l => { if (l instanceof L.TileLayer && l.isLoading?.()) layers.push(l); }));
  return Promise.race([Promise.all(layers.map(l => new Promise(r => l.once('load', r)))), new Promise(r => setTimeout(r, ms))]);
}
window.addEventListener('beforeprint', () => { printMapsIn(); }); // Ctrl+P: best effort, uses tiles already loaded
window.addEventListener('afterprint', printMapsOut);
$('#rep-print').addEventListener('click', async (e) => {
  const b = e.currentTarget; b.disabled = true;
  try { if (printMapsIn()) { await new Promise(r => setTimeout(r, 60)); await tilesSettled(); } }
  finally { b.disabled = false; }
  window.print();
});

let leafletP = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (!leafletP) leafletP = new Promise((res, rej) => {
    // Pinned with Subresource Integrity (hashes from leafletjs.com/download): a tampered CDN copy will not run.
    const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', integrity: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=', crossOrigin: '' });
    const js = Object.assign(document.createElement('script'), { src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', integrity: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=', crossOrigin: '' });
    js.onload = res; js.onerror = () => { leafletP = null; css.remove(); js.remove(); rej(new Error('Map library failed to load')); };
    document.head.append(css, js);
  });
  return leafletP;
}
// County parcel lines as a dynamic image (ArcGIS export) redrawn for the current view.
function parcelLines(map) {
  let ov = null, timer = null;
  const base = EP.parcel.replace(/\/\d+$/, '');
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const b = map.getBounds(), sz = map.getSize(); if (!sz.x || !sz.y) return;
      const url = `${base}/export?${new URLSearchParams({ bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(','), bboxSR: '4326', imageSR: '3857', size: `${sz.x},${sz.y}`, format: 'png32', transparent: 'true', layers: 'show:1', dpi: '96', f: 'image' })}`;
      const next = L.imageOverlay(url, b, { interactive: false, className: 'parcel-lines' }).addTo(map);
      next.once('load', () => { if (ov && ov !== next) ov.remove(); ov = next; });
      next.once('error', () => next.remove());
    }, 200);
  };
  map.on('moveend', refresh);
  return refresh;
}
// Keep the two maps on the same view.
function syncMaps(a, b) {
  let busy = false;
  const follow = (src, dst) => src.on('move', () => { if (busy) return; busy = true; dst.setView(src.getCenter(), src.getZoom(), { animate: false }); busy = false; });
  follow(a, b); follow(b, a);
}
function refitMap() { if (!S.map || !S.layer) return; S.mapRefit = false; S.map.invalidateSize(); S.map2.invalidateSize(); S.map.fitBounds(S.layer.getBounds(), { padding: [30, 30], maxZoom: 19 }); S.refreshLines && S.refreshLines(); }
async function drawMap(R) {
  if (!R.wgsRings) { $('#maps').hidden = true; return; }
  try { await loadLeaflet(); if (!window.L || !L.map) throw new Error('Leaflet missing'); } catch { $('#maps').hidden = true; return; }
  $('#maps').hidden = false;
  try {
    if (!S.map) {
      S.map = L.map('map', { zoomControl: true, attributionControl: true });
      const img = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 21, maxNativeZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' });
      const st = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 21, maxNativeZoom: 19, attribution: '© Esri' });
      img.addTo(S.map); L.control.layers({ Aerial: img, Streets: st }).addTo(S.map);
      S.map2 = L.map('map2', { zoomControl: true, attributionControl: true });
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 21, maxNativeZoom: 16, attribution: 'Parcels © Maricopa County · Basemap © Esri' }).addTo(S.map2);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 21, maxNativeZoom: 16 }).addTo(S.map2);
      S.refreshLines = parcelLines(S.map2);
      syncMaps(S.map, S.map2);
    }
    const ll = R.wgsRings.map(r => r.map(([x, y]) => [y, x]));
    if (S.layer) S.layer.remove(); if (S.layer2) S.layer2.remove();
    S.layer = L.polygon(ll, { color: accentColor(), weight: 3, fillOpacity: 0.12 }).addTo(S.map);
    S.layer2 = L.polygon(ll, { color: '#d9480f', weight: 3, fillColor: '#ffd8a8', fillOpacity: 0.35 }).addTo(S.map2);
    S.layer2.bindTooltip(`APN ${R.apn}${R.parcel.Lot ? ` · Lot ${R.parcel.Lot}` : ''}`, { permanent: true, direction: 'center', className: 'apn-label' });
    S.mapRefit = true;
    setTimeout(() => { if (!$('#p-lookup').hidden) refitMap(); }, 50); // drawn from another tab (e.g. a recalled queued plan): fit when shown
  } catch (e) { console.warn('map', e); }
}

// ---------------- all subdivisions (county GIS layer 0) ----------------
const AS = { rows: null, page: 0, per: 25, sort: 'name', dir: 1, loading: null };
function asStatus(r) {
  if ((S.db?.subdivisions || []).some(x => sameName(x.name, r.name))) return 'db';
  if ((S.queue?.items || []).some(x => sameName(x.name, r.name))) return 'queue';
  return 'none';
}
async function openAllSubs(force = false) {
  if (AS.loading) return AS.loading;
  if (AS.rows && !force) return renderAllSubs();
  $('#as-meta').textContent = 'Loading every recorded subdivision from county GIS…';
  AS.loading = loadAllSubdivisions({ force, onProgress: (d, n) => ($('#as-meta').textContent = `Loading from county GIS… page ${d} of ${n}`) })
    .then(({ rows, t, source }) => { AS.rows = rows.map(r => ({ ...r, key: `${r.name} ${r.mcr}`.toLowerCase() })); AS.t = t; AS.source = source; renderAllSubs(); })
    .catch((e) => { $('#as-meta').textContent = `Couldn't load subdivisions: ${e.message}`; })
    .finally(() => { AS.loading = null; });
  return AS.loading;
}
function asFiltered() {
  const terms = ($('#as-q').value || '').toLowerCase().split(/\s+/).filter(Boolean); const f = $('#as-filter').value;
  let rows = AS.rows.filter(r => terms.every(w => r.key.includes(w)) && (!f || asStatus(r) === f));
  const k = AS.sort, d = AS.dir;
  const mcrKey = (m) => m.split('-').map(x => x.padStart(5, '0')).join('-');
  rows = rows.slice().sort((a, b) => d * (k === 'mcr' ? mcrKey(a.mcr).localeCompare(mcrKey(b.mcr)) : a.name.localeCompare(b.name)));
  return rows;
}
function renderAllSubs() {
  if (!AS.rows) return;
  const rows = asFiltered(); const pages = Math.max(1, Math.ceil(rows.length / AS.per));
  AS.page = Math.min(AS.page, pages - 1); const start = AS.page * AS.per; const view = rows.slice(start, start + AS.per);
  const inDb = AS.rows.filter(r => asStatus(r) === 'db').length;
  const when = AS.source === 'snapshot' ? `monthly snapshot of ${new Date(AS.t).toLocaleDateString()} (refreshes the 1st of each month)` : `live from county GIS ${new Date(AS.t).toLocaleString()}`;
  $('#as-meta').textContent = `${AS.rows.length.toLocaleString()} subdivisions · ${inDb} in SubdivisionDB · ${when}`;
  const d = new Date(AS.t); const day = d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  $('#as-updated').textContent = AS.source === 'snapshot'
    ? `Last refreshed from county GIS: ${day} (automatic monthly refresh on the 1st)`
    : `Last refreshed from county GIS: ${day}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} (live refresh in this browser)`;
  $('#as-body').innerHTML = view.map(r => {
    const st = asStatus(r); const [book, page] = r.mcr.split('-');
    const rec = st === 'db' ? S.db.subdivisions.find(x => sameName(x.name, r.name))?.rec : '';
    const plat = rec ? LINKS.recDoc(rec) : r.link ? safeUrl(r.link) : (book && page ? LINKS.recBook(book, page) : '');
    return `<tr><td><b>${esc(titleCase(r.name))}</b>${r.n > 1 ? ` <span class="sub">(${r.n} areas)</span>` : ''}</td><td>${esc(r.mcr || '—')}</td>
      <td>${plat ? `<a href="${esc(plat)}" target="_blank" rel="noopener noreferrer">${rec ? `Plat #${esc(rec)}` : 'Find plat'}</a>` : '—'}</td>
      <td>${st === 'db' ? '<span class="pill ok-pill">✓ SubdivisionDB</span>' : st === 'queue' ? `<button type="button" class="pill wl-pill" data-as-unqueue="${esc(r.name)}" title="Click to remove from the Plat Automation Waitlist"><span class="wl-on">⏳ Waitlist</span><span class="wl-off">✕ Remove</span></button>` : '<span class="sub">—</span>'}</td>
      <td>${st === 'db' ? `<button class="btn sm ghost" type="button" data-as-edit="${esc(r.name)}">Open</button>` : st === 'none' ? `<button class="btn sm ghost" type="button" data-as-queue="${esc(r.name)}" data-mcr="${esc(r.mcr)}">Add to waitlist</button>` : ''}</td></tr>`;
  }).join('') || '<tr><td colspan="5" class="sub">No matches.</td></tr>';
  $('#as-page').textContent = rows.length ? `${(start + 1).toLocaleString()}–${(start + view.length).toLocaleString()} of ${rows.length.toLocaleString()}` : '0 results';
  $('#as-prev').disabled = AS.page <= 0; $('#as-next').disabled = AS.page >= pages - 1;
  $$('[data-sort]').forEach(b => { const on = b.dataset.sort === AS.sort; b.textContent = `${b.dataset.sort === 'mcr' ? 'MCR' : 'Subdivision'}${on ? (AS.dir > 0 ? ' ▴' : ' ▾') : ''}`; });
}
let asTimer = null;
// The search sits above the list and stays visible when it's collapsed; searching or filtering opens (and loads) the list.
const asOpen = () => { if ($('#allsubs').classList.contains('collapsed')) setCollapsed('allsubs', false); };
$('#as-q').addEventListener('input', () => { asOpen(); clearTimeout(asTimer); asTimer = setTimeout(() => { AS.page = 0; renderAllSubs(); }, 150); });
$('#as-filter').addEventListener('change', () => { asOpen(); AS.page = 0; renderAllSubs(); });
$('#as-prev').addEventListener('click', () => { AS.page--; renderAllSubs(); $('#allsubs').scrollIntoView({ block: 'start' }); });
$('#as-next').addEventListener('click', () => { AS.page++; renderAllSubs(); $('#allsubs').scrollIntoView({ block: 'start' }); });
$('#as-refresh').addEventListener('click', () => openAllSubs(true));
$$('[data-sort]').forEach(b => b.addEventListener('click', () => { AS.dir = AS.sort === b.dataset.sort ? -AS.dir : 1; AS.sort = b.dataset.sort; renderAllSubs(); }));
$('#as-export').addEventListener('click', () => {
  if (!AS.rows) return; const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = ['Subdivision,MCR,Plat link,Status', ...asFiltered().map(r => [r.name, r.mcr, r.link, ({ db: 'SubdivisionDB', queue: 'Plat Automation Waitlist', none: '' })[asStatus(r)]].map(q).join(','))].join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'maricopa-subdivisions.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#as-body').addEventListener('click', async (e) => {
  const ed = e.target.dataset.asEdit; if (ed) { const rec = S.db.subdivisions.find(x => sameName(x.name, ed)); if (rec) openEditor(rec); return; }
  const un = e.target.closest('[data-as-unqueue]')?.dataset.asUnqueue;
  if (un) {
    const it = (S.queue?.items || []).find(x => sameName(x.name, un)); if (!it) return;
    (S.queueGone ||= new Set()).add(it.name.toUpperCase());
    try { await saveQueue(q => { q.items = q.items.filter(x => !sameName(x.name, un)); }, `Plat Automation Waitlist: remove ${titleCase(un)}`); toast(`${titleCase(un)} removed from the Plat Automation Waitlist`); }
    catch (err) { toast(err.message, 'error'); }
    renderAllSubs(); return;
  }
  const qn = e.target.dataset.asQueue; if (!qn) return;
  e.target.disabled = true; e.target.textContent = 'Adding…';
  try { await queueByName(qn, e.target.dataset.mcr); renderAllSubs(); } catch (err) { toast(err.message, 'error'); e.target.disabled = false; e.target.textContent = 'Add to waitlist'; }
});

// ---------------- regulation lookup (Reference tab) ----------------
function renderRegLookup() {
  if (!REF) return; const { REG_LOOKUP } = REF;
  const terms = ($('#rl-q').value || '').toLowerCase().split(/\s+/).filter(Boolean); const doc = $('#rl-doc').value;
  const hits = REG_LOOKUP.filter(r => (!doc || r.d === doc) && terms.every(w => `${r.d} ${r.s} ${r.t} ${r.r}`.toLowerCase().includes(w)));
  const phrase = terms.join(' '); const wb = (t, w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(t);
  const score = (r) => (phrase && r.t.toLowerCase().includes(phrase) ? 8 : 0) + (phrase && r.r.toLowerCase().includes(phrase) ? 4 : 0) + terms.filter(w => wb(r.t, w)).length * 2 + terms.filter(w => wb(r.r, w)).length;
  if (terms.length) hits.sort((x, y) => score(y) - score(x));
  const rx = terms.length ? new RegExp(`(${terms.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi') : null;
  const mark = (t) => rx ? String(t).split(rx).map((p, i) => (i % 2 ? `<mark>${esc(p)}</mark>` : esc(p))).join('') : esc(t); // highlight raw text, then escape each piece
  $('#rl-count').textContent = `${hits.length} of ${REG_LOOKUP.length} rules`;
  $('#rl-body').innerHTML = hits.slice(0, 200).map(r => `<tr><td><a href="${esc(safeUrl(r.u))}" target="_blank" rel="noopener">${esc(r.d)}</a></td><td>${mark(r.s)}</td><td>${mark(r.t)}</td><td>${mark(r.r)}</td></tr>`).join('') || '<tr><td colspan="4" class="sub">No matches.</td></tr>';
}
$('#rl-q').addEventListener('input', () => { if ($('#rl-results').classList.contains('collapsed')) setCollapsed('rl-results', false); renderRegLookup(); }); // typing a search reopens the results
$('#rl-doc').addEventListener('change', renderRegLookup);

// ---------------- plan review ----------------
function renderReview() {
  const s = S.review;
  $('#rv-type').innerHTML = Object.entries(CHECKLISTS).map(([k, v]) => `<option value="${k}" ${k === s.type ? 'selected' : ''}>${v.label}</option>`).join('');
  $('#rv-district').innerHTML = '<option value="">— select —</option>' + Object.keys(DISTRICTS).map(k => `<option ${k === s.district ? 'selected' : ''}>${k}</option>`).join('');
  for (const k of ['apn', 'lotArea', 'planTitle', 'permit', 'reviewer', 'reviewerEmail', 'date']) $(`#rv-${k}`).value = s[k] ?? '';
  $('#rv-adjRes').checked = !!s.adjRes;
  for (const k of Object.keys(s.primary)) $(`#rv-p-${k}`).value = s.primary[k] ?? '';
  for (const k of Object.keys(s.platSetbacks)) $(`#rv-b-${k}`).value = s.platSetbacks[k] ?? '';
  const site = ['residential', 'commercial'].includes(s.type);
  $$('.site-only').forEach(el => (el.hidden = !site));
  renderStructures(); renderChecklist(); renderOutput(); renderSitePlan(); renderVerifyCard(); try { spButtons(); } catch {} // SP may not exist yet during start-up
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
    <td><textarea data-c="note" class="cell-ta" rows="2" placeholder="What the plan shows" title="${esc(r.note)}">${esc(r.note)}</textarea></td>
    <td><textarea data-c="fix" class="cell-ta" rows="2" title="${esc(r.fix)}">${esc(r.fix)}</textarea></td></tr>`).join('');
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
  for (const k of ['apn', 'lotArea', 'planTitle', 'permit', 'reviewer', 'reviewerEmail', 'date']) $(`#rv-${k}`).addEventListener('input', (e) => { S.review[k] = e.target.value; if (k === 'reviewer' || k === 'reviewerEmail') rememberReviewer(S.review.reviewer, S.review.reviewerEmail); upd(); });
  $('#rv-adjRes').addEventListener('change', (e) => { S.review.adjRes = e.target.checked; upd(); });
  for (const k of Object.keys(S.review.primary)) $(`#rv-p-${k}`).addEventListener('input', (e) => { S.review.primary[k] = e.target.value; upd(); });
  for (const k of Object.keys(S.review.platSetbacks)) $(`#rv-b-${k}`).addEventListener('input', (e) => { S.review.platSetbacks[k] = e.target.value; upd(); });
  $('#rv-structs').addEventListener('input', (e) => { const tr = e.target.closest('tr'); const k = e.target.dataset.k; if (!tr || !k) return; S.review.structures[+tr.dataset.i][k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; if (k === 'kind') { saveDraft(S.review); renderStructures(); } upd(); });
  $('#rv-structs').addEventListener('click', (e) => { const i = e.target.dataset.del; if (i == null) return; S.review.structures.splice(+i, 1); saveDraft(S.review); renderStructures(); renderOutput(); });
  $('#rv-add').addEventListener('click', () => { S.review.structures.push({ name: 'Shed', kind: 'accessory', sf: '', cover: 'solid', height: '', front: '', rear: '', side: '', street: '', inYard: true }); saveDraft(S.review); renderStructures(); });
  // Checklist cells show 3 small lines; while editing, the cell grows to fit its text.
  const fit = (ta) => { ta.style.height = 'auto'; ta.style.height = `${Math.max(ta.scrollHeight + 2, 48)}px`; };
  $('#rv-check').addEventListener('focusin', (e) => { if (e.target.classList.contains('cell-ta')) fit(e.target); });
  $('#rv-check').addEventListener('focusout', (e) => { if (e.target.classList.contains('cell-ta')) { e.target.style.height = ''; e.target.title = e.target.value; } });
  $('#rv-check').addEventListener('input', (e) => { if (e.target.classList.contains('cell-ta')) fit(e.target); const tr = e.target.closest('tr'); const k = e.target.dataset.c; if (!tr || !k) return; const id = tr.dataset.id; S.review.checks[id] = { ...(S.review.checks[id] || {}), [k]: e.target.value }; upd(); });
  $('#rv-allok').addEventListener('click', () => { for (const r of checklistRows(S.review)) if (!S.review.checks[r.id]?.status) S.review.checks[r.id] = { ...(S.review.checks[r.id] || {}), status: 'ok' }; saveDraft(S.review); renderChecklist(); renderOutput(); });
  $('#rv-reset').addEventListener('click', () => clearHub('Clear this review?'));
  $('#rv-letter').addEventListener('click', async (e) => {
    const b = e.currentTarget; if (b.disabled) return; b.disabled = true;
    try {
      const s = S.review; const P = (s.ai && s.ai.result && s.ai.result.parcel) || {};
      const R = S.R && S.R.apn === normalizeApn(s.apn) ? S.R : (lookupCache.get(normalizeApn(s.apn)) || {}).R;
      const p = (R && R.parcel) || {};
      const who = rememberedReviewer();
      const info = { apn: s.apn, permit: s.permit, date: s.date, plan: s.planTitle, type: CHECKLISTS[s.type]?.label || s.type,
        address: [p.PropertyFullStreetAddress, p.PropertyCity].filter(Boolean).join(', ') || P.site_address || '', owner: p.OwnerName || P.owner_name || '',
        district: s.district, reviewer: s.reviewer || who.name, email: s.reviewerEmail || who.email };
      const { commentLetterPDF } = await import('./commentletter.js?v=9bac9315');
      const out = await commentLetterPDF({ rows: markupRows(s).rows, info });
      toast(`Comment letter saved — ${out.count} comment${out.count === 1 ? '' : 's'}`, 'ok');
    } catch (err) { toast(err.message, 'error'); }
    finally { b.disabled = false; }
  });
  $('#rv-copy').addEventListener('click', () => { renderOutput(); copy($('#rv-md').value); });
  $('#rv-dl').addEventListener('click', () => renderOutput() || download(`review-${S.review.apn || 'plan'}-${S.review.date}.md`, $('#rv-md').value));
  $('#rv-save').addEventListener('click', async () => {
    renderOutput();
    try { const qm = await import('./queue.js?v=9bac9315'); const base = `reviews/${(S.review.apn || 'no-apn').replace(/[^A-Za-z0-9-]/g, '')}-${S.review.date}-${S.review.type}`; await qm.putMine(`${base}.md`, $('#rv-md').value + '\n'); const { ai, ...pub } = S.review; await qm.putMine(`${base}.json`, JSON.stringify(pub, null, 2) + '\n'); toast('Review saved to your Saved Items (private)', 'ok'); } catch (e) { toast(e.message, 'error'); }
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
  if (minAc != null && minAc >= 36 && !condo) R('Not a Subdivision or Minor Land Division', "Every resulting parcel is ≥ 36 ac (to the centerline of contiguous roads/easements), so it is outside both definitions. Deeds plus MCZO compliance.", 'MCSR §105.24, §105.37; A.R.S. 32-2101');
  else if (ag) R('Excluded (Agricultural Lease/Sale under A.R.S. 11-830)', 'Not regulated as a land division; confirm the A.R.S. 11-830 conditions.', 'MCSR §105.24');
  else if (inSub) {
    if (lots >= 6 || tract || street || aband) {
      const pre = street || aband || lots > 6;
      R('Replat (Amended Final Plat)', `${pre ? 'Preliminary plat (MCSR §202) + final plat (§203); the Director may waive the preliminary stage' : 'Process as a final plat (MCSR §203)'}.`, 'MCSR §204.1–3; DD-2013-10 ¶3',
        [aband && 'Abandoning a street, alley or easement needs MCDOT/utility review; patent easements and open MCDOT rights-of-way are abandoned through MCDOT/MCRED instead (§204.3).', tract && 'Altering a tract designated for a specific use is a replat.', lots >= 4 && lots < 6 && 'MCSR §105.31 defines a replat as 4+ lots, but §204.1 uses 6+ — confirm with the Department.'].filter(Boolean));
    } else R('Minor Land Division within a Recorded Subdivision', '5 or fewer adjoining lots. Done by deed; each lot must meet MCZO area, width and access; existing structures must meet setbacks to the new lines.', 'DD-2013-10 ¶3; MCSR §105.24');
  } else if (lots >= 6 || condo) R('Subdivision', 'Pre-application ($350) → preliminary plat (approved administratively by the Department; valid 24 mo; denial appealable to P&Z → Board within 30 days) → final plat (Department review; infrastructure permit ready to issue; BOS chairman signs, no hearing) → record. Assurances, 100-yr assured water (AMA), at least 2 points of access, improvements per MCSR Ch. 3.', 'MCSR §103, §105.37, §202–203, §302.2.d.5; A.R.S. 11-806.01',
    [condo && 'Residential condominiums count as a subdivision.', septicSmall && 'Lots < 1 net acre may not use individual on-lot septic (MCSR §302.4.b; DD-3018-01) — sewer, larger lots, or a waiver with an ESD Certificate of Geological Report.'].filter(Boolean));
  else R('Minor Land Division (Lot Split)', 'Up to 5 lots, all < 36 ac. Done by recorded deeds; the MCSR does not apply, but each lot must meet MCZO lot area, width and legal access, and A.R.S. 11-831. Staff check Assessor history for serial splits at site-plan review.', 'MCSR §105.24; DD-2013-10 ¶2, ¶4; A.R.S. 11-831',
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
    if (n <= 1 && !/[A-Z]$/.test(R.apn)) { verdict = 'No Split Detected'; cls = 'ok'; findings.push(['ok', `No other parcels share ${S2.base}; the Assessor record shows no split of this parcel.`]); }
    else if (all36) { verdict = 'Exempt — All Parcels Are 36 Acres or More'; cls = 'ok'; findings.push(['ok', `All ${n} parcels from ${S2.base} are ≥ 36 ac, so this is neither a subdivision nor a minor land division (MCSR §105.24/.38).`]); }
    else if (n >= 6) { verdict = 'Possible Illegal Subdivision — Refer for Review'; cls = 'bad'; findings.push(['bad', `${n} parcels have been created from parent ${S2.base} and not all are ≥ 36 ac. Six or more lots requires a recorded subdivision plat (MCSR §103, §105.37; A.R.S. 32-2101).${platted ? ' Inside a recorded subdivision, 6+ adjoining lots requires a replat (MCSR §204).' : ''} Per DD-2013-10, no zoning approval unless ADRE confirms in writing that the split is lawful.`]); }
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
      <p class="sub">Screening based on Assessor records, not a legal determination. Basis: MCSR §103, §105.10, §105.21, §105.24, §105.37, §204; <a href="https://www.maricopa.gov/6416/Subdivisions---Replats-and-Lot-Splits-20" target="_blank" rel="noopener">DD-2013-10</a>; A.R.S. 11-831, 32-2101.</p>`;
  } catch (e) { st.className = 'status err'; st.textContent = e.message; }
}
$('#ls-form').addEventListener('submit', (e) => { e.preventDefault(); checkSplit($('#ls-apn').value); });

// ---------------- saved (GitHub) ----------------
async function renderSaved() {
  const el = $('#saved-list');
  if (!unlocked) { el.innerHTML = '<p class="sub">Sign in to see your saved items.</p>'; return; }
  el.innerHTML = '<p class="sub">Loading…</p>';
  try {
    const qm = await import('./queue.js?v=9bac9315');
    const files = await qm.listMine();
    const parcels = files.filter(f => f.path.startsWith('parcels/')), reviews = files.filter(f => f.path.startsWith('reviews/') && f.path.endsWith('.md'));
    const li = (f) => `<li data-path="${esc(f.path)}"><span>${esc(f.path.replace(/^(parcels|reviews)\//, '').replace(/\.md$/, ''))}</span><span class="actions"><button class="btn sm" type="button" data-sv="open">Open</button></span></li>`;
    el.innerHTML = `<h3>Parcel Reports (${parcels.length})</h3><ul class="saved-files">${parcels.map(li).join('') || '<li class="sub">None yet — use <b>Save to Saved Items</b> on a parcel lookup.</li>'}</ul><h3>Plan Reviews (${reviews.length})</h3><ul class="saved-files">${reviews.map(li).join('') || '<li class="sub">None yet — use <b>Save to Saved Items</b> in the Plan Review Hub.</li>'}</ul>`;
  } catch (e) { el.innerHTML = `<p class="bad">${esc(e.message)}</p>`; }
}
{
  const dlg = $('#saved-view'); let cur = null, text = '';
  $('#saved-refresh').addEventListener('click', renderSaved);
  $('#saved-list').addEventListener('click', async (e) => {
    const li = e.target.closest('[data-path]'); if (!li || !e.target.closest('[data-sv=open]')) return;
    cur = li.dataset.path; $('#sv-title').textContent = cur.replace(/^(parcels|reviews)\//, ''); $('#sv-text').textContent = 'Loading…'; dlg.showModal();
    try { text = await (await import('./queue.js?v=9bac9315')).getMine(cur); $('#sv-text').textContent = text; } catch (err) { $('#sv-text').textContent = err.message; }
  });
  $('#sv-close').addEventListener('click', () => dlg.close());
  $('#sv-dl').addEventListener('click', () => { if (dlg.dataset.admin) return download(dlg.dataset.admin.split('/').pop(), $('#sv-text').textContent); if (cur) download(cur.split('/').pop(), text); });
  dlg.addEventListener('close', () => { delete dlg.dataset.admin; });
  $('#sv-del').addEventListener('click', async () => {
    if (dlg.dataset.admin) { const path = dlg.dataset.admin; if (!confirm(`Remove ${path}?`)) return; try { await relayFetch('/admin/del', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) }); dlg.close(); toast('Removed', 'ok'); renderFolder(); } catch (err) { toast(err.message, 'error'); } return; }
    if (!cur || !confirm(`Delete ${cur.split('/').pop()} from your Saved Items?`)) return;
    try { const qm = await import('./queue.js?v=9bac9315'); await qm.delMine(cur); if (cur.endsWith('.md') && cur.startsWith('reviews/')) await qm.delMine(cur.replace(/\.md$/, '.json')).catch(() => {}); dlg.close(); toast('Deleted', 'ok'); renderSaved(); } catch (err) { toast(err.message, 'error'); }
  });
}

// ---------------- reference ----------------
let refP = null;
function renderReference() {
  return (refP ||= import('./refdata.js?v=9bac9315').then((m) => { REF = m; fillReference(); }).catch((e) => { refP = null; toast(`Couldn't load reference data: ${e.message}`, 'error'); }));
}
function fillReference() {
  const { DIRECTIVES, MCSR_QUICK, REG_DOCS, REG_LOOKUP } = REF;
  $('#ref-mcsr').innerHTML = MCSR_QUICK.map(r => `<tr><td>${esc(r.topic)}</td><td>${esc(r.std)}</td><td>${esc(r.cite)}</td></tr>`).join('');
  $('#ref-regs').innerHTML = REG_DOCS.map(d => `<tr><td><b>${esc(d.n)}</b></td><td>${esc(d.e)}</td><td>${esc(d.st)}</td><td>${d.l.map(l => `<a href="${esc(safeUrl(l.u))}" target="_blank" rel="noopener">${esc(l.t)}</a>`).join(' · ') || '—'}</td></tr>`).join('');
  $('#rl-doc').insertAdjacentHTML('beforeend', [...new Set(REG_LOOKUP.map(r => r.d))].map(d => `<option>${esc(d)}</option>`).join(''));
  renderRegLookup();
  $('#ref-dirs').innerHTML = DIRECTIVES.map(d => `<li><a href="${esc(safeUrl(d.u))}" target="_blank" rel="noopener">${esc(d.t)}</a></li>`).join('');
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
  $('#st-owner').value = gh.owner; $('#st-repo').value = gh.repo; $('#st-branch').value = gh.branch; $('#st-token').value = gh.token ? '••••••••' : ''; $('#st-tokwarn').hidden = !gh.token; if (gh.token) $('#st-tokbox').open = true; $('#st-pass').value = gh.passphrase ? '••••••••' : '';
  renderBadge();
}
$('#st-save').addEventListener('click', () => {
  { const v = $('#st-proxy').value.trim().replace(/\/+$/, ''); settings.proxy = v && v !== settings.sharedProxy ? v : ''; } settings.forceProxy = $('#st-force').checked;
  if (!storageWorks()) { toast('This browser is blocking site storage (private/incognito mode or an in-app browser), so the token cannot be kept. Open the site in regular Safari or Chrome.', 'error'); return; }
  const pass = $('#st-pass').value; if (!pass.startsWith('••')) gh.passphrase = pass.trim();
  const tok = $('#st-token').value.trim();
  if (/^mc-/i.test(tok)) { gh.passphrase = tok; $('#st-token').value = ''; $('#st-pass').value = '••••••••'; toast('That is a hub access key, not a GitHub token — saved it as the Passphrase. Now click Test GitHub.', 'ok'); renderSettings(); return; }
  if (tok && !tok.startsWith('••') && !/^(github_pat_|ghp_)/.test(tok)) { toast('That does not look like a GitHub token — it should start with github_pat_', 'error'); return; }
  gh.save({ owner: $('#st-owner').value.trim(), repo: $('#st-repo').value.trim(), branch: $('#st-branch').value.trim() || 'main', token: tok.startsWith('••') ? undefined : tok });
  renderSettings();
  if (gh.canWrite) { toast(`Saved — connected to ${gh.owner}/${gh.repo}. Now tap Test GitHub.`, 'ok'); }
  else toast(`Not connected yet: ${gh.passphrase && !settings.proxy ? 'add the Relay URL (the passphrase works through the relay)' : !gh.token && !gh.passphrase ? 'enter your passphrase (or a token)' : 'owner and repository are required'}.`, 'error');
  loadDB().catch(() => {}); showRelayVersion(); checkAccess();
});
$('#st-forget').addEventListener('click', () => { revokeAccess(); gh.save({ owner: $('#st-owner').value, repo: $('#st-repo').value, branch: $('#st-branch').value, token: '' }); gh.passphrase = ''; renderSettings(); toast('Passphrase and token removed from this browser'); });
$('#st-copy-relay').addEventListener('click', async () => {
  try { const t = await (await fetch(`worker/cors-proxy.js?t=${Date.now()}`, { cache: 'no-store' })).text(); await navigator.clipboard.writeText(t); toast(`Relay code copied (${t.split('\n').length} lines) — paste it into Cloudflare and Deploy`, 'ok'); }
  catch (e) { toast('Copy blocked by the browser — use "View relay code", then select all and copy', 'error'); }
});
$('#st-test-gis').addEventListener('click', async () => { const o = $('#st-test-out'); o.textContent = 'Testing county GIS…'; try { o.textContent = `County GIS reachable (${await ping()} ms).`; } catch (e) { o.textContent = e.message; } });
async function testGitHub(o) { o.textContent = 'Testing GitHub…'; try { const r = await testAccess(); o.textContent = `${r.name}: ${Array.isArray(r.perms) ? 'connected' : r.canPush ? 'write access OK' : 'READ-ONLY — the GitHub token saved in this browser can\'t write. If you were given an access key (starts with mc-), clear the Token box and put the key in Passphrase instead; otherwise edit the token on GitHub: Repository access must include randalkidd/MC and Contents must be Read and write'}${r.private ? ' (private repo — Pages needs a paid plan)' : ''}${r.ai === true ? ' · Site-plan reading (Claude): on' : r.ai === false ? ' · Site-plan reading (Claude): off — add ANTHROPIC_API_KEY to the relay to enable' : ''}`; const okay = gh.viaRelay && (Array.isArray(r.perms) ? r.perms.length > 0 : r.canPush); if (Array.isArray(r.perms)) o.textContent += ` · Signed in as ${r.super ? 'the super account' : `“${r.label}”`} — ${r.perms.join(', ')}`; if (okay) { await grantAccess(r); toast('Connected — staff tools unlocked', 'ok'); } else revokeAccess(); if (okay && hasPerm('write')) { try { if (await shareRelayIfNeeded()) { o.textContent += ' · Relay address shared — other browsers now need only the passphrase.'; renderSettings(); } } catch (e) { o.textContent += ` · Couldn't share relay address: ${e.message}`; } } } catch (e) { o.textContent = e.message; revokeAccess(); } }
$('#st-test-gh').addEventListener('click', () => { const v = $('#st-pass').value.trim(); if (v && !v.startsWith('••') && v !== gh.passphrase && storageWorks()) gh.passphrase = v; testGitHub($('#st-test-out')); });

$('#st-cleartok').addEventListener('click', () => { gh.save({ owner: gh.owner, repo: gh.repo, branch: gh.branch, token: '' }); renderSettings(); toast('Saved token removed from this browser. Click Test GitHub.', 'ok'); });

// ---------------- Sign in (everyone): name + passphrase only. ⚙ Settings is for administrators. ----------------
function renderSignin() {
  let name = ''; try { name = localStorage.getItem('mc.name') || ''; } catch {}
  $('#si-name').value = name; $('#si-pass').value = gh.passphrase ? '••••••••' : '';
}
function saveSignin(quiet) {
  if (!storageWorks()) { toast('This browser is blocking site storage (private/incognito mode or an in-app browser). Open the site in regular Chrome, Edge or Safari.', 'error'); return false; }
  const name = $('#si-name').value.trim(); const pass = $('#si-pass').value;
  if (!name) { toast('Enter your name.', 'error'); return false; }
  if (!pass || (pass.startsWith('••') && !gh.passphrase)) { toast('Enter your passphrase.', 'error'); return false; }
  try { localStorage.setItem('mc.name', name); } catch {}
  if (!pass.startsWith('••')) gh.passphrase = pass.trim();
  const who = rememberedReviewer(); rememberReviewer(name, who.name === name ? who.email : who.email);
  if (!S.review.reviewer || S.review.reviewer === who.name) { S.review.reviewer = name; saveDraft(S.review); }
  renderSignin(); renderBadge();
  if (!quiet) toast('Saved. Now click Test GitHub.', 'ok');
  return true;
}
$('#si-save').addEventListener('click', () => saveSignin(false));
$('#si-test').addEventListener('click', async () => {
  const o = $('#si-out');
  // Test what's typed: a new key in the box is saved first (people often click Test before Save).
  const typed = $('#si-pass').value;
  if (typed && !typed.startsWith('••') && typed.trim() !== gh.passphrase) { if (!saveSignin(true)) { o.className = 'status err'; o.textContent = 'Enter your name and access key first.'; return; } }
  await testGitHub(o);
  if (unlocked) { const pp = perms(); o.className = 'status ok'; o.textContent = `Success! Your account is now signed in. You have ${pp.legacy ? 'full access' : accountType(pp)} with the following privileges: ${pp.perms.join(', ')}.`; }
  else o.className = 'status err';
});
$('#gh-badge').addEventListener('click', () => { if (unlocked) { showTab('p-profile'); return; } showTab('p-signin'); setTimeout(() => ($('#si-name').value ? $('#si-pass') : $('#si-name')).focus(), 50); });

function accentColor() { const a = currentAccent(); return document.documentElement.dataset.theme === 'light' ? a.light : a.dark; }
function syncThemeBtn() { const light = document.documentElement.dataset.theme === 'light'; $('#theme-btn').textContent = light ? '☾' : '☀'; document.querySelector('meta[name=theme-color]').content = light ? '#f3f6f7' : '#132048'; }
$('#theme-btn').addEventListener('click', () => {
  const light = document.documentElement.dataset.theme !== 'light';
  if (light) document.documentElement.dataset.theme = 'light'; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('mc.theme', light ? 'light' : 'dark'); } catch {}
  syncThemeBtn();
});
syncThemeBtn();
// Accent color: 16 choices from the ● button (remembered per browser). Teal is the default.
function syncAccentBtn() {
  const cur = currentAccent(); $('#accent-btn').title = `Accent color: ${cur.name} — click to change`;
  $$('#accent-grid .sw').forEach(b => b.setAttribute('aria-checked', String(b.dataset.acc === cur.id)));
  $('#accent-name').textContent = cur.name;
  if (S.layer) S.layer.setStyle({ color: accentColor() });
}
function setAccent(id) {
  if (id === 'teal') delete document.documentElement.dataset.accent; else document.documentElement.dataset.accent = id;
  try { localStorage.setItem('mc.accent', id); } catch {}
  syncAccentBtn();
}
function accentPop(open) { $('#accent-pop').hidden = !open; $('#accent-btn').setAttribute('aria-expanded', String(open)); if (open) ($('#accent-grid .sw[aria-checked="true"]') || $('#accent-grid .sw')).focus(); }
$('#accent-grid').innerHTML = ACCENTS.map(a => `<button type="button" class="sw" role="radio" data-acc="${a.id}" title="${a.name}" aria-label="${a.name}" style="background:${a.dark}"></button>`).join('');
$('#accent-btn').addEventListener('click', () => accentPop($('#accent-pop').hidden));
$('#accent-grid').addEventListener('click', (e) => { const b = e.target.closest('.sw'); if (b) setAccent(b.dataset.acc); });
$('#accent-grid').addEventListener('mouseover', (e) => { const b = e.target.closest('.sw'); $('#accent-name').textContent = b ? b.title : currentAccent().name; });
$('#accent-grid').addEventListener('mouseleave', () => { $('#accent-name').textContent = currentAccent().name; });
$('#accent-pop').addEventListener('keydown', (e) => {
  const sw = [...$$('#accent-grid .sw')]; const i = sw.indexOf(document.activeElement);
  if (e.key === 'Escape') { accentPop(false); $('#accent-btn').focus(); return; }
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 }[e.key];
  if (step && i >= 0) { e.preventDefault(); sw[(i + step + sw.length) % sw.length].focus(); }
});
document.addEventListener('click', (e) => { if (!e.target.closest('.accent-wrap')) accentPop(false); });
syncAccentBtn();

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
  renderSettings(); showRelayVersion();
}
// Footer: version of the relay code actually deployed in Cloudflare (every relay response carries X-Relay-Version).
async function showRelayVersion() {
  const el = $('#relay-ver'); if (!el) return;
  const latest = +el.dataset.latest || 0; const base = settings.proxy;
  const set = (txt, tip, old) => { el.textContent = txt; el.title = tip; el.classList.toggle('old', !!old); };
  if (!base) return set('Relay: not set', 'No relay URL — add one in ⚙ Settings', true);
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`${base}/`, { cache: 'no-store', signal: ctl.signal });
    const v = r.headers.get('X-Relay-Version');
    if (!v) return set('Relay: old code', 'The relay predates version numbers — paste the latest code: ⚙ Settings → Copy relay code → Cloudflare → Deploy', true);
    if (latest && +v < latest) return set(`Relay v${v} (v${latest} available)`, `Update: ⚙ Settings → Copy relay code → Cloudflare mc-relay → Edit code → paste → Deploy`, true);
    set(`Relay v${v}`, `Cloudflare relay ${base.replace(/^https:\/\//, '')} is running the latest code`, false);
  } catch { set('Relay: unreachable', `Couldn't reach ${base.replace(/^https:\/\//, '')} — check the Worker in Cloudflare`, true); }
  finally { clearTimeout(timer); }
}
// After a successful relay test, publish the relay address for every browser (address only — never the passphrase or token).
async function shareRelayIfNeeded() {
  if (!settings.localProxy || settings.localProxy === settings.sharedProxy) return false;
  await writeFile('data/site-config.json', JSON.stringify({ relayUrl: settings.localProxy, updated: new Date().toISOString().slice(0, 10) }, null, 2) + '\n', 'Share relay address with all browsers');
  setSharedRelay(settings.localProxy); return true;
}


// ---------------- plan review: read a site-plan PDF with Claude (relay /ai/siteplan) ----------------
const SP = { file: null, busy: false };
const spIcon = (st) => ({ ok: '✅', verify: '⚠️', deficient: '❌', na: '—' }[st] || '');
function spPick(f) {
  if (!f) return;
  if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { toast('Choose a PDF file.', 'error'); return; }
  SP.file = f; $('#sp-name').textContent = `${f.name} · ${(f.size / 1048576).toFixed(1)} MB`; spButtons();
}
function renderSitePlan() {
  const a = S.review.ai; const el = $('#sp-out');
  if (!a || !a.result) { el.innerHTML = ''; return; }
  const r = a.result, P = r.parcel || {}, pl = r.plan || {}, cv = r.coverage || {};
  const yn = (v) => v === true ? 'Yes' : v === false ? 'No' : '—';
  const facts = [
    ['Plan title / revision / date', [pl.title, pl.revision, pl.date].filter(Boolean).join(' · ') || '—'],
    ['Prepared by', pl.preparer || '—'], ['Sheets', pl.sheets ?? '—'],
    ['Scale', `${pl.scale_stated || 'not stated'}${pl.scale_is_standard === false ? ' (non-standard)' : ''}; scale bar: ${yn(pl.scale_bar)}`],
    ['North arrow / vicinity map', `${yn(pl.north_arrow)} / ${yn(pl.vicinity_map)}`],
    ['Legal description', P.legal_description || '—'], ['Lot dimensions', P.lot_dimensions || '—'], ['Corner lot', yn(P.corner_lot)],
    ['Water / wastewater', `${P.water_source || '—'} / ${P.wastewater || '—'}`],
    ['Lot coverage shown on plan', cv.lot_coverage_pct_shown != null ? `${cv.lot_coverage_pct_shown}%${cv.total_covered_sf_shown ? ` (${(+cv.total_covered_sf_shown).toLocaleString()} sf)` : ''}` : 'not shown'],
    ['Easements', (r.easements || []).map(e => [e.type, e.width, e.recording && `MCR ${e.recording}`, e.location].filter(Boolean).join(' ')).join('; ') || 'none shown'],
    ['Streets / ROW', (r.streets || []).map(x => [x.name, x.row_width && `ROW ${x.row_width}`, x.jurisdiction].filter(Boolean).join(' ')).join('; ') || 'none shown'],
    ['Adjacent uses', (r.adjacent_uses || []).join('; ') || 'none labeled'],
    ['Invalidating notes', (pl.invalidating_notes || []).join('; ') || 'none found'],
  ];
  const u = a.usage || {};
  const nIss = (a.compare || []).filter(c => c[3] !== 'ok').length + computeFindings(S.review).F.filter(f => f.status !== 'ok').length + Object.values(S.review.checks || {}).filter(c => c.status === 'deficient' || c.status === 'verify').length + (r.other_findings || []).length + (r.uncertain || []).length;
  el.innerHTML = `<div class="actions"><button class="btn primary" type="button" id="sp-view">🔍 Open Plan Viewer — ${nIss} issue${nIss === 1 ? '' : 's'} marked on the PDF</button></div>
    <p class="meta">Read <b>${esc(a.file)}</b> with ${esc(a.engine === 'free' ? 'the free in-browser text reader' : String(a.model || 'Claude').replace(/,?\s*LONDON/gi, ''))} on ${esc(new Date(a.at).toLocaleString())}${u.input_tokens ? ` · ${u.input_tokens.toLocaleString()} in / ${(u.output_tokens || 0).toLocaleString()} out tokens` : ''}. The form below has been filled in — check each value against the plan.</p>
    ${a.truncated ? '<div class="warn">The answer was cut off (very large plan). Some items may be missing — verify the checklist.</div>' : ''}
    ${a.lookupError ? `<div class="warn">Couldn't look up the parcel for the record checks: ${esc(a.lookupError)}</div>` : ''}
    <h3>Plan vs. Assessor Record and Recorded Deed</h3>
    <div class="tw"><table><thead><tr><th>Check</th><th>Plan shows</th><th>Record</th><th>Result</th></tr></thead><tbody>
    ${(a.compare || []).map(([c, plan, rec, st, note]) => `<tr><td>${esc(c)}</td><td>${esc(plan)}</td><td>${esc(rec)}</td><td>${spIcon(st)} ${esc(note || (st === 'ok' ? 'Matches' : ''))}</td></tr>`).join('')}
    </tbody></table></div>
    <h3>What the Plan Shows</h3>
    <div class="tw"><table><tbody>${facts.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>
    ${(r.uncertain || []).length ? `<div class="warn"><b>Hard to read / inferred — verify:</b><ul>${r.uncertain.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    ${r.summary ? `<p><b>Summary:</b> ${esc(r.summary)}</p>` : ''}`;
}
// Shared by both readers: look up the parcel, check the deed, compare, fill the form.
async function finishRead(res, meta, st, file = SP.file) {
  const sp = await import('./siteplan.js?v=9bac9315');
  const planApn = normalizeApn(res.parcel && res.parcel.apn);
  let R = S.R && S.review.apn && S.R.apn === normalizeApn(S.review.apn) ? S.R : null, lookupError = '';
  const target = normalizeApn(S.review.apn) || planApn;
  if (!R && target) {
    const hit = lookupCache.get(target);
    if (hit) R = hit.R;
    else try { st.textContent = `Looking up parcel ${target} for the record checks…`; R = await lookupParcel(target, { onStep: (m) => (st.textContent = `Looking up ${target}: ${m}…`) }); lookupCache.set(R.apn, { R, t: Date.now() }); }
    catch (e) { lookupError = e.message; }
  }
  if (R && !S.review.apn) carryToReview(R);
  st.textContent = 'Checking the recorded deed…';
  const deed = R ? await sp.deedNames(R.parcel.DeedNumber) : null;
  const compare = sp.compareToRecords(res, R, deed);
  sp.applyToReview(S.review, res, compare, { merge: meta.engine === 'free' });
  S.review.ai = { file: file.name, at: new Date().toISOString(), ...meta, result: res, compare, deedNames: deed, apn: R ? R.apn : null, lookupError };
  S.review.verified = {}; // a new read starts a new verification
  saveDraft(S.review); renderReview();
  import('./planviewer.js?v=9bac9315').then(m => m.savePdf(file)).catch(() => {});
  // Keep what was read in the private plan-review database (45 days). Queued reads are already stored by the routine.
  if (unlocked && meta.engine !== 'queued') import('./queue.js?v=9bac9315').then(qm => qm.saveRecord({ source: meta.engine === 'free' ? 'superficial' : 'rapid', file: file.name, apn: (R && R.apn) || normalizeApn(res.parcel && res.parcel.apn) || '', type: S.review.type, model: meta.model, result: res, compare })).catch(e => console.warn('private db', e));
  return compare.filter(c => c[3] === 'deficient').length;
}
// Three ways to read a plan: Superficial (free, in this browser), In-Depth (Claude API through the relay, ~1 min),
// Queued (stored in the private repo, processed once daily at ~12 AM by the scheduled routine).
// Review ▾ always opens (only a running review disables it); without a PDF the menu says so and its items are off.
function spButtons() { for (const id of ['#sp-free', '#sp-run', '#sp-queue-btn']) $(id).disabled = SP.busy || !SP.file; $('#sp-go').disabled = SP.busy; if (SP.busy) spMenu(false);
  const n = $('#sp-need'); if (n) n.hidden = !!SP.file; $('#sp-clear').disabled = SP.busy || !(SP.file || (S.review && S.review.ai)); }
// Clear the plan being reviewed: the chosen PDF, the copy kept in this browser, what was read from it, the markup rows
// it produced and the step-by-step verification. The reviewer's own entries in the form stay ("New review" clears those).
// Clear everything on Plan Review Hub (Clear button on Parcel Lookup, and New review): form, structures, checklist,
// markup, the plan being reviewed (and its copy in this browser) and the verification. The reviewer's name/email carry over.
function clearHub(question = 'Clear everything on Plan Review Hub — the review form, checklist, markup table, the plan being reviewed and its verification?') {
  if (SP.busy) { toast('Wait for the review that is running to finish.', 'error'); return; }
  if (!confirm(question)) return;
  SP.file = null; $('#sp-file').value = ''; $('#sp-name').textContent = 'or drag a PDF here (max 30 MB)';
  const st = $('#sp-status'); st.hidden = true; st.textContent = '';
  for (const id of ['pv', 'vf']) { const d = document.getElementById(id); if (d && d.open) d.close(); }
  try { indexedDB.deleteDatabase('mc-siteplan'); } catch {}
  S.review = blankReview(); saveDraft(S.review); $('#plat-hint').innerHTML = '';
  renderReview(); spButtons(); toast('Plan Review Hub cleared', 'ok');
}
async function clearPlan() {
  if (SP.busy) return;
  if (S.review.ai && !confirm(`Clear ${S.review.ai.file || 'this plan'} and everything read from it?`)) return;
  SP.file = null; $('#sp-file').value = ''; $('#sp-name').textContent = 'or drag a PDF here (max 30 MB)';
  const st = $('#sp-status'); st.hidden = true; st.textContent = '';
  delete S.review.ai; S.review.extra = (S.review.extra || []).filter(e => !e.ai); S.review.verified = {};
  saveDraft(S.review);
  const pv = document.getElementById('pv'); if (pv && pv.open) pv.close();
  const vf = document.getElementById('vf'); if (vf && vf.open) vf.close();
  try { indexedDB.deleteDatabase('mc-siteplan'); } catch {}
  renderReview(); spButtons(); toast('Plan cleared', 'ok');
}
async function runFreeRead() {
  if (!SP.file || SP.busy) return;
  SP.busy = true; spButtons();
  const st = $('#sp-status'); st.hidden = false; st.className = 'status'; st.textContent = 'Superficial Review: reading the PDF text in your browser…';
  try {
    const fr = await import('./freeread.js?v=9bac9315');
    const out = await fr.freeReadSitePlan(SP.file, S.review.type);
    if (out.quality === 'none') { st.className = 'status warn'; st.textContent = 'Superficial Review couldn\'t read this plan: the PDF has no selectable text (a scan or flattened drawing). Use Queued Review or In-Depth Review.'; return; }
    const bad = await finishRead(out.result, { engine: 'free', model: 'Superficial Review (in-browser text reader)', quality: out.quality, found: out.found, missing: out.missing }, st);
    if (out.quality === 'good') { st.className = `status ${bad ? 'warn' : 'ok'}`; st.textContent = `Superficial Review done — found ${out.found.join(', ')}.${out.missing.length ? ` Not found: ${out.missing.join(', ')}.` : ''}${bad ? ` ${bad} record mismatch${bad > 1 ? 'es' : ''} (see below).` : ''} Verify every value; use Queued or In-Depth Review for a full read.`; }
    else { st.className = 'status warn'; st.textContent = `Superficial Review only found ${out.found.join(', ') || 'very little'} (not found: ${out.missing.join(', ')}). What it found is filled in below. For a full read, use In-Depth Review (now) or Queued Review (tonight, no API cost).`; }
  } catch (e) { st.className = 'status err'; st.textContent = `Superficial Review failed: ${e.message}. Use Queued or In-Depth Review.`; }
  finally { SP.busy = false; spButtons(); }
}
async function runSitePlan() {
  if (!SP.file || SP.busy) return;
  SP.busy = true; spButtons();
  const st = $('#sp-status'); st.hidden = false; st.className = 'status'; st.textContent = 'In-Depth Review: sending the PDF to Claude — reading every sheet usually takes 30–90 seconds…';
  try {
    const sp = await import('./siteplan.js?v=9bac9315');
    const d = await sp.readSitePlan(SP.file, S.review.type);
    const bad = await finishRead(d.result || {}, { engine: 'claude', relay: d.relay || null, model: d.model, usage: d.usage, truncated: !!d.truncated }, st);
    st.className = `status ${bad ? 'warn' : 'ok'}`; st.textContent = `In-Depth Review done — the form is filled in from the plan.${bad ? ` ${bad} record mismatch${bad > 1 ? 'es' : ''} found (see below).` : ''} Verify every value before issuing comments.`;
  } catch (e) { st.className = 'status err'; st.textContent = e.message; }
  finally { SP.busy = false; spButtons(); }
}
async function runQueued() {
  if (!SP.file || SP.busy) return;
  if (!unlocked) { toast('Queued Review needs this browser to be connected (⚙ Settings → Test GitHub).', 'error'); return; }
  SP.busy = true; spButtons();
  const st = $('#sp-status'); st.hidden = false; st.className = 'status'; st.textContent = 'Queued Review: uploading the plan to the private queue…';
  try {
    const qm = await import('./queue.js?v=9bac9315');
    // Every queued plan carries its APN, so recalling it from Plan Queue fills this tab and Parcel Lookup.
    let apn = normalizeApn(S.review.apn) || '';
    if (!apn) { st.textContent = 'Queued Review: finding the APN on the plan…'; try { const fr = await import('./freeread.js?v=9bac9315'); const o = await fr.freeReadSitePlan(SP.file, S.review.type); apn = normalizeApn(o.result && o.result.parcel && o.result.parcel.apn) || ''; } catch {} }
    if (!apn) { const a = prompt(`What is the APN for ${SP.file.name}? (It's attached to the queued plan so it can be recalled with its parcel.)`, ''); if (a === null) { st.className = 'status warn'; st.textContent = 'Queued Review cancelled.'; return; } apn = normalizeApn(a) || ''; if (a.trim() && !apn) { st.className = 'status err'; st.textContent = `“${a}” isn't an APN (e.g. 304-88-146 or 401-52-034C). Queued Review cancelled.`; return; } }
    st.textContent = `Queued Review: uploading the plan${apn ? ` (APN ${apn})` : ''} to the private queue…`;
    const m = await qm.queuePlan(SP.file, { apn, type: S.review.type, reviewer: S.review.reviewer });
    st.className = 'status ok'; st.textContent = `Queued ${m.file}${m.apn ? ` with APN ${m.apn}` : ''}. The queue is processed once daily at ~12 AM; the results appear under Plan Queue on the right. The plan is kept 14 days, its data 45 days.`;
    renderQueued(true);
  } catch (e) { st.className = 'status err'; st.textContent = `Couldn't queue the plan: ${e.message}`; }
  finally { SP.busy = false; spButtons(); }
}
let qBusy = false, qLast = 0;
async function renderQueued(force = false) {
  if (force !== true && Date.now() - qLast < 30000 && S.qItems) return; // tab switches reuse a list loaded in the last 30 s
  const el = $('#sp-qlist'); if (!el) return;
  if (!unlocked) { el.innerHTML = '<p class="sub">Connect this browser (⚙ Settings → Test GitHub) to see queued reviews.</p>'; return; }
  if (!hasPerm('queue')) return;
  if (qBusy) return; qBusy = true;
  el.innerHTML = '<p class="sub">Loading…</p>';
  try {
    const qm = await import('./queue.js?v=9bac9315');
    const items = await qm.listQueue();
    const st = (m) => m.status === 'done' ? (m.hasResult ? '✅ Ready' : '✅ Done (data expired)') : m.status === 'failed' ? `⚠ ${esc(m.note || 'Could not be read')}` : m.status === 'processing' ? '⏳ Processing' : '🕛 Queued — processed ~12 AM';
    el.innerHTML = items.length ? `<ul class="qfiles">${items.map(m => `<li data-id="${esc(m.id)}" class="q-${esc(m.status)}">
        <div class="qf-top"><b title="${esc(m.file)}">${esc(m.file)}</b><span class="qf-st">${st(m)}</span></div>
        <div class="sub">${esc(m.apn || 'no APN')} · ${esc(CHECKLISTS[m.type]?.label || m.type)} · ${(m.size / 1048576).toFixed(1)} MB</div>
        <div class="sub">Queued ${esc(new Date(m.submitted).toLocaleString())}${m.processedAt ? ` · read ${esc(new Date(m.processedAt).toLocaleString())}` : ''}${m.hasPdf ? '' : ' · plan deleted (14 days)'}</div>
        <div class="qf-act">${m.hasResult ? '<button class="btn sm primary" data-qload>Load results</button>' : ''}<button class="btn sm ghost" data-qdel title="Delete the plan and its data now">✕ Delete</button></div></li>`).join('')}</ul>`
      : '<p class="sub">Nothing queued yet. Drop a plan on the left, click <b>Review ▾</b> and choose <b>Queued Review</b>.</p>';
    S.qItems = items; qLast = Date.now();
  } catch (e) { el.innerHTML = `<p class="bad">${esc(e.message)}</p>`; }
  finally { qBusy = false; }
}
async function loadQueued(m) {
  const st = $('#sp-status'); st.hidden = false; st.className = 'status'; st.textContent = `Loading the queued review of ${m.file}…`;
  try {
    const qm = await import('./queue.js?v=9bac9315');
    const rec = await qm.getRecord(m.db || `db/${m.id}.json`);
    const file = m.hasPdf ? await qm.getPdf(m.id).then(f => new File([f], m.file, { type: 'application/pdf' })) : new File([], m.file);
    if (m.hasPdf) SP.file = file;
    if (m.type && m.type !== S.review.type) { S.review.type = m.type; renderReview(); }
    // The plan's APN fills Parcel Lookup (full report) and this tab (APN, district, lot area, plat setbacks).
    const apn = normalizeApn(m.apn) || normalizeApn(rec.apn) || normalizeApn(rec.result && rec.result.parcel && rec.result.parcel.apn);
    if (apn) { st.textContent = `Looking up parcel ${apn} for ${m.file}…`; S.review.apn = apn; await runLookup(apn); if (!S.R || S.R.apn !== apn) S.review.apn = apn; st.className = 'status'; st.textContent = `Loading the queued review of ${m.file}…`; }
    const bad = await finishRead(rec.result || {}, { engine: 'queued', model: String(rec.model || 'Claude (Queued Review)').replace(/,?\s*LONDON/gi, '') }, st, file);
    st.className = `status ${bad ? 'warn' : 'ok'}`; st.textContent = `Queued Review loaded — read ${new Date(rec.inserted).toLocaleString()}.${apn ? ` Parcel ${apn} is filled in here and on Parcel Lookup.` : ' No APN was attached — enter it above or run a Parcel Lookup.'}${bad ? ` ${bad} record mismatch${bad > 1 ? 'es' : ''} found (see below).` : ''}${m.hasPdf ? '' : ' The plan itself has been deleted (14-day limit), so the Plan Viewer is unavailable.'} Verify every value.`;
  } catch (e) { st.className = 'status err'; st.textContent = e.message; }
}
async function openPlanViewer(focus) {
  const a = S.review.ai; if (!a || !a.result) { if (focus) toast('Read a plan first to see it here.', 'error'); return; }
  const pv = await import('./planviewer.js?v=9bac9315');
  const blob = SP.file && SP.file.name === a.file ? SP.file : await pv.loadPdf(a.file);
  if (!blob) { toast(`Choose ${a.file} again above (it isn't stored in this browser), then open the viewer.`, 'error'); return; }
  pv.openViewer(blob, a, S.review, computeFindings(S.review).F, a.file, typeof focus === 'string' ? focus : '');
}
$('#sp-out').addEventListener('click', (e) => { if (e.target.closest('#sp-view')) openPlanViewer(); });
// ---------------- Review Verification (one item at a time, in its own window) ----------------

async function renderVerifyCard() {
  S.vfMod = S.vfMod || await import('./verify.js?v=9bac9315');
  const p = S.vfMod.progress(S.review);
  $('#vf-prog i').style.width = `${p.total ? (p.done / p.total) * 100 : 0}%`;
  $('#vf-stat').innerHTML = !p.total ? 'Pick a submittal type to build the list.' : p.done === 0 ? `${p.total} items to verify · <b>${p.flagged}</b> flagged${S.review.ai ? ' by the plan reader' : ''} or not yet reviewed.` : p.done >= p.total ? `✅ All ${p.total} items verified.` : `${p.done} of ${p.total} verified · <b>${p.open}</b> flagged item${p.open === 1 ? '' : 's'} left.`;
  $('#vf-start').textContent = p.done === 0 ? 'Start Verification' : p.done >= p.total ? 'Review Again' : 'Resume Verification';
}
async function startVerify(flaggedOnly) {
  S.vfMod = S.vfMod || await import('./verify.js?v=9bac9315');
  let t;
  S.vfMod.openVerify(S.review, {
    flaggedOnly,
    onChange: () => { saveDraft(S.review); clearTimeout(t); t = setTimeout(() => { renderChecklist(); renderOutput(); renderVerifyCard(); }, 80); },
    onViewPlan: (title) => openPlanViewer(title),
    onFinish: () => { renderReview(); $('#rv-md').closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' }); toast('Verification saved to the Checklist and Markup Table', 'ok'); },
  });
}
$('#vf-start').addEventListener('click', () => startVerify(false));
$('#vf-flagged').addEventListener('click', () => startVerify(true));
$('#sp-file').addEventListener('change', (e) => spPick(e.target.files[0]));
$('#sp-run').addEventListener('click', runSitePlan);
$('#sp-free').addEventListener('click', runFreeRead);
$('#sp-queue-btn').addEventListener('click', runQueued);
$('#sp-clear').addEventListener('click', clearPlan);
$('#hub-clear').addEventListener('click', () => clearHub());
// Review ▾ menu: Superficial, Queued, In-Depth (items hidden when the access key lacks the permission).
function spMenu(open) { const m = $('#sp-menu'); m.hidden = !open; $('#sp-go').setAttribute('aria-expanded', String(open)); if (open) (m.querySelector('.sp-mi:not(:disabled), #sp-need:not([hidden])') || m).focus?.(); }
$('#sp-go').addEventListener('click', () => spMenu($('#sp-menu').hidden));
$('#sp-menu').addEventListener('click', (e) => { if (e.target.closest('#sp-need')) { spMenu(false); $('#sp-file').click(); return; } if (e.target.closest('.sp-mi')) spMenu(false); });
document.addEventListener('click', (e) => { if (!e.target.closest('#sp-review')) spMenu(false); });
$('#sp-menu').addEventListener('keydown', (e) => {
  const items = [...$('#sp-menu').querySelectorAll('.sp-mi')].filter(b => b.offsetParent && !b.disabled); const i = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { spMenu(false); $('#sp-go').focus(); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
});
$('#sp-qrefresh').addEventListener('click', () => renderQueued(true));
$('#sp-qlist').addEventListener('click', async (e) => {
  const tr = e.target.closest('[data-id]'); if (!tr) return; const m = (S.qItems || []).find(x => x.id === tr.dataset.id); if (!m) return;
  if (e.target.closest('[data-qload]')) loadQueued(m);
  if (e.target.closest('[data-qdel]')) { if (!confirm(`Delete ${m.file} and its review data from the private queue now?`)) return; try { (await import('./queue.js?v=9bac9315')).removeQueued(m).then(() => renderQueued(true)); } catch (err) { toast(err.message, 'error'); } }
});
{ const dz = $('#sp-drop');
  ['dragenter', 'dragover'].forEach(t => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', (e) => spPick(e.dataTransfer.files[0])); }


// ---------------- access keys (admin) ----------------
const ROLES = { viewer: ['review'], reviewer: ['review', 'write', 'queue'], senior: ['review', 'write', 'queue', 'rapid'], admin: ['review', 'write', 'queue', 'rapid', 'admin'] };
async function renderKeys(fresh = true) {
  const el = $('#st-keys-list'); if (!el || !hasPerm('admin')) return;
  $('#st-keys-who').textContent = perms().super ? `— you are signed in with the super account${perms().label && perms().label !== 'Super account' ? ` (${perms().label})` : ''}` : `— signed in as “${perms().label}”`;
  if (!fresh && el.dataset.loaded) return;
  el.innerHTML = '<p class="sub">Loading…</p>';
  try {
    const d = await relayFetch('/admin/keys');
    el.dataset.loaded = '1';
    el.innerHTML = `<ul class="keylist"><li data-key="super"><div><b>${esc(d.superName || 'Super account')}</b> <span class="sub">— super account: the passphrase (SITE_KEY in Cloudflare). Change it there to rotate.</span><div>${PERM_LIST.map(p => `<span class="pill">${p}</span>`).join('')}</div></div><span class="actions"><button class="btn sm ghost" type="button" data-rename>Edit name</button></span></li>${(d.keys || []).map(k => {
      const exp = k.expires ? new Date(k.expires) : null; const dead = exp && exp < new Date();
      return `<li data-key="${esc(k.id)}"><div><b>${esc(k.label)}</b> <span class="sub">— created ${esc(new Date(k.created).toLocaleDateString())}${k.createdBy ? ` by ${esc(k.createdBy)}` : ''}${exp ? ` · ${dead ? 'EXPIRED' : 'expires'} ${esc(exp.toLocaleDateString())}` : ''}</span><div>${(k.perms || []).map(p => `<span class="pill">${esc(p)}</span>`).join('')}</div></div><span class="actions"><button class="btn sm ghost" type="button" data-rename>Edit name</button><button class="btn sm ghost" type="button" data-revoke>Revoke</button></span></li>`; }).join('')}</ul>${(d.keys || []).length ? '' : '<p class="sub">No other keys yet.</p>'}`;
  } catch (e) { el.innerHTML = `<p class="bad">${esc(e.message)}</p>`; }
}
{
  const f = $('#st-keys-form');
  const setBoxes = (list) => $$('input[name=p]', f).forEach(b => { b.checked = list.includes(b.value); });
  f.role.addEventListener('change', () => { if (ROLES[f.role.value]) setBoxes(ROLES[f.role.value]); });
  $$('input[name=p]', f).forEach(b => b.addEventListener('change', () => { f.role.value = 'custom'; }));
  setBoxes(ROLES.reviewer);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      const body = { label: f.label.value.trim(), perms: $$('input[name=p]:checked', f).map(b => b.value), days: +f.days.value || 0 };
      const d = await relayFetch('/admin/keys/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const box = $('#st-newkey'); box.hidden = false;
      box.innerHTML = `<b>Key for ${esc(d.record.label)}</b> — copy it now; it won't be shown again:<div class="newkey">${esc(d.key)}</div><div class="actions"><button class="btn sm" type="button" id="st-newkey-copy">Copy key</button><button class="btn sm ghost" type="button" id="st-newkey-hide">Done</button></div><p class="sub">They open ${esc(location.origin + location.pathname)}, click <b>Sign In</b>, enter their name, paste this as the <b>Passphrase</b>, click Save, then Test GitHub.</p>`;
      $('#st-newkey-copy').onclick = () => copy(d.key); $('#st-newkey-hide').onclick = () => { box.hidden = true; box.innerHTML = ''; };
      f.reset(); setBoxes(ROLES.reviewer); renderKeys(true);
    } catch (err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; }
  });
  $('#st-keys-refresh').addEventListener('click', () => renderKeys(true));
  $('#st-keys-list').addEventListener('click', async (e) => {
    const li = e.target.closest('[data-key]'); if (!li) return;
    if (e.target.closest('[data-rename]')) {
      const current = li.querySelector('b').textContent; const label = prompt('Name for this user:', current === 'Super account' ? '' : current); if (label == null || !label.trim()) return;
      try { await relayFetch('/admin/keys/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: li.dataset.key, label: label.trim() }) }); toast('Name updated — it shows for that user at their next page load.', 'ok'); renderKeys(true); if (li.dataset.key === 'super' && perms().super || li.dataset.key === perms().id) verifyAccess(); } catch (err) { toast(err.message, 'error'); }
      return;
    }
    if (!e.target.closest('[data-revoke]')) return;
    if (!confirm('Revoke this key? Anyone using it loses access within a minute.')) return;
    try { await relayFetch('/admin/keys/revoke', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: li.dataset.key }) }); toast('Key revoked', 'ok'); renderKeys(true); } catch (err) { toast(err.message, 'error'); }
  });
}


// ---------------- collapsible boxes ----------------
// "sp": Read a site plan PDF + Plan Queue collapse together (remembered). "allsubs": All Subdivisions, collapsed by default;
// its countywide list loads the first time it is opened.
function setCollapsed(key, collapsed) {
  const targets = key === 'sp' ? [$('#p-review .sp-grid')] : [$(`#${key}`)];
  targets.forEach(t => t && t.classList.toggle('collapsed', collapsed));
  $$(`[data-collapse="${key}"]`).forEach(b => { b.textContent = collapsed ? '▸' : '▾'; b.setAttribute('aria-expanded', String(!collapsed)); b.title = collapsed ? 'Expand' : 'Collapse'; });
  if (key === 'sp') { try { localStorage.setItem('mc.spCollapsed', collapsed ? '1' : ''); } catch {} }
  if (key === 'allsubs' && !collapsed) { openAllSubs(); }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('.collapse-btn'); if (!b) return;
  const key = b.dataset.collapse; const now = b.getAttribute('aria-expanded') === 'true';
  setCollapsed(key, now);
});
try { if (localStorage.getItem('mc.spCollapsed')) setCollapsed('sp', true); } catch {}


// ---------------- Profile (click "Connected") ----------------
async function renderProfile() {
  if (!unlocked) { showTab('p-signin'); return; }
  const pp = perms();
  $('#pf-name').value = userName() === 'Signed in' ? '' : userName();
  $('#pf-account').textContent = `You have ${pp.legacy ? 'full access (update the relay to see your account type)' : accountType(pp)} with the following privileges: ${pp.perms.join(', ')}.`;
  const el = $('#pf-data'); el.textContent = 'Loading…';
  try { const d = await relayFetch('/me/files'); el.textContent = `${d.saved.length} saved item file${d.saved.length === 1 ? '' : 's'} · ${d.plans.length} plan file${d.plans.length === 1 ? '' : 's'} you submitted (queued plans and plan data).`; }
  catch (e) { el.textContent = /Not found|404/.test(e.message) ? 'Update the relay to v19 to see and clear your data.' : e.message; }
}
$('#pf-save-name').addEventListener('click', async () => {
  const label = $('#pf-name').value.trim(); if (!label) { toast('Enter a name.', 'error'); return; }
  try { await relayFetch('/me/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }) }); }
  catch (e) { if (!/Not found|404/.test(e.message)) { toast(e.message, 'error'); return; } }
  try { localStorage.setItem('mc.name', label); const v = JSON.parse(localStorage.getItem('mc.perms') || 'null'); if (v) { v.label = label; localStorage.setItem('mc.perms', JSON.stringify(v)); } } catch {}
  const who = rememberedReviewer(); rememberReviewer(label, who.email); if (!S.review.reviewer || S.review.reviewer === who.name) { S.review.reviewer = label; saveDraft(S.review); renderReview(); }
  renderBadge(); toast('Name saved', 'ok');
});
$('#pf-signout').addEventListener('click', () => {
  if (!confirm('Sign out and forget your key on this browser? Your saved items stay in your account.')) return;
  gh.passphrase = ''; try { ['mc.perms', 'mc.name'].forEach(k => localStorage.removeItem(k)); } catch {}
  // Don't leave plan data on a shared computer: the last plan PDF and the plan data in the review draft go too.
  try { indexedDB.deleteDatabase('mc-siteplan'); } catch {}
  if (S.review.ai) { delete S.review.ai; saveDraft(S.review); renderReview(); }
  S.qItems = null;
  revokeAccess(); showTab('p-signin'); renderSignin(); toast('Signed out on this browser', 'ok');
});
$('#pf-clear').addEventListener('click', async () => {
  if (!confirm('Delete ALL your saved items and every plan you submitted to the Plan Queue (with its data)? This cannot be undone.')) return;
  if (prompt('Type DELETE to confirm.') !== 'DELETE') return;
  try {
    const d = await relayFetch('/me/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    // This browser's copies too: the last plan PDF and plan data kept for the Plan Viewer.
    try { indexedDB.deleteDatabase('mc-siteplan'); } catch {}
    if (S.review.ai) { delete S.review.ai; saveDraft(S.review); renderReview(); }
    S.qItems = null; toast(`Cleared ${d.removed} file${d.removed === 1 ? '' : 's'}${d.failed ? ` (${d.failed} could not be removed — try again)` : ''}`, d.failed ? 'error' : 'ok');
    renderProfile();
  } catch (e) { toast(/Not found|404/.test(e.message) ? 'Update the relay to v19 to clear your data.' : e.message, 'error'); }
});

// ---------------- Admin: user folders ----------------
async function loadFolderUsers() {
  const sel = $('#sf-user'); if (!sel || !hasPerm('admin')) return;
  try {
    const d = await relayFetch('/admin/keys');
    const cur = sel.value;
    sel.innerHTML = '<option value="">— pick a user —</option>' + [{ id: 'super', label: d.superName || 'Super account' }, ...(d.keys || [])].map(k => `<option value="${esc(k.id)}">${esc(k.label)}${k.id === 'super' ? ' (super account)' : ''}</option>`).join('');
    sel.value = cur;
  } catch (e) { $('#sf-list').innerHTML = `<p class="bad">${esc(e.message)}</p>`; }
}
async function renderFolder() {
  const id = $('#sf-user').value, el = $('#sf-list'); if (!id) { el.innerHTML = ''; return; }
  el.innerHTML = '<p class="sub">Loading…</p>';
  try {
    const d = await relayFetch(`/admin/files?user=${encodeURIComponent(id)}`);
    const row = (f, label) => `<li data-path="${esc(f.path)}"><span>${esc(label)}</span><span class="actions"><button class="btn sm" type="button" data-sf="open">${f.path.endsWith('.pdf') ? 'Download' : 'Open'}</button><button class="btn sm ghost" type="button" data-sf="del">Remove</button></span></li>`;
    const saved = d.saved.map(f => row(f, f.path.replace(/^users\/[^/]+\//, ''))).join('');
    const plans = d.plans.map(f => row(f, `${f.path.startsWith('db/') ? 'plan data' : f.path.endsWith('.pdf') ? 'plan PDF' : 'queue item'} · ${f.file || f.path.split('/').pop()}${f.apn ? ` · ${f.apn}` : ''}${f.when ? ` · ${new Date(f.when).toLocaleDateString()}` : ''}`)).join('');
    el.innerHTML = `<div class="folder"><h3>Saved Items (${d.saved.length})</h3><ul class="saved-files">${saved || '<li class="sub">None</li>'}</ul><h3>Plans Submitted (${d.plans.length})</h3><ul class="saved-files">${plans || '<li class="sub">None</li>'}</ul></div>`;
  } catch (e) { el.innerHTML = `<p class="bad">${esc(/Not found|404/.test(e.message) ? 'Update the relay to v19 to browse user folders.' : e.message)}</p>`; }
}
$('#sf-user').addEventListener('change', renderFolder);
$('#sf-refresh').addEventListener('click', async () => { await loadFolderUsers(); renderFolder(); });
$('#sf-list').addEventListener('click', async (e) => {
  const li = e.target.closest('[data-path]'); const b = e.target.closest('[data-sf]'); if (!li || !b) return;
  const path = li.dataset.path;
  if (b.dataset.sf === 'del') {
    if (!confirm(`Remove ${path}? This cannot be undone.`)) return;
    try { await relayFetch('/admin/del', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) }); toast('Removed', 'ok'); renderFolder(); } catch (err) { toast(err.message, 'error'); }
    return;
  }
  try {
    const r = await fetch(`${settings.proxy}/admin/raw?path=${encodeURIComponent(path)}`, { headers: { 'X-MC-Key': gh.passphrase }, cache: 'no-store' });
    if (!r.ok) throw new Error(`Couldn't open (${r.status})`);
    const blob = await r.blob(); const name = path.split('/').pop();
    if (path.endsWith('.pdf')) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); return; }
    const text = await blob.text(); const dlg = $('#saved-view');
    $('#sv-title').textContent = name; $('#sv-text').textContent = text; dlg.dataset.admin = path; dlg.showModal();
  } catch (err) { toast(err.message, 'error'); }
});


// ---------------- Behind the Curtains (games) ----------------
const GM = { cat: 'mixed', round: null, i: 0, correct: 0, answered: 0, token: null, locked: false };
async function renderBoard() {
  const el = $('#lb-list');
  try {
    const r = await fetch(`${settings.proxy}/g/board`, { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(r.status === 404 ? 'The leaderboard needs relay v20.' : d.error || `Relay error ${r.status}`);
    const me = unlocked ? userName() : '';
    el.innerHTML = (d.board || []).map((p, i) => `<li class="lb${p.name === me ? ' me' : ''}"><span class="lb-rank">${i + 1}</span><span class="lb-name" title="${esc(p.name)} · ${p.rounds} round${p.rounds === 1 ? '' : 's'} · ${p.accuracy}% correct · best round ${p.best}">${esc(p.name)}</span><span class="lb-pts">${fmtNum(p.points)}</span></li>`).join('') || '<li class="sub">No scores yet — be the first.</li>';
  } catch (e) { el.innerHTML = `<li class="sub">${esc(/Failed to fetch/.test(e.message) ? "Couldn't reach the relay." : e.message)}</li>`; }
}
const fmtNum = (n) => Number(n || 0).toLocaleString('en-US');
async function renderGames() {
  const cats = $('#mct .mct-cats');
  if (!cats.childElementCount) {
    const { CATS } = await import('./games.js?v=9bac9315');
    cats.innerHTML = CATS.map(([k, l]) => `<button class="btn sm" type="button" role="radio" data-cat="${k}" aria-checked="${k === GM.cat}">${l}</button>`).join('');
  }
  $('#mct-go').disabled = !unlocked;
  $('#mct-lock').textContent = unlocked ? `Playing as ${userName()}` : 'Sign in with a key to play — anyone can watch the leaderboard.';
  renderBoard();
}
function showQuestion() {
  const x = GM.round[GM.i];
  $('#mct-cat').textContent = x.cat; $('#mct-prog').textContent = `Question ${GM.i + 1} of ${GM.round.length}`; $('#mct-score').textContent = `${GM.correct * 10} pts`;
  $('#mct-q').textContent = x.prompt;
  $('#mct-opts').innerHTML = x.options.map((o, i) => `<button class="btn" type="button" data-opt="${i}">${String.fromCharCode(65 + i)}. ${esc(o)}</button>`).join('');
  $('#mct-fb').hidden = true; $('#mct-next').hidden = true;
}
async function finishRound(quit = false) {
  $('#mct-play').hidden = true; const done = $('#mct-done'); done.hidden = false;
  done.innerHTML = `<p>${quit ? 'Round ended early.' : 'Round complete!'} You got <b>${GM.correct} of ${GM.answered}</b> right.</p><p class="sub">Saving your score…</p>`;
  try {
    const d = await relayFetch('/g/finish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: GM.token, answered: GM.answered, correct: GM.correct }) });
    done.innerHTML = `<p>${quit ? 'Round ended early.' : 'Round complete!'} You got <b>${GM.correct} of ${GM.answered}</b> right and earned <b>${d.earned} points</b>${d.earned > GM.correct * 10 ? ' (perfect-round bonus!)' : ''}. Your total: <b>${fmtNum(d.total)}</b>.</p>`;
  } catch (e) { done.innerHTML += `<p class="bad">${esc(e.message)}</p>`; }
  done.innerHTML += '<div class="actions"><button class="btn primary" type="button" id="mct-again">Play again</button></div>';
  $('#mct-start').hidden = false; renderBoard();
}
$('#mct .mct-cats').addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (!b) return; GM.cat = b.dataset.cat; $$('#mct .mct-cats [data-cat]').forEach(x => x.setAttribute('aria-checked', String(x === b))); });
$('#mct-go').addEventListener('click', async () => {
  if (!unlocked) { toast('Sign in with a key to play.', 'error'); return; }
  const btn = $('#mct-go'); btn.disabled = true;
  try {
    const [{ buildRound }, start] = await Promise.all([import('./games.js?v=9bac9315'), relayFetch('/g/start', { method: 'POST' })]);
    Object.assign(GM, { round: await buildRound(GM.cat, start.questions || 10), i: 0, correct: 0, answered: 0, token: start.token, locked: false });
    $('#mct-start').hidden = true; $('#mct-done').hidden = true; $('#mct-play').hidden = false; showQuestion();
  } catch (e) { toast(/Not found|404/.test(e.message) ? 'Games need relay v20 — ask the administrator to update the relay.' : e.message, 'error'); }
  finally { btn.disabled = !unlocked; }
});
$('#mct-opts').addEventListener('click', (e) => {
  const b = e.target.closest('[data-opt]'); if (!b || GM.locked) return; GM.locked = true;
  const x = GM.round[GM.i]; const pickI = +b.dataset.opt; const right = pickI === x.answer;
  GM.answered++; if (right) GM.correct++;
  $$('#mct-opts [data-opt]').forEach(o => { o.disabled = true; if (+o.dataset.opt === x.answer) o.classList.add('right'); });
  if (!right) b.classList.add('wrong');
  const fb = $('#mct-fb'); fb.hidden = false;
  fb.innerHTML = `<b>${right ? '✅ Correct!' : '❌ Not quite.'}</b> ${esc(x.explain)} <span class="sub">— <a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.cite)}</a></span>`;
  $('#mct-score').textContent = `${GM.correct * 10} pts`;
  const last = GM.i === GM.round.length - 1; const nx = $('#mct-next'); nx.hidden = false; nx.textContent = last ? 'Finish round' : 'Next question'; nx.focus();
});
$('#mct-next').addEventListener('click', () => { if (GM.i >= GM.round.length - 1) return finishRound(); GM.i++; GM.locked = false; showQuestion(); });
$('#mct-quit').addEventListener('click', () => { if (GM.answered && confirm('End this round now? Answers so far still count.')) finishRound(true); else if (!GM.answered) { $('#mct-play').hidden = true; $('#mct-start').hidden = false; } });
$('#mct-done').addEventListener('click', (e) => { if (e.target.id === 'mct-again') { $('#mct-done').hidden = true; $('#mct-go').click(); } });
$('#lb-refresh').addEventListener('click', renderBoard);

bindReview(); renderReview(); renderSettings(); classify(); loadSharedConfig();
loadDB().catch(e => { $('#db-source').textContent = `Could not load database: ${e.message}`; }).finally(() => loadQueue());
const qApn = new URLSearchParams(location.search).get('apn');
const hashTab = location.hash ? `p-${location.hash.slice(1)}` : null;
let start = 'p-lookup'; try { start = localStorage.getItem('mc.tab') || start; } catch {}
applyAccess(false); // fail closed until checked
let navigated = false; $$('.tab').forEach(b => b.addEventListener('click', () => { navigated = true; }));
checkAccess().finally(() => { if (!qApn && !navigated) showTab(document.getElementById(hashTab || '') ? hashTab : start); });
showTab('p-lookup');
if (qApn) { showTab('p-lookup'); $('#lookup-apn').value = qApn; runLookup(qApn); }
