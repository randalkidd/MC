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
//   ANTHROPIC_API_KEY = sk-ant-...  (optional; enables Plan review → "Read a site plan PDF" via POST /ai/siteplan)
//   ANTHROPIC_MODEL   = optional Text variable to override the model (default below)

const RELAY_VERSION = '12';
// Settings. Defaults below; each can be overridden by a Cloudflare variable (Worker → Settings → Variables and
// Secrets, Type: Text) or, for local `wrangler dev`, by worker/.dev.vars (never committed — see .dev.vars.example).
//   ALLOWED_ORIGIN = https://randalkidd.github.io   (comma-separate to add e.g. http://localhost:8000 for local testing)
//   REPO = randalkidd/MC     BRANCH = main
const DEFAULTS = { ALLOWED_ORIGIN: 'https://randalkidd.github.io', REPO: 'randalkidd/MC', BRANCH: 'main' };
let ORIGINS = new Set([DEFAULTS.ALLOWED_ORIGIN]); // only your site may use this relay
let ALLOWED_ORIGIN = DEFAULTS.ALLOWED_ORIGIN;
let REPO = DEFAULTS.REPO;
let BRANCH = DEFAULTS.BRANCH;
function configure(env) {
  const list = String(env.ALLOWED_ORIGIN || DEFAULTS.ALLOWED_ORIGIN).split(',').map(s => s.trim().replace(/\/$/, '')).filter(o => /^https:\/\/[a-z0-9.-]+$|^http:\/\/localhost(:\d+)?$/i.test(o));
  ORIGINS = new Set(list.length ? list : [DEFAULTS.ALLOWED_ORIGIN]); ALLOWED_ORIGIN = [...ORIGINS][0];
  REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.REPO || '') ? env.REPO : DEFAULTS.REPO;
  BRANCH = /^[A-Za-z0-9_.\/-]{1,100}$/.test(env.BRANCH || '') ? env.BRANCH : DEFAULTS.BRANCH;
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

async function handleGitHub(req, env, origin, route) {
  if (!env.GITHUB_TOKEN || !env.SITE_KEY) return json({ error: 'Relay is missing the GITHUB_TOKEN and/or SITE_KEY secrets.' }, 500, origin);
  if (!sameKey(req.headers.get('X-MC-Key') || '', env.SITE_KEY)) return json({ error: 'Wrong passphrase.' }, 401, origin);
  if (route === '/gh/ping') {
    const r = await gh(env, '');
    if (!r.ok) return json({ error: await tokenProblem(env, r.status) }, 502, origin);
    const d = await r.json();
    return json({ ok: true, repo: d.full_name, canPush: !!(d.permissions && d.permissions.push), ai: !!env.ANTHROPIC_API_KEY }, 200, origin);
  }
  if (route === '/gh/write' && req.method === 'POST') {
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
    required: ['plan', 'parcel', 'primary', 'structures', 'checklist', 'uncertain', 'summary'],
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
- Checklist: return one entry for EVERY item id below. status "ok" = clearly shown and compliant; "deficient" = missing, not shown, or non-compliant (give a specific one-sentence correction); "verify" = partly shown or can't be determined from the plan; "na" = does not apply to this project. "shows" = a short note on what the plan actually shows.
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
async function handleAI(req, env, origin, route, ctxW) {
  if (!env.SITE_KEY) return json({ error: 'Relay is missing the SITE_KEY secret.' }, 500, origin);
  if (!sameKey(req.headers.get('X-MC-Key') || '', env.SITE_KEY)) return json({ error: 'Wrong passphrase.' }, 401, origin);
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
      msgs.push({ role: 'assistant', content: d.content }, { role: 'user', content: 'Now call the site_plan_review tool with your findings.' });
      ({ r, d } = await ask());
      if (!r.ok) return json({ error: `Claude API error ${r.status}: ${(d.error && d.error.message) || 'request failed'}` }, 502, origin);
      tool = (d.content || []).find(c => c.type === 'tool_use' && c.name === 'site_plan_review');
    }
    if (!tool) return json({ error: `Claude did not return a structured result (stop: ${d.stop_reason || '?'}).` }, 502, origin);
    return json({ ok: true, result: tool.input, model: d.model || model, usage: d.usage || null, truncated: d.stop_reason === 'max_tokens' }, 200, origin);
  } finally {
    if (ctxW && ctxW.waitUntil) ctxW.waitUntil(cleanup()); else await cleanup();
  }
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
    if (u0.pathname.startsWith('/gh/')) {
      if (!allowed(origin)) return json({ error: 'Saving is only allowed from the site.' }, 403, origin);
      return handleGitHub(req, env, origin, u0.pathname);
    }
    if (u0.pathname.startsWith('/ai/')) {
      if (!allowed(origin)) return json({ error: 'Only the site may use this.' }, 403, origin);
      return handleAI(req, env, origin, u0.pathname, ctxW);
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
