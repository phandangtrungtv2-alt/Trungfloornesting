import { computeNesting } from '../src/services/nestingEngine';
import { RoomGeometry, BroadloomConfig, BroadloomStrip, BroadloomSeam, OffcutFlowLink, OffcutItem, Polygon, Ring, Point } from '../src/types';
import { getRingBoundingBox, getPolygonBoundingBox, getPolygonArea, rotatePoint, rotateRing, ensureClosedRing, formatRollWidth } from '../src/services/geometryMath';
import polygonClipping from 'polygon-clipping';

const boundary: [number, number][] = [
  [0, 0],
  [31940, 0],
  [31940, 1980],
  [22200, 1980],
  [22200, 12340],
  [19000, 12340],
  [19000, 1980],
  [0, 1980],
];

const room: RoomGeometry = {
  id: 'ROOM-1',
  name: 'Phòng 1',
  boundary,
  holes: [],
  bbox: getRingBoundingBox(boundary),
  areaMm2: getPolygonArea([boundary]),
};

interface RemnantPoolItem {
  offcut: OffcutItem;
  remWidth: number;
  remLengthRemaining: number;
  initialLength: number;
  totalUsed: number;
  usedPiecesCount: number;
}

function testMultiRemnantAllocation(w: number) {
  console.log(`\n=================== MULTI-REMNANT TEST: ${w} mm ===================`);
  const config: BroadloomConfig = {
    rollWidth: w,
    maxRollLength: 35000,
    seamOverlap: 0,
    direction: 'horizontal',
  };

  const raw = computeNesting({
    rooms: [room],
    materialType: 'broadloom',
    tileConfig: { width: 500, height: 500 },
    broadloomConfig: config,
    pattern: 'monolithic',
    rotationDeg: 0,
    originPoint: [0, 0],
  });

  console.log(`Raw strips (${raw.broadloomStrips.length}):`);
  raw.broadloomStrips.forEach(s => {
    console.log(`  ${s.name}: len=${(s.lengthMm/1000).toFixed(2)}m, W=${(s.widthMm/1000).toFixed(2)}m, usedW=${(s.usedWidthMm/1000).toFixed(2)}m`);
  });

  const availableRemnants = raw.offcutsAvailable
    .filter((off) => off.isBroadloomLongitudinal && off.areaMm2 >= 500_000)
    .sort((a, b) => b.areaMm2 - a.areaMm2);

  console.log(`Available Remnants (${availableRemnants.length}):`);
  availableRemnants.forEach(o => {
    console.log(`  ${o.id}: ${(o.areaMm2/1e6).toFixed(2)}m2, W=${(o.width/1000).toFixed(2)}m, H=${(o.height/1000).toFixed(2)}m`);
  });

  // Setup remnant pool
  const pool: RemnantPoolItem[] = availableRemnants.map(off => ({
    offcut: off,
    remWidth: Math.min(off.width, off.height),
    remLengthRemaining: Math.max(off.width, off.height),
    initialLength: Math.max(off.width, off.height),
    totalUsed: 0,
    usedPiecesCount: 0,
  }));

  const maxLen = Math.max(...raw.broadloomStrips.map((s) => s.lengthMm));
  const primaryStrips = raw.broadloomStrips.filter((s) => s.lengthMm >= maxLen * 0.65);
  const receiverStrips = raw.broadloomStrips.filter((s) => s.lengthMm < maxLen * 0.65);

  let minLocalX = Infinity, maxLocalX = -Infinity;
  let minLocalY = Infinity, maxLocalY = -Infinity;

  for (const strip of receiverStrips) {
    for (const poly of strip.clippedPolygons) {
      for (const ring of poly) {
        for (const pt of ring) {
          if (pt[0] < minLocalX) minLocalX = pt[0];
          if (pt[0] > maxLocalX) maxLocalX = pt[0];
          if (pt[1] < minLocalY) minLocalY = pt[1];
          if (pt[1] > maxLocalY) maxLocalY = pt[1];
        }
      }
    }
  }

  const gapWidth = maxLocalX - minLocalX;
  const cutStrips: BroadloomStrip[] = [];
  const offcutLinks: OffcutFlowLink[] = [];
  let pieceIdx = 0;
  let currY = minLocalY;

  const roomPolygon: Polygon = [room.boundary];

  while (currY < maxLocalY - 5) {
    const remainingHeight = maxLocalY - currY;
    const pieceWidth = gapWidth;

    // Find a remnant in pool that can supply pieceWidth
    const candidate = pool.find(
      r => r.remLengthRemaining >= pieceWidth * 0.95 && r.remWidth >= 50
    );

    if (candidate) {
      pieceIdx++;
      const pieceHeight = Math.min(candidate.remWidth, remainingHeight);
      const nextY = currY + pieceHeight;

      const localRing: Ring = [
        [minLocalX, currY],
        [maxLocalX, currY],
        [maxLocalX, nextY],
        [minLocalX, nextY],
      ];
      const piecePoly: Polygon = [ensureClosedRing(localRing)];

      let clipped: Polygon[] = [piecePoly];
      try {
        const res = polygonClipping.intersection(piecePoly as any, roomPolygon as any) as unknown as Polygon[];
        if (res && res.length > 0) clipped = res;
      } catch {}

      const usedArea = clipped.reduce((sum, p) => sum + getPolygonArea(p), 0);
      const center: Point = [(minLocalX + maxLocalX) / 2, (currY + nextY) / 2];

      const pieceName = `MẢNH CẮT ${pieceIdx} (${(pieceWidth / 1000).toFixed(1)}m x ${(pieceHeight / 1000).toFixed(1)}m)`;
      const stripItem: BroadloomStrip = {
        id: `STRIP-CUT-${pieceIdx}`,
        name: pieceName,
        roomId: room.id,
        index: pieceIdx,
        rawPolygon: piecePoly,
        clippedPolygons: clipped,
        rawAreaMm2: pieceWidth * pieceHeight,
        usedAreaMm2: usedArea,
        lengthMm: pieceWidth,
        widthMm: pieceHeight,
        usedWidthMm: pieceHeight,
        isReusedFromOffcut: true,
        reusedFromId: candidate.offcut.id,
        offcuts: [],
        center,
        directionStart: [minLocalX, (currY + nextY) / 2],
        directionEnd: [maxLocalX, (currY + nextY) / 2],
      };
      cutStrips.push(stripItem);

      candidate.remLengthRemaining -= pieceWidth;
      candidate.totalUsed += pieceWidth;
      candidate.usedPiecesCount++;

      offcutLinks.push({
        id: `LINK-${candidate.offcut.id}-${stripItem.id}`,
        pairIndex: pieceIdx,
        sourceCode: `S-${String(pieceIdx).padStart(2, '0')}`,
        targetCode: `P-${String(pieceIdx).padStart(2, '0')}`,
        sourceTileId: candidate.offcut.sourceTileId,
        sourceOffcutId: candidate.offcut.id,
        targetTileId: stripItem.id,
        sourceCenter: candidate.offcut.center,
        targetCenter: stripItem.center,
        areaMm2: stripItem.usedAreaMm2,
        label: `Cắt từ ${candidate.offcut.id}`,
      });

      currY = nextY;
    } else {
      // Remnants exhausted -> new roll
      let newRollIdx = 0;
      while (currY < maxLocalY - 5) {
        newRollIdx++;
        const rollH = Math.min(w, maxLocalY - currY);
        const nextY = currY + rollH;
        const pieceW = gapWidth;
        const localRing: Ring = [
          [minLocalX, currY],
          [maxLocalX, currY],
          [maxLocalX, nextY],
          [minLocalX, nextY],
        ];
        const piecePoly: Polygon = [ensureClosedRing(localRing)];
        let clipped: Polygon[] = [piecePoly];
        try {
          const res = polygonClipping.intersection(piecePoly as any, roomPolygon as any) as unknown as Polygon[];
          if (res && res.length > 0) clipped = res;
        } catch {}

        cutStrips.push({
          id: `STRIP-NEW-${newRollIdx}`,
          name: `Roll ${formatRollWidth(w)} - NEW ${newRollIdx} (${(pieceW / 1000).toFixed(1)}m)`,
          roomId: room.id,
          index: pieceIdx + newRollIdx,
          rawPolygon: piecePoly,
          clippedPolygons: clipped,
          rawAreaMm2: pieceW * rollH,
          usedAreaMm2: clipped.reduce((sum, p) => sum + getPolygonArea(p), 0),
          lengthMm: pieceW,
          widthMm: rollH,
          usedWidthMm: rollH,
          isReusedFromOffcut: false,
          offcuts: [],
          center: [(minLocalX + maxLocalX) / 2, (currY + nextY) / 2],
          directionStart: [minLocalX, (currY + nextY) / 2],
          directionEnd: [maxLocalX, (currY + nextY) / 2],
        });
        currY = nextY;
      }
      break;
    }
  }

  console.log(`\nResults for ${w}mm:`);
  console.log(`Total cut strips from remnants: ${cutStrips.filter(s => s.isReusedFromOffcut).length}`);
  console.log(`New rolls needed: ${cutStrips.filter(s => !s.isReusedFromOffcut).length}`);
  pool.forEach(r => {
    if (r.usedPiecesCount > 0) {
      console.log(`  ${r.offcut.id}: used ${r.usedPiecesCount} pieces (${(r.totalUsed/1000).toFixed(1)}m / ${(r.initialLength/1000).toFixed(1)}m), remaining=${(r.remLengthRemaining/1000).toFixed(1)}m`);
    }
  });
  cutStrips.forEach(s => {
    console.log(`  ${s.id} (${s.name}): from ${s.reusedFromId || 'NEW ROLL'}, W=${(s.widthMm/1000).toFixed(2)}m, L=${(s.lengthMm/1000).toFixed(2)}m`);
  });
}

function testMultiRemnantAllocationVertical(w: number) {
  console.log(`\n=================== VERTICAL MULTI-REMNANT TEST: ${w} mm ===================`);
  const config: BroadloomConfig = {
    rollWidth: w,
    maxRollLength: 35000,
    seamOverlap: 0,
    direction: 'vertical',
  };

  const raw = computeNesting({
    rooms: [room],
    materialType: 'broadloom',
    tileConfig: { width: 500, height: 500 },
    broadloomConfig: config,
    pattern: 'monolithic',
    rotationDeg: 0,
    originPoint: [0, 0],
  });

  console.log(`Raw strips (${raw.broadloomStrips.length}):`);
  raw.broadloomStrips.forEach(s => {
    console.log(`  ${s.name}: len=${(s.lengthMm/1000).toFixed(2)}m, W=${(s.widthMm/1000).toFixed(2)}m, usedW=${(s.usedWidthMm/1000).toFixed(2)}m`);
  });

  const availableRemnants = raw.offcutsAvailable
    .filter((off) => off.isBroadloomLongitudinal && off.areaMm2 >= 400_000)
    .sort((a, b) => b.areaMm2 - a.areaMm2);

  console.log(`Available Remnants (${availableRemnants.length}):`);
  availableRemnants.forEach(o => {
    console.log(`  ${o.id}: ${(o.areaMm2/1e6).toFixed(2)}m2, W=${(o.width/1000).toFixed(2)}m, H=${(o.height/1000).toFixed(2)}m`);
  });
}

import { optimizeOffcuts } from '../src/services/offcutManager';

function testActualOptimizeOffcuts(w: number) {
  console.log(`\n>>> TEST ACTUAL optimizeOffcuts: ${w}mm <<<`);
  const config: BroadloomConfig = {
    rollWidth: w,
    maxRollLength: 35000,
    seamOverlap: 0,
    direction: 'horizontal',
  };

  const raw = computeNesting({
    rooms: [room],
    materialType: 'broadloom',
    tileConfig: { width: 500, height: 500 },
    broadloomConfig: config,
    pattern: 'monolithic',
    rotationDeg: 0,
    originPoint: [0, 0],
  });

  const optimized = optimizeOffcuts(raw, {
    enabled: true,
    minWidth: 100,
    minHeight: 100,
    allowRotate: false,
    minViableAreaMm2: 400000,
    maxChainDepth: 5,
  }, [room], config, 0, [0, 0]);

  console.log(`Strips count: ${optimized.broadloomStrips.length}`);
  console.log(`Total linear meters to buy: ${optimized.totalLinearMeters.toFixed(2)}m`);
  console.log(`Offcuts reused count: ${optimized.offcutsReused.length}`);
  optimized.offcutsReused.forEach(o => {
    console.log(`  Reused ${o.id}: ${o.assignedToTileId}, remainingLen=${((o.remainingLengthMm || 0)/1000).toFixed(2)}m`);
  });
  const cutStrips = optimized.broadloomStrips.filter(s => s.isReusedFromOffcut);
  const newStrips = optimized.broadloomStrips.filter(s => !s.isReusedFromOffcut);
  console.log(`Cut strips from remnants: ${cutStrips.length}`);
  cutStrips.forEach(s => console.log(`  ${s.id} (${s.name}): from ${s.reusedFromId}`));
  console.log(`New rolls needed: ${newStrips.filter(s => s.id.includes('NEW')).length}`);
}

function testTileNestingOffcuts() {
  console.log(`\n>>> TEST TILE NESTING OFFCUTS <<<`);
  const raw = computeNesting({
    rooms: [room],
    materialType: 'tile',
    tileConfig: { width: 914.4, height: 152.4 },
    broadloomConfig: { rollWidth: 4000, maxRollLength: 35000, seamOverlap: 0, direction: 'horizontal' },
    pattern: 'herringbone_90',
    rotationDeg: 0,
    originPoint: [0, 0],
  });

  const cutTiles = raw.tiles.filter(t => t.status === 'cut');
  console.log(`Total tiles: ${raw.tiles.length}, Cut tiles: ${cutTiles.length}`);
  const sample = cutTiles[0];
  console.log(`Sample cut tile: id=${sample.id}, status=${sample.status}, coverageRatio=${sample.coverageRatio}`);
  console.log(`  clippedPolygons count: ${sample.clippedPolygons.length}`);
  console.log(`  rawPolygon rings: ${sample.rawPolygon.length}, pts in outer ring: ${sample.rawPolygon[0].length}`);
  console.log(`  offcuts count: ${sample.offcuts.length}`);
  if (sample.offcuts.length > 0) {
    console.log(`  offcut 0 area: ${(sample.offcuts[0].areaMm2/1e6).toFixed(4)}m2, rings: ${sample.offcuts[0].polygon.length}`);
  }

  const optimized = optimizeOffcuts(raw, {
    enabled: true,
    minWidth: 50,
    minHeight: 50,
    allowRotate: true,
    minViableAreaMm2: 5000,
    maxChainDepth: 5,
  }, [room], { rollWidth: 4000, maxRollLength: 35000, seamOverlap: 0, direction: 'horizontal' }, 0, [0, 0]);

  const reusedTiles = optimized.tiles.filter(t => t.status === 'offcut_reused');
  console.log(`Optimized: Reused tiles count: ${reusedTiles.length}`);
  if (reusedTiles.length > 0) {
    const rSample = reusedTiles[0];
  }
}

function testUserRoom() {
  console.log(`\n=================== TEST USER ROOM 4.75m x 5.0m ===================`);
  const room475: RoomGeometry = {
    id: 'ROOM-USER',
    name: 'Phòng 1 (23.8 m²)',
    boundary: [
      [0, 0],
      [4750, 0],
      [4750, 5000],
      [0, 5000],
    ],
    holes: [],
    bbox: { minX: 0, minY: 0, maxX: 4750, maxY: 5000, width: 4750, height: 5000 },
    areaMm2: 4750 * 5000,
  };

  const raw = computeNesting({
    rooms: [room475],
    materialType: 'tile',
    tileConfig: { width: 500, height: 500 },
    broadloomConfig: { rollWidth: 4000, maxRollLength: 35000, seamOverlap: 0, direction: 'horizontal' },
    pattern: 'monolithic',
    rotationDeg: 0,
    originPoint: [0, 0],
  });

  console.log(`Raw: totalTiles=${raw.tiles.length}`);
  const fullCount = raw.tiles.filter(t => t.status === 'full').length;
  const cutTiles = raw.tiles.filter(t => t.status === 'cut');
  console.log(`  Full: ${fullCount}, Cut: ${cutTiles.length}`);
  console.log(`  offcutsAvailable count: ${raw.offcutsAvailable.length}`);
  raw.offcutsAvailable.forEach(o => {
    console.log(`    ${o.id} (from ${o.sourceTileId}): area=${o.areaMm2}mm2, W=${o.width}, H=${o.height}, bboxW=${o.bbox.width}, bboxH=${o.bbox.height}`);
  });

  cutTiles.forEach(t => {
    const bb = getPolygonBoundingBox(t.clippedPolygons[0] || t.rawPolygon);
    console.log(`  CutTile ${t.id}: area=${t.areaMm2}mm2, W=${bb.width}, H=${bb.height}, grainAngle=${t.grainAngle}`);
  });

  const optimized = optimizeOffcuts(raw, {
    enabled: true,
    minWidth: 100,
    minHeight: 100,
    allowRotate: false,
    minViableAreaMm2: 5000,
    maxChainDepth: 5,
  }, [room475], { rollWidth: 4000, maxRollLength: 35000, seamOverlap: 0, direction: 'horizontal' }, 0, [0, 0]);

  const reusedTiles = optimized.tiles.filter(t => t.status === 'offcut_reused');
  console.log(`Optimized: reused count=${reusedTiles.length}, offcutsReused=${optimized.offcutsReused.length}`);
  console.log(`totalRawTilesNeeded: ${optimized.totalRawTiles}`);

  // Test Herringbone 90
  const hbRaw = computeNesting({
    rooms: [room475],
    materialType: 'tile',
    tileConfig: { width: 914.4, height: 152.4 },
    broadloomConfig: { rollWidth: 4000, maxRollLength: 35000, seamOverlap: 0, direction: 'horizontal' },
    pattern: 'herringbone_90',
    rotationDeg: 0,
    originPoint: [0, 0],
  });
  const hbOpt = optimizeOffcuts(hbRaw, {
    enabled: true,
    minWidth: 50,
    minHeight: 50,
    allowRotate: true,
    minViableAreaMm2: 5000,
    maxChainDepth: 5,
  }, [room475], { rollWidth: 4000, maxRollLength: 35000, seamOverlap: 0, direction: 'horizontal' }, 0, [0, 0]);

  const hbReused = hbOpt.tiles.filter(t => t.status === 'offcut_reused');
  console.log(`\nHerringbone 90: totalTiles=${hbOpt.tiles.length}, reused count=${hbReused.length}, offcutsReused=${hbOpt.offcutsReused.length}`);
  console.log(`HB totalRawTilesNeeded: ${hbOpt.totalRawTiles} (saved ${hbReused.length} tiles)`);
}

testUserRoom();
