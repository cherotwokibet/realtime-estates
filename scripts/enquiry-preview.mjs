/** Disposable synthetic enquiry UI. Tokens are server-only and never logged. */
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {startStaffPreview} from '../apps/api/dev/staff-preview.mjs';

if(process.env.NODE_ENV==='production')throw new Error('Enquiry preview refuses production.');
const root=fileURLToPath(new URL('../',import.meta.url));
const next=fileURLToPath(new URL('../node_modules/next/dist/bin/next',import.meta.url));
let preview,child,closing;
async function stop(){
  return closing??=(async()=>{
    try{
      if(child&&child.exitCode===null&&child.signalCode===null){
        const exited=new Promise(resolve=>child.once('exit',resolve));let timeout;
        try{
          child.kill();
          await Promise.race([exited,new Promise(resolve=>{timeout=setTimeout(resolve,3000);timeout.unref();})]);
          if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
        }finally{clearTimeout(timeout);}
      }
    }finally{await preview?.close();}
  })();
}
try{
  preview=await startStaffPreview({tenantSlug:process.env.TENANT_SLUG??'realtime-estates',enquiryPreview:'synthetic-v1'});
  const {admin,agent}=preview.enquiryStaff;
  child=spawn(process.execPath,[next,'dev','apps/admin','-p','3001','-H','127.0.0.1'],{cwd:root,stdio:'inherit',env:{...process.env,
    NODE_ENV:'development',TENANT_SLUG:preview.tenantSlug,
    // Disable unrelated staff/media launch contexts inherited from a prior shell.
    STAFF_PREVIEW_MODE:'',STAFF_PREVIEW_TOKEN:'',STAFF_PREVIEW_INSTANCE:'',STAFF_PREVIEW_MEDIA:'',
    STAFF_ENQUIRY_PREVIEW_MODE:'synthetic-v1',STAFF_PREVIEW_API_ORIGIN:preview.origin,
    STAFF_ENQUIRY_ADMIN_TOKEN:admin.bearerToken,STAFF_ENQUIRY_ADMIN_ID:admin.actorId,STAFF_ENQUIRY_ADMIN_INSTANCE:randomUUID(),
    STAFF_ENQUIRY_AGENT_TOKEN:agent.bearerToken,STAFF_ENQUIRY_AGENT_ID:agent.actorId,STAFF_ENQUIRY_AGENT_INSTANCE:randomUUID(),
  }});
  child.once('error',()=>{process.exitCode=1;console.error('The synthetic enquiry UI could not start.');void stop();});
  child.once('exit',code=>{if(!closing)process.exitCode=code??1;void stop();});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{process.exitCode=0;void stop();});
  console.log('Synthetic guest intake: http://127.0.0.1:3001/enquiry-intake');
  console.log('Synthetic admin enquiries: http://127.0.0.1:3001/enquiries/admin');
  console.log('Synthetic assigned-agent enquiries: http://127.0.0.1:3001/enquiries/agent');
  console.log('Shared disposable synthetic database; identity expires in 30 minutes. Changes disappear on stop.');
}catch{
  process.exitCode=1;console.error('The synthetic enquiry preview could not start.');await stop();
}
