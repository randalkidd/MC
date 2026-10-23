// Cloudflare Worker — relay + GitHub save service for the MC Zoning Review site.
//
// 1) CORS relay:  GET/POST /?url=<https://*.maricopa.gov/...>
//    Forwards to an allow-listed set of Maricopa County hosts and adds CORS headers.
// 2) GitHub save: POST /gh/write  { path, content, message }   (header X-MC-Key: <your passphrase>)
//                 GET/POST /admin/scores[/edit|/remove|/clear]   (admin) Behind the Curtains scoreboard
//                 GET  /gh/ping                                  (header X-MC-Key) → checks passphrase + token
//    Commits files under data/ in your repo using a token stored ONCE here as a secret,
//    so each browser only needs the short passphrase.
//
// Secrets to add in Cloudflare (Worker → Settings → Variables and Secrets → Add → Type: Secret):
//   GITHUB_TOKEN = github_pat_...   (fine-grained, repo randalkidd/MC, Contents: Read and write)
//   SITE_KEY     = a passphrase you choose (what you'll type in each browser)
//   ANTHROPIC_API_KEY = sk-ant-...  (optional; enables Plan review → "Read a site plan PDF" via POST /ai/siteplan)
//   ANTHROPIC_MODEL   = optional Text variable to override the model (default below)

const RELAY_VERSION = '22';
// Settings. Defaults below; each can be overridden by a Cloudflare variable (Worker → Settings → Variables and
// Secrets, Type: Text) or, for local `wrangler dev`, by worker/.dev.vars (never committed — see .dev.vars.example).
//   ALLOWED_ORIGIN = https://randalkidd.github.io   (comma-separate to add e.g. http://localhost:8000 for local testing)
//   REPO = randalkidd/MC     BRANCH = main     QUEUE_REPO = randalkidd/MC-queue (private: queued plans + plan-review data)
const DEFAULTS = { ALLOWED_ORIGIN: 'https://randalkidd.github.io', REPO: 'randalkidd/MC', BRANCH: 'main', QUEUE_REPO: 'randalkidd/MC-queue' };
let ORIGINS = new Set([DEFAULTS.ALLOWED_ORIGIN]); // only your site may use this relay
let ALLOWED_ORIGIN = DEFAULTS.ALLOWED_ORIGIN;
let REPO = DEFAULTS.REPO;
let BRANCH = DEFAULTS.BRANCH;
let QUEUE_REPO = DEFAULTS.QUEUE_REPO;
function configure(env) {
  const list = String(env.ALLOWED_ORIGIN || DEFAULTS.ALLOWED_ORIGIN).split(',').map(s => s.trim().replace(/\/$/, '')).filter(o => /^https:\/\/[a-z0-9.-]+$|^http:\/\/localhost(:\d+)?$/i.test(o));
  ORIGINS = new Set(list.length ? list : [DEFAULTS.ALLOWED_ORIGIN]); ALLOWED_ORIGIN = [...ORIGINS][0];
  REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.REPO || '') ? env.REPO : DEFAULTS.REPO;
  BRANCH = /^[A-Za-z0-9_.\/-]{1,100}$/.test(env.BRANCH || '') ? env.BRANCH : DEFAULTS.BRANCH;
  QUEUE_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.QUEUE_REPO || '') ? env.QUEUE_REPO : DEFAULTS.QUEUE_REPO;
}
const allowed = (origin) => ORIGINS.has(origin);
const ALLOWED_HOSTS = new Set([
  'gis.maricopa.gov',
  'edms.maricopa.gov',
  'recorder.maricopa.gov',
  'legacy.recorder.maricopa.gov',
  'www.maricopa.gov',
  'publicapi.recorder.maricopa.gov',
]);

const cors = (origin) => ({
  'X-Relay-Version': RELAY_VERSION,
  'Access-Control-Allow-Origin': allowed(origin) ? origin : ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-MC-Key, X-MC-Context',
  'Access-Control-Max-Age': '86400',
  'X-Content-Type-Options': 'nosniff',
  'Access-Control-Expose-Headers': 'X-Relay-Block, X-Relay-Upstream-Status, X-Relay-Version',
  Vary: 'Origin',
});
const json = (obj, status, origin) => new Response(JSON.stringify(obj), { status, headers: { ...cors(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

function sameKey(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const b64 = (str) => { const bytes = new TextEncoder().encode(str); let s = ''; for (const x of bytes) s += String.fromCharCode(x); return btoa(s); };

async function gh(env, path, init = {}) {
  return fetch(`https://api.github.com/repos/${REPO}${path ? `/${path}` : ''}`, { // no trailing slash — GitHub rejects /repos/o/r/
    ...init,
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'mc-relay', ...(init.headers || {}) },
  });
}

// Explain why GitHub refused the stored token: invalid/expired vs. valid but not allowed on this repo.
async function tokenProblem(env, status) {
  const u = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'mc-relay' } });
  if (u.status === 401) return `GitHub ${status}: the GITHUB_TOKEN stored in this relay is invalid or expired. Create a new fine-grained token (repo ${REPO}, Contents: Read and write) and replace the GITHUB_TOKEN secret in Cloudflare.`;
  const who = u.ok ? (await u.json().catch(() => ({}))).login : '';
  return `GitHub ${status}: the GITHUB_TOKEN stored in this relay${who ? ` (belongs to ${who})` : ''} works but can't ${status === 403 ? 'write to' : 'see'} ${REPO}. Edit the token on GitHub → Repository access → include ${REPO.split('/')[1]}, Permissions → Contents: Read and write, then save (or create a new token and replace GITHUB_TOKEN in Cloudflare).`;
}

// ---------------- access keys ----------------
// SITE_KEY (the original passphrase) is the SUPER account: every permission, including managing keys.
// More keys, with fewer permissions, live hashed (SHA-256) in the private repo at access/keys.json and are created /
// revoked from ⚙ Settings → Access keys by a key with "admin". The plain key is shown once and never stored.
//   review — Plan Review Hub, Land division, Saved Parcels (read)      write — save to GitHub (SubdivisionDB, waitlist,
//   queue  — Queued Review (private queue)                             rapid — Rapid Review (Anthropic API, costs money)
//   admin  — manage access keys
const PERMS = ['review', 'write', 'queue', 'rapid', 'admin'];
const KEYS_PATH = 'access/keys.json';
/** @type {{ t: number, list: any[] | null, sha: string | null, superName: string }} */
let keyCache = { t: 0, list: null, sha: null, superName: '' };
const sha256hex = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
async function loadKeys(env, fresh = false) {
  if (!fresh && keyCache.list && Date.now() - keyCache.t < 60000) return keyCache;
  const r = await ghq(env, `contents/${KEYS_PATH}`);
  if (r.status === 404) { keyCache = { t: Date.now(), list: [], sha: null, superName: '' }; return keyCache; }
  if (!r.ok) { if (keyCache.list) return keyCache; throw new Error(`GitHub ${r.status} reading access keys`); }
  const d = await r.json();
  const txt = new TextDecoder().decode(Uint8Array.from(atob(String(d.content).replace(/\n/g, '')), c => c.charCodeAt(0)));
  let list = [], superName = ''; try { const j = JSON.parse(txt); list = j.keys || []; superName = j.superName || ''; } catch {}
  keyCache = { t: Date.now(), list, sha: d.sha, superName }; return keyCache;
}
// Failed-passphrase throttle: 10 misses in 10 minutes from one IP → that IP gets 429 for the rest of the window.
const FAILS = new Map();
const ipOf = (req) => req.headers.get('CF-Connecting-IP') || 'unknown';
function throttled(req) { const f = FAILS.get(ipOf(req)); return !!f && Date.now() - f.t < 600000 && f.n >= 10; }
function noteFail(req) { const ip = ipOf(req); const f = FAILS.get(ip); const now = Date.now(); if (!f || now - f.t > 600000) FAILS.set(ip, { n: 1, t: now }); else f.n++; if (FAILS.size > 5000) FAILS.clear(); }
// → { label, perms[], super } or null
async function authenticate(req, env) {
  const k = req.headers.get('X-MC-Key') || '';
  if (!k) return null;
  const who = await authenticateKey(k, env);
  if (!who) noteFail(req);
  return who;
}
async function authenticateKey(k, env) {
  if (env.SITE_KEY && sameKey(k, env.SITE_KEY)) { let name = ''; try { if (env.GITHUB_TOKEN) name = (await loadKeys(env)).superName; } catch {} return { id: 'super', label: name || 'Super account', perms: PERMS.slice(), super: true }; }
  if (!env.GITHUB_TOKEN || k.length < 16) return null;
  let keys; try { keys = (await loadKeys(env)).list; } catch { return null; }
  const h = await sha256hex(k); const now = Date.now();
  const hit = keys.find(x => sameKey(x.hash || '', h) && !x.disabled && !(x.expires && Date.parse(x.expires) < now));
  return hit ? { id: hit.id, label: hit.label, perms: (hit.perms || []).filter(p => PERMS.includes(p)), super: false } : null;
}
const can = (who, perm) => !!who && who.perms.includes(perm);
const denied = (origin, perm) => json({ error: `Your access key doesn't allow this (needs "${perm}"). Ask the site administrator.` }, 403, origin);
// ---------------- a user's data (Profile + admin folders) ----------------
const ADMIN_PATH = /^(users\/[A-Za-z0-9_-]{1,40}\/(parcels|reviews)\/[A-Za-z0-9._-]{1,120}\.(md|json)|(queue|db)\/[A-Za-z0-9._-]{1,120}\.(pdf|json))$/;
const META_CACHE = new Map();
const safeId = (id) => String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
async function readJsonPath(env, path) { const r = await ghq(env, `contents/${path}`, { headers: { Accept: 'application/vnd.github.raw' } }); return r.ok ? r.json().catch(() => null) : null; }
// Every file belonging to user `id`: their saved items, the plans they queued (PDF + metadata) and plan data they saved.
async function userFiles(env, id) {
  const r = await ghq(env, 'git/trees/main?recursive=1');
  if (r.status === 409) return { saved: [], plans: [] };
  if (!r.ok) throw new Error(`GitHub ${r.status} on ${QUEUE_REPO}`);
  const tree = ((await r.json()).tree || []).filter(t => t.type === 'blob');
  const base = `users/${safeId(id)}/`;
  const saved = tree.filter(t => t.path.startsWith(base) && ADMIN_PATH.test(t.path)).map(t => ({ path: t.path, size: t.size }));
  const metas = tree.filter(t => /^(queue|db)\/.+\.json$/.test(t.path)).slice(0, 400);
  // Blob SHAs change only when a file changes, so each queue/db file is read once per Worker instance, not on every request.
  const owned = (await Promise.all(metas.map(async t => { let j = META_CACHE.get(t.sha); if (j === undefined) { const full = await readJsonPath(env, t.path); j = full ? { by: full.by || '', file: full.file || '', apn: full.apn || '', when: full.submitted || full.inserted || '', status: full.status || full.source || '' } : null; if (full) { if (META_CACHE.size > 3000) META_CACHE.clear(); META_CACHE.set(t.sha, j); } } return j && j.by === id ? { path: t.path, size: t.size, file: j.file, apn: j.apn, when: j.when, status: j.status } : null; }))).filter(Boolean);
  const pdfs = new Set(tree.filter(t => t.path.endsWith('.pdf')).map(t => t.path));
  const plans = owned.flatMap(x => { const pdf = x.path.startsWith('queue/') ? x.path.replace(/\.json$/, '.pdf') : null; return pdf && pdfs.has(pdf) ? [x, { ...x, path: pdf }] : [x]; });
  return { saved, plans };
}
async function delPath(env, path, message) {
  const cur = await ghq(env, `contents/${path}`); if (cur.status === 404) return true; if (!cur.ok) return false;
  const sha = (await cur.json()).sha;
  const del = await ghq(env, `contents/${path}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, sha }) });
  return del.ok;
}
async function handleMe(req, env, origin, route, who) {
  if (!env.GITHUB_TOKEN) return json({ error: 'Relay is missing GITHUB_TOKEN.' }, 500, origin);
  if (!who) return json({ error: 'Wrong passphrase.' }, 401, origin);
  let body = {}; if (req.method === 'POST') { try { body = await req.json(); } catch {} }
  if (route === '/me/rename' && req.method === 'POST') {
    const label = String(body.label || '').trim().slice(0, 60); if (!label) return json({ error: 'Enter a name.' }, 400, origin);
    const { list, sha, superName } = await loadKeys(env, true);
    const save = async (l, nm, msg) => { const out = JSON.stringify({ schema: 1, updated: new Date().toISOString(), superName: nm, keys: l }, null, 2) + '\n'; const put = await ghq(env, `contents/${KEYS_PATH}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg, content: b64(out), ...(sha ? { sha } : {}) }) }); keyCache = { t: 0, list: null, sha: null, superName: '' }; if (!put.ok) throw new Error(`GitHub ${put.status} saving the name`); };
    if (who.super) await save(list, label, 'Super account renamed itself');
    else { const k = list.find(x => x.id === who.id); if (!k) return json({ error: 'Key not found.' }, 404, origin); k.label = label; await save(list, superName, 'User renamed themself'); }
    return json({ ok: true, label }, 200, origin);
  }
  if (route === '/me/files' && req.method === 'GET') return json({ ok: true, ...(await userFiles(env, who.id)) }, 200, origin);
  if (route === '/me/clear' && req.method === 'POST') {
    // Only this user's saved items and the plans / plan data they submitted. Nothing else.
    const { saved, plans } = await userFiles(env, who.id);
    let n = 0, failed = 0;
    for (const f of [...saved, ...plans]) { if (await delPath(env, f.path, `Cleared by ${who.label}`)) n++; else failed++; }
    return json({ ok: true, removed: n, failed }, 200, origin);
  }
  return json({ error: 'Not found' }, 404, origin);
}

async function handleAdmin(req, env, origin, route, who) {
  if (!can(who, 'admin')) return denied(origin, 'admin');
  if (!env.GITHUB_TOKEN) return json({ error: 'Relay is missing GITHUB_TOKEN.' }, 500, origin);
  const save = async (list, sha, message, superName = keyCache.superName || '') => {
    const body = JSON.stringify({ schema: 1, updated: new Date().toISOString(), superName, keys: list }, null, 2) + '\n';
    const put = await ghq(env, `contents/${KEYS_PATH}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, content: b64(body), ...(sha ? { sha } : {}) }) });
    if (!put.ok) throw new Error(`GitHub ${put.status} saving access keys${put.status === 404 ? ` — check that ${QUEUE_REPO} exists and the token can write to it` : ''}`);
    keyCache = { t: 0, list: null, sha: null, superName: '' };
  };
  const pub = (x) => ({ id: x.id, label: x.label, perms: x.perms, created: x.created, createdBy: x.createdBy, expires: x.expires || null, disabled: !!x.disabled });
  if (route === '/admin/keys' && req.method === 'GET') { const { list, superName } = await loadKeys(env, true); return json({ ok: true, superName: superName || '', keys: list.map(pub) }, 200, origin); }
  let body = {}; try { body = await req.json(); } catch {}
  if (route === '/admin/keys/create' && req.method === 'POST') {
    const label = String(body.label || '').trim().slice(0, 60); if (!label) return json({ error: 'Give the key a name (who it is for).' }, 400, origin);
    const perms = [...new Set((Array.isArray(body.perms) ? body.perms : []).filter(p => PERMS.includes(p)))];
    if (!perms.length) return json({ error: 'Pick at least one permission.' }, 400, origin);
    const days = Math.max(0, Math.min(3650, parseInt(body.days, 10) || 0));
    const raw = crypto.getRandomValues(new Uint8Array(15)); const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    const key = 'mc-' + [...raw].map(b => alphabet[b % alphabet.length]).join('').replace(/(.{5})(?=.)/g, '$1-');
    const { list, sha } = await loadKeys(env, true);
    if (list.length >= 200) return json({ error: 'Too many keys — revoke unused ones first.' }, 400, origin);
    const rec = { id: `k${Date.now().toString(36)}${[...crypto.getRandomValues(new Uint8Array(3))].map(b => b.toString(36)).join('')}`, label, perms, hash: await sha256hex(key), created: new Date().toISOString(), createdBy: who.label, ...(days ? { expires: new Date(Date.now() + days * 86400000).toISOString() } : {}) };
    await save([...list, rec], sha, `Access key added: ${label}`);
    return json({ ok: true, key, record: pub(rec) }, 200, origin);
  }
  if (route === '/admin/files' && req.method === 'GET') {
    const id = safeId(new URL(req.url).searchParams.get('user')); if (!id) return json({ error: 'Pick a user.' }, 400, origin);
    return json({ ok: true, user: id, ...(await userFiles(env, id)) }, 200, origin);
  }
  if (route === '/admin/raw' && req.method === 'GET') {
    const path = new URL(req.url).searchParams.get('path') || ''; if (!ADMIN_PATH.test(path) || path.includes('..')) return json({ error: 'Bad path.' }, 400, origin);
    const r = await ghq(env, `contents/${path}`, { headers: { Accept: 'application/vnd.github.raw' } });
    if (!r.ok) return json({ error: r.status === 404 ? 'Not found.' : `GitHub ${r.status}` }, r.status === 404 ? 404 : 502, origin);
    return new Response(r.body, { status: 200, headers: { ...cors(origin), 'Content-Type': path.endsWith('.pdf') ? 'application/pdf' : path.endsWith('.json') ? 'application/json' : 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="${path.split('/').pop()}"`, 'Cache-Control': 'no-store' } });
  }
  if (route === '/admin/del' && req.method === 'POST') {
    const path = String(body.path || ''); if (!ADMIN_PATH.test(path) || path.includes('..')) return json({ error: 'Bad path.' }, 400, origin);
    return (await delPath(env, path, `Removed by administrator ${who.label}`)) ? json({ ok: true }, 200, origin) : json({ error: 'Delete failed.' }, 502, origin);
  }
  if (route === '/admin/keys/rename' && req.method === 'POST') {
    // Edit a user's name (an access key's label), or the super account's name (id "super").
    const label = String(body.label || '').trim().slice(0, 60); if (!label) return json({ error: 'Enter a name.' }, 400, origin);
    const { list, sha, superName } = await loadKeys(env, true);
    if (body.id === 'super') { await save(list, sha, 'Super account name changed', label); return json({ ok: true }, 200, origin); }
    const k = list.find(x => x.id === body.id); if (!k) return json({ error: 'No such key.' }, 404, origin);
    k.label = label; await save(list, sha, `Access key renamed: ${label}`, superName);
    return json({ ok: true }, 200, origin);
  }
  // Behind the Curtains scoreboard (games/scores.json): list every player, edit or remove one, or clear the board.
  if (route === '/admin/scores' && req.method === 'GET') {
    const { data } = await loadScores(env); const { list, superName } = await loadKeys(env);
    const nm = new Map(list.map(x => [x.id, x.label])); if (superName) nm.set('super', superName);
    const players = Object.entries(data.players).map(([id, p]) => ({ id, name: nm.get(id) || p.name || 'Player', points: p.points || 0, rounds: p.rounds || 0, correct: p.correct || 0, answered: p.answered || 0, best: p.best || 0, last: p.last || '' })).sort((a, b) => b.points - a.points);
    return json({ ok: true, players }, 200, origin);
  }
  if (route.startsWith('/admin/scores/') && req.method === 'POST') {
    const id = safeId(body.id); const int = (v) => Math.max(0, Math.min(1e7, parseInt(v, 10) || 0));
    const out = await editScores(env, (data) => {
      if (route === '/admin/scores/clear') { data.players = {}; return `Scoreboard cleared by ${who.label}`; }
      if (!id || !data.players[id]) throw Object.assign(new Error('No such player.'), { status: 404 });
      if (route === '/admin/scores/remove') { delete data.players[id]; return `Scoreboard: player removed by ${who.label}`; }
      if (route === '/admin/scores/edit') {
        const p = data.players[id];
        for (const k of ['points', 'rounds', 'correct', 'answered', 'best']) if (body[k] !== undefined) p[k] = int(body[k]);
        if (p.correct > p.answered) p.correct = p.answered;
        return `Scoreboard: ${p.name || id} edited by ${who.label}`;
      }
      throw Object.assign(new Error('Not found'), { status: 404 });
    });
    return out.ok ? json({ ok: true }, 200, origin) : json({ error: out.error }, out.status || 502, origin);
  }
  if (route === '/admin/keys/revoke' && req.method === 'POST') {
    const { list, sha } = await loadKeys(env, true);
    if (!list.some(x => x.id === body.id)) return json({ error: 'No such key.' }, 404, origin);
    await save(list.filter(x => x.id !== body.id), sha, 'Access key revoked');
    return json({ ok: true }, 200, origin);
  }
  return json({ error: 'Not found' }, 404, origin);
}

async function handleGitHub(req, env, origin, route, who) {
  if (!env.GITHUB_TOKEN || !env.SITE_KEY) return json({ error: 'Relay is missing the GITHUB_TOKEN and/or SITE_KEY secrets.' }, 500, origin);
  if (!who) return json({ error: 'Wrong passphrase.' }, 401, origin);
  if (route === '/gh/ping') {
    const r = await gh(env, '');
    if (!r.ok) return json({ error: await tokenProblem(env, r.status) }, 502, origin);
    const d = await r.json();
    return json({ ok: true, repo: d.full_name, canPush: !!(d.permissions && d.permissions.push), ai: !!env.ANTHROPIC_API_KEY, perms: who.perms, label: who.label, super: !!who.super }, 200, origin);
  }
  if (route === '/gh/write' && req.method === 'POST') {
    if (!can(who, 'write')) return denied(origin, 'write');
    let body; try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400, origin); }
    const { path, content, message } = body || {};
    if (typeof path !== 'string' || !/^data\/[A-Za-z0-9._\/-]+$/.test(path) || path.includes('..')) return json({ error: 'Only files under data/ may be written.' }, 400, origin);
    if (typeof content !== 'string' || content.length > 900000) return json({ error: 'Missing or oversized content.' }, 400, origin);
    // Re-read the file's current version and retry when another save landed first (GitHub answers 409/422).
    let put, out = {};
    for (let attempt = 0; attempt < 4; attempt++) {
      const cur = await gh(env, `contents/${path}?ref=${BRANCH}`);
      const sha = cur.ok ? (await cur.json()).sha : undefined;
      put = await gh(env, `contents/${path}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: String(message || `Update ${path}`).slice(0, 200), content: b64(content), branch: BRANCH, ...(sha ? { sha } : {}) }) });
      out = await put.json().catch(() => ({}));
      if (put.status !== 409 && put.status !== 422) break;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
    if (!put.ok) return json({ error: put.status === 404 || put.status === 401 || put.status === 403 ? await tokenProblem(env, put.status) : `GitHub ${put.status}: ${out.message || 'save failed'}` }, 502, origin);
    return json({ ok: true, commit: out.commit && out.commit.sha }, 200, origin);
  }
  return json({ error: 'Not found' }, 404, origin);
}

// ---------------- AI site-plan reader (Plan review) ----------------
// The browser posts the raw PDF (Content-Type: application/pdf) plus a small X-MC-Context header (base64 JSON:
// submittal type + checklist items). The prompt and output schema live HERE, so the page can't repurpose the key.
// The PDF goes to Anthropic's Files API (no base64 work in the Worker), is read once, then deleted.
const AI_MODEL = 'claude-sonnet-5-5';
const MAX_PDF = 30 * 1024 * 1024;
const N = { type: ['number', 'null'] }, S_ = { type: ['string', 'null'] }, B = { type: ['boolean', 'null'] };
const SITE_PLAN_TOOL = {
  name: 'site_plan_review',
  description: 'Record what the site plan shows and screen it against the submittal checklist.',
  input_schema: {
    type: 'object',
    required: ['plan', 'parcel', 'primary', 'structures', 'checklist', 'uncertain', 'annotations', 'summary'],
    properties: {
      plan: { type: 'object', properties: { title: S_, revision: S_, date: S_, preparer: S_, sheets: N, scale_stated: S_, scale_is_standard: B, scale_bar: B, north_arrow: B, vicinity_map: B, separate_from_building_plans: B, invalidating_notes: { type: 'array', items: { type: 'string' } } } },
      parcel: { type: 'object', properties: { apn: S_, owner_name: S_, site_address: S_, legal_description: S_, subdivision: S_, lot: S_, zoning_shown: S_, lot_area_sf: N, lot_area_acres: N, lot_dimensions: S_, corner_lot: B, water_source: S_, wastewater: S_, deed_reference: S_ } },
      primary: { type: 'object', description: 'Primary building (residence) setbacks to property lines in decimal feet, and height. null if not dimensioned.', properties: { front: N, rear: N, side_a: N, side_b: N, side_street: N, height: N, garage_plane: N } },
      structures: { type: 'array', items: { type: 'object', required: ['name', 'kind'], properties: {
        name: { type: 'string' }, kind: { type: 'string', enum: ['primary', 'accessory', 'adu'] }, status: { type: 'string', enum: ['new', 'existing', 'unknown'] },
        sqft: N, sqft_source: { type: 'string', enum: ['table', 'computed', 'not_shown'] }, cover: { type: 'string', enum: ['solid', 'open'] },
        height: N, front: N, rear: N, side: N, street: N, in_required_yard: B } } },
      coverage: { type: 'object', properties: { lot_coverage_pct_shown: N, total_covered_sf_shown: N } },
      easements: { type: 'array', items: { type: 'object', properties: { type: S_, width: S_, recording: S_, location: S_ } } },
      streets: { type: 'array', items: { type: 'object', properties: { name: S_, row_width: S_, jurisdiction: S_ } } },
      adjacent_uses: { type: 'array', items: { type: 'string' } },
      checklist: { type: 'array', items: { type: 'object', required: ['id', 'status'], properties: { id: { type: 'string' }, status: { type: 'string', enum: ['ok', 'deficient', 'verify', 'na'] }, shows: { type: 'string' }, correction: { type: 'string' } } } },
      other_findings: { type: 'array', items: { type: 'object', properties: { location: S_, item: { type: 'string' }, shows: S_, required: S_, status: { type: 'string', enum: ['deficient', 'verify'] }, correction: S_ } } },
      uncertain: { type: 'array', items: { type: 'string' }, description: 'Values that were hard to read or inferred; name the field and why.' },
      annotations: { type: 'array', description: 'Where each value/issue is on the plan, for an on-screen overlay.', items: { type: 'object', required: ['ref', 'page', 'box'], properties: {
        ref: { type: 'string' }, page: { type: 'integer', description: '1-based PDF page number' },
        box: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4, description: '[x0, y0, x1, y1] as fractions (0–1) of the page width/height, origin at the top-left of the page as displayed' },
        note: { type: 'string' } } } },
      summary: { type: 'string' },
    },
  },
};
function sitePlanPrompt(ctx) {
  const items = (Array.isArray(ctx.checklist) ? ctx.checklist : []).slice(0, 80).map(x => `- ${String(x.id).slice(0, 30)}: ${String(x.item).slice(0, 300)}`).join('\n');
  return `You are screening a site plan submitted to Maricopa County Planning & Development (unincorporated Arizona) for a ${String(ctx.label || ctx.type || 'site plan').slice(0, 80)} zoning review. Read every sheet of the attached PDF, including title blocks, tables, notes and dimension strings, then call site_plan_review.

Rules:
- Report what the PLAN shows, exactly as written. Never invent or assume a value: use null when something is not shown or not legible, and list anything you inferred or found hard to read in "uncertain".
- Dimensions in decimal feet (25'-6" = 25.5). Lot area in square feet (convert acres × 43,560 only if the plan gives acres; also fill lot_area_acres).
- Setbacks: the shortest dimension from the structure (wall, post or edge of covered area) to the property line. If the plan measures to an easement line or road centerline instead, still report the number but say so in "uncertain". Front = the street-facing lot line the address is on; side_a/side_b = the two interior sides; side_street = the second street side on a corner lot.
- Structures: list every building or covered structure, new and existing (residence/livable, attached garage, covered patio/porch, carport, detached garage, shed, ADU, shade structure, barn). kind = "primary" for the residence and anything attached to it, "accessory" for detached structures, "adu" for a detached accessory dwelling. Take sq ft from the plan's area table when there is one (sqft_source "table"); otherwise compute it from the dimensions shown (sqft_source "computed"); else null. cover = "open" only for lattice/shade covers ≤ 50% opaque. For detached structures give their own setbacks and whether they sit inside a required rear/side yard.
- Owner name, APN and address: copy them exactly as printed on the plan (APN format like 304-88-146 or 30488146A).
- Checklist: return one entry for EVERY item id below. status "ok" = clearly shown and compliant; "deficient" = missing, not shown, or non-compliant (give a specific one-sentence correction); "verify" = partly shown or can't be determined from the plan; "na" = does not apply to this project. "shows" = a short summary of what the plan actually shows (at most about 12 words). Keep each correction to one short sentence (at most about 20 words).
- other_findings: anything else a zoning plan reviewer would red-line (e.g. structures in easements, "future"/"not for construction" notes, inconsistent dimensions, missing dimensions to a property line).
- annotations: mark WHERE on the plan things are, so the reviewer can click each one. box = [x0, y0, x1, y1] as fractions (0–1) of the page width and height, measured from the top-left corner of the page as it is displayed; draw it tightly around the text or feature. Add one annotation for:
  • every checklist item with status "deficient" or "verify" → ref "checklist:<id>" (box where the item is, or where it should be — e.g. the title block for a missing owner name);
  • every other_findings entry → ref "finding:<index from 0>";
  • where the plan shows each parcel field you filled → ref "parcel:apn", "parcel:owner_name", "parcel:site_address", "parcel:lot_area_sf", "parcel:zoning_shown", "parcel:subdivision", "parcel:lot", "parcel:legal_description";
  • each primary dimension you read → ref "primary:front", "primary:rear", "primary:side_a", "primary:side_b", "primary:side_street", "primary:height", "primary:garage_plane";
  • each structure's area and setback dimensions → ref "structure:<index from 0>:sqft", "structure:<i>:front", "structure:<i>:rear", "structure:<i>:side", "structure:<i>:street", "structure:<i>:height" (or "structure:<i>" for the whole footprint);
  • the coverage table or note → ref "coverage"; each "uncertain" entry → ref "uncertain:<index from 0>"; scale / north arrow / vicinity map → ref "plan:scale", "plan:north_arrow", "plan:vicinity_map".

Checklist items:
${items || '- (none supplied)'}`;
}
async function handleAI(req, env, origin, route, ctxW, who) {
  if (!env.SITE_KEY) return json({ error: 'Relay is missing the SITE_KEY secret.' }, 500, origin);
  if (!who) return json({ error: 'Wrong passphrase.' }, 401, origin);
  if (!can(who, 'rapid')) return denied(origin, 'rapid');
  if (route !== '/ai/siteplan' || req.method !== 'POST') return json({ error: 'Not found' }, 404, origin);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'Site-plan reading is not set up: add an ANTHROPIC_API_KEY secret to this relay in Cloudflare (Worker → Settings → Variables and Secrets → Type: Secret), then Deploy.' }, 501, origin);
  if (+(req.headers.get('Content-Length') || 0) > MAX_PDF) return json({ error: 'PDF is larger than 30 MB — export a smaller PDF (site plan sheets only).' }, 413, origin);
  let ctx = {};
  try { const h = req.headers.get('X-MC-Context') || ''; if (h.length > 40000) throw 0; ctx = h ? JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(h), c => c.charCodeAt(0)))) : {}; } catch { return json({ error: 'Bad X-MC-Context header.' }, 400, origin); }
  const pdf = await req.arrayBuffer();
  if (pdf.byteLength > MAX_PDF) return json({ error: 'PDF is larger than 30 MB.' }, 413, origin);
  const head = new Uint8Array(pdf, 0, Math.min(5, pdf.byteLength));
  if (String.fromCharCode(...head) !== '%PDF-') return json({ error: 'That file is not a PDF.' }, 400, origin);
  const H = { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' };
  const fd = new FormData(); fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'site-plan.pdf');
  const up = await fetch('https://api.anthropic.com/v1/files', { method: 'POST', headers: H, body: fd });
  const upd = await up.json().catch(() => ({}));
  if (!up.ok || !upd.id) return json({ error: `Anthropic file upload failed (${up.status}): ${(upd.error && upd.error.message) || 'unknown error'}` }, 502, origin);
  const cleanup = () => fetch(`https://api.anthropic.com/v1/files/${encodeURIComponent(upd.id)}`, { method: 'DELETE', headers: H }).catch(() => {});
  try {
    const model = /^claude-[a-z0-9.-]+$/.test(env.ANTHROPIC_MODEL || '') ? env.ANTHROPIC_MODEL : AI_MODEL;
    // Newer models reject a forced tool_choice, so ask with "auto" and nudge once if Claude answers in text.
    /** @type {any[]} */
    const msgs = [{ role: 'user', content: [{ type: 'document', source: { type: 'file', file_id: upd.id } }, { type: 'text', text: sitePlanPrompt(ctx) + '\n\nYou must finish by calling the site_plan_review tool exactly once.' }] }];
    const ask = async () => {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({
        model, max_tokens: 16000, tools: [SITE_PLAN_TOOL], tool_choice: { type: 'auto' }, messages: msgs }) });
      return { r, d: await r.json().catch(() => ({})) };
    };
    let { r, d } = await ask();
    if (!r.ok) return json({ error: `Claude API error ${r.status}: ${(d.error && d.error.message) || 'request failed'}` }, 502, origin);
    let tool = (d.content || []).find(c => c.type === 'tool_use' && c.name === 'site_plan_review');
    if (!tool && d.stop_reason !== 'max_tokens') {
      msgs.push({ role: 'assistant', content: d.content }, { role: 'user', content: [{ type: 'text', text: 'Now call the site_plan_review tool with your findings.' }] });
      ({ r, d } = await ask());
      if (!r.ok) return json({ error: `Claude API error ${r.status}: ${(d.error && d.error.message) || 'request failed'}` }, 502, origin);
      tool = (d.content || []).find(c => c.type === 'tool_use' && c.name === 'site_plan_review');
    }
    if (!tool) return json({ error: `Claude did not return a structured result (stop: ${d.stop_reason || '?'}).` }, 502, origin);
    return json({ ok: true, relay: RELAY_VERSION, result: tool.input, model: d.model || model, usage: d.usage || null, truncated: d.stop_reason === 'max_tokens' }, 200, origin);
  } finally {
    if (ctxW && ctxW.waitUntil) ctxW.waitUntil(cleanup()); else await cleanup();
  }
}

// ---------------- private plan queue + plan-review data (Plan review → Queued Review) ----------------
// Private repo QUEUE_REPO holds queue/<id>.pdf + queue/<id>.json (queued plans, kept ≤ 14 days) and db/<id>.json
// (data read from plans, kept ≤ 45 days). Only the site (passphrase) and the scheduled routine on LONDON use it;
// its own GitHub Action deletes expired files and squashes history daily. Large PDFs are passed straight through
// (the browser sends the GitHub request body), so the Worker does no base64 work.
const QPATH = /^(queue|db)\/[A-Za-z0-9._-]{1,120}\.(pdf|json)$/;
const ghq = (env, path, init = {}) => fetch(`https://api.github.com/repos/${QUEUE_REPO}${path ? `/${path}` : ''}`, {
  ...init, headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'mc-relay', ...(init.headers || {}) } });
async function handleQueue(req, env, origin, route, url, who) {
  if (!env.GITHUB_TOKEN || !env.SITE_KEY) return json({ error: 'Relay is missing the GITHUB_TOKEN and/or SITE_KEY secrets.' }, 500, origin);
  if (!who) return json({ error: 'Wrong passphrase.' }, 401, origin);
  { const p0 = url.searchParams.get('path') || ''; const need = route === '/q/put' && p0.startsWith('db/') ? (can(who, 'write') || can(who, 'queue') ? null : 'write') : (can(who, 'queue') ? null : 'queue'); if (need) return denied(origin, need); }
  const noRepo = async (r) => json({ error: r.status === 404 ? `The private repo ${QUEUE_REPO} doesn't exist yet or the relay's GITHUB_TOKEN can't see it. Create it (private) on GitHub and add it to the token's Repository access with Contents: Read and write.` : `GitHub ${r.status} on ${QUEUE_REPO}` }, 502, origin);
  if (route === '/q/tree') {
    const r = await ghq(env, 'git/trees/main?recursive=1');
    if (r.status === 409) return json({ ok: true, files: [] }, 200, origin); // empty repo
    if (!r.ok) return noRepo(r);
    const d = await r.json();
    return json({ ok: true, files: (d.tree || []).filter(t => t.type === 'blob' && QPATH.test(t.path)).map(t => ({ path: t.path, size: t.size, sha: t.sha })) }, 200, origin);
  }
  if (route === '/q/list') {
    // Queue metadata (queue/*.json) plus which plans and results exist — one round trip for the Plan Queue box.
    const r = await ghq(env, 'git/trees/main?recursive=1');
    if (r.status === 409) return json({ ok: true, items: [], files: [] }, 200, origin);
    if (!r.ok) return noRepo(r);
    const files = ((await r.json()).tree || []).filter(t => t.type === 'blob' && QPATH.test(t.path)).map(t => ({ path: t.path, size: t.size }));
    const metas = files.filter(f => /^queue\/.+\.json$/.test(f.path)).slice(0, 200);
    const items = (await Promise.all(metas.map(async f => { const x = await ghq(env, `contents/${f.path}`, { headers: { Accept: 'application/vnd.github.raw' } }); return x.ok ? x.json().catch(() => null) : null; }))).filter(Boolean);
    return json({ ok: true, items, files }, 200, origin);
  }
  const path = url.searchParams.get('path') || '';
  if (!QPATH.test(path) || path.includes('..')) return json({ error: 'Bad path.' }, 400, origin);
  if (route === '/q/raw' && req.method === 'GET') {
    const r = await ghq(env, `contents/${path}`, { headers: { Accept: 'application/vnd.github.raw' } });
    if (r.status === 404) return json({ error: 'Not found (it may have expired).' }, 404, origin);
    if (!r.ok) return noRepo(r);
    return new Response(r.body, { status: 200, headers: { ...cors(origin), 'Content-Type': path.endsWith('.pdf') ? 'application/pdf' : 'application/json', 'Cache-Control': 'no-store' } });
  }
  if (route === '/q/put' && req.method === 'POST') {
    // JSON files: small — add the current sha so updates work. PDFs: create-only, body streamed through unchanged.
    if (path.endsWith('.json')) {
      let body; try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400, origin); }
      if (typeof body.content !== 'string' || body.content.length > 3000000) return json({ error: 'Missing or oversized content.' }, 400, origin);
      // Record who queued / saved it, so their data can be found and cleared later (Profile → Clear my data).
      try { const obj = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body.content), c => c.charCodeAt(0)))); if (obj && typeof obj === 'object' && !obj.by) { obj.by = who.id; obj.byName = who.label; body.content = b64(JSON.stringify(obj, null, 2) + '\n'); } } catch {}
      let put, out = {};
      for (let attempt = 0; attempt < 4; attempt++) {
        const cur = await ghq(env, `contents/${path}`); const sha = cur.ok ? (await cur.json()).sha : undefined;
        put = await ghq(env, `contents/${path}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: String(body.message || `Update ${path}`).slice(0, 200), content: body.content, ...(sha ? { sha } : {}) }) });
        out = await put.json().catch(() => ({}));
        if (put.status !== 409 && put.status !== 422) break;
        await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
      }
      if (put.status === 404) return noRepo(put);
      return put.ok ? json({ ok: true }, 200, origin) : json({ error: `GitHub ${put.status}: ${out.message || 'save failed'}` }, 502, origin);
    }
    if (+(req.headers.get('Content-Length') || 0) > 45 * 1024 * 1024) return json({ error: 'PDF too large for the queue (30 MB max).' }, 413, origin);
    const put = await ghq(env, `contents/${path}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: req.body });
    const out = await put.json().catch(() => ({}));
    if (put.status === 404) return noRepo(put);
    return put.ok ? json({ ok: true }, 200, origin) : json({ error: `GitHub ${put.status}: ${out.message || 'upload failed'}` }, 502, origin);
  }
  if (route === '/q/del' && req.method === 'POST') {
    const cur = await ghq(env, `contents/${path}`); if (cur.status === 404) return json({ ok: true }, 200, origin);
    if (!cur.ok) return noRepo(cur);
    const sha = (await cur.json()).sha;
    const del = await ghq(env, `contents/${path}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `Remove ${path}`, sha }) });
    return del.ok ? json({ ok: true }, 200, origin) : json({ error: `GitHub ${del.status}` }, 502, origin);
  }
  return json({ error: 'Not found' }, 404, origin);
}

// ---------------- personal saved files (Saved Parcels) ----------------
// Each signed-in user (super account or access key) has a private folder users/<id>/ in QUEUE_REPO. The folder comes
// from the key, never from the request, so nobody can read or change another person's saved parcels and reviews.
const UPATH = /^(parcels|reviews)\/[A-Za-z0-9._-]{1,120}\.(md|json)$/;
async function handleUser(req, env, origin, route, url, who) {
  if (!env.GITHUB_TOKEN) return json({ error: 'Relay is missing GITHUB_TOKEN.' }, 500, origin);
  if (!who) return json({ error: 'Wrong passphrase.' }, 401, origin);
  if (!can(who, 'review')) return denied(origin, 'review');
  const base = `users/${String(who.id).replace(/[^A-Za-z0-9_-]/g, '')}/`;
  if (route === '/u/list') {
    const r = await ghq(env, 'git/trees/main?recursive=1');
    if (r.status === 409) return json({ ok: true, files: [] }, 200, origin);
    if (!r.ok) return json({ error: `GitHub ${r.status} on ${QUEUE_REPO}` }, 502, origin);
    const files = ((await r.json()).tree || []).filter(t => t.type === 'blob' && t.path.startsWith(base) && UPATH.test(t.path.slice(base.length))).map(t => ({ path: t.path.slice(base.length), size: t.size }));
    return json({ ok: true, files }, 200, origin);
  }
  const rel = url.searchParams.get('path') || '';
  if (!UPATH.test(rel) || rel.includes('..')) return json({ error: 'Bad path.' }, 400, origin);
  const full = base + rel;
  if (route === '/u/raw' && req.method === 'GET') {
    const r = await ghq(env, `contents/${full}`, { headers: { Accept: 'application/vnd.github.raw' } });
    if (r.status === 404) return json({ error: 'Not found.' }, 404, origin);
    if (!r.ok) return json({ error: `GitHub ${r.status}` }, 502, origin);
    return new Response(r.body, { status: 200, headers: { ...cors(origin), 'Content-Type': rel.endsWith('.json') ? 'application/json' : 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  if (route === '/u/put' && req.method === 'POST') {
    let body; try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400, origin); }
    if (typeof body.content !== 'string' || body.content.length > 900000) return json({ error: 'Missing or oversized content.' }, 400, origin);
    let put, out = {};
    for (let attempt = 0; attempt < 4; attempt++) {
      const cur = await ghq(env, `contents/${full}`); const sha = cur.ok ? (await cur.json()).sha : undefined;
      put = await ghq(env, `contents/${full}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `Saved by ${who.label}: ${rel}`.slice(0, 200), content: b64(body.content), ...(sha ? { sha } : {}) }) });
      out = await put.json().catch(() => ({}));
      if (put.status !== 409 && put.status !== 422) break;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
    return put.ok ? json({ ok: true }, 200, origin) : json({ error: `GitHub ${put.status}: ${out.message || 'save failed'}` }, 502, origin);
  }
  if (route === '/u/del' && req.method === 'POST') {
    const cur = await ghq(env, `contents/${full}`); if (cur.status === 404) return json({ ok: true }, 200, origin);
    const sha = (await cur.json()).sha;
    const del = await ghq(env, `contents/${full}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `Removed by ${who.label}: ${rel}`.slice(0, 200), sha }) });
    return del.ok ? json({ ok: true }, 200, origin) : json({ error: `GitHub ${del.status}` }, 502, origin);
  }
  return json({ error: 'Not found' }, 404, origin);
}

// ---------------- Behind The Curtain: game scores ----------------
// games/scores.json in QUEUE_REPO: { players: { <keyId>: { name, points, rounds, correct, answered, best, last } }, used: [nonces] }.
// The leaderboard is readable by the site without a key; playing needs a key. A round is opened by /g/start (a signed,
// single-use token) and scored by /g/finish, which caps the points a round can earn, rejects reused or stale tokens,
// and ignores rounds finished impossibly fast.
const SCORES_PATH = 'games/scores.json';
const ROUND_Q = 10, PTS = 10, PERFECT_BONUS = 20;
async function hmac(env, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`games:${env.SITE_KEY}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function loadScores(env) {
  const r = await ghq(env, `contents/${SCORES_PATH}`);
  if (r.status === 404) return { data: { schema: 1, players: {}, used: [] }, sha: null };
  if (!r.ok) throw new Error(`GitHub ${r.status} reading scores`);
  const d = await r.json();
  let data = { schema: 1, players: {}, used: [] };
  try { data = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(String(d.content).replace(/\n/g, '')), c => c.charCodeAt(0)))); } catch {}
  data.players = data.players || {}; data.used = data.used || [];
  return { data, sha: d.sha };
}
function board(data, names) {
  return Object.entries(data.players).map(([id, p]) => ({ name: names.get(id) || p.name || 'Player', points: p.points || 0, rounds: p.rounds || 0, accuracy: p.answered ? Math.round(100 * (p.correct || 0) / p.answered) : 0, best: p.best || 0 }))
    .sort((a, b) => b.points - a.points || b.accuracy - a.accuracy || a.name.localeCompare(b.name)).slice(0, 20);
}
// Change games/scores.json with retries on a concurrent save (used by the admin scoreboard routes).
async function editScores(env, change) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, sha } = await loadScores(env);
    let message; try { message = change(data); } catch (e) { return { ok: false, error: e.message, status: e.status || 400 }; }
    const put = await ghq(env, `contents/${SCORES_PATH}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, content: b64(JSON.stringify(data, null, 2) + '\n'), ...(sha ? { sha } : {}) }) });
    if (put.ok) return { ok: true };
    if (put.status !== 409 && put.status !== 422) return { ok: false, error: `GitHub ${put.status} saving the scoreboard`, status: 502 };
    await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
  }
  return { ok: false, error: 'Busy — try again.', status: 503 };
}
async function handleGames(req, env, origin, route) {
  if (!env.GITHUB_TOKEN || !env.SITE_KEY) return json({ error: 'Relay is missing GITHUB_TOKEN / SITE_KEY.' }, 500, origin);
  const names = async () => { const m = new Map(); try { const k = await loadKeys(env); for (const x of k.list) m.set(x.id, x.label); if (k.superName) m.set('super', k.superName); } catch {} return m; };
  if (route === '/g/board' && req.method === 'GET') {
    const { data } = await loadScores(env);
    return json({ ok: true, board: board(data, await names()), players: Object.keys(data.players).length }, 200, origin);
  }
  const who = await authenticate(req, env);
  if (!who) return json({ error: 'Sign in with a key to play.' }, 401, origin);
  if (route === '/g/start' && req.method === 'POST') {
    const nonce = [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');
    const ts = Date.now(); const sig = await hmac(env, `${who.id}.${nonce}.${ts}`);
    return json({ ok: true, token: `${nonce}.${ts}.${sig}`, questions: ROUND_Q }, 200, origin);
  }
  if (route === '/g/finish' && req.method === 'POST') {
    let body = {}; try { body = await req.json(); } catch {}
    const [nonce, ts, sig] = String(body.token || '').split('.');
    if (!nonce || !ts || !sig || !sameKey(sig, await hmac(env, `${who.id}.${nonce}.${ts}`))) return json({ error: 'Invalid round — start a new one.' }, 400, origin);
    const age = Date.now() - +ts;
    if (age > 45 * 60000) return json({ error: 'That round expired — start a new one.' }, 400, origin);
    const answered = Math.max(0, Math.min(ROUND_Q, parseInt(body.answered, 10) || 0));
    let correct = Math.max(0, Math.min(answered, parseInt(body.correct, 10) || 0));
    if (age < answered * 2500) correct = 0; // faster than ~2.5 s per question: not counted
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, sha } = await loadScores(env);
      if (data.used.includes(nonce)) return json({ error: 'That round was already scored.' }, 409, origin);
      const p = data.players[who.id] || { name: who.label, points: 0, rounds: 0, correct: 0, answered: 0, best: 0 };
      const earned = correct * PTS + (answered === ROUND_Q && correct === ROUND_Q ? PERFECT_BONUS : 0);
      Object.assign(p, { name: who.label, points: p.points + earned, rounds: p.rounds + 1, correct: p.correct + correct, answered: p.answered + answered, best: Math.max(p.best || 0, earned), last: new Date().toISOString() });
      data.players[who.id] = p; data.used = [...data.used, nonce].slice(-500);
      const out = JSON.stringify(data, null, 2) + '\n';
      const put = await ghq(env, `contents/${SCORES_PATH}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `Game round: ${who.label} +${earned}`, content: b64(out), ...(sha ? { sha } : {}) }) });
      if (put.ok) return json({ ok: true, earned, total: p.points, board: board(data, await names()) }, 200, origin);
      if (put.status !== 409 && put.status !== 422) return json({ error: `GitHub ${put.status} saving the score` }, 502, origin);
      await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
    }
    return json({ error: 'Busy — try again.' }, 503, origin);
  }
  return json({ error: 'Not found' }, 404, origin);
}

export default {
  async fetch(req, env, ctxW) {
    configure(env);
    const origin = req.headers.get('Origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    // Only your site may use the relay. Plain address-bar visits (no Origin) get a short health response.
    if (origin && !allowed(origin)) return new Response('Forbidden origin', { status: 403, headers: cors(origin) });
    if (!['GET', 'POST'].includes(req.method)) return new Response('Method not allowed', { status: 405, headers: cors(origin) });
    const u0 = new URL(req.url);
    if (/^\/(gh|q|ai|admin|u|me|g)\//.test(u0.pathname) && throttled(req)) return json({ error: 'Too many wrong passphrases from this network — wait 10 minutes and try again.' }, 429, origin);
    if (u0.pathname.startsWith('/gh/')) {
      if (!allowed(origin)) return json({ error: 'Saving is only allowed from the site.' }, 403, origin);
      return handleGitHub(req, env, origin, u0.pathname, await authenticate(req, env));
    }
    if (u0.pathname.startsWith('/admin/')) {
      if (!allowed(origin)) return json({ error: 'Only the site may use this.' }, 403, origin);
      const who = await authenticate(req, env); if (!who) return json({ error: 'Wrong passphrase.' }, 401, origin);
      try { return await handleAdmin(req, env, origin, u0.pathname, who); } catch (e) { return json({ error: e.message }, 502, origin); }
    }
    if (u0.pathname.startsWith('/g/')) {
      if (!allowed(origin)) return json({ error: 'Only the site may use this.' }, 403, origin);
      try { return await handleGames(req, env, origin, u0.pathname); } catch (e) { return json({ error: e.message }, 502, origin); }
    }
    if (u0.pathname.startsWith('/me/')) {
      if (!allowed(origin)) return json({ error: 'Only the site may use this.' }, 403, origin);
      try { return await handleMe(req, env, origin, u0.pathname, await authenticate(req, env)); } catch (e) { return json({ error: e.message }, 502, origin); }
    }
    if (u0.pathname.startsWith('/u/')) {
      if (!allowed(origin)) return json({ error: 'Only the site may use this.' }, 403, origin);
      return handleUser(req, env, origin, u0.pathname, u0, await authenticate(req, env));
    }
    if (u0.pathname.startsWith('/q/')) {
      if (!allowed(origin)) return json({ error: 'Only the site may use this.' }, 403, origin);
      return handleQueue(req, env, origin, u0.pathname, u0, await authenticate(req, env));
    }
    if (u0.pathname.startsWith('/ai/')) {
      if (!allowed(origin)) return json({ error: 'Only the site may use this.' }, 403, origin);
      return handleAI(req, env, origin, u0.pathname, ctxW, await authenticate(req, env));
    }

    const target = u0.searchParams.get('url');
    if (!target) return new Response('Missing ?url=', { status: 400, headers: cors(origin) });
    // Forward only for the site itself — scripts and other servers (no Origin header) can't use this as an open proxy.
    if (!allowed(origin)) return new Response('Relay requests must come from the site', { status: 403, headers: cors(origin) });
    if (target.length > 4000) return new Response('URL too long', { status: 414, headers: cors(origin) });
    let u; try { u = new URL(target); } catch { return new Response('Bad url', { status: 400, headers: cors(origin) }); }
    if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) return new Response(`Host not allowed by relay: ${u.hostname}`, { status: 403, headers: { ...cors(origin), 'X-Relay-Block': '1' } });

    const headers = { 'User-Agent': 'Mozilla/5.0 (MC Zoning Review relay)', Accept: req.headers.get('Accept') || '*/*' };
    // The Recorder's public API expects requests that look like its own website's.
    if (u.hostname.endsWith('recorder.maricopa.gov')) Object.assign(headers, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9',
      Origin: 'https://recorder.maricopa.gov', Referer: 'https://recorder.maricopa.gov/',
    });
    const ct = req.headers.get('Content-Type'); if (ct) headers['Content-Type'] = ct;

    // EDMS (Laserfiche PublicAccess) wants a session cookie from its landing page before API calls.
    if (u.hostname === 'edms.maricopa.gov') {
      const prime = await fetch(`https://edms.maricopa.gov${u.pathname.split('/api/')[0]}/`, { headers: { 'User-Agent': headers['User-Agent'] }, redirect: 'follow' });
      const cookies = (prime.headers.getAll ? prime.headers.getAll('Set-Cookie') : [prime.headers.get('Set-Cookie')]).filter(Boolean).map(c => c.split(';')[0]);
      if (cookies.length) headers.Cookie = cookies.join('; ');
    }

    const upstream = await fetch(u.toString(), {
      method: req.method,
      headers,
      body: req.method === 'POST' ? await req.arrayBuffer() : undefined,
      redirect: 'follow',
    });
    const out = new Headers(cors(origin)); out.set('X-Relay-Upstream-Status', String(upstream.status));
    for (const h of ['Content-Type', 'Content-Disposition', 'Content-Length']) { const v = upstream.headers.get(h); if (v) out.set(h, v); }
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
