// Parcel report → PDF. Renders the report's Markdown (headings, paragraphs, bullets, pipe tables,
// **bold**, [links](url)) with jsPDF, always in print/light colors. jsPDF is vendored (same origin,
// no CSP change) and only loaded the first time someone clicks "Save PDF".

const JSPDF_SRC = './js/vendor/jspdf-2.5.2.umd.min.js';
let libP = null;
export function loadJsPDF() {
  if (window.jspdf) return Promise.resolve(window.jspdf.jsPDF);
  if (!libP) libP = new Promise((res, rej) => {
    const s = Object.assign(document.createElement('script'), { src: JSPDF_SRC, async: true });
    s.onload = () => window.jspdf ? res(window.jspdf.jsPDF) : rej(new Error('PDF library failed to load'));
    s.onerror = () => { libP = null; rej(new Error('PDF library failed to load')); };
    document.head.appendChild(s);
  });
  return libP;
}

// The built-in PDF fonts only cover Latin-1; map the few other characters the report uses.
const MAP = { '—': '-', '–': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '•': '-', '≥': '>=', '≤': '<=', '≈': '~', '→': '->', '←': '<-', '✓': 'Y', '✔': 'Y', '✗': 'N', '✕': 'x', '⚠': '!', '★': '*', ' ': ' ', ' ': ' ' };
export const clean = (s) => String(s).replace(/[️​-‍]/g, '').replace(/[^\x00-\xFF]/g, (c) => MAP[c] ?? '?');

const C = { ink: [19, 29, 40], muted: [79, 93, 107], line: [216, 223, 225], head: [233, 238, 240], navy: [19, 32, 72], link: [0, 112, 185], accent: [242, 103, 36] }; // orange kept as the saved color
import { currentAccent } from './accents.js?v=cae01958';
// Rule lines use the chosen accent's print (light-theme) shade.
const accentRGB = () => { const h = currentAccent().light.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };

// Inline Markdown → runs of {t, b, u}
export function runs(src) {
  const out = []; const s = String(src).replace(/\\\|/g, '|').replace(/`/g, '').replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,;:])/g, '$1$2');
  // Split on ** to toggle bold, then find [text](url) links inside each chunk.
  s.split('**').forEach((chunk, k) => {
    const b = k % 2 === 1; const re = /\[([^\]]+)\]\(([^)\s]+)\)/g; let i = 0, m;
    while ((m = re.exec(chunk))) {
      if (m.index > i) out.push({ t: chunk.slice(i, m.index), b });
      out.push({ t: m[1], b, u: m[2] }); i = re.lastIndex;
    }
    if (i < chunk.length) out.push({ t: chunk.slice(i), b });
  });
  return out.map((r) => ({ ...r, t: clean(r.t) })).filter((r) => r.t);
}

// Word-wrap runs to a width; returns lines of positioned pieces.
export function wrap(doc, rs, width, size) {
  const lines = [[]]; let x = 0;
  const w = (t, b) => { doc.setFont('helvetica', b ? 'bold' : 'normal'); doc.setFontSize(size); return doc.getTextWidth(t); };
  for (const r of rs) {
    for (const tok of r.t.split(/(\s+)/)) {
      if (!tok) continue;
      const space = /^\s+$/.test(tok);
      if (space) { if (x > 0) { const tw = w(' ', r.b); lines.at(-1).push({ ...r, t: ' ', x, w: tw }); x += tw; } continue; }
      let piece = tok, tw = w(piece, r.b);
      if (x > 0 && x + tw > width) { while (lines.at(-1).length && lines.at(-1).at(-1).t === ' ') lines.at(-1).pop(); lines.push([]); x = 0; }
      while (tw > width && piece.length > 1) { // hard-break very long tokens (URLs)
        let n = piece.length; while (n > 1 && w(piece.slice(0, n), r.b) > width) n--;
        lines.at(-1).push({ ...r, t: piece.slice(0, n), x, w: w(piece.slice(0, n), r.b) }); lines.push([]); x = 0;
        piece = piece.slice(n); tw = w(piece, r.b);
      }
      lines.at(-1).push({ ...r, t: piece, x, w: tw }); x += tw;
    }
  }
  return lines.filter((l, i) => l.length || i === 0);
}

export async function reportPDF(md, { apn = 'parcel', title = 'Unofficial Maricopa County Zoning Hub' } = {}) {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ unit: 'pt', format: 'letter' });
  const PW = doc.internal.pageSize.getWidth(), PH = doc.internal.pageSize.getHeight();
  const M = 48, W = PW - M * 2, TOP = 66, BOTTOM = PH - 46;
  let y = TOP;
  doc.setProperties({ title: `Parcel ${apn} — zoning report`, subject: 'Parcel lookup report', creator: title });

  const newPage = () => { doc.addPage(); y = TOP; };
  const need = (h) => { if (y + h > BOTTOM) newPage(); };
  const draw = (line, x0, yy, size, color) => {
    for (const p of line) {
      doc.setFont('helvetica', p.b ? 'bold' : 'normal'); doc.setFontSize(size);
      doc.setTextColor(...(p.u ? C.link : color));
      doc.text(p.t, x0 + p.x, yy);
      if (p.u && p.t.trim()) doc.link(x0 + p.x, yy - size * 0.8, p.w, size, { url: p.u });
    }
  };
  const para = (src, { size = 10, indent = 0, color = C.ink, bullet = false, gap = 4 } = {}) => {
    const lh = size * 1.32, x0 = M + indent + (bullet ? 12 : 0);
    const lines = wrap(doc, runs(src), W - indent - (bullet ? 12 : 0), size);
    lines.forEach((ln, i) => {
      need(lh);
      if (bullet && i === 0) { doc.setFillColor(...C.muted); doc.circle(M + indent + 4, y + size * 0.65, 1.6, 'F'); }
      draw(ln, x0, y + size, size, color); y += lh;
    });
    y += gap;
  };
  const heading = (src, level) => {
    const size = level <= 2 ? 16 : level === 3 ? 12.5 : 11;
    const before = level <= 2 ? 6 : 12;
    need(before + size * 1.4 + 30); y += before;
    const lines = wrap(doc, runs(src).map((r) => ({ ...r, b: true })), W, size);
    for (const ln of lines) { draw(ln, M, y + size, size, C.navy); y += size * 1.3; }
    if (level <= 3) { doc.setDrawColor(...(level <= 2 ? accentRGB() : C.line)); doc.setLineWidth(level <= 2 ? 1.5 : 0.6); doc.line(M, y + 2, M + W, y + 2); y += 6; }
    y += 4;
  };
  const table = (rows) => {
    const head = rows[0], body = rows.slice(1), n = head.length, size = 8.5, pad = 4, lh = size * 1.28;
    // Column widths: proportional to content length, with a floor so short columns stay readable.
    const len = head.map((_, c) => Math.max(...rows.map((r) => Math.min(clean(String(r[c] ?? '').replace(/\]\([^)]*\)|\*\*|[[\]]/g, '')).length, 60)), 3));
    const floor = Math.min(70, W / n * 0.6), total = len.reduce((a, b) => a + b, 0);
    let cw = len.map((l) => Math.max(floor, (W * l) / total)); const sc = W / cw.reduce((a, b) => a + b, 0); cw = cw.map((w) => w * sc);
    const layout = (r, bold) => r.map((cell, c) => wrap(doc, runs(cell ?? '').map((x) => (bold ? { ...x, b: true } : x)), cw[c] - pad * 2, size));
    const drawRow = (cells, fill) => {
      const h = Math.max(...cells.map((l) => l.length)) * lh + pad * 2;
      if (y + h > BOTTOM) { newPage(); if (!fill) drawRow(layout(head, true), true); }
      let x = M;
      cells.forEach((lines, c) => {
        if (fill) { doc.setFillColor(...C.head); doc.rect(x, y, cw[c], h, 'F'); }
        doc.setDrawColor(...C.line); doc.setLineWidth(0.5); doc.rect(x, y, cw[c], h, 'S');
        lines.forEach((ln, i) => draw(ln, x + pad, y + pad + size + i * lh - 1, size, C.ink));
        x += cw[c];
      });
      y += h;
    };
    need(lh * 3 + pad * 4);
    drawRow(layout(head, true), true);
    body.forEach((r) => drawRow(layout(Array.from({ length: n }, (_, i) => r[i] ?? ''), false), false));
    y += 8;
  };

  const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
  const lines = String(md).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln.trim()) { y += 2; continue; }
    let m;
    if ((m = ln.match(/^(#{1,6})\s+(.*)$/))) { heading(m[2], m[1].length); continue; }
    if (/^\s*\|/.test(ln)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { if (!/^\s*\|?\s*:?-{2,}/.test(lines[i])) rows.push(cells(lines[i])); i++; }
      i--; if (rows.length) table(rows); continue;
    }
    if ((m = ln.match(/^(\s*)[-*]\s+(.*)$/))) { para(m[2], { bullet: true, indent: Math.min(m[1].length, 6) * 4, gap: 1 }); continue; }
    if ((m = ln.match(/^>\s?(.*)$/))) { para(m[1], { indent: 10, color: C.muted }); continue; }
    if (/^-{3,}$/.test(ln.trim())) { need(10); doc.setDrawColor(...C.line); doc.line(M, y + 4, M + W, y + 4); y += 10; continue; }
    para(ln);
  }

  // Running header + page numbers on every page.
  const pages = doc.getNumberOfPages(); const stamp = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...C.navy);
    doc.text(clean(title), M, 32);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.muted);
    doc.text(clean(`Parcel ${apn}`), PW - M, 32, { align: 'right' });
    doc.setDrawColor(...accentRGB()); doc.setLineWidth(1); doc.line(M, 38, PW - M, 38);
    doc.setFontSize(8); doc.text(`Generated ${stamp} - unofficial; verify with Maricopa County Planning & Development`, M, PH - 24);
    doc.text(`Page ${p} of ${pages}`, PW - M, PH - 24, { align: 'right' });
  }
  doc.save(`Parcel-${apn}-report.pdf`);
}
