import { Point, Ring, Polygon, BoundingBox } from '../types';

export const EPSILON = 1e-4;

/**
 * Calculate signed area using Shoelace formula
 * Positive = Counter-Clockwise (CCW), Negative = Clockwise (CW)
 */
export function getSignedArea(ring: Ring): number {
  if (ring.length < 3) return 0;
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  }
  return area / 2;
}

export function getPolygonArea(polygon: Polygon): number {
  if (!polygon || polygon.length === 0) return 0;
  let area = Math.abs(getSignedArea(polygon[0]));
  for (let h = 1; h < polygon.length; h++) {
    area -= Math.abs(getSignedArea(polygon[h]));
  }
  return Math.max(0, area);
}

export function isCCW(ring: Ring): boolean {
  return getSignedArea(ring) > 0;
}

export function ensureCCW(ring: Ring): Ring {
  if (getSignedArea(ring) < 0) {
    return [...ring].reverse();
  }
  return ring;
}

export function ensureCW(ring: Ring): Ring {
  if (getSignedArea(ring) > 0) {
    return [...ring].reverse();
  }
  return ring;
}

export function getRingBoundingBox(ring: Ring): BoundingBox {
  if (ring.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

export function getPolygonBoundingBox(polygon: Polygon): BoundingBox {
  if (!polygon || polygon.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  return getRingBoundingBox(polygon[0]);
}

export function doBBoxesIntersect(a: BoundingBox, b: BoundingBox): boolean {
  return !(
    a.maxX < b.minX ||
    a.minX > b.maxX ||
    a.maxY < b.minY ||
    a.minY > b.maxY
  );
}

export function isPointInRing(point: Point, ring: Ring): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];

    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;

    if (intersect) inside = !inside;
  }
  return inside;
}

export function isRingInsideRing(inner: Ring, outer: Ring): boolean {
  if (inner.length === 0 || outer.length === 0) return false;
  const bInner = getRingBoundingBox(inner);
  const bOuter = getRingBoundingBox(outer);
  if (
    bInner.minX < bOuter.minX - 1 ||
    bInner.maxX > bOuter.maxX + 1 ||
    bInner.minY < bOuter.minY - 1 ||
    bInner.maxY > bOuter.maxY + 1
  ) {
    return false;
  }

  // Sample multiple points along inner ring
  const sampleCount = Math.min(inner.length, 5);
  for (let i = 0; i < sampleCount; i++) {
    const pt = inner[i];
    if (!isPointInRing(pt, outer)) {
      return false;
    }
  }
  return true;
}

export function getRingCentroid(ring: Ring): Point {
  if (ring.length === 0) return [0, 0];
  let cx = 0;
  let cy = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    cx += ring[i][0];
    cy += ring[i][1];
  }
  return [cx / n, cy / n];
}

export function getPolygonCentroid(polygon: Polygon): Point {
  if (!polygon || polygon.length === 0 || polygon[0].length === 0) return [0, 0];
  return getRingCentroid(polygon[0]);
}

export function findNearestVertex(
  point: Point,
  vertices: Point[],
  maxDist: number
): { vertex: Point; distance: number } | null {
  let bestDist = maxDist;
  let bestVertex: Point | null = null;

  for (const v of vertices) {
    const d = Math.hypot(v[0] - point[0], v[1] - point[1]);
    if (d < bestDist) {
      bestDist = d;
      bestVertex = v;
    }
  }

  if (bestVertex) {
    return { vertex: bestVertex, distance: bestDist };
  }
  return null;
}

export function rotatePoint(pt: Point, angleRad: number, origin: Point = [0, 0]): Point {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const dx = pt[0] - origin[0];
  const dy = pt[1] - origin[1];
  return [
    origin[0] + dx * cos - dy * sin,
    origin[1] + dx * sin + dy * cos,
  ];
}

export function rotateRing(ring: Ring, angleRad: number, origin: Point = [0, 0]): Ring {
  return ring.map((pt) => rotatePoint(pt, angleRad, origin));
}

export function translateRing(ring: Ring, dx: number, dy: number): Ring {
  return ring.map(([x, y]) => [x + dx, y + dy]);
}

export function distance(p1: Point, p2: Point): number {
  return Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
}

export function pointsEqual(p1: Point, p2: Point, tol: number = 0.5): boolean {
  return Math.hypot(p1[0] - p2[0], p1[1] - p2[1]) <= tol;
}

export function ensureClosedRing(ring: Ring): Ring {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, [first[0], first[1]]];
}

export function formatRollWidth(widthMm: number): string {
  const m = widthMm / 1000;
  if (widthMm % 100 === 0) {
    return m.toFixed(1);
  }
  return m.toFixed(2);
}
