import React, { useState } from 'react';
import {
  BOQSummary,
  MaterialCategory,
  TileConfig,
  BroadloomConfig,
  NestingResult,
  RoomGeometry,
} from '../types';
import {
  FileSpreadsheet,
  Printer,
  BarChart3,
  TrendingDown,
  Sparkles,
  Layers,
  Info,
  CheckCircle2,
  Ruler,
  Boxes,
  Maximize,
} from 'lucide-react';
import { generateBOQCSV, downloadCSV } from '../services/boqService';
import { ZoneQuantities } from './ZoneQuantities';

interface SidebarRightProps {
  boq: BOQSummary | null;
  nesting: NestingResult | null;
  rooms: RoomGeometry[];
  materialType: MaterialCategory;
  tileConfig: TileConfig;
  broadloomConfig: BroadloomConfig;
  pattern: string;
  onOpenReportModal: () => void;
  isCalculating: boolean;
}

export const SidebarRight: React.FC<SidebarRightProps> = ({
  boq,
  nesting,
  rooms,
  materialType,
  tileConfig,
  broadloomConfig,
  pattern,
  onOpenReportModal,
  isCalculating,
}) => {
  const [activeTab, setActiveTab] = useState<'boq' | 'offcuts'>('boq');

  const handleExportCSV = () => {
    if (!boq) return;
    const csv = generateBOQCSV(boq, materialType, tileConfig, broadloomConfig, pattern, nesting ?? undefined, rooms);
    downloadCSV(csv, `Du_Toan_San_${materialType}_${Date.now()}.csv`);
  };

  const availableOffcuts = nesting?.offcutsAvailable.filter((offcut) =>
    !offcut.isDiscarded && (offcut.remainingAreaMm2 ?? offcut.areaMm2) > 100) ?? [];
  const listedOffcuts = nesting?.offcutsAvailable.filter((offcut) =>
    !offcut.isDiscarded && ((offcut.remainingAreaMm2 ?? offcut.areaMm2) > 100 ||
      Boolean(offcut.subSlices?.length))) ?? [];

  if (!boq) {
    return (
      <aside className="w-84 bg-slate-900 border-l border-slate-800 text-slate-400 p-4 text-xs flex flex-col justify-center items-center text-center select-none">
        <Info size={28} className="text-slate-600 mb-2" />
        <p>{isCalculating ? 'Đang tính phương án trải sàn…' : 'Chưa có dữ liệu tính toán.'}</p>
        <p className="text-[11px] text-slate-500 mt-1">{isCalculating
          ? 'Bạn vẫn có thể thay đổi cấu hình hoặc di chuyển bản vẽ.'
          : 'Hãy tải file DXF hoặc bấm "Mẫu Mock" để bắt đầu.'}</p>
      </aside>
    );
  }

  const isGoodLoss = boq.lossPercentage < 8;
  const isModerateLoss = boq.lossPercentage >= 8 && boq.lossPercentage <= 15;
  const lossLabel = materialType === 'lvt_pvc' ? 'Tỷ lệ hao hụt vật liệu' : 'Tỷ lệ hao hụt thảm';

  const quantityLabel =
    materialType === 'broadloom'
      ? `${boq.linearMeters.toFixed(2)} m dài`
      : `${boq.totalRawTilesNeeded} tấm`;

  const quantitySubLabel =
    materialType === 'broadloom'
      ? `(${boq.broadloomStripCount || 0} dải cắt mới)`
      : boq.totalBoxesNeeded
      ? `(${boq.totalBoxesNeeded} thùng)`
      : '';

  return (
    <aside className="w-84 bg-slate-900 border-l border-slate-800 text-slate-200 flex flex-col h-full overflow-hidden text-xs select-none">
      {/* Tab Switcher */}
      <div className="p-2 border-b border-slate-800 bg-slate-950 flex gap-1">
        <button
          onClick={() => setActiveTab('boq')}
          className={`flex-1 py-1.5 rounded flex items-center justify-center gap-1.5 font-medium transition ${
            activeTab === 'boq'
              ? 'bg-blue-600 text-white shadow'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <BarChart3 size={13} /> Bóc Tách Vật Tư
        </button>
        <button
          onClick={() => setActiveTab('offcuts')}
          className={`flex-1 py-1.5 rounded flex items-center justify-center gap-1.5 font-medium transition ${
            activeTab === 'offcuts'
              ? 'bg-purple-600 text-white shadow'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Sparkles size={13} /> Mảnh Thừa ({listedOffcuts.length})
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {activeTab === 'boq' ? (
          <>
            <ZoneQuantities quantities={nesting?.zoneQuantities} />
            {/* 5 CHỈ TIÊU CHỦ ĐẠO GÓC PHẢI PHÍA TRÊN */}
            <div className="space-y-2">
              <span className="text-[11px] font-semibold text-cyan-400 uppercase tracking-wider block border-b border-slate-800 pb-1">
                Tổng Hợp Bóc Tách Vật Tư
              </span>

              {/* 1. Diện tích sàn thực tế */}
              <div className="bg-slate-850 p-2.5 rounded-lg border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-400 block flex items-center gap-1">
                    <Maximize size={12} className="text-blue-400" /> 1. Diện tích sàn thực tế
                  </span>
                  <span className="text-base font-bold text-white font-mono">
                    {boq.netFloorAreaM2.toFixed(2)}
                  </span>
                  <span className="text-[10px] text-slate-400 ml-1">m²</span>
                </div>
                <div className="text-[10px] text-right text-slate-400">
                  <span>Net Floor Area</span>
                </div>
              </div>

              {/* 2. Số lượng thảm dùng */}
              <div className="bg-slate-850 p-2.5 rounded-lg border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-400 block flex items-center gap-1">
                    <Boxes size={12} className="text-emerald-400" /> 2. Số lượng thảm dùng
                  </span>
                  <span className="text-base font-bold text-emerald-400 font-mono">
                    {quantityLabel}
                  </span>
                  <span className="text-[10px] text-slate-400 ml-1.5">{quantitySubLabel}</span>
                </div>
                <div className="text-[10px] text-right text-slate-400">
                  <span>{materialType === 'broadloom' ? 'Mét dài cắt' : 'Viên xuất kho'}</span>
                </div>
              </div>

              {/* 3. Kích thước thảm */}
              <div className="bg-slate-850 p-2.5 rounded-lg border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-400 block flex items-center gap-1">
                    <Ruler size={12} className="text-amber-400" /> 3. Kích thước thảm
                  </span>
                  <span className="text-sm font-bold text-amber-300 font-mono">
                    {boq.materialDimensionLabel}
                  </span>
                </div>
                <div className="text-[10px] text-right text-slate-400">
                  <span>Quy cách</span>
                </div>
              </div>

              {/* 4. Diện tích thảm dùng */}
              <div className="bg-slate-850 p-2.5 rounded-lg border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-400 block flex items-center gap-1">
                    <Layers size={12} className="text-cyan-400" /> 4. Diện tích thảm dùng
                  </span>
                  <span className="text-base font-bold text-cyan-400 font-mono">
                    {boq.grossAreaM2.toFixed(2)}
                  </span>
                  <span className="text-[10px] text-slate-400 ml-1">m²</span>
                </div>
                <div className="text-[10px] text-right text-slate-400">
                  <span>Gross Area</span>
                </div>
              </div>

              {/* 5. Hao hụt % */}
              <div className="bg-slate-850 p-2.5 rounded-lg border border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 flex items-center gap-1">
                    <TrendingDown size={12} className="text-rose-400" /> 5. {lossLabel}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-bold font-mono ${
                      isGoodLoss
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : isModerateLoss
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    {boq.lossPercentage.toFixed(2)}%
                  </span>
                </div>

                <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                  <div
                    style={{ width: `${Math.min(100, boq.lossPercentage * 2.5)}%` }}
                    className={`h-full rounded-full transition-all duration-500 ${
                      isGoodLoss ? 'bg-emerald-500' : isModerateLoss ? 'bg-amber-500' : 'bg-rose-500'
                    }`}
                  />
                </div>

                <div className="flex justify-between text-[10px] text-slate-400 pt-0.5">
                  <span>Chênh lệch xuất kho − diện tích sàn:</span>
                  <span className="text-slate-200 font-mono">{boq.extraAreaM2.toFixed(2)} m²</span>
                </div>
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>Mảnh còn dùng được:</span>
                  <span className="text-purple-300 font-mono">{boq.reusableAreaM2.toFixed(2)} m²</span>
                </div>
                {boq.seamOverlapAreaM2 > 0.001 && <div className="flex justify-between text-[10px] text-slate-400">
                  <span>Vật tư tại mối nối:</span>
                  <span className="text-cyan-300 font-mono">{boq.seamOverlapAreaM2.toFixed(2)} m²</span>
                </div>}
              </div>
            </div>

            {/* Chi tiết phụ trợ & Tận dụng */}
            <div className="bg-slate-850 p-3 rounded-lg border border-slate-800 space-y-2">
              <span className="text-slate-300 font-medium block border-b border-slate-800 pb-1 flex items-center gap-1.5">
                <Sparkles size={13} className="text-purple-400" /> Hiệu quả tận dụng thảm thừa
              </span>

              {materialType === 'broadloom' ? (
                <div className="space-y-1.5 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Hướng dải đã chọn:</span>
                    <span className="text-cyan-300 font-medium">{nesting?.zones ? 'Theo từng vùng' : nesting?.layDirection === 'vertical' ? 'Dải dọc' : 'Dải ngang'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Dải cắt từ cuộn mới:</span>
                    <span className="text-white font-mono">{boq.broadloomStripCount} dải</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Tổng mảnh lắp đặt:</span>
                    <span className="text-white font-mono">{boq.installedPiecesCount} mảnh</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Số dải tận dụng từ mảng thừa:</span>
                    <span className="text-purple-300 font-mono font-bold">
                      +{boq.reusedOffcutsCount} dải
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Chiều dài mối nối seam:</span>
                    <span className="text-rose-400 font-mono font-bold">{boq.seamLengthMeters.toFixed(2)} m</span>
                  </div>

                  {boq.savedAreaM2 > 0 && (
                    <div className="bg-purple-950/40 border border-purple-800/40 p-1.5 rounded flex items-center gap-1.5 text-[10px] text-purple-300 mt-1">
                      <CheckCircle2 size={13} className="text-purple-400 shrink-0" />
                      <span>
                        Đã phủ <strong>{boq.savedAreaM2.toFixed(2)} m²</strong> bằng mảnh thừa thảm cuộn!
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5 text-[11px]">
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-slate-400 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-blue-500"></span> Tấm nguyên (Full):
                    </span>
                    <span className="text-white font-mono font-bold">{boq.fullTilesCount} tấm</span>
                  </div>

                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-slate-400 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500"></span> Tấm cắt biên (Cut):
                    </span>
                    <span className="text-amber-300 font-mono font-bold">{boq.cutTilesCount} tấm</span>
                  </div>

                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-slate-400 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-purple-500"></span> Ghép bù từ Offcut:
                    </span>
                    <span className="text-purple-300 font-mono font-bold">
                      +{boq.reusedOffcutsCount} vị trí
                    </span>
                  </div>

                  {boq.savedAreaM2 > 0 && (
                    <div className="bg-purple-950/40 border border-purple-800/40 p-1.5 rounded flex items-center gap-1.5 text-[10px] text-purple-300 mt-1">
                      <CheckCircle2 size={13} className="text-purple-400 shrink-0" />
                      <span>
                        Tiết kiệm được <strong>{boq.savedAreaM2.toFixed(2)} m²</strong> nhờ ghép bù offcut!
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          /* Offcut Inventory Tab */
          <div className="space-y-2">
            <span className="text-slate-300 font-medium block">
              Mảng thảm thừa ({availableOffcuts.length} còn dùng được)
            </span>

            {listedOffcuts.length > 0 ? (
              <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
                {listedOffcuts.map((off) => (
                  <div
                    key={off.id}
                    className="p-2 rounded bg-slate-850 border border-slate-800 text-[11px] space-y-0.5"
                  >
                    <div className="flex justify-between font-mono font-medium text-slate-300">
                      <span>{off.id}</span>
                      <span className="text-cyan-400">{((off.remainingAreaMm2 ?? off.areaMm2) / 1_000_000).toFixed(3)} m² còn lại</span>
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>Rộng: {Math.round(off.width)} mm | Dài: {Math.round(off.height)} mm</span>
                      <span>Sợi: {off.grainAngle}°</span>
                    </div>
                    {materialType === 'broadloom' && off.subSlices?.length ? (
                      <div className="text-[10px] text-purple-300 pt-1 border-t border-slate-800/60">
                        <div className="font-medium">Đã cắt tận dụng {off.subSlices.length} mảnh:</div>
                        {off.subSlices.map((slice) => (
                          <div key={slice.id} className="font-mono">
                            {slice.code} → {slice.targetCode}: {(slice.lengthMm / 1000).toFixed(2)} × {(slice.widthMm / 1000).toFixed(2)} m
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {off.assignedToTileId && (
                      <div className="text-[10px] text-purple-400 font-medium space-y-0.5 pt-0.5 border-t border-slate-800/60">
                        <div>✨ Đã dùng cắt ghép thay: {off.assignedToTileId}</div>
                        {off.remainingLengthMm !== undefined && (
                          <div className="text-emerald-400">
                            ✂️ Còn lại sau khi cắt: {(off.remainingLengthMm / 1000).toFixed(1)}m x {(Math.min(off.width, off.height) / 1000).toFixed(1)}m ({((off.remainingAreaMm2 ?? 0) / 1_000_000).toFixed(2)} m²)
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-slate-400">
                Không có mảnh thừa nào đạt kích thước tối thiểu.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Action Buttons */}
      <div className="p-3 border-t border-slate-800 bg-slate-950 space-y-2">
        <button
          onClick={handleExportCSV}
          className="w-full py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded font-medium flex items-center justify-center gap-1.5 shadow transition"
        >
          <FileSpreadsheet size={14} /> Xuất Bảng BOQ Excel (.csv)
        </button>

        <button
          onClick={onOpenReportModal}
          className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 rounded font-medium flex items-center justify-center gap-1.5 transition"
        >
          <Printer size={14} /> Báo Cáo Sơ Đồ Trải (Print/PDF)
        </button>
      </div>
    </aside>
  );
};
