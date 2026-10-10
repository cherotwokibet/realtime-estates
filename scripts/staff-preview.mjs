/** Synthetic development only. No persistent identity or database. Never print or persist the bearer token. */
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {startStaffPreview} from '../apps/api/dev/staff-preview.mjs';
if(process.env.NODE_ENV==='production')throw new Error('Staff preview refuses production.');
const root=fileURLToPath(new URL('../',import.meta.url));
const preview=await startStaffPreview({tenantSlug:process.env.TENANT_SLUG??'realtime-estates'});
const next=fileURLToPath(new URL('../node_modules/next/dist/bin/next',import.meta.url));
const child=spawn(process.execPath,[next,'dev','apps/admin','-p','3001','-H','127.0.0.1'],{cwd:root,stdio:'inherit',env:{...process.env,NODE_ENV:'development',STAFF_PREVIEW_MODE:'synthetic',STAFF_PREVIEW_API_ORIGIN:preview.origin,STAFF_PREVIEW_TOKEN:preview.bearerToken,STAFF_PREVIEW_INSTANCE:randomUUID(),TENANT_SLUG:preview.tenantSlug}});
console.log(`Synthetic staff editor: http://127.0.0.1:3001/drafts/${preview.listingId}/${preview.revision}`);
console.log('Disposable data; changes disappear when this preview stops. Identity expires in 30 minutes.');
let stopping=false;
async function stop(){if(stopping)return;stopping=true;child.kill();await preview.close();}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void stop());
child.on('error',()=>{console.error('The admin preview could not start.');void stop();process.exitCode=1;});
child.on('exit',code=>{void stop();process.exitCode=code??0;});
