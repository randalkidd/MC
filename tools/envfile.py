"""Load KEY=VALUE pairs from a git-ignored .env file into os.environ (existing variables win)."""
import os, pathlib

def load_env(path=None):
    p = pathlib.Path(path) if path else pathlib.Path(__file__).resolve().parent.parent / '.env'
    if not p.is_file():
        return
    for line in p.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        k = k.strip().removeprefix('export ').strip()
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in '"\'':
            v = v[1:-1]
        os.environ.setdefault(k, v)
