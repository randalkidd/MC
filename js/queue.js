// Private plan queue + plan-review data, kept in the PRIVATE repo randalkidd/MC-queue through the relay (/q/*).
// Only works when this browser is connected (relay + passphrase). Nothing here touches the public repo.
//   queue/<id>.pdf   the queued plan            — deleted after 14 days
//   queue/<id>.json  { id, file, size, apn, type, reviewer, submitted, status, note?, processedAt?, db? }
//   db/<id>.json     data read from a plan       — deleted 45 days after `inserted`
import { gh } from './github.js?v=5d976b11';
import { settings } from './net.js?v=5d976b11';

export const PDF_DAYS = 14, DATA_DAYS = 45;
const DAY = 86400000;

async function q(route, init = {}, { raw = false } = {}) {
  const base = settings.proxy;
  let r;
  try { r = await fetch(`${base}${route}`, { ...init, headers: { 'X-MC-Key': gh.passphrase, ...(init.headers || {}) }, cache: 'no-store' }); }
  catch { throw new Error(`Couldn't reach the relay at ${base}.`); }
  if (r.status === 404 && !raw) { const t = await r.text(); if (!/"error"/.test(t)) throw new Error('The relay is out of date — paste the latest relay code (v15+) into Cloudflare and Deploy.'); throw new Error(JSON.parse(t).error); }
  if (!r.ok) { let m = ''; try { m = (await r.json()).error; } catch {} if (r.status === 401) m = 'Wrong passphrase — re-enter it in Settings.'; throw new Error(m || `Relay error ${r.status}`); }
  return raw ? r : r.json();
}
const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
const b64text = (str) => b64(new TextEncoder().encode(str));
const putJson = (path, obj, message) => q(`/q/put?path=${encodeURIComponent(path)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, content: b64text(JSON.stringify(obj, null, 2) + '\n') }) });

export function newId(apn) {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${String(apn || 'no-apn').replace(/[^A-Za-z0-9-]/g, '')}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function queuePlan(file, { apn, type, reviewer }) {
  if (file.size > 30 * 1024 * 1024) throw new Error('PDF is larger than 30 MB — export just the site plan sheets.');
  const id = newId(apn);
  const bytes = new Uint8Array(await file.arrayBuffer());
  await q(`/q/put?path=${encodeURIComponent(`queue/${id}.pdf`)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `Queue plan ${id}`, content: b64(bytes) }) });
  const meta = { id, file: file.name, size: file.size, apn: apn || '', type, reviewer: reviewer || '', submitted: new Date().toISOString(), status: 'queued' };
  await putJson(`queue/${id}.json`, meta, `Queue plan ${id} (metadata)`);
  return meta;
}

// Queue items with their status (newest first), plus which have results in the database.
export async function listQueue() {
  // One request on relay v17+ (/q/list); older relays: the file tree, then each queue item.
  let files, items;
  try { ({ files, items } = await q('/q/list')); }
  catch (e) {
    if (!/out of date|Not found/i.test(e.message)) throw e;
    ({ files } = await q('/q/tree'));
    items = await Promise.all(files.filter(f => /^queue\/.+\.json$/.test(f.path)).map(async f => { try { const r = await q(`/q/raw?path=${encodeURIComponent(f.path)}`, {}, { raw: true }); return await r.json(); } catch { return null; } }));
  }
  const pdfs = new Set(files.filter(f => f.path.endsWith('.pdf')).map(f => f.path));
  const db = new Set(files.filter(f => f.path.startsWith('db/')).map(f => f.path));
  const now = Date.now();
  return items.filter(Boolean).map(m => ({ ...m, hasPdf: pdfs.has(`queue/${m.id}.pdf`) && now - Date.parse(m.submitted) < PDF_DAYS * DAY, hasResult: db.has(m.db || `db/${m.id}.json`) }))
    .sort((a, b) => (a.submitted < b.submitted ? 1 : -1));
}
export async function getPdf(id) { const r = await q(`/q/raw?path=${encodeURIComponent(`queue/${id}.pdf`)}`, {}, { raw: true }); return new File([await r.blob()], `${id}.pdf`, { type: 'application/pdf' }); }
export async function getRecord(path) {
  const r = await q(`/q/raw?path=${encodeURIComponent(path)}`, {}, { raw: true }); const rec = await r.json();
  if (rec.inserted && Date.now() - Date.parse(rec.inserted) > DATA_DAYS * DAY) throw new Error('That review data is older than 45 days and has expired.');
  return rec;
}
export async function removeQueued(m) {
  for (const p of [`queue/${m.id}.pdf`, `queue/${m.id}.json`, m.db || `db/${m.id}.json`]) await q(`/q/del?path=${encodeURIComponent(p)}`, { method: 'POST' }).catch(() => {});
}
// Every plan read (Superficial, Queued, In-Depth) is stored in the private database for 45 days.
export async function saveRecord({ id, source, file, apn, type, model, result, compare }) {
  const rid = id || newId(apn);
  await putJson(`db/${rid}.json`, { id: rid, inserted: new Date().toISOString(), expires: new Date(Date.now() + DATA_DAYS * DAY).toISOString(), source, file, apn: apn || '', type, model: model || '', result, compare: compare || [] }, `Plan data ${rid} (${source})`);
  return rid;
}

// ---------------- personal Saved Parcels (relay v18: /u/*) ----------------
// Saved parcel reports and plan reviews live in the signed-in user's own private folder; nobody else can list them.
const UPGRADE = 'Saved Parcels needs relay v18 — paste the latest relay code into Cloudflare and Deploy.';
export async function listMine() { try { return (await q('/u/list')).files; } catch (e) { if (/out of date|Not found/i.test(e.message)) throw new Error(UPGRADE); throw e; } }
export async function getMine(path) { const r = await q(`/u/raw?path=${encodeURIComponent(path)}`, {}, { raw: true }); return r.text(); }
export async function putMine(path, content) {
  try { return await q(`/u/put?path=${encodeURIComponent(path)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }); }
  catch (e) { if (/out of date|Not found/i.test(e.message)) throw new Error(UPGRADE); throw e; }
}
export async function delMine(path) { return q(`/u/del?path=${encodeURIComponent(path)}`, { method: 'POST' }); }
