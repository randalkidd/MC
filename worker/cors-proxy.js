// Cloudflare Worker — relay + GitHub save service for the MC Zoning Review site.
//
// 1) CORS relay:  GET/POST /?url=<https://*.maricopa.gov/...>
//    Forwards to an allow-listed set of Maricopa County hosts and adds CORS headers.
// 2) GitHub save: POST /gh/write  { path, content, message }   (header X-MC-Key: <your passphrase>)
//                 GET  /gh/ping                                  (header X-MC-Key) → checks passphrase + token
//    Commits files under data/ in your repo using a token stored ONCE here as a secret,
//    so each browser only needs the short passphrase.
//
// Secrets to add in Cloudflare (Worker → Settings → Variables and Secrets → Add → Type: Secret):
//   GITHUB_TOKEN = github_pat_...   (fine-grained, repo randalkidd/MC, Contents: Read and write)
//   SITE_KEY     = a passphrase you choose (what you'll type in each browser)

const RELAY_VERSION = '7';
const ALLOWED_ORIGIN = 'https://randalkidd.github.io'; // only your site may use this relay
const REPO = 'randalkidd/MC';
const BRANCH = 'main';
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
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN === '*' ? '*' : (origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN),
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-MC-Key',
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

async function handleGitHub(req, env, origin, route) {
  if (!env.GITHUB_TOKEN || !env.SITE_KEY) return json({ error: 'Relay is missing the GITHUB_TOKEN and/or SITE_KEY secrets.' }, 500, origin);
  if (!sameKey(req.headers.get('X-MC-Key') || '', env.SITE_KEY)) return json({ error: 'Wrong passphrase.' }, 401, origin);
  if (route === '/gh/ping') {
    const r = await gh(env, '');
    if (!r.ok) return json({ error: await tokenProblem(env, r.status) }, 502, origin);
    const d = await r.json();
    return json({ ok: true, repo: d.full_name, canPush: !!(d.permissions && d.permissions.push) }, 200, origin);
  }
  if (route === '/gh/write' && req.method === 'POST') {
    let body; try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400, origin); }
    const { path, content, message } = body || {};
    if (typeof path !== 'string' || !/^data\/[A-Za-z0-9._\/-]+$/.test(path) || path.includes('..')) return json({ error: 'Only files under data/ may be written.' }, 400, origin);
    if (typeof content !== 'string' || content.length > 900000) return json({ error: 'Missing or oversized content.' }, 400, origin);
    const cur = await gh(env, `contents/${path}?ref=${BRANCH}`);
    const sha = cur.ok ? (await cur.json()).sha : undefined;
    const put = await gh(env, `contents/${path}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: String(message || `Update ${path}`).slice(0, 200), content: b64(content), branch: BRANCH, ...(sha ? { sha } : {}) }) });
    const out = await put.json().catch(() => ({}));
    if (!put.ok) return json({ error: put.status === 404 || put.status === 401 || put.status === 403 ? await tokenProblem(env, put.status) : `GitHub ${put.status}: ${out.message || 'save failed'}` }, 502, origin);
    return json({ ok: true, commit: out.commit && out.commit.sha }, 200, origin);
  }
  return json({ error: 'Not found' }, 404, origin);
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    // Only your site may use the relay. Plain address-bar visits (no Origin) get a short health response.
    if (ALLOWED_ORIGIN !== '*' && origin && origin !== ALLOWED_ORIGIN) return new Response('Forbidden origin', { status: 403, headers: cors(origin) });
    if (!['GET', 'POST'].includes(req.method)) return new Response('Method not allowed', { status: 405, headers: cors(origin) });
    const u0 = new URL(req.url);
    if (u0.pathname.startsWith('/gh/')) {
      if (origin !== ALLOWED_ORIGIN && ALLOWED_ORIGIN !== '*') return json({ error: 'Saving is only allowed from the site.' }, 403, origin);
      return handleGitHub(req, env, origin, u0.pathname);
    }

    const target = u0.searchParams.get('url');
    if (!target) return new Response('Missing ?url=', { status: 400, headers: cors(origin) });
    // Forward only for the site itself — scripts and other servers (no Origin header) can't use this as an open proxy.
    if (ALLOWED_ORIGIN !== '*' && origin !== ALLOWED_ORIGIN) return new Response('Relay requests must come from the site', { status: 403, headers: cors(origin) });
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
