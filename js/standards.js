// MCZO development standards — Maricopa County Zoning Ordinance, Dec 10, 2025 revision (effective Jan 9, 2026).
// Source: MCZO Ch. 5 §502 (p. 5-3), §504 (p. 5-10), §506 (p. 5-14). Accessory rules: §806, Art. 602.3, Art. 811.6.
// Values are minimums (setbacks, area, width) or maximums (coverage, height). null = none required / not applicable.

export const MCZO_EDITION = 'MCZO Dec 10, 2025 (effective 1/9/2026)';
export const MCZO_URL = 'https://www.maricopa.gov/DocumentCenter/View/4785/P-18---Zoning-Ordinance-PDF?bidId=';

const res = (area, perDU, width, cov, front, frontGarage, street, side, rear, height, accFront, accStreet) => ({
  section: '502', family: 'res', area, perDU, width, cov, front, frontGarage, street, side, rear, height,
  acc: { front: accFront, street: accStreet, side: 3, rear: 3, height: 'same as primary', yardCov: 30 },
});

export const DISTRICTS = {
  'RU-190': res(190000, null, 300, 10, 60, null, 30, 30, 60, 35, 60, 30),
  'RU-70':  res(70000,  null, 250, 15, 60, null, 30, 30, 60, 35, 60, 30),
  'RU-43':  res(43560,  null, 145, 25, 40, null, 20, 20, 40, 35, 40, 20),
  'R1-35':  res(35000,  null, 145, 30, 40, null, 20, 20, 40, 35, 40, 20),
  'R1-18':  res(18000,  null, 120, 35, 10, 18,   10, 10, 30, 35, 10, 15),
  'R1-10':  res(10000,  null, 80,  40, 10, 18,   10, 7,  25, 35, 10, 10),
  'R1-8':   res(8000,   null, 80,  45, 10, 18,   10, 7,  25, 35, 10, 10),
  'R1-7':   res(7000,   null, 70,  45, 10, 18,   10, 5,  25, 35, 10, 10),
  'R1-6':   res(6000,   null, 60,  50, 10, 18,   10, 5,  25, 35, 10, 10),
  'R-2':    res(6000,   4000, 60,  60, 10, null, 10, 5,  25, 35, 10, 10),
  'R-3':    res(6000,   3000, 60,  60, 10, null, 10, 5,  25, 40, 10, 10),
  'R-4':    res(6000,   2000, 60,  60, 10, null, 10, 5,  25, 40, 10, 10),
  'R-5':    res(6000,   1000, 60,  60, 10, null, 10, 5,  25, 40, 10, 10),
  'C-O': { section: '504', family: 'com', area: 12000, width: 60, cov: 35, front: 10, street: 15, side: 5, rear: 5, height: 30,
           notes: ['Within 20 ft of a Rural/Residential district, no building over 15 ft.'] },
  'C-S': { section: '504', family: 'com', area: 217800, width: null, cov: 25, front: 10, street: 50, side: 50, rear: 50, height: 40,
           notes: ['Minimum site 5 acres.'] },
  'C-1': { section: '504', family: 'com', area: 6000, width: 60, cov: 60, front: 10, street: 15, side: null, sideAdjRes: 10, rear: null, rearAdjRes: 25, height: 40 },
  'C-2': { section: '504', family: 'com', area: 6000, width: 60, cov: 60, front: 10, street: 10, side: null, sideAdjRes: 10, rear: null, rearAdjRes: 25, height: 40 },
  'C-3': { section: '504', family: 'com', area: 6000, width: 60, cov: 60, front: 10, street: 10, side: null, sideAdjRes: 10, rear: null, rearAdjRes: 25, height: 40 },
  'IND-1': { section: '506', family: 'ind', area: 35000, width: 150, cov: 60, front: 20, street: 10, side: null, sideAdjRes: 10, rear: 10, height: 60 },
  'IND-2': { section: '506', family: 'ind', area: 6000, width: 60, cov: 60, front: 20, street: 10, side: null, sideAdjRes: 10, rear: 10, rearAdjRes: 25, height: 60 },
  'IND-3': { section: '506', family: 'ind', area: 6000, width: 60, cov: 60, front: 20, street: 10, side: null, sideAdjRes: 10, rear: 10, rearAdjRes: 25, height: 60 },
};

// GIS "Zone" values often carry suffixes/aliases (e.g. "R1-6 RUPD", "RURAL-43", "R-4"). Map to a table key.
export function normalizeDistrict(zone) {
  if (!zone) return null;
  let z = String(zone).toUpperCase().trim();
  z = z.replace(/^RURAL\s*\(\s*R?U?\s*-?\s*(\d+)\s*\)/, 'RU-$1');
  z = z.replace(/RURAL[-\s]?/, 'RU-').replace(/^RU(\d)/, 'RU-$1');
  z = z.replace(/^IND\s?-?\s?(\d)/, 'IND-$1').replace(/^C\s?-?\s?(O|S|\d)/, 'C-$1');
  z = z.replace(/^R\s?1\s?-\s?(\d+)/, 'R1-$1').replace(/^R\s?-\s?(\d)\b/, 'R-$1');
  const key = Object.keys(DISTRICTS).sort((a, b) => b.length - a.length).find(k => z.startsWith(k));
  return key || null;
}

export function overlaySuffixes(zone) {
  const z = String(zone || '').toUpperCase();
  return ['RUPD', 'CUPD', 'IUPD', 'UPD', 'PAD', 'SC', 'SCO', 'HD', 'MAO'].filter(s => new RegExp(`\\b${s}\\b`).test(z));
}

export const ACCESSORY_RULES = [
  'Detached accessory buildings may be in the required rear/side yard but may cover no more than 30% of any required yard and must be ≥ 3 ft from side/rear lot lines (MCZO §806.2).',
  'Not permitted in the street-side yard of a corner lot; alley-entered garage ≥ 10 ft from the alley line (§806.2).',
  'Detached ADUs: ≥ 5 ft from property lines within rear/side setbacks, max 18 ft height there (Art. 602.3).',
  'Accessory height may not exceed the district principal-building height (Art. 811.6).',
  'Tanks ≥ 250 gal or structures ≥ 3½ ft tall are treated as accessory buildings; equipment (HVAC, pumps) has no zoning setback (DD-3012-01).',
  'Zoning Clearance not required for non-habitable 1-story accessory ≤ 200 sf, or fences/walls ≤ 8 ft (with exceptions) (Art. 1204.4; DD-3012-01).',
];

export const SEPTIC_SAMPLE_SETBACKS = [
  ['Building', '10 ft'], ['Driveway', '5 ft'], ['Easements', '5 ft'],
  ['Property line', '50 ft (5 ft if public water service)'], ['Wash', '50 ft'], ['Well', '100 ft'],
];
