import polygonClipping from 'polygon-clipping';
import type { MaterialCategory, NestingResult, Polygon, RoomGeometry, BroadloomConfig } from '../types';
import { ensureClosedRing, getPolygonArea } from './geometryMath';
import { getBroadloomCutPolygon } from './broadloomGeometry';

/** Return a user-facing reason when the calculated layout cannot support a BOQ. */
export function validateNesting(
  rooms: RoomGeometry[], result: NestingResult, material: MaterialCategory,
  broadloom: BroadloomConfig
): string | null {
  const stripsById = new Map(result.broadloomStrips.map((strip) => [strip.id, strip]));
  const tilesById = new Map(result.tiles.map((tile) => [tile.id, tile]));
  const roomOrder = new Map(rooms.map((room, index) => [room.id, index]));
  const zoneOrder = new Map(result.zones?.map((zone, index) => [zone.id, index]) ?? []);
  const offcutsById = new Map([...result.offcutsAvailable, ...result.offcutsReused,
    ...result.discardedScraps].map((offcut) => [offcut.id, offcut]));
  for (const link of result.offcutLinks) {
    const sourceOffcut = offcutsById.get(link.sourceOffcutId);
    if (!sourceOffcut || sourceOffcut.sourceTileId !== link.sourceTileId)
      return 'Liên kết tận dụng không khớp mảnh thừa nguồn.';
    if (material === 'broadloom') {
      if (!stripsById.has(link.sourceTileId) || !stripsById.has(link.targetTileId))
        return 'Mảnh tận dụng không có dải nguồn hoặc dải đích hợp lệ.';
      const sourceOrder = roomOrder.get(stripsById.get(link.sourceTileId)?.roomId ?? '');
      const targetOrder = roomOrder.get(stripsById.get(link.targetTileId)?.roomId ?? '');
      if (sourceOrder !== undefined && targetOrder !== undefined && sourceOrder > targetOrder)
        return 'Mảnh thừa được dùng trước khi phòng nguồn được thi công.';
      if (result.zones) {
        const source = stripsById.get(link.sourceTileId)!;
        const target = stripsById.get(link.targetTileId)!;
        if ((zoneOrder.get(source.zoneId ?? '') ?? Infinity) > (zoneOrder.get(target.zoneId ?? '') ?? -1))
          return 'Mảnh thừa được dùng trước khi vùng nguồn được thi công.';
        const slice = sourceOffcut.subSlices?.find(s => s.targetStripId === target.id);
        if (!slice || Math.abs(getPolygonArea(slice.polygon) - target.rawAreaMm2) > 100)
          return 'Kích thước mảnh tận dụng không khớp lát cắt nguồn.';
        const length = Math.hypot(source.directionEnd[0] - source.directionStart[0], source.directionEnd[1] - source.directionStart[1]);
        const dx = (source.directionEnd[0] - source.directionStart[0]) / length;
        const dy = (source.directionEnd[1] - source.directionStart[1]) / length;
        const along = slice.polygon.flat().map(([x,y]) => x * dx + y * dy);
        const across = slice.polygon.flat().map(([x,y]) => -x * dy + y * dx);
        if (Math.abs(Math.max(...along) - Math.min(...along) - target.lengthMm) > 1 ||
            Math.abs(Math.max(...across) - Math.min(...across) - target.widthMm) > 1)
          return 'Chiều sợi hoặc kích thước mảnh tận dụng không khớp vùng nhận.';
      }
    } else if (!tilesById.has(link.sourceTileId) || !tilesById.has(link.targetTileId)) {
      return 'Mảnh tận dụng không có tấm nguồn hoặc tấm đích hợp lệ.';
    }
  }
  if (material === 'broadloom') {
    for (const strip of result.broadloomStrips) {
      if (result.zones) {
        const zone = result.zones.find(z => z.id === strip.zoneId && z.roomId === strip.roomId);
        if (!zone) return 'Dải trải chưa thuộc vùng hành lang hợp lệ.';
        const dx = strip.directionEnd[0] - strip.directionStart[0], dy = strip.directionEnd[1] - strip.directionStart[1];
        if (zone.direction === 'horizontal' ? Math.abs(dy) > 0.001 || dx <= 0 : Math.abs(dx) > 0.001 || dy <= 0)
          return `${zone.name}: dải thảm không đúng phương trải và chiều sợi đã chọn.`;
        try {
          const outside = polygonClipping.difference(strip.clippedPolygons as any, zone.polygons as any) as Polygon[];
          if (outside.reduce((sum, p) => sum + getPolygonArea(p), 0) > 100)
            return `${zone.name}: dải thảm vượt đường phân chia vùng.`;
        } catch { return `${zone.name}: không kiểm tra được vùng trải.`; }
      }
      if (!strip.isReusedFromOffcut && strip.lengthMm > broadloom.maxRollLength + 1)
        return 'Chiều dài dải cắt vượt quá chiều dài cuộn tối đa.';
      if (Math.abs(getPolygonArea(getBroadloomCutPolygon(strip)) - strip.rawAreaMm2) >
          Math.max(100, strip.rawAreaMm2 * 0.00001))
        return `${strip.name}: kích thước phôi cắt không khớp khối lượng xuất kho.`;
    }
  }
  try {
    const items = material === 'broadloom'
      ? result.broadloomStrips.map((strip) => ({ name: strip.name, raw: getBroadloomCutPolygon(strip),
        rawArea: strip.rawAreaMm2, placed: strip.clippedPolygons }))
      : result.tiles.map((tile) => ({ name: tile.id, raw: tile.rawPolygon,
        rawArea: tile.rawAreaMm2, placed: tile.clippedPolygons }));
    for (const item of items) {
      if (Math.abs(getPolygonArea(item.raw) - item.rawArea) > Math.max(100, item.rawArea * 0.00001))
        return `${item.name}: diện tích phôi không khớp kích thước.`;
      for (const piece of item.placed) {
        const outside = polygonClipping.difference(piece as any, item.raw as any) as Polygon[];
        if (outside.reduce((sum, poly) => sum + getPolygonArea(poly), 0) > 100)
          return `${item.name}: vùng trải vượt khỏi phôi cắt.`;
      }
    }
  } catch {
    return 'Không kiểm tra được hình học phôi cắt.';
  }
  for (const offcut of result.offcutsAvailable) {
    if (!offcut.subSlices?.length) continue;
    try {
      const slices = offcut.subSlices.map((slice) => slice.polygon);
      const totalArea = slices.reduce((sum, slice) => sum + getPolygonArea(slice), 0);
      const union = polygonClipping.union(slices[0] as any, ...slices.slice(1) as any) as Polygon[];
      const unionArea = union.reduce((sum, polygon) => sum + getPolygonArea(polygon), 0);
      const outside = polygonClipping.difference(union as any, offcut.polygon as any) as Polygon[];
      if (totalArea - unionArea > 100 || outside.reduce((sum, polygon) => sum + getPolygonArea(polygon), 0) > 100)
        return `Mảnh thừa ${offcut.id} bị cắt chồng hoặc vượt khỏi phôi nguồn.`;
    } catch {
      return `Không kiểm tra được hình học mảnh thừa ${offcut.id}.`;
    }
  }
  const netArea = rooms.reduce((sum, room) => sum + room.areaMm2, 0);
  const purchasedArea = material === 'broadloom'
    ? result.totalLinearMeters * 1000 * broadloom.rollWidth
    : result.totalRawTiles * (result.tiles[0]?.rawAreaMm2 ?? 0);
  if (purchasedArea + 100 < netArea) return 'Lượng vật tư mua ít hơn diện tích sàn cần phủ.';
  const purchasedFromPieces = material === 'broadloom'
    ? result.broadloomStrips.filter((strip) => !strip.isReusedFromOffcut)
      .reduce((sum, strip) => sum + strip.rawAreaMm2, 0)
    : result.tiles.filter((tile) => tile.status !== 'offcut_reused')
      .reduce((sum, tile) => sum + tile.rawAreaMm2, 0);
  if (Math.abs(purchasedArea - purchasedFromPieces) > Math.max(100, purchasedArea * 0.00001))
    return 'Mét dài/số tấm xuất kho không khớp danh sách phôi cắt.';
  const installedArea = material === 'broadloom'
    ? result.broadloomStrips.reduce((sum, strip) => sum + strip.usedAreaMm2, 0)
    : result.tiles.reduce((sum, tile) => sum + tile.areaMm2, 0);
  const reusableArea = result.offcutsAvailable.filter((offcut) => !offcut.isDiscarded)
    .reduce((sum, offcut) => sum + Math.max(0, offcut.remainingAreaMm2 ?? offcut.areaMm2), 0);
  if (installedArea + reusableArea > purchasedArea + Math.max(100, purchasedArea * 0.00001))
    return 'Diện tích đã trải và mảnh còn lại vượt lượng vật tư xuất kho.';
  for (const room of rooms) {
    const pieces: Polygon[] = material === 'broadloom'
      ? result.broadloomStrips.filter((strip) => strip.roomId === room.id).flatMap((strip) => strip.clippedPolygons)
      : result.tiles.filter((tile) => tile.roomId === room.id).flatMap((tile) => tile.clippedPolygons);
    if (pieces.length === 0) return `${room.name}: chưa có vật tư phủ sàn.`;
    try {
      const floor: Polygon = [ensureClosedRing(room.boundary), ...room.holes.map(ensureClosedRing)];
      for (const piece of pieces) {
        const outside = polygonClipping.difference(piece as any, floor as any) as Polygon[];
        if (outside.reduce((sum, poly) => sum + getPolygonArea(poly), 0) > 100)
          return `${room.name}: có vật tư nằm ngoài sàn.`;
      }
      const installedArea = pieces.reduce((sum, piece) => sum + getPolygonArea(piece), 0);
      const installed = polygonClipping.union(pieces[0] as any, ...pieces.slice(1) as any) as Polygon[];
      const unionArea = installed.reduce((sum, poly) => sum + getPolygonArea(poly), 0);
      const roomSeams = result.seams.filter((seam) => {
        const mid: [number, number] = [(seam.start[0] + seam.end[0]) / 2, (seam.start[1] + seam.end[1]) / 2];
        return polygonClipping.intersection([[[mid[0] - 0.01, mid[1] - 0.01],
          [mid[0] + 0.01, mid[1] - 0.01], [mid[0] + 0.01, mid[1] + 0.01],
          [mid[0] - 0.01, mid[1] + 0.01]]] as any, floor as any).length > 0;
      });
      const permittedOverlap = material === 'broadloom' && !result.zones
        ? broadloom.seamOverlap * roomSeams.reduce((sum, seam) => sum + seam.lengthMm, 0) : 0;
      const overlapTolerance = result.zones ? 100 : Math.max(100, room.areaMm2 * 0.00001);
      if (installedArea - unionArea > permittedOverlap + overlapTolerance)
        return `${room.name}: các tấm trải chồng nhau vượt mức mối nối cho phép.`;
      const missing = polygonClipping.difference(floor as any, installed as any) as Polygon[];
      const missingArea = missing.reduce((sum, poly) => sum + getPolygonArea(poly), 0);
      if (missingArea > Math.max(100, room.areaMm2 * 0.00001)) {
        return `${room.name}: layout còn ${(missingArea / 1_000_000).toFixed(3)} m² chưa phủ. Không thể xuất dự toán.`;
      }
    } catch {
      return `${room.name}: không kiểm tra được hình học vùng phủ.`;
    }
  }
  return null;
}
