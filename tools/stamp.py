#!/usr/bin/env python3
"""Cache-busting: append ?v=<hash of all JS/CSS> to every local JS/CSS reference.

GitHub Pages caches files for ~10 minutes, so without this a browser can keep running
old code after a deploy. Run before committing: python3 tools/stamp.py
"""
import hashlib, pathlib, re

root = pathlib.Path(__file__).resolve().parent.parent
assets = sorted([*root.glob('js/*.js'), *root.glob('css/*.css')])
strip = lambda t: re.sub(r'\?v=[0-9a-f]{8}', '', t)
h = hashlib.sha256()
for p in assets:
    h.update(p.name.encode()); h.update(strip(p.read_text(encoding='utf-8')).encode())
v = h.hexdigest()[:8]

def stamp(text):
    text = strip(text)
    # ES module imports:  from './x.js'
    text = re.sub(r"(from\s+['\"])(\./[\w-]+\.js)(['\"])", rf"\1\2?v={v}\3", text)
    # dynamic imports:  import('./x.js')
    text = re.sub(r"(import\(\s*['\"])(\./[\w-]+\.js)(['\"])", rf"\1\2?v={v}\3", text)
    # HTML references:  src="js/x.js"  href="js/x.js"  href="css/x.css"
    text = re.sub(r'((?:src|href)=")((?:js|css)/[\w-]+\.(?:js|css))(")', rf'\1\2?v={v}\3', text)
    return text

changed = 0
for p in [*root.glob('js/*.js'), root / 'index.html']:
    old = p.read_text(encoding='utf-8'); new = stamp(old)
    if new != old: p.write_text(new, encoding='utf-8'); changed += 1
# Footer build number: MM.DD.YY.NNN (Arizona date, NNN = nth change to the site that day).
# Bumps only when code or page markup changes (data saves don't count).
import json, datetime
from zoneinfo import ZoneInfo
idx = root / 'index.html'
page = re.sub(r'(<span id="build">)[^<]*(</span>)', r'\1\2', strip(idx.read_text(encoding='utf-8')))
bh = hashlib.sha256((v + page).encode()).hexdigest()[:12]
vf = root / 'tools' / 'version.json'
state = json.loads(vf.read_text()) if vf.exists() else {}
today = datetime.datetime.now(ZoneInfo('America/Phoenix')).strftime('%m.%d.%y')
if state.get('hash') != bh:
    state = {'date': today, 'n': state.get('n', 0) + 1 if state.get('date') == today else 1, 'hash': bh}
    vf.write_text(json.dumps(state, indent=2) + '\n')
build = f"{state['date']}.{state['n']:03d}"
html = idx.read_text(encoding='utf-8'); new = re.sub(r'(<span id="build">)[^<]*(</span>)', rf'\g<1>{build}\g<2>', html)
if new != html: idx.write_text(new, encoding='utf-8'); changed += 1
print(f'version {v} · build {build} — {changed} file(s) updated')
