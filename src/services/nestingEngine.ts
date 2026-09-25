import polygonClipping from 'polygon-clipping';
import {
  Point,
  Ring,
  Polygon,
  RoomGeometry,
  TileConfig,
  BroadloomConfig,
  LayingPattern,
  MaterialCategory,
  NestingTile,
  BroadloomStrip,
  BroadloomSeam,
  OffcutItem,
  NestingResult,
} from '../types';
import {
  getRingBoundingBox,
  getPolygonArea,
  rotatePoint,
  rotateRing,
  doBBoxesIntersect,
  getPolygonBoundingBox,
  getPolygonCentroid,
  formatRollWidth,
} from './geometryMath';

export interface NestingOptions {
  rooms: RoomGeometry[];
  materialType: MaterialCategory;
  tileConfig: TileConfig;
  broadloomConfig: BroadloomConfig;
  pattern: LayingPattern;
  rotationDeg: number;
  originPoint: Point;
  roomOrigins?: Record<string, Point>;
  minBroadloomOffcutMm?: number;
}

export function computeNesting(options: NestingOptions): NestingResult {
  const startTime = performance.now();
  const {
    rooms,
    materialType,
    tileConfig,
    broadloomConfig,
    pattern,
    rotationDeg,
    originPoint,
    roomOrigins,
    minBroadloomOffcutMm,
  } = options;

  if (rooms.length === 0) {
    return {
      tiles: [],
      broadloomStrips: [],
      seams: [],
      offcutsAvailable: [],
      offcutsReused: [],
      discardedScraps: [],
      offcutLinks: [],
      totalRawTiles: 0,
      totalLinearMeters: 0,
      computationTimeMs: 0,
    };
  }

  if (materialType === 'broadloom') {
    return computeBroadloomNesting(rooms, broadloomConfig, rotationDeg, originPoint, startTime, minBroadloomOffcutMm, roomOrigins);
  } else {
    return computeTileNesting(rooms, tileConfig, pattern, rotationDeg, originPoint, startTime, roomOrigins);
  }
}

function computeTileNesting(
  rooms: RoomGeometry[],
  tileConfig: TileConfig,
  pattern: LayingPattern,
  rotationDeg: number,
  originPoint: Point,
  startTime: number,
  roomOrigins?: Record<string, Point>
): NestingResult {
  const userAngleRad = (rotationDeg * Math.PI) / 180;
  const w = tileConfig.width;
  const h = tileConfig.height;

  const tiles: NestingTile[] = [];
  const offcutsAvailable: OffcutItem[] = [];
  let tileIdCounter = 1;
  let offcutIdCounter = 1;

  for (const room of rooms) {
    const roomOrigin = roomOrigins?.[room.id] ?? originPoint;
    // Generate only around this room. Distant rooms must not multiply the grid.
    const margin = Math.max(w, h) * 3;
    const rawTiles: {
      row: number;
      col: number;
      polygon: Polygon;
      isQuarterRotated?: boolean;
      grainAngle: number;
    }[] = [];
    const { minX, maxX, minY, maxY } = room.bbox;
    if (pattern === 'herringbone_90' || pattern === 'herringbone_45') {
      generateHerringboneGrid(minX - margin, maxX + margin, minY - margin, maxY + margin,
        roomOrigin, userAngleRad, w, h, pattern, rawTiles);
    } else {
      generateStandardGrid(minX - margin, maxX + margin, minY - margin, maxY + margin,
        roomOrigin, userAngleRad, rotationDeg, w, h, pattern, rawTiles);
    }
    const roomPolygon: Polygon = [
      ensureClosedRing(room.boundary),
      ...room.holes.map(ensureClosedRing),
    ];
    const roomBBox = room.bbox;

    for (const raw of rawTiles) {
      const tileBBox = getPolygonBoundingBox(raw.polygon);
      if (!doBBoxesIntersect(tileBBox, roomBBox)) {
        continue;
      }

      const rawArea = getPolygonArea(raw.polygon);
      if (rawArea <= 1) continue;

      try {
        const clippedMulti = polygonClipping.intersection(
          raw.polygon as any,
          roomPolygon as any
        ) as unknown as Polygon[];

        if (!clippedMulti || clippedMulti.length === 0) {
          continue;
        }

        let usedArea = 0;
        for (const p of clippedMulti) {
          usedArea += getPolygonArea(p);
        }

        if (usedArea < 10) continue;

        const coverageRatio = usedArea / rawArea;
        const isFull = coverageRatio >= 0.998;
        const tileId = `T-${tileIdCounter++}`;
        const tileOffcuts: OffcutItem[] = [];
        const tileCenter = getPolygonCentroid(clippedMulti[0]);

        if (!isFull) {
          const offcutMulti = polygonClipping.difference(
            raw.polygon as any,
            roomPolygon as any
          ) as unknown as Polygon[];

          if (offcutMulti && offcutMulti.length > 0) {
            for (const offPoly of offcutMulti) {
              const offArea = getPolygonArea(offPoly);
              if (offArea > 100) {
                const offBBox = getPolygonBoundingBox(offPoly);
                const offCenter = getPolygonCentroid(offPoly);
                const offItem: OffcutItem = {
                  id: `OFF-${offcutIdCounter++}`,
                  sourceTileId: tileId,
                  polygon: offPoly,
                  bbox: offBBox,
                  center: offCenter,
                  areaMm2: offArea,
                  width: offBBox.width,
                  height: offBBox.height,
                  grainAngle: raw.grainAngle,
                  isDiscarded: false,
                };
                tileOffcuts.push(offItem);
                offcutsAvailable.push(offItem);
              }
            }
          }
        }

        tiles.push({
          id: tileId,
          roomId: room.id,
          originalIndex: tileIdCounter - 1,
          row: raw.row,
          col: raw.col,
          rawPolygon: raw.polygon,
          clippedPolygons: clippedMulti,
          status: isFull ? 'full' : 'cut',
          areaMm2: usedArea,
          rawAreaMm2: rawArea,
          coverageRatio,
          rotationDeg,
          grainAngle: raw.grainAngle,
          isQuarterTurnRotated: raw.isQuarterRotated,
          offcuts: tileOffcuts,
          center: tileCenter,
        });
      } catch {
        // guard
      }
    }
  }

  const computationTimeMs = performance.now() - startTime;

  return {
    tiles,
    broadloomStrips: [],
    seams: [],
    offcutsAvailable,
    offcutsReused: [],
    discardedScraps: [],
    offcutLinks: [],
    totalRawTiles: tiles.length,
    totalLinearMeters: 0,
    computationTimeMs,
  };
}

function generateStandardGrid(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  origin: Point,
  userAngleRad: number,
  rotationDeg: number,
  w: number,
  h: number,
  pattern: LayingPattern,
  rawTiles: any[]
) {
  if (pattern === 'quarter_turn' && w !== h) {
    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    const scale = 1000;
    const wi = Math.round(w * scale);
    const hi = Math.round(h * scale);
    const moduleSize = (wi / gcd(wi, hi)) * hi / scale;
    // A square module can be tiled in either direction without gaps or overlaps.
    if (moduleSize <= 10000) {
      generateQuarterTurnModules(minX, maxX, minY, maxY, origin, userAngleRad,
        rotationDeg, w, h, moduleSize, rawTiles);
      return;
    }
    throw new Error('Kích thước tấm không tạo được mô-đun xoay 90° trong giới hạn 10 m. Hãy chọn kích thước hoặc kiểu trải khác.');
  }
  const invAngle = -userAngleRad;
  const corners: Point[] = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
  const rotCorners = corners.map((pt) => rotatePoint(pt, invAngle, origin));
  const bRot = getRingBoundingBox(rotCorners);

  const startCol = Math.floor((bRot.minX - origin[0]) / w) - 1;
  const endCol = Math.ceil((bRot.maxX - origin[0]) / w) + 1;
  const startRow = Math.floor((bRot.minY - origin[1]) / h) - 1;
  const endRow = Math.ceil((bRot.maxY - origin[1]) / h) + 1;

  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      let offsetX = origin[0] + c * w;
      const offsetY = origin[1] + r * h;

      let isQuarter = false;
      let grain = rotationDeg;

      if (pattern === 'ashlar') {
        if (Math.abs(r) % 2 === 1) offsetX += w / 2;
      } else if (pattern === 'stagger') {
        offsetX += ((Math.abs(r) % 3) * w) / 3;
      } else if (pattern === 'quarter_turn') {
        if ((Math.abs(r) + Math.abs(c)) % 2 === 1) {
          isQuarter = true;
          grain = (rotationDeg + 90) % 360;
        }
      }

      const baseRing: Ring = [
        [offsetX, offsetY],
        [offsetX + w, offsetY],
        [offsetX + w, offsetY + h],
        [offsetX, offsetY + h],
      ];

      let localRing = baseRing;
      if (isQuarter) {
        const cx = offsetX + w / 2;
        const cy = offsetY + h / 2;
        localRing = rotateRing(baseRing, Math.PI / 2, [cx, cy]);
      }

      const worldRing = rotateRing(localRing, userAngleRad, origin);
      rawTiles.push({
        row: r,
        col: c,
        polygon: [ensureClosedRing(worldRing)],
        isQuarterRotated: isQuarter,
        grainAngle: grain,
      });
    }
  }
}

function generateQuarterTurnModules(
  minX: number, maxX: number, minY: number, maxY: number, origin: Point,
  angle: number, rotationDeg: number, w: number, h: number, moduleSize: number,
  rawTiles: any[]
) {
  const corners: Point[] = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
  const bounds = getRingBoundingBox(corners.map((p) => rotatePoint(p, -angle, origin)));
  const c0 = Math.floor((bounds.minX - origin[0]) / moduleSize) - 1;
  const c1 = Math.ceil((bounds.maxX - origin[0]) / moduleSize) + 1;
  const r0 = Math.floor((bounds.minY - origin[1]) / moduleSize) - 1;
  const r1 = Math.ceil((bounds.maxY - origin[1]) / moduleSize) + 1;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const rotated = (Math.abs(r) + Math.abs(c)) % 2 === 1;
      const tw = rotated ? h : w;
      const th = rotated ? w : h;
      for (let j = 0; j < Math.round(moduleSize / th); j++) {
        for (let i = 0; i < Math.round(moduleSize / tw); i++) {
          const x = origin[0] + c * moduleSize + i * tw;
          const y = origin[1] + r * moduleSize + j * th;
          const ring: Ring = [[x, y], [x + tw, y], [x + tw, y + th], [x, y + th]];
          rawTiles.push({
            row: r, col: c, polygon: [ensureClosedRing(rotateRing(ring, angle, origin))],
            isQuarterRotated: rotated, grainAngle: (rotationDeg + (rotated ? 90 : 0)) % 360,
          });
        }
      }
    }
  }
}

function generateHerringboneGrid(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  origin: Point,
  userAngleRad: number,
  w: number,
  h: number,
  pattern: 'herringbone_90' | 'herringbone_45',
  rawTiles: any[]
) {
  const L = Math.max(w, h);
  const W = Math.min(w, h);

  const baseAngleRad = pattern === 'herringbone_90' ? Math.PI / 4 : 0;
  const totalAngleRad = userAngleRad + baseAngleRad;
  const invAngle = -totalAngleRad;

  const corners: Point[] = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
  const rotCorners = corners.map((pt) => rotatePoint(pt, invAngle, origin));
  const bRot = getRingBoundingBox(rotCorners);

  const dxMin = bRot.minX - origin[0];
  const dxMax = bRot.maxX - origin[0];
  const dyMin = bRot.minY - origin[1];
  const dyMax = bRot.maxY - origin[1];

  const minI = Math.floor((dxMin + dyMin) / (2 * L)) - 2;
  const maxI = Math.ceil((dxMax + dyMax) / (2 * L)) + 2;
  const minJ = Math.floor((dyMin - dxMax) / (2 * W)) - 2;
  const maxJ = Math.ceil((dyMax - dxMin) / (2 * W)) + 2;

  for (let i = minI; i <= maxI; i++) {
    for (let j = minJ; j <= maxJ; j++) {
      const ox = origin[0] + i * L - j * W;
      const oy = origin[1] + i * L + j * W;

      const ringH: Ring = [
        [ox, oy],
        [ox + L, oy],
        [ox + L, oy + W],
        [ox, oy + W],
      ];

      const ringV: Ring = [
        [ox + L - W, oy + W],
        [ox + L, oy + W],
        [ox + L, oy + W + L],
        [ox + L - W, oy + W + L],
      ];

      const worldRingH = rotateRing(ringH, totalAngleRad, origin);
      const worldRingV = rotateRing(ringV, totalAngleRad, origin);

      const grainH = ((totalAngleRad * 180) / Math.PI) % 360;
      const grainV = ((totalAngleRad * 180) / Math.PI + 90) % 360;

      rawTiles.push({
        row: i,
        col: j * 2,
        polygon: [ensureClosedRing(worldRingH)],
        grainAngle: grainH,
      });

      rawTiles.push({
        row: i,
        col: j * 2 + 1,
        polygon: [ensureClosedRing(worldRingV)],
        grainAngle: grainV,
      });
    }
  }
}

/**
 * Broadloom Carpet Nesting Engine with ROLL x - N naming & Remnant Extraction
 */
function computeBroadloomNesting(
  rooms: RoomGeometry[],
  config: BroadloomConfig,
  rotationDeg: number,
  defaultOrigin: Point,
  startTime: number,
  minBroadloomOffcutMm: number = 1000,
  roomOrigins?: Record<string, Point>
): NestingResult {
  const angleRad = (rotationDeg * Math.PI) / 180;
  const invAngleRad = -angleRad;

  const rollWidth = config.rollWidth;
  const seamOverlap = config.seamOverlap;
  const effectiveWidth = Math.max(100, rollWidth - seamOverlap);
  const rollWidthLabel = formatRollWidth(rollWidth);

  const margin = rollWidth;

  const strips: BroadloomStrip[] = [];
  const offcutsAvailable: OffcutItem[] = [];

  let stripIdx = 0;
  let offcutIdx = 0;

  for (const room of rooms) {
    const originPoint = roomOrigins?.[room.id] ?? defaultOrigin;
    const roomBounds = getRingBoundingBox(rotateRing(room.boundary, invAngleRad, originPoint));
    const minX = roomBounds.minX - margin;
    const maxX = roomBounds.maxX + margin;
    const minY = roomBounds.minY - margin;
    const maxY = roomBounds.maxY + margin;
    const roomPolygon: Polygon = [
      ensureClosedRing(room.boundary),
      ...room.holes.map(ensureClosedRing),
    ];

    if (config.direction === 'vertical') {
      const startX = originPoint[0] + Math.floor((roomBounds.minX - originPoint[0]) / effectiveWidth) * effectiveWidth;
      for (let x = startX; x < roomBounds.maxX; x += effectiveWidth) {
        // The previous lane's seam overlap must not create a 30 mm strip before the room.
        if (x + effectiveWidth <= roomBounds.minX + 1e-6) continue;
        const baseRing: Ring = [
          [x, minY],
          [x + rollWidth, minY],
          [x + rollWidth, maxY],
          [x, maxY],
        ];

        const worldRing = rotateRing(baseRing, angleRad, originPoint);
        const stripPoly: Polygon = [ensureClosedRing(worldRing)];

        try {
          const clipped = polygonClipping.intersection(stripPoly as any, roomPolygon as any) as unknown as Polygon[];
          if (clipped && clipped.length > 0) {
            let usedArea = 0;
            let stripMinY = Infinity;
            let stripMaxY = -Infinity;
            let stripMinX = Infinity;
            let stripMaxX = -Infinity;

            for (const poly of clipped) {
              usedArea += getPolygonArea(poly);
              for (const pt of poly[0]) {
                const localPt = rotatePoint(pt, invAngleRad, originPoint);
                if (localPt[1] < stripMinY) stripMinY = localPt[1];
                if (localPt[1] > stripMaxY) stripMaxY = localPt[1];
                if (localPt[0] < stripMinX) stripMinX = localPt[0];
                if (localPt[0] > stripMaxX) stripMaxX = localPt[0];
              }
            }

            if (usedArea > 100) {
              const cutLength = Math.max(0, stripMaxY - stripMinY + (config.cutAllowanceMm ?? 100));
              const usedWidth = Math.max(50, Math.min(rollWidth, stripMaxX - stripMinX));

              const stripId = `STRIP-${++stripIdx}`;
              const stripName = `Roll ${rollWidthLabel} - ${stripIdx}`;

              const dirStartLocal: Point = [x + rollWidth / 2, stripMinY];
              const dirEndLocal: Point = [x + rollWidth / 2, stripMaxY];
              const dirStart = rotatePoint(dirStartLocal, angleRad, originPoint);
              const dirEnd = rotatePoint(dirEndLocal, angleRad, originPoint);

              const stripCenter = getPolygonCentroid(clipped[0]);

              // Cut rect in local coordinates: [x, stripMinY] to [x + rollWidth, stripMaxY]
              const stripCutRing: Ring = [
                [x, stripMinY],
                [x + rollWidth, stripMinY],
                [x + rollWidth, stripMaxY],
                [x, stripMaxY],
              ];
              const stripCutWorldRing = rotateRing(stripCutRing, angleRad, originPoint);
              const stripCutPoly: Polygon = [ensureClosedRing(stripCutWorldRing)];

              // Find exact difference outside room
              const stripOffcuts: OffcutItem[] = [];
              try {
                const diffMulti = polygonClipping.difference(
                  stripCutPoly as any,
                  roomPolygon as any
                ) as unknown as Polygon[];

                if (diffMulti && diffMulti.length > 0) {
                  for (const diffP of diffMulti) {
                    const diffArea = getPolygonArea(diffP);
                    const diffBBox = getPolygonBoundingBox(diffP);

                    const localBBox = getRingBoundingBox(rotateRing(diffP[0], invAngleRad, originPoint));
                    if (diffArea > 100 && Math.min(localBBox.width, localBBox.height) >= minBroadloomOffcutMm) {
                      const offCenter = getPolygonCentroid(diffP);
                      const offItem: OffcutItem = {
                        id: `OFF-ROLL-${++offcutIdx}`,
                        sourceTileId: stripId,
                        polygon: diffP,
                        bbox: diffBBox,
                        center: offCenter,
                        areaMm2: diffArea,
                        width: Math.min(diffBBox.width, diffBBox.height),
                        height: Math.max(diffBBox.width, diffBBox.height),
                        grainAngle: (angleRad * 180) / Math.PI + 90,
                        isDiscarded: false,
                        isBroadloomLongitudinal: true,
                      };
                      stripOffcuts.push(offItem);
                      offcutsAvailable.push(offItem);
                    }
                  }
                }
              } catch {
                // ignore
              }

              strips.push({
                id: stripId,
                name: stripName,
                roomId: room.id,
                index: stripIdx,
                rawPolygon: stripCutPoly,
                clippedPolygons: clipped,
                rawAreaMm2: cutLength * rollWidth,
                usedAreaMm2: usedArea,
                lengthMm: cutLength,
                widthMm: rollWidth,
                usedWidthMm: usedWidth,
                isReusedFromOffcut: false,
                offcuts: stripOffcuts,
                center: stripCenter,
                directionStart: dirStart,
                directionEnd: dirEnd,
              });

            }
          }
        } catch {
          // ignore
        }
      }
    } else {
      // Horizontal strips
      const startY = originPoint[1] + Math.floor((roomBounds.minY - originPoint[1]) / effectiveWidth) * effectiveWidth;
      for (let y = startY; y < roomBounds.maxY; y += effectiveWidth) {
        if (y + effectiveWidth <= roomBounds.minY + 1e-6) continue;
        const baseRing: Ring = [
          [minX, y],
          [maxX, y],
          [maxX, y + rollWidth],
          [minX, y + rollWidth],
        ];

        const worldRing = rotateRing(baseRing, angleRad, originPoint);
        const stripPoly: Polygon = [ensureClosedRing(worldRing)];

        try {
          const clipped = polygonClipping.intersection(stripPoly as any, roomPolygon as any) as unknown as Polygon[];
          if (clipped && clipped.length > 0) {
            let usedArea = 0;
            let stripMinX = Infinity;
            let stripMaxX = -Infinity;
            let stripMinY = Infinity;
            let stripMaxY = -Infinity;

            for (const poly of clipped) {
              usedArea += getPolygonArea(poly);
              for (const pt of poly[0]) {
                const localPt = rotatePoint(pt, invAngleRad, originPoint);
                if (localPt[0] < stripMinX) stripMinX = localPt[0];
                if (localPt[0] > stripMaxX) stripMaxX = localPt[0];
                if (localPt[1] < stripMinY) stripMinY = localPt[1];
                if (localPt[1] > stripMaxY) stripMaxY = localPt[1];
              }
            }

            if (usedArea > 100) {
              const cutLength = Math.max(0, stripMaxX - stripMinX + (config.cutAllowanceMm ?? 100));
              const usedWidth = Math.max(50, Math.min(rollWidth, stripMaxY - stripMinY));

              const stripId = `STRIP-${++stripIdx}`;
              const stripName = `Roll ${rollWidthLabel} - ${stripIdx}`;

              const dirStartLocal: Point = [stripMinX, y + rollWidth / 2];
              const dirEndLocal: Point = [stripMaxX, y + rollWidth / 2];
              const dirStart = rotatePoint(dirStartLocal, angleRad, originPoint);
              const dirEnd = rotatePoint(dirEndLocal, angleRad, originPoint);

              const stripCenter = getPolygonCentroid(clipped[0]);

              const stripCutRing: Ring = [
                [stripMinX, y],
                [stripMaxX, y],
                [stripMaxX, y + rollWidth],
                [stripMinX, y + rollWidth],
              ];
              const stripCutWorldRing = rotateRing(stripCutRing, angleRad, originPoint);
              const stripCutPoly: Polygon = [ensureClosedRing(stripCutWorldRing)];

              const stripOffcuts: OffcutItem[] = [];
              try {
                const diffMulti = polygonClipping.difference(
                  stripCutPoly as any,
                  roomPolygon as any
                ) as unknown as Polygon[];

                if (diffMulti && diffMulti.length > 0) {
                  for (const diffP of diffMulti) {
                    const diffArea = getPolygonArea(diffP);
                    const diffBBox = getPolygonBoundingBox(diffP);

                    const localBBox = getRingBoundingBox(rotateRing(diffP[0], invAngleRad, originPoint));
                    if (diffArea > 100 && Math.min(localBBox.width, localBBox.height) >= minBroadloomOffcutMm) {
                      const offCenter = getPolygonCentroid(diffP);
                      const offItem: OffcutItem = {
                        id: `OFF-ROLL-${++offcutIdx}`,
                        sourceTileId: stripId,
                        polygon: diffP,
                        bbox: diffBBox,
                        center: offCenter,
                        areaMm2: diffArea,
                        width: Math.min(diffBBox.width, diffBBox.height),
                        height: Math.max(diffBBox.width, diffBBox.height),
                        grainAngle: (angleRad * 180) / Math.PI,
                        isDiscarded: false,
                        isBroadloomLongitudinal: true,
                      };
                      stripOffcuts.push(offItem);
                      offcutsAvailable.push(offItem);
                    }
                  }
                }
              } catch {
                // ignore
              }

              strips.push({
                id: stripId,
                name: stripName,
                roomId: room.id,
                index: stripIdx,
                rawPolygon: stripCutPoly,
                clippedPolygons: clipped,
                rawAreaMm2: cutLength * rollWidth,
                usedAreaMm2: usedArea,
                lengthMm: cutLength,
                widthMm: rollWidth,
                usedWidthMm: usedWidth,
                isReusedFromOffcut: false,
                offcuts: stripOffcuts,
                center: stripCenter,
                directionStart: dirStart,
                directionEnd: dirEnd,
              });

            }
          }
        } catch {
          // ignore
        }
      }
    }
  }

  const segmented = limitRollLengths(strips, rooms, config, angleRad, defaultOrigin, minBroadloomOffcutMm, roomOrigins);
  const actualSeams = getStripOverlapSeams(segmented.strips);
  const computationTimeMs = performance.now() - startTime;

  return {
    tiles: [],
    broadloomStrips: segmented.strips,
    layDirection: config.direction === 'vertical' ? 'vertical' : 'horizontal',
    seams: [...actualSeams, ...segmented.endSeams],
    offcutsAvailable: segmented.offcuts,
    offcutsReused: [],
    discardedScraps: [],
    offcutLinks: [],
    totalRawTiles: 0,
    totalLinearMeters: segmented.strips.reduce((sum, strip) => sum + strip.lengthMm / 1000, 0),
    computationTimeMs,
  };
}

function ensureClosedRing(ring: Ring): Ring {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return [...ring, [first[0], first[1]]];
  }
  return ring;
}

function seamThroughPolygon(poly: Polygon, direction: Point): BroadloomSeam | null {
  const magnitude = Math.hypot(direction[0], direction[1]);
  if (magnitude < 1) return null;
  const ux = direction[0] / magnitude, uy = direction[1] / magnitude;
  const vx = -uy, vy = ux;
  let lo = Infinity, hi = -Infinity, acrossLo = Infinity, acrossHi = -Infinity;
  for (const point of poly[0]) {
    const along = point[0] * ux + point[1] * uy;
    const across = point[0] * vx + point[1] * vy;
    lo = Math.min(lo, along); hi = Math.max(hi, along);
    acrossLo = Math.min(acrossLo, across); acrossHi = Math.max(acrossHi, across);
  }
  if (hi - lo < 1) return null;
  const middle = (acrossLo + acrossHi) / 2;
  return {
    start: [lo * ux + middle * vx, lo * uy + middle * vy],
    end: [hi * ux + middle * vx, hi * uy + middle * vy],
    lengthMm: hi - lo,
  };
}

export function getStripOverlapSeams(strips: BroadloomStrip[]): BroadloomSeam[] {
  const seams: BroadloomSeam[] = [];
  for (let i = 0; i < strips.length; i++) {
    const a = strips[i];
    for (let j = i + 1; j < strips.length; j++) {
      const b = strips[j];
      if (a.roomId !== b.roomId) continue;
      if (a.parentStripId && a.parentStripId === b.parentStripId) continue;
      const direction: Point = [a.directionEnd[0] - a.directionStart[0], a.directionEnd[1] - a.directionStart[1]];
      let hasOverlap = false;
      for (const aPoly of a.clippedPolygons) for (const bPoly of b.clippedPolygons) {
        try {
          const overlap = polygonClipping.intersection(aPoly as any, bPoly as any) as Polygon[];
          for (const p of overlap) {
            if (getPolygonArea(p) < 100) continue;
            const seam = seamThroughPolygon(p, direction);
            if (seam) { seams.push(seam); hasOverlap = true; }
          }
        } catch { /* Degenerate shared edge. */ }
      }
      if (!hasOverlap) seams.push(...sharedBoundarySeams(a, b));
    }
  }
  return seams;
}

function sharedBoundarySeams(a: BroadloomStrip, b: BroadloomStrip): BroadloomSeam[] {
  const found: BroadloomSeam[] = [];
  for (const pa of a.clippedPolygons) for (const pb of b.clippedPolygons) {
    for (const ra of pa) for (const rb of pb) {
      for (let i = 0; i < ra.length - 1; i++) {
        const p = ra[i], q = ra[i + 1];
        const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (length < 1) continue;
        const ux = (q[0] - p[0]) / length, uy = (q[1] - p[1]) / length;
        const pAlong = p[0] * ux + p[1] * uy;
        const qAlong = q[0] * ux + q[1] * uy;
        for (let j = 0; j < rb.length - 1; j++) {
          const r = rb[j], s = rb[j + 1];
          const rAlong = r[0] * ux + r[1] * uy;
          const sAlong = s[0] * ux + s[1] * uy;
          const crossR = (r[0] - p[0]) * uy - (r[1] - p[1]) * ux;
          const crossS = (s[0] - p[0]) * uy - (s[1] - p[1]) * ux;
          if (Math.abs(crossR) > 0.01 || Math.abs(crossS) > 0.01) continue;
          const lo = Math.max(Math.min(pAlong, qAlong), Math.min(rAlong, sAlong));
          const hi = Math.min(Math.max(pAlong, qAlong), Math.max(rAlong, sAlong));
          if (hi - lo < 1) continue;
          const shiftLo = lo - pAlong, shiftHi = hi - pAlong;
          found.push({ start: [p[0] + shiftLo * ux, p[1] + shiftLo * uy],
            end: [p[0] + shiftHi * ux, p[1] + shiftHi * uy], lengthMm: hi - lo });
        }
      }
    }
  }
  return found;
}

function limitRollLengths(
  strips: BroadloomStrip[], rooms: RoomGeometry[], config: BroadloomConfig,
  angleRad: number, defaultOrigin: Point, threshold: number,
  roomOrigins?: Record<string, Point>
): { strips: BroadloomStrip[]; offcuts: OffcutItem[]; endSeams: BroadloomSeam[] } {
  const allowance = Math.max(0, config.cutAllowanceMm ?? 100);
  const maxLength = Math.max(allowance + 1, config.maxRollLength);
  const isVertical = config.direction === 'vertical';
  const result: BroadloomStrip[] = [];
  const offcuts: OffcutItem[] = [];
  const endSeams: BroadloomSeam[] = [];
  let offcutNumber = 0;
  for (const strip of strips) {
    const origin = roomOrigins?.[strip.roomId ?? ''] ?? defaultOrigin;
    const room = rooms.find((r) => r.id === strip.roomId);
    if (!room) continue;
    const startLocal = rotatePoint(strip.directionStart, -angleRad, origin);
    const endLocal = rotatePoint(strip.directionEnd, -angleRad, origin);
    const minAlong = isVertical ? startLocal[1] : startLocal[0];
    const maxAlong = isVertical ? endLocal[1] : endLocal[0];
    const span = Math.max(0, maxAlong - minAlong);
    if (span + allowance <= maxLength + 1e-6) {
      const adjusted = { ...strip, lengthMm: span + allowance, rawAreaMm2: (span + allowance) * strip.widthMm };
      result.push(adjusted);
      offcuts.push(...adjusted.offcuts);
      continue;
    }
    const localBox = getRingBoundingBox(rotateRing(strip.rawPolygon[0], -angleRad, origin));
    const count = Math.ceil(span / (maxLength - allowance));
    const segmentSpan = span / count;
    const roomPoly: Polygon = [ensureClosedRing(room.boundary), ...room.holes.map(ensureClosedRing)];
    for (let n = 0; n < count; n++) {
      const from = minAlong + n * segmentSpan;
      const to = n === count - 1 ? maxAlong : minAlong + (n + 1) * segmentSpan;
      const localRing: Ring = isVertical
        ? [[localBox.minX, from], [localBox.maxX, from], [localBox.maxX, to], [localBox.minX, to]]
        : [[from, localBox.minY], [to, localBox.minY], [to, localBox.maxY], [from, localBox.maxY]];
      const rawPoly: Polygon = [ensureClosedRing(rotateRing(localRing, angleRad, origin))];
      const clipped = polygonClipping.intersection(rawPoly as any, roomPoly as any) as Polygon[];
      const usedArea = clipped.reduce((sum, p) => sum + getPolygonArea(p), 0);
      if (usedArea < 1) continue;
      const segmentId = `${strip.id}-${n + 1}`;
      const diff = polygonClipping.difference(rawPoly as any, roomPoly as any) as Polygon[];
      const segmentOffcuts: OffcutItem[] = [];
      for (const p of diff) {
        const local = getRingBoundingBox(rotateRing(p[0], -angleRad, origin));
        if (Math.min(local.width, local.height) < threshold || getPolygonArea(p) < 100) continue;
        const bbox = getPolygonBoundingBox(p);
        segmentOffcuts.push({
          id: `OFF-ROLL-SPLIT-${++offcutNumber}`, sourceTileId: segmentId,
          polygon: p, bbox, center: getPolygonCentroid(p), areaMm2: getPolygonArea(p),
          width: Math.min(bbox.width, bbox.height), height: Math.max(bbox.width, bbox.height),
          grainAngle: strip.offcuts[0]?.grainAngle ?? (angleRad * 180 / Math.PI),
          isDiscarded: false, isBroadloomLongitudinal: true,
        });
      }
      offcuts.push(...segmentOffcuts);
      result.push({
        ...strip, id: segmentId, parentStripId: strip.id, name: `${strip.name}.${n + 1}`, index: result.length + 1,
        rawPolygon: rawPoly, clippedPolygons: clipped, rawAreaMm2: (to - from + allowance) * strip.widthMm,
        usedAreaMm2: usedArea, lengthMm: to - from + allowance,
        offcuts: segmentOffcuts, center: getPolygonCentroid(clipped[0]),
        directionStart: rotatePoint(isVertical ? [startLocal[0], from] : [from, startLocal[1]], angleRad, origin),
        directionEnd: rotatePoint(isVertical ? [endLocal[0], to] : [to, endLocal[1]], angleRad, origin),
      });
      if (n > 0) {
        const ribbon: Ring = isVertical
          ? [[localBox.minX, from - 0.5], [localBox.maxX, from - 0.5], [localBox.maxX, from + 0.5], [localBox.minX, from + 0.5]]
          : [[from - 0.5, localBox.minY], [from + 0.5, localBox.minY], [from + 0.5, localBox.maxY], [from - 0.5, localBox.maxY]];
        const linePieces = polygonClipping.intersection([ensureClosedRing(rotateRing(ribbon, angleRad, origin))] as any, roomPoly as any) as Polygon[];
        const seamDirection: Point = isVertical ? [Math.cos(angleRad), Math.sin(angleRad)] : [-Math.sin(angleRad), Math.cos(angleRad)];
        for (const p of linePieces) {
          const seam = seamThroughPolygon(p, seamDirection);
          if (seam) endSeams.push(seam);
        }
      }
    }
  }
  return { strips: result, offcuts, endSeams };
}
