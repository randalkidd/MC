#!/usr/bin/env python3
"""Build REG_DOCS / REG_LOOKUP in js/refdata.js from the project reference docs (markdown tables).
Usage: python3 tools/build_reglookup.py <dir with county-ordinances-regulations.md, local-additions-addenda.md, staff-interpretations.md>"""
import re, sys, json, pathlib
src = pathlib.Path(sys.argv[1])
LINK = re.compile(r'\[([^\]]+)\]\(([^)]+)\)')
def clean(t): return re.sub(r'\s+', ' ', LINK.sub(r'\1', t).replace('**', '').replace('`', '')).strip()
def tables(md):
    out, cur = [], None
    for l in md.splitlines():
        if l.startswith('|'):
            cells = [c.strip() for c in l.strip().strip('|').split('|')]
            if cur is None: cur = {'head': cells, 'rows': []}
            elif re.match(r'^-+$', cells[0].replace(':', '')): continue
            else: cur['rows'].append(cells)
        elif cur is not None: out.append(cur); cur = None
    if cur: out.append(cur)
    return out
U = {'LA&A': 'https://www.maricopa.gov/Archive.aspx?ADID=6309', 'P-11 Abatement': 'https://www.maricopa.gov/Archive.aspx?ADID=6302',
     'P-22 Construction hours': 'https://www.maricopa.gov/Archive.aspx?ADID=6304', 'P-23 Noise': 'https://www.maricopa.gov/Archive.aspx?ADID=6306',
     'P-16 Military airport': 'https://www.maricopa.gov/Archive.aspx?ADID=6305', 'Addressing Regs': 'https://www.maricopa.gov/Archive.aspx?ADID=6303',
     'Staff interpretation': 'https://www.maricopa.gov/Archive.aspx?ADID=6307'}
rows = []
def add(doc, sec, topic, rule):
    rule = re.sub(r'See Table C, rows? [0-9–-]+', 'See the matching LA&A zoning-crossover row', rule)
    rows.append({'d': doc, 's': clean(sec), 't': clean(topic), 'r': clean(rule), 'u': U[doc]})
ord_md = (src / 'county-ordinances-regulations.md').read_text()
T = tables(ord_md)
docs = []
for r in T[0]['rows']:
    links = [{'t': t, 'u': u} for t, u in LINK.findall(r[4])]
    docs.append({'n': clean(r[0]), 'e': clean(r[1]), 'st': clean(r[2]), 'l': links})
sections = re.split(r'\n## ', ord_md)
def sec_tables(prefix): return tables(next(s for s in sections if s.startswith(prefix)))
for t in sec_tables('2.'): [add('P-11 Abatement', r[2], r[0], r[1]) for r in t['rows']]
p22 = sec_tables('3.'); [add('P-22 Construction hours', r[2], r[0], r[1]) for r in p22[0]['rows']]; [add('P-22 Construction hours', r[2], r[0], r[1]) for r in p22[1]['rows']]
for t in sec_tables('4.'): [add('P-23 Noise', r[2], r[0], r[1]) for r in t['rows']]
p16 = sec_tables('5.')
for r in p16[0]['rows']: add('P-16 Military airport', '201–202', f'{r[0]} district', f'{r[1]} ({r[2]})')
for r in p16[1]['rows']: add('P-16 Military airport', 'Art. V–VIII', r[0], f'AD I: {r[1]} · AD II: {r[2]} · AD III: {r[3]}')
for r in p16[2]['rows']: add('P-16 Military airport', r[2], r[0], r[1])
for t in sec_tables('6.'): [add('Addressing Regs', r[2], r[0], r[1]) for r in t['rows']]
laa = tables((src / 'local-additions-addenda.md').read_text())
tb = next(t for t in laa if t['head'][0].startswith('Code §'))
for r in tb['rows']: add('LA&A', r[0], r[1], r[2] + ('' if r[3] in ('—', '') else f' — use: {r[3]}'))
tc = next(t for t in laa if t['head'][1].startswith('Situation'))
for r in tc['rows']: add('LA&A', r[4], r[1], f'{r[2]}' + ('' if r[3] in ('—', '') else f' · Zoning still requires: {r[3]}'))
st = tables((src / 'staff-interpretations.md').read_text())[0]
for r in st['rows']: add('Staff interpretation', f'#{r[0]} ({r[2]})', r[1], f'{r[3]} — check: {r[4]}')
U['MCSR'] = 'https://www.maricopa.gov/Archive.aspx?ADID=6308'
sub = (src / 'README.md').read_text() if (src / 'README.md').exists() else ''
if sub:
    q = sub.split('## Quick reference')[1].split('\n## ')[0]
    for t in tables(q):
        for r in t['rows']: add('MCSR', r[2], r[0], r[1])
p = pathlib.Path('js/refdata.js'); s = p.read_text()
s = re.sub(r'\nexport const REG_DOCS=.*?;\nexport const REG_LOOKUP=.*?;\n', '\n', s, flags=re.S)
s = s.rstrip('\n') + '\nexport const REG_DOCS=' + json.dumps(docs, ensure_ascii=False) + ';\nexport const REG_LOOKUP=' + json.dumps(rows, ensure_ascii=False) + ';\n'
p.write_text(s)
print(len(docs), 'documents,', len(rows), 'lookup rows')
