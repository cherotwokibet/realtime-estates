// Fixed photo worker. No caller-selected role or executable.
import { convertSyntheticImage } from './index.js';
import { runFixedCodecWorker } from './codec-worker-io.js';
await runFixedCodecWorker(convertSyntheticImage);
