import React, { useState, useEffect, useRef } from 'react';
import {
  MaterialCategory,
  LayingPattern,
  UnitType,
  DxfLayerInfo,
  TileConfig,
  BroadloomConfig,
  OffcutConfig,
  OriginSnapType,
  Point,
  RoomGeometry,
} from '../types';
import {
  Upload,
  Layers,
  Sparkles,
  RotateCw,
  Crosshair,
  Scissors,
  HelpCircle,
  FolderOpen,
  Compass,
  ArrowUpDown,
  Home,
} from 'lucide-react';

interface EnterInputNumberProps {
  value: number;
  onCommit: (val: number) => void;
  className?: string;
  min?: number;
  max?: number;
  step?: number;
}

export const EnterInputNumber: React.FC<EnterInputNumberProps> = ({
  value,
  onCommit,
  className = '',
  min,
  max,
  step,
}) => {
  const [text, setText] = useState<string>(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    const num = Number(text);
    if (!isNaN(num)) {
      let finalVal = num;
      if (min !== undefined) finalVal = Math.max(min, finalVal);
      if (max !== undefined) finalVal = Math.min(max, finalVal);
      onCommit(finalVal);
      setText(String(finalVal));
    } else {
      setText(String(value));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setText(String(value));
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <input
      type="number"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={commit}
      min={min}
      max={max}
      step={step}
      className={className}
      title="Nhập số và nhấn Enter để áp dụng"
    />
  );
};

interface SidebarLeftProps {
  unit: UnitType;
  setUnit: (u: UnitType) => void;
  layers: DxfLayerInfo[];
  selectedBoundaryLayer: string;
  setSelectedBoundaryLayer: (layer: string) => void;
  selectedObstacleLayers: string[];
  toggleObstacleLayer: (layer: string) => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onLoadMockData: () => void;
  onLoadCorridorSample: () => void;

  rooms: RoomGeometry[];
  selectedRoomId: string;
  setSelectedRoomId: (id: string) => void;
  onMoveRoom: (id: string, direction: -1 | 1) => void;

  flipY: boolean;
  setFlipY: (flip: boolean) => void;

  materialType: MaterialCategory;
  setMaterialType: (m: MaterialCategory) => void;
  tileConfig: TileConfig;
  setTileConfig: React.Dispatch<React.SetStateAction<TileConfig>>;
  corridorEditor?: React.ReactNode;
  broadloomConfig: BroadloomConfig;
  setBroadloomConfig: React.Dispatch<React.SetStateAction<BroadloomConfig>>;

  pattern: LayingPattern;
  setPattern: (p: LayingPattern) => void;
  rotationDeg: number;
  setRotationDeg: (deg: number) => void;

  originSnap: OriginSnapType;
  setOriginSnap: (snap: OriginSnapType) => void;
  originPoint: Point;
  isPickingOrigin: boolean;
  setIsPickingOrigin: (val: boolean) => void;

  offcutConfig: OffcutConfig;
  setOffcutConfig: React.Dispatch<React.SetStateAction<OffcutConfig>>;
}

export const SidebarLeft: React.FC<SidebarLeftProps> = ({
  unit,
  setUnit,
  layers,
  selectedBoundaryLayer,
  setSelectedBoundaryLayer,
  selectedObstacleLayers,
  toggleObstacleLayer,
  onFileUpload,
  onLoadMockData,
  onLoadCorridorSample,

  rooms,
  selectedRoomId,
  setSelectedRoomId,
  onMoveRoom,

  flipY,
  setFlipY,

  materialType,
  setMaterialType,
  tileConfig,
  setTileConfig,
  broadloomConfig,
  corridorEditor,
  setBroadloomConfig,

  pattern,
  setPattern,
  rotationDeg,
  setRotationDeg,

  originSnap,
  setOriginSnap,
  originPoint,
  isPickingOrigin,
  setIsPickingOrigin,

  offcutConfig,
  setOffcutConfig,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draftRotation, setDraftRotation] = useState(rotationDeg);
  const draftRotationRef = useRef(rotationDeg);
  useEffect(() => {
    draftRotationRef.current = rotationDeg;
    setDraftRotation(rotationDeg);
  }, [rotationDeg]);
  const commitRotation = () => setRotationDeg(draftRotationRef.current % 360);

  const applyTilePreset = (w: number, h: number) => {
    setTileConfig((prev) => ({
      ...prev,
      width: w,
      height: h,
      // Packaging depends on the product, not just its dimensions.
      tilesPerBox: w === 500 && h === 500 ? 20 : undefined,
      m2PerBox: undefined,
    }));
  };

  return (
    <aside className="w-84 bg-slate-900 border-r border-slate-800 text-slate-200 flex flex-col h-full overflow-hidden text-xs select-none">
      {/* App Header */}
      <div className="p-3 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-gradient-to-tr from-blue-600 to-cyan-400 flex items-center justify-center font-bold text-white shadow">
            N
          </div>
          <div>
            <h1 className="font-semibold text-sm text-white tracking-wide">CAD Floor Nesting</h1>
            <p className="text-[10px] text-slate-400">Dự toán hao hụt thảm & sàn DXF</p>
          </div>
        </div>

        <button
          onClick={() => setFlipY(!flipY)}
          className={`p-1.5 rounded flex items-center gap-1 border transition ${
            flipY
              ? 'bg-blue-600/30 border-blue-500 text-cyan-300'
              : 'border-slate-800 text-slate-400 hover:text-white'
          }`}
          title="Đảo chiều trục Y (Chuẩn CAD AutoCAD)"
        >
          <ArrowUpDown size={13} />
          <span className="text-[10px] font-mono">{flipY ? 'CAD Y-Up' : 'Canvas Y-Down'}</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* 1. DXF File & Units */}
        <section className="bg-slate-850/60 p-2.5 rounded-lg border border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-300 flex items-center gap-1.5">
              <FolderOpen size={14} className="text-blue-400" /> Mặt bằng DXF
            </span>
            <div className="flex items-center gap-1 bg-slate-800 px-1 py-0.5 rounded text-[10px]">
              <span className="text-slate-400">Đơn vị:</span>
              {(['mm', 'cm', 'm'] as UnitType[]).map((u) => (
                <button
                  key={u}
                  onClick={() => setUnit(u)}
                  className={`px-1.5 py-0.5 rounded uppercase font-medium ${
                    unit === u ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>

          <input
            type="file"
            ref={fileInputRef}
            onChange={onFileUpload}
            accept=".dxf"
            className="hidden"
          />

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center gap-1.5 py-2 px-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium shadow-sm transition"
            >
              <Upload size={13} /> Tải DXF
            </button>
            <button
              onClick={onLoadMockData}
              className="flex items-center justify-center gap-1.5 py-2 px-2 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded border border-cyan-500/30 font-medium transition"
              title="Tải 2 phòng mẫu có lỗ cột để test ngay"
            >
              <Sparkles size={13} /> Mẫu Mock
            </button>
          </div>

          <button onClick={onLoadCorridorSample}
            className="w-full rounded border border-amber-500/40 bg-amber-500/10 py-1.5 text-amber-200 hover:bg-amber-500/20">
            Mẫu hành lang 4 nhánh · Ngang / Dọc
          </button>

          {/* Multi-room Selection */}
          {rooms.length > 0 && (
            <div className="pt-2 border-t border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-slate-300 flex items-center gap-1.5">
                  <Home size={13} className="text-emerald-400" /> Chọn Phòng Tính Toán ({rooms.length} phòng):
                </label>
              </div>

              <select
                value={selectedRoomId}
                onChange={(e) => setSelectedRoomId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-slate-200 outline-none focus:border-blue-500 text-xs"
              >
                <option value="all">⭐ Tất cả các phòng ({rooms.length} phòng)</option>
                {rooms.map((r, i) => (
                  <option key={r.id} value={r.id}>
                    {r.name || `Phòng ${i + 1}`}
                  </option>
                ))}
              </select>
              {materialType === 'broadloom' && selectedRoomId === 'all' && rooms.length > 1 && (
                <div className="space-y-1 pt-1">
                  <p className="text-[10px] text-slate-400">Thứ tự thi công và nguồn mảnh thừa giữa các phòng:</p>
                  {rooms.map((room, index) => <div key={room.id} className="flex items-center gap-1 text-[10px] bg-slate-900 rounded px-1.5 py-1">
                    <span className="text-cyan-400 font-mono w-4">{index + 1}</span>
                    <span className="flex-1 truncate" title={room.name}>{room.name}</span>
                    <button type="button" disabled={index === 0} onClick={() => onMoveRoom(room.id, -1)}
                      className="px-1.5 rounded border border-slate-700 disabled:opacity-30" title="Thi công sớm hơn">↑</button>
                    <button type="button" disabled={index === rooms.length - 1} onClick={() => onMoveRoom(room.id, 1)}
                      className="px-1.5 rounded border border-slate-700 disabled:opacity-30" title="Thi công muộn hơn">↓</button>
                  </div>)}
                </div>
              )}
            </div>
          )}

          {/* Layers Configuration */}
          {layers.length > 0 && (
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <div className="flex items-center gap-1 text-[11px] text-slate-300">
                <Layers size={13} className="text-cyan-400" /> Quản lý Layer CAD:
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400">Layer đường bao tường (Room Boundary):</label>
                <select
                  value={selectedBoundaryLayer}
                  onChange={(e) => setSelectedBoundaryLayer(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 outline-none focus:border-blue-500"
                >
                  {layers.map((l) => (
                    <option key={l.name} value={l.name}>
                      {l.name} ({l.entityCount} đối tượng)
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400">Layer cột / lỗ khoét (Obstacles):</label>
                <div className="max-h-24 overflow-y-auto space-y-1 bg-slate-900/80 p-1.5 rounded border border-slate-800">
                  {layers.map((l) => (
                    <label
                      key={l.name}
                      className="flex items-center gap-1.5 cursor-pointer hover:bg-slate-800/50 p-0.5 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={selectedObstacleLayers.includes(l.name)}
                        onChange={() => toggleObstacleLayer(l.name)}
                        className="rounded border-slate-700 text-blue-600 focus:ring-0"
                      />
                      <span className="truncate text-slate-300">{l.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* 2. Material Setup */}
        <section className="bg-slate-850/60 p-2.5 rounded-lg border border-slate-800 space-y-3">
          <span className="font-medium text-slate-300 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span> Cấu hình Vật tư
          </span>

          <div className="grid grid-cols-3 gap-1 bg-slate-900 p-1 rounded-md border border-slate-800 text-[11px]">
            <button
              onClick={() => setMaterialType('carpet_tile')}
              className={`py-1 rounded text-center font-medium transition ${
                materialType === 'carpet_tile'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Thảm tấm
            </button>
            <button
              onClick={() => setMaterialType('lvt_pvc')}
              className={`py-1 rounded text-center font-medium transition ${
                materialType === 'lvt_pvc'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Sàn LVT/PVC
            </button>
            <button
              onClick={() => setMaterialType('broadloom')}
              className={`py-1 rounded text-center font-medium transition ${
                materialType === 'broadloom'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Thảm cuộn
            </button>
          </div>

          {materialType === 'broadloom' ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 flex items-center justify-between">
                    <span>Khổ rộng (mm):</span>
                    <span className="text-[9px] text-cyan-400 font-mono">↵ Enter</span>
                  </label>
                  <EnterInputNumber
                    value={broadloomConfig.rollWidth}
                    onCommit={(val) => {
                      const finalVal = val <= 20 ? Math.round(val * 1000) : val;
                      setBroadloomConfig((prev) => ({ ...prev, rollWidth: Math.max(500, finalVal), seamOverlap: Math.min(prev.seamOverlap, Math.max(500, finalVal) - 1) }));
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 mt-0.5 focus:border-cyan-400 outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 flex items-center justify-between">
                    <span>Mối nối (mm):</span>
                    <span className="text-[9px] text-cyan-400 font-mono">↵ Enter</span>
                  </label>
                  <EnterInputNumber
                    value={broadloomConfig.seamOverlap}
                    onCommit={(val) =>
                      setBroadloomConfig((prev) => ({ ...prev, seamOverlap: Math.min(prev.rollWidth - 1, Math.max(0, val)) }))
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 mt-0.5 focus:border-cyan-400 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400">Chiều dài cuộn tối đa (mm):</label>
                  <EnterInputNumber
                    value={broadloomConfig.maxRollLength}
                    onCommit={(val) => setBroadloomConfig((prev) => ({ ...prev, maxRollLength: Math.max(1000, (prev.cutAllowanceMm ?? 100) + 1, val) }))}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 mt-0.5 focus:border-cyan-400 outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">Phụ cấp cắt mỗi dải (mm):</label>
                  <EnterInputNumber
                    value={broadloomConfig.cutAllowanceMm ?? 100}
                    onCommit={(val) => setBroadloomConfig((prev) => ({ ...prev, cutAllowanceMm: Math.max(0, Math.min(val, prev.maxRollLength - 1)) }))}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 mt-0.5 focus:border-cyan-400 outline-none"
                  />
                </div>
              </div>

              <div className="flex gap-1">
                {[3000, 3660, 4000].map((w) => (
                  <button
                    key={w}
                    onClick={() => setBroadloomConfig((prev) => ({ ...prev, rollWidth: w }))}
                    className={`flex-1 py-1 rounded text-[10px] border transition-colors ${
                      broadloomConfig.rollWidth === w
                        ? 'bg-blue-600/30 border-blue-500 text-white font-medium'
                        : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
                    }`}
                  >
                    Khổ {w === 3660 ? '3.66' : w / 1000}m
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                <label className="text-[10px] text-slate-400">Cách trải thảm cuộn:</label>
                <div className="grid grid-cols-2 gap-1">
                  {(['whole', 'corridor'] as const).map(layoutMode => <button key={layoutMode}
                    onClick={() => setBroadloomConfig(prev => ({ ...prev, layoutMode }))}
                    aria-pressed={(broadloomConfig.layoutMode ?? 'whole') === layoutMode}
                    className={(broadloomConfig.layoutMode ?? 'whole') === layoutMode ? 'rounded border border-cyan-400 bg-cyan-500/20 text-white py-1' : 'rounded border border-slate-700 text-slate-400 py-1'}>
                    {layoutMode === 'whole' ? 'Toàn phòng' : 'Theo đoạn hành lang'}
                  </button>)}
                </div>
                {broadloomConfig.layoutMode !== 'corridor' && <div>
                  <label className="text-[10px] text-slate-400">Phương trải theo trục CAD:</label>
                  <div className="grid grid-cols-2 gap-1 mt-1">
                    {(['horizontal', 'vertical'] as const).map(direction => <button key={direction}
                      onClick={() => setBroadloomConfig(prev => ({ ...prev, direction }))}
                      aria-pressed={broadloomConfig.direction === direction}
                      className={broadloomConfig.direction === direction ? 'rounded border border-blue-400 bg-blue-600 text-white py-1' : 'rounded border border-slate-700 text-slate-400 py-1'}>
                      {direction === 'horizontal' ? 'Dải ngang' : 'Dải dọc'}
                    </button>)}
                  </div>
                </div>}
                {corridorEditor}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 flex items-center justify-between">
                    <span>Chiều dài W (mm):</span>
                    <span className="text-[9px] text-cyan-400 font-mono">↵ Enter</span>
                  </label>
                  <EnterInputNumber
                    value={tileConfig.width}
                    onCommit={(val) =>
                      setTileConfig((prev) => ({
                        ...prev,
                        width: Math.max(50, val),
                        tilesPerBox: Math.max(50, val) === prev.width ? prev.tilesPerBox : undefined,
                        m2PerBox: Math.max(50, val) === prev.width ? prev.m2PerBox : undefined,
                      }))
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 mt-0.5 focus:border-cyan-400 outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 flex items-center justify-between">
                    <span>Chiều rộng H (mm):</span>
                    <span className="text-[9px] text-cyan-400 font-mono">↵ Enter</span>
                  </label>
                  <EnterInputNumber
                    value={tileConfig.height}
                    onCommit={(val) =>
                      setTileConfig((prev) => ({
                        ...prev,
                        height: Math.max(50, val),
                        tilesPerBox: Math.max(50, val) === prev.height ? prev.tilesPerBox : undefined,
                        m2PerBox: Math.max(50, val) === prev.height ? prev.m2PerBox : undefined,
                      }))
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 mt-0.5 focus:border-cyan-400 outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-1">
                {materialType === 'carpet_tile' ? (
                  <>
                    <button
                      onClick={() => applyTilePreset(500, 500)}
                      className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 rounded text-[10px]"
                    >
                      500x500
                    </button>
                    <button
                      onClick={() => applyTilePreset(1000, 250)}
                      className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 rounded text-[10px]"
                    >
                      1000x250
                    </button>
                    <button
                      onClick={() => applyTilePreset(1000, 120)}
                      className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 rounded text-[10px]"
                    >
                      1000x120
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => applyTilePreset(914.4, 152.4)}
                      className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 rounded text-[10px]"
                    >
                      6"x36" (152.4x914.4)
                    </button>
                    <button
                      onClick={() => applyTilePreset(1220, 180)}
                      className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 rounded text-[10px]"
                    >
                      180x1220
                    </button>
                  </>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800">
                <div>
                  <label className="text-[10px] text-slate-400">Số tấm / thùng</label>
                  <EnterInputNumber value={tileConfig.tilesPerBox ?? 0} min={0} step={1}
                    onCommit={(val) => setTileConfig((prev) => ({ ...prev,
                      tilesPerBox: val > 0 ? Math.round(val) : undefined,
                      m2PerBox: val > 0 ? undefined : prev.m2PerBox }))}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 mt-0.5 focus:border-cyan-400 outline-none" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">Hoặc m² / thùng</label>
                  <EnterInputNumber value={tileConfig.m2PerBox ?? 0} min={0} step={0.01}
                    onCommit={(val) => setTileConfig((prev) => ({ ...prev,
                      m2PerBox: val > 0 ? val : undefined,
                      tilesPerBox: val > 0 ? undefined : prev.tilesPerBox }))}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 mt-0.5 focus:border-cyan-400 outline-none" />
                </div>
              </div>
              <p className="text-[10px] text-slate-500">Nhập một quy cách đóng thùng theo sản phẩm; 0 là chưa khai báo.</p>
            </div>
          )}
        </section>

        {/* 3. Laying Pattern (Tiles only) */}
        {materialType !== 'broadloom' && (
          <section className="bg-slate-850/60 p-2.5 rounded-lg border border-slate-800 space-y-2">
            <span className="font-medium text-slate-300 flex items-center gap-1.5">
              <Compass size={14} className="text-emerald-400" /> Kiểu trải (Pattern)
            </span>

            <div className="grid grid-cols-2 gap-1.5">
              {[
                { id: 'monolithic', label: 'Monolithic (Thẳng)' },
                { id: 'quarter_turn', label: 'Quarter-turn (Caro)' },
                { id: 'ashlar', label: 'Ashlar (1/2 so le)' },
                { id: 'stagger', label: 'Stagger (1/3 bond)' },
                { id: 'herringbone_90', label: 'Xương cá 90°' },
                { id: 'herringbone_45', label: 'Xương cá 45°' },
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPattern(p.id as LayingPattern)}
                  className={`py-1.5 px-2 rounded text-left border text-[11px] transition ${
                    pattern === p.id
                      ? 'bg-emerald-600/30 border-emerald-500 text-white font-medium shadow-sm'
                      : 'border-slate-800 bg-slate-900/50 text-slate-400 hover:text-white'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* 4. Rotation Angle & Origin Snap */}
        <section className="bg-slate-850/60 p-2.5 rounded-lg border border-slate-800 space-y-2.5">
          <span className="font-medium text-slate-300 flex items-center gap-1.5">
            <RotateCw size={14} className="text-indigo-400" /> {materialType === 'broadloom' ? 'Mốc trải thảm' : 'Góc xoay & Mốc viên lát'}
          </span>

          {materialType !== 'broadloom' && <div>
            <div className="flex justify-between text-[11px] text-slate-400 mb-1">
              <span>Góc xoay hướng trải:</span>
              <span className="text-white font-mono">{draftRotation}°</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0"
                max="360"
                step="5"
                value={draftRotation}
                onChange={(e) => {
                  draftRotationRef.current = Number(e.target.value);
                  setDraftRotation(draftRotationRef.current);
                }}
                onPointerUp={commitRotation}
                onPointerCancel={commitRotation}
                onKeyUp={commitRotation}
                onBlur={commitRotation}
                className="flex-1 accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
              <EnterInputNumber
                value={rotationDeg}
                onCommit={(val) => setRotationDeg(((val % 360) + 360) % 360)}
                className="w-12 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-center text-slate-200 outline-none focus:border-cyan-400"
              />
            </div>
          </div>}

          <div className="space-y-1 pt-1">
            <label className="text-[10px] text-slate-400">Bắt mốc viên lát (Origin Snap):</label>
            <div className="grid grid-cols-3 gap-1 text-[10px]">
              {[
                { id: 'bottom_left', label: 'Góc phòng' },
                { id: 'center', label: 'Tâm phòng' },
                { id: 'top_left', label: 'Góc trên' },
              ].map((s) => (
                <button
                  key={s.id}
                  onClick={() => setOriginSnap(s.id as OriginSnapType)}
                  className={`py-1 rounded border transition ${
                    originSnap === s.id
                      ? 'bg-indigo-600/30 border-indigo-500 text-white font-medium'
                      : 'border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setIsPickingOrigin(!isPickingOrigin)}
              className={`w-full py-1.5 mt-1 rounded border flex items-center justify-center gap-1.5 transition text-[11px] ${
                isPickingOrigin
                  ? 'bg-emerald-600 border-emerald-400 text-white font-semibold animate-pulse'
                  : 'bg-slate-900 border-slate-700 text-emerald-400 hover:bg-slate-800'
              }`}
            >
              <Crosshair size={13} />
              {isPickingOrigin ? 'Nhấn vào phòng để đặt mốc lát'
                : selectedRoomId === 'all' && rooms.length > 1
                  ? `Mỗi phòng một mốc lát (${rooms.length} phòng)`
                  : `Kéo mốc viên lát (${Math.round(originPoint[0])}, ${Math.round(originPoint[1])})`}
            </button>
          </div>
        </section>

        {/* 5. Offcut Optimization Engine */}
        <section className="bg-slate-850/60 p-2.5 rounded-lg border border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-300 flex items-center gap-1.5">
              <Scissors size={14} className="text-purple-400" /> Tận dụng Offcut (2D Bin Packing)
            </span>
            <input
              type="checkbox"
              checked={offcutConfig.enabled}
              onChange={(e) =>
                setOffcutConfig((prev) => ({ ...prev, enabled: e.target.checked }))
              }
              className="w-4 h-4 rounded text-purple-600 focus:ring-0 cursor-pointer"
            />
          </div>

          {offcutConfig.enabled && (
            <div className="space-y-2 pt-1 border-t border-slate-800">
              {materialType === 'broadloom' ? (
                <div>
                  <label className="text-[10px] text-slate-400 flex items-center justify-between">
                    <span>Bỏ mảnh cuộn có cạnh ngắn &lt; (mm):</span>
                    <span className="text-[9px] text-cyan-400 font-mono">↵ Enter</span>
                  </label>
                  <EnterInputNumber
                    value={offcutConfig.minBroadloomWidth ?? 1000}
                    onCommit={(val) =>
                      setOffcutConfig((prev) => ({ ...prev, minBroadloomWidth: Math.max(10, val) }))
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 mt-0.5 focus:border-cyan-400 outline-none"
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-400 flex items-center justify-between">
                      <span>Ngưỡng Min L (mm):</span>
                      <span className="text-[9px] text-cyan-400 font-mono">↵ Enter</span>
                    </label>
                    <EnterInputNumber
                      value={offcutConfig.minWidth}
                      onCommit={(val) =>
                        setOffcutConfig((prev) => ({ ...prev, minWidth: Math.max(10, val) }))
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 mt-0.5 focus:border-cyan-400 outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 flex items-center justify-between">
                      <span>Ngưỡng Min W (mm):</span>
                      <span className="text-[9px] text-cyan-400 font-mono">↵ Enter</span>
                    </label>
                    <EnterInputNumber
                      value={offcutConfig.minHeight}
                      onCommit={(val) =>
                        setOffcutConfig((prev) => ({ ...prev, minHeight: Math.max(10, val) }))
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 mt-0.5 focus:border-cyan-400 outline-none"
                    />
                  </div>
                </div>
              )}

              {materialType !== 'broadloom' && <div className="bg-slate-900 p-2 rounded border border-slate-800 space-y-1">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-slate-300 font-medium">Quy tắc chiều sợi (Pile Direction)</span>
                  <input
                    type="checkbox"
                    checked={offcutConfig.allowRotate}
                    onChange={(e) =>
                      setOffcutConfig((prev) => ({
                        ...prev,
                        allowRotate: e.target.checked,
                      }))
                    }
                    className="w-4 h-4 rounded text-purple-600 focus:ring-0"
                  />
                </label>
                <div className="text-[10px] text-slate-400 flex items-start gap-1">
                  <HelpCircle size={12} className="shrink-0 mt-0.5 text-purple-400" />
                  <span>
                    {offcutConfig.allowRotate ? (
                      <span className="text-amber-300">
                        Cho phép xoay: Tối đa hóa tỷ lệ bù nhưng có thể gây lệch màu/shading dưới ánh sáng.
                      </span>
                    ) : (
                      <span className="text-emerald-300">
                        Cố định chiều sợi (Khuyên dùng): Chỉ tịnh tiến mảnh thừa, tuyệt đối không lệch màu.
                      </span>
                    )}
                  </span>
                </div>
              </div>}
              {materialType === 'broadloom' && <p className="text-[10px] text-slate-400">Chiều sợi cố định theo phương trải của từng vùng.</p>}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
};
