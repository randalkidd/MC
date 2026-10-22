// Cloudflare Worker — CORS relay for the MC Zoning Review site.
// Forwards GET/POST to an allow-listed set of Maricopa County hosts and adds CORS headers so a
// github.io page can read the response. It is not an open proxy: other hosts are refused.
//
// Deploy: Cloudflare dashboard → Workers & Pages → Create → "Hello World" worker → paste this file → Deploy.
// Then set ALLOWED_ORIGIN below to your Pages origin (e.g. https://yourname.github.io) and paste the
// worker URL into the site's Settings → Relay URL.

const ALLOWED_ORIGIN = '*'; // ← change to 'https://<you>.github.io' after deploying
const ALLOWED_HOSTS = new Set([
  'gis.maricopa.gov',
  'edms.maricopa.gov',
  'recorder.maricopa.gov',
  'legacy.recorder.maricopa.gov',
  'www.maricopa.gov',
]);

const cors = (origin) => ({
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN === '*' ? '*' : (origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN),
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
});

export default {
  async fetch(req) {
    const origin = req.headers.get('Origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    const target = new URL(req.url).searchParams.get('url');
    if (!target) return new Response('Missing ?url=', { status: 400, headers: cors(origin) });
    let u; try { u = new URL(target); } catch { return new Response('Bad url', { status: 400, headers: cors(origin) }); }
    if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) return new Response('Host not allowed', { status: 403, headers: cors(origin) });

    const headers = { 'User-Agent': 'Mozilla/5.0 (MC Zoning Review relay)', Accept: req.headers.get('Accept') || '*/*' };
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
    const out = new Headers(cors(origin));
    for (const h of ['Content-Type', 'Content-Disposition', 'Content-Length']) { const v = upstream.headers.get(h); if (v) out.set(h, v); }
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
