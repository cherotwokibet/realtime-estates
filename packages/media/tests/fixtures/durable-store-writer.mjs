import { Buffer } from 'node:buffer';
import { createInterface } from 'node:readline';
import { reopenDurableSyntheticStore } from '../../dist/durable-store.js';

// Fixed trusted fixture, never an upload endpoint or arbitrary script launcher.
// It reports only after install has returned its reread committed receipt, then
// waits for a controlled stop. No mid-install crash or power-loss proof is claimed.
const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
let store;
try {
  let configured=false,stopped=false;
  for await (const line of lines) {
    if(!configured) {
      if(Buffer.byteLength(line,'utf8')>4096)throw new Error('Invalid fixture configuration');
      const config=JSON.parse(line);
      store=await reopenDurableSyntheticStore(config.rootDirectory,config.storeId);
      const receipt=await store.install(config.reference,Buffer.from(config.base64,'base64'));
      process.stdout.write(`${JSON.stringify({state:'committed',receipt})}\n`);
      configured=true;
    } else {
      if(line!=='stop')throw new Error('Invalid fixture control');
      await store.close();stopped=true;break;
    }
  }
  if(!configured||!stopped)throw new Error('Missing controlled stop');
} catch {
  await store?.close().catch(()=>undefined);
  process.stderr.write('Trusted durable-store fixture failed.\n');
  process.exitCode=1;
} finally {lines.close();}
