import assert from 'node:assert/strict';
import polygonClipping from 'polygon-clipping';
import { calculatePlan, type CalculationInput } from '../src/services/calculationPipeline';
import { detectCorridorZones, resolveCorridorZones, rectangle, polygonArea } from '../src/services/corridorZones';
import { getPolygonArea, getPolygonBoundingBox } from '../src/services/geometryMath';
import { validateNesting } from '../src/services/nestingValidation';
import { getBroadloomCutPolygon } from '../src/services/broadloomGeometry';
import { getStripOverlapSeams } from '../src/services/nestingEngine';
import { generateBOQCSV } from '../src/services/boqService';
import { CORRIDOR_DXF_CONTENT } from '../src/data/corridorMock';
import { parseDxfFile, extractRoomsFromLayers } from '../src/services/dxfService';
import type { Polygon, RoomGeometry } from '../src/types';

const rect = (x: number, y: number, w: number, h: number) => rectangle({
  minX: x * 1000, minY: y * 1000, maxX: (x + w) * 1000, maxY: (y + h) * 1000, width: w * 1000, height: h * 1000 });
const shape = polygonClipping.union(rect(0, 0, 32, 2) as any,
  rect(20, 0, 2, 14) as any, rect(20, 12, 12, 2) as any, rect(30, 0, 2, 30) as any) as Polygon[];
const corridor: RoomGeometry = { id: 'corridor', name: 'Hành lang bốn nhánh', boundary: shape[0][0],
  holes: shape[0].slice(1), bbox: getPolygonBoundingBox(shape[0]), areaMm2: getPolygonArea(shape[0]) };
const parsedSample = parseDxfFile(CORRIDOR_DXF_CONTENT);
const importedSample = extractRoomsFromLayers(parsedSample.rawDxf, 'CORRIDOR', ['COURTYARD'], 'mm');
assert.equal(importedSample.length, 1);
assert.equal(importedSample[0].areaMm2, corridor.areaMm2);
const zones = detectCorridorZones([corridor]);
assert.equal(zones.length, 4);
assert.equal(zones.filter(z => z.direction === 'horizontal').length, 2);
assert.equal(zones.filter(z => z.direction === 'vertical').length, 2);
const resolved = resolveCorridorZones([corridor], zones);
assert.equal(resolved.reduce((sum, z) => sum + z.areaMm2, 0), corridor.areaMm2);
assert.ok(corridor.holes.length > 0, 'The enclosed courtyard must remain empty');
const reverse = resolveCorridorZones([corridor], [...zones].reverse());
assert.equal(reverse.reduce((sum, z) => sum + z.areaMm2, 0), corridor.areaMm2);
assert.notEqual(reverse.find(z => z.id === zones[0].id)!.areaMm2, resolved[0].areaMm2);
assert.throws(() => resolveCorridorZones([corridor], zones.slice(1)), /chưa thuộc vùng trải/);

const input: CalculationInput = { rooms: [corridor], materialType: 'broadloom',
  tileConfig: { width: 500, height: 500 }, broadloomConfig: { rollWidth: 4000,
    maxRollLength: 35000, seamOverlap: 0, cutAllowanceMm: 100, direction: 'horizontal', layoutMode: 'corridor' },
  pattern: 'monolithic', rotationDeg: 45, originPoint: [0, 0], roomOrigins: { corridor: [0, 0] },
  offcutConfig: { enabled: true, minWidth: 100, minHeight: 100, minBroadloomWidth: 1000, allowRotate: false },
  corridorZones: zones };
const result = calculatePlan(input);
assert.equal(validateNesting(input.rooms, result.nesting, 'broadloom', input.broadloomConfig), null);
assert.ok(result.nesting.broadloomStrips.some(s => s.isReusedFromOffcut));
for (const strip of result.nesting.broadloomStrips) {
  const zone = zones.find(z => z.id === strip.zoneId)!;
  const dx = strip.directionEnd[0] - strip.directionStart[0], dy = strip.directionEnd[1] - strip.directionStart[1];
  assert.ok(zone.direction === 'horizontal' ? Math.abs(dy) < 0.001 && dx > 0 : Math.abs(dx) < 0.001 && dy > 0);
  const footprint = resolved.find(z => z.id === zone.id)!.polygons;
  assert.ok(polygonArea(polygonClipping.difference(strip.clippedPolygons as any, footprint as any) as Polygon[]) < 1);
}
const quantities = result.nesting.zoneQuantities!;
assert.ok(Math.abs(quantities.reduce((sum, q) => sum + q.linearMeters, 0) - result.boq.linearMeters) < 0.00001);
const csv = generateBOQCSV(result.boq, 'broadloom', input.tileConfig, input.broadloomConfig, input.pattern, result.nesting, input.rooms);
assert.ok(csv.includes('BÓC TÁCH THEO VÙNG HÀNH LANG'));
const noReuse = calculatePlan({ ...input, offcutConfig: { ...input.offcutConfig, enabled: false } });
assert.ok(result.boq.linearMeters < noReuse.boq.linearMeters);
assert.equal(noReuse.nesting.offcutLinks.length, 0);

// A horizontal donor covers a later vertical zone by rotating its actual source slice 90°.
const elbowShape = polygonClipping.union(rect(0, 0, 3, 2) as any, rect(1, 0, 2, 4) as any) as Polygon[];
const elbow: RoomGeometry = { id: 'elbow', name: 'Góc L', boundary: elbowShape[0][0], holes: [],
  bbox: getPolygonBoundingBox(elbowShape[0]), areaMm2: getPolygonArea(elbowShape[0]) };
const elbowResult = calculatePlan({ ...input, rooms: [elbow], corridorZones: detectCorridorZones([elbow]).sort((a,b) => Number(a.direction === 'vertical') - Number(b.direction === 'vertical')), roomOrigins: { elbow: [0, 0] } });
assert.ok(elbowResult.nesting.offcutLinks.some(link => {
  const source = elbowResult.nesting.broadloomStrips.find(s => s.id === link.sourceTileId)!;
  const target = elbowResult.nesting.broadloomStrips.find(s => s.id === link.targetTileId)!;
  return source.zoneId !== target.zoneId;
}), 'A remnant must be reused across directions');
const reversed = calculatePlan({ ...input, corridorZones: [...zones].reverse() });
assert.equal(validateNesting(input.rooms, reversed.nesting, 'broadloom', input.broadloomConfig), null);
const shortRoll = calculatePlan({ ...input, broadloomConfig: { ...input.broadloomConfig, maxRollLength: 12000, seamOverlap: 30 } });
assert.equal(validateNesting(input.rooms, shortRoll.nesting, 'broadloom', { ...input.broadloomConfig, maxRollLength: 12000, seamOverlap: 30 }), null);
const noInstalledOverlap = (plan: typeof result.nesting) => {
  const installed = plan.broadloomStrips.flatMap(s => s.clippedPolygons);
  const sum = polygonArea(installed);
  const union = polygonClipping.union(installed[0] as any, ...installed.slice(1) as any) as Polygon[];
  assert.ok(sum - polygonArea(union) < 100, `Installed carpet overlaps by ${(sum - polygonArea(union)) / 1e6} m²`);
};
noInstalledOverlap(result.nesting);
noInstalledOverlap(shortRoll.nesting);
const duplicate = { ...shortRoll.nesting.broadloomStrips.find(s => !s.isReusedFromOffcut)!,
  id: 'DUPLICATE-CARPET', name: 'Thảm chồng', offcuts: [] };
const overlappedStrips = [...shortRoll.nesting.broadloomStrips, duplicate];
const overlappingPlan = { ...shortRoll.nesting, broadloomStrips: overlappedStrips,
  seams: getStripOverlapSeams(overlappedStrips),
  totalLinearMeters: shortRoll.nesting.totalLinearMeters + duplicate.lengthMm / 1000 };
assert.match(validateNesting([corridor], overlappingPlan, 'broadloom',
  { ...input.broadloomConfig, maxRollLength: 12000, seamOverlap: 30 }) ?? '', /chồng nhau/);
const hairline = { ...result.nesting.broadloomStrips[0],
  rawPolygon: rect(0, 0, 0.0002, 3), directionStart: [0, 1500] as [number, number],
  directionEnd: [0.2, 1500] as [number, number], lengthMm: 100.2, widthMm: 3000,
  rawAreaMm2: 300600 };
assert.ok(Math.abs(getPolygonArea(getBroadloomCutPolygon(hairline)) - hairline.rawAreaMm2) < 1,
  'A sub-millimetre strip must still include its physical cutting allowance');

// The supplied CAD corridor has sub-millimetre edge drift. It must form four
// usable zones, keep the original floor exactly covered and avoid duplicate
// carpet at crossings for each supported roll width.
const cadBoundary: [number, number][] = [
  [-177864.949, -168046.515], [-177864.949, -164306.339],
  [-179845.195, -164306.424], [-179845.195, -166066.46],
  [-187640.004, -166066.514], [-187640.059, -155706.552],
  [-189520.007, -155706.552], [-189520.007, -156166.613],
  [-190849.989, -156166.613], [-190850.005, -166066.514],
  [-209800.052, -166066.514], [-209800.045, -168047.014],
];
const cadPolygon: Polygon = [cadBoundary];
const cadRoom: RoomGeometry = { id: 'cad-corridor', name: 'DXF hành lang', boundary: cadBoundary,
  holes: [], bbox: getPolygonBoundingBox(cadPolygon), areaMm2: getPolygonArea(cadPolygon) };
const cadZones = detectCorridorZones([cadRoom]);
assert.equal(cadZones.length, 4, 'CAD hairlines must not become separate carpet zones');
assert.ok(Math.abs(polygonArea(resolveCorridorZones([cadRoom], cadZones).flatMap(z => z.polygons)) - cadRoom.areaMm2) < 100);
const badBoundary = cadBoundary.map(([x, y], i): [number, number] =>
  i === 11 ? [x, y - 4] : [x, y]);
const badPolygon: Polygon = [badBoundary];
const badRoom: RoomGeometry = { ...cadRoom, boundary: badBoundary,
  bbox: getPolygonBoundingBox(badPolygon), areaMm2: getPolygonArea(badPolygon) };
assert.throws(() => detectCorridorZones([badRoom]), /vượt ngưỡng tự hiệu chỉnh 1 mm.*chia vùng thủ công/,
  'Larger CAD drift needs a location and manual-review guidance');
for (const width of [3000, 3660, 4000]) {
  const cadInput: CalculationInput = { ...input, rooms: [cadRoom], corridorZones: cadZones,
    originPoint: [cadRoom.bbox.minX, cadRoom.bbox.minY],
    roomOrigins: { [cadRoom.id]: [cadRoom.bbox.minX, cadRoom.bbox.minY] },
    broadloomConfig: { ...input.broadloomConfig, rollWidth: width } };
  for (const layoutMode of ['corridor', 'whole'] as const) for (const seamOverlap of [0, 30]) {
    const configured = { ...cadInput, broadloomConfig: { ...cadInput.broadloomConfig, layoutMode, seamOverlap } };
    const plan = calculatePlan(configured);
    assert.equal(validateNesting([cadRoom], plan.nesting, 'broadloom', configured.broadloomConfig), null);
    noInstalledOverlap(plan.nesting);
    assert.ok(Math.abs(plan.boq.netFloorAreaM2 - cadRoom.areaMm2 / 1e6) < 0.0001);
  }
}
// Switching to whole-room mode never inherits a previous tile rotation.
const whole = calculatePlan({ ...input, rooms: [elbow], broadloomConfig: { ...input.broadloomConfig, layoutMode: 'whole', direction: 'vertical' } });
assert.ok(whole.nesting.broadloomStrips.every(s => Math.abs(s.directionEnd[0] - s.directionStart[0]) < 0.001));
console.log(JSON.stringify({ zones: zones.map(z => [z.name, z.direction]), floorM2: result.boq.netFloorAreaM2,
  metersBefore: noReuse.boq.linearMeters, metersAfter: result.boq.linearMeters,
  reused: result.nesting.offcutLinks.length, elapsedMs: result.nesting.computationTimeMs }));
console.log('Corridor regression checks passed.');
