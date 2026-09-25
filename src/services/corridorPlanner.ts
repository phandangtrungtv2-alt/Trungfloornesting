import type { CalculationInput } from './calculationPipeline';
import type { NestingResult, OffcutItem, Point, Polygon, RoomGeometry } from '../types';
import { computeNesting, getStripOverlapSeams } from './nestingEngine';
import { optimizeOffcuts } from './offcutManager';
import { validateNesting } from './nestingValidation';
import { getPolygonArea, getPolygonBoundingBox } from './geometryMath';
import { resolveCorridorZones } from './corridorZones';

const mapPolygon = (p: Polygon, map: (point: Point) => Point): Polygon => p.map(r => r.map(map));
const seamLength = (p: NestingResult) => p.seams.reduce((sum, s) => sum + s.lengthMm, 0);
const better = (a: NestingResult, b: NestingResult) => a.totalLinearMeters < b.totalLinearMeters - 0.001 ||
  (Math.abs(a.totalLinearMeters - b.totalLinearMeters) <= 0.001 && seamLength(a) < seamLength(b));

/** Normalize each region to the roll's physical axes, reuse the existing cutter,
 * then restore each source and destination to its own CAD orientation. */
export function calculateCorridorPlan(input: CalculationInput): NestingResult {
  const started = performance.now();
  const zones = resolveCorridorZones(input.rooms, input.corridorZones ?? []);
  if (!zones.some(z => z.areaMm2 > 100)) throw new Error('Chưa có vùng hành lang để trải thảm.');
  const contexts = new Map<string, { zone: typeof zones[number]; back: (p: Point) => Point }>();
  const virtualRooms: RoomGeometry[] = [];
  const origins: Record<string, Point> = {};
  let offset = 0;
  for (const zone of zones) {
    const b = zone.bounds;
    const vertical = zone.direction === 'vertical';
    const xOffset = offset;
    const forward = ([x, y]: Point): Point => vertical
      ? [xOffset + y - b.minY, b.maxX - x] : [xOffset + x - b.minX, y - b.minY];
    const back = ([x, y]: Point): Point => vertical
      ? [b.maxX - y, b.minY + x - xOffset] : [b.minX + x - xOffset, b.minY + y];
    zone.polygons.forEach((polygon, part) => {
      const local = mapPolygon(polygon, forward);
      const id = `${zone.id}-PART-${part}`;
      const bbox = getPolygonBoundingBox(local);
      virtualRooms.push({ id, name: zone.name, boundary: local[0], holes: local.slice(1),
        bbox, areaMm2: getPolygonArea(local) });
      origins[id] = [bbox.minX, bbox.minY];
      contexts.set(id, { zone, back });
    });
    offset += Math.max(b.width, b.height) + input.broadloomConfig.rollWidth * 4;
  }
  const roll = { ...input.broadloomConfig, direction: 'horizontal' as const };
  // The first zone of each later room is its datum run when that room fits
  // one roll width. It must be one full-length physical cut: an earlier
  // remnant may replace it only as one piece; otherwise purchase a new roll.
  const requiredRuns = new Map<string, number>();
  for (const room of input.rooms.slice(1)) {
    const parts = virtualRooms.filter(part => contexts.get(part.id)?.zone.roomId === room.id);
    const roomZones = zones.filter(zone => zone.roomId === room.id && zone.areaMm2 > 100);
    if (parts.length !== 1 || roomZones.length !== 1) continue;
    const span = parts[0].bbox.width;
    const across = parts[0].bbox.height;
    if (across <= roll.rollWidth + 1 &&
        span + Math.max(0, roll.cutAllowanceMm ?? 100) <= roll.maxRollLength + 1)
      requiredRuns.set(parts[0].id, span);
  }
  const keepsDatumRuns = (plan: NestingResult) => [...requiredRuns].every(([roomId, span]) => {
    const pieces = plan.broadloomStrips.filter(strip => strip.roomId === roomId);
    if (pieces.length !== 1 || pieces[0].lengthMm < span - 1) return false;
    if (!pieces[0].isReusedFromOffcut) return Math.abs(pieces[0].widthMm - roll.rollWidth) <= 1;
    const link = plan.offcutLinks.find(item => item.targetTileId === pieces[0].id);
    const source = plan.broadloomStrips.find(strip => strip.id === link?.sourceTileId);
    const sourceRoom = contexts.get(source?.roomId ?? '')?.zone.roomId;
    const targetRoom = contexts.get(roomId)?.zone.roomId;
    return input.rooms.findIndex(room => room.id === sourceRoom) >= 0 &&
      input.rooms.findIndex(room => room.id === sourceRoom) <
        input.rooms.findIndex(room => room.id === targetRoom);
  });
  const raw = computeNesting({ ...input, rooms: virtualRooms, broadloomConfig: roll,
    rotationDeg: 0, originPoint: origins[virtualRooms[0].id], roomOrigins: origins,
    minBroadloomOffcutMm: input.offcutConfig.minBroadloomWidth });
  const optimized = optimizeOffcuts(raw, { ...input.offcutConfig, allowRotate: false },
    virtualRooms, roll, 0, origins[virtualRooms[0].id], origins);
  let chosen = !keepsDatumRuns(optimized) || validateNesting(virtualRooms, optimized, 'broadloom', roll)
    ? raw : optimized;

  // Also compare all regions optimized independently: several long corridors
  // can each shorten their own roll in the same project.
  const independent: NestingResult = { ...raw, broadloomStrips: [], seams: [],
    offcutsAvailable: [], offcutsReused: [], discardedScraps: [], offcutLinks: [], totalLinearMeters: 0 };
  for (const [partIndex, room] of virtualRooms.entries()) {
    const strips = raw.broadloomStrips.filter(s => s.roomId === room.id);
    const ids = new Set(strips.map(s => s.id));
    const subRaw = { ...raw, broadloomStrips: strips, seams: getStripOverlapSeams(strips),
      offcutsAvailable: raw.offcutsAvailable.filter(o => ids.has(o.sourceTileId)),
      totalLinearMeters: strips.reduce((sum, s) => sum + s.lengthMm / 1000, 0) };
    const subCandidate = optimizeOffcuts(subRaw, input.offcutConfig, [room], roll, 0, origins[room.id], origins);
    const sub = namespacePlan(validateNesting([room], subCandidate, 'broadloom', roll) ? subRaw : subCandidate, `ZONE${partIndex}-`);
    independent.broadloomStrips.push(...sub.broadloomStrips);
    independent.seams.push(...sub.seams);
    independent.offcutsAvailable.push(...sub.offcutsAvailable);
    independent.offcutsReused.push(...sub.offcutsReused);
    independent.discardedScraps.push(...sub.discardedScraps);
    independent.offcutLinks.push(...sub.offcutLinks);
    independent.totalLinearMeters += sub.totalLinearMeters;
  }
  if (better(independent, chosen) && keepsDatumRuns(independent) &&
      !validateNesting(virtualRooms, independent, 'broadloom', roll)) chosen = independent;
  if (!keepsDatumRuns(chosen)) throw new Error('Dải tại mốc định vị chưa phủ liên tục hết chiều dài hành lang.');
  const error = validateNesting(virtualRooms, chosen, 'broadloom', roll);
  if (error) throw new Error(error);

  const sourceContexts = new Map(chosen.broadloomStrips.map(s => [s.id, contexts.get(s.roomId!)!]));
  const pairByTarget = new Map(chosen.offcutLinks.map((link, i) => [link.targetTileId, i + 1]));
  const codes = (target: string) => {
    const pair = String(pairByTarget.get(target) ?? 0).padStart(2, '0');
    return { source: `S-${pair}`, target: `P-${pair}` };
  };
  const mapOffcut = (offcut: OffcutItem): OffcutItem => {
    const ctx = sourceContexts.get(offcut.sourceTileId)!;
    const polygon = mapPolygon(offcut.polygon, ctx.back);
    return { ...offcut, polygon, bbox: getPolygonBoundingBox(polygon), center: ctx.back(offcut.center),
      grainAngle: ctx.zone.direction === 'vertical' ? 90 : 0,
      subSlices: offcut.subSlices?.map(slice => ({ ...slice,
        code: codes(slice.targetStripId).source, targetCode: codes(slice.targetStripId).target,
        polygon: mapPolygon(slice.polygon, ctx.back), center: ctx.back(slice.center) })),
      leftoverPolygon: offcut.leftoverPolygon && mapPolygon(offcut.leftoverPolygon, ctx.back),
      leftoverPolygons: offcut.leftoverPolygons?.map(p => mapPolygon(p, ctx.back)) };
  };
  const strips = chosen.broadloomStrips.map(strip => {
    const ctx = sourceContexts.get(strip.id)!;
    return { ...strip, roomId: ctx.zone.roomId, zoneId: ctx.zone.id,
      name: `${ctx.zone.name} · ${strip.name}`,
      rawPolygon: mapPolygon(strip.rawPolygon, ctx.back),
      clippedPolygons: strip.clippedPolygons.map(p => mapPolygon(p, ctx.back)),
      center: ctx.back(strip.center), directionStart: ctx.back(strip.directionStart), directionEnd: ctx.back(strip.directionEnd),
      offcuts: strip.offcuts.map(mapOffcut),
      sourceSliceCode: strip.isReusedFromOffcut ? codes(strip.id).source : undefined,
      matchingCode: strip.isReusedFromOffcut ? codes(strip.id).target : undefined };
  });
  const result: NestingResult = { ...chosen, layDirection: undefined, zones,
    broadloomStrips: strips, seams: getStripOverlapSeams(strips.map(s => ({ ...s, parentStripId: undefined }))),
    offcutsAvailable: chosen.offcutsAvailable.map(mapOffcut),
    offcutsReused: chosen.offcutsReused.map(mapOffcut), discardedScraps: chosen.discardedScraps.map(mapOffcut),
    offcutLinks: chosen.offcutLinks.map(link => ({ ...link,
      pairIndex: pairByTarget.get(link.targetTileId), sourceCode: codes(link.targetTileId).source,
      targetCode: codes(link.targetTileId).target, label: `${codes(link.targetTileId).source} → ${codes(link.targetTileId).target}`,
      sourceCenter: sourceContexts.get(link.sourceTileId)!.back(link.sourceCenter),
      targetCenter: sourceContexts.get(link.targetTileId)!.back(link.targetCenter) })),
    zoneQuantities: zones.map(zone => {
      const items = strips.filter(s => s.zoneId === zone.id);
      return { zoneId: zone.id, name: zone.name, roomId: zone.roomId,
        roomName: input.rooms.find(room => room.id === zone.roomId)?.name,
        direction: zone.direction,
        floorAreaM2: zone.areaMm2 / 1e6,
        linearMeters: items.reduce((sum, s) => sum + (s.isReusedFromOffcut ? 0 : s.lengthMm / 1000), 0),
        reusedAreaM2: items.reduce((sum, s) => sum + (s.isReusedFromOffcut ? s.usedAreaMm2 / 1e6 : 0), 0),
        reusedPieces: items.filter(s => s.isReusedFromOffcut).length };
    }), computationTimeMs: performance.now() - started };
  const worldError = validateNesting(input.rooms, result, 'broadloom', input.broadloomConfig);
  if (worldError) throw new Error(worldError);
  return result;
}

function namespacePlan(plan: NestingResult, prefix: string): NestingResult {
  const id = (value: string) => prefix + value;
  const off = (o: OffcutItem): OffcutItem => ({ ...o, id: id(o.id), sourceTileId: id(o.sourceTileId),
    assignedToTileId: o.assignedToTileId && id(o.assignedToTileId),
    subSlices: o.subSlices?.map(s => ({ ...s, id: id(s.id), targetStripId: id(s.targetStripId) })) });
  return { ...plan, broadloomStrips: plan.broadloomStrips.map(s => ({ ...s, id: id(s.id),
    parentStripId: s.parentStripId && id(s.parentStripId), reusedFromId: s.reusedFromId && id(s.reusedFromId), offcuts: s.offcuts.map(off) })),
    offcutsAvailable: plan.offcutsAvailable.map(off), offcutsReused: plan.offcutsReused.map(off), discardedScraps: plan.discardedScraps.map(off),
    offcutLinks: plan.offcutLinks.map(l => ({ ...l, id: id(l.id), sourceTileId: id(l.sourceTileId),
      sourceOffcutId: id(l.sourceOffcutId), targetTileId: id(l.targetTileId) })) };
}
