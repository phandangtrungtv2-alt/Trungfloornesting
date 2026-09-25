import assert from 'node:assert/strict';
import polygonClipping from 'polygon-clipping';
import { calculatePlan, type CalculationInput } from '../src/services/calculationPipeline';
import { rectangle, detectCorridorZones, polygonArea } from '../src/services/corridorZones';
import { getPolygonArea, getPolygonBoundingBox } from '../src/services/geometryMath';
import { validateNesting } from '../src/services/nestingValidation';
import type { Polygon, RoomGeometry } from '../src/types';

const rect = (x: number, y: number, width: number, height: number) => rectangle({
  minX: x * 1000, minY: y * 1000, maxX: (x + width) * 1000, maxY: (y + height) * 1000,
  width: width * 1000, height: height * 1000 });
const makeRoom = (id: string, parts: Polygon[]): RoomGeometry => {
  const polygon = polygonClipping.union(parts[0] as any, ...parts.slice(1) as any) as Polygon[];
  assert.equal(polygon.length, 1);
  return { id, name: id, boundary: polygon[0][0], holes: polygon[0].slice(1),
    bbox: getPolygonBoundingBox(polygon[0]), areaMm2: getPolygonArea(polygon[0]) };
};
const receiver = makeRoom('Phòng 2', [rect(50, 0, 1.33, 9.96), rect(51.33, 0, 1.88, 10.36)]);
const donor = makeRoom('Phòng 1', [rect(0, 0, 31.94, 1.98), rect(30, 1.98, 1.94, 1.76)]);
const run = (source: RoomGeometry) => {
  const rooms = [source, receiver];
  const corridorZones = detectCorridorZones(rooms);
  const roomOrigins = Object.fromEntries(rooms.map(r => [r.id, [r.bbox.minX, r.bbox.minY]]));
  const input: CalculationInput = { rooms, corridorZones, roomOrigins,
    materialType: 'broadloom', tileConfig: { width: 500, height: 500 },
    broadloomConfig: { rollWidth: 4000, maxRollLength: 35000, seamOverlap: 0,
      cutAllowanceMm: 100, direction: 'horizontal', layoutMode: 'corridor' },
    pattern: 'monolithic', rotationDeg: 0, originPoint: [source.bbox.minX, source.bbox.minY],
    offcutConfig: { enabled: true, minWidth: 100, minHeight: 100, minBroadloomWidth: 1000, allowRotate: false } };
  const plan = calculatePlan(input);
  assert.equal(validateNesting(rooms, plan.nesting, 'broadloom', input.broadloomConfig), null);
  const installed = plan.nesting.broadloomStrips.flatMap(s => s.clippedPolygons);
  const covered = polygonClipping.union(installed[0] as any, ...installed.slice(1) as any) as Polygon[];
  assert.ok(polygonArea(installed) - polygonArea(covered) < 100, 'Placed carpet must not overlap');
  const receiverCuts = plan.nesting.broadloomStrips.filter(s => s.roomId === receiver.id);
  console.log(JSON.stringify({ source: source.name, zones: corridorZones.map(z => [z.roomId,z.direction]),
    meters: plan.boq.linearMeters, receiverCuts: receiverCuts.map(s => ({ len: s.lengthMm,
      width: s.widthMm, new: !s.isReusedFromOffcut, area: s.usedAreaMm2 / 1e6 })) }));
  return { plan, receiverCuts };
};
const tooNarrow = run(donor);
assert.equal(tooNarrow.receiverCuts.length, 1, 'Receiver needs one continuous cut');
assert.equal(tooNarrow.receiverCuts[0].isReusedFromOffcut, false, 'Too narrow donor cannot replace the full run');
assert.ok(tooNarrow.receiverCuts[0].lengthMm >= 10360);

const wideDonor = makeRoom('Phòng 1', [rect(0, 0, 12, 0.7)]);
const sufficient = run(wideDonor);
assert.equal(sufficient.receiverCuts.length, 1, 'Full-length remnant must stay unbroken');
assert.equal(sufficient.receiverCuts[0].isReusedFromOffcut, true, 'Use a donor remnant when it covers full run');
console.log('Origin run checks passed');
