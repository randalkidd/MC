// Recorded-plat reader: find the plat at the County Recorder, fetch its scanned PDF through the relay,
// OCR the first sheets in the browser (pdf.js + tesseract.js, loaded on demand) and pull the setback notes.
// Plats are image-only scans (no text layer), so OCR is the only way to read them automatically.
import { request, requestBytes } from './net.js?v=222cfb60';
import { EP } from './lookup.js?v=222cfb60';

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

const loaded = {};
function loadScript(src, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  return (loaded[src] ||= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => (window[globalName] ? res(window[globalName]) : rej(new Error(`${globalName} did not load`)));
    s.onerror = () => { delete loaded[src]; rej(new Error(`Could not load the OCR library (${new URL(src).hostname})`)); };
    document.head.appendChild(s);
  }));
}

const recDate = (s) => { const m = String(s || '').match(/(\d{1,2})-(\d{1,2})-(\d{4})/); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : ''; };
const num = (v) => String(v ?? '').replace(/^0+(?=\d)/, '');

// Plat document for an Assessor subdivision name + MCR book/page. Recorder name search is a prefix match.
export async function findPlatDoc(name, book, page) {
  const variants = [...new Set([name, String(name).replace(/\b(UNIT|PHASE|PARCEL|TRACT|AMENDED|REPLAT)\b.*$/i, '').trim()].filter(Boolean))];
  for (const v of variants) {
    const d = await request(`${EP.recorderApi}/documents/search?businessNames=${encodeURIComponent(v)}`);
    const rows = ((d && d.searchResults) || []).filter(r => /PLAT|MAP/i.test(String(r.documentCode || '')));
    const hit = book && page ? rows.find(r => num(r.docketBook) === num(book) && num(r.pageMap) === num(page)) : rows[0];
    if (hit) return { rec: String(hit.recordingNumber), recorded: recDate(hit.recordingDate), code: hit.documentCode, book: num(hit.docketBook), page: num(hit.pageMap) };
  }
  return null;
}

// Signed, short-lived (~2 min) link to the unofficial PDF. It redirects to legacy.recorder.maricopa.gov/PlatPdf/….
export async function platPdfLink(rec) {
  const d = await request(`${EP.recorderApi}/preview/pdf-link?recordingNumber=${encodeURIComponent(rec)}&suffix=&affidavit=false`);
  if (!d || !d.url) throw new Error('The Recorder did not return a PDF link');
  return d.url;
}

export async function fetchPlatPdf(rec) {
  const bytes = await requestBytes(await platPdfLink(rec));
  if (bytes.length < 5 ||!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) throw new Error('The Recorder has no scanned file for this plat (its own PDF link is broken too) — review it at the Recorder');
  return bytes;
}

// OCR up to maxPages sheets; stops early once setbacks are found.
export async function ocrPlat(bytes, { maxPages = 3, onStep = () => {} } = {}) {
  onStep('loading OCR engine');
  const pdfjs = await loadScript(PDFJS, 'pdfjsLib'); pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const T = await loadScript(TESSERACT, 'Tesseract');
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
  const worker = await T.createWorker('eng');
  const n = Math.min(doc.numPages, maxPages); let text = ''; let parsed = parsePlatText(''); let pagesRead = 0;
  try {
    for (let i = 1; i <= n; i++) {
      onStep(`reading sheet ${i} of ${n}${doc.numPages > n ? ` (plat has ${doc.numPages})` : ''}`);
      const pg = await doc.getPage(i); const vp1 = pg.getViewport({ scale: 1 });
      // ~200 dpi for small plat lettering, capped at 16 MP (canvas limit on phones)
      const scale = Math.min(200 / 72, Math.sqrt(16e6 / (vp1.width * vp1.height)));
      const vp = pg.getViewport({ scale }); const c = document.createElement('canvas');
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      const { data } = await worker.recognize(c);
      c.width = c.height = 0; pg.cleanup();
      text += `\n\n=== SHEET ${i} ===\n${data.text}`; pagesRead = i;
      parsed = parsePlatText(text);
      if (parsed.rows.length) break;
    }
  } finally { await worker.terminate().catch(() => {}); doc.destroy(); }
  return { text, parsed, pagesRead, pageCount: doc.numPages };
}

// ---------- parse OCR text ----------
const U = String.raw`(?:'|FT\.?\b|FEET\b|FOOT\b)`;
const N = String.raw`(\d{1,3}(?:\.\d)?)\s*${U}?`;
const KEYS = [
  ['street', String.raw`(?:STREET[\s-]*SIDE|SIDE[\s-]*STREET|CORNER(?:[\s-]*SIDE)?|FLANKING(?:[\s-]*STREET)?)(?:[\s-]*YARDS?)?`],
  ['front', String.raw`FRONT(?:[\s-]*YARDS?)?`],
  ['rear', String.raw`REAR(?:[\s-]*YARDS?)?`],
  ['side', String.raw`(?<!(?:STREET|CORNER|FLANKING)[\s-]*)\bSIDES?(?![\s-]*STREET)(?:[\s-]*YARDS?)?`],
];
function grab(s) {
  const r = {};
  for (const [k, p] of KEYS) {
    const m = s.match(new RegExp(String.raw`\b${p}\s*(?:SETBACKS?)?\s*[:=\-–—]?\s*${N}(?:\s*(?:&|AND|\/)\s*${N})?`));
    if (m) r[k] = m[2] ? `${+m[1]} & ${+m[2]}` : +m[1];
  }
  return r;
}
const enough = (r) => r.front != null && (r.rear != null || r.side != null);

export function parsePlatText(raw) {
  const t = String(raw || '').toUpperCase().replace(/[’‘`´′]/g, "'").replace(/[”“″]/g, '"').replace(/\r/g, '');
  const lines = t.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out = { rows: [], height: '', coverage: '', easements: [], excerpt: '' };
  // 1) per-lot-range lines: "LOTS 1-120 (R1-7) FRONT 18 FT REAR 20 FT …"
  for (const l of lines) {
    const m = l.match(/^LOTS?\s+([\d]+\s*(?:-|THRU|THROUGH|TO)\s*\d+(?:\s*(?:,|&|AND)\s*\d+(?:\s*-\s*\d+)?)*)\s*(?:\(([^)]+)\))?/);
    if (!m) continue; const g = grab(l);
    if (enough(g)) { out.rows.push({ lots: m[1].replace(/\s*(THRU|THROUGH|TO)\s*/, '-').replace(/\s+/g, ''), district: (m[2] || '').replace(/\s+/g, ''), ...g }); out.excerpt += `${l}\n`; }
  }
  // 2) a setback note block: text after a SETBACK / DEVELOPMENT STANDARDS / YARD anchor
  if (!out.rows.length) {
    const re = /SETBACK|BUILDING LINE|DEVELOPMENT STANDARDS|YARDS? (?:SHALL|REQUIRE)/g; let a;
    while ((a = re.exec(t)) && !out.rows.length) {
      const w = t.slice(a.index, a.index + 500).replace(/\s+/g, ' '); const g = grab(w);
      if (enough(g)) { out.rows.push({ lots: 'All', district: '', ...g }); out.excerpt = w.slice(0, 300); }
    }
  }
  // 3) any single line carrying three of the four yards
  if (!out.rows.length) for (const l of lines) { const g = grab(l); if (Object.keys(g).length >= 3 && g.front != null) { out.rows.push({ lots: 'All', district: '', ...g }); out.excerpt = l; break; } }
  const h = t.match(/(?:MAX(?:IMUM)?\.?\s*(?:BUILDING\s*)?HEIGHT|HEIGHT\s*LIMIT)[^0-9\n]{0,25}(\d{2})\s*(?:'|FT|FEET)/);
  if (h) out.height = `${+h[1]} ft`;
  const c = t.match(/COVERAGE[^0-9%\n]{0,25}(\d{2})\s*%/) || t.match(/(\d{2})\s*%\s*(?:MAX(?:IMUM)?\.?\s*)?(?:LOT\s*)?COVERAGE/);
  if (c) out.coverage = `${+c[1]}%`;
  out.easements = [...new Set(lines.filter(l => /EASEMENT|\bP\.?U\.?E\b|\bVNAE\b|NON-ACCESS/.test(l) && l.length > 12).map(l => l.slice(0, 160)))].slice(0, 6);
  return out;
}
