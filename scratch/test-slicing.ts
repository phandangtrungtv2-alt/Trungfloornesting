import { computeNesting } from '../src/services/nestingEngine';
import { optimizeOffcuts } from '../src/services/offcutManager';
import { getRingBoundingBox, getPolygonArea } from '../src/services/geometryMath';
import { RoomGeometry, Ring } from '../src/types';

// Room from screenshot: inverted L / gamma shape
// Top corridor: (0, 8300) to (10000, 8300) to (10000, 10000) to (0, 10000)
// Right wing: (8300, 0) to (10000, 0) to (10000, 8300) to (8300, 8300)
const boundary: Ring = [
  [0, 8300],
  [8300, 8300],
  [8300, 0],
  [10000, 0],
  [10000, 10000],
  [0, 10000],
];

const room: RoomGeometry = {
  id: 'ROOM-1',
  name: 'Phòng 1 (34.0 m²)',
  boundary,
  holes: [],
  bbox: getRingBoundingBox(boundary),
  areaMm2: getPolygonArea([boundary]),
};

const nesting = computeNesting({
  rooms: [room],
  materialType: 'broadloom',
  tileConfig: { width: 500, height: 500 },
  pattern: 'monolithic',
  rotationDeg: 0,
  originPoint: [0, 0],
  broadloomConfig: {
    rollWidth: 3660,
    maxRollLength: 35000,
    seamOverlap: 0,
    direction: 'vertical',
  },
});

console.log('Strips generated:', nesting.broadloomStrips.length);
console.log('Offcuts available:', nesting.offcutsAvailable.length);

const optimized = optimizeOffcuts(
  nesting,
  { enabled: true, minWidth: 200, minHeight: 200, allowRotate: false },
  [room],
  {
    rollWidth: 3660,
    maxRollLength: 35000,
    seamOverlap: 0,
    direction: 'vertical',
  },
  0,
  [0, 0]
);

console.log('\n--- OPTIMIZATION RESULTS ---');
console.log('Final broadloom strips:', optimized.broadloomStrips.length);
for (const s of optimized.broadloomStrips) {
  console.log(`  Strip: ${s.id} | ${s.name} | Reused: ${s.isReusedFromOffcut} | SliceCode: ${s.sourceSliceCode} | MatchingCode: ${s.matchingCode}`);
}

console.log('\nOffcuts reused count:', optimized.offcutsReused.length);
for (const off of optimized.offcutsReused) {
  console.log(`\nRemnant: ${off.id} | Size: ${(off.width/1000).toFixed(2)}m x ${(off.height/1000).toFixed(2)}m`);
  console.log(`  Assigned: ${off.assignedToTileId}`);
  console.log(`  Remaining length: ${off.remainingLengthMm} mm`);
  console.log(`  SubSlices count: ${off.subSlices?.length || 0}`);
  if (off.subSlices) {
    for (const sl of off.subSlices) {
      console.log(`    Slice ${sl.code} ➔ ${sl.targetCode}: ${sl.widthMm}x${sl.lengthMm}mm | Center: (${sl.center[0].toFixed(1)}, ${sl.center[1].toFixed(1)})`);
    }
  }
  if (off.leftoverPolygon) {
    console.log(`  Leftover polygon present: ${off.leftoverPolygon.length} rings`);
  }
}

console.log('\nOffcut links count:', optimized.offcutLinks.length);
for (const link of optimized.offcutLinks) {
  console.log(`  Link: ${link.sourceCode} ➔ ${link.targetCode} | SourceCenter: (${link.sourceCenter[0].toFixed(1)}, ${link.sourceCenter[1].toFixed(1)}) ➔ TargetCenter: (${link.targetCenter[0].toFixed(1)}, ${link.targetCenter[1].toFixed(1)})`);
}
