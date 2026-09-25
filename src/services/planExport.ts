import type { NestingResult, Point, RoomGeometry, TileConfig } from '../types';
import { CanvasRenderer, type RenderLayersConfig } from './canvasRenderer';
import { getBroadloomCutPolygon } from './broadloomGeometry';
import { getPolygonBoundingBox } from './geometryMath';

/** Render a print-sized complete layout independently of the current pan and zoom. */
export function renderPlanImage(
  rooms: RoomGeometry[], nesting: NestingResult, origins: Record<string, Point>,
  flipY: boolean, tileConfig: TileConfig
): string | null {
  if (!rooms.length) return null;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;
  const renderer = new CanvasRenderer(context);
  renderer.resize(1400, 900);
  renderer.flipY = flipY;
  renderer.originPoints = origins;
  const bounds = rooms.map((room) => room.bbox);
  for (const strip of nesting.broadloomStrips)
    bounds.push(getPolygonBoundingBox(getBroadloomCutPolygon(strip)));
  const minX = Math.min(...bounds.map((box) => box.minX));
  const minY = Math.min(...bounds.map((box) => box.minY));
  const maxX = Math.max(...bounds.map((box) => box.maxX));
  const maxY = Math.max(...bounds.map((box) => box.maxY));
  renderer.fitToScreen({ minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }, 100);
  const layers: RenderLayersConfig = {
    showRoomBoundary: true, showHoles: true, showFullTiles: true, showCutTiles: true,
    showReusedTiles: true, showOutsideTileGhost: true, showSeams: true,
    showTileIds: true, showGrainDirection: true, showGrid: false,
    showDimensions: true, showOffcutLinks: true, alwaysShowAllLinks: true,
  };
  renderer.render(rooms, nesting, layers, tileConfig);
  return canvas.toDataURL('image/png');
}
