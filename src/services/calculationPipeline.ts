import type {
  BOQSummary, BroadloomConfig, LayingPattern, MaterialCategory, NestingResult,
  OffcutConfig, Point, RoomGeometry, TileConfig, CorridorZone,
} from '../types';
import { computeNesting } from './nestingEngine';
import { optimizeOffcuts } from './offcutManager';
import { calculateBOQ } from './boqService';
import { validateNesting } from './nestingValidation';
import { calculateCorridorPlan } from './corridorPlanner';

export interface CalculationInput {
  rooms: RoomGeometry[];
  materialType: MaterialCategory;
  tileConfig: TileConfig;
  broadloomConfig: BroadloomConfig;
  pattern: LayingPattern;
  rotationDeg: number;
  originPoint: Point;
  roomOrigins: Record<string, Point>;
  offcutConfig: OffcutConfig;
  corridorZones?: CorridorZone[];
}

export interface CalculationOutput {
  nesting: NestingResult;
  boq: BOQSummary;
}

export function calculatePlan(input: CalculationInput): CalculationOutput {
  const { rooms, materialType, tileConfig, broadloomConfig, pattern,
    originPoint, roomOrigins, offcutConfig } = input;
  const rotationDeg = materialType === 'broadloom' ? 0 : input.rotationDeg;
  if (materialType === 'broadloom' && broadloomConfig.layoutMode === 'corridor') {
    const nesting = calculateCorridorPlan(input);
    return { nesting, boq: calculateBOQ(rooms, nesting, materialType, tileConfig, broadloomConfig) };
  }
  const runPipeline = (cfg: BroadloomConfig) => {
    const raw = computeNesting({
      rooms, materialType, tileConfig, broadloomConfig: cfg, pattern,
      rotationDeg, originPoint, roomOrigins,
      minBroadloomOffcutMm: offcutConfig.minBroadloomWidth,
    });
    const optimized = optimizeOffcuts(raw, offcutConfig, rooms, cfg,
      rotationDeg, originPoint, roomOrigins);
    // An invalid optimization must never reduce the material quantity.
    return validateNesting(rooms, optimized, materialType, cfg) ? raw : optimized;
  };

  const nesting = runPipeline(broadloomConfig);
  const error = validateNesting(rooms, nesting, materialType, broadloomConfig);
  if (error) throw new Error(error);
  return { nesting, boq: calculateBOQ(rooms, nesting, materialType, tileConfig, broadloomConfig) };
}
