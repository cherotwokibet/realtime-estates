// Fixed raster floor-plan worker. Never accepts a photo role or command payload.
import { convertSyntheticFloorPlan } from './index.js';
import { runFixedCodecWorker } from './codec-worker-io.js';
await runFixedCodecWorker(convertSyntheticFloorPlan);
