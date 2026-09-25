import DxfParser from 'dxf-parser';
import {
  Point,
  Ring,
  UnitType,
  DxfLayerInfo,
  RoomGeometry,
} from '../types';
import polygonClipping from 'polygon-clipping';
import {
  getRingBoundingBox,
  getPolygonArea,
  ensureCCW,
  ensureCW,
  pointsEqual,
} from './geometryMath';

export interface DxfParseResult {
  layers: DxfLayerInfo[];
  rawDxf: any;
}

// CAD exports often put nominally shared vertices a few floating-point units
// apart. Snap to one micron in millimetre space so clipping sees closed edges.
const snapCadRing = (ring: Ring): Ring => ring.map(([x, y]): Point => [
  Math.round(x * 1000) / 1000,
  Math.round(y * 1000) / 1000,
]);

export function parseDxfFile(dxfContent: string): DxfParseResult {
  const parser = new DxfParser();
  const dxf = parser.parseSync(dxfContent);

  if (!dxf) {
    throw new Error('Không thể đọc định dạng DXF.');
  }

  const layerMap = new Map<string, { color: number; count: number }>();

  if (dxf.tables?.layer?.layers) {
    for (const [name, data] of Object.entries<any>(dxf.tables.layer.layers)) {
      layerMap.set(name, { color: data.color ?? 7, count: 0 });
    }
  }

  if (Array.isArray(dxf.entities)) {
    for (const entity of dxf.entities) {
      const layerName = entity.layer || '0';
      const existing = layerMap.get(layerName) || { color: entity.color ?? 7, count: 0 };
      existing.count++;
      layerMap.set(layerName, existing);
    }
  }

  const layers: DxfLayerInfo[] = Array.from(layerMap.entries()).map(([name, info]) => {
    const lower = name.toLowerCase();
    const isRoomBoundary =
      lower.includes('room') ||
      lower.includes('boundary') ||
      lower.includes('tuong') ||
      lower.includes('wall') ||
      lower.includes('floor');
    const isObstacle =
      lower.includes('cot') ||
      lower.includes('column') ||
      lower.includes('obstacle') ||
      lower.includes('hole') ||
      lower.includes('shaft') ||
      /(^|[^a-z])hop([^a-z]|$)/.test(lower);

    return {
      name,
      color: info.color,
      entityCount: info.count,
      isRoomBoundary,
      isObstacle,
    };
  });

  if (!layers.some((l) => l.isRoomBoundary) && layers.length > 0) {
    const sorted = [...layers].sort((a, b) => b.entityCount - a.entityCount);
    sorted[0].isRoomBoundary = true;
  }

  return {
    layers,
    rawDxf: dxf,
  };
}

/**
 * Extract ALL closed rooms from selected layers in DXF
 * Returns array of RoomGeometry (supporting multiple rooms in a single file)
 */
export function extractRoomsFromLayers(
  dxf: any,
  roomBoundaryLayer: string,
  obstacleLayers: string[],
  unit: UnitType = 'mm'
): RoomGeometry[] {
  const unitScale = unit === 'm' ? 1000 : unit === 'cm' ? 10 : 1;

  const boundarySegments: [Point, Point][] = [];
  const obstacleSegments: [Point, Point][] = [];

  const rawBoundaryRings: Ring[] = [];
  const rawObstacleRings: Ring[] = [];

  if (Array.isArray(dxf.entities)) {
    for (const entity of dxf.entities) {
      const layer = entity.layer;
      const isBoundary = layer === roomBoundaryLayer;
      const isObstacle = obstacleLayers.includes(layer);

      if (!isBoundary && !isObstacle) continue;

      if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
        const ring: Ring = [];
        if (Array.isArray(entity.vertices)) {
          for (const v of entity.vertices) {
            if (Math.abs(v.bulge ?? 0) > 1e-9) {
              throw new Error(`Layer "${layer}" có polyline chứa cung tròn (bulge). Hãy chuyển cung thành các đoạn thẳng trước khi bóc tách.`);
            }
            ring.push([v.x * unitScale, v.y * unitScale]);
          }
        }
        if (ring.length >= 2) {
          if (ring.length >= 3 && (entity.shape || pointsEqual(ring[0], ring[ring.length - 1], 5))) {
            if (isBoundary) rawBoundaryRings.push(ring);
            else rawObstacleRings.push(ring);
          } else {
            for (let i = 0; i < ring.length - 1; i++) {
              const seg: [Point, Point] = [ring[i], ring[i + 1]];
              if (isBoundary) boundarySegments.push(seg);
              else obstacleSegments.push(seg);
            }
          }
        }
      } else if (entity.type === 'LINE') {
        if (entity.vertices && entity.vertices.length >= 2) {
          const seg: [Point, Point] = [
            [entity.vertices[0].x * unitScale, entity.vertices[0].y * unitScale],
            [entity.vertices[1].x * unitScale, entity.vertices[1].y * unitScale],
          ];
          if (isBoundary) boundarySegments.push(seg);
          else obstacleSegments.push(seg);
        }
      } else if (['ARC', 'CIRCLE', 'ELLIPSE', 'SPLINE', 'INSERT'].includes(entity.type)) {
        throw new Error(`Layer "${layer}" chứa đối tượng ${entity.type} chưa được hỗ trợ làm đường bao. Hãy chuyển thành polyline khép kín.`);
      }
    }
  }

  // Stitch open line segments
  const stitchedBoundary = stitchSegmentsIntoRings(boundarySegments);
  rawBoundaryRings.push(...stitchedBoundary);

  const stitchedObstacles = stitchSegmentsIntoRings(obstacleSegments);
  rawObstacleRings.push(...stitchedObstacles);

  if (rawBoundaryRings.length === 0) {
    throw new Error(
      `Không tìm thấy đa giác khép kín nào trên layer "${roomBoundaryLayer}". Hãy kiểm tra lại layer hoặc độ khép kín của đường bao.`
    );
  }

  // Keep small valid rooms; geometry validity is independent of room area.
  const candidateRings = deduplicateRings(rawBoundaryRings.map(snapCadRing)
    .filter((r) => r.length >= 3 && Math.abs(getRingArea(r)) > 1)
    .map(ensureCCW));
  const uniqueObstacles = deduplicateRings(rawObstacleRings.map(snapCadRing));

  // Sort by area descending
  candidateRings.sort((a, b) => Math.abs(getRingArea(b)) - Math.abs(getRingArea(a)));
  for (let i = 0; i < candidateRings.length; i++) {
    for (let j = i + 1; j < candidateRings.length; j++) {
      const overlap = polygonClipping.intersection([candidateRings[i]] as any,
        [candidateRings[j]] as any) as Ring[][];
      const overlapArea = overlap.reduce((sum, polygon) => sum + getPolygonArea(polygon), 0);
      if (overlapArea > 100 && !ringWithin(candidateRings[j], candidateRings[i])) {
        throw new Error('Hai đường bao phòng giao nhau nhưng không lồng nhau. Hãy sửa vùng chồng trên layer phòng trước khi bóc tách.');
      }
    }
  }

  // Each boundary is a room. An immediately nested boundary cuts out its
  // parent's floor, but remains a selectable room in its own right.
  const parents = candidateRings.map((ring, idx) => {
    for (let j = idx - 1; j >= 0; j--) {
      if (ringWithin(ring, candidateRings[j])) return j;
    }
    return -1;
  });
  const rooms: RoomGeometry[] = candidateRings.map((boundary, idx) => {
    const roomHoles: Ring[] = candidateRings
      .filter((_, childIndex) => parents[childIndex] === idx)
      .map(ensureCW);
    for (const obstacle of uniqueObstacles) {
      if (!ringWithin(obstacle, boundary)) {
        const overlap = polygonClipping.intersection([obstacle] as any, [boundary] as any) as Ring[][];
        if (overlap.reduce((sum, polygon) => sum + getPolygonArea(polygon), 0) > 100)
          throw new Error('Một cột/lỗ khoét cắt qua đường bao phòng. Hãy tách hoặc cắt lỗ khoét theo biên phòng.');
        continue;
      }
      const deepestRoom = candidateRings.findIndex((other, j) => j > idx && ringWithin(obstacle, other));
      if (deepestRoom < 0) roomHoles.push(ensureCW(obstacle));
    }

    for (let a = 0; a < roomHoles.length; a++) for (let b = a + 1; b < roomHoles.length; b++) {
      const overlap = polygonClipping.intersection([roomHoles[a]] as any,
        [roomHoles[b]] as any) as Ring[][];
      if (overlap.reduce((sum, polygon) => sum + getPolygonArea(polygon), 0) > 100)
        throw new Error('Các vùng lỗ khoét trong cùng phòng bị chồng lên nhau. Hãy sửa DXF trước khi bóc tách.');
    }

    const bbox = getRingBoundingBox(boundary);
    const areaMm2 = getPolygonArea([boundary, ...roomHoles]);
    if (areaMm2 <= 100) throw new Error('Đường bao phòng không còn diện tích sàn hợp lệ sau khi trừ lỗ khoét.');

    return {
      id: `ROOM-${idx + 1}`,
      name: `Phòng ${idx + 1} (${(areaMm2 / 1_000_000).toFixed(1)} m²)`,
      boundary,
      holes: roomHoles,
      bbox,
      areaMm2,
    };
  });

  return rooms;
}

function ringWithin(inner: Ring, outer: Ring): boolean {
  try {
    const outside = polygonClipping.difference([inner] as any, [outer] as any) as Ring[][];
    return outside.reduce((sum, polygon) => sum + getPolygonArea(polygon), 0) < 100;
  } catch {
    return false;
  }
}

/** A duplicated CAD outline must never become another room or another hole. */
function deduplicateRings(rings: Ring[]): Ring[] {
  const unique: Ring[] = [];
  for (const ring of rings) {
    const box = getRingBoundingBox(ring);
    const area = Math.abs(getRingArea(ring));
    const duplicate = unique.some((other) => {
      const otherBox = getRingBoundingBox(other);
      if (Math.abs(area - Math.abs(getRingArea(other))) > 100 ||
          Math.abs(box.minX - otherBox.minX) > 1 || Math.abs(box.maxX - otherBox.maxX) > 1 ||
          Math.abs(box.minY - otherBox.minY) > 1 || Math.abs(box.maxY - otherBox.maxY) > 1) return false;
      try {
        const difference = polygonClipping.xor([ring] as any, [other] as any) as Ring[][];
        return difference.reduce((sum, polygon) => sum + getPolygonArea(polygon), 0) < 100;
      } catch {
        return false;
      }
    });
    if (!duplicate) unique.push(ring);
  }
  return unique;
}

function getRingArea(ring: Ring): number {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  }
  return area / 2;
}

export function stitchSegmentsIntoRings(segments: [Point, Point][], tol: number = 2.0): Ring[] {
  if (segments.length === 0) return [];
  const remaining = [...segments];
  const rings: Ring[] = [];

  while (remaining.length > 0) {
    const firstSeg = remaining.shift()!;
    const currentRing: Ring = [firstSeg[0], firstSeg[1]];

    let foundMatch = true;
    let closed = false;
    while (foundMatch && remaining.length > 0) {
      foundMatch = false;
      const tip = currentRing[currentRing.length - 1];

      for (let i = 0; i < remaining.length; i++) {
        const [p1, p2] = remaining[i];
        if (pointsEqual(tip, p1, tol)) {
          currentRing.push(p2);
          remaining.splice(i, 1);
          foundMatch = true;
          break;
        } else if (pointsEqual(tip, p2, tol)) {
          currentRing.push(p1);
          remaining.splice(i, 1);
          foundMatch = true;
          break;
        }
      }

      if (currentRing.length >= 3 && pointsEqual(currentRing[0], currentRing[currentRing.length - 1], tol)) {
        currentRing.pop();
        closed = true;
        break;
      }
    }

    if (currentRing.length >= 3 && closed) {
      rings.push(currentRing);
    }
  }

  return rings;
}
