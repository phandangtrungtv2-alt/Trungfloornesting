import { detectCorridorZones } from '../services/corridorZones';
import type { RoomGeometry } from '../types';

self.onmessage = (event: MessageEvent<RoomGeometry[]>) => {
  try { self.postMessage({ zones: detectCorridorZones(event.data) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Không nhận diện được các đoạn hành lang.' }); }
};
