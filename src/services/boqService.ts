import {
  BOQSummary,
  NestingResult,
  RoomGeometry,
  TileConfig,
  BroadloomConfig,
  MaterialCategory,
} from '../types';

export function calculateBOQ(
  rooms: RoomGeometry[],
  nesting: NestingResult,
  materialType: MaterialCategory,
  tileConfig: TileConfig,
  broadloomConfig: BroadloomConfig
): BOQSummary {
  let totalNetMm2 = 0;
  for (const r of rooms) {
    totalNetMm2 += r.areaMm2;
  }
  const netFloorAreaM2 = totalNetMm2 / 1_000_000;
  const extraAreaM2 = materialType === 'broadloom'
    ? Math.max(0, nesting.totalLinearMeters * broadloomConfig.rollWidth / 1000 - netFloorAreaM2)
    : Math.max(0, nesting.totalRawTiles * tileConfig.width * tileConfig.height / 1_000_000 - netFloorAreaM2);
  const reusableAreaM2 = nesting.offcutsAvailable
    .filter((offcut) => !offcut.isDiscarded)
    .reduce((sum, offcut) => sum + Math.max(0, offcut.remainingAreaMm2 ?? offcut.areaMm2), 0) / 1_000_000;
  const lossPercentage = netFloorAreaM2 > 0 ? extraAreaM2 / netFloorAreaM2 * 100 : 0;

  if (materialType === 'broadloom') {
    const rollWidthM = broadloomConfig.rollWidth / 1000;
    const linearMeters = nesting.totalLinearMeters;
    const grossAreaM2 = linearMeters * rollWidthM;
    const installedAreaM2 = nesting.broadloomStrips.reduce((sum, strip) => sum + strip.usedAreaMm2, 0) / 1_000_000;
    const seamOverlapAreaM2 = Math.max(0, installedAreaM2 - netFloorAreaM2);
    const wasteAreaM2 = Math.max(0, extraAreaM2 - reusableAreaM2 - seamOverlapAreaM2);

    let totalSeamMm = 0;
    for (const seam of nesting.seams) {
      totalSeamMm += seam.lengthMm;
    }

    let savedAreaM2 = 0;
    let reusedCount = 0;
    for (const s of nesting.broadloomStrips) {
      if (s.isReusedFromOffcut) {
        savedAreaM2 += s.usedAreaMm2 / 1_000_000;
        reusedCount++;
      }
    }

    return {
      netFloorAreaM2,
      grossAreaM2,
      extraAreaM2,
      reusableAreaM2,
      seamOverlapAreaM2,
      wasteAreaM2,
      lossPercentage,
      materialDimensionLabel: `Khổ rộng: ${(broadloomConfig.rollWidth / 1000).toFixed(2)} m`,
      fullTilesCount: 0,
      cutTilesCount: 0,
      reusedOffcutsCount: reusedCount,
      totalRawTilesNeeded: 0,
      seamLengthMeters: totalSeamMm / 1000,
      linearMeters,
      broadloomStripCount:
        nesting.broadloomStrips.length === 0
          ? 0
          : Math.max(
              1,
              Math.round(
                nesting.broadloomStrips.reduce(
                  (sum, s) => (s.isReusedFromOffcut ? sum : sum + 1 / Math.max(1, s.laneCount || 1)),
                  0
                )
              )
            ),
      laneSplitSegments: nesting.broadloomStrips.filter((s) => (s.laneCount || 1) > 1).length,
      installedPiecesCount: nesting.broadloomStrips.length,
      savedAreaM2,
    };
  } else {
    const tileAreaM2 = (tileConfig.width * tileConfig.height) / 1_000_000;
    const fullTilesCount = nesting.tiles.filter((t) => t.status === 'full').length;
    const cutTilesCount = nesting.tiles.filter((t) => t.status === 'cut').length;
    const reusedOffcutsCount = nesting.tiles.filter((t) => t.status === 'offcut_reused').length;

    const totalRawTilesNeeded = fullTilesCount + cutTilesCount;
    const grossAreaM2 = totalRawTilesNeeded * tileAreaM2;
    const seamOverlapAreaM2 = Math.max(0, nesting.tiles.reduce((sum, tile) => sum + tile.areaMm2, 0) / 1_000_000 - netFloorAreaM2);
    const wasteAreaM2 = Math.max(0, extraAreaM2 - reusableAreaM2 - seamOverlapAreaM2);

    const savedAreaM2 = reusedOffcutsCount * tileAreaM2;

    let totalBoxesNeeded: number | undefined = undefined;
    if (tileConfig.tilesPerBox && tileConfig.tilesPerBox > 0) {
      totalBoxesNeeded = Math.ceil(totalRawTilesNeeded / tileConfig.tilesPerBox);
    } else if (tileConfig.m2PerBox && tileConfig.m2PerBox > 0) {
      totalBoxesNeeded = Math.ceil(grossAreaM2 / tileConfig.m2PerBox);
    }

    return {
      netFloorAreaM2,
      grossAreaM2,
      extraAreaM2,
      reusableAreaM2,
      seamOverlapAreaM2,
      wasteAreaM2,
      lossPercentage,
      materialDimensionLabel: `${tileConfig.width} x ${tileConfig.height} mm`,
      fullTilesCount,
      cutTilesCount,
      reusedOffcutsCount,
      totalRawTilesNeeded,
      seamLengthMeters: 0,
      linearMeters: 0,
      totalBoxesNeeded,
      savedAreaM2,
    };
  }
}

export function generateBOQCSV(
  summary: BOQSummary,
  materialType: MaterialCategory,
  tileConfig: TileConfig,
  broadloomConfig: BroadloomConfig,
  pattern: string,
  nesting?: NestingResult,
  rooms: RoomGeometry[] = []
): string {
  const rows: string[][] = [
    ['BẢNG BÓC TÁCH KHỐI LƯỢNG VẬT TƯ & DỰ TOÁN HAO HỤT SÀN HOÀN THIỆN'],
    ['Ngày xuất báo cáo', new Date().toLocaleString('vi-VN')],
    ['Loại vật liệu', materialType === 'broadloom' ? 'Thảm cuộn (Broadloom)' : materialType === 'carpet_tile' ? 'Thảm tấm (Carpet Tile)' : 'Sàn nhựa / LVT / PVC'],
    ['Quy cách kích thước', summary.materialDimensionLabel],
    ['Kiểu trải', pattern],
    [],
    ['CHỈ TIÊU', 'GIÁ TRỊ', 'ĐƠN VỊ', 'GHI CHÚ'],
    ['Diện tích sàn thực tế (Net Area)', summary.netFloorAreaM2.toFixed(3), 'm²', 'Tổng diện tích phòng trừ lỗ cột'],
    ['Diện tích vật tư cần xuất kho (Gross Area)', summary.grossAreaM2.toFixed(3), 'm²', 'Diện tích vật tư cần mua/cắt'],
    ['Kích thước thảm', summary.materialDimensionLabel, '', 'Quy cách vật tư tiêu chuẩn'],
    ['Chênh lệch xuất kho - diện tích sàn', summary.extraAreaM2.toFixed(3), 'm²', 'Gross Area - Net Area'],
    ['Mảnh thừa còn khả dụng', summary.reusableAreaM2.toFixed(3), 'm²', 'Có thể lưu kho và dùng tiếp'],
    ['Vật tư nằm trong mối nối', summary.seamOverlapAreaM2.toFixed(3), 'm²', 'Phần trải chồng theo cấu hình seam'],
    ['Phế phẩm thực tế', summary.wasteAreaM2.toFixed(3), 'm²', 'Chênh lệch trừ mảnh khả dụng và phần nối'],
    [materialType === 'lvt_pvc' ? 'Tỷ lệ hao hụt vật liệu' : 'Tỷ lệ hao hụt thảm',
      summary.lossPercentage.toFixed(2) + '%', '%', '(Diện tích xuất kho - diện tích sàn) / diện tích sàn'],
  ];

  if (materialType === 'broadloom') {
    rows.push(
      ['Hướng dải đã chọn', nesting?.layDirection === 'vertical' ? 'Dải dọc' : nesting?.layDirection === 'horizontal' ? 'Dải ngang' : 'Theo cấu hình', '', 'Kết quả phương án trải'],
      ['Khổ rộng cuộn', (broadloomConfig.rollWidth / 1000).toFixed(2), 'm', 'Tiêu chuẩn nhà máy'],
      ['Tổng mét dài cuộn cần cắt', summary.linearMeters.toFixed(2), 'm dài', 'Tổng chiều dài thảm xuất kho'],
      ['Số dải cắt từ cuộn mới', (summary.broadloomStripCount ?? 0).toString(), 'dải', 'Vật tư xuất kho'],
      ['Tổng số mảnh lắp đặt trên mặt bằng', (summary.installedPiecesCount ?? 0).toString(), 'mảnh', 'Bao gồm mảnh tận dụng'],
      ['Tổng chiều dài mối nối seam', summary.seamLengthMeters.toFixed(2), 'm', 'Đường chỉ nối giữa các dải']
    );
    if (summary.reusedOffcutsCount > 0) {
      rows.push(
        ['Số dải tận dụng từ mảng thừa', summary.reusedOffcutsCount.toString(), 'dải', 'Cắt từ mảnh thừa dọc của dải dài'],
        ['Diện tích phủ bằng mảnh thừa', summary.savedAreaM2.toFixed(3), 'm²', 'Diện tích mảnh cuộn tận dụng để trải sàn']
      );
    }
  } else {
    rows.push(
      ['Tổng số tấm cần xuất kho', summary.totalRawTilesNeeded.toString(), 'tấm', 'Đã trừ các tấm tận dụng bù'],
      ['Số tấm nguyên vẹn (Full Tile)', summary.fullTilesCount.toString(), 'tấm', '100% nằm trong phòng'],
      ['Số tấm bị cắt biên (Cut Tile)', summary.cutTilesCount.toString(), 'tấm', 'Tấm cắt cần xuất viên mới'],
      ['Số vị trí tận dụng từ Offcut', summary.reusedOffcutsCount.toString(), 'vị trí', 'Ghép bù thành công từ mảnh vụn thừa'],
      ['Diện tích tiết kiệm nhờ ghép bù', summary.savedAreaM2.toFixed(3), 'm²', 'Vật tư tái chế từ offcut']
    );

    if (summary.totalBoxesNeeded) {
      rows.push(['Tổng số thùng đóng gói ước tính', summary.totalBoxesNeeded.toString(), 'thùng', '']);
    }
  }

  if (nesting && rooms.length) {
    if (nesting.zoneQuantities?.length) {
      rows.push([], ['BÓC TÁCH THEO VÙNG HÀNH LANG'],
        ['Vùng', 'Phòng', 'Phương trải', 'Sàn m²', 'Cuộn mới m dài', 'Tận dụng m²', 'Số mảnh tận dụng']);
      for (const q of nesting.zoneQuantities) rows.push([q.name,
        rooms.find(r => r.id === q.roomId)?.name ?? q.roomId, q.direction === 'horizontal' ? 'Ngang' : 'Dọc',
        q.floorAreaM2.toFixed(3), q.linearMeters.toFixed(3), q.reusedAreaM2.toFixed(3), String(q.reusedPieces)]);
    }
    rows.push([], ['BÓC TÁCH THEO PHÒNG'],
      ['Phòng', 'Diện tích sàn m²', 'Mét dài cuộn mới / số tấm mới', 'Mảnh tận dụng', 'Diện tích phủ từ mảnh thừa m²']);
    for (const room of rooms) {
      const strips = nesting.broadloomStrips.filter((strip) => strip.roomId === room.id);
      const tiles = nesting.tiles.filter((tile) => tile.roomId === room.id);
      const reused = materialType === 'broadloom'
        ? strips.filter((strip) => strip.isReusedFromOffcut)
        : tiles.filter((tile) => tile.status === 'offcut_reused');
      const purchased = materialType === 'broadloom'
        ? strips.filter((strip) => !strip.isReusedFromOffcut).reduce((sum, strip) => sum + strip.lengthMm / 1000, 0).toFixed(3)
        : String(tiles.filter((tile) => tile.status !== 'offcut_reused').length);
      rows.push([room.name, (room.areaMm2 / 1_000_000).toFixed(3), purchased,
        String(reused.length), (reused.reduce((sum, item) => sum +
          (materialType === 'broadloom' ? (item as typeof strips[number]).usedAreaMm2 : (item as typeof tiles[number]).areaMm2), 0) / 1_000_000).toFixed(3)]);
    }
    if (materialType === 'broadloom') {
      rows.push([], ['DANH SÁCH CẮT THẢM CUỘN'],
        ['Mã dải', 'Phòng', 'Nguồn', 'Rộng mm', 'Dài cắt mm', 'Diện tích phôi m²', 'Diện tích phủ m²']);
      for (const strip of nesting.broadloomStrips) {
        rows.push([strip.id, rooms.find((room) => room.id === strip.roomId)?.name ?? strip.roomId ?? '',
          strip.isReusedFromOffcut ? `Mảnh thừa ${strip.reusedFromId ?? ''}` : 'Cuộn mới',
          String(Math.round(strip.widthMm)), String(Math.round(strip.lengthMm)),
          (strip.rawAreaMm2 / 1_000_000).toFixed(3), (strip.usedAreaMm2 / 1_000_000).toFixed(3)]);
      }
    }
  }

  const csvContent = rows
    .map((r) => r.map((cell) => `"${(cell || '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  return '\uFEFF' + csvContent;
}

export function downloadCSV(content: string, filename: string = 'Du_toan_hao_hut_san.csv') {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
