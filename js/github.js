// Read/write data files in the site's own GitHub repo via the GitHub REST "contents" API.
// Credentials (owner, repo, branch, fine-grained token) stay in this browser's localStorage only.
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { return null; } };

function guessRepo() {
  // https://<owner>.github.io/<repo>/  or  https://<owner>.github.io/
  const h = location.hostname;
  if (!h.endsWith('.github.io')) return { owner: 'randalkidd', repo: 'MC' }; // default repo when opened from another host
  const owner = h.replace('.github.io', '');
  const seg = location.pathname.split('/').filter(Boolean)[0];
  return { owner, repo: seg || `${owner}.github.io` };
}

export function storageWorks() {
  try { localStorage.setItem('mc.__t', '1'); const ok = localStorage.getItem('mc.__t') === '1'; localStorage.removeItem('mc.__t'); return ok; } catch { return false; }
}

export const gh = {
  get owner() { return LS('gh.owner') || guessRepo().owner; },
  get repo() { return LS('gh.repo') || guessRepo().repo; },
  get branch() { return LS('gh.branch') || 'main'; },
  get token() { return LS('gh.token') || ''; },
  save({ owner, repo, branch, token }) {
    LS('gh.owner', owner || null); LS('gh.repo', repo || null); LS('gh.branch', branch || null);
    if (token !== undefined) LS('gh.token', token || null);
  },
  get passphrase() { return LS('gh.pass') || ''; },
  set passphrase(v) { LS('gh.pass', v || null); },
  // The relay (passphrase) wins whenever it's set up; a token saved in this browser is only used without a passphrase.
  get viaRelay() { return !!this.passphrase && !!relayUrl(); },
  get canWrite() { return !!(this.owner && this.repo && (this.token || this.viaRelay)); },
};

import { settings } from './net.js?v=1687cb8b';
const relayUrl = () => settings.proxy;

export async function relayFetch(route, init = {}) { return relay(route, init); }
async function relay(route, init = {}) {
  const base = relayUrl();
  if (!/^https:\/\/[^/]+\.workers\.dev$/i.test(base)) {
    if (/pages\.dev|github\.io/i.test(base)) throw new Error(`The Relay URL (${base}) is a copy of the website, not the relay. Use the address of the Worker you pasted the relay code into — it ends in .workers.dev.`);
  }
  let r;
  try { r = await fetch(`${base}${route}`, { ...init, headers: { 'X-MC-Key': gh.passphrase, ...(init.headers || {}) } }); }
  catch { throw new Error(`Couldn't reach the relay at ${base}. Check the Relay URL (it ends in .workers.dev) and that the Worker is deployed.`); }
  const text = await r.text();
  let d = {}; try { d = JSON.parse(text); } catch {}
  if (r.ok) return d;
  if (r.status === 401) throw new Error('Wrong passphrase — re-enter it on the Sign in tab (it must match exactly, including capitals).');
  if (d.error) throw new Error(`${d.error} (relay: ${base.replace(/^https:\/\//, '')}${r.headers.get('X-Relay-Version') ? `, v${r.headers.get('X-Relay-Version')}` : ''})`);
  if (r.status === 400 && /Missing \?url=/.test(text)) throw new Error('The relay is still running the OLD code. In Cloudflare: Worker → Edit code → paste the latest worker/cors-proxy.js from GitHub → Deploy.');
  if (r.status === 404) throw new Error(`Relay error 404 — ${base} is not the relay Worker (it has no /gh/ service). Use the .workers.dev address of the Worker you pasted the relay code into, and make sure that code is the latest version.`);
  throw new Error(`Relay error ${r.status}${text && text.length < 200 ? `: ${text}` : ''}`);
}

const api = (path) => `https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/${path}`;
const b64enc = (str) => { const b = new TextEncoder().encode(str); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const b64dec = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), c => c.charCodeAt(0)));

async function ghFetch(url, init = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers || {}) };
  if (gh.token && !gh.viaRelay) headers.Authorization = `Bearer ${gh.token}`;
  let r = await fetch(url, { ...init, headers, cache: 'no-store' });
  // A dead token saved in this browser shouldn't block reading the public repo: retry reads without it.
  if (r.status === 401 && headers.Authorization && (!init.method || init.method === 'GET')) { delete headers.Authorization; r = await fetch(url, { ...init, headers, cache: 'no-store' }); }
  if (r.status === 404) return null;
  if (!r.ok) {
    let detail = ''; try { detail = (await r.json()).message || ''; } catch {}
    const why = {
      401: gh.passphrase ? 'The GitHub token saved in this browser no longer works. In ⚙ Settings, clear the Token box and click Save settings — this browser will then use the relay with your passphrase.' : 'The GitHub token saved in this browser no longer works (expired or regenerated). You don\'t need one: in ⚙ Settings, clear the Token box, enter the relay passphrase, click Save settings, then Test GitHub.',
      403: /rate limit/i.test(detail) ? 'GitHub rate limit reached — wait a few minutes.' : 'The token does not have write permission. Edit the token on GitHub: Repository permissions → Contents → Read and write.',
      404: 'The token cannot see this repository. Edit the token on GitHub: Repository access → Only select repositories → add randalkidd/MC.',
      409: 'GitHub reported a conflict (file changed elsewhere). Reload and try again.',
      422: 'GitHub refused the save (invalid request).',
    }[r.status];
    throw new Error(`${why || `GitHub error ${r.status}`}${detail ? ` [GitHub says: ${detail}]` : ''}`);
  }
  return r.json();
}

// Read a JSON/text file from the published site (same origin: fast, cached by GitHub's CDN, no API rate limit).
// Pages republishes ~1 min after a save; the app keeps its own saved copy in memory meanwhile.
export async function readFile(path) {
  const r = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) return { text: null, sha: null, source: 'site' };
  return { text: await r.text(), sha: null, source: 'site' };
}

// Create or update a file with a commit. Retries once on a sha conflict by re-reading.
// Permissions of this browser's access key (from the relay's /gh/ping). Old relays don't send them: treat as full access.
export function perms() { try { const v = JSON.parse(localStorage.getItem('mc.perms') || 'null'); return v && Array.isArray(v.perms) ? v : { perms: ['review', 'write', 'queue', 'rapid'], label: '', legacy: true }; } catch { return { perms: [], label: '' }; } }
export const hasPerm = (p) => perms().perms.includes(p);
export async function writeFile(path, text, message) {
  if (gh.viaRelay && !hasPerm('write')) throw new Error('Your access key can\'t save to GitHub (needs "write"). Ask the site administrator.');
  if (!gh.canWrite) throw new Error('Not connected to GitHub yet — tap "⚙ Connect GitHub to save" (top right) and enter your passphrase (or token).');
  if (gh.viaRelay) return relay('/gh/write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, content: text, message }) });
  const put = async () => {
    const cur = await ghFetch(`${api(path)}?ref=${encodeURIComponent(gh.branch)}`);
    const body = { message, content: b64enc(text), branch: gh.branch };
    if (cur && cur.sha) body.sha = cur.sha;
    return ghFetch(api(path), { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  };
  try { return await put(); }
  catch (e) { if (/409|conflict|does not match/i.test(e.message)) return put(); throw e; }
}

const dirCache = new Map();
export async function listDir(path, { fresh = false } = {}) {
  const hit = dirCache.get(path);
  if (!fresh && hit && Date.now() - hit.t < 60000) return hit.v;
  const d = await ghFetch(`${api(path)}?ref=${encodeURIComponent(gh.branch)}`);
  const v = Array.isArray(d) ? d : [];
  dirCache.set(path, { t: Date.now(), v });
  return v;
}
export function clearDirCache() { dirCache.clear(); }

export async function testAccess() {
  if (gh.viaRelay) { const d = await relay('/gh/ping'); return { name: `${d.repo} (via relay)`, canPush: d.canPush, private: false, ai: d.ai, perms: d.perms, label: d.label, super: d.super }; }
  const r = await ghFetch(`https://api.github.com/repos/${gh.owner}/${gh.repo}`);
  if (!r) throw new Error('Repo not found (check owner/repo, or the token lacks access).');
  return { name: r.full_name, canPush: !!(r.permissions && r.permissions.push), private: r.private };
}
