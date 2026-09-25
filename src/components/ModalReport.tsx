import React from 'react';
import {
  BOQSummary,
  MaterialCategory,
  TileConfig,
  BroadloomConfig,
  NestingResult,
  RoomGeometry,
} from '../types';
import { X, Printer } from 'lucide-react';
import { ZoneQuantities } from './ZoneQuantities';

interface ModalReportProps {
  isOpen: boolean;
  onClose: () => void;
  boq: BOQSummary | null;
  nesting?: NestingResult | null;
  rooms: RoomGeometry[];
  planImage: string | null;
  materialType: MaterialCategory;
  tileConfig: TileConfig;
  broadloomConfig: BroadloomConfig;
  pattern: string;
}

export const ModalReport: React.FC<ModalReportProps> = ({
  isOpen,
  onClose,
  boq,
  nesting,
  rooms,
  planImage,
  materialType,
  tileConfig,
  broadloomConfig,
  pattern,
}) => {
  if (!isOpen || !boq) return null;

  const handlePrint = () => {
    window.print();
  };

  const matName =
    materialType === 'broadloom'
      ? 'Thảm cuộn (Broadloom Carpet)'
      : materialType === 'carpet_tile'
      ? 'Thảm tấm (Carpet Tile)'
      : 'Sàn nhựa / LVT / PVC';

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col text-slate-100 overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-cyan-400"></span>
            <h2 className="font-semibold text-base text-white">
              Báo Cáo Dự Toán Hao Hụt Sàn Hoàn Thiện
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium flex items-center gap-1.5 shadow"
            >
              <Printer size={14} /> In / Xuất PDF
            </button>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Printable Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs bg-slate-900" id="printable-report">
          {/* Project Info Block */}
          <div className="grid grid-cols-2 gap-4 pb-4 border-b border-slate-800">
            <div className="space-y-1">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider">Hạng mục công trình</span>
              <p className="font-medium text-white text-sm">Trải sàn hoàn thiện văn phòng / thương mại</p>
              <p className="text-slate-400">Vật tư: <strong className="text-slate-200">{matName}</strong></p>
              <p className="text-slate-400">Kiểu trải: <strong className="text-slate-200">{pattern}</strong></p>
            </div>
            <div className="space-y-1 text-right">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider">Thời gian lập</span>
              <p className="text-white font-mono">{new Date().toLocaleString('vi-VN')}</p>
              <p className="text-slate-400">Quy chuẩn kỹ thuật: <strong className="text-slate-200">CAD DXF 2D Nesting</strong></p>
            </div>
          </div>

          {/* Metric Highlights */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/60">
              <span className="text-[10px] text-slate-400 block">Diện tích sàn thực (Net Area)</span>
              <span className="text-xl font-bold text-white font-mono">{boq.netFloorAreaM2.toFixed(3)}</span>
              <span className="text-slate-400 ml-1">m²</span>
            </div>
            <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/60">
              <span className="text-[10px] text-slate-400 block">Vật tư cần xuất (Gross Area)</span>
              <span className="text-xl font-bold text-cyan-400 font-mono">{boq.grossAreaM2.toFixed(3)}</span>
              <span className="text-slate-400 ml-1">m²</span>
            </div>
            <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/60">
              <span className="text-[10px] text-slate-400 block">
                {materialType === 'lvt_pvc' ? 'Tỷ lệ hao hụt vật liệu' : 'Tỷ lệ hao hụt thảm'}
              </span>
              <span className="text-xl font-bold text-amber-400 font-mono">{boq.lossPercentage.toFixed(2)}%</span>
            </div>
          </div>

          {planImage && <div className="space-y-2 break-after-page">
            <h3 className="font-semibold text-slate-200 text-sm">Sơ đồ trải sàn và vị trí cắt ghép</h3>
            <img src={planImage} alt="Bản vẽ trải sàn đầy đủ các phòng, dải cắt và mảnh tận dụng"
              className="w-full max-h-[650px] object-contain border border-slate-700 rounded" />
            <p className="text-[10px] text-slate-400">Màu xanh: vật tư trên sàn; tím: mảnh thừa/ghép bù; nét đứt: phần phôi nằm ngoài sàn; đỏ: mối nối.</p>
          </div>}

          {/* Detailed BOQ Table */}
          <div className="space-y-2">
            <h3 className="font-semibold text-slate-200 text-sm">Bảng Bóc Tách Khối Lượng Chi Tiết (BOQ)</h3>
            <table className="w-full border-collapse text-left border border-slate-800">
              <thead>
                <tr className="bg-slate-800 text-slate-300">
                  <th className="p-2 border border-slate-700">STT</th>
                  <th className="p-2 border border-slate-700">Hạng mục chỉ tiêu</th>
                  <th className="p-2 border border-slate-700">Quy cách / Thông số</th>
                  <th className="p-2 border border-slate-700 text-right">Số lượng</th>
                  <th className="p-2 border border-slate-700">Đơn vị</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                <tr>
                  <td className="p-2 border border-slate-800 font-mono">01</td>
                  <td className="p-2 border border-slate-800 font-medium">Diện tích mặt bằng Net</td>
                  <td className="p-2 border border-slate-800 text-slate-400">Theo biên dạng tường trừ cột</td>
                  <td className="p-2 border border-slate-800 text-right font-mono font-bold">{boq.netFloorAreaM2.toFixed(3)}</td>
                  <td className="p-2 border border-slate-800">m²</td>
                </tr>
                <tr>
                  <td className="p-2 border border-slate-800 font-mono">02</td>
                  <td className="p-2 border border-slate-800 font-medium">Khối lượng xuất kho Gross</td>
                  <td className="p-2 border border-slate-800 text-slate-400">Bao gồm hao hụt biên & cắt góc</td>
                  <td className="p-2 border border-slate-800 text-right font-mono font-bold text-cyan-400">{boq.grossAreaM2.toFixed(3)}</td>
                  <td className="p-2 border border-slate-800">m²</td>
                </tr>
                <tr>
                  <td className="p-2 border border-slate-800 font-mono">03</td>
                  <td className="p-2 border border-slate-800 font-medium">Phế phẩm sau tận dụng</td>
                  <td className="p-2 border border-slate-800 text-slate-400">Không gồm mảnh còn khả dụng và phần mối nối</td>
                  <td className="p-2 border border-slate-800 text-right font-mono text-amber-400">{boq.wasteAreaM2.toFixed(3)}</td>
                  <td className="p-2 border border-slate-800">m²</td>
                </tr>
                <tr>
                  <td className="p-2 border border-slate-800 font-mono">03a</td>
                  <td className="p-2 border border-slate-800">Mảnh thừa còn khả dụng</td>
                  <td className="p-2 border border-slate-800 text-slate-400">Có thể lưu kho và dùng tiếp</td>
                  <td className="p-2 border border-slate-800 text-right font-mono text-purple-400">{boq.reusableAreaM2.toFixed(3)}</td>
                  <td className="p-2 border border-slate-800">m²</td>
                </tr>
                {boq.seamOverlapAreaM2 > 0.001 && <tr>
                  <td className="p-2 border border-slate-800 font-mono">03b</td>
                  <td className="p-2 border border-slate-800">Vật tư tại mối nối</td>
                  <td className="p-2 border border-slate-800 text-slate-400">Phần chồng mí trên sàn</td>
                  <td className="p-2 border border-slate-800 text-right font-mono text-cyan-400">{boq.seamOverlapAreaM2.toFixed(3)}</td>
                  <td className="p-2 border border-slate-800">m²</td>
                </tr>}

                {materialType === 'broadloom' ? (
                  <>
                    <tr>
                      <td className="p-2 border border-slate-800 font-mono">04</td>
                      <td className="p-2 border border-slate-800">Khổ rộng cuộn</td>
                      <td className="p-2 border border-slate-800 text-slate-400">Tiêu chuẩn nhà máy</td>
                      <td className="p-2 border border-slate-800 text-right font-mono">{(broadloomConfig.rollWidth / 1000).toFixed(2)}</td>
                      <td className="p-2 border border-slate-800">m</td>
                    </tr>
                    <tr>
                      <td className="p-2 border border-slate-800 font-mono">05</td>
                      <td className="p-2 border border-slate-800">Tổng mét dài cuộn cần cắt</td>
                      <td className="p-2 border border-slate-800 text-slate-400">Linear meters xuất kho</td>
                      <td className="p-2 border border-slate-800 text-right font-mono font-bold text-cyan-400">{boq.linearMeters.toFixed(2)}</td>
                      <td className="p-2 border border-slate-800">m dài</td>
                    </tr>
                    <tr>
                      <td className="p-2 border border-slate-800 font-mono">06</td>
                      <td className="p-2 border border-slate-800">Tổng chiều dài đường nối seam</td>
                      <td className="p-2 border border-slate-800 text-slate-400">Băng keo nối thảm nhiệt</td>
                      <td className="p-2 border border-slate-800 text-right font-mono text-rose-400">{boq.seamLengthMeters.toFixed(2)}</td>
                      <td className="p-2 border border-slate-800">m</td>
                    </tr>
                    {boq.savedAreaM2 > 0 && (
                      <>
                        <tr>
                          <td className="p-2 border border-slate-800 font-mono">07</td>
                          <td className="p-2 border border-slate-800">Số dải thảm tận dụng từ mảng thừa</td>
                          <td className="p-2 border border-slate-800 text-slate-400">Tái chế từ phần thừa dọc của cuộn dài</td>
                          <td className="p-2 border border-slate-800 text-right font-mono text-purple-400 font-bold">+{boq.reusedOffcutsCount}</td>
                          <td className="p-2 border border-slate-800">dải</td>
                        </tr>
                        <tr>
                          <td className="p-2 border border-slate-800 font-mono">08</td>
                          <td className="p-2 border border-slate-800">Diện tích phủ bằng mảnh thừa</td>
                          <td className="p-2 border border-slate-800 text-slate-400">Diện tích mảnh cuộn đã lắp đặt</td>
                          <td className="p-2 border border-slate-800 text-right font-mono text-emerald-400 font-bold">{boq.savedAreaM2.toFixed(3)}</td>
                          <td className="p-2 border border-slate-800">m²</td>
                        </tr>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <tr>
                      <td className="p-2 border border-slate-800 font-mono">04</td>
                      <td className="p-2 border border-slate-800">Tổng số tấm nguyên cần xuất kho</td>
                      <td className="p-2 border border-slate-800 text-slate-400">Quy cách {tileConfig.width}x{tileConfig.height}mm</td>
                      <td className="p-2 border border-slate-800 text-right font-mono font-bold text-cyan-400">{boq.totalRawTilesNeeded}</td>
                      <td className="p-2 border border-slate-800">tấm</td>
                    </tr>
                    <tr>
                      <td className="p-2 border border-slate-800 font-mono">05</td>
                      <td className="p-2 border border-slate-800">Số tấm nguyên vẹn (100% diện tích)</td>
                      <td className="p-2 border border-slate-800 text-slate-400">Không cần cắt</td>
                      <td className="p-2 border border-slate-800 text-right font-mono">{boq.fullTilesCount}</td>
                      <td className="p-2 border border-slate-800">tấm</td>
                    </tr>
                    <tr>
                      <td className="p-2 border border-slate-800 font-mono">06</td>
                      <td className="p-2 border border-slate-800">Số tấm bị cắt góc/cạnh biên</td>
                      <td className="p-2 border border-slate-800 text-slate-400">Cắt từ viên nguyên</td>
                      <td className="p-2 border border-slate-800 text-right font-mono text-amber-400">{boq.cutTilesCount}</td>
                      <td className="p-2 border border-slate-800">tấm</td>
                    </tr>
                    <tr>
                      <td className="p-2 border border-slate-800 font-mono">07</td>
                      <td className="p-2 border border-slate-800">Số vị trí tận dụng bù từ Offcut</td>
                      <td className="p-2 border border-slate-800 text-slate-400">Tái sử dụng có kiểm soát chiều sợi</td>
                      <td className="p-2 border border-slate-800 text-right font-mono text-purple-400 font-bold">+{boq.reusedOffcutsCount}</td>
                      <td className="p-2 border border-slate-800">vị trí</td>
                    </tr>
                    {boq.savedAreaM2 > 0 && (
                      <tr>
                        <td className="p-2 border border-slate-800 font-mono">08</td>
                        <td className="p-2 border border-slate-800">Diện tích vật tư tiết kiệm được</td>
                        <td className="p-2 border border-slate-800 text-slate-400">Do thuật toán ghép bù tự động</td>
                        <td className="p-2 border border-slate-800 text-right font-mono text-emerald-400 font-bold">{boq.savedAreaM2.toFixed(3)}</td>
                        <td className="p-2 border border-slate-800">m²</td>
                      </tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>

          <ZoneQuantities quantities={nesting?.zoneQuantities} />
          {nesting && rooms.length > 0 && <div className="space-y-2 pt-4 border-t border-slate-800">
            <h3 className="font-semibold text-slate-200 text-sm">Bóc tách theo phòng</h3>
            <table className="w-full border-collapse text-left text-[11px]">
              <thead><tr className="bg-slate-800 text-slate-300">
                <th className="p-2 border border-slate-700">Phòng</th>
                <th className="p-2 border border-slate-700 text-right">Sàn m²</th>
                <th className="p-2 border border-slate-700 text-right">{materialType === 'broadloom' ? 'Cuộn mới m dài' : 'Tấm mới'}</th>
                <th className="p-2 border border-slate-700 text-right">Mảnh tận dụng</th>
              </tr></thead>
              <tbody>{rooms.map((room) => {
                const strips = nesting.broadloomStrips.filter((strip) => strip.roomId === room.id);
                const tiles = nesting.tiles.filter((tile) => tile.roomId === room.id);
                return <tr key={room.id}>
                  <td className="p-2 border border-slate-800">{room.name}</td>
                  <td className="p-2 border border-slate-800 text-right font-mono">{(room.areaMm2 / 1_000_000).toFixed(3)}</td>
                  <td className="p-2 border border-slate-800 text-right font-mono">{materialType === 'broadloom'
                    ? (strips.filter((strip) => !strip.isReusedFromOffcut).reduce((sum, strip) => sum + strip.lengthMm, 0) / 1000).toFixed(3)
                    : tiles.filter((tile) => tile.status !== 'offcut_reused').length}</td>
                  <td className="p-2 border border-slate-800 text-right font-mono">{materialType === 'broadloom'
                    ? strips.filter((strip) => strip.isReusedFromOffcut).length
                    : tiles.filter((tile) => tile.status === 'offcut_reused').length}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>}

          {materialType === 'broadloom' && nesting && <div className="space-y-2 pt-4 border-t border-slate-800 break-before-page">
            <h3 className="font-semibold text-slate-200 text-sm">Danh sách cắt thảm cuộn</h3>
            <table className="w-full border-collapse text-left text-[11px]">
              <thead><tr className="bg-slate-800 text-slate-300">
                <th className="p-2 border border-slate-700">Mã dải</th>
                <th className="p-2 border border-slate-700">Phòng</th>
                <th className="p-2 border border-slate-700">Nguồn</th>
                <th className="p-2 border border-slate-700 text-right">Rộng × dài cắt mm</th>
                <th className="p-2 border border-slate-700 text-right">Phủ m²</th>
              </tr></thead>
              <tbody>{nesting.broadloomStrips.map((strip) => <tr key={strip.id}>
                <td className="p-2 border border-slate-800 font-mono">{strip.id}</td>
                <td className="p-2 border border-slate-800">{rooms.find((room) => room.id === strip.roomId)?.name ?? strip.roomId}</td>
                <td className="p-2 border border-slate-800">{strip.isReusedFromOffcut ? `Mảnh ${strip.reusedFromId}` : 'Cuộn mới'}</td>
                <td className="p-2 border border-slate-800 text-right font-mono">{Math.round(strip.widthMm)} × {Math.round(strip.lengthMm)}</td>
                <td className="p-2 border border-slate-800 text-right font-mono">{(strip.usedAreaMm2 / 1_000_000).toFixed(3)}</td>
              </tr>)}</tbody>
            </table>
          </div>}

          {/* Offcut Matching Index Table (Bảng phụ lục: Mã phôi - Kích thước - Vị trí sử dụng) */}
          {nesting && nesting.offcutLinks && nesting.offcutLinks.length > 0 && (
            <div className="space-y-2 pt-4 border-t border-slate-800 break-before-page">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-400"></span>
                  <h3 className="font-semibold text-slate-200 text-sm">
                    Bảng Phụ Lục Tra Cứu Cắt Ghép Bù Offcut (Cutting & Matching Index)
                  </h3>
                </div>
                <span className="text-[11px] text-purple-400 font-medium">
                  Tổng cộng: {nesting.offcutLinks.length} vị trí ghép bù
                </span>
              </div>
              <p className="text-[10px] text-slate-400 italic">
                * Bảng tra cứu thi công: Sử dụng mã định danh phôi (S-XX) và vị trí ghép (P-XX) thay cho việc vẽ chằng chịt đường nối trên mặt bằng. Đảm bảo bảo toàn chiều sợi khi cắt.
              </p>

              <div className="overflow-x-auto border border-slate-800 rounded">
                <table className="w-full border-collapse text-left text-[11px]">
                  <thead>
                    <tr className="bg-slate-800 text-slate-300">
                      <th className="p-2 border border-slate-700 text-center w-10">STT</th>
                      <th className="p-2 border border-slate-700">Mã Phôi Gốc (Donor)</th>
                      <th className="p-2 border border-slate-700">KT Phôi Ban Đầu</th>
                      <th className="p-2 border border-slate-700">Mã Ghép Bù (Patch)</th>
                      <th className="p-2 border border-slate-700">KT Cắt Bù Thực Tế</th>
                      <th className="p-2 border border-slate-700 text-right">Diện Tích</th>
                      <th className="p-2 border border-slate-700">Hướng Dẫn Cắt Lát</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 font-mono">
                    {nesting.offcutLinks.map((link, idx) => {
                      const sCode = link.sourceCode || `S-${String(idx + 1).padStart(2, '0')}`;
                      const tCode = link.targetCode || `P-${String(idx + 1).padStart(2, '0')}`;
                      const sDim =
                        link.sourceWidthMm && link.sourceHeightMm
                          ? `${link.sourceWidthMm} × ${link.sourceHeightMm} mm`
                          : 'Theo phôi thừa';
                      const tDim =
                        link.targetWidthMm && link.targetHeightMm
                          ? `${link.targetWidthMm} × ${link.targetHeightMm} mm`
                          : `${(link.areaMm2 / 1_000_000).toFixed(2)} m²`;

                      return (
                        <tr key={link.id || idx} className="hover:bg-slate-800/40">
                          <td className="p-1.5 border border-slate-800 text-center text-slate-400">
                            {String(idx + 1).padStart(2, '0')}
                          </td>
                          <td className="p-1.5 border border-slate-800 font-bold text-amber-400">
                            <span>{sCode}</span>
                            <span className="text-[10px] text-slate-400 font-normal ml-1.5">
                              (Tấm #{link.sourceTileId})
                            </span>
                          </td>
                          <td className="p-1.5 border border-slate-800 text-slate-300">
                            {sDim}
                          </td>
                          <td className="p-1.5 border border-slate-800 font-bold text-purple-400">
                            <span>{tCode}</span>
                            <span className="text-[10px] text-slate-400 font-normal ml-1.5">
                              (Vị trí #{link.targetTileId})
                            </span>
                          </td>
                          <td className="p-1.5 border border-slate-800 text-cyan-300">
                            {tDim}
                          </td>
                          <td className="p-1.5 border border-slate-800 text-right text-emerald-400 font-bold">
                            {(link.areaMm2 / 1_000_000).toFixed(3)} m²
                          </td>
                          <td className="p-1.5 border border-slate-800 text-[10px] font-sans text-slate-400">
                            Cắt từ {sCode} ghép vào {tCode}, giữ đúng chiều sợi
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Verification Signatures */}
          <div className="pt-8 border-t border-slate-800 grid grid-cols-2 text-center text-slate-400">
            <div>
              <p className="font-semibold text-slate-200">KỸ THUẬT VIÊN / DỰ TOÁN</p>
              <p className="text-[10px] mt-1">(Ký & ghi rõ họ tên)</p>
              <div className="h-16"></div>
            </div>
            <div>
              <p className="font-semibold text-slate-200">ĐƠN VỊ THI CÔNG / GIÁM SÁT</p>
              <p className="text-[10px] mt-1">(Ký & đóng dấu)</p>
              <div className="h-16"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
