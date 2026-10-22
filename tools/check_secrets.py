#!/usr/bin/env python3
"""Fail if a secret or a real .env file is about to be (or has been) committed.

  python3 tools/check_secrets.py            # scan every tracked file
  python3 tools/check_secrets.py --staged   # scan only staged files (used by tools/hooks/pre-commit)
"""
import re, subprocess, sys, pathlib

PATTERNS = [
    ('GitHub token', re.compile(r'\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b')),
    ('Cloudflare API token', re.compile(r'\bCF_API_TOKEN\s*[=:]\s*["\']?[A-Za-z0-9_-]{30,}')),
    ('AWS access key', re.compile(r'\bAKIA[0-9A-Z]{16}\b')),
    ('Anthropic/OpenAI key', re.compile(r'\bsk-(ant-)?[A-Za-z0-9_-]{30,}\b')),
    ('Slack token', re.compile(r'\bxox[abpr]-[A-Za-z0-9-]{10,}\b')),
    ('Private key', re.compile(r'-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----')),
    ('Secret assignment', re.compile(r'\b(GITHUB_TOKEN|SITE_KEY|PASSPHRASE|API_KEY|SECRET)\s*=\s*["\']?(?!REPLACE|github_pat_(?:REPLACE|\.\.\.)|\$|<)[^\s"\'#]{12,}')),
]
FORBIDDEN_NAMES = re.compile(r'(^|/)(\.env(\.[^/]*)?|\.dev\.vars(\.[^/]*)?)$')
ALLOWED_NAMES = re.compile(r'\.example$')
SKIP = re.compile(r'(^|/)(js/vendor/|data/all-subdivisions\.json$)|\.(png|jpe?g|gif|pdf|ico|woff2?)$')

def files(staged):
    cmd = ['git', 'diff', '--cached', '--name-only', '--diff-filter=ACM'] if staged else ['git', 'ls-files']
    return [f for f in subprocess.run(cmd, capture_output=True, text=True, check=True).stdout.splitlines() if f]

def main():
    staged = '--staged' in sys.argv
    problems = []
    for f in files(staged):
        if FORBIDDEN_NAMES.search(f) and not ALLOWED_NAMES.search(f):
            problems.append(f'{f}: secrets file must not be committed (it is in .gitignore — run: git rm --cached {f})')
            continue
        if SKIP.search(f):
            continue
        try:
            text = (subprocess.run(['git', 'show', f':{f}'], capture_output=True, text=True).stdout if staged
                    else pathlib.Path(f).read_text(encoding='utf-8', errors='ignore'))
        except OSError:
            continue
        for n, line in enumerate(text.splitlines(), 1):
            for name, rx in PATTERNS:
                if rx.search(line):
                    problems.append(f'{f}:{n}: possible {name}')
    if problems:
        print('Secret scan FAILED:\n  ' + '\n  '.join(problems))
        print('If a real token was committed: revoke it on GitHub/Cloudflare first, then remove it from the file.')
        sys.exit(1)
    print(f'Secret scan passed ({"staged" if staged else "tracked"} files).')

if __name__ == '__main__':
    main()
