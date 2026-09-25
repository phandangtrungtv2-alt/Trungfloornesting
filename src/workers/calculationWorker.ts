import { calculatePlan, type CalculationInput } from '../services/calculationPipeline';

self.onmessage = (event: MessageEvent<CalculationInput>) => {
  try {
    self.postMessage({ result: calculatePlan(event.data) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message :
      'Không tính được phương án trải sàn.' });
  }
};
