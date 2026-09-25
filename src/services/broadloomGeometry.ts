import polygonClipping from 'polygon-clipping';
import type { BroadloomStrip, Point, Polygon, RoomGeometry } from '../types';

/** Physical rectangle cut from the roll, including the full roll width and cut allowance. */
export function getBroadloomCutPolygon(strip: BroadloomStrip): Polygon {
  const ring = strip.rawPolygon[0];
  if (!ring || ring.length < 4) return strip.rawPolygon;
  const [p0, p1, p2] = ring;
  const xLength = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const yLength = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  const alongLength = Math.hypot(strip.directionEnd[0] - strip.directionStart[0],
    strip.directionEnd[1] - strip.directionStart[1]);
  // A CAD rounding sliver can be shorter than 1 mm while its physical cut
  // still includes the full cutting allowance. Do not drop that allowance.
  if (xLength < 1e-6 || yLength < 1e-6 || alongLength < 1e-6) return strip.rawPolygon;
  const ux: Point = [(p1[0] - p0[0]) / xLength, (p1[1] - p0[1]) / xLength];
  const uy: Point = [(p2[0] - p1[0]) / yLength, (p2[1] - p1[1]) / yLength];
  const along: Point = [(strip.directionEnd[0] - strip.directionStart[0]) / alongLength,
    (strip.directionEnd[1] - strip.directionStart[1]) / alongLength];
  const alongX = Math.abs(ux[0] * along[0] + ux[1] * along[1]) >=
    Math.abs(uy[0] * along[0] + uy[1] * along[1]);
  const spanX = alongX ? strip.lengthMm : strip.widthMm;
  const spanY = alongX ? strip.widthMm : strip.lengthMm;
  const corner = (x: number, y: number): Point =>
    [p0[0] + ux[0] * x + uy[0] * y, p0[1] + ux[1] * x + uy[1] * y];
  return [[corner(0, 0), corner(spanX, 0), corner(spanX, spanY),
    corner(0, spanY), corner(0, 0)]];
}

/** Show only carpet that belongs to this cut but does not cover its room floor. */
export function getBroadloomOutsidePolygons(strip: BroadloomStrip): Polygon[] {
  if (!strip.clippedPolygons.length) return [getBroadloomCutPolygon(strip)];
  try {
    return polygonClipping.difference(getBroadloomCutPolygon(strip) as any,
      ...strip.clippedPolygons as any) as Polygon[];
  } catch {
    return [];
  }
}

/** Show the unused outline only outside the floor. A cut blank can cross an
 * adjacent installed piece before trimming, without creating an installed
 * overlap there. */
export function getBroadloomOutsideFloorPolygons(
  strip: BroadloomStrip, room: RoomGeometry
): Polygon[] {
  try {
    return polygonClipping.difference(getBroadloomCutPolygon(strip) as any,
      [room.boundary, ...room.holes] as any) as Polygon[];
  } catch {
    return [];
  }
}
