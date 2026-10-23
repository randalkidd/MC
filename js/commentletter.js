// "Zoning Plan Review Comments" letter (the reviewer's 2026 BB Batch Summary template, assets/templates/): Maricopa
// County P&D letterhead, reviewer box, NOTICE, then only the markups that do NOT meet requirements, grouped and
// numbered, then the standard footer links. Built with the vendored jsPDF.
import { loadJsPDF, runs, wrap, clean } from './pdf.js?v=16c6e229';

const NAVY = [0, 0, 0], RED = [237, 28, 36], BLUE = [5, 99, 193], GREY = [90, 90, 90], LINE = [190, 190, 190];
const RESUBMIT = 'https://www.maricopa.gov/DocumentCenter/View/95302/How-to-Resubmit-a-File';
const FOOT = [
  ['Maricopa County Zoning Ordinance', 'https://www.maricopa.gov/DocumentCenter/View/4785/Maricopa-County-Zoning-Ordinance-PDF'],
  ['Maricopa County Local Additions & Addenda', 'https://www.maricopa.gov/DocumentCenter/View/5808/Local-Additions-and-Addenda-PDF?bidId='],
  ['Maricopa County Construction Codes', 'https://www.maricopa.gov/2271/Ordinances-Regulations-and-Codes'],
  ['I-Codes Building Codes - ICC Digital Codes', 'https://codes.iccsafe.org/codes/i-codes/2018-icodes'],
  ['Substantive Policy Statements (Department Directives)', 'https://www.maricopa.gov/1911/Department-Directives'],
];

async function logoDataUrl() {
  try { const b = await (await fetch('./assets/maricopa-pd-logo.png')).blob(); return await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(b); }); } catch { return null; }
}

// rows: [{ group, loc, item, shows, req, cite, status, fix }]; only 'deficient' / 'incomplete' are printed.
export async function commentLetterPDF({ rows, info }) {
  const fails = rows.filter(r => r.status === 'deficient' || r.status === 'incomplete');
  if (!fails.length) throw new Error('Nothing fails requirements yet — the letter lists only items marked Deficient / Missing.');
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ unit: 'pt', format: 'letter' });
  const PW = 612, M = 46, W = PW - M * 2, BOTTOM = 668;
  const logo = await logoDataUrl();
  const center = (t, y, size, style = 'normal', color = NAVY, font = 'helvetica') => { doc.setFont(font, style); doc.setFontSize(size); doc.setTextColor(...color); doc.text(clean(t), PW / 2, y, { align: 'center' }); };

  const letterhead = () => {
    if (logo) doc.addImage(logo, 'PNG', 14, 12, 79, 45);
    doc.setFont('times', 'normal'); doc.setFontSize(19.5); doc.setTextColor(...NAVY);
    const t = 'ZONING PLAN REVIEW COMMENTS'; const tw = doc.getTextWidth(t); const tx = 291.8 - tw / 2;
    doc.text(t, tx, 37); doc.setDrawColor(...NAVY); doc.setLineWidth(0.8); doc.line(tx, 40, tx + tw, 40);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(60, 60, 60);
    doc.text('301 W. Jefferson St., Suite 170', 475, 20); doc.text('Phoenix, Arizona 85003', 475, 33);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...BLUE); doc.textWithLink('Maricopa.gov', 475, 46, { url: 'https://www.maricopa.gov' });
    doc.setLineWidth(0.6); doc.setDrawColor(...BLUE); doc.line(475, 47.5, 475 + doc.getTextWidth('Maricopa.gov'), 47.5);
  };
  const reviewerBox = () => {
    doc.setDrawColor(...NAVY); doc.setLineWidth(2.2); doc.rect(32, 58, 548, 19); doc.setLineWidth(0.6); doc.rect(35.5, 61.5, 541, 12);
    doc.setFont('helvetica', 'bolditalic'); doc.setFontSize(10); doc.setTextColor(...NAVY);
    const a = `REVIEWER: ${info.reviewer}`, b = 'Email: ';
    const wa = doc.getTextWidth(a), wb = doc.getTextWidth(b), we = doc.getTextWidth(info.email);
    let x = PW / 2 - (wa + 26 + wb + we) / 2;
    doc.text(clean(a), x, 71.5); x += wa + 26; doc.text(b, x, 71.5); x += wb;
    doc.setTextColor(...BLUE); doc.textWithLink(info.email, x, 71.5, { url: `mailto:${info.email}` }); doc.setDrawColor(...BLUE); doc.setLineWidth(0.5); doc.line(x, 72.8, x + we, 72.8);
  };
  const notice = () => {
    center('NOTICE', 93, 10.5, 'bolditalic', RED);
    doc.setFontSize(7.6); doc.setTextColor(...NAVY);
    const p1 = 'The submitted construction document(s) is ', p2 = 'not approved', p3 = '. The comments below summarize the markups / "redlines" on the submitted documents.';
    doc.setFont('helvetica', 'italic'); const w1 = doc.getTextWidth(p1), w3 = doc.getTextWidth(p3); doc.setFont('helvetica', 'bolditalic'); const w2 = doc.getTextWidth(p2);
    let x = PW / 2 - (w1 + w2 + w3) / 2;
    doc.setFont('helvetica', 'italic'); doc.text(p1, x, 103); x += w1; doc.setFont('helvetica', 'bolditalic'); doc.text(p2, x, 103); doc.setLineWidth(0.5); doc.setDrawColor(...NAVY); doc.line(x, 104.2, x + w2, 104.2); x += w2; doc.setFont('helvetica', 'italic'); doc.text(p3, x, 103);
    const q1 = 'User Guide - Instructions on How to Resubmit a File => '; const wq = doc.getTextWidth(q1), wl = doc.getTextWidth(RESUBMIT);
    x = PW / 2 - (wq + wl) / 2; doc.text(q1, x, 112.5); doc.setTextColor(...BLUE); doc.textWithLink(RESUBMIT, x + wq, 112.5, { url: RESUBMIT }); doc.setDrawColor(...BLUE); doc.line(x + wq, 113.6, x + wq + wl, 113.6);
  };
  const footer = () => {
    center('Further reviews may prompt additional comments not included in this review.', 692, 8.6, 'bolditalic', RED);
    let y = 707;
    for (const [label, url] of FOOT) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.6); const w1 = doc.getTextWidth(label), w2 = doc.getTextWidth(' => ' + url);
      const x = PW / 2 - (w1 + w2) / 2; doc.setTextColor(...BLUE);
      doc.textWithLink(label, x, y, { url }); doc.setLineWidth(0.4); doc.setDrawColor(...BLUE); doc.line(x, y + 1, x + w1, y + 1);
      doc.textWithLink(' => ' + url, x + w1, y, { url }); y += 14.6;
    }
  };
  const contHeader = () => {
    doc.setFont('times', 'normal'); doc.setFontSize(12); doc.setTextColor(...NAVY); doc.text('ZONING PLAN REVIEW COMMENTS (continued)', M, 40);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GREY); doc.text(clean(`${info.apn || ''}${info.address ? ` - ${info.address}` : ''}`), PW - M, 40, { align: 'right' });
    doc.setDrawColor(...LINE); doc.setLineWidth(0.6); doc.line(M, 46, PW - M, 46);
  };

  letterhead(); reviewerBox(); notice();
  let y = 130;
  const newPage = () => { doc.addPage(); contHeader(); y = 62; };
  const need = (h) => { if (y + h > BOTTOM) newPage(); };
  const para = (src, { size = 8.6, indent = 0, color = NAVY, bold = false, gap = 2, label = '' } = {}) => {
    const rs = [...(label ? [{ t: clean(label), b: true }] : []), ...runs(src).map(r => (bold ? { ...r, b: true } : r))];
    const lines = wrap(doc, rs, W - indent, size); const lh = size * 1.28;
    for (const ln of lines) {
      need(lh);
      for (const p of ln) { doc.setFont('helvetica', p.b ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...(p.u ? BLUE : color)); doc.text(p.t, M + indent + p.x, y + size); if (p.u && p.t.trim()) doc.link(M + indent + p.x, y, p.w, size, { url: p.u }); }
      y += lh;
    }
    y += gap;
  };

  // Project block
  const facts = [['APN', info.apn], ['Site address', info.address], ['Owner', info.owner], ['Permit / case #', info.permit], ['Submittal', info.type], ['Plan reviewed', info.plan], ['Zoning district', info.district], ['Review date', info.date && /^\d{4}-\d{2}-\d{2}$/.test(info.date) ? new Date(`${info.date}T12:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : info.date]].filter(([, v]) => v);
  doc.setDrawColor(...LINE); doc.setLineWidth(0.6);
  const colW = W / 2; const startY = y;
  facts.forEach(([k, v], i) => {
    const cx = M + (i % 2) * colW, cy = startY + Math.floor(i / 2) * 13;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.2); doc.setTextColor(...NAVY); doc.text(`${k}:`, cx, cy + 9);
    doc.setFont('helvetica', 'normal'); const parts = doc.splitTextToSize(clean(v), colW - 78); doc.text(parts[0] + (parts.length > 1 ? '...' : ''), cx + 74, cy + 9);
  });
  y = startY + Math.ceil(facts.length / 2) * 13 + 6;
  doc.line(M, y, PW - M, y); y += 8;
  const nInc = fails.filter(r => r.status === 'incomplete').length;
  para(`**${fails.length} comment${fails.length === 1 ? '' : 's'}** must be addressed before approval${nInc ? ` (${nInc} missing submittal item${nInc === 1 ? '' : 's'})` : ''}. Revise the documents to resolve each comment and resubmit. Only items that do not meet requirements are listed.`, { size: 8.6, gap: 6 });

  // Comments, grouped
  const ORDER = ['Ownership & Parcel Information', 'Submittal Requirements (Completeness)', 'Zoning Standards (Setbacks, Height, Coverage)', 'Other Comments'];
  const groups = [...new Set([...ORDER, ...fails.map(r => r.group)])].filter(g => fails.some(r => r.group === g));
  let n = 0;
  for (const g of groups) {
    need(40);
    doc.setFillColor(232, 238, 246); doc.rect(M, y, W, 15, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...NAVY); doc.text(clean(g.toUpperCase()), M + 5, y + 10.5); y += 20;
    for (const r of fails.filter(x => x.group === g)) {
      need(46);
      n++;
      const top = y;
      para(`${n}.  ${r.item}`, { size: 9, bold: true, gap: 1 });
      const sub = (label, txt) => txt && txt !== '—' && para(txt, { label: `${label} `, indent: 16, gap: 0.5, size: 8.3 });
      if (r.loc && r.loc !== 'Submittal' && r.loc !== '—') sub('Sheet / location:', r.loc);
      sub('Plan shows:', r.shows);
      { const rq = r.req && r.req !== 'Per checklist' ? r.req : ''; const ct = r.cite && r.cite !== '—' ? r.cite : ''; sub('Required:', rq && ct ? `${rq} (${ct})` : rq || ct); }
      if (r.fix && r.fix !== '—') para(r.fix, { label: 'Correction: ', indent: 16, gap: 0, size: 8.3, color: [150, 20, 20] });
      if (doc.getCurrentPageInfo().pageNumber === doc.getNumberOfPages() && y > top) { doc.setDrawColor(...LINE); doc.setLineWidth(0.4); doc.line(M + 16, y + 3, PW - M, y + 3); }
      y += 8;
    }
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) { doc.setPage(p); footer(); doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...GREY); doc.text(`Page ${p} of ${pages}`, PW - M, 780, { align: 'right' }); }
  const fname = `${info.apn || 'plan'} - Zoning Plan Review Comments - ${info.date || ''}.pdf`.replace(/[\\/:*?"<>|]+/g, '-');
  doc.save(fname);
  return { count: fails.length, file: fname };
}
