// Network helpers: direct fetch first, optional relay (Cloudflare Worker) fallback for hosts that block cross-site requests.
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { return null; } };

export const settings = {
  get proxy() { return (LS('mc.proxy') || '').trim().replace(/\/+$/, ''); },
  set proxy(v) { LS('mc.proxy', v || null); },
  get forceProxy() { return LS('mc.forceProxy') === '1'; },
  set forceProxy(v) { LS('mc.forceProxy', v ? '1' : null); },
};

// Hosts known to refuse cross-origin requests from a browser → always use the relay.
const RELAY_ONLY = ['edms.maricopa.gov', 'recorder.maricopa.gov', 'legacy.recorder.maricopa.gov'];

function viaProxy(url) {
  if (!settings.proxy) return null;
  return `${settings.proxy}/?url=${encodeURIComponent(url)}`;
}

export class NetError extends Error {}

export async function request(url, { method = 'GET', form, json, timeout = 30000 } = {}) {
  const host = new URL(url).hostname;
  const init = { method };
  if (form) {
    // application/x-www-form-urlencoded is a CORS "simple request" — no preflight needed.
    init.method = 'POST';
    init.body = new URLSearchParams(form);
  } else if (json) {
    init.method = 'POST';
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(json);
  }
  const attempt = async (target) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(target, { ...init, signal: ctl.signal });
      if (!r.ok) throw new NetError(`HTTP ${r.status} from ${host}`);
      const ct = r.headers.get('content-type') || '';
      return ct.includes('json') ? r.json() : r.text().then(t => { try { return JSON.parse(t); } catch { return t; } });
    } finally { clearTimeout(t); }
  };
  const mustRelay = RELAY_ONLY.includes(host) || settings.forceProxy;
  if (!mustRelay) {
    try { return await attempt(url); }
    catch (e) {
      if (e instanceof NetError || !settings.proxy) {
        if (!settings.proxy && !(e instanceof NetError)) throw new NetError(`${host} could not be reached directly (likely blocked cross-site). Add a relay URL in Settings.`);
        throw e;
      }
    }
  }
  const p = viaProxy(url);
  if (!p) throw new NetError(`${host} requires the relay (it blocks cross-site requests). Add a relay URL in Settings.`);
  return attempt(p);
}

// ArcGIS helper: POST form, throw on service-level error objects.
export async function arcgis(url, params) {
  const data = await request(url, { form: { f: 'json', ...params } });
  if (data && data.error) throw new NetError(`${url.split('/services/')[1] || url}: ${data.error.message || 'ArcGIS error'} ${(data.error.details || []).join(' ')}`);
  return data;
}
