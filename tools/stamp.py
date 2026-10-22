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
    # HTML references:  src="js/x.js"  href="js/x.js"  href="css/x.css"
    text = re.sub(r'((?:src|href)=")((?:js|css)/[\w-]+\.(?:js|css))(")', rf'\1\2?v={v}\3', text)
    return text

changed = 0
for p in [*root.glob('js/*.js'), root / 'index.html']:
    old = p.read_text(encoding='utf-8'); new = stamp(old)
    if new != old: p.write_text(new, encoding='utf-8'); changed += 1
print(f'version {v} — {changed} file(s) updated')
