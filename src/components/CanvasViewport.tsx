import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import {
  RoomGeometry,
  NestingResult,
  NestingTile,
  Point,
  TileConfig,
  ResolvedCorridorZone,
} from '../types';
import {
  CanvasRenderer,
  RenderLayersConfig,
} from '../services/canvasRenderer';
import {
  Maximize2,
  ZoomIn,
  ZoomOut,
  Eye,
  Sliders,
  ArrowUpDown,
  Move,
  GitFork,
} from 'lucide-react';
import { isPointInRing, findNearestVertex, getPolygonBoundingBox } from '../services/geometryMath';
import { getBroadloomCutPolygon } from '../services/broadloomGeometry';

type HoveredItem = NestingTile & {
  broadloom?: { kind: 'purchased' | 'reused' | 'source_slice'; widthMm: number; lengthMm: number };
};

interface CanvasViewportProps {
  rooms: RoomGeometry[];
  nesting: NestingResult | null;
  originPoints: Record<string, Point>;
  onSetOriginPoint: (roomId: string, pt: Point) => void;
  isPickingOrigin: boolean;
  setIsPickingOrigin: (val: boolean) => void;
  flipY: boolean;
  setFlipY: (flip: boolean) => void;
  tileConfig: TileConfig;
  zones?: ResolvedCorridorZone[];
  selectedZoneId?: string | null;
  onSelectZone?: (id: string) => void;
}

export const CanvasViewport: React.FC<CanvasViewportProps> = ({
  rooms,
  nesting,
  originPoints,
  onSetOriginPoint,
  isPickingOrigin,
  setIsPickingOrigin,
  flipY,
  setFlipY,
  tileConfig,
  zones,
  selectedZoneId,
  onSelectZone,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const renderSceneRef = useRef<() => void>(() => {});

  const [mousePosWorld, setMousePosWorld] = useState<Point>([0, 0]);
  const [hoveredTile, setHoveredTile] = useState<HoveredItem | null>(null);

  const [isPanning, setIsPanning] = useState(false);
  const [draggingRoomId, setDraggingRoomId] = useState<string | null>(null);
  const isDraggingDatum = draggingRoomId !== null;
  const lastMousePos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragOrigin = useRef<{ roomId: string; point: Point } | null>(null);
  const pendingMousePos = useRef<Point>([0, 0]);
  const mouseFrame = useRef<number | null>(null);
  const renderFrame = useRef<number | null>(null);

  useEffect(() => () => {
    if (mouseFrame.current !== null) cancelAnimationFrame(mouseFrame.current);
    if (renderFrame.current !== null) cancelAnimationFrame(renderFrame.current);
  }, []);

  const [layers, setLayers] = useState<RenderLayersConfig>({
    showRoomBoundary: true,
    showHoles: true,
    showFullTiles: true,
    showCutTiles: true,
    showReusedTiles: true,
    showOutsideTileGhost: true,
    showSeams: true,
    showTileIds: true,
    showGrainDirection: true,
    showGrid: true,
    showDimensions: true,
    showOffcutLinks: true,
    alwaysShowAllLinks: false,
  });

  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const tileHitTargets = useMemo(() => (nesting?.tiles ?? []).map((tile) =>
    ({ tile, box: getPolygonBoundingBox(tile.rawPolygon) })), [nesting?.tiles]);
  const stripHitTargets = useMemo(() => (nesting?.broadloomStrips ?? []).map((strip) =>
    ({ strip, box: getPolygonBoundingBox(strip.rawPolygon) })), [nesting?.broadloomStrips]);

  // Initialize Canvas Renderer
  useEffect(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    rendererRef.current = new CanvasRenderer(ctx);

    const handleResize = () => {
      if (!canvasRef.current || !rendererRef.current) return;
      const rect = canvasRef.current.parentElement?.getBoundingClientRect();
      if (rect) {
        rendererRef.current.resize(rect.width, rect.height);
        renderSceneRef.current();
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const renderScene = useCallback(() => {
    if (!rendererRef.current) return;
    rendererRef.current.originPoints = dragOrigin.current
      ? { ...originPoints, [dragOrigin.current.roomId]: dragOrigin.current.point }
      : originPoints;
    rendererRef.current.activeOriginRoomId = draggingRoomId;
    rendererRef.current.hoveredTile = hoveredTile;
    rendererRef.current.isDraggingOrigin = isDraggingDatum;
    rendererRef.current.zones = zones;
    rendererRef.current.selectedZoneId = selectedZoneId ?? null;
    rendererRef.current.render(rooms, nesting, layers, tileConfig);
  }, [rooms, nesting, layers, originPoints, hoveredTile, isDraggingDatum, draggingRoomId, tileConfig, zones, selectedZoneId]);

  const getSceneBounds = useCallback(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const room of rooms) {
      minX = Math.min(minX, room.bbox.minX);
      minY = Math.min(minY, room.bbox.minY);
      maxX = Math.max(maxX, room.bbox.maxX);
      maxY = Math.max(maxY, room.bbox.maxY);
    }
    if (layers.showOutsideTileGhost !== false) {
      for (const strip of nesting?.broadloomStrips ?? []) {
        const box = getPolygonBoundingBox(getBroadloomCutPolygon(strip));
        minX = Math.min(minX, box.minX);
        minY = Math.min(minY, box.minY);
        maxX = Math.max(maxX, box.maxX);
        maxY = Math.max(maxY, box.maxY);
      }
    }
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }, [rooms, nesting?.broadloomStrips, layers.showOutsideTileGhost]);

  // Synchronize CAD axis orientation after the renderer is initialized.
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.flipY = flipY;
      renderScene();
    }
  }, [flipY, renderScene]);

  useEffect(() => {
    renderSceneRef.current = renderScene;
  }, [renderScene]);

  const scheduleRender = useCallback(() => {
    if (renderFrame.current !== null) return;
    renderFrame.current = requestAnimationFrame(() => {
      renderFrame.current = null;
      renderSceneRef.current();
    });
  }, []);

  useEffect(() => {
    renderScene();
  }, [renderScene]);

  // Include full broadloom cuts, so dashed carpet outside the floor remains visible.
  useEffect(() => {
    if (rooms.length > 0 && rendererRef.current && !isDraggingDatum) {
      rendererRef.current.fitToScreen(getSceneBounds());
      renderSceneRef.current();
    }
  }, [rooms, getSceneBounds, isDraggingDatum]);

  // Collect all vertices for corner snapping
  const getAllVertices = useCallback((roomId?: string): Point[] => {
    const list: Point[] = [];
    for (const r of rooms) {
      if (roomId && r.id !== roomId) continue;
      list.push(...r.boundary);
      for (const h of r.holes) {
        list.push(...h);
      }
    }
    return list;
  }, [rooms]);

  // Mouse Handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!rendererRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const worldPt = rendererRef.current.screenToWorld(sx, sy);

    // 1. Check if clicking on or near Datum Tile Origin handle
    const nearestOrigin = rooms.map((room) => {
      const point = originPoints[room.id];
      const screen = point ? rendererRef.current!.worldToScreen(point[0], point[1]) : [Infinity, Infinity];
      return { room, distance: Math.hypot(sx - screen[0], sy - screen[1]) };
    }).sort((a, b) => a.distance - b.distance)[0];
    const targetRoom = nearestOrigin?.distance <= 24 ? nearestOrigin.room
      : isPickingOrigin ? rooms.find((room) => isPointInRing(worldPt, room.boundary)
        && !room.holes.some((hole) => isPointInRing(worldPt, hole))) : undefined;

    if (targetRoom) {
      setDraggingRoomId(targetRoom.id);
      if (isPickingOrigin) {
        // Snap to nearest corner if close
        const allVerts = getAllVertices(targetRoom.id);
        const snapRadiusWorld = 25 / rendererRef.current.viewport.zoom;
        const nearest = findNearestVertex(worldPt, allVerts, snapRadiusWorld);
        const targetPt = nearest ? nearest.vertex : worldPt;
        onSetOriginPoint(targetRoom.id, targetPt);
        setIsPickingOrigin(false);
      }
      return;
    }

    if (e.button === 0 && zones?.length) {
      const zone = zones.find(z => z.polygons.some(p => isPointInRing(worldPt, p[0]) &&
        !p.slice(1).some(hole => isPointInRing(worldPt, hole))));
      if (zone) onSelectZone?.(zone.id);
    }
    // 2. Start Panning
    if (e.button === 0 || e.button === 1) {
      setIsPanning(true);
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!rendererRef.current || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = rendererRef.current.screenToWorld(sx, sy);
    pendingMousePos.current = world;
    if (mouseFrame.current === null) {
      mouseFrame.current = requestAnimationFrame(() => {
        mouseFrame.current = null;
        setMousePosWorld(pendingMousePos.current);
      });
    }

    // Case A: Dragging Datum Tile with Magnetic Corner Snapping!
    if (isDraggingDatum) {
      const allVerts = getAllVertices(draggingRoomId!);
      const snapRadiusWorld = 28 / rendererRef.current.viewport.zoom;
      const nearest = findNearestVertex(world, allVerts, snapRadiusWorld);

      rendererRef.current.snappedVertex = nearest?.vertex ?? null;
      dragOrigin.current = { roomId: draggingRoomId!, point: nearest?.vertex ?? world };
      scheduleRender();
      return;
    }

    // Case B: Panning Viewport
    if (isPanning) {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      rendererRef.current.viewport.panX += dx;
      rendererRef.current.viewport.panY += dy;
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      scheduleRender();
      return;
    }

    // Case C: Normal Hover - Check snap proximity when picking origin
    if (isPickingOrigin) {
      const hoveredRoom = rooms.find((room) => isPointInRing(world, room.boundary)
        && !room.holes.some((hole) => isPointInRing(world, hole)));
      const allVerts = getAllVertices(hoveredRoom?.id);
      const snapRadiusWorld = 28 / rendererRef.current.viewport.zoom;
      const nearest = findNearestVertex(world, allVerts, snapRadiusWorld);
      rendererRef.current.snappedVertex = nearest ? nearest.vertex : null;
      scheduleRender();
      return;
    }

    // Fast Hover detection for tiles with bounding-box pre-filtering
    if (tileHitTargets.length > 0) {
      let found: NestingTile | null = null;
      for (const { tile, box: b } of tileHitTargets) {
        if (world[0] < b.minX || world[0] > b.maxX || world[1] < b.minY || world[1] > b.maxY) {
          continue;
        }
        for (const poly of tile.clippedPolygons) {
          if (poly[0] && isPointInRing(world, poly[0])) {
            found = tile;
            break;
          }
        }
        if (!found && tile.offcuts) {
          for (const off of tile.offcuts) {
            if (off.polygon[0] && isPointInRing(world, off.polygon[0])) {
              found = tile;
              break;
            }
          }
        }
        if (found) break;
      }

      if (hoveredTile?.id !== found?.id) {
        setHoveredTile(found);
      }
    } else if (nesting && stripHitTargets.length > 0) {
      // Broadloom Hover detection: strips & remnant slices
      let foundTile: HoveredItem | null = null;
      for (const { strip, box: b } of stripHitTargets) {
        if (world[0] < b.minX || world[0] > b.maxX || world[1] < b.minY || world[1] > b.maxY) continue;
        for (const poly of strip.clippedPolygons) {
          if (poly[0] && isPointInRing(world, poly[0])) {
            const grainAngle = Math.round(Math.atan2(
              strip.directionEnd[1] - strip.directionStart[1],
              strip.directionEnd[0] - strip.directionStart[0]) * 180 / Math.PI);
            foundTile = {
              id: strip.id,
              originalIndex: strip.index,
              row: 0,
              col: strip.index,
              rawPolygon: getBroadloomCutPolygon(strip),
              clippedPolygons: strip.clippedPolygons,
              status: strip.isReusedFromOffcut ? 'offcut_reused'
                : strip.usedAreaMm2 < strip.rawAreaMm2 * 0.998 ? 'cut' : 'full',
              areaMm2: strip.usedAreaMm2,
              rawAreaMm2: strip.rawAreaMm2,
              coverageRatio: strip.rawAreaMm2 > 0 ? strip.usedAreaMm2 / strip.rawAreaMm2 : 1,
              rotationDeg: 0,
              grainAngle,
              reusedFromId: strip.reusedFromId,
              sourceSliceCode: strip.sourceSliceCode,
              matchingCode: strip.matchingCode,
              donorTargetCodes: nesting.offcutLinks.filter((link) => link.sourceTileId === strip.id)
                .map((link) => link.targetCode).filter((code): code is string => Boolean(code)),
              offcuts: strip.offcuts,
              center: strip.center,
              broadloom: { kind: strip.isReusedFromOffcut ? 'reused' : 'purchased',
                widthMm: strip.widthMm, lengthMm: strip.lengthMm },
            };
            break;
          }
        }
        if (foundTile) break;
      }

      if (!foundTile && nesting.offcutsReused) {
        for (const rem of nesting.offcutsReused) {
          if (rem.subSlices) {
            for (const sl of rem.subSlices) {
              if (sl.polygon[0] && isPointInRing(world, sl.polygon[0])) {
                foundTile = {
                  id: sl.targetStripId,
                  originalIndex: sl.index,
                  row: 0,
                  col: sl.index,
                  rawPolygon: sl.polygon,
                  clippedPolygons: [sl.polygon],
                  status: 'cut',
                  areaMm2: sl.widthMm * sl.lengthMm,
                  rawAreaMm2: sl.widthMm * sl.lengthMm,
                  coverageRatio: 1,
                  rotationDeg: 0,
                  grainAngle: 0,
                  reusedFromId: rem.id,
                  sourceSliceCode: sl.code,
                  matchingCode: sl.targetCode,
                  donorTargetIds: [sl.targetStripId],
                  offcuts: [],
                  center: sl.center,
                  broadloom: { kind: 'source_slice', widthMm: sl.widthMm, lengthMm: sl.lengthMm },
                };
                break;
              }
            }
          }
          if (foundTile) break;
        }
      }

      if (hoveredTile?.id !== foundTile?.id) {
        setHoveredTile(foundTile);
      }
    } else {
      if (hoveredTile !== null) {
        setHoveredTile(null);
      }
    }
  };

  const handleMouseUp = () => {
    if (isDraggingDatum) {
      const completed = dragOrigin.current;
      dragOrigin.current = null;
      setDraggingRoomId(null);
      if (completed) onSetOriginPoint(completed.roomId, completed.point);
      if (rendererRef.current) {
        rendererRef.current.snappedVertex = null;
        renderScene();
      }
    }
    setIsPanning(false);
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!rendererRef.current || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    const oldZoom = rendererRef.current.viewport.zoom;
    const newZoom = Math.min(Math.max(oldZoom * zoomFactor, 0.005), 5.0);

    const wx = (sx - rendererRef.current.viewport.panX) / oldZoom;
    const wy = rendererRef.current.flipY
      ? (rendererRef.current.viewport.panY - sy) / oldZoom
      : (sy - rendererRef.current.viewport.panY) / oldZoom;

    rendererRef.current.viewport.panX = sx - wx * newZoom;
    rendererRef.current.viewport.panY = rendererRef.current.flipY
      ? sy + wy * newZoom
      : sy - wy * newZoom;
    rendererRef.current.viewport.zoom = newZoom;

    scheduleRender();
  };

  const handleFitScreen = () => {
    if (rooms.length > 0 && rendererRef.current) {
      rendererRef.current.fitToScreen(getSceneBounds());
      renderScene();
    }
  };

  const handleZoom = (factor: number) => {
    if (!rendererRef.current) return;
    const cx = rendererRef.current.width / 2;
    const cy = rendererRef.current.height / 2;

    const oldZoom = rendererRef.current.viewport.zoom;
    const newZoom = Math.min(Math.max(oldZoom * factor, 0.005), 5.0);

    const wx = (cx - rendererRef.current.viewport.panX) / oldZoom;
    const wy = rendererRef.current.flipY
      ? (rendererRef.current.viewport.panY - cy) / oldZoom
      : (cy - rendererRef.current.viewport.panY) / oldZoom;

    rendererRef.current.viewport.panX = cx - wx * newZoom;
    rendererRef.current.viewport.panY = rendererRef.current.flipY
      ? cy + wy * newZoom
      : cy - wy * newZoom;
    rendererRef.current.viewport.zoom = newZoom;

    renderScene();
  };

  return (
    <main className="flex-1 relative h-full bg-slate-950 overflow-hidden select-none">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        className={`w-full h-full block ${
          isDraggingDatum
            ? 'cursor-move'
            : isPickingOrigin
            ? 'cursor-crosshair'
            : isPanning
            ? 'cursor-grabbing'
            : 'cursor-default'
        }`}
      />

      {/* Floating Viewport Toolbar */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-md p-1 rounded-lg border border-slate-800 shadow-xl z-10 text-slate-300 text-xs">
        {/* Flip Y Axis Toggle */}
        <button
          onClick={() => setFlipY(!flipY)}
          className={`p-1.5 rounded transition flex items-center gap-1 ${
            flipY ? 'bg-cyan-600/30 border border-cyan-500 text-cyan-300' : 'hover:bg-slate-800 hover:text-white'
          }`}
          title="Đảo chiều trục Y (Chuẩn CAD: Y hướng lên)"
        >
          <ArrowUpDown size={15} />
          <span className="text-[10px] font-mono hidden sm:inline">{flipY ? 'Y-Up' : 'Y-Down'}</span>
        </button>

        <div className="w-[1px] h-4 bg-slate-700 mx-0.5"></div>

        <button
          onClick={() => setIsPickingOrigin(!isPickingOrigin)}
          className={`p-1.5 rounded transition flex items-center gap-1 ${
            isPickingOrigin ? 'bg-emerald-600 text-white animate-pulse' : 'hover:bg-slate-800 hover:text-white'
          }`}
          title="Bật kéo mốc / bắt điểm góc phòng"
        >
          <Move size={15} />
          <span className="text-[10px] hidden sm:inline">Bắt điểm</span>
        </button>

        <div className="w-[1px] h-4 bg-slate-700 mx-0.5"></div>

        <button
          onClick={handleFitScreen}
          className="p-1.5 hover:bg-slate-800 hover:text-white rounded transition"
          title="Canh giữa màn hình (Fit to Screen)"
        >
          <Maximize2 size={16} />
        </button>
        <button
          onClick={() => handleZoom(1.2)}
          className="p-1.5 hover:bg-slate-800 hover:text-white rounded transition"
          title="Phóng to"
        >
          <ZoomIn size={16} />
        </button>
        <button
          onClick={() => handleZoom(0.8)}
          className="p-1.5 hover:bg-slate-800 hover:text-white rounded transition"
          title="Thu nhỏ"
        >
          <ZoomOut size={16} />
        </button>

        <div className="w-[1px] h-4 bg-slate-700 mx-0.5"></div>

        {/* Toggle Luôn hiện tất cả đường dẫn (Dành cho thảm cuộn số lượng ít) */}
        <button
          onClick={() =>
            setLayers((prev) => ({
              ...prev,
              alwaysShowAllLinks: !prev.alwaysShowAllLinks,
            }))
          }
          className={`p-1.5 rounded transition flex items-center gap-1.5 ${
            layers.alwaysShowAllLinks
              ? 'bg-purple-600/30 border border-purple-500 text-purple-300 shadow-sm'
              : 'hover:bg-slate-800 text-slate-400 hover:text-white'
          }`}
          title="Luôn hiện tất cả đường dẫn (Dành cho thảm cuộn số lượng ít)"
        >
          <GitFork size={15} className={layers.alwaysShowAllLinks ? 'text-purple-400' : ''} />
          <span className="text-[10px] hidden lg:inline">
            {layers.alwaysShowAllLinks ? 'Hiện tất cả đường dẫn' : 'Ẩn đường dẫn (Smart Hover)'}
          </span>
        </button>

        <div className="w-[1px] h-4 bg-slate-700 mx-0.5"></div>

        <button
          onClick={() => setShowLayerMenu(!showLayerMenu)}
          className={`p-1.5 rounded transition flex items-center gap-1 ${
            showLayerMenu ? 'bg-blue-600 text-white' : 'hover:bg-slate-800 hover:text-white'
          }`}
          title="Bật / Tắt Layer hiển thị"
        >
          <Eye size={16} />
          <span className="text-[11px] font-medium hidden sm:inline">Layers</span>
        </button>
      </div>

      {/* Layer Visibility Menu Dropdown */}
      {showLayerMenu && (
        <div className="absolute top-14 right-3 bg-slate-900/95 backdrop-blur-md p-3 rounded-lg border border-slate-800 shadow-2xl z-20 w-64 text-xs text-slate-300 space-y-2">
          <div className="font-semibold text-white text-[11px] border-b border-slate-800 pb-1 flex items-center justify-between">
            <span>Hiển thị Layer</span>
            <Sliders size={12} className="text-blue-400" />
          </div>

          <div className="space-y-1.5">
            {[
              { key: 'showRoomBoundary', label: 'Đường bao phòng' },
              { key: 'showHoles', label: 'Cột / Hộp kỹ thuật' },
              { key: 'showFullTiles', label: 'Tấm nguyên (Full Tile)' },
              { key: 'showCutTiles', label: 'Tấm cắt biên (Cut Tile)' },
              { key: 'showOutsideTileGhost', label: 'Hiện nguyên viên biên (Nét đứt ngoài phòng)' },
              { key: 'showReusedTiles', label: 'Tấm ghép bù (Offcut Reused)' },
              { key: 'showOffcutLinks', label: 'Đường nối di chuyển (Smart Trace)' },
              { key: 'alwaysShowAllLinks', label: 'Luôn hiện tất cả đường dẫn (Thảm ít)' },
              { key: 'showSeams', label: 'Đường tim mối nối (Seams)' },
              { key: 'showTileIds', label: 'Mã số hiệu tấm' },
              { key: 'showGrainDirection', label: 'Mũi tên chiều sợi (Grain)' },
              { key: 'showDimensions', label: 'Kích thước phòng' },
              { key: 'showGrid', label: 'Lưới toạ độ CAD' },
            ].map(({ key, label }) => (
              <label
                key={key}
                className="flex items-center justify-between cursor-pointer hover:bg-slate-800/60 p-1 rounded"
              >
                <span className="text-[11px]">{label}</span>
                <input
                  type="checkbox"
                  checked={(layers as any)[key]}
                  onChange={(e) =>
                    setLayers((prev) => ({ ...prev, [key]: e.target.checked }))
                  }
                  className="rounded text-blue-600 focus:ring-0"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Floating Bottom Legend & Coordinates */}
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between pointer-events-none">
        {/* Visual Legend */}
        <div className="flex items-center gap-3 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-800 text-[11px] shadow-lg pointer-events-auto">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-blue-500/40 border border-blue-400"></span>
            <span className="text-slate-300">Tấm nguyên</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-amber-500/40 border border-amber-400"></span>
            <span className="text-slate-300">Tấm cắt</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-amber-500/10 border border-amber-400 border-dashed"></span>
            <span className="text-slate-300">Biên ngoài (Nét đứt)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-purple-500/40 border border-purple-400 border-dashed"></span>
            <span className="text-slate-300">Ghép bù Offcut</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 bg-purple-400 border-b border-purple-400 border-dashed"></span>
            <span className="text-slate-300">Đường nối Offcut</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-red-500 border-b border-red-500 border-dashed"></span>
            <span className="text-slate-300">Mối nối Seam</span>
          </div>
        </div>

        {/* Coordinates */}
        <div className="bg-slate-900/90 backdrop-blur-md px-2.5 py-1 rounded-lg border border-slate-800 text-[10px] font-mono text-slate-400 shadow">
          X: {Math.round(mousePosWorld[0])} mm | Y: {Math.round(mousePosWorld[1])} mm | {flipY ? 'CAD Y-Up' : 'Canvas Y-Down'}
        </div>
      </div>

      {/* Neo bảng thông tin Tile / Ghép bù Offcut cố định góc trái trên bản vẽ */}
      {hoveredTile && (() => {
        const tileCutBBox = getPolygonBoundingBox(hoveredTile.clippedPolygons[0] || hoveredTile.rawPolygon);
        const isCutOrReused = hoveredTile.status === 'cut' || hoveredTile.status === 'offcut_reused';
        const meters = (mm: number) => String(Number((mm / 1000).toFixed(2)));
        const dimText = hoveredTile.broadloom
          ? `${meters(hoveredTile.broadloom.widthMm)} × ${meters(hoveredTile.broadloom.lengthMm)} m`
          : !isCutOrReused
          ? `${tileConfig.width} × ${tileConfig.height} mm`
          : `${Math.round(tileCutBBox.width)} × ${Math.round(tileCutBBox.height)} mm`;

        const isDonor = Boolean(hoveredTile.donorTargetCodes?.length);

        return (
          <div
            className={`absolute top-3 left-3 z-30 bg-slate-900/95 backdrop-blur-md rounded-xl p-3 shadow-2xl text-xs text-slate-200 pointer-events-none space-y-2 min-w-64 max-w-72 border transition-all duration-150 ${
              hoveredTile.status === 'offcut_reused'
                ? 'border-purple-500/60 shadow-purple-950/40'
                : isDonor
                ? 'border-amber-400/60 shadow-amber-950/40'
                : hoveredTile.status === 'cut'
                ? 'border-orange-500/60 shadow-orange-950/40'
                : 'border-blue-500/50 shadow-blue-950/40'
            }`}
          >
            <div className="font-bold text-amber-300 flex items-center justify-between gap-3 border-b border-slate-800 pb-1.5">
              <span className="flex items-center gap-1">
                {hoveredTile.matchingCode ? `[${hoveredTile.matchingCode}] ` : ''}
                <span className="text-white">{hoveredTile.id}</span>
              </span>
              <span
                className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                  hoveredTile.status === 'offcut_reused'
                    ? 'bg-purple-500/25 text-purple-300 border border-purple-500/40'
                    : isDonor
                    ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40'
                    : hoveredTile.status === 'cut'
                    ? 'bg-orange-500/25 text-orange-300 border border-orange-500/40'
                    : 'bg-blue-500/25 text-blue-300 border border-blue-500/40'
                }`}
              >
                {hoveredTile.broadloom
                  ? hoveredTile.broadloom.kind === 'purchased' ? 'Dải thảm cuộn mới'
                    : hoveredTile.broadloom.kind === 'reused' ? 'Ghép bù Offcut' : 'Mảnh cắt nguồn'
                  : hoveredTile.status === 'offcut_reused'
                  ? 'Ghép bù Offcut'
                  : isDonor
                  ? 'Phôi gốc (Donor)'
                  : hoveredTile.status === 'cut'
                  ? 'Tấm cắt biên'
                  : 'Tấm nguyên 100%'}
              </span>
            </div>

            <div className="text-[11px] text-slate-300 space-y-1">
              <div>
                <span className="text-slate-400">{hoveredTile.broadloom ? 'Loại vật tư: ' : 'Loại tấm: '}</span>
                <span className="font-medium text-white">
                  {hoveredTile.broadloom
                    ? hoveredTile.broadloom.kind === 'purchased' ? 'Thảm cuộn cắt từ khổ chuẩn'
                      : hoveredTile.broadloom.kind === 'reused' ? 'Mảnh thừa phủ sàn'
                        : 'Mảnh cắt từ thảm dư'
                    : hoveredTile.status === 'offcut_reused'
                    ? 'Tấm ghép bù từ Offcut'
                    : isDonor
                    ? 'Tấm phôi cắt (Cung cấp mảnh thừa)'
                    : hoveredTile.status === 'cut'
                    ? 'Tấm cắt biên tường'
                    : 'Tấm nguyên vẹn tiêu chuẩn'}
                </span>
              </div>

              <div>
                <span className="text-slate-400">{hoveredTile.broadloom ? 'Kích thước dải cắt: ' : 'Kích thước: '}</span>
                <span className="text-white font-mono font-semibold">{dimText}</span>
                {!hoveredTile.broadloom && isCutOrReused && nesting?.tiles && nesting.tiles.length > 0 && (
                  <span className="text-[10px] text-slate-500 ml-1">
                    (gốc: {tileConfig.width}×{tileConfig.height})
                  </span>
                )}
              </div>

              <div>
                <span className="text-slate-400">{hoveredTile.broadloom
                  ? hoveredTile.broadloom.kind === 'source_slice' ? 'Diện tích mảnh: ' : 'Diện tích phủ sàn: '
                  : 'Diện tích: '}</span>
                <span className="text-cyan-300 font-mono font-bold">
                  {(hoveredTile.areaMm2 / 1_000_000).toFixed(3)} m²
                </span>
                {hoveredTile.broadloom?.kind !== 'source_slice' && (
                  <span className="text-[10px] text-slate-400 ml-1.5 font-mono">
                    ({(hoveredTile.coverageRatio * 100).toFixed(1)}%)
                  </span>
                )}
              </div>

              {hoveredTile.broadloom?.kind === 'purchased' && (
                <div className="text-[10px] text-slate-400 space-y-0.5">
                  <div>Diện tích dải cắt: <span className="font-mono text-slate-200">
                    {(hoveredTile.rawAreaMm2 / 1_000_000).toFixed(3)} m²
                  </span></div>
                  <div>Ngoài sàn / phụ cấp: <span className="font-mono text-slate-200">
                    {(Math.max(0, hoveredTile.rawAreaMm2 - hoveredTile.areaMm2) / 1_000_000).toFixed(3)} m²
                  </span></div>
                </div>
              )}

              {hoveredTile.status === 'offcut_reused' && (
                <div className="bg-purple-950/50 border border-purple-700/50 p-1.5 rounded text-purple-200 text-[10px] space-y-0.5">
                  <div className="font-semibold text-purple-300">
                    ⚡ Nguồn gốc: Cắt từ phôi [{hoveredTile.sourceSliceCode || hoveredTile.reusedSourceCode || 'S'}]
                  </div>
                  <div>Mã phôi gốc: #{hoveredTile.reusedFromTileId || hoveredTile.reusedFromId}</div>
                </div>
              )}

              {isDonor && (
                <div className="bg-amber-950/50 border border-amber-700/50 p-1.5 rounded text-amber-200 text-[10px] space-y-0.5">
                  <div className="font-semibold text-amber-300">
                    ✂️ Phôi cung cấp ghép bù cho:
                  </div>
                  <div className="font-mono">
                    [{hoveredTile.donorTargetCodes?.join(', ')}]
                  </div>
                </div>
              )}

              <div className="text-[10px] text-slate-400 pt-0.5">
                Hướng sợi / Pile: <span className="font-mono text-slate-200">{hoveredTile.grainAngle}°</span>
              </div>
            </div>
          </div>
        );
      })()}
    </main>
  );
};
