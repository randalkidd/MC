#!/usr/bin/env python3
"""Weekly snapshot of MCDOT's Patent Easement Abandonment Tracker (PDF) -> data/patent-abandonments.json.

Source: https://www.maricopa.gov/DocumentCenter/View/111506/Patent-Easement-Abandonment-Tracking-PDF
Each row is one PAB case: applicant, location, APN(s), the dates of each step, the Board decision, the
resolution recording number and the status. Row colour = phase (green Initial Determination, blue Application,
orange Board of Supervisors). The site checks every parcel lookup against the APNs listed here.
Run by .github/workflows/refresh-patent-abandonments.yml (GitHub's runners can reach maricopa.gov).
"""
import json, re, sys, datetime, urllib.request, pathlib
import pdfplumber

URL = 'https://www.maricopa.gov/DocumentCenter/View/111506/Patent-Easement-Abandonment-Tracking-PDF'
ROOT = pathlib.Path(__file__).resolve().parent.parent
PDF = ROOT / 'data/source/patent-easement-tracker.pdf'
OUT = ROOT / 'data/patent-abandonments.json'
TXT = ROOT / 'data/source/patent-easement-tracker.txt'

KEYS = ['pab', 'applicant', 'location', 'apn', 'payment', 'routedInitial', 'initialLetter', 'appReceived', 'appRouted',
        'reportToBos', 'board1', 'certifiedLetter', 'posted', 'board2', 'bosDecision', 'finalLetter', 'resolution', 'status', 'expires']

def fetch():
    if len(sys.argv) > 1 and sys.argv[1] == '--local':
        return PDF.read_bytes()
    req = urllib.request.Request(URL, headers={'User-Agent': 'Mozilla/5.0 (MC Zoning Hub refresh)'})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    if not data.startswith(b'%PDF'):
        raise SystemExit('Download is not a PDF')
    PDF.parent.mkdir(parents=True, exist_ok=True)
    PDF.write_bytes(data)
    return data

def clean(v):
    return re.sub(r'\s+', ' ', (v or '')).strip()

def expand_apns(cell):
    """'216-50-159C, 159D' -> ['21650159C','21650159D']; '202-13-007E, F, G' -> E, F, G; '211-44-066, 095' -> both."""
    out, book, item = [], None, None
    for tok in re.split(r'[,;&/]|\band\b|\s+(?=\d{3}-\d{2}-)', cell or ''):
        t = tok.strip().upper().replace(' ', '')
        if not t:
            continue
        m = re.match(r'^(\d{3})-?(\d{2})-?(\d{3})([A-Z]?)$', t)
        if m:
            book = m.group(1) + m.group(2); item = m.group(3); out.append(book + item + m.group(4)); continue
        m = re.match(r'^(\d{3})([A-Z]?)$', t)
        if m and book:
            item = m.group(1); out.append(book + item + m.group(2)); continue
        m = re.match(r'^([A-Z])$', t)
        if m and book and item:
            out.append(book + item + m.group(1)); continue
    return list(dict.fromkeys(out))

PHASE = {'green': 'Initial Determination', 'blue': 'Application', 'orange': 'Board of Supervisors'}
def colour_name(c):
    if not c or not isinstance(c, (list, tuple)):
        return None
    if len(c) == 1:
        return None
    if len(c) == 4:  # CMYK -> RGB
        cc, m, y, k = c; c = ((1 - cc) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k))
    r, g, b = c[:3]
    if min(r, g, b) > 0.93:
        return None
    if g > r + 0.08 and g > b + 0.04:
        return 'green'
    if b > r + 0.08 and b >= g - 0.02:
        return 'blue'
    if r > b + 0.15 and g > b:
        return 'orange'
    return None

def main():
    data = fetch()
    rows, txt = [], []
    with pdfplumber.open(PDF) as pdf:
        for pno, page in enumerate(pdf.pages, 1):
            txt.append(f'=== page {pno} ===\n' + (page.extract_text(layout=True) or ''))
            fills = [r for r in page.rects if r.get('non_stroking_color') is not None and r.get('fill')]
            for tb in page.find_tables():
                data_rows = tb.extract()
                for i, cells in enumerate(data_rows):
                    cells = [clean(c) for c in cells]
                    if not cells or not re.match(r'^(PAB\s*)?\d{1,4}\b', cells[0] or '') or re.match(r'^PAB\s*No', cells[0] or '', re.I):
                        continue
                    while len(cells) < len(KEYS):
                        cells.append('')
                    rec = dict(zip(KEYS, cells[:len(KEYS)]))
                    rec['pab'] = re.sub(r'\D', '', rec['pab']).zfill(4)
                    rec['apns'] = expand_apns(rec['apn'])
                    # phase from the row's fill colour
                    try:
                        y0, y1 = tb.rows[i].bbox[1], tb.rows[i].bbox[3]
                        names = [colour_name(r['non_stroking_color']) for r in fills if r['top'] < y1 - 1 and r['bottom'] > y0 + 1]
                        names = [n for n in names if n]
                        if names:
                            rec['phase'] = PHASE[max(set(names), key=names.count)]
                    except Exception:
                        pass
                    rec['page'] = pno
                    rows.append(rec)
    TXT.write_text('\n'.join(txt))
    snap = {'source': URL, 'title': 'MCDOT Patent Easement Abandonment Tracker', 'fetched': datetime.date.today().isoformat(),
            'count': len(rows), 'rows': rows}
    OUT.write_text(json.dumps(snap, indent=1) + '\n')
    print(f'{len(rows)} rows, {sum(len(r["apns"]) for r in rows)} APNs, {sum(1 for r in rows if r.get("phase"))} with phase colour')

if __name__ == '__main__':
    main()
