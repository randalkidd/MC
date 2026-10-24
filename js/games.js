// Behind the Curtains — game center. MCTrained: 10-question multiple-choice rounds built from the site's own reference data
// (MCZO Ch. 5 tables, Local Additions & Addenda, department directives) plus quick setback / coverage scenarios computed
// from the same tables, so every answer key comes from the data the site already uses. Scores go through the relay.
import { DISTRICTS, MCZO_URL } from './standards.js?v=cccb7524';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const uniq = (a) => [...new Set(a)];
const fmt = (n) => Number(n).toLocaleString('en-US');
const RES = Object.keys(DISTRICTS).filter(k => DISTRICTS[k].family === 'res');
const ALL = Object.keys(DISTRICTS);
const LAA_URL = 'https://www.maricopa.gov/Archive.aspx?ADID=6309';

// Build a question: four distinct options, one correct.
function q(cat, prompt, correct, wrong, explain, cite, url) {
  const opts = shuffle(uniq([correct, ...shuffle(uniq(wrong.filter(w => w !== correct))).slice(0, 3)]));
  if (opts.length < 3) return null;
  return { cat, prompt, options: opts, answer: opts.indexOf(correct), explain, cite, url };
}

// ---- MCZO development standards (§502 / §504 / §506) ----
const FIELDS = [
  ['front', 'minimum front setback', (v) => `${v} ft`],
  ['rear', 'minimum rear setback', (v) => `${v} ft`],
  ['side', 'minimum interior side setback', (v) => `${v} ft`],
  ['street', 'minimum side-street setback', (v) => `${v} ft`],
  ['height', 'maximum building height', (v) => `${v} ft`],
  ['cov', 'maximum lot coverage', (v) => `${v}%`],
  ['area', 'minimum lot area', (v) => `${fmt(v)} sq ft`],
  ['width', 'minimum lot width', (v) => `${v} ft`],
];
function qMczo() {
  for (let tries = 0; tries < 20; tries++) {
    const k = pick(ALL), d = DISTRICTS[k]; const [f, label, show] = pick(FIELDS);
    const v = d[f]; if (v == null) continue;
    const others = uniq(ALL.map(x => DISTRICTS[x][f]).filter(x => x != null && x !== v));
    if (others.length < 3) continue;
    const subject = ['area', 'width', 'cov'].includes(f) ? `in the ${k} district` : `for a primary building in the ${k} district`;
    const res = q('MCZO', `Under the MCZO (Dec 10, 2025), what is the ${label} ${subject}?`, show(v), others.map(show),
      `${k}: ${label} ${show(v)}.`, `MCZO Ch. 5 §${d.section}`, MCZO_URL);
    if (res) return res;
  }
  return null;
}
// ---- Quick scenarios (computed from the same tables) ----
function qScenario() {
  const kind = pick(['side', 'rear', 'front', 'cov', 'acc', 'height']);
  const k = pick(RES), d = DISTRICTS[k];
  if (kind === 'cov') {
    const area = d.area >= 20000 ? pick([20000, 43560, d.area]) : pick([d.area, d.area + 2000, 10000]);
    const pct = d.cov + pick([-8, -3, 2, 6]);
    const covered = Math.round(area * pct / 100);
    const ok = pct <= d.cov;
    return q('Scenario', `A ${fmt(area)} sq ft lot zoned ${k} has ${fmt(covered)} sq ft of covered structures (all solid roofs). Does it meet the MCZO lot-coverage limit?`,
      ok ? `Yes — about ${pct}%, within the ${d.cov}% maximum` : `No — about ${pct}% exceeds the ${d.cov}% maximum`,
      [ok ? `No — about ${pct}% exceeds the ${d.cov}% maximum` : `Yes — about ${pct}%, within the ${d.cov}% maximum`, `Yes — coverage limits don't apply to residences`, `No — the maximum in ${k} is ${d.cov - 10}%`, `Yes — the maximum in ${k} is ${d.cov + 10}%`],
      `${fmt(covered)} ÷ ${fmt(area)} ≈ ${pct}%; ${k} allows ${d.cov}% (DD-2021-01 method).`, `MCZO §${d.section}; DD-2021-01`, MCZO_URL);
  }
  if (kind === 'acc') {
    const dist = pick([1, 2, 3, 4, 5]); const ok = dist >= 3;
    return q('Scenario', `A new detached storage shed (not an ADU) in ${k} sits ${dist} ft from the rear lot line. Does it meet the accessory-structure setback?`,
      ok ? 'Yes — accessory structures need at least 3 ft from rear and side lot lines' : 'No — it needs at least 3 ft from the rear lot line',
      [ok ? 'No — it needs at least 3 ft from the rear lot line' : 'Yes — accessory structures need at least 3 ft from rear and side lot lines', `No — it needs the full ${d.rear} ft rear setback`, 'Yes — sheds have no setback requirement', 'No — it needs at least 10 ft'],
      `Detached accessory structures: 3 ft from rear and interior side lot lines (5 ft for a detached ADU); ${dist} ft ${ok ? 'complies' : 'does not'}.`, 'MCZO §806.2; DD-3012-01', 'https://www.maricopa.gov/6353/Accessory-Structures-Equipment-and-Setba');
  }
  if (kind === 'height') {
    const h = d.height + pick([-5, -2, 3, 5]); const ok = h <= d.height;
    return q('Scenario', `A proposed house in ${k} is ${h} ft tall. Does it meet the MCZO height limit?`,
      ok ? `Yes — the maximum is ${d.height} ft` : `No — the maximum is ${d.height} ft`,
      [ok ? `No — the maximum is ${d.height} ft` : `Yes — the maximum is ${d.height} ft`, `No — the maximum is ${d.height - 10} ft`, `Yes — the maximum is ${d.height + 15} ft`, 'Yes — there is no height limit for single-family homes'],
      `${k} maximum building height: ${d.height} ft.`, `MCZO Ch. 5 §${d.section}`, MCZO_URL);
  }
  const need = d[kind]; if (need == null) return qMczo();
  const label = { side: 'interior side', rear: 'rear', front: 'front' }[kind];
  const shown = Math.max(1, need + pick([-3, -1, 0, 2, 5]));
  const ok = shown >= need;
  return q('Scenario', `A new residence in ${k} is ${shown} ft from the ${label} lot line. Does it meet the MCZO ${label} setback?`,
    ok ? `Yes — the minimum is ${need} ft` : `No — the minimum is ${need} ft`,
    [ok ? `No — the minimum is ${need} ft` : `Yes — the minimum is ${need} ft`, `No — the minimum is ${need + 10} ft`, `Yes — the minimum is ${Math.max(0, need - 5)} ft`, `No — the minimum is ${need * 2} ft`],
    `${k} ${label} setback for the primary building: ${need} ft${kind === 'front' ? ' (a recorded plat or RUPD may set a different figure)' : ''}.`, `MCZO Ch. 5 §${d.section}`, MCZO_URL);
}
// ---- Department directives ----
function qDirective(dirs) {
  const ok = dirs.filter(x => /— DD-\d{4}-\d{2}$/.test(x.t));
  if (ok.length < 4) return null;
  const x = pick(ok); const [, title, dd] = x.t.match(/^(.*) — (DD-\d{4}-\d{2})$/);
  const others = ok.filter(y => y !== x).map(y => y.t.match(/^(.*) — (DD-\d{4}-\d{2})$/));
  if (Math.random() < 0.5) return q('Directives', `Which department directive covers “${title}”?`, dd, others.map(m => m[2]), `${dd}: ${title}.`, dd, x.u);
  return q('Directives', `What is ${dd} about?`, title, others.map(m => m[1]), `${dd}: ${title}.`, dd, x.u);
}
// ---- Local Additions & Addenda (and other county codes) ----
const short = (s) => (s.length > 150 ? `${s.slice(0, 147).replace(/\s+\S*$/, '')}…` : s).replace(/ — use: .*$/, '');
function qLaa(regs) {
  const laa = regs.filter(r => r.d === 'LA&A' && r.r && short(r.r).length >= 30 && !/^see |crossover row|^\(reserved\)/i.test(r.r));
  if (laa.length < 4) return null;
  const x = pick(laa); const others = laa.filter(y => y.t !== x.t).map(y => short(y.r));
  return q('LA&A', `In the Local Additions & Addenda, what does ${x.s} (${x.t}) provide?`, short(x.r), others, `${x.s} — ${x.t}: ${short(x.r)}`, `LA&A ${x.s}`, x.u || LAA_URL);
}

export const CATS = [['mixed', 'Mixed'], ['MCZO', 'MCZO standards'], ['LA&A', 'LA&A'], ['Directives', 'Directives'], ['Scenario', 'Quick scenarios']];
export async function buildRound(cat = 'mixed', n = 10) {
  const ref = await import('./refdata.js?v=cccb7524');
  const gens = { MCZO: qMczo, Scenario: qScenario, Directives: () => qDirective(ref.DIRECTIVES), 'LA&A': () => qLaa(ref.REG_LOOKUP) };
  const order = cat === 'mixed' ? ['MCZO', 'Scenario', 'Directives', 'LA&A'] : [cat];
  const out = []; const seen = new Set(); let guard = 0;
  while (out.length < n && guard++ < 400) {
    const g = gens[order[out.length % order.length]] || qMczo; const x = g();
    if (x && !seen.has(x.prompt)) { seen.add(x.prompt); out.push(x); }
  }
  return shuffle(out);
}
