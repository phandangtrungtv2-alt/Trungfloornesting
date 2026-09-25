// Geometry Primitives
export type Point = [number, number];
export type Ring = Point[];
export type Polygon = Ring[];
export type MultiPolygon = Polygon[];

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface RoomGeometry {
  id: string;
  name: string;
  boundary: Ring;
  holes: Ring[];
  bbox: BoundingBox;
  areaMm2: number;
}

// DXF Structure
export type UnitType = 'mm' | 'cm' | 'm';

export interface DxfLayerInfo {
  name: string;
  color: number;
  entityCount: number;
  isRoomBoundary?: boolean;
  isObstacle?: boolean;
}

// Material & Pattern Config
export type MaterialCategory = 'broadloom' | 'carpet_tile' | 'lvt_pvc';

export type RollDirection = 'horizontal' | 'vertical';
export interface CorridorZone {
  id: string;
  roomId: string;
  name: string;
  direction: RollDirection;
  bounds: BoundingBox;
}
export interface ResolvedCorridorZone extends CorridorZone {
  polygons: Polygon[];
  areaMm2: number;
}
export interface ZoneQuantity {
  zoneId: string;
  name: string;
  roomId: string;
  roomName?: string;
  direction: RollDirection;
  floorAreaM2: number;
  linearMeters: number;
  reusedAreaM2: number;
  reusedPieces: number;
}

export interface BroadloomConfig {
  rollWidth: number;       // mm (e.g. 3660, 4000)
  maxRollLength: number;   // mm (e.g. 35000)
  seamOverlap: number;     // mm (e.g. 30)
  direction: RollDirection;
  layoutMode?: 'whole' | 'corridor';
  seamPenaltyM2PerM?: number; // extra m²-equivalent cost for each metre of seam in auto mode
  cutAllowanceMm?: number;     // mm  - phu cap cat cho moi doan cuon (mac dinh 100)
  minRemnantWidthMm?: number;  // mm  - nguong canh nho nhat mang thua (mac dinh 400)
  minRemnantAreaMm2?: number;  // mm2 - nguong dien tich nho nhat mang thua (mac dinh 250000)
}

export interface TileConfig {
  width: number;           // mm (e.g. 500)
  height: number;          // mm (e.g. 500)
  tilesPerBox?: number;
  m2PerBox?: number;
}

export type LayingPattern = 
  | 'monolithic' 
  | 'quarter_turn' 
  | 'ashlar' 
  | 'stagger' 
  | 'herringbone_90' 
  | 'herringbone_45';

export type OriginSnapType = 'bottom_left' | 'center' | 'top_left' | 'custom';

// Offcut Engine
export interface OffcutConfig {
  enabled: boolean;
  minWidth: number;     // mm
  minHeight: number;    // mm
  minBroadloomWidth?: number; // mm, minimum short side of a reusable roll remnant
  allowRotate: boolean; // Pile direction rule
}

export type TileStatus = 'full' | 'cut' | 'offcut_reused';

export interface OffcutSubSlice {
  id: string;
  code: string;            // e.g. "S-01"
  targetCode: string;      // e.g. "P-01"
  targetStripId: string;   // e.g. "STRIP-CUT-1"
  polygon: Polygon;
  center: Point;
  widthMm: number;
  lengthMm: number;
  index: number;
}

export interface OffcutItem {
  id: string;
  sourceTileId: string;
  polygon: Polygon;
  bbox: BoundingBox;
  center: Point;
  areaMm2: number;
  width: number;
  height: number;
  grainAngle: number;
  isDiscarded: boolean;
  assignedToTileId?: string;
  isBroadloomLongitudinal?: boolean;
  remainingAreaMm2?: number;
  remainingLengthMm?: number;
  subSlices?: OffcutSubSlice[];
  leftoverPolygon?: Polygon;
  leftoverPolygons?: Polygon[];
}

export interface OffcutFlowLink {
  id: string;
  pairIndex?: number;
  sourceCode?: string; // e.g. "S-01"
  targetCode?: string; // e.g. "P-01"
  sourceTileId: string;
  sourceOffcutId: string;
  targetTileId: string;
  sourceCenter: Point;
  targetCenter: Point;
  areaMm2: number;
  label?: string;
  sourceWidthMm?: number;
  sourceHeightMm?: number;
  targetWidthMm?: number;
  targetHeightMm?: number;
}

export interface NestingTile {
  id: string;
  roomId?: string;
  originalIndex: number;
  row: number;
  col: number;
  rawPolygon: Polygon;
  clippedPolygons: Polygon[];
  status: TileStatus;
  areaMm2: number;
  rawAreaMm2: number;
  coverageRatio: number;
  rotationDeg: number;
  grainAngle: number;
  isQuarterTurnRotated?: boolean;
  reusedFromId?: string;
  reusedFromTileId?: string;
  reusedSourceCode?: string;
  matchingCode?: string;
  sourceSliceCode?: string;
  donorTargetCodes?: string[];
  donorTargetIds?: string[];
  offcuts: OffcutItem[];
  center: Point;
}

export interface BroadloomSeam {
  start: Point;
  end: Point;
  lengthMm: number;
}

export interface BroadloomStrip {
  id: string;
  parentStripId?: string;
  name: string; // e.g. "CUỘN SỐ - 1"
  roomId?: string;
  zoneId?: string;
  index: number;
  rawPolygon: Polygon;
  clippedPolygons: Polygon[];
  rawAreaMm2: number;
  usedAreaMm2: number;
  lengthMm: number;
  widthMm: number;
  usedWidthMm: number;
  laneCount?: number;
  isReusedFromOffcut?: boolean;
  reusedFromId?: string;
  sourceSliceCode?: string;
  matchingCode?: string;
  offcuts: OffcutItem[];
  center: Point;
  directionStart: Point;
  directionEnd: Point;
}

export interface NestingResult {
  zones?: ResolvedCorridorZone[];
  zoneQuantities?: ZoneQuantity[];
  layoutEngine?: 'rect' | 'band';
  layDirection?: 'horizontal' | 'vertical';
  tiles: NestingTile[];
  broadloomStrips: BroadloomStrip[];
  seams: BroadloomSeam[];
  offcutsAvailable: OffcutItem[];
  offcutsReused: OffcutItem[];
  discardedScraps: OffcutItem[];
  offcutLinks: OffcutFlowLink[];
  totalRawTiles: number;
  totalLinearMeters: number;
  computationTimeMs: number;
}

export interface BOQSummary {
  netFloorAreaM2: number;
  grossAreaM2: number;
  extraAreaM2: number;
  reusableAreaM2: number;
  seamOverlapAreaM2: number;
  wasteAreaM2: number;
  lossPercentage: number;
  materialDimensionLabel: string;
  fullTilesCount: number;
  cutTilesCount: number;
  reusedOffcutsCount: number;
  totalRawTilesNeeded: number;
  seamLengthMeters: number;
  linearMeters: number;
  broadloomStripCount?: number;
  installedPiecesCount?: number;
  totalBoxesNeeded?: number;
  savedAreaM2: number;
  laneSplitSegments?: number;
}
