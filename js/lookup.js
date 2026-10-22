// Parcel lookup — ports reference/workflow-standards.md to in-browser REST calls.
import { arcgis, request } from './net.js?v=91553d78';

const GIS = 'https://gis.maricopa.gov/arcgis/rest/services';
export const EP = {
  parcel: `${GIS}/IndividualService/Parcel/MapServer/1`,
  subdivision: `${GIS}/IndividualService/Parcel/MapServer/0`,
  city: `${GIS}/IndividualService/City/MapServer/0`,
  trs: `${GIS}/IndividualService/TownshipRangeSection/MapServer/2`,
  plannet: `${GIS}/PND/PlanNet/MapServer`,
  floodEff: 'https://gis.maricopa.gov/flood/rest/services/FEMA/FloodplainEffective/MapServer/0',
  floodPre: 'https://gis.maricopa.gov/flood/rest/services/FEMA/FloodplainPreliminary/MapServer/0',
  elevCert: 'https://gis.maricopa.gov/flood/rest/services/FEMA/ElevationCertificate/MapServer/0',
  rit: 'https://gis.maricopa.gov/dot/rest/services/Maintenance/RoadInformationTool/MapServer',
  tspProj: 'https://gis.maricopa.gov/dot/rest/services/Planning/TransportationSystemPlan2040Project/MapServer',
  tspNeed: 'https://gis.maricopa.gov/dot/rest/services/Planning/TransportationSystemPlan2040Need/MapServer',
  fcdProperty: 'https://gis.maricopa.gov/flood/rest/services/Property/Parcel/MapServer/0',
  recorderApi: 'https://publicapi.recorder.maricopa.gov',
  rightOfWay: 'https://gis.maricopa.gov/dot/rest/services/Property/RightOfWay/MapServer/0',
  septic: 'https://edms.maricopa.gov/env/api/CustomQuery/KeywordSearch',
};

export const LINKS = {
  zoningApp: 'https://experience.arcgis.com/experience/905ef9d0a9b646739d6b4458f7eb2910/',
  plannetViewer: 'https://maricopa.maps.arcgis.com/apps/webappviewer/index.html?id=f4c45e831c9d4a7ba70b0fadb3635f7b',
  rit: 'https://experience.arcgis.com/experience/1481eed4077842098b1174d0c8f23c17',
  flood: 'https://maricopa.maps.arcgis.com/apps/webappviewer/index.html?id=f1fd72bdc75f4b3982e0058f1beba159',
  tsp: 'https://gis.maricopa.gov/TSP2040/',
  septic: 'https://edms.maricopa.gov/env',
  permitCenter: 'https://edms.maricopa.gov/eplpav',
  assessor: 'https://maps.mcassessor.maricopa.gov/',
  mczo: 'https://www.maricopa.gov/DocumentCenter/View/4785/P-18---Zoning-Ordinance-PDF?bidId=',
  recDoc: (n) => `https://recorder.maricopa.gov/recording/document-details.html?recordingNumber=${encodeURIComponent(String(n).replace(/[^0-9A-Za-z-]/g, ''))}&suffix=`,
  recBook: (b, p) => `https://recorder.maricopa.gov/recording/document-search-results.html?mode=book&docketBook=${encodeURIComponent(String(b).replace(/\D/g, ''))}&pageMap=${encodeURIComponent(String(p).replace(/\D/g, ''))}`,
  assessorParcel: (apn) => `https://mcassessor.maricopa.gov/mcs/?q=${encodeURIComponent(String(apn).replace(/[^0-9A-Za-z]/g, ''))}&mod=pd`,
};

const PARCEL_FIELDS = 'APN,APNDash,Book,Map,Item,PropertyFullStreetAddress,PropertyCity,PropertyZipCode,OwnerName,OwnerAddressLine1,OwnerAddressLine2,OwnerCity,OwnerState,OwnerZipCode,OwnerCountry,MCRNumber,DeedNumber,DeedDate,SaleDate,Township,Range,Section,QuarterSection,SubdivisionName,Lot,Block,Tract,PropertyDescription,ElementarySchoolDistrict,HighSchoolDistrict,ParcelValuationYear,FullCashValue,LimitedPropertyValue,LandLegalClassCode,LandLegalClassDescription,ImprovementLegalClassCode,ImprovementLegalClassDescription,ExemptStatus,ExemptDescription,Rental';

// Layer buckets (PlanNet IDs per workflow-standards.md)
export const LAYER_GROUPS = {
  currentCases: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  zoning: [11],
  planning: [21, 22, 23, 24, 25, 26, 27],
  development: [31, 32, 33, 34, 35],
  district: [41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 52, 53, 54, 55],
  natural: [61, 62, 63, 64, 65, 66],
  military: [72, 73, 74, 75, 76, 77, 78, 79, 80],
  historic: [91, 92, 93, 94, 95, 96, 97, 98, 99, 100],
};
export const OVERLAY_ROWS = [
  [7, 'Zoning Overlay (combined PAD/UPD/SC)'], [23, 'Scenic Corridor'],
  [26, 'Gateway Airport Planning Area'], [27, 'Gateway Airport Noise Contour'], [33, 'Native American Land'],
  [72, 'Military Facility'], [73, 'Luke AFB Vicinity'], [74, 'Luke AFB Noise Contour'], [75, 'Luke AFB APZ'],
  [76, 'Luke AFB Aux1 Vicinity'], [77, 'Luke AFB Aux1 Noise Contour'], [78, 'Luke AFB Aux1 APZ'],
  [79, 'Gila Bend Noise Contour'], [80, 'Gila Bend APZ'],
];
export const CASE_TYPES = {
  0: 'Land Use Case', 1: 'Variance', 2: 'Comprehensive Plan Amendment', 3: 'Development Master Plan', 4: 'Subdivision',
  5: 'Military Compatibility Permit', 6: 'Special Use Permit', 7: 'Zoning Overlay', 8: 'Rezoning Case', 9: 'Zoning Case', 10: 'All Cases',
  91: 'Variance', 92: 'Comprehensive Plan Amendment', 93: 'Development Master Plan', 94: 'Subdivision', 95: 'Military Compatibility Permit',
  96: 'Land Use Case', 97: 'Special Use Permit', 98: 'Zoning Overlay', 99: 'Rezoning Case', 100: 'Zoning Case',
};

export function normalizeApn(input) {
  const raw = String(input || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const m = raw.match(/^(\d{3})(\d{2})(\d{3})([A-Z]?)$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}${m[4]}`;
}

const fmtDate = (ms) => (ms == null || ms === '' ? null : new Date(ms).toISOString().slice(0, 10));
const pick = (a, keys) => { for (const k of keys) if (a[k] != null && a[k] !== '' && a[k] !== 'Null') return a[k]; return null; };

// ---------- geometry ----------
function ringsBBox(rings) {
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const r of rings) for (const [x, y] of r) { xmin = Math.min(xmin, x); ymin = Math.min(ymin, y); xmax = Math.max(xmax, x); ymax = Math.max(ymax, y); }
  return { xmin, ymin, xmax, ymax };
}
function ringArea(r) { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return a / 2; }
export function polygonAreaSqFt(rings) { return Math.abs(rings.reduce((s, r) => s + ringArea(r), 0)); }
// Shrink a parcel ~2 ft toward its centroid so features that only touch the boundary (adjacent road ROW) don't count as intersecting.
function insetRings(rings, ft = 2) {
  const c = centroid(rings);
  return rings.map(r => r.map(([x, y]) => { const dx = c[0] - x, dy = c[1] - y, d = Math.hypot(dx, dy); return d > ft * 2 ? [x + dx / d * ft, y + dy / d * ft] : [x, y]; }));
}
function centroid(rings) { const b = ringsBBox(rings); return [(b.xmin + b.xmax) / 2, (b.ymin + b.ymax) / 2]; }
function ptSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
function polyToLineDist(rings, paths) {
  let best = Infinity;
  for (const path of paths) for (let i = 1; i < path.length; i++) {
    for (const r of rings) for (const v of r) best = Math.min(best, ptSeg(v, path[i - 1], path[i]));
    for (const r of rings) for (let k = 1; k < r.length; k++) { best = Math.min(best, ptSeg(path[i - 1], r[k - 1], r[k]), ptSeg(path[i], r[k - 1], r[k])); }
  }
  return best;
}
function lineDirection(paths, c) {
  const b = ringsBBox(paths);
  const w = b.xmax - b.xmin, h = b.ymax - b.ymin;
  if (w >= h) { const y = (b.ymin + b.ymax) / 2; return { dir: y > c[1] ? 'north' : 'south', orient: 'E–W' }; }
  const x = (b.xmin + b.xmax) / 2; return { dir: x > c[0] ? 'east' : 'west', orient: 'N–S' };
}
// Distinct nearby lines, closest first. Segments of the same line are merged: a second hit only counts
// if it runs the other way (N–S vs E–W) or sits > 500 ft from an already-picked parallel line.
function nearestLines(features, rings, c, count = 2) {
  const cand = [];
  for (const f of features) {
    const paths = f.geometry && f.geometry.paths; if (!paths) continue;
    const b = ringsBBox(paths); const ld = lineDirection(paths, c);
    cand.push({ d: polyToLineDist(rings, paths), type: f.attributes.PLSSType, ...ld, pos: ld.orient === 'N–S' ? (b.xmin + b.xmax) / 2 : (b.ymin + b.ymax) / 2 });
  }
  cand.sort((x, y) => x.d - y.d);
  const out = [];
  for (const k of cand) {
    if (out.some(o => o.orient === k.orient && Math.abs(o.pos - k.pos) < 500)) continue;
    out.push(k); if (out.length >= count) break;
  }
  return out;
}
function nearestLine(features, rings, c) {
  let best = null;
  for (const f of features) {
    const paths = f.geometry && f.geometry.paths; if (!paths) continue;
    const d = polyToLineDist(rings, paths);
    if (!best || d < best.d) best = { d, type: f.attributes.PLSSType, ...lineDirection(paths, c) };
  }
  return best;
}

// ---------- main lookup ----------
export async function lookupParcel(apnInput, { onStep = () => {} } = {}) {
  const apn = normalizeApn(apnInput);
  if (!apn) throw new Error('Enter an APN like 304-88-146 or 30488146A.');
  onStep('Assessor parcel record');
  const pq = await arcgis(`${EP.parcel}/query`, { where: `APNDash='${apn}'`, outFields: PARCEL_FIELDS, returnGeometry: 'true', outSR: '2223' });
  if (!pq.features || !pq.features.length) throw new Error(`No Assessor parcel found for ${apn}.`);
  const feat = pq.features[0];
  const a = feat.attributes; const rings = feat.geometry.rings;
  const geom = { rings, spatialReference: { wkid: 2223 } };
  const bb = ringsBBox(rings); const c = centroid(rings);
  const gjson = JSON.stringify(geom);
  const polyQ = { geometry: gjson, geometryType: 'esriGeometryPolygon', inSR: '2223', spatialRel: 'esriSpatialRelIntersects', returnGeometry: 'false' };
  const env = (buf) => JSON.stringify({ xmin: bb.xmin - buf, ymin: bb.ymin - buf, xmax: bb.xmax + buf, ymax: bb.ymax + buf, spatialReference: { wkid: 2223 } });

  onStep('PlanNet (all layers), section lines, floodplain, map geometry');
  const settle = (p) => p.then(v => ({ ok: true, v }), e => ({ ok: false, e: String(e.message || e) }));
  const insetQ = { ...polyQ, geometry: JSON.stringify({ rings: insetRings(rings), spatialReference: { wkid: 2223 } }) };
  const recP = settle(lookupRecorder({ parcel: { ...a, DeedDate: fmtDate(a.DeedDate) } }));
  const [idf, trs, fe, fp, ec, wgs, fcd, row] = await Promise.all([
    settle(arcgis(`${EP.plannet}/identify`, { geometry: gjson, geometryType: 'esriGeometryPolygon', sr: '2223', layers: 'all', tolerance: '0',
      mapExtent: `${bb.xmin},${bb.ymin},${bb.xmax},${bb.ymax}`, imageDisplay: '400,400,96', returnGeometry: 'false' })),
    settle(arcgis(`${EP.trs}/query`, { geometry: env(2700), geometryType: 'esriGeometryEnvelope', inSR: '2223', outSR: '2223', spatialRel: 'esriSpatialRelIntersects', outFields: 'PLSSType', returnGeometry: 'true', maxAllowableOffset: '2' })),
    settle(arcgis(`${EP.floodEff}/query`, { ...polyQ, outFields: 'FloodZoneCode,FloodZoneDescription,StaticElevation_Feet,FIRMPanelNumber' })),
    settle(arcgis(`${EP.floodPre}/query`, { ...polyQ, outFields: 'FloodZoneCode,FloodZoneDescription' })),
    settle(arcgis(`${EP.elevCert}/query`, { where: `ParcelNumber='${apn}'`, outFields: 'ElevCertNumber,Address', returnGeometry: 'false' })),
    settle(arcgis(`${EP.parcel}/query`, { where: `APNDash='${apn}'`, outFields: 'APN', returnGeometry: 'true', outSR: '4326' })),
    settle(arcgis(`${EP.fcdProperty}/query`, { ...insetQ, outFields: 'Type,ProjectName,PIN' })),
    settle(arcgis(`${EP.rightOfWay}/query`, { ...insetQ, outFields: 'aquisition_type,RightOfWayWidth,RecorderNumber,RecorderUrl,CorDNumber,RightOfWayShareDescription' })),
  ]);

  const R = {
    apn, lookupDate: new Date().toISOString().slice(0, 10), errors: [],
    parcel: {
      ...a, DeedDate: fmtDate(a.DeedDate), SaleDate: fmtDate(a.SaleDate),
      areaSqFt: Math.round(polygonAreaSqFt(rings)),
    },
    wgsRings: wgs.ok && wgs.v.features && wgs.v.features[0] ? wgs.v.features[0].geometry.rings : null,
    rings2223: rings,
  };
  R.parcel.areaAcres = +(R.parcel.areaSqFt / 43560).toFixed(3);
  for (const [k, s] of Object.entries({ PlanNet: idf, 'Section lines': trs, 'Floodplain (effective)': fe, 'Floodplain (preliminary)': fp, 'Elevation certificates': ec })) if (!s.ok) R.errors.push(`${k}: ${s.e}`);

  // Section / midsection lines
  if (trs.ok) {
    const feats = trs.v.features || [];
    const sec = nearestLine(feats.filter(f => f.attributes.PLSSType === 'Section'), rings, c);
    const any = sec || nearestLine(feats.filter(f => f.attributes.PLSSType !== 'Quarter Section'), rings, c);
    R.sectionLine = any ? { distance: Math.round(any.d), dir: any.dir, orient: any.orient, type: any.type, fallback: !sec } : null;
    const pool = sec ? feats.filter(f => f.attributes.PLSSType === 'Section') : feats.filter(f => f.attributes.PLSSType !== 'Quarter Section');
    R.sectionLines = nearestLines(pool, rings, c, 2).map(k => ({ distance: Math.round(k.d), dir: k.dir, orient: k.orient, type: k.type, fallback: !sec }));
    const q = nearestLine(feats.filter(f => f.attributes.PLSSType === 'Quarter Section'), rings, c);
    R.midsectionLine = q ? { distance: Math.round(q.d), dir: q.dir, orient: q.orient, type: q.type } : null;
  }

  // PlanNet buckets
  const results = idf.ok ? (idf.v.results || []) : [];
  const zoning = results.filter(r => r.layerId === 11).map(r => ({ zone: pick(r.attributes, ['Zone', 'ZONE', 'Zoning']), juris: pick(r.attributes, ['JURIS', 'Juris', 'Jurisdiction']) }));
  R.zoning = [...new Map(zoning.map(z => [z.zone, z])).values()];

  if (idf.ok && R.zoning.length === 0) {
    onStep('Jurisdiction (city) check');
    const city = await settle(arcgis(`${EP.city}/query`, { ...polyQ, outFields: 'CityName,FullCityName' }));
    R.city = city.ok && city.v.features && city.v.features[0] ? (city.v.features[0].attributes.FullCityName || city.v.features[0].attributes.CityName) : null;
    R.outsideCounty = true;
  }

  const caseOf = (r) => {
    const at = r.attributes || {};
    return {
      layerId: r.layerId, layerName: r.layerName, type: CASE_TYPES[r.layerId] || r.layerName,
      permit: pick(at, ['Permit', 'Plan Number', 'PERMITNUM', 'CaseNumber', 'Case Number']) || r.value,
      name: pick(at, ['Case Name', 'Name', 'NAME']), status: pick(at, ['Case Status', 'Status']),
      date: pick(at, ['Case Date', 'Date']), applicant: pick(at, ['Applicant']), request: pick(at, ['Request']),
    };
  };
  const dedupe = (list) => {
    const m = new Map();
    for (const c of list) { const k = c.permit || `${c.layerId}-${c.name}`; const prev = m.get(k); if (!prev || (prev.layerId === 10 && c.layerId !== 10)) m.set(k, c); }
    return [...m.values()];
  };
  const inG = (g) => results.filter(r => LAYER_GROUPS[g].includes(r.layerId));
  R.currentCases = dedupe(inG('currentCases').map(caseOf));
  const curKeys = new Set(R.currentCases.map(c => c.permit));
  R.historicCases = dedupe(inG('historic').map(caseOf)).filter(c => !curKeys.has(c.permit));
  const label = (r) => ({ layerId: r.layerId, layer: r.layerName, value: r.value, attrs: r.attributes });
  R.planning = inG('planning').map(label);
  R.development = inG('development').map(label);
  R.district = inG('district').map(label);
  R.natural = inG('natural').map(label);
  R.military = inG('military').map(label);
  R.overlays = OVERLAY_ROWS.map(([id, name]) => {
    const hits = results.filter(r => r.layerId === id);
    return { id, name, hit: hits.length > 0, notes: [...new Set(hits.map(h => pick(h.attributes, ['Name', 'NAME', 'Case Name', 'Permit']) || h.value))].filter(Boolean).join('; ') };
  });

  // Floodplain (report only on hit)
  const effZones = fe.ok ? (fe.v.features || []).map(f => f.attributes) : [];
  const preZones = fp.ok ? (fp.v.features || []).map(f => f.attributes) : [];
  const certs = ec.ok ? (ec.v.features || []).map(f => f.attributes) : [];
  const isPlainX = (z) => String(z.FloodZoneCode || '').trim().toUpperCase() === 'X';
  const effHits = effZones.filter(z => !isPlainX(z));
  R.flood = {
    hit: effHits.length > 0 || preZones.length > 0 || certs.length > 0,
    floodway: effZones.some(z => /FLOODWAY|^FW$/i.test(z.FloodZoneCode || '')),
    effective: [...new Map(effZones.map(z => [z.FloodZoneCode, z])).values()],
    preliminary: [...new Map(preZones.map(z => [z.FloodZoneCode, z])).values()],
    certs,
  };
  // Easements (mapped sources only): patent easements (PlanNet 24), Flood Control District easements, MCDOT right-of-way.
  if (!fcd.ok) R.errors.push(`Flood Control easements: ${fcd.e}`);
  if (!row.ok) R.errors.push(`MCDOT right-of-way: ${row.e}`);
  R.easements = [];
  for (const h of results.filter(r => r.layerId === 24)) R.easements.push({ kind: 'Patent easement', detail: pick(h.attributes, ['Name', 'NAME', 'Description', 'Type']) || h.value || 'Small Tract Act patent easement', source: 'PlanNet — Patent Easement', patent: true });
  for (const f of (fcd.ok ? fcd.v.features || [] : []).map(x => x.attributes).filter(x => /easement/i.test(x.Type || ''))) R.easements.push({ kind: 'Flood Control District easement', detail: [f.ProjectName, f.PIN && `PIN ${f.PIN}`].filter(Boolean).join(' · ') || '—', source: 'FCDMC property' });
  for (const f of (row.ok ? row.v.features || [] : []).map(x => x.attributes)) R.easements.push({ kind: /easement|patent/i.test(f.aquisition_type || '') ? 'Roadway easement (MCDOT right-of-way)' : 'Road right-of-way (MCDOT)', detail: [f.aquisition_type && `Acquired by ${f.aquisition_type}`, f.RightOfWayWidth && `${f.RightOfWayWidth} ft wide`, f.RightOfWayShareDescription].filter(Boolean).join(' · ') || '—', source: 'MCDOT right-of-way', rec: f.RecorderNumber || null, url: f.RecorderUrl || null });
  const rec = await recP;
  R.recorder = rec.ok ? rec.v : { error: rec.e };
  if (rec.ok) {
    const d = rec.v.deed;
    if (d && d.hasEasement) R.easements.push({ kind: 'Easement in the deed', detail: `Deed recorded with document codes ${d.codes.join(', ')}${d.date ? ` on ${d.date}` : ''}`, source: 'County Recorder', rec: d.rec });
    for (const e of rec.v.easements) R.easements.push({ kind: 'Recorded easement (current owner)', detail: `${e.code} recorded ${e.date} — ${e.names}`, source: 'County Recorder (owner-name match)', rec: e.rec, nameMatch: true });
  }
  R.easements = R.easements.filter((e, i, a) => a.findIndex(x => x.kind === e.kind && x.detail === e.detail && x.rec === e.rec) === i);
  return R;
}

// ---------- optional add-ons ----------
function envOf(R, buf) {
  const b = ringsBBox(R.rings2223);
  return JSON.stringify({ xmin: b.xmin - buf, ymin: b.ymin - buf, xmax: b.xmax + buf, ymax: b.ymax + buf, spatialReference: { wkid: 2223 } });
}

export async function lookupRoads(R) {
  const q = (id) => arcgis(`${EP.rit}/${id}/query`, { geometry: envOf(R, 120), geometryType: 'esriGeometryEnvelope', inSR: '2223', spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'false' });
  const [cls, mnt] = await Promise.all([q(10), q(2)]);
  const keep = ['Street', 'FullRouteName', 'Classification', 'RoadWidth', 'LaneCount', 'SurfaceType', 'CourtesyMaintained', 'CourtesyMaintainedNote', 'MaintenanceDistrict', 'MaintenanceSide'];
  const shape = (fs) => (fs.features || []).map(f => Object.fromEntries(keep.filter(k => f.attributes[k] != null && f.attributes[k] !== '').map(k => [k, f.attributes[k]])));
  return { classification: shape(cls), maintained: shape(mnt) };
}

export async function lookupTSP(R) {
  const b = ringsBBox(R.rings2223);
  const idf = await arcgis(`${EP.tspProj}/identify`, { geometry: envOf(R, 150), geometryType: 'esriGeometryEnvelope', sr: '2223', layers: 'show:6,7,8,9,13,15', tolerance: '0',
    mapExtent: `${b.xmin - 500},${b.ymin - 500},${b.xmax + 500},${b.ymax + 500}`, imageDisplay: '400,400,96', returnGeometry: 'false' });
  const hits = (idf.results || []).map(r => ({ layer: r.layerName, needId: r.attributes.NeedID || r.attributes.NeedId || r.value }));
  if (!hits.length) return { hits: [] };
  const meta = await arcgis(EP.tspNeed, {});
  const ids = [...new Set(hits.map(h => h.needId).filter(Boolean))];
  const where = `NeedID IN (${ids.map(i => `'${String(i).replace(/'/g, "''")}'`).join(',')})`;
  const res = await Promise.all((meta.layers || []).map(L => arcgis(`${EP.tspNeed}/${L.id}/query`, { where, outFields: 'NeedID,OnRoad,FromRoad,ToRoad,NeedCategory,Need,Jurisdiction,ResponsibleAgency', returnGeometry: 'false' }).catch(() => null)));
  const needs = res.flatMap(r => (r && r.features ? r.features.map(f => f.attributes) : []));
  return { hits, needs };
}

export async function lookupSeptic(apn) {
  const kw = [1264, 1305, 1306, 1307, 1308, 1309, 1310, 1311, 1312, 1313].map(ID => ({ ID, Value: ID === 1264 ? apn : '', KeywordOperator: '=' }));
  const d = await request(EP.septic, { json: { QueryID: 229, Keywords: kw, QueryLimit: 0 } });
  const rows = (d && d.Data) || [];
  return rows.map(r => ({ name: r.Name, cols: r.DisplayColumnValues }));
}

export async function countSubdivisionLots(name) {
  const r = await arcgis(`${EP.parcel}/query`, { where: `SubdivisionName='${String(name).replace(/'/g, "''")}'`, returnCountOnly: 'true' });
  return r.count;
}

export async function ping() {
  const t = Date.now();
  await arcgis(`${EP.parcel}/query`, { where: '1=0', returnCountOnly: 'true' });
  return Date.now() - t;
}

// ---------- lot-split legality screen ----------
// Siblings = every Assessor parcel sharing the subject's book-map-item (suffix letters mark splits of one parent).
export async function lookupSplit(R) {
  const apn = R.apn; const base = apn.slice(0, 10); // "BBB-MM-III"
  const sib = await arcgis(`${EP.parcel}/query`, { where: `APNDash LIKE '${base.replace(/[^0-9-]/g, '')}%'`, outFields: 'APNDash,OwnerName,DeedDate,SaleDate,SubdivisionName,Lot,PropertyFullStreetAddress,MCRNumber', returnGeometry: 'true', outSR: '2223', maxAllowableOffset: '1' });
  const parcels = (sib.features || []).filter(f => /^\d{3}-\d{2}-\d{3}[A-Z]?$/.test(f.attributes.APNDash || '')).map(f => {
    const a = f.attributes; const sq = Math.round(polygonAreaSqFt(f.geometry.rings));
    return { apn: a.APNDash, owner: a.OwnerName, deedDate: a.DeedDate ? new Date(a.DeedDate).toISOString().slice(0, 10) : null,
      sub: a.SubdivisionName, lot: a.Lot, addr: a.PropertyFullStreetAddress, sqft: sq, acres: +(sq / 43560).toFixed(2) };
  }).sort((x, y) => x.apn.localeCompare(y.apn));
  // nearest street centerline (RIT street network) to the subject parcel
  let street = null;
  try {
    const b = ringsBBox(R.rings2223);
    const q = await arcgis(`${EP.rit}/1/query`, { geometry: JSON.stringify({ xmin: b.xmin - 80, ymin: b.ymin - 80, xmax: b.xmax + 80, ymax: b.ymax + 80, spatialReference: { wkid: 2223 } }),
      geometryType: 'esriGeometryEnvelope', inSR: '2223', outSR: '2223', spatialRel: 'esriSpatialRelIntersects', outFields: 'FullRouteName', returnGeometry: 'true', maxAllowableOffset: '2' });
    for (const f of q.features || []) { if (!f.geometry || !f.geometry.paths) continue; const d = polyToLineDist(R.rings2223, f.geometry.paths); if (!street || d < street.d) street = { d: Math.round(d), name: f.attributes.FullRouteName || 'unnamed road' }; }
  } catch (e) { street = { error: String(e.message || e) }; }
  return { base, parcels, street };
}

// ---------- County Recorder: easements in / after the current owner's deed ----------
const BIZ = /\b(LLC|L L C|INC|CORP|CORPORATION|COMPANY|CO|LP|LLP|LTD|TRUST|TR|TRUSTEE|TRS|ASSOCIATION|ASSN|HOA|CHURCH|BANK|PARTNERSHIP|PTNRSHP|COUNTY|CITY|STATE|USA|DISTRICT|FUND|HOLDINGS|PROPERTIES|INVESTMENTS|GROUP|ESTATES|RANCH|FARMS)\b/i;
function ownerQuery(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim(); if (!n) return null;
  if (BIZ.test(n)) return { label: n, qs: `businessNames=${encodeURIComponent(n)}` };
  const first = n.split(/[\/&]/)[0].trim().split(' ');
  if (first.length < 2) return { label: n, qs: `businessNames=${encodeURIComponent(n)}` };
  return { label: `${first[0]} ${first[1]}`, qs: `lastNames=${encodeURIComponent(first[0])}&firstNames=${encodeURIComponent(first[1])}` };
}
const recDate = (s) => { const m = String(s || '').match(/(\d{1,2})-(\d{1,2})-(\d{4})/); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; };
export async function lookupRecorder(R) {
  const p = R.parcel; const out = { deed: null, owner: null, easements: [] };
  const tasks = [];
  if (p.DeedNumber) tasks.push(request(`${EP.recorderApi}/documents/${p.DeedNumber}`).then(d => {
    const codes = (d && d.documentCodes) || [];
    out.deed = { rec: String(p.DeedNumber), date: recDate(d && d.recordingDate) || p.DeedDate, codes, pages: d && d.pageAmount, hasEasement: codes.some(c => /EASE|ESMT/i.test(c)) };
  }));
  const oq = ownerQuery(p.OwnerName);
  if (oq) tasks.push(request(`${EP.recorderApi}/documents/search?${oq.qs}&documentCode=EASEMENT`).then(d => {
    const since = p.DeedDate || '0000';
    const rows = ((d && d.searchResults) || []).map(r => ({ rec: String(r.recordingNumber), suffix: r.recordingSuffix || '', date: recDate(r.recordingDate), code: r.documentCode, names: r.names }));
    out.owner = { label: oq.label, total: (d && d.totalResults) || rows.length };
    out.easements = rows.filter(r => r.date && r.date >= since).sort((a, b) => (a.date < b.date ? 1 : -1));
  }));
  await Promise.all(tasks);
  return out;
}
