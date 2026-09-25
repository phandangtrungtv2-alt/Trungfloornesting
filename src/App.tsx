import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  UnitType,
  DxfLayerInfo,
  RoomGeometry,
  MaterialCategory,
  TileConfig,
  BroadloomConfig,
  LayingPattern,
  OriginSnapType,
  Point,
  OffcutConfig,
  NestingResult,
  BOQSummary,
  CorridorZone,
} from './types';
import { MOCK_ROOMS, MOCK_DXF_CONTENT } from './data/mockDxf';
import { CORRIDOR_DXF_CONTENT } from './data/corridorMock';
import { parseDxfFile, extractRoomsFromLayers } from './services/dxfService';
import type { CalculationInput, CalculationOutput } from './services/calculationPipeline';
import { renderPlanImage } from './services/planExport';
import { resolveCorridorZones } from './services/corridorZones';
import { CorridorEditor } from './components/CorridorEditor';

import { SidebarLeft } from './components/SidebarLeft';
import { CanvasViewport } from './components/CanvasViewport';
import { SidebarRight } from './components/SidebarRight';
import { ModalReport } from './components/ModalReport';

export function App() {
  // DXF & Geometry State
  const [unit, setUnit] = useState<UnitType>('mm');
  const [layers, setLayers] = useState<DxfLayerInfo[]>([
    { name: 'ROOM_BOUNDARY', color: 7, entityCount: 2, isRoomBoundary: true },
    { name: 'OBSTACLES', color: 1, entityCount: 4, isObstacle: true },
  ]);
  const [selectedBoundaryLayer, setSelectedBoundaryLayer] = useState<string>('ROOM_BOUNDARY');
  const [selectedObstacleLayers, setSelectedObstacleLayers] = useState<string[]>(['OBSTACLES']);
  const [rawDxf, setRawDxf] = useState<any>(null);
  const [rooms, setRooms] = useState<RoomGeometry[]>(MOCK_ROOMS);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('all');

  // CAD Axes (True = AutoCAD standard +Y is Up)
  const [flipY, setFlipY] = useState<boolean>(true);

  // Material & Pattern State
  const [materialType, setMaterialType] = useState<MaterialCategory>('carpet_tile');
  const [tileConfigs, setTileConfigs] = useState<Record<'carpet_tile' | 'lvt_pvc', TileConfig>>({
    carpet_tile: { width: 500, height: 500, tilesPerBox: 20 },
    lvt_pvc: { width: 914.4, height: 152.4 },
  });
  const tileMaterial = materialType === 'lvt_pvc' ? 'lvt_pvc' : 'carpet_tile';
  const tileConfig = tileConfigs[tileMaterial];
  const setTileConfig: React.Dispatch<React.SetStateAction<TileConfig>> = useCallback((next) => {
    setTileConfigs((previous) => ({ ...previous,
      [tileMaterial]: typeof next === 'function' ? next(previous[tileMaterial]) : next }));
  }, [tileMaterial]);
  const [broadloomConfig, setBroadloomConfig] = useState<BroadloomConfig>({
    rollWidth: 3660,
    maxRollLength: 35000,
    seamOverlap: 0,
    direction: 'horizontal',
    layoutMode: 'whole',
    seamPenaltyM2PerM: 0,
  });
  const [patterns, setPatterns] = useState<Record<MaterialCategory, LayingPattern>>({
    carpet_tile: 'monolithic', lvt_pvc: 'monolithic', broadloom: 'monolithic',
  });
  const pattern = patterns[materialType];
  const setPattern = useCallback((next: LayingPattern) => {
    setPatterns((previous) => ({ ...previous, [materialType]: next }));
  }, [materialType]);
  const [rotationDeg, setRotationDeg] = useState<number>(0);

  // Origin State
  const [originSnap, setOriginSnapState] = useState<OriginSnapType>('bottom_left');
  const [customRoomOrigins, setCustomRoomOrigins] = useState<Record<string, Point>>({});
  const [isPickingOrigin, setIsPickingOrigin] = useState<boolean>(false);

  // Offcut Optimization State
  const [offcutConfigs, setOffcutConfigs] = useState<Record<MaterialCategory, OffcutConfig>>({
    broadloom: { enabled: true, minWidth: 100, minHeight: 100, minBroadloomWidth: 1000, allowRotate: false },
    carpet_tile: { enabled: true, minWidth: 100, minHeight: 100, allowRotate: false },
    lvt_pvc: { enabled: true, minWidth: 100, minHeight: 100, allowRotate: false },
  });
  const offcutConfig = offcutConfigs[materialType];
  const [zoneDraft, setZoneDraft] = useState<{ geometry: string; zones: CorridorZone[] } | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [redetectNonce, setRedetectNonce] = useState(0);
  const [zoneDetectionError, setZoneDetectionError] = useState<string | null>(null);
  const zoneGeometry = useMemo(() => JSON.stringify(rooms.map(r =>
    [r.id, r.boundary, r.holes]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))), [rooms]);
  const corridorZones = useMemo(() => zoneDraft?.geometry === zoneGeometry ? zoneDraft.zones : [],
    [zoneDraft, zoneGeometry]);
  const zonesReady = zoneDraft?.geometry === zoneGeometry;
  const updateZones = (zones: CorridorZone[]) => setZoneDraft({ geometry: zoneGeometry, zones });
  useEffect(() => {
    if (materialType !== 'broadloom' || broadloomConfig.layoutMode !== 'corridor' || zonesReady) return;
    setZoneDetectionError(null);
    const worker = new Worker(new URL('./workers/zoneDetectionWorker.ts', import.meta.url), { type: 'module' });
    let cancelled = false;
    worker.onmessage = (event: MessageEvent<{ zones?: CorridorZone[]; error?: string }>) => {
      if (cancelled) return;
      if (event.data.error) setZoneDetectionError(event.data.error);
      else setZoneDraft({ geometry: zoneGeometry, zones: event.data.zones ?? [] });
      worker.terminate();
    };
    worker.onerror = () => {
      if (!cancelled) setZoneDetectionError('Không khởi chạy được phép nhận diện hành lang.');
      worker.terminate();
    };
    worker.postMessage(rooms);
    return () => { cancelled = true; worker.terminate(); };
  }, [materialType, broadloomConfig.layoutMode, zonesReady, zoneGeometry, rooms, redetectNonce]);
  const setOffcutConfig: React.Dispatch<React.SetStateAction<OffcutConfig>> = useCallback((next) => {
    setOffcutConfigs((previous) => ({ ...previous,
      [materialType]: typeof next === 'function' ? next(previous[materialType]) : next }));
  }, [materialType]);

  // Results
  const [nesting, setNesting] = useState<NestingResult | null>(null);
  const [boq, setBoq] = useState<BOQSummary | null>(null);
  const [calculationError, setCalculationError] = useState<string | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [planImage, setPlanImage] = useState<string | null>(null);
  const visibleNesting = isCalculating ? null : nesting;
  const visibleBoq = isCalculating ? null : boq;

  // Active rooms for calculation
  const activeRooms = useMemo(() => selectedRoomId === 'all'
    ? rooms
    : rooms.filter((r) => r.id === selectedRoomId), [rooms, selectedRoomId]);
  const zonePreview = useMemo(() => {
    if (materialType !== 'broadloom' || broadloomConfig.layoutMode !== 'corridor') return [];
    try { return resolveCorridorZones(activeRooms, corridorZones, false); }
    catch { return []; }
  }, [materialType, broadloomConfig.layoutMode, activeRooms, corridorZones]);

  const roomOrigins = useMemo<Record<string, Point>>(() => Object.fromEntries(rooms.map((room) => {
    const { minX, minY, maxX, maxY } = room.bbox;
    const snapped: Point = originSnap === 'center' ? [(minX + maxX) / 2, (minY + maxY) / 2]
      : originSnap === 'top_left' ? [minX, maxY] : [minX, minY];
    return [room.id, customRoomOrigins[room.id] ?? snapped];
  })), [rooms, originSnap, customRoomOrigins]);
  const originPoint = useMemo<Point>(() => roomOrigins[activeRooms[0]?.id] ?? [0, 0], [roomOrigins, activeRooms]);
  const setOriginSnap = (snap: OriginSnapType) => {
    setOriginSnapState(snap);
    if (snap !== 'custom') setCustomRoomOrigins({});
  };
  const setRoomOrigin = (roomId: string, point: Point) => {
    setCustomRoomOrigins({ ...roomOrigins, [roomId]: point });
    setOriginSnapState('custom');
  };
  const moveRoom = (roomId: string, direction: -1 | 1) => {
    setRooms((previous) => {
      const index = previous.findIndex((room) => room.id === roomId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= previous.length) return previous;
      const ordered = [...previous];
      [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
      return ordered;
    });
  };
  const openReport = () => {
    try {
      setPlanImage(nesting ? renderPlanImage(activeRooms, nesting, roomOrigins, flipY, tileConfig) : null);
    } catch {
      setPlanImage(null);
    }
    setIsReportModalOpen(true);
  };

  // Keep geometric optimization off the UI thread. A changed setting cancels
  // the previous worker, so its stale answer cannot replace the latest plan.
  useEffect(() => {
    if (materialType === 'broadloom' && broadloomConfig.layoutMode === 'corridor' && !zonesReady) {
      setNesting(null); setBoq(null);
      setCalculationError(zoneDetectionError);
      setIsCalculating(!zoneDetectionError);
      return;
    }
    if (activeRooms.length === 0) {
      setNesting(null);
      setBoq(null);
      setCalculationError(null);
      setIsCalculating(false);
      return;
    }
    const input: CalculationInput = {
      rooms: activeRooms, materialType, tileConfig, broadloomConfig,
      pattern, rotationDeg: materialType === 'broadloom' ? 0 : rotationDeg,
      originPoint, roomOrigins, offcutConfig, corridorZones,
    };
    let cancelled = false;
    const workers: Worker[] = [];
    setIsCalculating(true);
    setCalculationError(null);
    // Group rapid settings changes while keeping the controls responsive.
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const variants: CalculationInput[] = [input];
      const outcomes: ({ result?: CalculationOutput; error?: string } | null)[] =
        Array(variants.length).fill(null);
      const finish = () => {
        if (cancelled || outcomes.some((outcome) => outcome === null)) return;
        const valid = outcomes.flatMap((outcome) => outcome?.result ? [outcome.result] : []);
        if (valid.length) {
          const score = (output: CalculationOutput) =>
            output.nesting.totalLinearMeters * broadloomConfig.rollWidth / 1000 +
            (broadloomConfig.seamPenaltyM2PerM ?? 0) * output.nesting.seams.reduce(
              (sum, seam) => sum + seam.lengthMm / 1000, 0);
          const chosen = valid.reduce((best, option) =>
            score(option) < score(best) ? option : best);
          setNesting(chosen.nesting);
          setBoq(chosen.boq);
          setCalculationError(null);
        } else {
          setNesting(null);
          setBoq(null);
          setCalculationError(outcomes.find((outcome) => outcome?.error)?.error ??
            'Không tính được phương án trải sàn.');
        }
        setIsCalculating(false);
        workers.forEach((worker) => worker.terminate());
      };
      variants.forEach((variant, index) => {
        const worker = new Worker(new URL('./workers/calculationWorker.ts', import.meta.url),
          { type: 'module' });
        workers.push(worker);
        worker.onmessage = (event: MessageEvent<{
          result?: CalculationOutput; error?: string
        }>) => {
          if (cancelled) return;
          outcomes[index] = event.data;
          finish();
        };
        worker.onerror = () => {
          if (cancelled) return;
          outcomes[index] = { error: 'Không khởi chạy được phép tính nền.' };
          finish();
        };
        worker.postMessage(variant);
      });
    }, 30);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      workers.forEach((worker) => worker.terminate());
    };
  }, [activeRooms, materialType, tileConfig, broadloomConfig, pattern,
    rotationDeg, originPoint, roomOrigins, offcutConfig, corridorZones, zonesReady, zoneDetectionError]);

  const handleUnitChange = (nextUnit: UnitType) => {
    if (rawDxf && selectedBoundaryLayer) {
      try {
        const extractedRooms = extractRoomsFromLayers(
          rawDxf, selectedBoundaryLayer, selectedObstacleLayers, nextUnit
        );
        setRooms(extractedRooms);
        setCustomRoomOrigins({});
        setSelectedRoomId('all');
      } catch (err: any) {
        alert('Không thể đổi đơn vị bản vẽ: ' + err.message);
        return;
      }
    }
    setUnit(nextUnit);
  };

  // Load Mock Data
  const handleLoadMockData = () => {
    try {
      const parsed = parseDxfFile(MOCK_DXF_CONTENT);
      const mockRooms = extractRoomsFromLayers(parsed.rawDxf, 'ROOM_BOUNDARY', ['OBSTACLES'], 'mm');
      setUnit('mm');
      setLayers(parsed.layers);
      setSelectedBoundaryLayer('ROOM_BOUNDARY');
      setSelectedObstacleLayers(['OBSTACLES']);
      setRawDxf(parsed.rawDxf);
      setRooms(mockRooms);
      setCustomRoomOrigins({});
      setSelectedRoomId('all');
    } catch (err: any) {
      alert(err.message || 'Lỗi khi tải dữ liệu mẫu.');
    }
  };

  const handleLoadCorridorSample = () => {
    try {
      const parsed = parseDxfFile(CORRIDOR_DXF_CONTENT);
      const sample = extractRoomsFromLayers(parsed.rawDxf, 'CORRIDOR', ['COURTYARD'], 'mm');
      setUnit('mm'); setLayers(parsed.layers); setRawDxf(parsed.rawDxf);
      setSelectedBoundaryLayer('CORRIDOR'); setSelectedObstacleLayers(['COURTYARD']);
      setRooms(sample); setSelectedRoomId('all'); setCustomRoomOrigins({});
      setZoneDraft(null); setSelectedZoneId(null);
      setRedetectNonce(previous => previous + 1);
      setMaterialType('broadloom');
      setBroadloomConfig(previous => ({ ...previous, layoutMode: 'corridor', rollWidth: 4000,
        maxRollLength: 35000, seamOverlap: 0, direction: 'horizontal' }));
    } catch (error) {
      alert('Không mở được mẫu hành lang: ' + (error instanceof Error ? error.message : 'Lỗi DXF'));
    }
  };

  // DXF File Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = parseDxfFile(text);
        const boundaryCandidate =
          parsed.layers.find((l) => l.isRoomBoundary)?.name || parsed.layers[0]?.name || '';
        const obstacleCandidates = parsed.layers.filter((l) => l.isObstacle).map((l) => l.name);
        if (!boundaryCandidate) throw new Error('Không tìm thấy layer đường bao.');
        const extractedRooms = extractRoomsFromLayers(
          parsed.rawDxf, boundaryCandidate, obstacleCandidates, unit
        );
        setRawDxf(parsed.rawDxf);
        setLayers(parsed.layers);
        setSelectedBoundaryLayer(boundaryCandidate);
        setSelectedObstacleLayers(obstacleCandidates);
        setRooms(extractedRooms);
        setCustomRoomOrigins({});
        setSelectedRoomId('all');
      } catch (err: any) {
        alert('Lỗi phân tích file DXF: ' + err.message);
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  // Layer Obstacle Toggles
  const handleToggleObstacleLayer = (layerName: string) => {
    const updated = selectedObstacleLayers.includes(layerName)
      ? selectedObstacleLayers.filter((l) => l !== layerName)
      : [...selectedObstacleLayers, layerName];
    if (rawDxf && selectedBoundaryLayer) {
      try {
        setRooms(extractRoomsFromLayers(rawDxf, selectedBoundaryLayer, updated, unit));
        setCustomRoomOrigins({});
      } catch (err: any) {
        alert('Không thể cập nhật layer chướng ngại: ' + err.message);
        return;
      }
    }
    setSelectedObstacleLayers(updated);
  };

  const handleSelectBoundaryLayer = (layerName: string) => {
    if (rawDxf) {
      try {
        const extractedRooms = extractRoomsFromLayers(
          rawDxf,
          layerName,
          selectedObstacleLayers,
          unit
        );
        setRooms(extractedRooms);
        setCustomRoomOrigins({});
        setSelectedRoomId('all');
      } catch (err: any) {
        alert('Không thể trích xuất phòng từ layer này: ' + err.message);
        return;
      }
    }
    setSelectedBoundaryLayer(layerName);
  };

  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {calculationError && <div role="alert" className="absolute z-50 top-12 left-1/2 -translate-x-1/2 max-w-xl rounded border border-rose-500 bg-rose-950 px-4 py-2 text-sm text-rose-100 shadow-lg">{calculationError}</div>}
      {isCalculating && <div role="status" className="absolute z-40 top-12 left-1/2 -translate-x-1/2 rounded border border-cyan-500/40 bg-slate-900/95 px-3 py-1.5 text-xs text-cyan-200 shadow-lg">Đang tính phương án trải sàn…</div>}
      {/* Left Sidebar */}
      <SidebarLeft
        unit={unit}
        setUnit={handleUnitChange}
        layers={layers}
        selectedBoundaryLayer={selectedBoundaryLayer}
        setSelectedBoundaryLayer={handleSelectBoundaryLayer}
        selectedObstacleLayers={selectedObstacleLayers}
        toggleObstacleLayer={handleToggleObstacleLayer}
        onFileUpload={handleFileUpload}
        onLoadMockData={handleLoadMockData}
        onLoadCorridorSample={handleLoadCorridorSample}

        rooms={rooms}
        selectedRoomId={selectedRoomId}
        setSelectedRoomId={setSelectedRoomId}
        onMoveRoom={moveRoom}

        flipY={flipY}
        setFlipY={setFlipY}

        materialType={materialType}
        setMaterialType={setMaterialType}
        tileConfig={tileConfig}
        setTileConfig={setTileConfig}
        broadloomConfig={broadloomConfig}
        setBroadloomConfig={setBroadloomConfig}
        corridorEditor={materialType === 'broadloom' && broadloomConfig.layoutMode === 'corridor' ?
          <CorridorEditor rooms={activeRooms} zones={corridorZones} onChange={updateZones}
            selectedId={selectedZoneId} onSelect={setSelectedZoneId}
            detecting={!zonesReady && !zoneDetectionError} onReset={() => {
              setZoneDraft(null); setSelectedZoneId(null); setRedetectNonce(n => n + 1);
            }} /> : null}

        pattern={pattern}
        setPattern={setPattern}
        rotationDeg={rotationDeg}
        setRotationDeg={setRotationDeg}

        originSnap={originSnap}
        setOriginSnap={setOriginSnap}
        originPoint={originPoint}
        isPickingOrigin={isPickingOrigin}
        setIsPickingOrigin={setIsPickingOrigin}

        offcutConfig={offcutConfig}
        setOffcutConfig={setOffcutConfig}
      />

      {/* Center Canvas Viewport */}
      <CanvasViewport
        rooms={activeRooms}
        nesting={nesting}
        originPoints={roomOrigins}
        onSetOriginPoint={setRoomOrigin}
        isPickingOrigin={isPickingOrigin}
        setIsPickingOrigin={setIsPickingOrigin}
        flipY={flipY}
        setFlipY={setFlipY}
        tileConfig={tileConfig}
        zones={zonePreview}
        selectedZoneId={selectedZoneId}
        onSelectZone={setSelectedZoneId}
      />

      {/* Right Sidebar */}
      <SidebarRight
        boq={visibleBoq}
        nesting={visibleNesting}
        isCalculating={isCalculating}
        rooms={activeRooms}
        materialType={materialType}
        tileConfig={tileConfig}
        broadloomConfig={broadloomConfig}
        pattern={pattern}
        onOpenReportModal={openReport}
      />

      {/* Printable Report Modal */}
      <ModalReport
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        boq={boq}
        nesting={nesting}
        rooms={activeRooms}
        planImage={planImage}
        materialType={materialType}
        tileConfig={tileConfig}
        broadloomConfig={broadloomConfig}
        pattern={pattern}
      />
    </div>
  );
}

export default App;
