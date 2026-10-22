// County Recorder helpers for plats (public API, through the relay when the browser is blocked).
import { request } from './net.js?v=40b75a80';
import { EP } from './lookup.js?v=40b75a80';

const recDate = (s) => { const m = String(s || '').match(/(\d{1,2})-(\d{1,2})-(\d{4})/); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : ''; };
const num = (v) => String(v ?? '').replace(/^0+(?=\d)/, '');

// Plat document for an Assessor subdivision name + MCR book/page. The Recorder name search is a prefix match.
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
