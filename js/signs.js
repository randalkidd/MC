// Sign permit review: MCZO Chapter 11 (Dec 10, 2025) limits by sign type and district class, and the computed checks
// for each sign entered on the Sign Details card. Area is one face (identical double faces count once, §1101.3.2).
import { MCZO_URL } from './standards.js?v=74a299e3';

const C = (sec) => `[MCZO §${sec}](${MCZO_URL})`;
// cls: which district classes allow the type; lim[cls] = { area, height }; districts: only these districts (if set).
export const SIGN_TYPES = {
  identification: { label: 'Residence identification', cls: ['res'], lim: { res: { area: 2, height: 8 } }, sec: '1102.2' },
  entry: { label: 'Entry feature over a driveway', cls: ['res'], lim: { res: { area: 24, height: 24 } }, sec: '1102.3', noLight: true },
  subdivision: { label: 'Perimeter wall / subdivision entry sign', cls: ['res'], lim: { res: { area: 32, height: 6 } }, sec: '1102.4' },
  'inst-free': { label: 'Church / school / apartment / public facility — freestanding', cls: ['res'], lim: { res: { area: 48, height: 12 } }, sec: '1102.5', yardOk: true, emdMax: { res: 1 } },
  'inst-wall': { label: 'Church / school / apartment / public facility — wall', cls: ['res'], lim: { res: { area: 48, height: 18 } }, sec: '1102.5', yardOk: true, emdMax: { res: 1 } },
  wall: { label: 'Wall / parapet / awning / projecting sign', cls: ['com', 'ind'], lim: { com: { height: 20 }, ind: { height: 20 } }, sec: '1103.2.1 / 1104.2.1', aggregate: true },
  perimeter: { label: 'Perimeter wall sign (commercial / industrial)', cls: ['com', 'ind'], lim: { com: { area: 120 }, ind: { area: 120 } }, sec: '1103.2.1.3 / 1104.2.1.3', aggregate: true },
  freestanding: { label: 'Freestanding / monument / center identification', cls: ['com', 'ind'], lim: { com: { area: 120, height: 24 }, ind: { area: 150, height: 24 } }, sec: '1103.2.3 / 1104.2.2', nearRes: true },
  canopy: { label: 'Fuel canopy sign (one side)', cls: ['com'], lim: { com: { area: 24 } }, sec: '1103.2.2', aggregate: true },
  menu: { label: 'Drive-thru menu board', cls: ['com'], lim: { com: { area: 32, height: 7 } }, sec: '1103.2.4' },
  pylon: { label: 'Freeway pylon', cls: ['com'], districts: ['C-S', 'C-2'], lim: { com: { height: 65 } }, sec: '1103.2.5', setback: 20, emdMax: { com: 3 } },
  aframe: { label: 'A-frame (sandwich board)', cls: ['com'], districts: ['C-1', 'C-2', 'C-S'], lim: { com: { area: 12 } }, sec: '1103.2.6', noLight: true },
  directional: { label: 'Directional', cls: ['res', 'com', 'ind'], lim: { res: { area: 2, height: 8 }, com: { area: 6, height: 12 }, ind: { area: 6, height: 12 } }, sec: '1101.3.12', yardOk: true },
  directory: { label: 'Directory (monument)', cls: ['res', 'com', 'ind'], lim: { res: { area: 18, height: 6 }, com: { area: 18, height: 6 }, ind: { area: 18, height: 6 } }, sec: '1101.3.11' },
  banner: { label: 'Light pole banner', cls: ['res', 'com', 'ind'], lim: { res: { area: 18, height: 18 }, com: { area: 18, height: 18 }, ind: { area: 18, height: 18 } }, sec: '1101.3.13' },
  temp: { label: 'Temporary sign (other)', cls: ['res', 'com', 'ind'], lim: { res: { area: 18, height: 12 }, com: { height: 12 }, ind: { height: 12 } }, sec: '1101.4.1', noLight: true, temp: true },
  'temp-dir': { label: 'Temporary directional', cls: ['res', 'com', 'ind'], lim: { res: { area: 12, height: 12 }, com: { area: 12, height: 12 }, ind: { area: 12, height: 12 } }, sec: '1101.4.5', noLight: true, temp: true, yardOk: true },
  'temp-sale': { label: 'Temporary — sale or lease of land', cls: ['res', 'com', 'ind'], lim: { res: { height: 12 }, com: { height: 12 }, ind: { height: 12 } }, sec: '1101.4.6', noLight: true, temp: true, saleArea: true },
  'temp-contractor': { label: 'Temporary — contractors / subcontractors', cls: ['res', 'com', 'ind'], lim: { res: { area: 24, height: 12 }, com: { area: 24, height: 12 }, ind: { area: 24, height: 12 } }, sec: '1101.4.7', noLight: true, temp: true, yardOk: true },
  billboard: { label: 'Off-site advertising (billboard)', cls: ['com', 'ind'], districts: ['C-2', 'C-3', 'IND-1', 'IND-2', 'IND-3'], lim: {}, sec: '1103.3 / 1104.3', billboard: true },
  roof: { label: 'Roof sign', cls: [], lim: {}, sec: '1101.3.7' },
};
export const LIT = [['none', 'Not lit'], ['external', 'External light'], ['internal', 'Internal / neon'], ['emd1', 'EMD level 1'], ['emd2', 'EMD level 2'], ['emd3', 'EMD level 3'], ['emd4', 'EMD level 4 (full animation)']];
// EMD levels allowed on on-site signs by district (§1103.1.3, §1104.1.4, §1102.5.3).
const EMD_BY_DISTRICT = { 'C-1': 2, 'C-O': 2, 'C-2': 3, 'C-3': 3, 'C-S': 4, 'IND-1': 3, 'IND-2': 3, 'IND-3': 3 };

export const blankSign = (n = 1) => ({ name: `Sign ${n}`, type: '', area: '', height: '', lit: 'none', row: '', yard: false });
export const blankSignCtx = () => ({ face: '', resDist: '', frontages: '', driveways: '', dwellings: '', freeway300: false, scenic: '' });

const num = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);

// Sale/lease sign area by land area (§1101.4.6.1): < 1 ac 6 sf; 1–5 ac 12 sf; > 5 ac 32 sf + 15% per additional 5 ac, max 150 sf.
function saleMax(acres) {
  if (acres == null) return null;
  if (acres < 1) return 6; if (acres <= 5) return 12;
  return Math.min(150, Math.round(32 * (1 + 0.15 * Math.floor((acres - 5) / 5)) * 10) / 10);
}
// Freestanding height near a Rural/Residential zone (§1103.2.3.2 / §1104.2.2.2): 12 ft within 200 ft, +1 ft per 5 ft beyond, max 24.
const nearResHeight = (dist) => (dist == null ? null : dist <= 200 ? 12 : Math.min(24, 12 + Math.floor((dist - 200) / 5)));

export function signFindings(s, key, d) {
  const F = []; const cls = d ? d.family : null;
  const push = (loc, item, shows, req, cite, ok, fix) => F.push({ loc, item, shows, req, cite, status: ok === null ? 'verify' : ok ? 'ok' : 'deficient', fix: ok ? '—' : fix });
  const signs = (s.signs || []).filter(x => x.type || num(x.area) != null || num(x.height) != null);
  const ctx = s.signCtx || blankSignCtx();
  if (!signs.length) { F.push({ loc: 'Sign plan', item: 'Signs proposed', shows: 'none entered', req: 'Each sign listed with type, area, height, illumination and setback', cite: C('1101'), status: 'verify', fix: 'List every proposed sign (type, area of one face, overall height, illumination, setback to the property line/ROW).' }); return F; }
  if (!cls) return F;
  const want = s.type === 'sign-res' ? 'res' : 'com/ind';
  if ((want === 'res') !== (cls === 'res')) F.push({ loc: 'Submittal', item: 'Sign permit type vs. zoning district', shows: `${s.type === 'sign-res' ? 'Residential / rural' : 'Commercial / industrial'} sign permit in ${key}`, req: `A ${cls === 'res' ? 'residential / rural' : 'commercial / industrial'} sign permit for ${key}`, cite: C(cls === 'res' ? '1102' : cls === 'ind' ? '1104' : '1103'), status: 'verify', fix: `Switch the submittal type to the ${cls === 'res' ? 'residential / rural' : 'commercial / industrial'} sign permit (the district is ${key}).` });
  const acres = num(s.lotArea) != null ? num(s.lotArea) / 43560 : null;
  for (const x of signs) {
    const T = SIGN_TYPES[x.type]; const nm = x.name || 'Sign'; const loc = `Sign — ${nm}`;
    const area = num(x.area), h = num(x.height), row = num(x.row);
    if (!T) { push(loc, `${nm}: sign type`, 'not selected', 'A sign type permitted by Chapter 11', C('1101.4.8'), null, 'Identify the sign type; any sign not specifically listed as permitted is prohibited (§1101.4.8).'); continue; }
    if (x.type === 'roof') { push(loc, `${nm}: roof sign`, 'Roof sign', 'Not permitted in any district', C('1101.3.7'), false, 'Remove the roof sign; relocate it as a wall/parapet sign within the wall-sign allowance.'); continue; }
    const allowedCls = T.cls.includes(cls) && (!T.districts || T.districts.includes(key));
    push(loc, `${nm}: ${T.label} permitted in ${key}`, T.label, T.districts ? `Only in ${T.districts.join(', ')}` : `Permitted in ${T.cls.map(c => ({ res: 'Rural/Residential', com: 'Commercial', ind: 'Industrial' })[c]).join(' / ')} districts`, C(T.sec), allowedCls, `This sign type is not permitted in ${key} (§${T.sec}; §1101.4.8) — remove it or change it to a permitted type.`);
    if (!allowedCls) continue;
    const lim = T.lim[cls] || {};
    // Area
    let maxA = lim.area ?? null;
    if (T.saleArea) maxA = saleMax(acres);
    if (maxA != null) push(loc, `${nm}: sign area`, area == null ? 'not shown' : `${area} sf`, `≤ ${maxA} sf${T.saleArea ? ` (${acres != null ? acres.toFixed(2) : '?'} ac of land)` : ''}`, C(T.sec), area == null ? false : area <= maxA, area == null ? 'Dimension the sign face and state its area.' : `Reduce the sign area to ≤ ${maxA} sf.`);
    else if (T.temp && cls !== 'res') push(loc, `${nm}: temporary sign area`, area == null ? 'not shown' : `${area} sf`, 'Within the permanent wall/freestanding allowance', C('1101.4.1'), null, 'Confirm the temporary sign stays within the area allowed for permanent wall or freestanding signs, and that it is tied to a temporary event (TUP) or a pending permanent sign permit.');
    if (T.saleArea && maxA != null && area != null && area > 32) push(loc, `${nm}: sale/lease sign over 32 sf`, `${area} sf`, 'Construction permit and zoning clearance', C('1101.4.6'), null, 'A sale/lease sign over 32 sf needs a construction permit and zoning clearance.');
    // Height
    let maxH = lim.height ?? null; let hNote = '';
    if (T.nearRes) { const r = nearResHeight(num(ctx.resDist)); if (r != null) { maxH = Math.min(maxH, r); hNote = ` (${num(ctx.resDist)} ft from a Rural/Residential zone)`; } else push(loc, `${nm}: distance to a Rural/Residential zone`, 'not entered', 'Needed for the freestanding height limit', C(T.sec), null, 'Enter the distance to the nearest Rural/Residential zone or mobile home subdivision: within 200 ft the limit is 12 ft, +1 ft per 5 ft beyond, to 24 ft.'); }
    if (x.type === 'billboard') { maxH = ctx.freeway300 ? 48 : 30; maxA = ctx.freeway300 ? 672 : 300; push(loc, `${nm}: billboard face area`, area == null ? 'not shown' : `${area} sf`, `≤ ${maxA} sf per face (+${ctx.freeway300 ? 20 : 10}% embellishments)`, C('1103.3.1.6'), area == null ? false : area <= maxA * (ctx.freeway300 ? 1.2 : 1.1), `Reduce the face to ≤ ${maxA} sf.`); hNote = ctx.freeway300 ? ' (within 300 ft of a freeway travel lane)' : ' (not within 300 ft of a freeway)'; }
    if (ctx.scenic === 'wickenburg') maxH = Math.min(maxH ?? 12, 12);
    if (maxH != null) push(loc, `${nm}: sign height`, h == null ? 'not shown' : `${h} ft`, `≤ ${maxH} ft${hNote}`, C(T.sec), h == null ? false : h <= maxH, h == null ? 'Show the overall height from grade on the elevation.' : `Reduce the overall height to ≤ ${maxH} ft.`);
    // Location: ROW / required yard / property-line setback
    if (row == null) push(loc, `${nm}: setback to property line / ROW`, 'not shown', 'Outside the ROW, clear zone and sight triangle', C('1101.3.5'), null, 'Dimension the sign from the property line/right-of-way and show it outside the sight visibility triangle and clear zone.');
    else if (row <= 0) push(loc, `${nm}: located in the right-of-way`, `${row} ft`, 'Not in or projecting into the ROW, street or alley', C('1101.3.5'), false, 'Move the sign entirely onto the property, out of the right-of-way, clear zone and sight visibility triangle.');
    if (T.setback && row != null) push(loc, `${nm}: base setback from property lines`, `${row} ft`, `≥ ${T.setback} ft`, C(T.sec), row >= T.setback, `Set the pylon base ≥ ${T.setback} ft from every property line, with a 4 ft landscape area around it.`);
    if (ctx.scenic === 'wickenburg' && h != null && row != null) { const need = h <= 8 ? 0 : h <= 10 ? 15 : 20; push(loc, `${nm}: Wickenburg Scenic Corridor setback`, `${row} ft`, `≥ ${need} ft for a ${h} ft sign`, C('1105.1'), row >= need, `Set the sign ≥ ${need} ft back from the property line (or lower it).`); }
    if (cls === 'res' && x.yard && !T.yardOk) push(loc, `${nm}: in a required yard`, 'In a required yard', 'Not in or projecting into any required yard', C('1102.1'), false, 'Move the sign out of the required yards (only institutional, directional, temporary directional and contractor signs may be in a required yard).');
    // Lighting
    const lit = x.lit || 'none'; const emd = /^emd(\d)$/.exec(lit); const emdL = emd ? +emd[1] : 0;
    if (lit !== 'none' && (T.noLight || T.temp)) push(loc, `${nm}: illumination`, LIT.find(l => l[0] === lit)[1], 'Not illuminated', C(T.temp ? '1101.4.2' : T.sec), false, 'This sign may not be illuminated — remove the lighting.');
    else if (emdL) {
      const max = cls === 'res' ? (T.emdMax && T.emdMax.res) || 0 : T.emdMax && T.emdMax[cls] != null ? Math.min(T.emdMax[cls], EMD_BY_DISTRICT[key] || 0) : (EMD_BY_DISTRICT[key] || 0);
      push(loc, `${nm}: electronic message display level`, `Level ${emdL}`, max ? `Level ${max} or lower in ${key}` : `No EMD in ${key} for this sign`, C(cls === 'res' ? '1102.5.3' : cls === 'ind' ? '1104.1.4' : '1103.1.3'), emdL <= max, max ? `Limit the display to EMD level ${max}.` : 'Remove the electronic message display.');
      push(loc, `${nm}: EMD controls`, `Level ${emdL}`, 'Photo sensor + auto-dimming; ≤ 300 nits dusk–dawn; ≤ 0.3 fc over ambient; message ≥ 8 s; no flashing', C('1101.3.3–1101.3.8'), null, 'Provide the EMD specification sheet showing the photo sensor and dimming, ≤ 300 nits dusk to dawn, ≤ 0.3 fc above ambient, and a minimum 8-second message hold.');
      if (emdL === 4) push(loc, `${nm}: level 4 EMD orientation`, 'Level 4', 'Oriented to pedestrians/parking, not to any street', C('1103.1.2'), null, 'Show that the level 4 display faces common parking, courtyards or pedestrian ways and not a street frontage.');
    } else if (lit !== 'none') push(loc, `${nm}: illumination`, LIT.find(l => l[0] === lit)[1], cls === 'res' ? 'Off 10 PM–6 AM; no flashing; no glare; light source not visible from residential' : 'No flashing; no glare onto streets or neighbors; external source not visible from a residential district', C('1101.3.3'), null, `Note the lighting details on the plan${cls === 'res' ? ' (timer: unlit 10 PM–6 AM)' : ''}, and show shielding so there is no glare and the light source isn't visible from residential property.`);
  }
  // Aggregates
  const of = (t) => signs.filter(x => x.type === t);
  if (cls === 'com' || cls === 'ind') {
    const wall = signs.filter(x => SIGN_TYPES[x.type] && SIGN_TYPES[x.type].aggregate);
    if (wall.length) {
      const tot = wall.reduce((t, x) => t + (num(x.area) || 0), 0); const face = num(ctx.face);
      push('Sign plan — building', 'Wall signs: total area vs. front face plane', face ? `${tot} sf ÷ ${face} sf = ${(tot / face * 100).toFixed(1)}%` : `${tot} sf; front face plane area not entered`, '≤ 15% of the front face plane', C(cls === 'ind' ? '1104.2.1' : '1103.2.1'), face ? tot <= face * 0.15 : null, face ? `Reduce total wall signage by ${Math.ceil(tot - face * 0.15)} sf (to ≤ ${Math.floor(face * 0.15)} sf).` : 'Show the front face plane (ground to top of parapet or eave line) dimensions so the 15% limit can be checked.');
    }
    const fs = of('freestanding'); const dw = num(ctx.driveways), fr = num(ctx.frontages);
    if (fs.length) {
      const max = cls === 'com' ? Math.min(dw ?? Infinity, fr != null ? fr * 2 : Infinity) : (dw ?? Infinity);
      push('Sign plan — site', 'Number of freestanding signs', `${fs.length}`, isFinite(max) ? `≤ ${max} (one per driveway${cls === 'com' ? ', max two per street frontage' : ''})` : 'One per driveway', C(cls === 'ind' ? '1104.2.2' : '1103.2.3'), isFinite(max) ? fs.length <= max : null, isFinite(max) ? `Reduce to ${max} freestanding sign${max === 1 ? '' : 's'}.` : 'Enter the number of driveways and street frontages so the freestanding sign count can be checked.');
      if (cls === 'ind' && fs.length > 1) push('Sign plan — site', 'Freestanding sign spacing', `${fs.length} signs`, '≥ 200 ft apart, each near a driveway entrance', C('1104.2.2'), null, 'Dimension the distance between freestanding signs (≥ 200 ft) and show each near a driveway entrance.');
    }
    const menus = of('menu'); if (menus.length > 4) push('Sign plan — site', 'Number of menu boards', `${menus.length}`, '≤ 2 preview + 2 ordering', C('1103.2.4'), false, 'Reduce to two preview and two ordering menu boards.');
    if (menus.length) push('Sign plan — site', 'Menu boards screened; speakers ≥ 200 ft from Rural/Residential', `${menus.length} menu board(s)`, 'Screened from the street; speaker boards ≥ 200 ft from a Rural/Residential zone', C('1103.2.4'), num(ctx.resDist) != null && num(ctx.resDist) < 200 ? null : null, 'Show the screening wall/landscaping and the speaker distance to the nearest Rural/Residential zone (≥ 200 ft unless soundproofing is approved).');
    if (of('canopy').length > 2) push('Sign plan — canopy', 'Number of canopy signs', `${of('canopy').length}`, '≤ 2 per canopy', C('1103.2.2'), false, 'Limit the canopy to two signs.');
    if (of('aframe').length > 1) push('Sign plan — site', 'A-frame signs', `${of('aframe').length}`, '1 per business/tenant; ≤ 2 ft from the building; zoning clearance', C('1103.2.6'), null, 'Confirm one A-frame per business, within 2 ft of the building wall, on private sidewalk, removed at close of business.');
    if (of('billboard').length) push('Sign plan — billboard', 'Billboard separation and setbacks', `${of('billboard').length} billboard(s)`, '1,000 ft (≤ 3 mi of a city/town) or 3,000 ft between billboards; ≥ 100 ft from residential (150 ft if lit/digital); ≥ 500 ft from parks/schools/rest areas; not within 660 ft of a Scenic Corridor Overlay', `${C('1103.3.1')}; DD-3002-01; DD-3003-01; DD-3004-01`, null, 'Provide a radius map showing separation from other billboards, distances to residential zoning/uses, parks, schools, rest areas and scenic corridors, and the military overlay UCCD if applicable.');
  } else if (cls === 'res') {
    const ids = of('identification'); const du = num(ctx.dwellings) ?? 1;
    if (ids.length) push('Sign plan — site', 'Number of identification signs', `${ids.length}`, `≤ ${du} (one per dwelling unit)`, C('1102.2'), ids.length <= du, `Limit identification signs to one per dwelling unit (${du}).`);
    if (of('entry').length > 1) push('Sign plan — site', 'Entry features', `${of('entry').length}`, 'One per parcel, over a driveway', C('1102.3'), false, 'Limit to one entry feature per parcel.');
    if (of('entry').length) push('Sign plan — entry feature', 'Entry feature dimensions', `${of('entry').length} entry feature`, '≤ 24 ft high, ≤ 30 ft wide, supports ≤ 3 ft; opening ≥ 12 ft wide × 16 ft high; sign within the frame', C('1102.3'), null, 'Dimension the entry feature: max 24 ft high and 30 ft wide, supports ≤ 3 ft, clear opening ≥ 12 ft × 16 ft, sign (≤ 24 sf) within the frame, no lighting.');
    const perm = signs.filter(x => x.type && x.type !== 'identification' && !(SIGN_TYPES[x.type] && SIGN_TYPES[x.type].temp && x.type !== 'temp-sale'));
    if (perm.length) push('Sign plan', 'Construction permit and zoning clearance', `${perm.length} permanent sign(s)`, 'Required for permanent signs other than residence identification', C('1101.3.9'), null, 'Confirm the construction permit and zoning clearance are part of this application.');
  }
  if (ctx.scenic === 'hwy74') push('Sign plan — overlay', 'Highway 74 Scenic Corridor', 'In the corridor', '≤ 2 monument signs per development entrance; none on an individual single-family lot; durable, consistent with the architecture', C('1105.2'), null, 'Confirm the signs meet the Highway 74 Scenic Corridor standards.');
  if (ctx.scenic === 'wickenburg' && signs.filter(x => ['freestanding', 'inst-free', 'directory'].includes(x.type)).length > 1) push('Sign plan — overlay', 'Wickenburg Scenic Corridor: freestanding signs', `${signs.filter(x => ['freestanding', 'inst-free', 'directory'].includes(x.type)).length}`, 'One freestanding sign; muted desert colors, ≤ 3 colors', C('1105.1'), false, 'Limit to one freestanding sign, in muted desert-compatible colors (≤ 3, one matching the building).');
  if (ctx.scenic === 'carefree') push('Sign plan — overlay', 'Carefree Highway Scenic Corridor', 'In the corridor', 'Per DD-3013-01', '[DD-3013-01](https://www.maricopa.gov/6475/Carefree-Highway-Scenic-Corridor---DD-30)', null, 'Review the signs against DD-3013-01 (Carefree Highway Scenic Corridor).');
  return F;
}
