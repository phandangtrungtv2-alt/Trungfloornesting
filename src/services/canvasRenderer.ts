import {
  Point,
  Polygon,
  Ring,
  RoomGeometry,
  NestingResult,
  NestingTile,
  BroadloomStrip,
  BoundingBox,
  TileConfig,
  OffcutFlowLink,
  OffcutItem,
  ResolvedCorridorZone,
} from '../types';
import { doBBoxesIntersect, getPolygonBoundingBox, getPolygonCentroid, isPointInRing } from './geometryMath';
import { getBroadloomCutPolygon, getBroadloomOutsideFloorPolygons,
  getBroadloomOutsidePolygons } from './broadloomGeometry';

export interface ViewportState {
  panX: number;
  panY: number;
  zoom: number;
}

export interface RenderLayersConfig {
  showRoomBoundary: boolean;
  showHoles: boolean;
  showFullTiles: boolean;
  showCutTiles: boolean;
  showReusedTiles: boolean;
  showOutsideTileGhost?: boolean;
  showSeams: boolean;
  showTileIds: boolean;
  showGrainDirection: boolean;
  showGrid: boolean;
  showDimensions: boolean;
  showOffcutLinks: boolean;
  alwaysShowAllLinks: boolean;
}

export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;
  public width: number = 800;
  public height: number = 600;
  private dpr: number = 1;

  public viewport: ViewportState = {
    panX: 50,
    panY: 50,
    zoom: 0.08,
  };

  public fitZoom: number = 0.08;
  public flipY: boolean = true;
  public hoveredTile: NestingTile | null = null;
  public originPoints: Record<string, Point> = {};
  public activeOriginRoomId: string | null = null;
  public snappedVertex: Point | null = null;
  public isDraggingOrigin: boolean = false;
  public zones?: ResolvedCorridorZone[];
  public selectedZoneId: string | null = null;
  private broadloomOutsideCache = new WeakMap<BroadloomStrip, Polygon[]>();

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
    this.dpr = window.devicePixelRatio || 1;
  }

  public resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.dpr = window.devicePixelRatio || 1;

    const canvas = this.ctx.canvas;
    canvas.width = width * this.dpr;
    canvas.height = height * this.dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  public screenToWorld(sx: number, sy: number): Point {
    const wx = (sx - this.viewport.panX) / this.viewport.zoom;
    const wy = this.flipY
      ? (this.viewport.panY - sy) / this.viewport.zoom
      : (sy - this.viewport.panY) / this.viewport.zoom;
    return [wx, wy];
  }

  public worldToScreen(wx: number, wy: number): Point {
    const sx = wx * this.viewport.zoom + this.viewport.panX;
    const sy = this.flipY
      ? this.viewport.panY - wy * this.viewport.zoom
      : wy * this.viewport.zoom + this.viewport.panY;
    return [sx, sy];
  }

  public fitToScreen(bbox: BoundingBox, padding: number = 80) {
    const availableW = this.width - padding * 2;
    const availableH = this.height - padding * 2;

    if (bbox.width <= 0 || bbox.height <= 0) return;

    const zoomX = availableW / bbox.width;
    const zoomY = availableH / bbox.height;
    const zoom = Math.min(zoomX, zoomY, 2.0);
    this.fitZoom = zoom;

    const centerX = (bbox.minX + bbox.maxX) / 2;
    const centerY = (bbox.minY + bbox.maxY) / 2;

    this.viewport = {
      zoom,
      panX: this.width / 2 - centerX * zoom,
      panY: this.flipY
        ? this.height / 2 + centerY * zoom
        : this.height / 2 - centerY * zoom,
    };
  }

  public getViewportWorldBBox(): BoundingBox {
    const p1 = this.screenToWorld(0, 0);
    const p2 = this.screenToWorld(this.width, this.height);

    const minX = Math.min(p1[0], p2[0]);
    const maxX = Math.max(p1[0], p2[0]);
    const minY = Math.min(p1[1], p2[1]);
    const maxY = Math.max(p1[1], p2[1]);

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  public render(
    rooms: RoomGeometry[],
    nesting: NestingResult | null,
    layers: RenderLayersConfig,
    tileConfig?: TileConfig
  ) {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, this.width, this.height);

    if (layers.showGrid) {
      this.drawBackgroundGrid();
    }

    if (rooms.length === 0) {
      ctx.restore();
      return;
    }

    const viewBBox = this.getViewportWorldBBox();

    // 1. Draw Rooms & Holes
    if (layers.showRoomBoundary) {
      for (const room of rooms) {
        this.drawRoom(room, layers.showHoles);
      }
    }

    // 2. Draw Broadloom Strips & Remnants
    if (nesting && nesting.broadloomStrips.length > 0) {
      this.drawBroadloomStrips(nesting.broadloomStrips, rooms, viewBBox, layers);
      if (layers.showReusedTiles) {
        this.drawBroadloomRemnants(nesting.offcutsAvailable, viewBBox);
      }
    }

    // 3. Draw Tiles with Viewport Culling
    if (nesting && nesting.tiles.length > 0) {
      this.drawTiles(nesting.tiles, viewBBox, layers);
    }

    // 4. Draw Seams
    if (nesting && layers.showSeams && nesting.seams.length > 0) {
      this.drawSeams(nesting.seams);
    }

    // 5. Draw Offcut Links
    if (nesting && layers.showOffcutLinks && nesting.offcutLinks.length > 0) {
      this.drawOffcutLinks(nesting.offcutLinks, layers.alwaysShowAllLinks);
    }

    // 5.5. Draw Architectural Wall Overlay (Mặt bằng hiện trạng nổi bật trên thảm)
    if (layers.showRoomBoundary) {
      for (const room of rooms) {
        this.drawRoomWallsOverlay(room, layers.showHoles);
      }
    }

    this.drawZones(this.zones ?? nesting?.zones ?? []);

    // 6. Draw Dimensions (Tổng thể & Từng cạnh tường hiện trạng)
    if (layers.showDimensions && rooms.length > 0) {
      for (const room of rooms) {
        this.drawDimensions(room);
      }
    }

    // 7. Draw Datum Tile
    for (const room of rooms) {
      const point = this.originPoints[room.id];
      if (point) this.drawDatumTile(point, room.name, room.id === this.activeOriginRoomId, tileConfig);
    }

    // 8. Draw Snapped Vertex
    if (this.snappedVertex) {
      this.drawSnappedVertexMarker(this.snappedVertex);
    }

    ctx.restore();
  }

  private drawZones(zones: ResolvedCorridorZone[]) {
    const ctx = this.ctx;
    for (const zone of zones) {
      ctx.save();
      const selected = this.selectedZoneId === zone.id;
      ctx.strokeStyle = selected ? '#fbbf24' : '#60a5fa';
      ctx.fillStyle = selected ? 'rgba(251,191,36,0.08)' : 'rgba(96,165,250,0.025)';
      ctx.lineWidth = selected ? 2.5 : 1.5;
      ctx.setLineDash([8, 4]);
      for (const polygon of zone.polygons) {
        ctx.beginPath();
        for (const ring of polygon) ring.forEach((point, i) => {
          const p = this.worldToScreen(...point);
          if (i === 0) ctx.moveTo(...p); else ctx.lineTo(...p);
        });
        ctx.fill('evenodd'); ctx.stroke();
      }
      const largest = [...zone.polygons].sort((a, b) => {
        const x = getPolygonBoundingBox(a), y = getPolygonBoundingBox(b);
        return y.width * y.height - x.width * x.height;
      })[0];
      if (largest) {
        const b = getPolygonBoundingBox(largest);
        const p = this.worldToScreen((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
        const text = `${zone.name} · ${zone.direction === 'horizontal' ? 'Ngang →' : (this.flipY ? 'Dọc ↑' : 'Dọc ↓')}`;
        ctx.setLineDash([]);
        ctx.font = 'bold 12px sans-serif';
        const width = ctx.measureText(text).width + 14;
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(p[0] - width / 2, p[1] - 33, width, 20);
        ctx.fillStyle = selected ? '#fbbf24' : '#93c5fd';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, p[0], p[1] - 23);
      }
      ctx.restore();
    }
  }

  private drawBackgroundGrid() {
    const ctx = this.ctx;
    ctx.save();

    let spacingMm = 1000;
    if (this.viewport.zoom < 0.02) spacingMm = 5000;
    else if (this.viewport.zoom > 0.3) spacingMm = 200;

    const screenStep = spacingMm * this.viewport.zoom;
    if (screenStep < 20) {
      ctx.restore();
      return;
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;

    const startX = ((this.viewport.panX % screenStep) + screenStep) % screenStep;
    for (let x = startX; x < this.width; x += screenStep) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }

    const startY = ((this.viewport.panY % screenStep) + screenStep) % screenStep;
    for (let y = startY; y < this.height; y += screenStep) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawRoom(room: RoomGeometry, showHoles: boolean) {
    const ctx = this.ctx;
    ctx.save();

    ctx.beginPath();
    this.traceRing(room.boundary);
    ctx.fillStyle = '#111827';
    ctx.fill();

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = Math.max(1.8, 2.5 * this.viewport.zoom * 10);
    ctx.lineJoin = 'round';
    ctx.stroke();

    if (showHoles && room.holes.length > 0) {
      for (const hole of room.holes) {
        ctx.beginPath();
        this.traceRing(hole);
        ctx.fillStyle = '#030712';
        ctx.fill();

        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 2;
        ctx.stroke();

        const [p0, p1, p2, p3] = hole.slice(0, 4);
        if (p0 && p2) {
          const s0 = this.worldToScreen(p0[0], p0[1]);
          const s2 = this.worldToScreen(p2[0], p2[1]);
          ctx.strokeStyle = 'rgba(244, 63, 94, 0.4)';
          ctx.beginPath();
          ctx.moveTo(s0[0], s0[1]);
          ctx.lineTo(s2[0], s2[1]);
          ctx.stroke();
        }
        if (p1 && p3) {
          const s1 = this.worldToScreen(p1[0], p1[1]);
          const s3 = this.worldToScreen(p3[0], p3[1]);
          ctx.strokeStyle = 'rgba(244, 63, 94, 0.4)';
          ctx.beginPath();
          ctx.moveTo(s1[0], s1[1]);
          ctx.lineTo(s3[0], s3[1]);
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }

  /**
   * Draw Crisp Architectural Wall Overlay on top of carpet layers
   * Đảm bảo mặt bằng hiện trạng luôn nổi bật, rõ nét và chuẩn xác
   */
  private drawRoomWallsOverlay(room: RoomGeometry, showHoles: boolean) {
    const ctx = this.ctx;
    ctx.save();

    // 1. Outer Dark Halo for High Contrast against any carpet color
    ctx.beginPath();
    this.traceRing(room.boundary);
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.95)';
    ctx.lineWidth = 4.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // 2. Main Wall Boundary - Bright crisp cyan line
    ctx.beginPath();
    this.traceRing(room.boundary);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.4;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // 3. Corner Vertex Markers (Điểm góc phòng)
    for (const pt of room.boundary) {
      const s = this.worldToScreen(pt[0], pt[1]);
      ctx.beginPath();
      ctx.arc(s[0], s[1], 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#38bdf8';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // 4. Interior Obstacles / Columns
    if (showHoles && room.holes.length > 0) {
      for (const hole of room.holes) {
        ctx.beginPath();
        this.traceRing(hole);
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.95)';
        ctx.lineWidth = 4;
        ctx.lineJoin = 'round';
        ctx.stroke();

        ctx.beginPath();
        this.traceRing(hole);
        ctx.fillStyle = 'rgba(244, 63, 94, 0.15)';
        ctx.fill();
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 2.2;
        ctx.lineJoin = 'round';
        ctx.stroke();

        for (const pt of hole) {
          const s = this.worldToScreen(pt[0], pt[1]);
          ctx.beginPath();
          ctx.arc(s[0], s[1], 3, 0, Math.PI * 2);
          ctx.fillStyle = '#f43f5e';
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }

  private drawTiles(
    tiles: NestingTile[],
    viewBBox: BoundingBox,
    layers: RenderLayersConfig
  ) {
    const ctx = this.ctx;

    for (const tile of tiles) {
      const tileBBox = getPolygonBoundingBox(tile.rawPolygon);
      if (!doBBoxesIntersect(tileBBox, viewBBox)) {
        continue;
      }

      if (tile.status === 'full' && !layers.showFullTiles) continue;
      if (tile.status === 'cut' && !layers.showCutTiles) continue;
      if (tile.status === 'offcut_reused' && !layers.showReusedTiles) continue;

      const isDirectHover = this.hoveredTile?.id === tile.id;
      const isPartner =
        !isDirectHover &&
        Boolean(
          this.hoveredTile &&
            (this.hoveredTile.reusedFromTileId === tile.id ||
              this.hoveredTile.reusedFromId === tile.id ||
              tile.reusedFromTileId === this.hoveredTile.id ||
              tile.reusedFromId === this.hoveredTile.id ||
              this.hoveredTile.donorTargetIds?.includes(tile.id) ||
              tile.donorTargetIds?.includes(this.hoveredTile.id))
        );
      const isSelectedPair = isDirectHover || isPartner;

      let fillColor = 'rgba(59, 130, 246, 0.22)';
      let strokeColor = '#3b82f6';
      let lineWidth = 1;
      let isDashed = false;

      if (tile.status === 'cut') {
        fillColor = 'rgba(245, 158, 11, 0.32)';
        strokeColor = '#f59e0b';
      } else if (tile.status === 'offcut_reused') {
        fillColor = 'rgba(168, 85, 247, 0.35)';
        strokeColor = '#c084fc';
        isDashed = true;
      }

      if (isDirectHover) {
        fillColor = 'rgba(250, 204, 21, 0.45)';
        strokeColor = '#facc15';
        lineWidth = 2.5;
        isDashed = false;
      } else if (isPartner) {
        fillColor = 'rgba(250, 204, 21, 0.28)';
        strokeColor = '#facc15';
        lineWidth = 2.2;
        isDashed = true;
      }

      // 1. Draw outside ghost portion (phần ngoài phòng thể hiện bằng nét đứt để hiện nguyên viên)
      if (
        layers.showOutsideTileGhost !== false &&
        (tile.status === 'cut' || tile.status === 'offcut_reused' || tile.coverageRatio < 0.998)
      ) {
        const offcutsToDraw = tile.offcuts && tile.offcuts.length > 0 ? tile.offcuts : null;

        ctx.save();
        let outsideStroke =
          tile.status === 'offcut_reused'
            ? 'rgba(192, 132, 252, 0.75)'
            : 'rgba(245, 158, 11, 0.75)';
        let outsideFill =
          tile.status === 'offcut_reused'
            ? 'rgba(168, 85, 247, 0.08)'
            : 'rgba(245, 158, 11, 0.08)';
        let outsideLineWidth = 1.2;

        if (isDirectHover) {
          outsideStroke = '#facc15';
          outsideFill = 'rgba(250, 204, 21, 0.25)';
          outsideLineWidth = 2.2;
          ctx.shadowColor = '#facc15';
          ctx.shadowBlur = 10;
        } else if (isPartner) {
          outsideStroke = '#eab308';
          outsideFill = 'rgba(250, 204, 21, 0.15)';
          outsideLineWidth = 1.8;
          ctx.shadowColor = '#eab308';
          ctx.shadowBlur = 6;
        }

        ctx.fillStyle = outsideFill;
        ctx.strokeStyle = outsideStroke;
        ctx.lineWidth = outsideLineWidth;
        ctx.setLineDash([5, 4]);

        if (offcutsToDraw) {
          for (const offItem of offcutsToDraw) {
            for (const ring of offItem.polygon) {
              ctx.beginPath();
              this.traceRing(ring);
              ctx.fill();
              ctx.stroke();
            }
          }
        } else {
          // Fallback: stroke rawPolygon with dashed lines
          for (const ring of tile.rawPolygon) {
            ctx.beginPath();
            this.traceRing(ring);
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      ctx.save();
      if (isSelectedPair) {
        ctx.shadowColor = '#facc15';
        ctx.shadowBlur = isDirectHover ? 14 : 9;
      }
      ctx.fillStyle = fillColor;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineWidth;

      if (isDashed) {
        ctx.setLineDash([5, 4]);
      }

      for (const poly of tile.clippedPolygons) {
        ctx.beginPath();
        for (const ring of poly) {
          this.traceRing(ring);
        }
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();

      if (layers.showGrainDirection && this.viewport.zoom > 0.04) {
        this.drawGrainArrow(tile);
      }

      // Level of Detail (LOD): Only draw ID text when canvas relative zoom >= 2.5x OR if hovered/partner!
      const relativeZoom = this.fitZoom > 0 ? this.viewport.zoom / this.fitZoom : 1;
      const isLODActive = relativeZoom >= 2.5;

      if (layers.showTileIds && (isLODActive || isSelectedPair)) {
        const sCenter = this.worldToScreen(tile.center[0], tile.center[1]);
        const displayCode = tile.matchingCode || `#${String(tile.originalIndex + 1).padStart(2, '0')}`;

        ctx.save();
        ctx.font = 'bold 10px monospace';
        const tw = ctx.measureText(displayCode).width;
        const pillW = tw + 8;
        const pillH = 16;

        ctx.fillStyle = isDirectHover
          ? '#facc15'
          : isPartner
          ? '#eab308'
          : tile.status === 'offcut_reused'
          ? 'rgba(168, 85, 247, 0.92)'
          : tile.matchingCode?.startsWith('S-')
          ? 'rgba(245, 158, 11, 0.92)'
          : 'rgba(15, 23, 42, 0.88)';

        ctx.strokeStyle = isSelectedPair ? '#ffffff' : 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(sCenter[0] - pillW / 2, sCenter[1] - pillH / 2, pillW, pillH, 3);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isSelectedPair ? '#0f172a' : '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(displayCode, sCenter[0], sCenter[1]);
        ctx.restore();
      }
    }
  }

  /**
   * Draw Broadloom Strips with Name and Roll Direction Arrows
   */
  private drawBroadloomStrips(
    strips: BroadloomStrip[],
    rooms: RoomGeometry[],
    viewBBox: BoundingBox,
    layers: RenderLayersConfig
  ) {
    const ctx = this.ctx;
    const roomById = new Map(rooms.map((room) => [room.id, room]));

    for (const strip of strips) {
      const bbox = getPolygonBoundingBox(getBroadloomCutPolygon(strip));
      if (!doBBoxesIntersect(bbox, viewBBox)) continue;

      const isReused = strip.isReusedFromOffcut;
      const hoveredSliceCode = (this.hoveredTile as any)?.sourceSliceCode;
      const hoveredMatchingCode = (this.hoveredTile as any)?.matchingCode;
      const hoveredTargetStripId = (this.hoveredTile as any)?.targetStripId;

      const isStripHighlighted =
        this.hoveredTile?.id === strip.id ||
        hoveredTargetStripId === strip.id ||
        Boolean(strip.matchingCode && hoveredMatchingCode === strip.matchingCode) ||
        Boolean(strip.sourceSliceCode && hoveredSliceCode === strip.sourceSliceCode) ||
        Boolean(!hoveredSliceCode && !hoveredMatchingCode && !hoveredTargetStripId && strip.reusedFromId && this.hoveredTile?.reusedFromId === strip.reusedFromId && this.hoveredTile?.id === strip.reusedFromId);

      if (layers.showOutsideTileGhost !== false) {
        let outside = this.broadloomOutsideCache.get(strip);
        if (!outside) {
          const room = strip.roomId ? roomById.get(strip.roomId) : undefined;
          outside = room ? getBroadloomOutsideFloorPolygons(strip, room)
            : getBroadloomOutsidePolygons(strip);
          this.broadloomOutsideCache.set(strip, outside);
        }
        if (outside.length) {
          ctx.save();
          ctx.fillStyle = isStripHighlighted ? 'rgba(250, 204, 21, 0.18)'
            : isReused ? 'rgba(168, 85, 247, 0.09)' : 'rgba(45, 212, 191, 0.08)';
          ctx.strokeStyle = isStripHighlighted ? '#facc15'
            : isReused ? 'rgba(192, 132, 252, 0.75)' : 'rgba(45, 212, 191, 0.7)';
          ctx.lineWidth = isStripHighlighted ? 2.2 : 1.3;
          ctx.setLineDash([6, 4]);
          for (const polygon of outside) {
            ctx.beginPath();
            for (const ring of polygon) this.traceRing(ring);
            ctx.fill('evenodd');
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      ctx.save();
      if (isStripHighlighted) {
        ctx.fillStyle = 'rgba(234, 179, 8, 0.35)'; // Vibrant golden yellow
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2.2;
        ctx.setLineDash([]);
        ctx.shadowColor = '#facc15';
        ctx.shadowBlur = 8;
      } else {
        ctx.fillStyle = isReused
          ? 'rgba(168, 85, 247, 0.32)' // Reused offcut strip in purple
          : 'rgba(20, 184, 166, 0.22)'; // Standard strip in teal

        ctx.strokeStyle = isReused
          ? '#c084fc'
          : 'rgba(45, 212, 191, 0.75)';

        ctx.lineWidth = 1.5;

        if (isReused) {
          ctx.setLineDash([6, 4]);
        }
      }

      for (const poly of strip.clippedPolygons) {
        ctx.beginPath();
        for (const ring of poly) {
          this.traceRing(ring);
        }
        ctx.fill();
        ctx.stroke();
      }

      // 1. Draw Double-Headed Roll Direction Arrow (Mũi tên 2 chiều không text)
      this.drawRollDirectionArrow(strip);

      // 2. Draw Name: "Roll 3.66" / Tấm đích chỉ hiển thị mã "P-01"
      if (layers.showTileIds && this.viewport.zoom > 0.003) {
        const s = this.worldToScreen(strip.center[0], strip.center[1]);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        let line1 = '';
        let line2 = '';

        if (isReused) {
          // Mảnh cắt tận dụng từ thảm thừa: chỉ cần hiển thị mã tấm đích ví dụ "P-01"
          line1 = strip.matchingCode || strip.name.split(' (')[0];
          line2 = '';
        } else {
          // Cuộn thảm đặt mua: "Roll 3.66" (xuống hàng) "(x m)"
          line1 = strip.name.split(' (')[0];
          line2 = `(${(strip.lengthMm / 1000).toFixed(1)}m)`;
        }

        const lines = [line1, line2].filter(Boolean);
        const lineHeight = 14;

        ctx.font = 'bold 11px sans-serif';
        const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width));
        const pillW = maxW + 12;
        const pillH = lines.length * lineHeight + 8;

        ctx.fillStyle = isStripHighlighted
          ? 'rgba(30, 27, 75, 0.95)'
          : isReused
          ? 'rgba(59, 7, 100, 0.85)'
          : 'rgba(15, 23, 42, 0.85)';
        ctx.strokeStyle = isStripHighlighted
          ? '#facc15'
          : isReused
          ? 'rgba(192, 132, 252, 0.6)'
          : 'rgba(45, 212, 191, 0.6)';
        ctx.lineWidth = isStripHighlighted ? 1.5 : 1;
        ctx.beginPath();
        ctx.roundRect(s[0] - pillW / 2, s[1] - pillH / 2, pillW, pillH, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isStripHighlighted ? '#fde047' : isReused ? '#f3e8ff' : '#5eead4';
        const startY = s[1] - (lines.length - 1) * (lineHeight / 2);
        lines.forEach((line, i) => {
          ctx.fillText(line, s[0], startY + i * lineHeight);
        });
      }

      ctx.restore();
    }
  }

  /**
   * Draw Clean Double-Headed Arrow Along Broadloom Strip (No text)
   */
  private drawRollDirectionArrow(strip: BroadloomStrip) {
    const ctx = this.ctx;
    const p1 = this.worldToScreen(strip.directionStart[0], strip.directionStart[1]);
    const p2 = this.worldToScreen(strip.directionEnd[0], strip.directionEnd[1]);

    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const len = Math.hypot(dx, dy);

    if (len < 25) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(45, 212, 191, 0.65)';
    ctx.fillStyle = 'rgba(45, 212, 191, 0.65)';
    ctx.lineWidth = 2.2;
    ctx.setLineDash([8, 6]);

    // Shaft
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.stroke();

    const angle = Math.atan2(dy, dx);
    const headLen = 11;
    ctx.setLineDash([]);

    // 1. Arrowhead at end (p2)
    ctx.beginPath();
    ctx.moveTo(p2[0], p2[1]);
    ctx.lineTo(
      p2[0] - headLen * Math.cos(angle - Math.PI / 6),
      p2[1] - headLen * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      p2[0] - headLen * Math.cos(angle + Math.PI / 6),
      p2[1] - headLen * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();

    // 2. Arrowhead at start (p1) pointing backward
    if (!strip.zoneId) {
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(
      p1[0] + headLen * Math.cos(angle - Math.PI / 6),
      p1[1] + headLen * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      p1[0] + headLen * Math.cos(angle + Math.PI / 6),
      p1[1] + headLen * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
    }

    ctx.restore();
  }

  /**
   * Draw Broadloom Remnant Offcuts on the floor layout
   */
  private drawBroadloomRemnants(offcuts: OffcutItem[], viewBBox: BoundingBox) {
    const ctx = this.ctx;

    for (const off of offcuts) {
      if (!off.isBroadloomLongitudinal) continue;
      if (!doBBoxesIntersect(off.bbox, viewBBox)) continue;

      if (off.subSlices && off.subSlices.length > 0) {
        // Remnant was sliced into individual pieces
        // 1. Draw remnant outer background container
        ctx.save();
        ctx.fillStyle = 'rgba(88, 28, 135, 0.08)';
        ctx.strokeStyle = 'rgba(192, 132, 252, 0.4)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([6, 4]);
        for (const ring of off.polygon) {
          ctx.beginPath();
          this.traceRing(ring);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();

        // 2. Draw each sub-slice with badge label
        for (const slice of off.subSlices) {
          const hoveredStripCode = (this.hoveredTile as any)?.sourceSliceCode;
          const isSliceHighlighted =
            this.hoveredTile?.id === slice.targetStripId ||
            this.hoveredTile?.id === slice.id ||
            Boolean(slice.targetCode && (this.hoveredTile as any)?.matchingCode === slice.targetCode) ||
            Boolean(slice.code && hoveredStripCode === slice.code) ||
            Boolean(!hoveredStripCode && off.id && this.hoveredTile?.reusedFromId === off.id);

          ctx.save();
          if (isSliceHighlighted) {
            ctx.fillStyle = 'rgba(234, 179, 8, 0.35)'; // Vibrant golden yellow
            ctx.strokeStyle = '#facc15';
            ctx.lineWidth = 2.2;
            ctx.setLineDash([6, 3]); // Dashed line for slice boundary
            ctx.shadowColor = '#facc15';
            ctx.shadowBlur = 8;
          } else {
            ctx.fillStyle = 'rgba(168, 85, 247, 0.22)';
            ctx.strokeStyle = '#c084fc';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]); // Dashed line for slice boundary (S-01, S-02...)
          }

          for (const ring of slice.polygon) {
            ctx.beginPath();
            this.traceRing(ring);
            ctx.fill();
            ctx.stroke();
          }

          // Slice Badge Label - visible across all zoom levels
          if (this.viewport.zoom > 0.003) {
            const sc = this.worldToScreen(slice.center[0], slice.center[1]);
            const wM = (slice.widthMm / 1000).toFixed(2);
            const lM = (slice.lengthMm / 1000).toFixed(2);

            const showDetailedBadge = this.viewport.zoom >= 0.008;
            const line1 = showDetailedBadge
              ? `${slice.code} ➔ ${slice.targetCode}`
              : slice.code;
            const line2 = `${lM}m x ${wM}m`;
            const lines = showDetailedBadge ? [line1, line2] : [line1];
            const lineHeight = 13;

            ctx.font = 'bold 10px sans-serif';
            const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width));
            const pillW = maxW + 10;
            const pillH = lines.length * lineHeight + 4;

            ctx.fillStyle = isSliceHighlighted ? 'rgba(30, 27, 75, 0.95)' : 'rgba(59, 7, 100, 0.90)';
            ctx.strokeStyle = isSliceHighlighted ? '#facc15' : 'rgba(192, 132, 252, 0.8)';
            ctx.lineWidth = isSliceHighlighted ? 1.5 : 1;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.roundRect(sc[0] - pillW / 2, sc[1] - pillH / 2, pillW, pillH, 4);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = isSliceHighlighted ? '#fde047' : '#f3e8ff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const startY = sc[1] - (lines.length - 1) * (lineHeight / 2);
            lines.forEach((l, i) => {
              ctx.fillText(l, sc[0], startY + i * lineHeight);
            });
          }

          ctx.restore();
        }

        // 3. Draw Leftover scrap if remaining > 50mm
        const leftovers = off.leftoverPolygons?.length ? off.leftoverPolygons
          : off.leftoverPolygon && off.remainingLengthMm && off.remainingLengthMm > 50
            ? [off.leftoverPolygon] : [];
        if (leftovers.length) {
          ctx.save();
          ctx.fillStyle = 'rgba(51, 65, 85, 0.28)';
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.6)';
          ctx.lineWidth = 1.2;
          ctx.setLineDash([4, 4]);

          for (const polygon of leftovers) {
            for (const ring of polygon) {
              ctx.beginPath();
              this.traceRing(ring);
              ctx.fill();
              ctx.stroke();
            }
          }

          if (this.viewport.zoom > 0.003) {
            const loCenter = getPolygonCentroid(leftovers[0]);
            const s = this.worldToScreen(loCenter[0], loCenter[1]);
            const label = off.leftoverPolygons?.length
              ? `CÒN THỪA (${((off.remainingAreaMm2 ?? 0) / 1_000_000).toFixed(2)} m²)`
              : `CÒN THỪA (${((off.remainingLengthMm ?? 0) / 1000).toFixed(2)}m x ${(off.width / 1000).toFixed(2)}m)`;

            ctx.font = 'bold 9px sans-serif';
            ctx.fillStyle = '#94a3b8';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, s[0], s[1]);
          }
          ctx.restore();
        }

        // 4. Header Badge above Remnant
        if (this.viewport.zoom > 0.003) {
          ctx.save();
          const sTop = this.worldToScreen(off.center[0], off.bbox.minY - 100 / this.viewport.zoom);
          const totalLM = (Math.max(off.width, off.height) / 1000).toFixed(2);
          const totalWM = (Math.min(off.width, off.height) / 1000).toFixed(2);
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = '#e9d5ff';
          ctx.fillText(`MẢNG THỪA GỐC: ${totalLM}m x ${totalWM}m (Đã chia ${off.subSlices.length} tấm)`, sTop[0], sTop[1]);
          ctx.restore();
        }
      } else {
        // Standard unsegmented remnant
        ctx.save();
        ctx.fillStyle = 'rgba(168, 85, 247, 0.18)';
        ctx.strokeStyle = '#c084fc';
        ctx.lineWidth = 1.8;
        ctx.setLineDash([6, 4]);

        for (const ring of off.polygon) {
          ctx.beginPath();
          this.traceRing(ring);
          ctx.fill();
          ctx.stroke();
        }

        if (this.viewport.zoom > 0.015) {
          const s = this.worldToScreen(off.center[0], off.center[1]);
          ctx.font = 'bold 11px sans-serif';
          ctx.fillStyle = '#e9d5ff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const wM = (Math.min(off.width, off.height) / 1000).toFixed(1);
          const lM = (Math.max(off.width, off.height) / 1000).toFixed(1);
          ctx.fillText(`MẢNG THỪA (${lM}m x ${wM}m)`, s[0], s[1] - (off.assignedToTileId ? 8 : 0));

          if (off.assignedToTileId) {
            ctx.font = 'bold 10px sans-serif';
            ctx.fillStyle = '#c084fc';
            ctx.fillText(`[TẬN DỤNG CẮT GHÉP: ${off.assignedToTileId}]`, s[0], s[1] + 10);
          }
        }

        ctx.restore();
      }
    }
  }

  private drawSeams(seams: any[]) {
    const ctx = this.ctx;
    ctx.save();

    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 6]);

    for (const seam of seams) {
      const s1 = this.worldToScreen(seam.start[0], seam.start[1]);
      const s2 = this.worldToScreen(seam.end[0], seam.end[1]);

      ctx.beginPath();
      ctx.moveTo(s1[0], s1[1]);
      ctx.lineTo(s2[0], s2[1]);
      ctx.stroke();

      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(s1[0], s1[1], 4, 0, Math.PI * 2);
      ctx.arc(s2[0], s2[1], 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawOffcutLinks(links: OffcutFlowLink[], alwaysShowAll: boolean = false) {
    const ctx = this.ctx;
    if (!links || links.length === 0) return;

    // 1. Determine which links to draw based on Smart Trace rules
    const hoveredSliceCode = (this.hoveredTile as any)?.sourceSliceCode;
    const hoveredMatchingCode = (this.hoveredTile as any)?.matchingCode;
    const activeLinks = this.hoveredTile
      ? links.filter(
          (link) =>
            link.sourceTileId === this.hoveredTile?.id ||
            link.targetTileId === this.hoveredTile?.id ||
            Boolean((this.hoveredTile as any)?.targetStripId === link.targetTileId) ||
            Boolean(hoveredMatchingCode && hoveredMatchingCode === link.targetCode) ||
            Boolean(hoveredSliceCode && hoveredSliceCode === link.sourceCode) ||
            Boolean(!hoveredSliceCode && !hoveredMatchingCode && link.sourceOffcutId === this.hoveredTile?.reusedFromId) ||
            Boolean(this.hoveredTile?.donorTargetIds && this.hoveredTile.donorTargetIds.includes(link.targetTileId))
        )
      : [];

    // Default state: If alwaysShowAll is false and no active tile hovered, hide ALL trace lines completely!
    if (!alwaysShowAll && activeLinks.length === 0) {
      return;
    }

    const linksToRender = alwaysShowAll ? links : activeLinks;

    for (const link of linksToRender) {
      const isHighlighted =
        this.hoveredTile?.id === link.sourceTileId ||
        this.hoveredTile?.id === link.targetTileId ||
        Boolean((this.hoveredTile as any)?.targetStripId === link.targetTileId) ||
        Boolean(hoveredMatchingCode && hoveredMatchingCode === link.targetCode) ||
        Boolean(hoveredSliceCode && hoveredSliceCode === link.sourceCode) ||
        Boolean(!hoveredSliceCode && !hoveredMatchingCode && this.hoveredTile?.reusedFromId === link.sourceOffcutId) ||
        Boolean(this.hoveredTile?.donorTargetIds?.includes(link.targetTileId));

      const pStart = this.worldToScreen(link.sourceCenter[0], link.sourceCenter[1]);
      const pEnd = this.worldToScreen(link.targetCenter[0], link.targetCenter[1]);

      const dx = pEnd[0] - pStart[0];
      const dy = pEnd[1] - pStart[1];
      const dist = Math.hypot(dx, dy);

      if (dist < 5) continue;

      const normalX = -dy / dist;
      const normalY = dx / dist;
      const arcHeight = Math.min(80, Math.max(25, dist * 0.22));

      const cx = (pStart[0] + pEnd[0]) / 2 + normalX * arcHeight;
      const cy = (pStart[1] + pEnd[1]) / 2 + normalY * arcHeight;

      ctx.save();

      // Golden Neon Glow for active/hovered trace line; subtle purple for background all-links mode
      if (isHighlighted) {
        ctx.shadowColor = '#facc15';
        ctx.shadowBlur = 12;
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
      } else {
        ctx.strokeStyle = 'rgba(192, 132, 252, 0.35)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
      }

      ctx.beginPath();
      ctx.moveTo(pStart[0], pStart[1]);
      ctx.quadraticCurveTo(cx, cy, pEnd[0], pEnd[1]);
      ctx.stroke();

      // Source Dot Marker
      ctx.fillStyle = isHighlighted ? '#facc15' : 'rgba(192, 132, 252, 0.6)';
      ctx.beginPath();
      ctx.arc(pStart[0], pStart[1], isHighlighted ? 5 : 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Directional Arrow at Target
      const t = 0.98;
      const sampleX = (1 - t) * (1 - t) * pStart[0] + 2 * (1 - t) * t * cx + t * t * pEnd[0];
      const sampleY = (1 - t) * (1 - t) * pStart[1] + 2 * (1 - t) * t * cy + t * t * pEnd[1];
      const angle = Math.atan2(pEnd[1] - sampleY, pEnd[0] - sampleX);

      const arrowLen = isHighlighted ? 11 : 7;
      ctx.fillStyle = isHighlighted ? '#facc15' : 'rgba(192, 132, 252, 0.6)';
      ctx.beginPath();
      ctx.moveTo(pEnd[0], pEnd[1]);
      ctx.lineTo(
        pEnd[0] - arrowLen * Math.cos(angle - Math.PI / 6),
        pEnd[1] - arrowLen * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        pEnd[0] - arrowLen * Math.cos(angle + Math.PI / 6),
        pEnd[1] - arrowLen * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();

      // Khử đè chữ: CHỈ vẽ nhãn pill badge khi đường nối đang được HOVER / HIGHLIGHTED!
      // Hiển thị mã nguồn ➔ mã đích (không kèm diện tích theo yêu cầu)
      if (isHighlighted) {
        const sCode = link.sourceCode || 'S';
        const tCode = link.targetCode || 'P';
        const badgeLabel = `${sCode} ➔ ${tCode}`;

        ctx.font = 'bold 11px monospace';
        const textW = ctx.measureText(badgeLabel).width;
        const pillW = textW + 14;
        const pillH = 20;

        ctx.shadowColor = '#000';
        ctx.shadowBlur = 8;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(cx - pillW / 2, cy - pillH / 2, pillW, pillH, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#facc15';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeLabel, cx, cy);
      }

      ctx.restore();
    }
  }

  private drawDatumTile(originPoint: Point, roomName: string, active: boolean, tileConfig?: TileConfig) {
    const s = this.worldToScreen(originPoint[0], originPoint[1]);
    const ctx = this.ctx;
    ctx.save();

    if (tileConfig) {
      const w = tileConfig.width;
      const h = tileConfig.height;

      const p0 = s;
      const p1 = this.worldToScreen(originPoint[0] + w, originPoint[1]);
      const p2 = this.worldToScreen(originPoint[0] + w, originPoint[1] + h);
      const p3 = this.worldToScreen(originPoint[0], originPoint[1] + h);

      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.lineTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.lineTo(p3[0], p3[1]);
      ctx.closePath();

      ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
      ctx.fill();
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
    }

    const r = active && this.isDraggingOrigin ? 12 : 9;

    ctx.setLineDash([]);
    ctx.strokeStyle = '#10b981';
    ctx.fillStyle = active && this.isDraggingOrigin ? '#10b981' : 'rgba(16, 185, 129, 0.4)';
    ctx.lineWidth = 2.5;

    ctx.beginPath();
    ctx.arc(s[0], s[1], r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(s[0] - r * 1.8, s[1]);
    ctx.lineTo(s[0] + r * 1.8, s[1]);
    ctx.moveTo(s[0], s[1] - r * 1.8);
    ctx.lineTo(s[0], s[1] + r * 1.8);
    ctx.stroke();

    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = '#10b981';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const shortName = roomName.match(/^Phòng\s+\d+/i)?.[0] ?? roomName.slice(0, 18);
    ctx.fillText(`MỐC ${shortName} (Kéo thả)`, s[0] + r + 6, s[1]);

    ctx.restore();
  }

  private drawSnappedVertexMarker(vertex: Point) {
    const s = this.worldToScreen(vertex[0], vertex[1]);
    const ctx = this.ctx;
    ctx.save();

    const r = 10;
    ctx.strokeStyle = '#34d399';
    ctx.fillStyle = 'rgba(52, 211, 153, 0.35)';
    ctx.lineWidth = 2.5;

    ctx.beginPath();
    ctx.moveTo(s[0], s[1] - r);
    ctx.lineTo(s[0] + r, s[1]);
    ctx.lineTo(s[0], s[1] + r);
    ctx.lineTo(s[0] - r, s[1]);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = '#34d399';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`Góc phòng (${Math.round(vertex[0])}, ${Math.round(vertex[1])})`, s[0], s[1] + r + 4);

    ctx.restore();
  }

  private drawGrainArrow(tile: NestingTile) {
    const sCenter = this.worldToScreen(tile.center[0], tile.center[1]);
    const arrowLen = Math.min(24, Math.max(12, 150 * this.viewport.zoom));
    const rad = (tile.grainAngle * Math.PI) / 180;

    const dx = Math.cos(rad) * arrowLen;
    const dy = (this.flipY ? -1 : 1) * Math.sin(rad) * arrowLen;

    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1.2;

    ctx.beginPath();
    ctx.moveTo(sCenter[0] - dx / 2, sCenter[1] - dy / 2);
    ctx.lineTo(sCenter[0] + dx / 2, sCenter[1] + dy / 2);
    ctx.stroke();

    const tipX = sCenter[0] + dx / 2;
    const tipY = sCenter[1] + dy / 2;
    const headLen = 4;
    const angle = Math.atan2(dy, dx);

    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(
      tipX - headLen * Math.cos(angle - Math.PI / 6),
      tipY - headLen * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      tipX - headLen * Math.cos(angle + Math.PI / 6),
      tipY - headLen * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  private drawDimensions(room: RoomGeometry) {
    const { bbox, name: title, boundary } = room;
    const ctx = this.ctx;
    ctx.save();

    // Kích thước các cạnh tường hiện trạng (Segment Dimensions dọc theo cạnh phòng)
    if (this.viewport.zoom > 0.003 && boundary && boundary.length > 2) {
      const n = boundary.length;

      for (let i = 0; i < n; i++) {
        const p1 = boundary[i];
        const p2 = boundary[(i + 1) % n];
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const len = Math.hypot(dx, dy);
        if (len < 400) continue;

        const midX = (p1[0] + p2[0]) / 2;
        const midY = (p1[1] + p2[1]) / 2;

        // Pháp tuyến vuông góc với cạnh tường
        let nx = -(dy / len);
        let ny = dx / len;

        // Đảm bảo pháp tuyến luôn hướng ra NGOÀI phòng (kể cả phòng lõm, chữ L)
        const testDist = 50;
        if (isPointInRing([midX + nx * testDist, midY + ny * testDist], boundary)) {
          nx = -nx;
          ny = -ny;
        }

        // Đặt text giá trị kích thước cách tường một khoảng cố định theo màn hình (14px ra ngoài phòng)
        const dimOffsetScreen = 14;
        const offsetWorld = dimOffsetScreen / this.viewport.zoom;
        const sMid = this.worldToScreen(midX + nx * offsetWorld, midY + ny * offsetWorld);

        const s1 = this.worldToScreen(p1[0], p1[1]);
        const s2 = this.worldToScreen(p2[0], p2[1]);
        const sDx = s2[0] - s1[0];
        const sDy = s2[1] - s1[1];

        let angle = Math.atan2(sDy, sDx);
        // Chuẩn hóa góc để chữ luôn xuôi chiều mắt đọc (không bị ngược đầu)
        if (angle > Math.PI / 2) angle -= Math.PI;
        else if (angle < -Math.PI / 2) angle += Math.PI;

        const segText = `${(len / 1000).toFixed(2)}m`;
        ctx.font = 'bold 10px monospace';
        const tw = ctx.measureText(segText).width;

        ctx.save();
        ctx.translate(sMid[0], sMid[1]);
        ctx.rotate(angle);

        // Khung nền pill nhẹ che nền giúp text luôn dễ đọc
        ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.roundRect(-tw / 2 - 4, -7, tw + 8, 14, 3);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#38bdf8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(segText, 0, 0);

        ctx.restore();
      }
    }

    if (title) {
      const sCenter = this.worldToScreen(bbox.minX + bbox.width / 2, bbox.maxY + 700);
      ctx.save();
      ctx.font = 'bold 22px sans-serif';
      ctx.fillStyle = '#38bdf8';
      const titleWidth = ctx.measureText(title).width;
      const roomWidth = bbox.width * this.viewport.zoom;
      const rightEdge = this.worldToScreen(bbox.maxX, bbox.maxY)[0];
      let titleX = sCenter[0];
      let titleAlign: CanvasTextAlign = 'center';
      if (roomWidth < titleWidth + 20 && rightEdge + titleWidth + 24 < this.width) {
        titleX = rightEdge + 16;
        titleAlign = 'left';
      }
      ctx.textAlign = titleAlign;
      ctx.textBaseline = 'bottom';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      ctx.shadowBlur = 6;
      ctx.fillText(title, titleX, sCenter[1]);
      ctx.restore();
    }

    ctx.restore();
  }

  private traceRing(ring: Ring) {
    if (ring.length === 0) return;
    const p0 = this.worldToScreen(ring[0][0], ring[0][1]);
    this.ctx.moveTo(p0[0], p0[1]);
    for (let i = 1; i < ring.length; i++) {
      const p = this.worldToScreen(ring[i][0], ring[i][1]);
      this.ctx.lineTo(p[0], p[1]);
    }
    this.ctx.closePath();
  }
}
