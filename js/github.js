// Read/write data files in the site's own GitHub repo via the GitHub REST "contents" API.
// Credentials (owner, repo, branch, fine-grained token) stay in this browser's localStorage only.
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { return null; } };

function guessRepo() {
  // https://<owner>.github.io/<repo>/  or  https://<owner>.github.io/
  const h = location.hostname;
  if (!h.endsWith('.github.io')) return { owner: '', repo: '' };
  const owner = h.replace('.github.io', '');
  const seg = location.pathname.split('/').filter(Boolean)[0];
  return { owner, repo: seg || `${owner}.github.io` };
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
  get canWrite() { return !!(this.owner && this.repo && this.token); },
};

const api = (path) => `https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/${path}`;
const b64enc = (str) => btoa(String.fromCharCode(...new TextEncoder().encode(str)));
const b64dec = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), c => c.charCodeAt(0)));

async function ghFetch(url, init = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers || {}) };
  if (gh.token) headers.Authorization = `Bearer ${gh.token}`;
  const r = await fetch(url, { ...init, headers, cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) {
    let msg = `GitHub ${r.status}`;
    try { msg += `: ${(await r.json()).message}`; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

// Read a JSON/text file. Prefers the API (fresh, gives sha); falls back to the published site copy.
export async function readFile(path) {
  if (gh.owner && gh.repo) {
    try {
      const d = await ghFetch(`${api(path)}?ref=${encodeURIComponent(gh.branch)}`);
      if (d && d.content) return { text: b64dec(d.content), sha: d.sha, source: 'github' };
      if (d === null) return { text: null, sha: null, source: 'github' };
    } catch (e) { /* rate-limited or offline → fall through */ }
  }
  const r = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) return { text: null, sha: null, source: 'site' };
  return { text: await r.text(), sha: null, source: 'site' };
}

// Create or update a file with a commit. Retries once on a sha conflict by re-reading.
export async function writeFile(path, text, message) {
  if (!gh.canWrite) throw new Error('Not connected to GitHub yet — tap "⚙ Connect GitHub to save" (top right) and paste your token.');
  const cur = await ghFetch(`${api(path)}?ref=${encodeURIComponent(gh.branch)}`);
  const body = { message, content: b64enc(text), branch: gh.branch };
  if (cur && cur.sha) body.sha = cur.sha;
  return ghFetch(api(path), { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
}

export async function listDir(path) {
  const d = await ghFetch(`${api(path)}?ref=${encodeURIComponent(gh.branch)}`);
  return Array.isArray(d) ? d : [];
}

export async function testAccess() {
  const r = await ghFetch(`https://api.github.com/repos/${gh.owner}/${gh.repo}`);
  if (!r) throw new Error('Repo not found (check owner/repo, or the token lacks access).');
  return { name: r.full_name, canPush: !!(r.permissions && r.permissions.push), private: r.private };
}
