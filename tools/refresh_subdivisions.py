#!/usr/bin/env python3
"""Monthly snapshot of every recorded subdivision in Maricopa County (Parcel MapServer layer 0) → data/all-subdivisions.json.
Run by .github/workflows/refresh-subdivisions.yml; safe to run by hand. Env SUBDIV_URL overrides the layer URL (tests)."""
import json, os, sys, time, urllib.parse, urllib.request, pathlib, datetime
URL = os.environ.get('SUBDIV_URL', 'https://gis.maricopa.gov/arcgis/rest/services/IndividualService/Parcel/MapServer/0') + '/query'
PAGE = 2000
OUT = pathlib.Path(__file__).resolve().parent.parent / 'data' / 'all-subdivisions.json'

def query(params, tries=4):
    body = urllib.parse.urlencode({'f': 'json', **params}).encode()
    for i in range(tries):
        try:
            req = urllib.request.Request(URL, data=body, headers={'User-Agent': 'MC-Zoning-Hub monthly refresh (+https://randalkidd.github.io/MC/)'})
            with urllib.request.urlopen(req, timeout=90) as r: d = json.load(r)
            if 'error' in d: raise RuntimeError(d['error'])
            return d
        except Exception as e:
            if i == tries - 1: raise
            time.sleep(5 * (i + 1)); print(f'retry {i + 1}: {e}', file=sys.stderr)

count = query({'where': '1=1', 'returnCountOnly': 'true'})['count']
feats = []
for off in range(0, count, PAGE):
    d = query({'where': '1=1', 'outFields': 'OBJECTID,SubdivisionName,MCRNumber,MCRWebLink', 'returnGeometry': 'false',
               'orderByFields': 'OBJECTID', 'resultOffset': off, 'resultRecordCount': PAGE})
    feats += [f['attributes'] for f in d.get('features', [])]
    print(f'{len(feats)}/{count}', file=sys.stderr)
if len(feats) < count * 0.98:
    sys.exit(f'Only {len(feats)} of {count} records came back — not writing a partial snapshot.')
seen = {}
for a in feats:
    name = (a.get('SubdivisionName') or '').strip()
    if not name: continue
    mcr = (a.get('MCRNumber') or '').strip(); k = (name.upper(), mcr)
    if k in seen:
        seen[k][3] += 1
        if not seen[k][2] and a.get('MCRWebLink'): seen[k][2] = a['MCRWebLink']
    else: seen[k] = [name, mcr, a.get('MCRWebLink') or '', 1]
# The county's MCRWebLink is normally the Recorder book/page search, which the site rebuilds from the MCR number;
# keep a link only when it differs (keeps the snapshot ~70% smaller).
def std(mcr):
    b, _, pg = mcr.partition('-')
    return f'https://recorder.maricopa.gov/recording/document-search-results.html?mode=book&docketBook={b}&pageMap={pg}'
for r in seen.values():
    if r[2] == std(r[1]): r[2] = ''
rows = sorted(seen.values(), key=lambda r: (r[0].upper(), r[1]))
new = {'source': URL.rsplit('/query', 1)[0], 'records': count, 'rows': rows}
old = json.loads(OUT.read_text()) if OUT.exists() else {}
if {k: old.get(k) for k in new} == new:
    print('No change since', old.get('updated')); sys.exit(0)
new = {'updated': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'columns': ['name', 'mcr', 'link', 'areas'], **new}
OUT.write_text(json.dumps(new, separators=(',', ':'), ensure_ascii=False) + '\n')
print(f'Wrote {len(rows)} subdivisions ({count} GIS records) to {OUT.name}')
