import polygonClipping from 'polygon-clipping';
import type { BoundingBox, CorridorZone, Polygon, ResolvedCorridorZone, RoomGeometry } from '../types';
import { ensureClosedRing, getPolygonArea, getPolygonBoundingBox } from './geometryMath';

export const rectangle = (b: BoundingBox): Polygon => [[
  [b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY], [b.minX, b.minY],
]];
export const polygonArea = (polygons: Polygon[]) => polygons.reduce((sum, p) => sum + getPolygonArea(p), 0);
const floorOf = (room: RoomGeometry): Polygon => [ensureClosedRing(room.boundary), ...room.holes.map(ensureClosedRing)];
const boxKey = (b: BoundingBox) => [b.minX, b.minY, b.maxX, b.maxY].map(v => v.toFixed(3)).join(':');
const CAD_EDGE_TOLERANCE_MM = 1;
const MAX_CAD_SLIVER_THICKNESS_MM = 25;
const MAX_CAD_SLIVER_FILL_RATIO = 0.005;
const expanded = (b: BoundingBox, pad: number): BoundingBox => ({
  minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad,
  width: b.width + 2 * pad, height: b.height + 2 * pad,
});
const isCadSliver = (zone: ResolvedCorridorZone) => zone.areaMm2 > 0 &&
  zone.areaMm2 / Math.max(zone.bounds.width, zone.bounds.height) <= MAX_CAD_SLIVER_THICKNESS_MM &&
  zone.areaMm2 / (zone.bounds.width * zone.bounds.height) < MAX_CAD_SLIVER_FILL_RATIO;
const checkCadEdgeDrift = (room: RoomGeometry) => {
  const ring = room.boundary;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]);
    const length = Math.max(dx, dy), drift = Math.min(dx, dy);
    if (length >= 1000 && drift > CAD_EDGE_TOLERANCE_MM && drift / length <= 0.005)
      throw new Error(`${room.name}: cạnh gần thẳng tại X=${Math.min(a[0], b[0]).toFixed(1)}, ` +
        `Y=${Math.min(a[1], b[1]).toFixed(1)} mm lệch ${drift.toFixed(2)} mm, ` +
        'vượt ngưỡng tự hiệu chỉnh 1 mm. Hãy kiểm tra đường bao hoặc chia vùng thủ công.');
  }
};

/** Sweep both axes to find long rectangular corridors, including their junctions. */
export function detectCorridorZones(rooms: RoomGeometry[]): CorridorZone[] {
  const zones: CorridorZone[] = [];
  for (const room of rooms) {
    checkCadEdgeDrift(room);
    const roomZones: CorridorZone[] = [];
    const floor = floorOf(room);
    const candidates = new Map<string, BoundingBox>();
    for (const axis of [0, 1]) {
      const coordinates = [...new Set(floor.flat().map(p => p[axis]))].sort((a, b) => a - b);
      if (coordinates.length > 128) continue;
      let previous = new Map<string, BoundingBox>();
      for (let i = 0; i < coordinates.length - 1; i++) {
        const lo = coordinates[i], hi = coordinates[i + 1];
        if (hi - lo < 0.01) continue;
        const slab = { ...room.bbox,
          ...(axis === 0 ? { minX: lo, maxX: hi, width: hi - lo }
            : { minY: lo, maxY: hi, height: hi - lo }) };
        const parts = polygonClipping.intersection(floor as any, rectangle(slab) as any) as Polygon[];
        const next = new Map<string, BoundingBox>();
        for (const part of parts) {
          const b = getPolygonBoundingBox(part);
          if (Math.abs(getPolygonArea(part) - b.width * b.height) > 100) continue;
          const key = (axis === 0 ? [b.minY, b.maxY] : [b.minX, b.maxX]).map(v => v.toFixed(3)).join(':');
          const old = previous.get(key);
          const merged = old ? { minX: Math.min(old.minX, b.minX), minY: Math.min(old.minY, b.minY),
            maxX: Math.max(old.maxX, b.maxX), maxY: Math.max(old.maxY, b.maxY), width: 0, height: 0 } : b;
          merged.width = merged.maxX - merged.minX;
          merged.height = merged.maxY - merged.minY;
          next.set(key, merged);
          candidates.set(boxKey(merged), merged);
        }
        previous = next;
      }
    }
    let remaining: Polygon[] = [floor];
    const sorted = [...candidates.values()].sort((a, b) =>
      Math.max(b.width, b.height) ** 2 - Math.max(a.width, a.height) ** 2 || b.width * b.height - a.width * a.height);
    // The final mask also preserves irregular edges and holes exactly.
    sorted.push(room.bbox);
    let index = 0;
    for (const bounds of sorted) {
      if (polygonArea(remaining) < 1) break;
      const clipped = polygonClipping.intersection(remaining as any, rectangle(bounds) as any) as Polygon[];
      if (polygonArea(clipped) < 1) continue;
      roomZones.push({ id: `${room.id}-ZONE-${++index}`, roomId: room.id,
        name: `Vùng ${String.fromCharCode(65 + (index - 1) % 26)}${index > 26 ? Math.ceil(index / 26) : ''}`,
        direction: bounds.width >= bounds.height ? 'horizontal' : 'vertical', bounds: { ...bounds } });
      remaining = polygonClipping.difference(remaining as any, rectangle(bounds) as any) as Polygon[];
    }
    const resolved = resolveCorridorZones([room], roomZones, false);
    const slivers = resolved.filter(isCadSliver);
    let finalized: CorridorZone[];
    if (slivers.length) {
      // CAD polylines can be nearly horizontal/vertical but miss their shared
      // coordinate by less than a millimetre. Give that hairline to a real
      // adjacent zone; clipping still uses the original floor, without gaps.
      const sliverIds = new Set(slivers.map(z => z.id));
      const repaired = roomZones.filter(z => !sliverIds.has(z.id))
        .map(z => ({ ...z, bounds: expanded(z.bounds, CAD_EDGE_TOLERANCE_MM) }));
      try {
        resolveCorridorZones([room], repaired);
        finalized = repaired.map((z, i) => ({ ...z, id: `${room.id}-ZONE-${i + 1}`,
          name: `Vùng ${String.fromCharCode(65 + i % 26)}${i >= 26 ? Math.floor(i / 26) + 1 : ''}` }));
      } catch {
        const largest = slivers.sort((a, b) => b.areaMm2 - a.areaMm2)[0];
        const fragment = [...largest.polygons].sort((a, b) => getPolygonArea(b) - getPolygonArea(a))[0];
        const b = getPolygonBoundingBox(fragment);
        const estimatedWidth = getPolygonArea(fragment) / Math.max(b.width, b.height, 1);
        throw new Error(`${room.name}: đường bao CAD có dải lệch gần X=${b.minX.toFixed(1)}, Y=${b.minY.toFixed(1)} mm ` +
          `(bề dày khoảng ${estimatedWidth.toFixed(2)} mm, diện tích ${(getPolygonArea(fragment) / 1e6).toFixed(4)} m²), ` +
          'vượt ngưỡng tự hiệu chỉnh 1 mm. ' +
          'Hãy kiểm tra đường bao hoặc chia vùng thủ công.');
      }
    } else finalized = roomZones;
    // Parallel rectangles of one room are one continuous run of carpet. A
    // step or notch at their boundary belongs to the same cut, rather than
    // becoming a separate receiver for small remnant patches.
    if (finalized.length > 1 && finalized.every(z => z.direction === finalized[0].direction)) {
      zones.push({ id: `${room.id}-ZONE-1`, roomId: room.id, name: 'Vùng A',
        direction: finalized[0].direction, bounds: { ...room.bbox } });
    } else zones.push(...finalized);
  }
  return zones;
}

/** Earlier masks own their junctions. Subtraction gives every floor point one owner. */
export function resolveCorridorZones(rooms: RoomGeometry[], zones: CorridorZone[], requireCoverage = true): ResolvedCorridorZone[] {
  const resolved: ResolvedCorridorZone[] = [];
  for (const room of rooms) {
    let remaining: Polygon[] = [floorOf(room)];
    for (const zone of zones.filter(z => z.roomId === room.id)) {
      const b = zone.bounds;
      if (![b.minX, b.minY, b.maxX, b.maxY].every(Number.isFinite) || b.maxX <= b.minX || b.maxY <= b.minY)
        throw new Error(`${zone.name}: kích thước vùng phải lớn hơn 0.`);
      const polygons = polygonClipping.intersection(remaining as any, rectangle(b) as any) as Polygon[];
      resolved.push({ ...zone, polygons, areaMm2: polygonArea(polygons) });
      remaining = polygonClipping.difference(remaining as any, rectangle(b) as any) as Polygon[];
    }
    if (requireCoverage && polygonArea(remaining) > Math.max(100, room.areaMm2 * 0.00001))
      throw new Error(`${room.name}: còn ${(polygonArea(remaining) / 1e6).toFixed(3)} m² chưa thuộc vùng trải. Hãy mở rộng hoặc thêm vùng.`);
  }
  return resolved;
}
