import polygonClipping from 'polygon-clipping';
import { optimizeBroadloomRemnantFirst, optimizeBroadloomSelfRemnant } from './remnantFirstOptimizer';
import { getBroadloomCutPolygon } from './broadloomGeometry';
import { validateNesting } from './nestingValidation';
import {
  Point,
  Ring,
  Polygon,
  RoomGeometry,
  BroadloomConfig,
  BroadloomSeam,
  NestingResult,
  OffcutConfig,
  OffcutItem,
  NestingTile,
  BroadloomStrip,
  OffcutFlowLink,
} from '../types';
import {
  getPolygonArea,
  getPolygonCentroid,
  getPolygonBoundingBox,
  ensureClosedRing,
  rotatePoint,
  rotateRing,
  formatRollWidth,
  isPointInRing,
} from './geometryMath';

export function optimizeOffcuts(
  nesting: NestingResult,
  config: OffcutConfig,
  rooms?: RoomGeometry[],
  broadloomConfig?: BroadloomConfig,
  rotationDeg: number = 0,
  originPoint: Point = [0, 0],
  roomOrigins?: Record<string, Point>
): NestingResult {
  if (!config.enabled) {
    const resetTiles: NestingTile[] = nesting.tiles.map((t) => ({
      ...t,
      status: t.coverageRatio >= 0.998 ? 'full' : 'cut',
      reusedFromId: undefined,
      reusedFromTileId: undefined,
      reusedSourceCode: undefined,
      matchingCode: undefined,
      donorTargetCodes: undefined,
      donorTargetIds: undefined,
    }));

    let totalLinMeters = 0;
    const resetStrips: BroadloomStrip[] = nesting.broadloomStrips.map((s) => {
      totalLinMeters += s.lengthMm / 1000;
      return {
        ...s,
        isReusedFromOffcut: false,
        reusedFromId: undefined,
      };
    });

    return {
      ...nesting,
      tiles: resetTiles,
      broadloomStrips: resetStrips,
      offcutsReused: [],
      offcutLinks: [],
      totalRawTiles: resetTiles.length,
      totalLinearMeters: totalLinMeters,
    };
  }

  // 1. Broadloom Strips Offcut Optimization (Guillotine / Best-fit Remnant Allocation)
  if (nesting.broadloomStrips.length > 0) {
    // Multi-room layouts must use the ordered planner; the older room-local
    // allocator cannot enforce which room supplies the remnant or the first strip.
    if (rooms && rooms.length > 1 && broadloomConfig) {
      let best = optimizeBroadloomRemnantFirst(nesting, rooms, config,
        broadloomConfig, rotationDeg, roomOrigins);
      // An individual room can reuse a long strip's own offcut even when the
      // full project has several rooms. Compare that plan with cross-room reuse.
      for (const room of rooms) {
        const roomStrips = nesting.broadloomStrips.filter((strip) => strip.roomId === room.id);
        if (!roomStrips.some((strip) => strip.lengthMm >= 4000)) continue;
        const ids = new Set(roomStrips.map((strip) => strip.id));
        const inRoom = (seam: BroadloomSeam) => {
          const midpoint: Point = [(seam.start[0] + seam.end[0]) / 2,
            (seam.start[1] + seam.end[1]) / 2];
          return isPointInRing(midpoint, room.boundary) &&
            !room.holes.some((hole) => isPointInRing(midpoint, hole));
        };
        const roomMeters = roomStrips.reduce((sum, strip) => sum + strip.lengthMm / 1000, 0);
        const subplan: NestingResult = { ...nesting,
          broadloomStrips: roomStrips, seams: nesting.seams.filter(inRoom),
          offcutsAvailable: nesting.offcutsAvailable.filter((offcut) => ids.has(offcut.sourceTileId)),
          offcutsReused: [], offcutLinks: [], totalLinearMeters: roomMeters,
        };
        const origins = { [room.id]: roomOrigins?.[room.id] ?? originPoint };
        const local = optimizeBroadloomSelfRemnant(subplan, [room], config,
          broadloomConfig, rotationDeg, origins);
        if (local.totalLinearMeters >= roomMeters - 0.001) continue;
        const candidate: NestingResult = { ...nesting,
          broadloomStrips: rooms.flatMap((part) => part.id === room.id
            ? local.broadloomStrips
            : nesting.broadloomStrips.filter((strip) => strip.roomId === part.id)),
          seams: [...nesting.seams.filter((seam) => !inRoom(seam)), ...local.seams],
          offcutsAvailable: [...nesting.offcutsAvailable.filter((offcut) => !ids.has(offcut.sourceTileId)),
            ...local.offcutsAvailable],
          offcutsReused: local.offcutsReused, offcutLinks: local.offcutLinks,
          totalLinearMeters: nesting.totalLinearMeters - roomMeters + local.totalLinearMeters,
        };
        if (candidate.totalLinearMeters < best.totalLinearMeters - 0.001 &&
            !validateNesting(rooms, candidate, 'broadloom', broadloomConfig))
          best = candidate;
      }
      return best;
    }
    let heuristic: NestingResult;
    if (rooms && rooms.length > 1) {
      const perRoom = rooms.map((room) => {
        const roomStrips = nesting.broadloomStrips.filter((strip) => strip.roomId === room.id);
        const sourceIds = new Set(roomStrips.map((strip) => strip.id));
        const roomSeams = nesting.seams.filter((seam) => {
          const midpoint: Point = [(seam.start[0] + seam.end[0]) / 2, (seam.start[1] + seam.end[1]) / 2];
          return isPointInRing(midpoint, room.boundary) && !room.holes.some((hole) => isPointInRing(midpoint, hole));
        });
        return allocateBroadloomOffcuts({ ...nesting, broadloomStrips: roomStrips,
          seams: roomSeams,
          offcutsAvailable: nesting.offcutsAvailable.filter((offcut) => sourceIds.has(offcut.sourceTileId)),
          offcutsReused: [], offcutLinks: [],
          totalLinearMeters: roomStrips.reduce((sum, strip) => sum + strip.lengthMm / 1000, 0),
        }, config, [room], broadloomConfig, rotationDeg, roomOrigins?.[room.id] ?? originPoint);
      });
      heuristic = { ...nesting,
        broadloomStrips: perRoom.flatMap((part) => part.broadloomStrips),
        seams: perRoom.flatMap((part) => part.seams),
        offcutsAvailable: perRoom.flatMap((part) => part.offcutsAvailable),
        offcutsReused: perRoom.flatMap((part) => part.offcutsReused),
        offcutLinks: perRoom.flatMap((part) => part.offcutLinks),
        totalLinearMeters: perRoom.reduce((sum, part) => sum + part.totalLinearMeters, 0),
      };
    } else {
      heuristic = allocateBroadloomOffcuts(
        nesting, config, rooms, broadloomConfig, rotationDeg, originPoint
      );
    }
    if (!rooms?.length || !broadloomConfig) return heuristic;
    const selfRemnant = optimizeBroadloomSelfRemnant(nesting, rooms, config,
      broadloomConfig, rotationDeg,
      roomOrigins ?? { [rooms[0].id]: originPoint });
    const remnantFirst = optimizeBroadloomRemnantFirst(nesting, rooms, config,
      broadloomConfig, rotationDeg, roomOrigins);
    if (selfRemnant.offcutLinks.length &&
        selfRemnant.totalLinearMeters < Math.min(heuristic.totalLinearMeters,
          remnantFirst.totalLinearMeters) - 0.001) return selfRemnant;
    if (remnantFirst.offcutLinks.length > heuristic.offcutLinks.length &&
        remnantFirst.totalLinearMeters <= heuristic.totalLinearMeters + 0.001) return remnantFirst;
    if (remnantFirst.offcutLinks.length &&
        remnantFirst.totalLinearMeters < heuristic.totalLinearMeters - 0.001) return remnantFirst;
    return heuristic;
  }

  // 2. Tile / PVC Offcut Optimization
  return optimizeTileOffcuts(nesting, config);
}

/**
 * Allocate Off-cuts (2D Bin Packing & Guillotine Splitting) for Broadloom Carpet
 * 
 * Logic cắt & ghép theo quy chuẩn thi công thảm cuộn:
 * 1. Nhận diện dải cuộn chính (PRIMARY ROLL) - dải dài nhất theo phương lăn cuộn.
 * 2. Thu hồi mảng thảm thừa nguyên vẹn (REMNANT) sinh ra từ phần chênh lệch ngoài phòng (ví dụ 8.3m x 2.3m).
 * 3. Xác định vùng sàn chưa phủ kín (UNCOVERED GAP) cần vá/lát.
 * 4. Cắt lát trực tiếp từ Remnant thành các mảnh có kích thước thực tế:
 *    - Khổ rộng mảnh cắt: derived trực tiếp từ khổ remnant (ví dụ tối đa 2.3m, hoặc phần dư cuối cùng).
 *    - Chiều dài mảnh cắt: derived trực tiếp từ chiều cao khoảng trống hình học (ví dụ 1.8m).
 *    - Bảo toàn nghiêm ngặt hướng sợi (pile direction) dọc theo trục lăn cuộn.
 *    - Tuân thủ ngưỡng tối thiểu min_W, min_H.
 * 5. Cập nhật kích thước còn lại của Remnant sau mỗi lát cắt.
 * 6. Khi Remnant cạn kiệt (hoặc nhỏ hơn min_W/H), mới chuyển sang gọi NEW ROLL khổ chuẩn 4m.
 * 7. Sinh đường nối Seam chuẩn xác tại các vị trí mép cắt lát.
 */
interface RemnantPoolItem {
  offcut: OffcutItem;
  remWidth: number;
  remLengthRemaining: number;
  initialLength: number;
  totalUsed: number;
  usedPiecesCount: number;
  localMinX: number;
  localMaxX: number;
  localMinY: number;
  localMaxY: number;
  sliceDirection: 'from_max' | 'from_min';
  currentCutPosition: number;
}

function sliceFromRemnant(
  candidate: RemnantPoolItem,
  sliceLengthNeeded: number,
  isVertical: boolean,
  angleRad: number,
  originPoint: Point
): { slicePoly: Polygon; sliceCenter: Point; cutLength: number; cutWidth: number } {
  const cutLength = Math.min(candidate.remLengthRemaining, sliceLengthNeeded);
  const cutWidth = candidate.remWidth;

  let sliceLocalRing: Ring;
  let sliceLocalCenter: Point;

  if (isVertical) {
    let sMinY: number;
    let sMaxY: number;
    if (candidate.sliceDirection === 'from_max') {
      sMaxY = candidate.currentCutPosition;
      sMinY = sMaxY - cutLength;
      candidate.currentCutPosition = sMinY;
    } else {
      sMinY = candidate.currentCutPosition;
      sMaxY = sMinY + cutLength;
      candidate.currentCutPosition = sMaxY;
    }
    sliceLocalRing = [
      [candidate.localMinX, sMinY],
      [candidate.localMaxX, sMinY],
      [candidate.localMaxX, sMaxY],
      [candidate.localMinX, sMaxY],
    ];
    sliceLocalCenter = [
      (candidate.localMinX + candidate.localMaxX) / 2,
      (sMinY + sMaxY) / 2,
    ];
  } else {
    let sMinX: number;
    let sMaxX: number;
    if (candidate.sliceDirection === 'from_max') {
      sMaxX = candidate.currentCutPosition;
      sMinX = sMaxX - cutLength;
      candidate.currentCutPosition = sMinX;
    } else {
      sMinX = candidate.currentCutPosition;
      sMaxX = sMinX + cutLength;
      candidate.currentCutPosition = sMaxX;
    }
    sliceLocalRing = [
      [sMinX, candidate.localMinY],
      [sMaxX, candidate.localMinY],
      [sMaxX, candidate.localMaxY],
      [sMinX, candidate.localMaxY],
    ];
    sliceLocalCenter = [
      (sMinX + sMaxX) / 2,
      (candidate.localMinY + candidate.localMaxY) / 2,
    ];
  }

  const sliceWorldRing = rotateRing(sliceLocalRing, angleRad, originPoint);
  let slicePoly: Polygon = [ensureClosedRing(sliceWorldRing)];

  if (candidate.offcut.polygon) {
    try {
      const inter = polygonClipping.intersection(
        slicePoly as any,
        candidate.offcut.polygon as any
      ) as unknown as Polygon[];
      if (inter && inter.length > 0) {
        slicePoly = inter[0];
      }
    } catch {}
  }

  let sliceCenter = rotatePoint(sliceLocalCenter, angleRad, originPoint);
  if (slicePoly && slicePoly.length > 0 && slicePoly[0].length >= 3) {
    try {
      const c = getPolygonCentroid(slicePoly);
      if (!isNaN(c[0]) && !isNaN(c[1])) {
        sliceCenter = c;
      }
    } catch {}
  }

  return { slicePoly, sliceCenter, cutLength, cutWidth };
}

function allocateBroadloomOffcuts(
  nesting: NestingResult,
  config: OffcutConfig,
  rooms?: RoomGeometry[],
  broadloomConfig?: BroadloomConfig,
  rotationDeg: number = 0,
  originPoint: Point = [0, 0]
): NestingResult {
  const offcutCopies = new Map<string, OffcutItem>(nesting.offcutsAvailable.map((offcut) => [offcut.id, {
    ...offcut, subSlices: undefined, leftoverPolygon: undefined, assignedToTileId: undefined,
  }]));
  const strips: BroadloomStrip[] = nesting.broadloomStrips.map((s) => ({
    ...s, offcuts: s.offcuts.map((offcut) => offcutCopies.get(offcut.id) ?? { ...offcut }),
  }));
  if (strips.length === 0 || nesting.offcutsAvailable.length === 0) return nesting;
  const minBroadloomWidth = config.minBroadloomWidth ?? 1000;

  // 1. Tìm các mảng thảm thừa dọc khổ khả dụng, ưu tiên mảng có diện tích lớn nhất
  const availableRemnants = [...offcutCopies.values()]
    .filter((off) => off.isBroadloomLongitudinal)
    .sort((a, b) => b.areaMm2 - a.areaMm2);

  if (availableRemnants.length === 0) return nesting;

  // 2. Phân loại dải cuộn chính (Primary Rolls) và dải sàn trống cần ghép bù (Receiver Strips)
  // Dải chính có chiều dài đạt chuẩn (>= 65% chiều dài dải lớn nhất)
  const maxLen = Math.max(...strips.map((s) => s.lengthMm));
  const primaryStrips = strips.filter((s) => s.lengthMm >= maxLen * 0.65);
  const receiverStrips = strips.filter((s) => s.lengthMm < maxLen * 0.65);

  if (receiverStrips.length === 0) return nesting;
  // The allocator lays out one connected room at a time. Keeping the raw
  // layout is safer than moving a receiver into a different room's polygon.
  if (!rooms || rooms.length !== 1 || strips.some((s) => s.roomId !== rooms[0].id)) return nesting;
  const retainedSourceIds = new Set(primaryStrips.map((s) => s.id));
  for (const [id, offcut] of offcutCopies) {
    if (!retainedSourceIds.has(offcut.sourceTileId)) offcutCopies.delete(id);
  }

  const angleRad = (rotationDeg * Math.PI) / 180;
  const invAngleRad = -angleRad;

  const roomPolygon: Polygon | undefined =
    rooms && rooms.length > 0
      ? [ensureClosedRing(rooms[0].boundary), ...rooms[0].holes.map(ensureClosedRing)]
      : undefined;

  // 3. Xác định bounds của vùng sàn trống trong hệ tọa độ cục bộ (Local Coordinates)
  let minLocalX = Infinity, maxLocalX = -Infinity;
  let minLocalY = Infinity, maxLocalY = -Infinity;

  for (const strip of receiverStrips) {
    for (const poly of strip.clippedPolygons) {
      for (const ring of poly) {
        for (const pt of ring) {
          const lp = rotatePoint(pt, invAngleRad, originPoint);
          if (lp[0] < minLocalX) minLocalX = lp[0];
          if (lp[0] > maxLocalX) maxLocalX = lp[0];
          if (lp[1] < minLocalY) minLocalY = lp[1];
          if (lp[1] > maxLocalY) maxLocalY = lp[1];
        }
      }
    }
  }

  // Tọa độ tiếp giáp của các cuộn chính
  let genMinLocalX = Infinity, genMaxLocalX = -Infinity;
  let genMinLocalY = Infinity, genMaxLocalY = -Infinity;

  for (const pStrip of primaryStrips) {
    for (const poly of pStrip.clippedPolygons) {
      for (const ring of poly) {
        for (const pt of ring) {
          const lp = rotatePoint(pt, invAngleRad, originPoint);
          if (lp[0] < genMinLocalX) genMinLocalX = lp[0];
          if (lp[0] > genMaxLocalX) genMaxLocalX = lp[0];
          if (lp[1] < genMinLocalY) genMinLocalY = lp[1];
          if (lp[1] > genMaxLocalY) genMaxLocalY = lp[1];
        }
      }
    }
  }

  const isVertical = broadloomConfig
    ? broadloomConfig.direction === 'vertical'
    : primaryStrips[0].lengthMm >= primaryStrips[0].widthMm;

  const standardRollWidth = broadloomConfig?.rollWidth || primaryStrips[0].widthMm || 4000;
  const rollWidthM = formatRollWidth(standardRollWidth);

  const pool: RemnantPoolItem[] = availableRemnants.filter((off) => retainedSourceIds.has(off.sourceTileId)).map((off) => {
    let remMinX = Infinity, remMaxX = -Infinity;
    let remMinY = Infinity, remMaxY = -Infinity;
    for (const ring of off.polygon) {
      for (const pt of ring) {
        const [lx, ly] = rotatePoint(pt, invAngleRad, originPoint);
        if (lx < remMinX) remMinX = lx;
        if (lx > remMaxX) remMaxX = lx;
        if (ly < remMinY) remMinY = ly;
        if (ly > remMaxY) remMaxY = ly;
      }
    }

    const spanX = Math.max(1, remMaxX - remMinX);
    const spanY = Math.max(1, remMaxY - remMinY);

    let w: number;
    let len: number;
    let sliceDir: 'from_max' | 'from_min';
    let cutPos: number;

    if (isVertical) {
      len = spanY;
      w = spanX;
      const receiverCenterY = (minLocalY + maxLocalY) / 2;
      const remCenterY = (remMinY + remMaxY) / 2;
      if (receiverCenterY >= remCenterY) {
        sliceDir = 'from_max';
        cutPos = remMaxY;
      } else {
        sliceDir = 'from_min';
        cutPos = remMinY;
      }
    } else {
      len = spanX;
      w = spanY;
      const receiverCenterX = (minLocalX + maxLocalX) / 2;
      const remCenterX = (remMinX + remMaxX) / 2;
      if (receiverCenterX >= remCenterX) {
        sliceDir = 'from_max';
        cutPos = remMaxX;
      } else {
        sliceDir = 'from_min';
        cutPos = remMinX;
      }
    }

    off.subSlices = [];
    off.leftoverPolygon = undefined;

    return {
      offcut: off,
      remWidth: w,
      remLengthRemaining: len,
      initialLength: len,
      totalUsed: 0,
      usedPiecesCount: 0,
      localMinX: remMinX,
      localMaxX: remMaxX,
      localMinY: remMinY,
      localMaxY: remMaxY,
      sliceDirection: sliceDir,
      currentCutPosition: cutPos,
    };
  }).filter((remnant) => Math.min(remnant.remWidth, remnant.remLengthRemaining) >= minBroadloomWidth);

  if (pool.length === 0) return nesting;

  // Use the shortest fitting remnant when widths are equal. Otherwise the
  // longest piece can cover every receiver while a useful shorter piece stays idle.
  const pickRemnant = (remainingCross: number, pieceLength: number): RemnantPoolItem | undefined =>
    pool.filter((remnant) => remainingCross >= minBroadloomWidth &&
      remnant.remLengthRemaining >= Math.max(minBroadloomWidth, pieceLength) &&
      remnant.remWidth >= minBroadloomWidth)
      .sort((a, b) => Math.min(b.remWidth, remainingCross) - Math.min(a.remWidth, remainingCross) ||
        a.remLengthRemaining - b.remLengthRemaining)[0];

  const cutStrips: BroadloomStrip[] = [];
  let nextNewRollId = 0;
  const cutSeams: BroadloomSeam[] = [];
  const offcutLinks: OffcutFlowLink[] = [];

  let pieceIdx = 0;

  if (isVertical) {
    // PHƯƠNG ÁN DẢI DỌC (Pile Direction dọc trục Y)
    // Khoảng trống hình học có chiều cao dọc theo trục Y (gapHeight)
    const gapHeight = maxLocalY - minLocalY;
    const startFromRight = (genMinLocalX + genMaxLocalX) / 2 > (minLocalX + maxLocalX) / 2;

    if (startFromRight) {
      // Tiếp giáp ở bên phải (x = maxLocalX), cắt giật lùi về bên trái
      const seamP1 = rotatePoint([maxLocalX, minLocalY], angleRad, originPoint);
      const seamP2 = rotatePoint([maxLocalX, maxLocalY], angleRad, originPoint);
      cutSeams.push({
        start: seamP1,
        end: seamP2,
        lengthMm: Math.hypot(seamP2[0] - seamP1[0], seamP2[1] - seamP1[1]),
      });

      let currX = maxLocalX;
      while (currX > minLocalX + 5) {
        const remainingWidth = currX - minLocalX;
        const pieceHeight = gapHeight;

        const candidate = pickRemnant(remainingWidth, pieceHeight);

        if (candidate) {
          pieceIdx++;
          const pieceWidth = Math.min(candidate.remWidth, remainingWidth);
          const nextX = currX - pieceWidth;
          const localRing: Ring = [
            [nextX, minLocalY],
            [currX, minLocalY],
            [currX, maxLocalY],
            [nextX, maxLocalY],
          ];
          const worldRing = rotateRing(localRing, angleRad, originPoint);
          const piecePoly: Polygon = [ensureClosedRing(worldRing)];

          let clipped: Polygon[] = [piecePoly];
          if (roomPolygon) {
            try {
              const res = polygonClipping.intersection(piecePoly as any, roomPolygon as any) as unknown as Polygon[];
              if (res && res.length > 0) clipped = res;
            } catch {}
          }

          const usedArea = clipped.reduce((sum, p) => sum + getPolygonArea(p), 0);
          const center = rotatePoint([(nextX + currX) / 2, (minLocalY + maxLocalY) / 2], angleRad, originPoint);
          const dirStart = rotatePoint([(nextX + currX) / 2, minLocalY], angleRad, originPoint);
          const dirEnd = rotatePoint([(nextX + currX) / 2, maxLocalY], angleRad, originPoint);

          const pairNum = String(pieceIdx).padStart(2, '0');
          const sCode = `S-${pairNum}`;
          const pCode = `P-${pairNum}`;

          const pieceName = `MẢNH CẮT ${pieceIdx} (${(pieceWidth / 1000).toFixed(1)}m x ${(pieceHeight / 1000).toFixed(1)}m)`;
          const stripItem: BroadloomStrip = {
            id: `STRIP-CUT-${rooms?.[0]?.id ?? 'ROOM'}-${pieceIdx}`,
            name: pieceName,
            roomId: primaryStrips[0].roomId,
            index: pieceIdx,
            rawPolygon: piecePoly,
            clippedPolygons: clipped,
            rawAreaMm2: pieceWidth * pieceHeight,
            usedAreaMm2: usedArea,
            lengthMm: pieceHeight,
            widthMm: pieceWidth,
            usedWidthMm: pieceWidth,
            isReusedFromOffcut: true,
            reusedFromId: candidate.offcut.id,
            sourceSliceCode: sCode,
            matchingCode: pCode,
            offcuts: [],
            center,
            directionStart: dirStart,
            directionEnd: dirEnd,
          };
          cutStrips.push(stripItem);

          if (nextX > minLocalX + 5) {
            const sp1 = rotatePoint([nextX, minLocalY], angleRad, originPoint);
            const sp2 = rotatePoint([nextX, maxLocalY], angleRad, originPoint);
            cutSeams.push({ start: sp1, end: sp2, lengthMm: Math.hypot(sp2[0] - sp1[0], sp2[1] - sp1[1]) });
          }

          const sliceInfo = sliceFromRemnant(
            candidate,
            pieceHeight,
            isVertical,
            angleRad,
            originPoint
          );

          if (!candidate.offcut.subSlices) {
            candidate.offcut.subSlices = [];
          }
          candidate.offcut.subSlices.push({
            id: `SLICE-${candidate.offcut.id}-${pieceIdx}`,
            code: sCode,
            targetCode: pCode,
            targetStripId: stripItem.id,
            polygon: sliceInfo.slicePoly,
            center: sliceInfo.sliceCenter,
            widthMm: Math.round(sliceInfo.cutWidth),
            lengthMm: Math.round(sliceInfo.cutLength),
            index: pieceIdx,
          });

          offcutLinks.push({
            id: `LINK-${candidate.offcut.id}-${stripItem.id}`,
            pairIndex: pieceIdx,
            sourceCode: sCode,
            targetCode: pCode,
            sourceTileId: candidate.offcut.sourceTileId,
            sourceOffcutId: candidate.offcut.id,
            targetTileId: stripItem.id,
            sourceCenter: sliceInfo.sliceCenter,
            targetCenter: stripItem.center,
            areaMm2: stripItem.usedAreaMm2,
            label: `${sCode} ➔ ${pCode} (Cắt ${(pieceWidth / 1000).toFixed(1)}m x ${(pieceHeight / 1000).toFixed(1)}m)`,
            sourceWidthMm: Math.round(candidate.remWidth),
            sourceHeightMm: Math.round(pieceHeight),
            targetWidthMm: Math.round(pieceWidth),
            targetHeightMm: Math.round(pieceHeight),
          });

          candidate.remLengthRemaining -= sliceInfo.cutLength;
          candidate.totalUsed += sliceInfo.cutLength;
          candidate.usedPiecesCount++;
          currX = nextX;
        } else {
          // Remnant hết -> Gọi NEW ROLL khổ chuẩn
          let newRollIdx = 0;
          while (currX > minLocalX + 5) {
            newRollIdx++;
            const rollW = Math.min(standardRollWidth, currX - minLocalX);
            const nextX = currX - rollW;
            const pieceH = gapHeight;
            const localRing: Ring = [
              [nextX, minLocalY],
              [currX, minLocalY],
              [currX, maxLocalY],
              [nextX, maxLocalY],
            ];
            const worldRing = rotateRing(localRing, angleRad, originPoint);
            const piecePoly: Polygon = [ensureClosedRing(worldRing)];
            let clipped: Polygon[] = [piecePoly];
            if (roomPolygon) {
              try {
                const res = polygonClipping.intersection(piecePoly as any, roomPolygon as any) as unknown as Polygon[];
                if (res && res.length > 0) clipped = res;
              } catch {}
            }
            const usedArea = clipped.reduce((sum, p) => sum + getPolygonArea(p), 0);
            const center = rotatePoint([(nextX + currX) / 2, (minLocalY + maxLocalY) / 2], angleRad, originPoint);
            const dirStart = rotatePoint([(nextX + currX) / 2, minLocalY], angleRad, originPoint);
            const dirEnd = rotatePoint([(nextX + currX) / 2, maxLocalY], angleRad, originPoint);

            cutStrips.push({
              id: `STRIP-NEW-${++nextNewRollId}`,
              name: `Roll ${rollWidthM} - NEW ${nextNewRollId} (${(pieceH / 1000).toFixed(1)}m)`,
              roomId: primaryStrips[0].roomId,
              index: pieceIdx + newRollIdx,
              rawPolygon: piecePoly,
              clippedPolygons: clipped,
              rawAreaMm2: standardRollWidth * pieceH,
              usedAreaMm2: usedArea,
              lengthMm: pieceH,
              widthMm: standardRollWidth,
              usedWidthMm: rollW,
              isReusedFromOffcut: false,
              offcuts: [],
              center,
              directionStart: dirStart,
              directionEnd: dirEnd,
            });

            if (nextX > minLocalX + 5) {
              const sp1 = rotatePoint([nextX, minLocalY], angleRad, originPoint);
              const sp2 = rotatePoint([nextX, maxLocalY], angleRad, originPoint);
              cutSeams.push({ start: sp1, end: sp2, lengthMm: Math.hypot(sp2[0] - sp1[0], sp2[1] - sp1[1]) });
            }
            currX = nextX;
          }
          break;
        }
      }
    } else {
      // Tiếp giáp ở bên trái (x = minLocalX), cắt tiến dần sang bên phải
      const seamP1 = rotatePoint([minLocalX, minLocalY], angleRad, originPoint);
      const seamP2 = rotatePoint([minLocalX, maxLocalY], angleRad, originPoint);
      cutSeams.push({
        start: seamP1,
        end: seamP2,
        lengthMm: Math.hypot(seamP2[0] - seamP1[0], seamP2[1] - seamP1[1]),
      });

      let currX = minLocalX;
      while (currX < maxLocalX - 5) {
        const remainingWidth = maxLocalX - currX;
        const pieceHeight = gapHeight;

        const candidate = pickRemnant(remainingWidth, pieceHeight);

        if (candidate) {
          pieceIdx++;
          const pieceWidth = Math.min(candidate.remWidth, remainingWidth);
          const nextX = currX + pieceWidth;
          const localRing: Ring = [
            [currX, minLocalY],
            [nextX, minLocalY],
            [nextX, maxLocalY],
            [currX, maxLocalY],
          ];
          const worldRing = rotateRing(localRing, angleRad, originPoint);
          const piecePoly: Polygon = [ensureClosedRing(worldRing)];
          let clipped: Polygon[] = [piecePoly];
          if (roomPolygon) {
            try {
              const res = polygonClipping.intersection(piecePoly as any, roomPolygon as any) as unknown as Polygon[];
              if (res && res.length > 0) clipped = res;
            } catch {}
          }
          const usedArea = clipped.reduce((sum, p) => sum + getPolygonArea(p), 0);
          const center = rotatePoint([(currX + nextX) / 2, (minLocalY + maxLocalY) / 2], angleRad, originPoint);
          const dirStart = rotatePoint([(currX + nextX) / 2, minLocalY], angleRad, originPoint);
          const dirEnd = rotatePoint([(currX + nextX) / 2, maxLocalY], angleRad, originPoint);

          const pairNum = String(pieceIdx).padStart(2, '0');
          const sCode = `S-${pairNum}`;
          const pCode = `P-${pairNum}`;

          const pieceName = `MẢNH CẮT ${pieceIdx} (${(pieceWidth / 1000).toFixed(1)}m x ${(pieceHeight / 1000).toFixed(1)}m)`;
          const stripItem: BroadloomStrip = {
            id: `STRIP-CUT-${rooms?.[0]?.id ?? 'ROOM'}-${pieceIdx}`,
            name: pieceName,
            roomId: primaryStrips[0].roomId,
            index: pieceIdx,
            rawPolygon: piecePoly,
            clippedPolygons: clipped,
            rawAreaMm2: pieceWidth * pieceHeight,
            usedAreaMm2: usedArea,
            lengthMm: pieceHeight,
            widthMm: pieceWidth,
            usedWidthMm: pieceWidth,
            isReusedFromOffcut: true,
            reusedFromId: candidate.offcut.id,
            sourceSliceCode: sCode,
            matchingCode: pCode,
            offcuts: [],
            center,
            directionStart: dirStart,
            directionEnd: dirEnd,
          };
          cutStrips.push(stripItem);

          if (nextX < maxLocalX - 5) {
            const sp1 = rotatePoint([nextX, minLocalY], angleRad, originPoint);
            const sp2 = rotatePoint([nextX, maxLocalY], angleRad, originPoint);
            cutSeams.push({ start: sp1, end: sp2, lengthMm: Math.hypot(sp2[0] - sp1[0], sp2[1] - sp1[1]) });
          }

          const sliceInfo = sliceFromRemnant(
            candidate,
            pieceHeight,
            isVertical,
            angleRad,
            originPoint
          );

          if (!candidate.offcut.subSlices) {
            candidate.offcut.subSlices = [];
          }
          candidate.offcut.subSlices.push({
            id: `SLICE-${candidate.offcut.id}-${pieceIdx}`,
            code: sCode,
            targetCode: pCode,
            targetStripId: stripItem.id,
            polygon: sliceInfo.slicePoly,
            center: sliceInfo.sliceCenter,
            widthMm: Math.round(sliceInfo.cutWidth),
            lengthMm: Math.round(sliceInfo.cutLength),
            index: pieceIdx,
          });

          offcutLinks.push({
            id: `LINK-${candidate.offcut.id}-${stripItem.id}`,
            pairIndex: pieceIdx,
            sourceCode: sCode,
            targetCode: pCode,
            sourceTileId: candidate.offcut.sourceTileId,
            sourceOffcutId: candidate.offcut.id,
            targetTileId: stripItem.id,
            sourceCenter: sliceInfo.sliceCenter,
            targetCenter: stripItem.center,
            areaMm2: stripItem.usedAreaMm2,
            label: `${sCode} ➔ ${pCode} (Cắt ${(pieceWidth / 1000).toFixed(1)}m x ${(pieceHeight / 1000).toFixed(1)}m)`,
            sourceWidthMm: Math.round(candidate.remWidth),
            sourceHeightMm: Math.round(pieceHeight),
            targetWidthMm: Math.round(pieceWidth),
            targetHeightMm: Math.round(pieceHeight),
          });

          candidate.remLengthRemaining -= sliceInfo.cutLength;
          candidate.totalUsed += sliceInfo.cutLength;
          candidate.usedPiecesCount++;
          currX = nextX;
        } else {
          let newRollIdx = 0;
          while (currX < maxLocalX - 5) {
            newRollIdx++;
            const rollW = Math.min(standardRollWidth, maxLocalX - currX);
            const nextX = currX + rollW;
            const pieceH = gapHeight;
            const localRing: Ring = [
              [currX, minLocalY],
              [nextX, minLocalY],
              [nextX, maxLocalY],
              [currX, maxLocalY],
            ];
            const worldRing = rotateRing(localRing, angleRad, originPoint);
            const piecePoly: Polygon = [ensureClosedRing(worldRing)];
            let clipped: Polygon[] = [piecePoly];
            if (roomPolygon) {
              try {
                const res = polygonClipping.intersection(piecePoly as any, roomPolygon as any) as unknown as Polygon[];
                if (res && res.length > 0) clipped = res;
              } catch {}
            }
            const usedArea = clipped.reduce((sum, p) => sum + getPolygonArea(p), 0);
            const center = rotatePoint([(currX + nextX) / 2, (minLocalY + maxLocalY) / 2], angleRad, originPoint);
            const dirStart = rotatePoint([(currX + nextX) / 2, minLocalY], angleRad, originPoint);
            const dirEnd = rotatePoint([(currX + nextX) / 2, maxLocalY], angleRad, originPoint);

            cutStrips.push({
              id: `STRIP-NEW-${++nextNewRollId}`,
              name: `Roll ${rollWidthM} - NEW ${nextNewRollId} (${(pieceH / 1000).toFixed(1)}m)`,
              roomId: primaryStrips[0].roomId,
              index: pieceIdx + newRollIdx,
              rawPolygon: piecePoly,
              clippedPolygons: clipped,
              rawAreaMm2: standardRollWidth * pieceH,
              usedAreaMm2: usedArea,
              lengthMm: pieceH,
              widthMm: standardRollWidth,
              usedWidthMm: rollW,
              isReusedFromOffcut: false,
              offcuts: [],
              center,
              directionStart: dirStart,
              directionEnd: dirEnd,
            });

            if (nextX < maxLocalX - 5) {
              const sp1 = rotatePoint([nextX, minLocalY], angleRad, originPoint);
              const sp2 = rotatePoint([nextX, maxLocalY], angleRad, originPoint);
              cutSeams.push({ start: sp1, end: sp2, lengthMm: Math.hypot(sp2[0] - sp1[0], sp2[1] - sp1[1]) });
            }
            currX = nextX;
          }
          break;
        }
      }
    }
  } else {
    // PHƯƠNG ÁN DẢI NGANG (Pile Direction dọc trục X)
    // Khoảng trống hình học có chiều dài dọc theo trục X (gapWidth)
    const gapWidth = maxLocalX - minLocalX;
    const startFromTop = (genMinLocalY + genMaxLocalY) / 2 > (minLocalY + maxLocalY) / 2;

    if (startFromTop) {
      // Tiếp giáp ở phía trên (y = maxLocalY), cắt giật lùi xuống phía dưới
      const seamP1 = rotatePoint([minLocalX, maxLocalY], angleRad, originPoint);
      const seamP2 = rotatePoint([maxLocalX, maxLocalY], angleRad, originPoint);
      cutSeams.push({
        start: seamP1,
        end: seamP2,
        lengthMm: Math.hypot(seamP2[0] - seamP1[0], seamP2[1] - seamP1[1]),
      });

      let currY = maxLocalY;
      while (currY > minLocalY + 5) {
        const remainingHeight = currY - minLocalY;
        const pieceWidth = gapWidth;

        const candidate = pickRemnant(remainingHeight, pieceWidth);

        if (candidate) {
          pieceIdx++;
          const pieceHeight = Math.min(candidate.remWidth, remainingHeight);
          const nextY = currY - pieceHeight;
          const localRing: Ring = [
            [minLocalX, nextY],
            [maxLocalX, nextY],
            [maxLocalX, currY],
            [minLocalX, currY],
          ];
          const worldRing = rotateRing(localRing, angleRad, originPoint);
          const piecePoly: Polygon = [ensureClosedRing(worldRing)];
          let clipped: Polygon[] = [piecePoly];
          if (roomPolygon) {
            try {
              const res = polygonClipping.intersection(piecePoly as any, roomPolygon as any) as unknown as Polygon[];
              if (res && res.length > 0) clipped = res;
            } catch {}
          }
          const usedArea = clipped.reduce((sum, p) => sum + getPolygonArea(p), 0);
          const center = rotatePoint([(minLocalX + maxLocalX) / 2, (nextY + currY) / 2], angleRad, originPoint);
          const dirStart = rotatePoint([minLocalX, (nextY + currY) / 2], angleRad, originPoint);
          const dirEnd = rotatePoint([maxLocalX, (nextY + currY) / 2], angleRad, originPoint);

          const pairNum = String(pieceIdx).padStart(2, '0');
          const sCode = `S-${pairNum}`;
          const pCode = `P-${pairNum}`;

          const pieceName = `MẢNH CẮT ${pieceIdx} (${(pieceWidth / 1000).toFixed(1)}m x ${(pieceHeight / 1000).toFixed(1)}m)`;
          const stripItem: BroadloomStrip = {
            id: `STRIP-CUT-${rooms?.[0]?.id ?? 'ROOM'}-${pieceIdx}`,
            name: pieceName,
            roomId: primaryStrips[0].roomId,
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
            sourceSliceCode: sCode,
            matchingCode: pCode,
            offcuts: [],
            center,
            directionStart: dirStart,
            directionEnd: dirEnd,
          };
          cutStrips.push(stripItem);

          if (nextY > minLocalY + 5) {
            const sp1 = rotatePoint([minLocalX, nextY], angleRad, originPoint);
            const sp2 = rotatePoint([maxLocalX, nextY], angleRad, originPoint);
            cutSeams.push({ start: sp1, end: sp2, lengthMm: Math.hypot(sp2[0] - sp1[0], sp2[1] - sp1[1]) });
          }

          const sliceInfo = sliceFromRemnant(
            candidate,
            pieceWidth,
            isVertical,
            angleRad,
            originPoint
          );

          if (!candidate.offcut.subSlices) {
            candidate.offcut.subSlices = [];
          }
          candidate.offcut.subSlices.push({
            id: `SLICE-${candidate.offcut.id}-${pieceIdx}`,
            code: sCode,
            targetCode: pCode,
            targetStripId: stripItem.id,
            polygon: sliceInfo.slicePoly,
            center: sliceInfo.sliceCenter,
            widthMm: Math.round(sliceInfo.cutWidth),
            lengthMm: Math.round(sliceInfo.cutLength),
            index: pieceIdx,
          });

          offcutLinks.push({
            id: `LINK-${candidate.offcut.id}-${stripItem.id}`,
            pairIndex: pieceIdx,
            sourceCode: sCode,
            targetCode: pCode,
            sourceTileId: candidate.offcut.sourceTileId,
            sourceOffcutId: candidate.offcut.id,
            targetTileId: stripItem.id,
            sourceCenter: sliceInfo.sliceCenter,
            targetCenter: stripItem.center,
            areaMm2: stripItem.usedAreaMm2,
            label: `${sCode} ➔ ${pCode} (Cắt ${(pieceWidth / 1000).toFixed(1)}m x ${(pieceHeight / 1000).toFixed(1)}m)`,
            sourceWidthMm: Math.round(pieceWidth),
            sourceHeightMm: Math.round(candidate.remWidth),
            targetWidthMm: Math.round(pieceWidth),
            targetHeightMm: Math.round(pieceHeight),
          });

          candidate.remLengthRemaining -= sliceInfo.cutLength;
          candidate.totalUsed += sliceInfo.cutLength;
          candidate.usedPiecesCount++;
          currY = nextY;
        } else {
          let newRollIdx = 0;
          while (currY > minLocalY + 5) {
            newRollIdx++;
            const rollH = Math.min(standardRollWidth, currY - minLocalY);
            const nextY = currY - rollH;
            const pieceW = gapWidth;
            const localRing: Ring = [
              [minLocalX, nextY],
              [maxLocalX, nextY],
              [maxLocalX, currY],
              [minLocalX, currY],
            ];
            const worldRing = rotateRing(localRing, angleRad, originPoint);
            const piecePoly: Polygon = [ensureClosedRing(worldRing)];
            let clipped: Polygon[] = [piecePoly];
            if (roomPolygon) {
              try {
                const res = polygonClipping.intersection(piecePoly as any, roomPolygon as any) as unknown as Polygon[];
                if (res && res.length > 0) clipped = res;
              } catch {}
            }
            const usedArea = clipped.reduce((sum, p) => sum + getPolygonArea(p), 0);
            const center = rotatePoint([(minLocalX + maxLocalX) / 2, (nextY + currY) / 2], angleRad, originPoint);
            const dirStart = rotatePoint([minLocalX, (nextY + currY) / 2], angleRad, originPoint);
            const dirEnd = rotatePoint([maxLocalX, (nextY + currY) / 2], angleRad, originPoint);

            cutStrips.push({
              id: `STRIP-NEW-${++nextNewRollId}`,
              name: `Roll ${rollWidthM} - NEW ${nextNewRollId} (${(pieceW / 1000).toFixed(1)}m)`,
              roomId: primaryStrips[0].roomId,
              index: pieceIdx + newRollIdx,
              rawPolygon: piecePoly,
              clippedPolygons: clipped,
              rawAreaMm2: pieceW * standardRollWidth,
              usedAreaMm2: usedArea,
              lengthMm: pieceW,
              widthMm: standardRollWidth,
              usedWidthMm: rollH,
              isReusedFromOffcut: false,
              offcuts: [],
              center,
              directionStart: dirStart,
              directionEnd: dirEnd,
            });

            if (nextY > minLocalY + 5) {
              const sp1 = rotatePoint([minLocalX, nextY], angleRad, originPoint);
              const sp2 = rotatePoint([maxLocalX, nextY], angleRad, originPoint);
              cutSeams.push({ start: sp1, end: sp2, lengthMm: Math.hypot(sp2[0] - sp1[0], sp2[1] - sp1[1]) });
            }

            currY = nextY;
          }
          break;
        }
      }
    } else {
      // Tiếp giáp ở phía dưới (y = minLocalY), cắt tiến dần lên phía trên
      const seamP1 = rotatePoint([minLocalX, minLocalY], angleRad, originPoint);
      const seamP2 = rotatePoint([maxLocalX, minLocalY], angleRad, originPoint);
      cutSeams.push({
        start: seamP1,
        end: seamP2,
        lengthMm: Math.hypot(seamP2[0] - seamP1[0], seamP2[1] - seamP1[1]),
      });

      let currY = minLocalY;
      while (currY < maxLocalY - 5) {
        const remainingHeight = maxLocalY - currY;
        const pieceWidth = gapWidth;

        const candidate = pickRemnant(remainingHeight, pieceWidth);

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
          const worldRing = rotateRing(localRing, angleRad, originPoint);
          const piecePoly: Polygon = [ensureClosedRing(worldRing)];
          let clipped: Polygon[] = [piecePoly];
          if (roomPolygon) {
            try {
              const res = polygonClipping.intersection(piecePoly as any, roomPolygon as any) as unknown as Polygon[];
              if (res && res.length > 0) clipped = res;
            } catch {}
          }
          const usedArea = clipped.reduce((sum, p) => sum + getPolygonArea(p), 0);
          const center = rotatePoint([(minLocalX + maxLocalX) / 2, (currY + nextY) / 2], angleRad, originPoint);
          const dirStart = rotatePoint([minLocalX, (currY + nextY) / 2], angleRad, originPoint);
          const dirEnd = rotatePoint([maxLocalX, (currY + nextY) / 2], angleRad, originPoint);

          const pairNum = String(pieceIdx).padStart(2, '0');
          const sCode = `S-${pairNum}`;
          const pCode = `P-${pairNum}`;

          const pieceName = `MẢNH CẮT ${pieceIdx} (${(pieceWidth / 1000).toFixed(1)}m x ${(pieceHeight / 1000).toFixed(1)}m)`;
          const stripItem: BroadloomStrip = {
            id: `STRIP-CUT-${rooms?.[0]?.id ?? 'ROOM'}-${pieceIdx}`,
            name: pieceName,
            roomId: primaryStrips[0].roomId,
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
            sourceSliceCode: sCode,
            matchingCode: pCode,
            offcuts: [],
            center,
            directionStart: dirStart,
            directionEnd: dirEnd,
          };
          cutStrips.push(stripItem);

          if (nextY < maxLocalY - 5) {
            const sp1 = rotatePoint([minLocalX, nextY], angleRad, originPoint);
            const sp2 = rotatePoint([maxLocalX, nextY], angleRad, originPoint);
            cutSeams.push({ start: sp1, end: sp2, lengthMm: Math.hypot(sp2[0] - sp1[0], sp2[1] - sp1[1]) });
          }

          const sliceInfo = sliceFromRemnant(
            candidate,
            pieceWidth,
            isVertical,
            angleRad,
            originPoint
          );

          if (!candidate.offcut.subSlices) {
            candidate.offcut.subSlices = [];
          }
          candidate.offcut.subSlices.push({
            id: `SLICE-${candidate.offcut.id}-${pieceIdx}`,
            code: sCode,
            targetCode: pCode,
            targetStripId: stripItem.id,
            polygon: sliceInfo.slicePoly,
            center: sliceInfo.sliceCenter,
            widthMm: Math.round(sliceInfo.cutWidth),
            lengthMm: Math.round(sliceInfo.cutLength),
            index: pieceIdx,
          });

          offcutLinks.push({
            id: `LINK-${candidate.offcut.id}-${stripItem.id}`,
            pairIndex: pieceIdx,
            sourceCode: sCode,
            targetCode: pCode,
            sourceTileId: candidate.offcut.sourceTileId,
            sourceOffcutId: candidate.offcut.id,
            targetTileId: stripItem.id,
            sourceCenter: sliceInfo.sliceCenter,
            targetCenter: stripItem.center,
            areaMm2: stripItem.usedAreaMm2,
            label: `${sCode} ➔ ${pCode} (Cắt ${(pieceWidth / 1000).toFixed(1)}m x ${(pieceHeight / 1000).toFixed(1)}m)`,
            sourceWidthMm: Math.round(pieceWidth),
            sourceHeightMm: Math.round(candidate.remWidth),
            targetWidthMm: Math.round(pieceWidth),
            targetHeightMm: Math.round(pieceHeight),
          });

          candidate.remLengthRemaining -= sliceInfo.cutLength;
          candidate.totalUsed += sliceInfo.cutLength;
          candidate.usedPiecesCount++;
          currY = nextY;
        } else {
          let newRollIdx = 0;
          while (currY < maxLocalY - 5) {
            newRollIdx++;
            const rollH = Math.min(standardRollWidth, maxLocalY - currY);
            const nextY = currY + rollH;
            const pieceW = gapWidth;
            const localRing: Ring = [
              [minLocalX, currY],
              [maxLocalX, currY],
              [maxLocalX, nextY],
              [minLocalX, nextY],
            ];
            const worldRing = rotateRing(localRing, angleRad, originPoint);
            const piecePoly: Polygon = [ensureClosedRing(worldRing)];
            let clipped: Polygon[] = [piecePoly];
            if (roomPolygon) {
              try {
                const res = polygonClipping.intersection(piecePoly as any, roomPolygon as any) as unknown as Polygon[];
                if (res && res.length > 0) clipped = res;
              } catch {}
            }
            const usedArea = clipped.reduce((sum, p) => sum + getPolygonArea(p), 0);
            const center = rotatePoint([(minLocalX + maxLocalX) / 2, (currY + nextY) / 2], angleRad, originPoint);
            const dirStart = rotatePoint([minLocalX, (currY + nextY) / 2], angleRad, originPoint);
            const dirEnd = rotatePoint([maxLocalX, (currY + nextY) / 2], angleRad, originPoint);

            cutStrips.push({
              id: `STRIP-NEW-${++nextNewRollId}`,
              name: `Roll ${rollWidthM} - NEW ${nextNewRollId} (${(pieceW / 1000).toFixed(1)}m)`,
              roomId: primaryStrips[0].roomId,
              index: pieceIdx + newRollIdx,
              rawPolygon: piecePoly,
              clippedPolygons: clipped,
              rawAreaMm2: pieceW * standardRollWidth,
              usedAreaMm2: usedArea,
              lengthMm: pieceW,
              widthMm: standardRollWidth,
              usedWidthMm: rollH,
              isReusedFromOffcut: false,
              offcuts: [],
              center,
              directionStart: dirStart,
              directionEnd: dirEnd,
            });

            if (nextY < maxLocalY - 5) {
              const sp1 = rotatePoint([minLocalX, nextY], angleRad, originPoint);
              const sp2 = rotatePoint([maxLocalX, nextY], angleRad, originPoint);
              cutSeams.push({ start: sp1, end: sp2, lengthMm: Math.hypot(sp2[0] - sp1[0], sp2[1] - sp1[1]) });
            }

            currY = nextY;
          }
          break;
        }
      }
    }
  }

  // Cập nhật thông số các mảng thảm thừa đã sử dụng
  pool.forEach((r) => {
    if (r.usedPiecesCount > 0) {
      r.offcut.remainingLengthMm = Math.max(0, r.remLengthRemaining);
      r.offcut.remainingAreaMm2 = Math.max(0, r.remLengthRemaining * r.remWidth);
      r.offcut.assignedToTileId = `${r.usedPiecesCount} mảnh (${(r.totalUsed / 1000).toFixed(1)}m / ${(r.initialLength / 1000).toFixed(1)}m)`;

      // Tính leftoverPolygon nếu còn thừa > 50mm
      if (r.remLengthRemaining > 50) {
        let leftoverLocalRing: Ring;
        if (isVertical) {
          let loMinY: number, loMaxY: number;
          if (r.sliceDirection === 'from_max') {
            loMinY = r.localMinY;
            loMaxY = r.currentCutPosition;
          } else {
            loMinY = r.currentCutPosition;
            loMaxY = r.localMaxY;
          }
          leftoverLocalRing = [
            [r.localMinX, loMinY],
            [r.localMaxX, loMinY],
            [r.localMaxX, loMaxY],
            [r.localMinX, loMaxY],
          ];
        } else {
          let loMinX: number, loMaxX: number;
          if (r.sliceDirection === 'from_max') {
            loMinX = r.localMinX;
            loMaxX = r.currentCutPosition;
          } else {
            loMinX = r.currentCutPosition;
            loMaxX = r.localMaxX;
          }
          leftoverLocalRing = [
            [loMinX, r.localMinY],
            [loMaxX, r.localMinY],
            [loMaxX, r.localMaxY],
            [loMinX, r.localMaxY],
          ];
        }
        const loWorldRing = rotateRing(leftoverLocalRing, angleRad, originPoint);
        let loPoly: Polygon = [ensureClosedRing(loWorldRing)];
        if (r.offcut.polygon) {
          try {
            const inter = polygonClipping.intersection(
              loPoly as any,
              r.offcut.polygon as any
            ) as unknown as Polygon[];
            if (inter && inter.length > 0) loPoly = inter[0];
          } catch {}
        }
        r.offcut.leftoverPolygon = loPoly;
      }
    }
  });

  // Chuẩn hóa tên cho các cuộn chính
  primaryStrips.forEach((s, idx) => {
    s.name = `Roll ${rollWidthM} - ${idx + 1}`;
    s.isReusedFromOffcut = false;
  });

  const finalStrips: BroadloomStrip[] = [...primaryStrips, ...cutStrips];
  if (!offcutLinks.length || !broadloomCoverageMatches(nesting.broadloomStrips, finalStrips, rooms[0])) {
    return nesting;
  }

  // A narrow installed patch still consumes a full-width roll cut. Keep the
  // unused width in stock and show its true outside-floor geometry.
  for (const strip of cutStrips.filter((item) => !item.isReusedFromOffcut)) {
    try {
      const cut = getBroadloomCutPolygon(strip);
      const leftovers = polygonClipping.difference(cut as any,
        ...strip.clippedPolygons as any) as Polygon[];
      for (let index = 0; index < leftovers.length; index++) {
        const polygon = leftovers[index];
        const local = polygon.map((ring) => rotateRing(ring, invAngleRad, originPoint));
        const box = getPolygonBoundingBox(local);
        const area = getPolygonArea(polygon);
        if (area < 100 || Math.min(box.width, box.height) < minBroadloomWidth) continue;
        const offcut: OffcutItem = {
          id: `OFF-NEW-${strip.id}-${index + 1}`, sourceTileId: strip.id,
          polygon, bbox: getPolygonBoundingBox(polygon), center: getPolygonCentroid(polygon),
          areaMm2: area, width: Math.min(box.width, box.height),
          height: Math.max(box.width, box.height),
          grainAngle: rotationDeg + (isVertical ? 90 : 0), isDiscarded: false,
          isBroadloomLongitudinal: true, remainingAreaMm2: area,
        };
        strip.offcuts.push(offcut);
        offcutCopies.set(offcut.id, offcut);
      }
    } catch {
      return nesting;
    }
  }

  // Tính mét dài cần mua: Chỉ tính các dải mua mới
  let totalLinearMeters = 0;
  for (const s of finalStrips) {
    if (!s.isReusedFromOffcut) {
      totalLinearMeters += s.lengthMm / 1000;
    }
  }

  const reusedOffcuts = pool.filter((r) => r.usedPiecesCount > 0).map((r) => r.offcut);

  return {
    ...nesting,
    broadloomStrips: finalStrips,
    seams: [...nesting.seams, ...cutSeams],
    offcutsAvailable: [...offcutCopies.values()],
    offcutsReused: reusedOffcuts,
    offcutLinks,
    totalLinearMeters,
  };
}

/**
 * Tile / PVC Offcut Optimization
 */
function optimizeTileOffcuts(
  nesting: NestingResult,
  config: OffcutConfig
): NestingResult {
  const { minWidth, minHeight, allowRotate } = config;

  const viableOffcuts: OffcutItem[] = [];
  const discardedScraps: OffcutItem[] = [];

  for (const off of nesting.offcutsAvailable) {
    const bbox = getPolygonBoundingBox(off.polygon);
    const w = bbox.width;
    const h = bbox.height;

    const fitsDirect = w >= minWidth && h >= minHeight;
    const fitsRotated = allowRotate && (h >= minWidth && w >= minHeight);

    if (fitsDirect || fitsRotated) {
      viableOffcuts.push({
        ...off,
        bbox,
        isDiscarded: false,
      });
    } else {
      discardedScraps.push({
        ...off,
        bbox,
        isDiscarded: true,
      });
    }
  }

  const cutTiles = nesting.tiles
    .filter((t) => t.status === 'cut' || t.status === 'offcut_reused')
    .map((t) => ({
      ...t,
      status: 'cut' as const,
      reusedFromId: undefined,
      reusedFromTileId: undefined,
      reusedSourceCode: undefined,
      matchingCode: undefined,
      donorTargetCodes: undefined,
      donorTargetIds: undefined,
    }));

  cutTiles.sort((a, b) => b.areaMm2 - a.areaMm2);

  const availablePool = [...viableOffcuts];
  const offcutsReused: OffcutItem[] = [];
  const offcutLinks: OffcutFlowLink[] = [];
  
  // Pre-seed tileMap with reset state so all tiles have clean metadata
  const tileMap = new Map<string, NestingTile>();
  for (const t of nesting.tiles) {
    tileMap.set(t.id, {
      ...t,
      status: t.coverageRatio >= 0.998 ? 'full' : 'cut',
      reusedFromId: undefined,
      reusedFromTileId: undefined,
      reusedSourceCode: undefined,
      matchingCode: undefined,
      donorTargetCodes: undefined,
      donorTargetIds: undefined,
    });
  }

  let pairCounter = 1;
  const donorTileIds = new Set<string>();
  const receiverTileIds = new Set<string>();

  for (const tile of cutTiles) {
    // Nếu tile này đã là phôi gốc (đã hiến mảng thừa cho viên khác và tiêu thụ 1 viên nguyên),
    // hoặc đã là viên ghép bù thì không xét nhận ghép bù nữa.
    if (donorTileIds.has(tile.id) || receiverTileIds.has(tile.id)) continue;

    const tileBBox = getPolygonBoundingBox(tile.clippedPolygons[0] || tile.rawPolygon);
    const neededW = tileBBox.width;
    const neededH = tileBBox.height;
    const neededArea = tile.areaMm2;

    let bestMatchIdx = -1;
    let minWastedArea = Infinity;

    for (let i = 0; i < availablePool.length; i++) {
      const off = availablePool[i];

      if (off.sourceTileId === tile.id) continue;
      // Không lấy phôi từ một viên vốn đã là viên được ghép bù (không xuất kho viên mới)
      if (receiverTileIds.has(off.sourceTileId)) continue;
      if (off.areaMm2 + 1 < neededArea) continue;

      if (!allowRotate) {
        const angleDiff = Math.abs((off.grainAngle - tile.grainAngle) % 360);
        if (angleDiff > 1 && Math.abs(angleDiff - 360) > 1) {
          continue;
        }
      }

      const offW = off.bbox.width;
      const offH = off.bbox.height;

      const canFitDirect = offW + 1 >= neededW && offH + 1 >= neededH;
      const canFitRotated = allowRotate && offH + 1 >= neededW && offW + 1 >= neededH;

      if ((canFitDirect || canFitRotated) && offcutContainsTile(off.polygon, tile.clippedPolygons, allowRotate)) {
        const excessArea = off.areaMm2 - neededArea;
        if (excessArea < minWastedArea) {
          minWastedArea = excessArea;
          bestMatchIdx = i;
        }
      }
    }

    if (bestMatchIdx >= 0) {
      const matchedOffcut = availablePool.splice(bestMatchIdx, 1)[0];
      matchedOffcut.assignedToTileId = tile.id;
      offcutsReused.push(matchedOffcut);

      donorTileIds.add(matchedOffcut.sourceTileId);
      receiverTileIds.add(tile.id);

      // Vì tile này được ghép bù từ phôi khác (không cắt từ viên mới),
      // nên mảng thừa ban đầu của nó trong kho phôi khả dụng phải được thu hồi/loại bỏ
      for (let j = availablePool.length - 1; j >= 0; j--) {
        if (availablePool[j].sourceTileId === tile.id) {
          availablePool.splice(j, 1);
        }
      }

      const pairNum = String(pairCounter).padStart(2, '0');
      const sourceCode = `S-${pairNum}`;
      const targetCode = `P-${pairNum}`;
      pairCounter++;

      const offcutBBox = matchedOffcut.bbox;
      const targetBBox = tileBBox;

      offcutLinks.push({
        id: `LINK-${matchedOffcut.id}-${tile.id}`,
        pairIndex: pairCounter - 1,
        sourceCode,
        targetCode,
        sourceTileId: matchedOffcut.sourceTileId,
        sourceOffcutId: matchedOffcut.id,
        targetTileId: tile.id,
        sourceCenter: matchedOffcut.center,
        targetCenter: tile.center,
        areaMm2: tile.areaMm2,
        label: `${sourceCode} ➔ ${targetCode}`,
        sourceWidthMm: Math.round(offcutBBox.width),
        sourceHeightMm: Math.round(offcutBBox.height),
        targetWidthMm: Math.round(targetBBox.width),
        targetHeightMm: Math.round(targetBBox.height),
      });

      // 1. Update target tile (the patch tile)
      const currentTarget = tileMap.get(tile.id) || tile;
      tileMap.set(tile.id, {
        ...currentTarget,
        status: 'offcut_reused',
        matchingCode: targetCode,
        reusedFromId: matchedOffcut.id,
        reusedFromTileId: matchedOffcut.sourceTileId,
        reusedSourceCode: sourceCode,
      });

      // 2. Update donor source tile (if exists in tileMap)
      const sourceTile = tileMap.get(matchedOffcut.sourceTileId);
      if (sourceTile) {
        const prevCodes = sourceTile.donorTargetCodes || [];
        const prevIds = sourceTile.donorTargetIds || [];
        tileMap.set(matchedOffcut.sourceTileId, {
          ...sourceTile,
          matchingCode: sourceTile.matchingCode ? `${sourceTile.matchingCode}, ${sourceCode}` : sourceCode,
          donorTargetCodes: [...prevCodes, targetCode],
          donorTargetIds: [...prevIds, tile.id],
        });
      }
    }
  }

  const updatedTiles: NestingTile[] = nesting.tiles.map((t) => {
    if (tileMap.has(t.id)) {
      return tileMap.get(t.id)!;
    }
    return t;
  });

  const fullCount = updatedTiles.filter((t) => t.status === 'full').length;
  const rawCutCount = updatedTiles.filter((t) => t.status === 'cut').length;
  const totalRawTiles = fullCount + rawCutCount;

  return {
    ...nesting,
    tiles: updatedTiles,
    offcutsAvailable: availablePool,
    offcutsReused,
    discardedScraps,
    offcutLinks,
    totalRawTiles,
  };
}

/** Check the actual cut shape; a bounding box alone can contain an impossible L-shaped fit. */
function offcutContainsTile(source: Polygon, targets: Polygon[], allowRotate: boolean): boolean {
  if (targets.length !== 1 || !targets[0]?.[0]?.length) return false;
  const target = targets[0];
  const sourceBox = getPolygonBoundingBox(source);
  const sourceVertices = source.flat();
  for (const angle of allowRotate ? [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2] : [0]) {
    const rotated = target.map((ring) => ring.map((point) => rotatePoint(point, angle, [0, 0])));
    const box = getPolygonBoundingBox(rotated);
    const anchors: Point[] = [
      [sourceBox.minX - box.minX, sourceBox.minY - box.minY],
      [sourceBox.maxX - box.maxX, sourceBox.minY - box.minY],
      [sourceBox.minX - box.minX, sourceBox.maxY - box.maxY],
      [sourceBox.maxX - box.maxX, sourceBox.maxY - box.maxY],
    ];
    for (const vertex of sourceVertices) {
      for (const targetVertex of rotated[0]) anchors.push([vertex[0] - targetVertex[0], vertex[1] - targetVertex[1]]);
    }
    for (const [dx, dy] of anchors) {
      const placed = rotated.map((ring) => ring.map(([x, y]) => [x + dx, y + dy] as Point));
      try {
        const outside = polygonClipping.difference(placed as any, source as any) as Polygon[];
        if (outside.reduce((sum, poly) => sum + getPolygonArea(poly), 0) < 1) return true;
      } catch { /* Ignore invalid candidate placement. */ }
    }
  }
  return false;
}

function broadloomCoverageMatches(raw: BroadloomStrip[], result: BroadloomStrip[], room: RoomGeometry): boolean {
  const retained = new Set(result.map((strip) => strip.id));
  const rawIds = new Set(raw.map((strip) => strip.id));
  for (const strip of result) {
    if (strip.isReusedFromOffcut && !strip.reusedFromId) return false;
  }
  for (const strip of result) {
    for (const offcut of strip.offcuts) {
      if (!offcut.subSlices?.length) continue;
      if (!retained.has(strip.id)) return false;
      let usedArea = 0;
      for (const slice of offcut.subSlices) {
        const area = getPolygonArea(slice.polygon);
        if (area + 100 < slice.widthMm * slice.lengthMm) return false;
        usedArea += area;
      }
      if (usedArea > offcut.areaMm2 + 100) return false;
    }
  }
  try {
    // A generated patch must cover real uncovered floor, not sit on a retained
    // full roll (the false S-01 -> P-01 case in a corridor).
    for (const patch of result.filter((strip) => !rawIds.has(strip.id))) {
      let overlapArea = 0;
      for (const other of result) {
        if (other.id === patch.id) continue;
        for (const a of patch.clippedPolygons) for (const b of other.clippedPolygons) {
          const overlap = polygonClipping.intersection(a as any, b as any) as Polygon[];
          overlapArea += overlap.reduce((sum, p) => sum + getPolygonArea(p), 0);
        }
      }
      if (overlapArea > Math.max(1000, patch.usedAreaMm2 * 0.02)) return false;
    }
    const floor: Polygon = [ensureClosedRing(room.boundary), ...room.holes.map(ensureClosedRing)];
    const installed = result.flatMap((strip) => strip.clippedPolygons);
    if (installed.length === 0) return false;
    const covered = polygonClipping.union(installed[0] as any, ...installed.slice(1) as any) as Polygon[];
    const missing = polygonClipping.difference(floor as any, covered as any) as Polygon[];
    return missing.reduce((sum, polygon) => sum + getPolygonArea(polygon), 0) <= 100;
  } catch {
    return false;
  }
}
