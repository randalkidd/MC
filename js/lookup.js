// Parcel lookup — ports reference/workflow-standards.md to in-browser REST calls.
import { arcgis, request } from './net.js';

const GIS = 'https://gis.maricopa.gov/arcgis/rest/services';
export const EP = {
  parcel: `${GIS}/IndividualService/Parcel/MapServer/1`,
  city: `${GIS}/IndividualService/City/MapServer/0`,
  trs: `${GIS}/IndividualService/TownshipRangeSection/MapServer/2`,
  plannet: `${GIS}/PND/PlanNet/MapServer`,
  floodEff: 'https://gis.maricopa.gov/flood/rest/services/FEMA/FloodplainEffective/MapServer/0',
  floodPre: 'https://gis.maricopa.gov/flood/rest/services/FEMA/FloodplainPreliminary/MapServer/0',
  elevCert: 'https://gis.maricopa.gov/flood/rest/services/FEMA/ElevationCertificate/MapServer/0',
  rit: 'https://gis.maricopa.gov/dot/rest/services/Maintenance/RoadInformationTool/MapServer',
  tspProj: 'https://gis.maricopa.gov/dot/rest/services/Planning/TransportationSystemPlan2040Project/MapServer',
  tspNeed: 'https://gis.maricopa.gov/dot/rest/services/Planning/TransportationSystemPlan2040Need/MapServer',
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
  recDoc: (n) => `https://recorder.maricopa.gov/recording/document-details.html?recordingNumber=${n}&suffix=`,
  recBook: (b, p) => `https://recorder.maricopa.gov/recording/document-search-results.html?mode=book&docketBook=${b}&pageMap=${p}`,
  assessorParcel: (apn) => `https://mcassessor.maricopa.gov/mcs/?q=${apn.replace(/-/g, '')}&mod=pd`,
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
  [7, 'Zoning Overlay (combined PAD/UPD/SC)'], [23, 'Scenic Corridor'], [24, 'Patent Easement'],
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
  const [idf, trs, fe, fp, ec, wgs] = await Promise.all([
    settle(arcgis(`${EP.plannet}/identify`, { geometry: gjson, geometryType: 'esriGeometryPolygon', sr: '2223', layers: 'all', tolerance: '0',
      mapExtent: `${bb.xmin},${bb.ymin},${bb.xmax},${bb.ymax}`, imageDisplay: '400,400,96', returnGeometry: 'false' })),
    settle(arcgis(`${EP.trs}/query`, { geometry: env(2700), geometryType: 'esriGeometryEnvelope', inSR: '2223', outSR: '2223', spatialRel: 'esriSpatialRelIntersects', outFields: 'PLSSType', returnGeometry: 'true' })),
    settle(arcgis(`${EP.floodEff}/query`, { ...polyQ, outFields: 'FloodZoneCode,FloodZoneDescription,StaticElevation_Feet,FIRMPanelNumber' })),
    settle(arcgis(`${EP.floodPre}/query`, { ...polyQ, outFields: 'FloodZoneCode,FloodZoneDescription' })),
    settle(arcgis(`${EP.elevCert}/query`, { where: `ParcelNumber='${apn}'`, outFields: 'ElevCertNumber,Address', returnGeometry: 'false' })),
    settle(arcgis(`${EP.parcel}/query`, { where: `APNDash='${apn}'`, outFields: 'APN', returnGeometry: 'true', outSR: '4326' })),
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
  const needs = [];
  for (const L of meta.layers || []) {
    try {
      const r = await arcgis(`${EP.tspNeed}/${L.id}/query`, { where: `NeedID IN (${ids.map(i => `'${i}'`).join(',')})`, outFields: 'NeedID,OnRoad,FromRoad,ToRoad,NeedCategory,Need,Jurisdiction,ResponsibleAgency', returnGeometry: 'false' });
      for (const f of r.features || []) needs.push(f.attributes);
    } catch { /* layer without NeedID */ }
  }
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
