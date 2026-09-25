import polygonClipping from 'polygon-clipping';
import type {
  BoundingBox, BroadloomConfig, BroadloomStrip, NestingResult, OffcutConfig,
  OffcutFlowLink, OffcutItem, Point, Polygon, RoomGeometry,
} from '../types';
import {
  ensureClosedRing, getPolygonArea, getPolygonBoundingBox, getPolygonCentroid,
  rotatePoint, rotateRing,
} from './geometryMath';
import { getStripOverlapSeams } from './nestingEngine';
import { validateNesting } from './nestingValidation';
import { getBroadloomCutPolygon } from './broadloomGeometry';

type Stock = { offcut: OffcutItem; box: BoundingBox; sourceOrigin: Point; sourceRoomIndex: number };
type Placement = { stockIndex: number; target: Polygon[]; source: Polygon; area: number;
  placed: Polygon; pieceWidth: number; pieceHeight: number };
type PreparedPlan = {
  roomIndex: Map<string, number>;
  originByRoom: Map<string, Point>;
  floorByRoom: Map<string, Polygon>;
  installedByStrip: Map<string, Polygon[]>;
  sourceRoomByStrip: Map<string, string>;
  stockByOffcut: Map<string, Stock[]>;
};

const areaOf = (polygons: Polygon[]) => polygons.reduce((sum, polygon) => sum + getPolygonArea(polygon), 0);
const rect = (minX: number, minY: number, maxX: number, maxY: number): Polygon =>
  [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]]];
const isAxisRectangle = (polygon: Polygon, box: BoundingBox) => {
  if (polygon.length !== 1 || Math.abs(getPolygonArea(polygon) - box.width * box.height) > 1)
    return false;
  const corners = new Set<string>();
  for (const [x, y] of polygon[0]) {
    const sideX = Math.abs(x - box.minX) < 0.001 ? 0 : Math.abs(x - box.maxX) < 0.001 ? 1 : -1;
    const sideY = Math.abs(y - box.minY) < 0.001 ? 0 : Math.abs(y - box.maxY) < 0.001 ? 1 : -1;
    if (sideX < 0 || sideY < 0) return false;
    corners.add(`${sideX}${sideY}`);
  }
  return corners.size === 4;
};
const asWorld = (polygon: Polygon, angle: number, origin: Point): Polygon =>
  polygon.map((ring) => ensureClosedRing(rotateRing(ring, angle, origin)));
const asLocal = (polygon: Polygon, angle: number, origin: Point): Polygon =>
  polygon.map((ring) => ensureClosedRing(rotateRing(ring, -angle, origin)));
const distinctCoordinates = (values: number[]) => {
  const sorted = values.sort((a, b) => a - b);
  const distinct: number[] = [];
  for (const value of sorted)
    if (!distinct.length || value - distinct[distinct.length - 1] > 0.001)
      distinct.push(value);
  return distinct;
};

/** Partition an orthogonal offcut along the pile direction without treating its empty corners as stock. */
function rectangularStock(offcut: OffcutItem, sourceOrigin: Point, sourceRoomIndex: number,
  angle: number, isVertical: boolean, minSide: number): Stock[] {
  const local = asLocal(offcut.polygon, angle, sourceOrigin);
  const bounds = getPolygonBoundingBox(local);
  const along = isVertical ? 1 : 0;
  const coordinates = distinctCoordinates(local.flat().map((point) => point[along]));
  const result: Stock[] = [];
  for (let index = 0; index < coordinates.length - 1; index++) {
    const from = coordinates[index], to = coordinates[index + 1];
    if (to - from < 1) continue;
    const slab = isVertical ? rect(bounds.minX, from, bounds.maxX, to)
      : rect(from, bounds.minY, to, bounds.maxY);
    const parts = polygonClipping.intersection(local as any, slab as any) as Polygon[];
    for (const part of parts) {
      // A tiny CAD spur can make the whole slab L-shaped. Split across the
      // roll too, so its large rectangular portion is still usable stock.
      const partBox = getPolygonBoundingBox(part);
      const across = isVertical ? 0 : 1;
      const edges = distinctCoordinates(part.flat().map((point) => point[across]));
      for (let crossIndex = 0; crossIndex < edges.length - 1; crossIndex++) {
        const low = edges[crossIndex], high = edges[crossIndex + 1];
        if (high - low < minSide) continue;
        const crossSlab = isVertical ? rect(low, partBox.minY, high, partBox.maxY)
          : rect(partBox.minX, low, partBox.maxX, high);
        const cells = polygonClipping.intersection(part as any, crossSlab as any) as Polygon[];
        for (const cell of cells) {
          const box = getPolygonBoundingBox(cell);
          if (Math.min(box.width, box.height) < minSide ||
              Math.abs(getPolygonArea(cell) - box.width * box.height) >
                Math.max(100, box.width * box.height * 0.001)) continue;
          // CAD edges can deviate from an axis by fractions of a millimetre. A
          // bounding rectangle may then protrude outside its source polygon.
          let contained: BoundingBox | null = null;
          for (const inset of [0, 0.1, 0.25, 0.5, 1, 2, 5]) {
            if (box.width <= inset * 2 || box.height <= inset * 2) break;
            const candidate = getPolygonBoundingBox(rect(box.minX + inset, box.minY + inset,
              box.maxX - inset, box.maxY - inset));
            const outside = polygonClipping.difference(rect(candidate.minX, candidate.minY,
              candidate.maxX, candidate.maxY) as any, cell as any) as Polygon[];
            if (areaOf(outside) <= 100) { contained = candidate; break; }
          }
          if (contained && Math.min(contained.width, contained.height) >= minSide)
            result.push({ offcut, box: contained, sourceOrigin, sourceRoomIndex });
        }
      }
    }
  }
  return result;
}

function preparePlan(nesting: NestingResult, rooms: RoomGeometry[], config: OffcutConfig,
  roll: BroadloomConfig, angle: number, roomOrigins: Record<string, Point>): PreparedPlan {
  const roomIndex = new Map(rooms.map((room, index) => [room.id, index]));
  const originByRoom = new Map(rooms.map((room) => [room.id,
    roomOrigins[room.id] ?? [room.bbox.minX, room.bbox.minY] as Point]));
  const floorByRoom = new Map(rooms.map((room) => {
    const origin = originByRoom.get(room.id)!;
    return [room.id, [ensureClosedRing(rotateRing(room.boundary, -angle, origin)),
      ...room.holes.map((hole) => ensureClosedRing(rotateRing(hole, -angle, origin)))]] as
      [string, Polygon];
  }));
  const installedByStrip = new Map(nesting.broadloomStrips.map((strip) => [strip.id,
    strip.clippedPolygons.map((polygon) => asLocal(polygon, angle,
      originByRoom.get(strip.roomId ?? rooms[0].id)!))]));
  const sourceRoomByStrip = new Map(nesting.broadloomStrips.map((strip) =>
    [strip.id, strip.roomId ?? rooms[0].id]));
  const stockByOffcut = new Map<string, Stock[]>();
  for (const offcut of nesting.offcutsAvailable) {
    const roomId = sourceRoomByStrip.get(offcut.sourceTileId);
    if (roomId === undefined) continue;
    const origin = originByRoom.get(roomId)!;
    stockByOffcut.set(offcut.id, rectangularStock(offcut, origin, roomIndex.get(roomId)!,
      angle, roll.direction === 'vertical', config.minBroadloomWidth ?? 1000));
  }
  return { roomIndex, originByRoom, floorByRoom, installedByStrip,
    sourceRoomByStrip, stockByOffcut };
}

/** Try replacing purchased strips with a shared stock of remnants from retained rolls. */
export function optimizeBroadloomRemnantFirst(
  nesting: NestingResult, rooms: RoomGeometry[], config: OffcutConfig,
  roll: BroadloomConfig, rotationDeg: number, roomOrigins: Record<string, Point> = {}
): NestingResult {
  if (!config.enabled || !rooms.length || !nesting.broadloomStrips.length) return nesting;
  const angle = rotationDeg * Math.PI / 180;
  const prepared = preparePlan(nesting, rooms, config, roll, angle, roomOrigins);
  const originals = nesting.broadloomStrips;
  const eligible = new Set(nesting.offcutsAvailable.map((offcut) => offcut.sourceTileId));
  const options: Set<string>[] = [];
  // A whole room may be replaced only when one earlier remnant covers it completely.
  for (const room of rooms) {
    const inRoom = originals.filter((strip) => strip.roomId === room.id);
    if (inRoom.length && inRoom.length < originals.length)
      options.push(new Set(inRoom.map((strip) => strip.id)));
    const longest = Math.max(0, ...inRoom.map((strip) => strip.lengthMm));
    const short = inRoom.filter((strip) => strip.lengthMm < longest * 0.65);
    if (short.length) options.push(new Set(short.map((strip) => strip.id)));
  }
  for (const strip of originals) options.push(new Set([strip.id]));

  let best: NestingResult = nesting;
  let removed = new Set<string>();
  const assessed = new Set<string>();
  const assess = (ids: Set<string>): NestingResult | null => {
    const key = [...ids].sort().join('|');
    if (assessed.has(key) || ![...originals].some((strip) => !ids.has(strip.id) && eligible.has(strip.id))) return null;
    assessed.add(key);
    try {
      return buildPlan(nesting, rooms, config, roll, angle, prepared, ids,
        undefined, best.totalLinearMeters);
    } catch {
      // Rotated polygon intersections can be numerically unstable. Keep the valid base layout.
      return null;
    }
  };
  const improves = (candidate: NestingResult | null) => candidate &&
    candidate.offcutLinks.length > 0 && candidate.totalLinearMeters < best.totalLinearMeters - 0.001;
  for (const ids of options) {
    const candidate = assess(ids);
    if (improves(candidate)) { best = candidate!; removed = ids; }
  }
  // Rebuild from the original plan after each added receiver, so a source slice cannot be spent twice.
  for (let pass = 0; pass < originals.length; pass++) {
    let next: NestingResult | null = null;
    let nextIds: Set<string> | null = null;
    for (const strip of originals) {
      if (removed.has(strip.id)) continue;
      const ids = new Set([...removed, strip.id]);
      const candidate = assess(ids);
      if (candidate && candidate.offcutLinks.length &&
          candidate.totalLinearMeters < (next?.totalLinearMeters ?? best.totalLinearMeters) - 0.001) {
        next = candidate; nextIds = ids;
      }
    }
    if (!next || !nextIds) break;
    best = next; removed = nextIds;
  }
  return best;
}

/** Shorten a long purchased strip and use its longitudinal offcut within the
 * same room. Other purchased strips are retained, so cross corridors can also
 * use the new offcut without losing their existing remnant allocations. */
export function optimizeBroadloomSelfRemnant(
  nesting: NestingResult, rooms: RoomGeometry[], config: OffcutConfig,
  roll: BroadloomConfig, rotationDeg: number, roomOrigins: Record<string, Point> = {}
): NestingResult {
  if (!config.enabled || rooms.length !== 1 || !nesting.broadloomStrips.length)
    return nesting;
  const room = rooms[0];
  const origin = roomOrigins[room.id] ?? [room.bbox.minX, room.bbox.minY];
  const angle = rotationDeg * Math.PI / 180;
  const prepared = preparePlan(nesting, rooms, config, roll, angle, roomOrigins);
  const isVertical = roll.direction === 'vertical';
  const allowance = Math.max(0, roll.cutAllowanceMm ?? 100);
  let best = nesting;
  for (const source of nesting.broadloomStrips) {
    if (source.roomId !== room.id || source.lengthMm < 4000) continue;
    const box = getPolygonBoundingBox(asLocal(source.rawPolygon, angle, origin));
    const span = isVertical ? box.height : box.width;
    const cross = isVertical ? box.width : box.height;
    if (cross > roll.rollWidth + 1 || span < 4000) continue;
    const clippedBoxes = source.clippedPolygons.map((polygon) =>
      getPolygonBoundingBox(asLocal(polygon, angle, origin)));
    const installedCrossMin = Math.min(...clippedBoxes.map((clipped) =>
      isVertical ? clipped.minX : clipped.minY));
    const installedCrossMax = Math.max(...clippedBoxes.map((clipped) =>
      isVertical ? clipped.maxX : clipped.maxY));
    const originalCrossMin = isVertical ? box.minX : box.minY;
    const crossStarts = [originalCrossMin];
    if (installedCrossMax - installedCrossMin < roll.rollWidth - 1)
      for (const value of [installedCrossMin, installedCrossMax - roll.rollWidth])
        if (crossStarts.every((existing) => Math.abs(existing - value) > 1))
          crossStarts.push(value);
    const short = nesting.broadloomStrips.filter((strip) => strip.roomId === room.id &&
      strip.id !== source.id && strip.lengthMm < source.lengthMm * 0.65).slice(0, 4);
    const removalOptions = [new Set([source.id]),
      ...short.map((strip) => new Set([source.id, strip.id]))];
    if (short.length > 1) removalOptions.push(new Set([source.id, ...short.map((strip) => strip.id)]));
    for (const removed of removalOptions) {
      const retained = nesting.broadloomStrips.filter((strip) => !removed.has(strip.id));
      const retainedArea = retained.reduce((sum, strip) => sum + strip.usedAreaMm2, 0);
      const minimumSpan = Math.max(1000, (room.areaMm2 - retainedArea) / roll.rollWidth - allowance);
      const maximumSpan = Math.min(span, roll.maxRollLength - allowance);
      if (minimumSpan >= maximumSpan - 1) continue;
      for (const edge of ['start', 'end'] as const) for (const crossMin of crossStarts) {
        let low = minimumSpan;
        let high = maximumSpan;
        // The longest feasible split may still require extra material. Keep it
        // as a candidate, then search for the shortest one filled by remnants.
        for (let pass = 0; pass < 14 && high - low > 1; pass++) {
          const length = (low + high) / 2;
          let candidate: NestingResult | null = null;
          try {
            candidate = buildPlan(nesting, rooms, config, roll, angle, prepared,
              removed, { sourceStripId: source.id, edge, span: length, crossMin });
          } catch { /* Keep the valid base layout for unstable CAD intersections. */ }
          if (candidate?.offcutLinks.length &&
              candidate.totalLinearMeters < best.totalLinearMeters - 0.001)
            best = candidate;
          const purchased = candidate?.broadloomStrips.filter((strip) => !strip.isReusedFromOffcut);
          if (candidate && purchased?.length === retained.length + 1) high = length;
          else low = length;
        }
      }
    }
  }
  return best;
}

function buildPlan(
  nesting: NestingResult, rooms: RoomGeometry[], config: OffcutConfig,
  roll: BroadloomConfig, angle: number, prepared: PreparedPlan, removed: Set<string>,
  selfStarter?: { sourceStripId: string; edge: 'start' | 'end'; span: number; crossMin: number },
  maxMeters = Infinity
): NestingResult | null {
  const primary = nesting.broadloomStrips.filter((strip) => !removed.has(strip.id));
  const primaryIds = new Set(primary.map((strip) => strip.id));
  if (Number.isFinite(maxMeters)) {
    const retainedMeters = primary.reduce((sum, strip) => sum + strip.lengthMm / 1000, 0);
    const floorToCover = Math.max(0, rooms.reduce((sum, room) => sum + room.areaMm2, 0) -
      primary.reduce((sum, strip) => sum + strip.usedAreaMm2, 0));
    const reusableArea = nesting.offcutsAvailable.reduce((sum, offcut) =>
      sum + (primaryIds.has(offcut.sourceTileId) ? offcut.areaMm2 : 0), 0);
    const lowerBoundMeters = retainedMeters +
      Math.max(0, floorToCover - reusableArea) / roll.rollWidth / 1000;
    if (lowerBoundMeters >= maxMeters - 0.001) return null;
  }
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const roomIndex = prepared.roomIndex;
  const originFor = (room: RoomGeometry): Point => prepared.originByRoom.get(room.id)!;
  const uncoveredByRoom = new Map<string, Polygon[]>();
  for (const room of rooms) {
    const first = nesting.broadloomStrips.find((strip) => strip.roomId === room.id);
    // When a remnant cannot cover the whole room, its first strip must be new carpet.
    if (first && removed.has(first.id) && roomIndex.get(room.id) === 0 && !selfStarter) return null;
    const floor = prepared.floorByRoom.get(room.id)!;
    const installed = primary.filter((strip) => strip.roomId === room.id)
      .flatMap((strip) => prepared.installedByStrip.get(strip.id)!);
    const uncovered = installed.length ? polygonClipping.difference(floor as any,
      polygonClipping.union(installed[0] as any, ...installed.slice(1) as any) as any) as Polygon[] : [floor];
    uncoveredByRoom.set(room.id, uncovered);
  }
  const isVertical = roll.direction === 'vertical';
  const copiedOffcuts = nesting.offcutsAvailable.filter((offcut) => primaryIds.has(offcut.sourceTileId))
    .map((offcut): OffcutItem => ({ ...offcut, subSlices: [], leftoverPolygon: undefined, remainingAreaMm2: offcut.areaMm2 }));
  const stock: Stock[] = [];
  const registerNewStripOffcuts = (strip: BroadloomStrip, room: RoomGeometry, sourceRoomIndex: number) => {
    const floor: Polygon = [ensureClosedRing(room.boundary),
      ...room.holes.map((hole) => ensureClosedRing(hole))];
    const sourceOrigin = originFor(room);
    const cutoff = polygonClipping.difference(getBroadloomCutPolygon(strip) as any,
      floor as any) as Polygon[];
    for (let index = 0; index < cutoff.length; index++) {
      const polygon = cutoff[index];
      const local = asLocal(polygon, angle, sourceOrigin);
      const box = getPolygonBoundingBox(local);
      const area = getPolygonArea(local);
      if (area < 100 || Math.min(box.width, box.height) < (config.minBroadloomWidth ?? 1000)) continue;
      const offcut: OffcutItem = {
        id: `OFF-NEW-${strip.id}-${index + 1}`, sourceTileId: strip.id, polygon,
        bbox: getPolygonBoundingBox(polygon), center: getPolygonCentroid(polygon),
        areaMm2: area, width: Math.min(box.width, box.height), height: Math.max(box.width, box.height),
        grainAngle: angle * 180 / Math.PI + (isVertical ? 90 : 0),
        isDiscarded: false, isBroadloomLongitudinal: true,
        remainingAreaMm2: area, subSlices: [],
      };
      strip.offcuts.push(offcut);
      copiedOffcuts.push(offcut);
      stock.push(...rectangularStock(offcut, sourceOrigin, sourceRoomIndex, angle,
        isVertical, config.minBroadloomWidth ?? 1000));
    }
  };
  for (const offcut of copiedOffcuts) {
    stock.push(...(prepared.stockByOffcut.get(offcut.id) ?? []).map((item) =>
      ({ ...item, offcut })));
  }
  let selfPurchased: { strip: BroadloomStrip; remaining: Polygon[] } | null = null;
  const selfSource = selfStarter && nesting.broadloomStrips.find((strip) => strip.id === selfStarter.sourceStripId);
  if (selfStarter) {
    const room = roomById.get(selfSource?.roomId ?? '');
    if (!room || !selfSource) return null;
    const sourceBox = getPolygonBoundingBox(asLocal(selfSource.rawPolygon, angle, originFor(room)));
    selfPurchased = purchaseSelfStarter(room, uncoveredByRoom.get(room.id)!,
      roll, angle, originFor(room), isVertical, selfStarter, sourceBox);
    if (!selfPurchased) return null;
    registerNewStripOffcuts(selfPurchased.strip, room, roomIndex.get(room.id)!);
  }
  if (!stock.length) return null;

  const reusedStrips: BroadloomStrip[] = [];
  const links: OffcutFlowLink[] = [];
  const newStrips: BroadloomStrip[] = [];
  let pair = 0;
  for (const [targetRoomIndex, room] of rooms.entries()) {
    const first = nesting.broadloomStrips.find((strip) => strip.roomId === room.id);
    const firstRemoved = Boolean(first && removed.has(first.id));
    const selfInRoom = selfPurchased?.strip.roomId === room.id;
    if (firstRemoved && primary.some((strip) => strip.roomId === room.id) && !selfInRoom) return null;
    const roomFloor = uncoveredByRoom.get(room.id)!;
    const wholeRoomFromRemnant = !selfInRoom && firstRemoved && Boolean(findBestPlacement(stock, roomFloor,
      isVertical, config.minBroadloomWidth ?? 1000, targetRoomIndex, room.areaMm2));
    const linksBeforeRoom = links.length;
    let starterStrip: BroadloomStrip | null = null;
    if (selfInRoom) {
      newStrips.push(selfPurchased!.strip);
      starterStrip = selfPurchased!.strip;
      uncoveredByRoom.set(room.id, selfPurchased!.remaining);
    } else if (firstRemoved && !wholeRoomFromRemnant) {
      const starter = purchaseStarter(room, roomFloor, stock, roll, angle,
        originFor(room), isVertical, targetRoomIndex);
      if (!starter) return null;
      newStrips.push(starter.strip);
      starterStrip = starter.strip;
      uncoveredByRoom.set(room.id, starter.remaining);
    }
    for (let iteration = 0; iteration < 100 && stock.length; iteration++) {
      const uncovered = uncoveredByRoom.get(room.id)!;
      if (areaOf(uncovered) < 100) break;
      const best = findBestPlacement(stock, uncovered, isVertical,
        config.minBroadloomWidth ?? 1000, targetRoomIndex,
        wholeRoomFromRemnant ? room.areaMm2 : undefined, rooms.length === 1);
      if (!best) break;
      const origin = originFor(room);
      const item = stock.splice(best.stockIndex, 1)[0];
      const sourceWorld = asWorld(best.source, angle, item.sourceOrigin);
      const rawWorld = asWorld(best.placed, angle, origin);
      const installedWorld = best.target.map((polygon) => asWorld(polygon, angle, origin));
      const length = isVertical ? best.pieceHeight : best.pieceWidth;
      const width = isVertical ? best.pieceWidth : best.pieceHeight;
      pair++;
      const stripId = `STRIP-CUT-${room.id}-${pair}`;
      const sourceCode = `S-${String(pair).padStart(2, '0')}`;
      const targetCode = `P-${String(pair).padStart(2, '0')}`;
      const box = getPolygonBoundingBox(best.placed);
      const center = getPolygonCentroid(installedWorld[0]);
      reusedStrips.push({
        id: stripId, name: `Mảnh tận dụng ${pair} (${(length / 1000).toFixed(2)}m × ${(width / 1000).toFixed(2)}m)`,
        roomId: room.id, index: primary.filter((strip) => strip.roomId === room.id).length + pair, rawPolygon: rawWorld,
        clippedPolygons: installedWorld, rawAreaMm2: length * width,
        usedAreaMm2: best.area, lengthMm: length, widthMm: width, usedWidthMm: width,
        isReusedFromOffcut: true, reusedFromId: item.offcut.id,
        sourceSliceCode: sourceCode, matchingCode: targetCode, offcuts: [], center,
        directionStart: rotatePoint(isVertical ? [(box.minX + box.maxX) / 2, box.minY]
          : [box.minX, (box.minY + box.maxY) / 2], angle, origin),
        directionEnd: rotatePoint(isVertical ? [(box.minX + box.maxX) / 2, box.maxY]
          : [box.maxX, (box.minY + box.maxY) / 2], angle, origin),
      });
      item.offcut.subSlices!.push({
        id: `SLICE-${item.offcut.id}-${pair}`, code: sourceCode, targetCode,
        targetStripId: stripId, polygon: sourceWorld, center: getPolygonCentroid(sourceWorld),
        widthMm: width, lengthMm: length, index: pair,
      });
      links.push({
        id: `LINK-${item.offcut.id}-${stripId}`, pairIndex: pair,
        sourceCode, targetCode, sourceTileId: item.offcut.sourceTileId,
        sourceOffcutId: item.offcut.id, targetTileId: stripId,
        sourceCenter: getPolygonCentroid(sourceWorld), targetCenter: center,
        areaMm2: best.area, label: `${sourceCode} ➔ ${targetCode}`,
        sourceWidthMm: Math.round(width), sourceHeightMm: Math.round(length),
        targetWidthMm: Math.round(width), targetHeightMm: Math.round(length),
      });
      uncoveredByRoom.set(room.id, polygonClipping.difference(uncoveredByRoom.get(room.id)! as any,
        best.placed as any) as Polygon[]);
      // Guillotine cuts leave two disjoint rectangles in the original remnant.
      const old = item.box;
      const xCut = old.minX + best.pieceWidth;
      const yCut = old.minY + best.pieceHeight;
      for (const box of [
        getPolygonBoundingBox(rect(xCut, old.minY, old.maxX, old.maxY)),
        getPolygonBoundingBox(rect(old.minX, yCut, xCut, old.maxY)),
      ]) {
        if (box.width > 1 && box.height > 1 && Math.min(box.width, box.height) >= (config.minBroadloomWidth ?? 1000))
          stock.push({ offcut: item.offcut, box, sourceOrigin: item.sourceOrigin,
            sourceRoomIndex: item.sourceRoomIndex });
      }
    }
    if (wholeRoomFromRemnant && areaOf(uncoveredByRoom.get(room.id)!) >= 100) return null;
    if (firstRemoved && links.length === linksBeforeRoom) return null;
    const purchased = purchaseRemaining(room, uncoveredByRoom.get(room.id)!, roll,
      angle, originFor(room), isVertical);
    if (!purchased || (wholeRoomFromRemnant && purchased.length)) return null;
    newStrips.push(...purchased);
    if (starterStrip && starterStrip !== selfPurchased?.strip)
      registerNewStripOffcuts(starterStrip, room, targetRoomIndex);
    for (const strip of purchased) registerNewStripOffcuts(strip, room, targetRoomIndex);
  }
  if (!reusedStrips.length) return null;
  const strips = rooms.flatMap((room) => {
    const origin = originFor(room);
    const position = (strip: BroadloomStrip) => {
      const box = getPolygonBoundingBox(asLocal(strip.rawPolygon, angle, origin));
      return isVertical ? [box.minX, box.minY] : [box.minY, box.minX];
    };
    return [...primary, ...newStrips, ...reusedStrips]
      .filter((strip) => strip.roomId === room.id)
      .sort((a, b) => {
        const pa = position(a), pb = position(b);
        return pa[0] - pb[0] || pa[1] - pb[1] || Number(a.isReusedFromOffcut) - Number(b.isReusedFromOffcut);
      });
  });
  const linearMeters = strips.reduce((sum, strip) => sum + (strip.isReusedFromOffcut ? 0 : strip.lengthMm / 1000), 0);
  const rawMeters = nesting.broadloomStrips.reduce((sum, strip) => sum + strip.lengthMm / 1000, 0);
  if (linearMeters > rawMeters + 0.001 || linearMeters >= maxMeters - 0.001) return null;

  for (const offcut of copiedOffcuts) {
    const remaining = stock.filter((item) => item.offcut.id === offcut.id)
      .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height);
    offcut.remainingAreaMm2 = remaining.reduce((sum, item) => sum + item.box.width * item.box.height, 0);
    offcut.leftoverPolygons = remaining.map((item) => asWorld(rect(item.box.minX, item.box.minY,
      item.box.maxX, item.box.maxY), angle, item.sourceOrigin));
    offcut.leftoverPolygon = offcut.leftoverPolygons[0];
  }
  const candidate: NestingResult = {
    ...nesting, broadloomStrips: strips, seams: getStripOverlapSeams(strips),
    offcutsAvailable: copiedOffcuts, offcutsReused: copiedOffcuts.filter((offcut) => offcut.subSlices?.length),
    discardedScraps: [], offcutLinks: links, totalLinearMeters: linearMeters,
  };
  if (validateNesting(rooms, candidate, 'broadloom', roll)) return null;
  return candidate;
}

/** Buy the leading length only, leaving room for a shorter earlier-room remnant. */
function purchaseStarter(
  room: RoomGeometry, floor: Polygon[], stock: Stock[], roll: BroadloomConfig,
  angle: number, origin: Point, isVertical: boolean, targetRoomIndex: number
): { strip: BroadloomStrip; remaining: Polygon[] } | null {
  if (floor.length !== 1) return null;
  const bounds = getPolygonBoundingBox(floor[0]);
  const alongMin = isVertical ? bounds.minY : bounds.minX;
  const alongSpan = isVertical ? bounds.height : bounds.width;
  const crossMin = isVertical ? bounds.minX : bounds.minY;
  const crossSpan = isVertical ? bounds.width : bounds.height;
  if (crossSpan > roll.rollWidth + 1) return null;
  const sourceLengths = stock.filter((item) => item.sourceRoomIndex < targetRoomIndex)
    .filter((item) => (isVertical ? item.box.width : item.box.height) + 1 >= crossSpan)
    .map((item) => isVertical ? item.box.height : item.box.width)
    .filter((length) => length > 1 && length < alongSpan - 1);
  if (!sourceLengths.length) return null;
  const starterSpan = alongSpan - Math.max(...sourceLengths);
  const allowance = Math.max(0, roll.cutAllowanceMm ?? 100);
  const length = starterSpan + allowance;
  if (length > roll.maxRollLength + 1) return null;
  const local = isVertical
    ? rect(crossMin, alongMin, crossMin + crossSpan, alongMin + starterSpan)
    : rect(alongMin, crossMin, alongMin + starterSpan, crossMin + crossSpan);
  const clippedLocal = polygonClipping.intersection(floor as any, local as any) as Polygon[];
  const usedArea = areaOf(clippedLocal);
  if (usedArea < 100) return null;
  const clippedWorld = clippedLocal.map((polygon) => asWorld(polygon, angle, origin));
  const midCross = crossMin + crossSpan / 2;
  const directionStart = rotatePoint(isVertical ? [midCross, alongMin] : [alongMin, midCross], angle, origin);
  const directionEnd = rotatePoint(isVertical ? [midCross, alongMin + starterSpan]
    : [alongMin + starterSpan, midCross], angle, origin);
  const strip: BroadloomStrip = {
    id: `STRIP-START-${room.id}`, name: `Roll mới đầu phòng ${(roll.rollWidth / 1000).toFixed(2)}`,
    roomId: room.id, index: 1, rawPolygon: asWorld(local, angle, origin),
    clippedPolygons: clippedWorld, rawAreaMm2: length * roll.rollWidth,
    usedAreaMm2: usedArea, lengthMm: length, widthMm: roll.rollWidth,
    usedWidthMm: crossSpan, isReusedFromOffcut: false, offcuts: [],
    center: getPolygonCentroid(clippedWorld[0]), directionStart, directionEnd,
  };
  const remaining = polygonClipping.difference(floor as any, local as any) as Polygon[];
  return { strip, remaining };
}

function purchaseSelfStarter(
  room: RoomGeometry, floor: Polygon[], roll: BroadloomConfig,
  angle: number, origin: Point, isVertical: boolean,
  choice: { edge: 'start' | 'end'; span: number; crossMin: number }, sourceBox: BoundingBox
): { strip: BroadloomStrip; remaining: Polygon[] } | null {
  if (!floor.length) return null;
  const alongMin = isVertical ? sourceBox.minY : sourceBox.minX;
  const alongMax = isVertical ? sourceBox.maxY : sourceBox.maxX;
  const crossMin = choice.crossMin;
  const crossSpan = roll.rollWidth;
  const from = choice.edge === 'start' ? alongMin : alongMax - choice.span;
  const to = from + choice.span;
  const length = choice.span + Math.max(0, roll.cutAllowanceMm ?? 100);
  if (crossSpan > roll.rollWidth + 1 || length > roll.maxRollLength + 1) return null;
  const local = isVertical
    ? rect(crossMin, from, crossMin + crossSpan, to)
    : rect(from, crossMin, to, crossMin + crossSpan);
  const installed = polygonClipping.intersection(floor as any, local as any) as Polygon[];
  const usedArea = areaOf(installed);
  if (usedArea < 100) return null;
  const clipped = installed.map((polygon) => asWorld(polygon, angle, origin));
  const midCross = crossMin + crossSpan / 2;
  const strip: BroadloomStrip = {
    id: `STRIP-SELF-${room.id}`, name: `Roll mới ${(roll.rollWidth / 1000).toFixed(2)}m`,
    roomId: room.id, index: 1, rawPolygon: asWorld(local, angle, origin),
    clippedPolygons: clipped, rawAreaMm2: length * roll.rollWidth,
    usedAreaMm2: usedArea, lengthMm: length, widthMm: roll.rollWidth,
    usedWidthMm: crossSpan, isReusedFromOffcut: false, offcuts: [],
    center: getPolygonCentroid(clipped[0]),
    directionStart: rotatePoint(isVertical ? [midCross, from] : [from, midCross], angle, origin),
    directionEnd: rotatePoint(isVertical ? [midCross, to] : [to, midCross], angle, origin),
  };
  return { strip, remaining: polygonClipping.difference(floor as any, local as any) as Polygon[] };
}

function findBestPlacement(
  stock: Stock[], uncovered: Polygon[], isVertical: boolean, minSide: number,
  targetRoomIndex: number, requiredArea?: number, allowThinEdges = false
): Placement | null {
  let best: Placement | null = null;
  const uncoveredBoxes = uncovered.map(getPolygonBoundingBox);
  const rectangularUncovered = uncovered.every((polygon, index) =>
    isAxisRectangle(polygon, uncoveredBoxes[index]));
  for (let stockIndex = 0; stockIndex < stock.length; stockIndex++) {
    if (stock[stockIndex].sourceRoomIndex > targetRoomIndex ||
        (requiredArea !== undefined && stock[stockIndex].sourceRoomIndex === targetRoomIndex)) continue;
    const sourceBox = stock[stockIndex].box;
    for (let targetIndex = 0; targetIndex < uncovered.length; targetIndex++) {
      const targetPoly = uncovered[targetIndex];
      const targetBox = uncoveredBoxes[targetIndex];
      // Keep the physical cut above the minimum size even when only a thin
      // boundary sliver is installed. The excess stays outside the floor.
      const pieceWidth = Math.min(sourceBox.width,
        allowThinEdges ? Math.max(targetBox.width, minSide) : targetBox.width);
      const pieceHeight = Math.min(sourceBox.height,
        allowThinEdges ? Math.max(targetBox.height, minSide) : targetBox.height);
      if (Math.min(pieceWidth, pieceHeight) < minSide) continue;
      const source = rect(sourceBox.minX, sourceBox.minY,
        sourceBox.minX + pieceWidth, sourceBox.minY + pieceHeight);
      const anchors: Point[] = [
        [targetBox.minX, targetBox.minY], [targetBox.maxX - pieceWidth, targetBox.minY],
        [targetBox.minX, targetBox.maxY - pieceHeight],
        [targetBox.maxX - pieceWidth, targetBox.maxY - pieceHeight],
      ];
      for (const ring of targetPoly) for (const [x, y] of ring) {
        anchors.push([x, y], [x - pieceWidth, y], [x, y - pieceHeight],
          [x - pieceWidth, y - pieceHeight]);
      }
      const seen = new Set<string>();
      for (const [x, y] of anchors) {
        const key = `${Math.round(x)},${Math.round(y)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const possibleArea = uncoveredBoxes.reduce((sum, box) => sum +
          Math.max(0, Math.min(x + pieceWidth, box.maxX) - Math.max(x, box.minX)) *
          Math.max(0, Math.min(y + pieceHeight, box.maxY) - Math.max(y, box.minY)), 0);
        const narrowFloorEdge = allowThinEdges &&
          (targetBox.width < minSide || targetBox.height < minSide);
        if (possibleArea < (narrowFloorEdge ? 10_000 : Math.max(10_000, pieceWidth * pieceHeight * 0.4)) ||
            (requiredArea !== undefined && possibleArea < requiredArea - Math.max(100, requiredArea * 0.00001)) ||
            (best && possibleArea + (isVertical ? pieceHeight : pieceWidth) * 0.001 <
              best.area + (isVertical ? best.pieceHeight : best.pieceWidth) * 0.001 - 5_000))
          continue;
        const placed = rect(x, y, x + pieceWidth, y + pieceHeight);
        try {
          const target = rectangularUncovered
            ? uncoveredBoxes.flatMap((box) => {
              const lowX = Math.max(x, box.minX), highX = Math.min(x + pieceWidth, box.maxX);
              const lowY = Math.max(y, box.minY), highY = Math.min(y + pieceHeight, box.maxY);
              return highX > lowX && highY > lowY ? [rect(lowX, lowY, highX, highY)] : [];
            })
            : polygonClipping.intersection(uncovered as any, placed as any) as Polygon[];
          const area = rectangularUncovered ? possibleArea : areaOf(target);
          if (area < (narrowFloorEdge ? 10_000 : Math.max(10_000, pieceWidth * pieceHeight * 0.4))) continue;
          if (requiredArea !== undefined && area < requiredArea - Math.max(100, requiredArea * 0.00001)) continue;
          // Prefer covering real floor; tie-break in favor of the longer piece along the pile.
          const score = area + (isVertical ? pieceHeight : pieceWidth) * 0.001;
          const oldScore = best ? best.area + (isVertical ? best.pieceHeight : best.pieceWidth) * 0.001 : -1;
          const stockLength = isVertical ? sourceBox.height : sourceBox.width;
          const oldStockBox = best ? stock[best.stockIndex].box : null;
          const oldStockLength = oldStockBox ? (isVertical ? oldStockBox.height : oldStockBox.width) : Infinity;
          // Equally useful cuts should consume the shorter stock first. This keeps
          // a 7.8 m remnant in play instead of spending only the long remnant.
          const oldStock = best ? stock[best.stockIndex] : null;
          const sameSourceRoll = oldStock &&
            oldStock.offcut.id !== stock[stockIndex].offcut.id &&
            oldStock.offcut.sourceTileId === stock[stockIndex].offcut.sourceTileId &&
            Math.abs((isVertical ? oldStock.box.width : oldStock.box.height) -
              (isVertical ? sourceBox.width : sourceBox.height)) < 1;
          const equivalentArea = sameSourceRoll ? 5_000 : 0.01;
          const useShorterStock = sameSourceRoll &&
            Math.abs(score - oldScore) <= equivalentArea && stockLength < oldStockLength - 1;
          if (score > oldScore + equivalentArea || useShorterStock)
            best = { stockIndex, target, source, area, placed, pieceWidth, pieceHeight };
        } catch { /* Invalid intersection is not a usable placement. */ }
      }
    }
  }
  return best;
}

function purchaseRemaining(
  room: RoomGeometry, floor: Polygon[], roll: BroadloomConfig,
  angle: number, origin: Point, isVertical: boolean
): BroadloomStrip[] | null {
  const purchased: BroadloomStrip[] = [];
  let remaining = floor;
  const allowance = Math.max(0, roll.cutAllowanceMm ?? 100);
  const maxSpan = Math.max(1, roll.maxRollLength - allowance);
  const crossIndex = isVertical ? 0 : 1;
  const initial = [...remaining];
  for (const region of initial) {
    const bounds = getPolygonBoundingBox(region);
    const values = Array.from(new Set(region.flat().map((point) => point[crossIndex])))
      .sort((a, b) => a - b);
    if (values.length < 2) return null;
    for (let i = 0; i < values.length - 1; i++) {
      const lower = values[i], upper = values[i + 1];
      const crossSteps = Math.ceil((upper - lower) / roll.rollWidth);
      for (let step = 0; step < crossSteps; step++) {
        const crossMin = lower + step * roll.rollWidth;
        const crossMax = Math.min(upper, crossMin + roll.rollWidth);
        const slab = isVertical ? rect(crossMin, bounds.minY, crossMax, bounds.maxY)
          : rect(bounds.minX, crossMin, bounds.maxX, crossMax);
        const intersections = polygonClipping.intersection(remaining as any, slab as any) as Polygon[];
        for (const section of intersections) {
          const sectionBox = getPolygonBoundingBox(section);
          const alongMin = isVertical ? sectionBox.minY : sectionBox.minX;
          const alongMax = isVertical ? sectionBox.maxY : sectionBox.maxX;
          const count = Math.ceil((alongMax - alongMin) / maxSpan);
          for (let part = 0; part < count; part++) {
            const from = alongMin + part * (alongMax - alongMin) / count;
            const to = alongMin + (part + 1) * (alongMax - alongMin) / count;
            const local = isVertical ? rect(crossMin, from, crossMax, to)
              : rect(from, crossMin, to, crossMax);
            const clippedLocal = polygonClipping.intersection(remaining as any, local as any) as Polygon[];
            const usedArea = areaOf(clippedLocal);
            if (usedArea < 100) continue;
            const raw = asWorld(local, angle, origin);
            const clipped = clippedLocal.map((polygon) => asWorld(polygon, angle, origin));
            const center = getPolygonCentroid(clipped[0]);
            const length = to - from + allowance;
            const id = `STRIP-NEW-${room.id}-${purchased.length + 1}`;
            purchased.push({
              id, name: `Roll mới ${(roll.rollWidth / 1000).toFixed(2)} - ${purchased.length + 1}`,
              roomId: room.id, index: purchased.length + 1, rawPolygon: raw,
              clippedPolygons: clipped, rawAreaMm2: length * roll.rollWidth,
              usedAreaMm2: usedArea, lengthMm: length, widthMm: roll.rollWidth,
              usedWidthMm: crossMax - crossMin, isReusedFromOffcut: false,
              offcuts: [], center,
              directionStart: rotatePoint(isVertical ? [(crossMin + crossMax) / 2, from]
                : [from, (crossMin + crossMax) / 2], angle, origin),
              directionEnd: rotatePoint(isVertical ? [(crossMin + crossMax) / 2, to]
                : [to, (crossMin + crossMax) / 2], angle, origin),
            });
            remaining = polygonClipping.difference(remaining as any, local as any) as Polygon[];
          }
        }
      }
    }
  }
  return areaOf(remaining) < 100 ? purchased : null;
}
