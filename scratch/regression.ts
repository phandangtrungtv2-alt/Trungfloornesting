import assert from 'node:assert/strict';
import polygonClipping from 'polygon-clipping';
import { computeNesting } from '../src/services/nestingEngine';
import { optimizeOffcuts } from '../src/services/offcutManager';
import { optimizeBroadloomRemnantFirst } from '../src/services/remnantFirstOptimizer';
import { extractRoomsFromLayers } from '../src/services/dxfService';
import { validateNesting } from '../src/services/nestingValidation';
import { calculateBOQ, generateBOQCSV } from '../src/services/boqService';
import { getBroadloomCutPolygon, getBroadloomOutsideFloorPolygons,
  getBroadloomOutsidePolygons } from '../src/services/broadloomGeometry';
import { MOCK_ROOMS } from '../src/data/mockDxf';
import { getPolygonArea, getRingBoundingBox } from '../src/services/geometryMath';
import type { Ring, RoomGeometry, Polygon, NestingResult } from '../src/types';

const room = (id: string, x: number, y: number, w: number, h: number): RoomGeometry => {
  const boundary: Ring = [[x, y], [x+w, y], [x+w, y+h], [x, y+h]];
  return { id, name: id, boundary, holes: [], bbox: getRingBoundingBox(boundary), areaMm2: w*h };
};
const base = {
  tileConfig: { width: 1000, height: 250 },
  broadloomConfig: { rollWidth: 4000, maxRollLength: 35000, seamOverlap: 30, direction: 'horizontal' as const },
  pattern: 'monolithic' as const, rotationDeg: 0, originPoint: [0, 0] as [number, number],
};
const missingArea = (floor: RoomGeometry, pieces: Polygon[]) => {
  const covered = polygonClipping.union(pieces[0] as any, ...pieces.slice(1) as any);
  const missing = polygonClipping.difference([floor.boundary] as any, covered as any) as Polygon[];
  return missing.reduce((sum, p) => sum + getPolygonArea(p), 0);
};

const square = room('R1', 0, 0, 4000, 4000);
const quarter = computeNesting({ ...base, rooms: [square], materialType: 'carpet_tile', pattern: 'quarter_turn' });
assert.ok(quarter.tiles.some((tile) => tile.isQuarterTurnRotated));
assert.ok(missingArea(square, quarter.tiles.flatMap((tile) => tile.clippedPolygons)) < 1);
assert.equal(validateNesting([square], quarter, 'carpet_tile', base.broadloomConfig), null);
const vinyl = computeNesting({ ...base, rooms: [square], materialType: 'lvt_pvc',
  tileConfig: { width: 914.4, height: 152.4 }, pattern: 'quarter_turn' });
assert.ok(vinyl.tiles.some((tile) => tile.isQuarterTurnRotated));
assert.ok(missingArea(square, vinyl.tiles.flatMap((tile) => tile.clippedPolygons)) < 1);

const one = room('R2', 0, 0, 3000, 3000);
const oneRoll = computeNesting({ ...base, rooms: [one], materialType: 'broadloom' });
assert.equal(oneRoll.broadloomStrips.length, 1);
assert.equal(oneRoll.seams.length, 0);

const two = room('R3', 0, 0, 3000, 6000);
const twoRoll = computeNesting({ ...base, rooms: [two], materialType: 'broadloom' });
assert.equal(twoRoll.broadloomStrips.length, 2);
assert.equal(twoRoll.seams.length, 1);
assert.ok(Math.abs(twoRoll.seams[0].lengthMm - 3000) < 1);
const zeroOverlap = computeNesting({ ...base, rooms: [two], materialType: 'broadloom',
  broadloomConfig: { ...base.broadloomConfig, seamOverlap: 0 } });
assert.equal(zeroOverlap.seams.length, 1);
assert.ok(Math.abs(zeroOverlap.seams[0].lengthMm - 3000) < 1);

const long = room('R4', 0, 0, 50000, 3000);
const longRoll = computeNesting({ ...base, rooms: [long], materialType: 'broadloom',
  broadloomConfig: { ...base.broadloomConfig, maxRollLength: 35000, cutAllowanceMm: 150 } });
assert.equal(longRoll.broadloomStrips.length, 2);
assert.ok(longRoll.broadloomStrips.every((strip) => strip.lengthMm <= 35000));
assert.ok(missingArea(long, longRoll.broadloomStrips.flatMap((strip) => strip.clippedPolygons)) < 1);
assert.equal(longRoll.seams.length, 1);
assert.equal(validateNesting([long], longRoll, 'broadloom', { ...base.broadloomConfig, maxRollLength: 35000, cutAllowanceMm: 150 }), null);

const dxf = { entities: [
  { type: 'LWPOLYLINE', layer: 'ROOM', shape: true, vertices: [[0,0],[10000,0],[10000,10000],[0,10000]].map(([x,y]) => ({x,y})) },
  { type: 'LWPOLYLINE', layer: 'ROOM', shape: true, vertices: [[1000,1000],[4000,1000],[4000,4000],[1000,4000]].map(([x,y]) => ({x,y})) },
  { type: 'LWPOLYLINE', layer: 'ROOM', shape: true, vertices: [[12000,0],[12400,0],[12400,1000],[12000,1000]].map(([x,y]) => ({x,y})) },
] };
const imported = extractRoomsFromLayers(dxf, 'ROOM', []);
assert.equal(imported.length, 3);
assert.equal(imported.reduce((sum, r) => sum + r.areaMm2, 0), 100400000);
const duplicateOutline = { type: 'LWPOLYLINE', layer: 'ROOM', shape: true,
  vertices: [[0,0],[5000,0],[5000,5000],[0,5000]].map(([x,y]) => ({x,y})) };
const reversedOutline = { ...duplicateOutline,
  vertices: [...duplicateOutline.vertices].reverse() };
const deduplicated = extractRoomsFromLayers({ entities: [duplicateOutline, reversedOutline] }, 'ROOM', []);
assert.equal(deduplicated.length, 1);
assert.equal(deduplicated[0].areaMm2, 25_000_000);
// The same 66.9 m² CAD corridor used to lose two 500 mm tiles (0.350 m²)
// because its nominally vertical wall had floating-point vertex jitter.
const jitteredCorridor: Ring = [
  [4498.62163878319,-35424.88201588053], [4498.621638783197,-36589.88201588055],
  [7798.621638783221,-36589.88201588056], [7798.621638783221,-37174.88201588054],
  [29138.62163878324,-37174.88201588067], [29138.62163878323,-39124.88201588065],
  [30988.62163878322,-39124.88201588066], [30988.62163878322,-37174.88201588067],
  [41788.62163878318,-37174.88201588067], [41788.62163878318,-35424.88201588053],
];
const [stableRoom] = extractRoomsFromLayers({ entities: [{ type: 'LWPOLYLINE',
  layer: '0', shape: true,
  vertices: jitteredCorridor.map(([x, y]) => ({ x, y })) }] }, '0', []);
const stableOrigin: [number, number] = [stableRoom.bbox.minX, stableRoom.bbox.minY];
const stableTiles = computeNesting({ ...base, rooms: [stableRoom],
  materialType: 'carpet_tile', tileConfig: { width: 500, height: 500 },
  originPoint: stableOrigin, roomOrigins: { [stableRoom.id]: stableOrigin } });
assert.equal(validateNesting([stableRoom], stableTiles, 'carpet_tile', base.broadloomConfig), null);
assert.ok(stableTiles.tiles.some((tile) => tile.col === 0 && tile.row === 6));
assert.ok(stableTiles.tiles.some((tile) => tile.col === 0 && tile.row === 7));
assert.throws(() => extractRoomsFromLayers({ entities: [{ ...duplicateOutline,
  vertices: [{ x: 0, y: 0, bulge: 1 }, ...duplicateOutline.vertices.slice(1)] }] }, 'ROOM', []), /bulge/);
const crossingOutline = { ...duplicateOutline,
  vertices: [[4000,0],[9000,0],[9000,5000],[4000,5000]].map(([x,y]) => ({x,y})) };
assert.throws(() => extractRoomsFromLayers({ entities: [duplicateOutline, crossingOutline] },
  'ROOM', []), /giao nhau/);

const a = room('A', 0, 0, 10000, 3000);
const b = room('B', 20000, 0, 1500, 9000);
const multi = computeNesting({ ...base, rooms: [a, b], materialType: 'broadloom' });
const optimized = optimizeOffcuts(multi, { enabled: true, minWidth: 100, minHeight: 100,
  minBroadloomWidth: 1000, allowRotate: false }, [a, b], base.broadloomConfig, 0, [0,0]);
assert.deepEqual(new Set(optimized.broadloomStrips.map((s) => s.roomId)), new Set(['A','B']));
assert.ok(missingArea(a, optimized.broadloomStrips.filter((s) => s.roomId === 'A').flatMap((s) => s.clippedPolygons)) < 1);
assert.ok(missingArea(b, optimized.broadloomStrips.filter((s) => s.roomId === 'B').flatMap((s) => s.clippedPolygons)) < 1);
assert.ok(optimized.offcutLinks.every((link) => optimized.broadloomStrips.some((s) => s.id === link.sourceTileId)));
const seamRoomA = room('SA', 0, 0, 3000, 2000);
const seamRoomB = room('SB', 0, 3970, 3000, 2000);
const seamRooms = computeNesting({ ...base, rooms: [seamRoomA, seamRoomB], materialType: 'broadloom' });
assert.equal(seamRooms.broadloomStrips.filter((s) => s.roomId === 'SB').length, 1);
assert.ok(seamRooms.broadloomStrips.filter((s) => s.roomId === 'SB').every((s) => s.usedAreaMm2 > 1_000_000));

const targetShape: Polygon = [[[0,0],[150,0],[150,150],[0,150],[0,0]]];
// Make the L arms 75 mm wide so its area exceeds the 150 mm square, yet it still cannot contain it.
const largeL: Polygon = [[[0,0],[200,0],[200,75],[75,75],[75,200],[0,200],[0,0]]];
const offcut = { id: 'O1', sourceTileId: 'T1', polygon: largeL,
  bbox: getRingBoundingBox(largeL[0]), center: [50,50], areaMm2: getPolygonArea(largeL),
  width: 200, height: 200, grainAngle: 0, isDiscarded: false };
const fakeTile = (id: string, shape: Polygon, area: number) => ({
  id, roomId: 'R', originalIndex: 1, row: 0, col: 0, rawPolygon: shape,
  clippedPolygons: [shape], status: 'cut', areaMm2: area, rawAreaMm2: 40000,
  coverageRatio: 0.5, rotationDeg: 0, grainAngle: 0, offcuts: [], center: [0,0],
});
const fake: NestingResult = {
  tiles: [fakeTile('T1', largeL, 24375), fakeTile('T2', targetShape, 22500)] as any,
  broadloomStrips: [], seams: [], offcutsAvailable: [offcut as any], offcutsReused: [],
  discardedScraps: [], offcutLinks: [], totalRawTiles: 2, totalLinearMeters: 0, computationTimeMs: 0,
};
const tileOptimized = optimizeOffcuts(fake, { enabled: true, minWidth: 100, minHeight: 100, allowRotate: false });
assert.equal(tileOptimized.offcutLinks.length, 0);
assert.equal(tileOptimized.totalRawTiles, 2);

const branchBoundary: Ring = [[0,0],[31940,0],[31940,1980],[22200,1980],
  [22200,12340],[19000,12340],[19000,1980],[0,1980]];
const branch: RoomGeometry = { id: 'BRANCH', name: 'BRANCH', boundary: branchBoundary,
  holes: [], bbox: getRingBoundingBox(branchBoundary), areaMm2: getPolygonArea([branchBoundary]) };
const branchRaw = computeNesting({ ...base, rooms: [branch], materialType: 'broadloom' });
const branchRawSnapshot = JSON.stringify(branchRaw);
const branchOptimized = optimizeOffcuts(branchRaw, { enabled: true, minWidth: 100,
  minHeight: 100, minBroadloomWidth: 1000, allowRotate: false },
  [branch], base.broadloomConfig, 0, [0,0]);
assert.equal(JSON.stringify(branchRaw), branchRawSnapshot);
assert.ok(missingArea(branch, branchOptimized.broadloomStrips.flatMap((s) => s.clippedPolygons)) < 1);
assert.ok(branchOptimized.totalLinearMeters <= branchRaw.totalLinearMeters + 0.001);
assert.ok(branchOptimized.offcutLinks.every((link) => branchOptimized.broadloomStrips.some((s) => s.id === link.sourceTileId)));
assert.equal(validateNesting([branch], branchOptimized, 'broadloom', base.broadloomConfig), null);
for (const strip of branchOptimized.broadloomStrips.filter((item) => item.id.startsWith('STRIP-NEW-'))) {
  assert.equal(strip.widthMm, base.broadloomConfig.rollWidth);
  assert.ok(Math.abs(strip.rawAreaMm2 - strip.widthMm * strip.lengthMm) < 100);
}
assert.ok(branchOptimized.offcutsAvailable.every((offcut) =>
  branchOptimized.broadloomStrips.some((strip) => strip.id === offcut.sourceTileId)));
const branchBOQ = calculateBOQ([branch], branchOptimized, 'broadloom',
  { width: 500, height: 500 }, base.broadloomConfig);
assert.ok(Math.abs(branchBOQ.extraAreaM2 - branchBOQ.reusableAreaM2 -
  branchBOQ.seamOverlapAreaM2 - branchBOQ.wasteAreaM2) < 1e-4);

const mockTiles = computeNesting({ ...base, rooms: MOCK_ROOMS, materialType: 'carpet_tile',
  tileConfig: { width: 500, height: 500 } });
assert.equal(validateNesting(MOCK_ROOMS, mockTiles, 'carpet_tile', base.broadloomConfig), null);
const overlappedTiles = { ...mockTiles, totalRawTiles: mockTiles.totalRawTiles + 1,
  tiles: [...mockTiles.tiles,
  { ...mockTiles.tiles[0], id: 'DUPLICATED-INSTALLATION' }] };
assert.match(validateNesting(MOCK_ROOMS, overlappedTiles, 'carpet_tile', base.broadloomConfig) ?? '', /chồng/);
const pvcBOQ = calculateBOQ([square], vinyl, 'lvt_pvc', { width: 914.4, height: 152.4,
  tilesPerBox: 12 }, base.broadloomConfig);
assert.equal(pvcBOQ.totalBoxesNeeded, Math.ceil(pvcBOQ.totalRawTilesNeeded / 12));
const mockRolls = computeNesting({ ...base, rooms: MOCK_ROOMS, materialType: 'broadloom' });
assert.equal(validateNesting(MOCK_ROOMS, mockRolls, 'broadloom', base.broadloomConfig), null);
const originsA = Object.fromEntries(MOCK_ROOMS.map((room) => [room.id, [room.bbox.minX, room.bbox.minY]]));
const originsB = { ...originsA, 'ROOM-2': [MOCK_ROOMS[1].bbox.minX, MOCK_ROOMS[1].bbox.minY + 900] };
const withOriginA = computeNesting({ ...base, rooms: MOCK_ROOMS, materialType: 'broadloom',
  roomOrigins: originsA });
const withOriginB = computeNesting({ ...base, rooms: MOCK_ROOMS, materialType: 'broadloom',
  roomOrigins: originsB });
assert.deepEqual(withOriginA.broadloomStrips.filter((strip) => strip.roomId === 'ROOM-1').map((strip) => strip.rawPolygon),
  withOriginB.broadloomStrips.filter((strip) => strip.roomId === 'ROOM-1').map((strip) => strip.rawPolygon));
assert.notDeepEqual(withOriginA.broadloomStrips.filter((strip) => strip.roomId === 'ROOM-2').map((strip) => strip.rawPolygon),
  withOriginB.broadloomStrips.filter((strip) => strip.roomId === 'ROOM-2').map((strip) => strip.rawPolygon));
const tileOriginA = computeNesting({ ...base, rooms: MOCK_ROOMS, materialType: 'carpet_tile',
  tileConfig: { width: 500, height: 500 }, roomOrigins: originsA });
const tileOriginB = computeNesting({ ...base, rooms: MOCK_ROOMS, materialType: 'carpet_tile',
  tileConfig: { width: 500, height: 500 }, roomOrigins: originsB });
assert.deepEqual(tileOriginA.tiles.filter((tile) => tile.roomId === 'ROOM-1').map((tile) => tile.rawPolygon),
  tileOriginB.tiles.filter((tile) => tile.roomId === 'ROOM-1').map((tile) => tile.rawPolygon));
assert.notDeepEqual(tileOriginA.tiles.filter((tile) => tile.roomId === 'ROOM-2').map((tile) => tile.rawPolygon),
  tileOriginB.tiles.filter((tile) => tile.roomId === 'ROOM-2').map((tile) => tile.rawPolygon));

for (const direction of ['horizontal', 'vertical'] as const) {
  const roll = { ...base.broadloomConfig, rollWidth: 3660, seamOverlap: 0, direction };
  const raw = computeNesting({ ...base, rooms: MOCK_ROOMS, materialType: 'broadloom',
    broadloomConfig: roll, roomOrigins: originsA });
  const reused = optimizeOffcuts(raw, { enabled: true, minWidth: 100, minHeight: 100,
    minBroadloomWidth: 1000, allowRotate: false }, MOCK_ROOMS, roll, 0, [0,0], originsA);
  assert.ok(reused.offcutLinks.length > 0);
  assert.ok(reused.totalLinearMeters < raw.totalLinearMeters);
  assert.equal(validateNesting(MOCK_ROOMS, reused, 'broadloom', roll), null);
  for (const offcut of reused.offcutsReused) {
    assert.ok((offcut.subSlices ?? []).reduce((sum, slice) => sum + getPolygonArea(slice.polygon), 0)
      <= offcut.areaMm2 + 100);
  }
}
for (const rollWidth of [3000, 3660, 4000]) for (const direction of ['horizontal', 'vertical'] as const) {
  const roll = { ...base.broadloomConfig, rollWidth, seamOverlap: 30, direction };
  const raw = computeNesting({ ...base, rooms: MOCK_ROOMS, materialType: 'broadloom',
    broadloomConfig: roll, roomOrigins: originsA });
  const result = optimizeOffcuts(raw, { enabled: true, minWidth: 100, minHeight: 100,
    minBroadloomWidth: 1000, allowRotate: false }, MOCK_ROOMS, roll, 0, [0,0], originsA);
  assert.equal(validateNesting(MOCK_ROOMS, result, 'broadloom', roll), null,
    `30 mm seam validation failed for ${rollWidth} mm ${direction}`);
}
// A remnant made in room 1 can replace purchased carpet in room 2.
for (const rollWidth of [3000, 3660, 4000]) {
  for (const direction of ['horizontal', 'vertical'] as const) {
    const roll = { ...base.broadloomConfig, rollWidth, seamOverlap: 0, direction };
    const raw = computeNesting({ ...base, rooms: MOCK_ROOMS, materialType: 'broadloom',
      broadloomConfig: roll, roomOrigins: originsA });
    const result = optimizeOffcuts(raw, { enabled: true, minWidth: 100, minHeight: 100,
      minBroadloomWidth: 1000, allowRotate: false }, MOCK_ROOMS, roll, 0, [0,0], originsA);
    const crossRoomPlan = optimizeBroadloomRemnantFirst(raw, MOCK_ROOMS, {
      enabled: true, minWidth: 100, minHeight: 100, minBroadloomWidth: 1000,
      allowRotate: false }, roll, 0, originsA);
    assert.ok(result.totalLinearMeters <= raw.totalLinearMeters + 0.001);
    assert.equal(validateNesting(MOCK_ROOMS, result, 'broadloom', roll), null);
    const summary = calculateBOQ(MOCK_ROOMS, result, 'broadloom',
      { width: 500, height: 500 }, roll);
    assert.equal(summary.installedPiecesCount, result.broadloomStrips.length);
    assert.ok(Math.abs(summary.savedAreaM2 - result.broadloomStrips
      .filter((strip) => strip.isReusedFromOffcut)
      .reduce((sum, strip) => sum + strip.usedAreaMm2 / 1_000_000, 0)) < 1e-6);
    assert.ok(Math.abs(summary.extraAreaM2 - summary.reusableAreaM2 -
      summary.seamOverlapAreaM2 - summary.wasteAreaM2) < 1e-4);
    assert.ok(generateBOQCSV(summary, 'broadloom', { width: 500, height: 500 },
      roll, 'monolithic', result, MOCK_ROOMS).includes('DANH SÁCH CẮT THẢM CUỘN'));
    for (const strip of result.broadloomStrips) {
      const cutArea = getPolygonArea(getBroadloomCutPolygon(strip));
      const outsideArea = getBroadloomOutsidePolygons(strip)
        .reduce((sum, polygon) => sum + getPolygonArea(polygon), 0);
      assert.ok(Math.abs(cutArea - strip.rawAreaMm2) < 100);
      assert.ok(Math.abs(outsideArea - (cutArea - strip.usedAreaMm2)) < 100);
    }
    for (const offcut of result.offcutsReused) {
      assert.ok((offcut.subSlices ?? []).reduce((sum, slice) => sum + getPolygonArea(slice.polygon), 0)
        <= offcut.areaMm2 + 100);
      for (const slice of offcut.subSlices ?? []) {
        const outside = polygonClipping.difference(slice.polygon as any, offcut.polygon as any) as Polygon[];
        assert.ok(outside.reduce((sum, polygon) => sum + getPolygonArea(polygon), 0) < 100);
      }
    }
    const stripRoom = new Map(crossRoomPlan.broadloomStrips.map((strip) => [strip.id, strip.roomId]));
    const firstRoom2Strip = raw.broadloomStrips.find((strip) => strip.roomId === 'ROOM-2');
    assert.ok(firstRoom2Strip && crossRoomPlan.broadloomStrips.some((strip) =>
      strip.id === firstRoom2Strip.id && !strip.isReusedFromOffcut),
    `Room 2 must start with new carpet when no remnant covers it: ${rollWidth} mm ${direction}`);
    assert.ok(crossRoomPlan.offcutLinks.every((link) =>
      Math.min(link.sourceWidthMm ?? 0, link.sourceHeightMm ?? 0) >= 1000),
    `A reused roll slice is below the configured 1 m limit for ${rollWidth} mm ${direction}`);
    assert.ok(crossRoomPlan.offcutLinks.some((link) => stripRoom.get(link.sourceTileId) !==
      stripRoom.get(link.targetTileId)), `Cross-room reuse missing for ${rollWidth} mm ${direction}`);
    assert.ok(crossRoomPlan.offcutLinks.every((link) =>
      MOCK_ROOMS.findIndex((room) => room.id === stripRoom.get(link.sourceTileId)) <=
      MOCK_ROOMS.findIndex((room) => room.id === stripRoom.get(link.targetTileId))));
    assert.ok(result.totalLinearMeters <= crossRoomPlan.totalLinearMeters + 0.001);
    if (rollWidth === 4000 && direction === 'horizontal') {
      assert.ok(crossRoomPlan.offcutLinks.some((link) => stripRoom.get(link.sourceTileId) === 'ROOM-1' &&
        stripRoom.get(link.targetTileId) === 'ROOM-2'), 'Room 2 should use room 1 roll remnant');
      assert.ok(crossRoomPlan.offcutLinks.some((link) => link.sourceTileId === 'STRIP-2' &&
        link.sourceWidthMm === 1500 && link.sourceHeightMm === 4500));
      assert.ok(result.totalLinearMeters < raw.totalLinearMeters);
    }
  }
}
const detailRoll = { ...base.broadloomConfig, rollWidth: 4000, seamOverlap: 0, direction: 'vertical' as const };
const detailRaw = computeNesting({ ...base, rooms: MOCK_ROOMS, materialType: 'broadloom',
  broadloomConfig: detailRoll, roomOrigins: originsA });
const detailResult = optimizeBroadloomRemnantFirst(detailRaw, MOCK_ROOMS, {
  enabled: true, minWidth: 100, minHeight: 100,
  minBroadloomWidth: 1000, allowRotate: false }, detailRoll, 0, originsA);
for (const strip of detailResult.broadloomStrips) {
  const cutArea = getPolygonArea(getBroadloomCutPolygon(strip));
  const outsideArea = getBroadloomOutsidePolygons(strip)
    .reduce((sum, polygon) => sum + getPolygonArea(polygon), 0);
  assert.ok(Math.abs(cutArea - strip.rawAreaMm2) < 100);
  assert.ok(Math.abs(outsideArea - (cutArea - strip.usedAreaMm2)) < 100);
}
const detailStrip = detailResult.broadloomStrips.find((strip) => strip.id === 'STRIP-NEW-ROOM-2-1');
assert.ok(detailStrip);
assert.equal(detailStrip.widthMm, 4000);
assert.equal(detailStrip.lengthMm, 3100);
assert.equal(getPolygonArea(getBroadloomCutPolygon(detailStrip)), 12_400_000);
assert.equal(getBroadloomOutsidePolygons(detailStrip).reduce((sum, polygon) =>
  sum + getPolygonArea(polygon), 0), 9_400_000);
const rotatedRoll = { ...base.broadloomConfig, rollWidth: 3660, seamOverlap: 0, direction: 'horizontal' as const };
const rotatedRaw = computeNesting({ ...base, rooms: MOCK_ROOMS, materialType: 'broadloom',
  broadloomConfig: rotatedRoll, rotationDeg: 90, roomOrigins: originsA });
const rotatedOptimized = optimizeOffcuts(rotatedRaw, { enabled: true, minWidth: 100,
  minHeight: 100, minBroadloomWidth: 1000, allowRotate: false },
  MOCK_ROOMS, rotatedRoll, 90, [0,0], originsA);
assert.equal(validateNesting(MOCK_ROOMS, rotatedOptimized, 'broadloom', rotatedRoll), null);
for (const direction of ['horizontal', 'vertical'] as const) {
  const diagonalRoll = { ...base.broadloomConfig, rollWidth: 4000, seamOverlap: 0, direction };
  const diagonalRaw = computeNesting({ ...base, rooms: MOCK_ROOMS, materialType: 'broadloom',
    broadloomConfig: diagonalRoll, rotationDeg: 45, roomOrigins: originsA });
  const diagonalResult = optimizeOffcuts(diagonalRaw, { enabled: true, minWidth: 100,
    minHeight: 100, minBroadloomWidth: 1000, allowRotate: false },
    MOCK_ROOMS, diagonalRoll, 45, [0,0], originsA);
  assert.ok(diagonalResult.totalLinearMeters <= diagonalRaw.totalLinearMeters + 0.001);
  assert.equal(validateNesting(MOCK_ROOMS, diagonalResult, 'broadloom', diagonalRoll), null);
}

const partialRoom = room('PARTIAL', 0, 0, 5000, 5800);
const pRect = (x1: number, y1: number, x2: number, y2: number): Polygon =>
  [[[x1,y1],[x2,y1],[x2,y2],[x1,y2],[x1,y1]]];
const sourceShape = pRect(5000, 0, 9500, 2800);
const sourceOffcut = { id: 'SOURCE', sourceTileId: 'PRIMARY', polygon: sourceShape,
  bbox: getRingBoundingBox(sourceShape[0]), center: [7250,1400], areaMm2: 12_600_000,
  width: 2800, height: 4500, grainAngle: 0, isDiscarded: false, isBroadloomLongitudinal: true };
const makeStrip = (id: string, clipped: Polygon, raw: Polygon, lengthMm: number) => ({
  id, name: id, roomId: partialRoom.id, index: 1, rawPolygon: raw,
  clippedPolygons: [clipped], rawAreaMm2: lengthMm * 3660,
  usedAreaMm2: getPolygonArea(clipped), lengthMm, widthMm: 3660, usedWidthMm: 3000,
  isReusedFromOffcut: false, offcuts: id === 'PRIMARY' ? [sourceOffcut] : [],
  center: [2500,1500], directionStart: [0,1500], directionEnd: [5000,1500],
});
const partialRaw: NestingResult = { tiles: [], broadloomStrips: [
  makeStrip('PRIMARY', pRect(0,0,5000,3000), pRect(0,0,10000,3000), 10000),
  makeStrip('RECEIVER', pRect(0,3000,5000,5800), pRect(0,3000,5000,5800), 5100),
] as any, seams: [], offcutsAvailable: [sourceOffcut as any], offcutsReused: [],
  discardedScraps: [], offcutLinks: [], totalRawTiles: 0, totalLinearMeters: 15.1,
  computationTimeMs: 0 };
const partialRoll = { ...base.broadloomConfig, rollWidth: 3660, direction: 'horizontal' as const };
const partialOptimized = optimizeOffcuts(partialRaw, { enabled: true, minWidth: 100,
  minHeight: 100, minBroadloomWidth: 1000, allowRotate: false },
  [partialRoom], partialRoll, 0, [0,0]);
assert.ok(partialOptimized.broadloomStrips.some((strip) => strip.isReusedFromOffcut));
assert.ok(partialOptimized.totalLinearMeters < partialRaw.totalLinearMeters);
assert.equal(validateNesting([partialRoom], partialOptimized, 'broadloom', partialRoll), null);
const partialVerticalRoom = room('PARTIAL-V', 0, 0, 5800, 5000);
const verticalSourceShape = pRect(0,5000,2800,9500);
const verticalOffcut = { ...sourceOffcut, id: 'SOURCE-V', polygon: verticalSourceShape,
  bbox: getRingBoundingBox(verticalSourceShape[0]), sourceTileId: 'PRIMARY-V' };
const verticalPrimary = { ...makeStrip('PRIMARY-V', pRect(0,0,3000,5000),
  pRect(0,0,3000,10000), 10000), roomId: partialVerticalRoom.id,
  offcuts: [verticalOffcut], directionStart: [1500,0], directionEnd: [1500,5000] };
const verticalReceiver = { ...makeStrip('RECEIVER-V', pRect(3000,0,5800,5000),
  pRect(3000,0,5800,5000), 5100), roomId: partialVerticalRoom.id,
  directionStart: [4400,0], directionEnd: [4400,5000] };
const verticalRaw: NestingResult = { ...partialRaw,
  broadloomStrips: [verticalPrimary, verticalReceiver] as any,
  offcutsAvailable: [verticalOffcut as any] };
const verticalPartialRoll = { ...partialRoll, direction: 'vertical' as const };
const verticalOptimized = optimizeOffcuts(verticalRaw, { enabled: true, minWidth: 100,
  minHeight: 100, minBroadloomWidth: 1000, allowRotate: false },
  [partialVerticalRoom], verticalPartialRoll, 0, [0,0]);
assert.ok(verticalOptimized.broadloomStrips.some((strip) => strip.isReusedFromOffcut));
assert.ok(verticalOptimized.totalLinearMeters < verticalRaw.totalLinearMeters);
assert.equal(validateNesting([partialVerticalRoom], verticalOptimized, 'broadloom', verticalPartialRoll), null);

// If one earlier remnant covers a later room, that room must use only the remnant.
for (const direction of ['horizontal', 'vertical'] as const) {
  const donorRoom = room('DONOR-ROOM', 0, 0, 3000, 3000);
  const receiverRoom = room('RECEIVER-ROOM', 8000, 0, 2000, 2000);
  const donorFloor = pRect(0, 0, 3000, 3000);
  const receiverFloor = pRect(8000, 0, 10000, 2000);
  const remnant = direction === 'horizontal' ? pRect(3000, 0, 5500, 3000)
    : pRect(0, 3000, 3000, 5500);
  const donorRaw = direction === 'horizontal' ? pRect(0, 0, 5500, 3000)
    : pRect(0, 0, 3000, 5500);
  const donorOffcut = { id: `WHOLE-${direction}`, sourceTileId: 'DONOR-STRIP',
    polygon: remnant, bbox: getRingBoundingBox(remnant[0]), center: [4000,1500],
    areaMm2: getPolygonArea(remnant), width: 2500, height: 3000, grainAngle: 0,
    isDiscarded: false, isBroadloomLongitudinal: true };
  const donorStrip = { id: 'DONOR-STRIP', name: 'Donor', roomId: donorRoom.id, index: 1,
    rawPolygon: donorRaw, clippedPolygons: [donorFloor], rawAreaMm2: 5600 * 4000,
    usedAreaMm2: donorRoom.areaMm2, lengthMm: 5600, widthMm: 4000, usedWidthMm: 3000,
    isReusedFromOffcut: false, offcuts: [donorOffcut], center: [1500,1500],
    directionStart: [0,1500], directionEnd: [3000,1500] };
  const receiverStrip = { ...donorStrip, id: 'RECEIVER-STRIP', name: 'Receiver',
    roomId: receiverRoom.id, rawPolygon: receiverFloor, clippedPolygons: [receiverFloor],
    rawAreaMm2: 2100 * 4000, usedAreaMm2: receiverRoom.areaMm2, lengthMm: 2100,
    usedWidthMm: 2000, offcuts: [], center: [9000,1000] };
  const raw: NestingResult = { tiles: [], broadloomStrips: [donorStrip, receiverStrip] as any,
    seams: [], offcutsAvailable: [donorOffcut as any], offcutsReused: [], discardedScraps: [],
    offcutLinks: [], totalRawTiles: 0, totalLinearMeters: 7.7, computationTimeMs: 0 };
  const roll = { ...base.broadloomConfig, rollWidth: 4000, seamOverlap: 0, direction };
  const result = optimizeOffcuts(raw, { enabled: true, minWidth: 100, minHeight: 100,
    minBroadloomWidth: 1000, allowRotate: false }, [donorRoom, receiverRoom], roll, 0,
    [0,0], { 'DONOR-ROOM': [0,0], 'RECEIVER-ROOM': [8000,0] });
  const crossRoomPlan = optimizeBroadloomRemnantFirst(raw, [donorRoom, receiverRoom], {
    enabled: true, minWidth: 100, minHeight: 100, minBroadloomWidth: 1000,
    allowRotate: false }, roll, 0,
    { 'DONOR-ROOM': [0,0], 'RECEIVER-ROOM': [8000,0] });
  const receiverPieces = crossRoomPlan.broadloomStrips.filter((strip) => strip.roomId === receiverRoom.id);
  assert.equal(receiverPieces.length, 1);
  assert.ok(receiverPieces[0].isReusedFromOffcut);
  assert.equal(crossRoomPlan.totalLinearMeters, 5.6);
  assert.ok(result.totalLinearMeters <= crossRoomPlan.totalLinearMeters + 0.001);
  assert.equal(validateNesting([donorRoom, receiverRoom], crossRoomPlan, 'broadloom', roll), null);
  assert.equal(validateNesting([donorRoom, receiverRoom], result, 'broadloom', roll), null);
}

// Even a one-strip room can start with a shorter new cut and finish with an earlier remnant.
for (const direction of ['horizontal', 'vertical'] as const) {
  const donorRoom = room('START-DONOR', 0, 0, 3000, 3000);
  const receiverRoom = direction === 'horizontal'
    ? room('START-RECEIVER', 8000, 0, 5000, 3000)
    : room('START-RECEIVER', 8000, 0, 3000, 5000);
  const donorFloor = pRect(0, 0, 3000, 3000);
  const donorRaw = direction === 'horizontal' ? pRect(0, 0, 7000, 3000)
    : pRect(0, 0, 3000, 7000);
  const remnant = direction === 'horizontal' ? pRect(3000, 0, 7000, 3000)
    : pRect(0, 3000, 3000, 7000);
  const receiverFloor = pRect(receiverRoom.bbox.minX, receiverRoom.bbox.minY,
    receiverRoom.bbox.maxX, receiverRoom.bbox.maxY);
  const donorOffcut = { id: `START-OFF-${direction}`, sourceTileId: 'START-DONOR-STRIP',
    polygon: remnant, bbox: getRingBoundingBox(remnant[0]), center: [4500,1500],
    areaMm2: getPolygonArea(remnant), width: 3000, height: 4000, grainAngle: 0,
    isDiscarded: false, isBroadloomLongitudinal: true };
  const donorStrip = { id: 'START-DONOR-STRIP', name: 'Donor', roomId: donorRoom.id,
    index: 1, rawPolygon: donorRaw, clippedPolygons: [donorFloor],
    rawAreaMm2: 7100 * 4000, usedAreaMm2: donorRoom.areaMm2,
    lengthMm: 7100, widthMm: 4000, usedWidthMm: 3000,
    isReusedFromOffcut: false, offcuts: [donorOffcut], center: [1500,1500],
    directionStart: [0,1500], directionEnd: [3000,1500] };
  const receiverStrip = { ...donorStrip, id: 'START-RECEIVER-STRIP', name: 'Receiver',
    roomId: receiverRoom.id, rawPolygon: receiverFloor, clippedPolygons: [receiverFloor],
    rawAreaMm2: 5100 * 4000, usedAreaMm2: receiverRoom.areaMm2,
    lengthMm: 5100, offcuts: [], center: [9000,1500] };
  const raw: NestingResult = { tiles: [], broadloomStrips: [donorStrip, receiverStrip] as any,
    seams: [], offcutsAvailable: [donorOffcut as any], offcutsReused: [], discardedScraps: [],
    offcutLinks: [], totalRawTiles: 0, totalLinearMeters: 12.2, computationTimeMs: 0 };
  const roll = { ...base.broadloomConfig, rollWidth: 4000, seamOverlap: 0, direction };
  const result = optimizeBroadloomRemnantFirst(raw, [donorRoom, receiverRoom], {
    enabled: true, minWidth: 100, minHeight: 100, minBroadloomWidth: 1000,
    allowRotate: false }, roll, 0,
    { 'START-DONOR': [0,0], 'START-RECEIVER': [8000,0] });
  const receiverPieces = result.broadloomStrips.filter((strip) => strip.roomId === receiverRoom.id);
  assert.equal(receiverPieces.length, 2);
  assert.ok(receiverPieces[0].id.startsWith('STRIP-START-'));
  assert.ok(!receiverPieces[0].isReusedFromOffcut && receiverPieces[1].isReusedFromOffcut);
  assert.ok(result.totalLinearMeters < raw.totalLinearMeters);
  assert.equal(validateNesting([donorRoom, receiverRoom], result, 'broadloom', roll), null);
  const thirdRoom = room('START-THIRD', 17000, 0, 1000, 1000);
  const thirdFloor = pRect(17000, 0, 18000, 1000);
  const thirdStrip = { ...receiverStrip, id: 'START-THIRD-STRIP', name: 'Third',
    roomId: thirdRoom.id, rawPolygon: thirdFloor, clippedPolygons: [thirdFloor],
    rawAreaMm2: 1100 * 4000, usedAreaMm2: thirdRoom.areaMm2, lengthMm: 1100,
    usedWidthMm: 1000, center: [17500,500],
    directionStart: direction === 'horizontal' ? [17000,500] : [17500,0],
    directionEnd: direction === 'horizontal' ? [18000,500] : [17500,1000] };
  const threeRoomRaw: NestingResult = { ...raw,
    broadloomStrips: [...raw.broadloomStrips, thirdStrip] as any,
    totalLinearMeters: 13.3 };
  const threeRoomResult = optimizeBroadloomRemnantFirst(threeRoomRaw,
    [donorRoom, receiverRoom, thirdRoom], { enabled: true, minWidth: 100,
    minHeight: 100, minBroadloomWidth: 1000, allowRotate: false }, roll, 0,
    { 'START-DONOR': [0,0], 'START-RECEIVER': [8000,0], 'START-THIRD': [17000,0] });
  assert.ok(threeRoomResult.offcutLinks.some((link) =>
    link.sourceTileId.startsWith('STRIP-START-') && link.targetTileId.includes('START-THIRD')),
  `Newly purchased room-2 strip should supply room 3 (${direction})`);
  assert.equal(validateNesting([donorRoom, receiverRoom, thirdRoom], threeRoomResult,
    'broadloom', roll), null);
}

// A long remnant with a small corner notch must still supply rectangular cuts.
// These room dimensions reproduce the 66.7 m² / 32.6 m² case with a 4 m roll.
const longRoomBoundary: Ring = [[0,0],[31940,0],[31940,3740],
  [29960,3740],[29960,1980],[0,1980]];
const narrowRoomBoundary: Ring = [[50000,0],[53210,0],[53210,10710],
  [51330,10710],[51330,9380],[50000,9380]];
const longRoom: RoomGeometry = { id: 'LONG-ROOM', name: 'Long room',
  boundary: longRoomBoundary, holes: [], bbox: getRingBoundingBox(longRoomBoundary),
  areaMm2: getPolygonArea([longRoomBoundary]) };
const narrowRoom: RoomGeometry = { id: 'NARROW-ROOM', name: 'Narrow room',
  boundary: narrowRoomBoundary, holes: [], bbox: getRingBoundingBox(narrowRoomBoundary),
  areaMm2: getPolygonArea([narrowRoomBoundary]) };
const notchedRooms = [longRoom, narrowRoom];
const notchedRoll = { ...base.broadloomConfig, rollWidth: 4000, seamOverlap: 0,
  direction: 'horizontal' as const };
const notchedOrigins = { 'LONG-ROOM': [0,0] as [number,number],
  'NARROW-ROOM': [50000,0] as [number,number] };
const notchedRaw = computeNesting({ ...base, rooms: notchedRooms,
  materialType: 'broadloom', broadloomConfig: notchedRoll,
  roomOrigins: notchedOrigins });
assert.equal(notchedRaw.broadloomStrips.length, 4);
assert.ok(Math.abs(notchedRaw.totalLinearMeters - 41.97) < 0.001);
const notchedResult = optimizeOffcuts(notchedRaw, { enabled: true,
  minWidth: 100, minHeight: 100, minBroadloomWidth: 1000, allowRotate: false },
  notchedRooms, notchedRoll, 0, [0,0], notchedOrigins);
const notchedLegacy = optimizeBroadloomRemnantFirst(notchedRaw, notchedRooms, {
  enabled: true, minWidth: 100, minHeight: 100, minBroadloomWidth: 1000,
  allowRotate: false }, notchedRoll, 0, notchedOrigins);
assert.ok(notchedLegacy.offcutLinks.some((link) =>
  notchedLegacy.broadloomStrips.find((strip) => strip.id === link.sourceTileId)?.roomId === longRoom.id &&
  notchedLegacy.broadloomStrips.find((strip) => strip.id === link.targetTileId)?.roomId === narrowRoom.id),
  'The usable rectangle of a notched remnant should cover the later room');
assert.ok(notchedResult.totalLinearMeters <= 37.34);
assert.ok(notchedResult.totalLinearMeters <= notchedLegacy.totalLinearMeters + 0.001);
assert.equal(validateNesting(notchedRooms, notchedLegacy, 'broadloom', notchedRoll), null);
assert.equal(validateNesting(notchedRooms, notchedResult, 'broadloom', notchedRoll), null);

const joinedBoundary: Ring = [[0,0],[31940,0],[31940,3740],[29960,3740],
  [29960,1980],[22160,1980],[22160,12690],[20280,12690],
  [20280,11360],[18950,11360],[18950,1980],[0,1980]];
const joinedRoom: RoomGeometry = { id: 'JOINED', name: 'Joined room',
  boundary: joinedBoundary, holes: [], bbox: getRingBoundingBox(joinedBoundary),
  areaMm2: getPolygonArea([joinedBoundary]) };
const joinedRoll = { ...base.broadloomConfig, rollWidth: 3660, seamOverlap: 0,
  direction: 'horizontal' as const };
const joinedRaw = computeNesting({ ...base, rooms: [joinedRoom],
  materialType: 'broadloom', broadloomConfig: joinedRoll });
const joinedResult = optimizeOffcuts(joinedRaw, { enabled: true,
  minWidth: 100, minHeight: 100, minBroadloomWidth: 1000, allowRotate: false },
  [joinedRoom], joinedRoll, 0, [0,0]);
const joinedLegacy = optimizeBroadloomRemnantFirst(joinedRaw, [joinedRoom], {
  enabled: true, minWidth: 100, minHeight: 100, minBroadloomWidth: 1000,
  allowRotate: false }, joinedRoll, 0);
const shortRemnant = joinedLegacy.offcutsAvailable.find((offcut) =>
  offcut.width === 1680 && offcut.height === 7800);
assert.ok(shortRemnant, 'The 7.8 m × 1.68 m remnant must be available');
assert.ok((shortRemnant.subSlices?.length ?? 0) >= 2,
  'The 7.8 m × 1.68 m remnant must supply at least two installed cuts');
assert.deepEqual(shortRemnant.subSlices?.slice(0, 2).map((slice) => slice.code),
  ['S-01', 'S-02']);
assert.ok(joinedLegacy.offcutLinks.filter((link) =>
  link.sourceOffcutId === shortRemnant.id).length >= 2);
assert.ok(Math.abs((shortRemnant.remainingAreaMm2 ?? 0) -
  (shortRemnant.areaMm2 - (shortRemnant.subSlices ?? []).reduce((sum, slice) =>
    sum + getPolygonArea(slice.polygon), 0))) < 100);
assert.ok(joinedResult.totalLinearMeters <= 32.04 + 0.001,
  'The remaining narrow floor edges should be covered by eligible remnant cuts');
assert.ok(joinedResult.totalLinearMeters <= joinedLegacy.totalLinearMeters + 0.001);
assert.equal(validateNesting([joinedRoom], joinedLegacy, 'broadloom', joinedRoll), null);
assert.equal(validateNesting([joinedRoom], joinedResult, 'broadloom', joinedRoll), null);
const joinedBOQ = calculateBOQ([joinedRoom], joinedResult, 'broadloom',
  { width: 500, height: 500 }, joinedRoll);
assert.ok(Math.abs(joinedBOQ.extraAreaM2 - joinedBOQ.reusableAreaM2 -
  joinedBOQ.seamOverlapAreaM2 - joinedBOQ.wasteAreaM2) < 1e-4);
assert.ok(Math.abs(joinedBOQ.lossPercentage -
  (joinedBOQ.grossAreaM2 - joinedBOQ.netFloorAreaM2) /
    joinedBOQ.netFloorAreaM2 * 100) < 1e-6);

// Coordinates from the supplied corridor DXF include small non-orthogonal CAD
// deviations. The 7.8 m remnant must still provide full-size cuts safely.
const cadBoundary: Ring = [
  [-177864.9491032526, -168046.5153174596],
  [-177864.9491032526, -164306.338979853],
  [-179845.1946949804, -164306.4236479613],
  [-179845.1947500612, -166066.4598596623],
  [-187640.0042332982, -166066.5144160865],
  [-187640.0586745695, -155706.5520975516],
  [-189520.0068747718, -155706.5516605262],
  [-189520.0066463106, -156166.6131974434],
  [-190849.9888633755, -156166.6131974434],
  [-190850.0054716254, -166066.5144347537],
  [-209800.0520665267, -166066.5144347537],
  [-209800.0450969193, -168047.0136486097],
];
const cadRoom: RoomGeometry = { id: 'CAD-CORRIDOR', name: 'CAD corridor',
  boundary: cadBoundary, holes: [], bbox: getRingBoundingBox(cadBoundary),
  areaMm2: getPolygonArea([cadBoundary]) };
const cadOrigin: [number, number] = [cadRoom.bbox.minX, cadRoom.bbox.minY];
const cadOrigins = { [cadRoom.id]: cadOrigin };
const cadRoll = { ...joinedRoll, cutAllowanceMm: 100 };
const cadRaw = computeNesting({ ...base, rooms: [cadRoom], materialType: 'broadloom',
  broadloomConfig: cadRoll, originPoint: cadOrigin, roomOrigins: cadOrigins,
  minBroadloomOffcutMm: 1000 });
const cadResult = optimizeOffcuts(cadRaw, { enabled: true, minWidth: 100,
  minHeight: 100, minBroadloomWidth: 1000, allowRotate: false },
  [cadRoom], cadRoll, 0, cadOrigin, cadOrigins);
const cadLegacy = optimizeBroadloomRemnantFirst(cadRaw, [cadRoom], {
  enabled: true, minWidth: 100, minHeight: 100, minBroadloomWidth: 1000,
  allowRotate: false }, cadRoll, 0, cadOrigins);
const cadShortRemnant = cadLegacy.offcutsAvailable.find((offcut) =>
  offcut.height > 7794 && offcut.height < 7795 && offcut.width > 1679);
assert.ok(cadShortRemnant, 'The original DXF must yield its 7.8 m remnant');
assert.ok((cadShortRemnant.subSlices?.length ?? 0) >= 2,
  'The original DXF remnant must provide two full-size installed cuts');
assert.deepEqual(cadShortRemnant.subSlices?.slice(0, 2).map((slice) => slice.code),
  ['S-01', 'S-02']);
assert.ok(cadResult.totalLinearMeters <= 32.04);
assert.ok(cadResult.totalLinearMeters <= cadLegacy.totalLinearMeters + 0.001);
assert.equal(validateNesting([cadRoom], cadLegacy, 'broadloom', cadRoll), null);
assert.equal(validateNesting([cadRoom], cadResult, 'broadloom', cadRoll), null);

// The 4 m / 12 m roll setting from the supplied screenshot puts P-02 next to
// a concave trimmed piece. Its rectangular cutting blank may cross P-02, but
// neither installed carpet nor the on-floor ghost may be drawn over P-02.
const shortCadRoll = { ...cadRoll, rollWidth: 4000, maxRollLength: 12000 };
const shortCadRaw = computeNesting({ ...base, rooms: [cadRoom],
  materialType: 'broadloom', broadloomConfig: shortCadRoll,
  originPoint: cadOrigin, roomOrigins: cadOrigins, minBroadloomOffcutMm: 1000 });
const shortCadResult = optimizeOffcuts(shortCadRaw, { enabled: true, minWidth: 100,
  minHeight: 100, minBroadloomWidth: 1000, allowRotate: false },
  [cadRoom], shortCadRoll, 0, cadOrigin, cadOrigins);
const p02 = shortCadResult.broadloomStrips.find((strip) => strip.matchingCode === 'P-02');
const p04 = shortCadResult.broadloomStrips.find((strip) => strip.matchingCode === 'P-04');
assert.ok(p02 && p04, 'The screenshot layout must include P-02 and P-04');
const intersectArea = (a: Polygon, b: Polygon) =>
  (polygonClipping.intersection(a as any, b as any) as Polygon[])
    .reduce((sum, polygon) => sum + getPolygonArea(polygon), 0);
assert.ok(intersectArea(getBroadloomCutPolygon(p04), p02.clippedPolygons[0]) > 1_000_000,
  'The cutting blank explains the apparent overlap');
assert.ok(p02.clippedPolygons.flatMap((a) => p04.clippedPolygons.map((b) =>
  intersectArea(a, b))).reduce((sum, area) => sum + area, 0) < 100,
  'Installed P-02 and P-04 must not overlap');
assert.ok(getBroadloomOutsideFloorPolygons(p04, cadRoom).every((ghost) =>
  p02.clippedPolygons.every((installed) => intersectArea(ghost, installed) < 100)),
  'The displayed cutting blank must not cover installed P-02');
assert.equal(validateNesting([cadRoom], shortCadResult, 'broadloom', shortCadRoll), null);

// The supplied straight-corridor DXF: one shorter 4 m roll supplies both the
// main run and its own longitudinal remnant for the rest of the corridor.
const straightBoundary: Ring = [
  [-117885.5704969612, -168046.5153174596],
  [-117885.5704969612, -164306.338979853],
  [-119865.8160886889, -164306.4236479613],
  [-119865.8161437696, -166066.4598596623],
  [-127660.6256270067, -166066.5144160865],
  [-149820.6734602352, -166066.5144347537],
  [-149820.6664906278, -168047.0136486097],
];
const straightRoom: RoomGeometry = { id: 'STRAIGHT', name: 'Straight corridor',
  boundary: straightBoundary, holes: [], bbox: getRingBoundingBox(straightBoundary),
  areaMm2: getPolygonArea([straightBoundary]) };
const straightOrigin: [number, number] = [straightRoom.bbox.minX, straightRoom.bbox.minY];
const straightRoll = { ...base.broadloomConfig, cutAllowanceMm: 100, seamOverlap: 0 };
const straightRaw = computeNesting({ ...base, rooms: [straightRoom],
  materialType: 'broadloom', broadloomConfig: straightRoll, originPoint: straightOrigin });
const straightResult = optimizeOffcuts(straightRaw, { enabled: true,
  minWidth: 100, minHeight: 100, minBroadloomWidth: 1000, allowRotate: false },
  [straightRoom], straightRoll, 0, straightOrigin);
assert.equal(straightRaw.broadloomStrips.length, 1);
assert.ok(straightResult.totalLinearMeters < 18,
  'A 4 m roll shorter than 18 m should cover this 31.94 m corridor');
assert.ok(straightResult.offcutLinks.length >= 2,
  'The longitudinal remnant should cover the straight run and widened end');
assert.ok(straightResult.offcutLinks.every((link) =>
  straightResult.broadloomStrips.some((strip) => strip.id === link.sourceTileId &&
    !strip.isReusedFromOffcut)));
assert.equal(validateNesting([straightRoom], straightResult, 'broadloom', straightRoll), null);

// The supplied perpendicular corridor has two short cross strips and one
// 25.71 m vertical strip. Splitting the long strip should also feed the cross
// arm, including the CAD offcut with a tiny protruding edge.
const middleBoundary: Ring = [
  [89705.12379168138, -209191.8366835531],
  [89705.12379168138, -217811.8880310057],
  [91685.30344387272, -217811.88902255],
  [91685.31631771161, -192101.9802654964],
  [89706.11121421422, -192101.9956813029],
  [89705.82095915894, -206781.7726879026],
  [80030.3117857584, -206781.7726879026],
  [80030.31226851852, -209192.0156811722],
];
const middleRoom: RoomGeometry = { id: 'MIDDLE', name: 'Perpendicular corridor',
  boundary: middleBoundary, holes: [], bbox: getRingBoundingBox(middleBoundary),
  areaMm2: getPolygonArea([middleBoundary]) };
const middleOrigin: [number, number] = [middleRoom.bbox.maxX, middleRoom.bbox.maxY];
const middleRoll = { ...base.broadloomConfig, rollWidth: 4000,
  direction: 'vertical' as const, seamOverlap: 0, cutAllowanceMm: 100 };
const middleRaw = computeNesting({ ...base, rooms: [middleRoom], materialType: 'broadloom',
  broadloomConfig: middleRoll, originPoint: middleOrigin, minBroadloomOffcutMm: 1000 });
const middleResult = optimizeOffcuts(middleRaw, { enabled: true,
  minWidth: 100, minHeight: 100, minBroadloomWidth: 1000, allowRotate: false },
  [middleRoom], middleRoll, 0, middleOrigin);
assert.ok(middleRaw.totalLinearMeters > 30);
assert.ok(middleResult.totalLinearMeters < 19,
  'The perpendicular corridor should use one shortened roll and its offcuts');
assert.equal(middleResult.broadloomStrips.filter((strip) => !strip.isReusedFromOffcut).length, 1);
assert.ok(middleResult.offcutLinks.length >= 5);
assert.equal(validateNesting([middleRoom], middleResult, 'broadloom', middleRoll), null);
const middleBOQ = calculateBOQ([middleRoom], middleResult, 'broadloom',
  { width: 500, height: 500 }, middleRoll);
assert.ok(middleBOQ.grossAreaM2 >= middleBOQ.netFloorAreaM2);
assert.ok(middleBOQ.lossPercentage < 3);

console.log('Regression checks passed');
