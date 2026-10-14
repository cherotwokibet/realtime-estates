/** Disposable synthetic enquiry UI. Tokens are server-only and never logged. */
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {startStaffPreview} from '../apps/api/dev/staff-preview.mjs';

if(process.env.NODE_ENV==='production')throw new Error('Enquiry preview refuses production.');
if(['--invalid-first-viewing-reply','--invalid-first-confirmation-reply','--invalid-first-termination-reply','--invalid-first-reschedule-reply'].filter(flag=>process.argv.includes(flag)).length>1)throw new Error('Choose one synthetic viewing reply fault.');
const root=fileURLToPath(new URL('../',import.meta.url));
const next=fileURLToPath(new URL('../node_modules/next/dist/bin/next',import.meta.url));
let preview,child,webChild,closing;
async function stop(){
  return closing??=(async()=>{
    try{
      for(const running of [child,webChild])if(running&&running.exitCode===null&&running.signalCode===null){
        const exited=new Promise(resolve=>running.once('exit',resolve));let timeout;
        try{
          running.kill();
          await Promise.race([exited,new Promise(resolve=>{timeout=setTimeout(resolve,3000);timeout.unref();})]);
          if(running.exitCode===null&&running.signalCode===null)running.kill('SIGKILL');
        }finally{clearTimeout(timeout);}
      }
    }finally{await preview?.close();}
  })();
}
try{
  preview=await startStaffPreview({tenantSlug:process.env.TENANT_SLUG??'realtime-estates',enquiryPreview:'synthetic-v1',...(process.argv.includes('--web')?{enquiryCatalogue:'synthetic-v1'}:{}),...(process.argv.includes('--invalid-first-reschedule-reply')?{viewingReplyFault:'invalid-first-reschedule-v1'}:{}),...(process.argv.includes('--invalid-first-termination-reply')?{viewingReplyFault:'invalid-first-termination-v1'}:{}),...(process.argv.includes('--invalid-first-confirmation-reply')?{viewingReplyFault:'invalid-first-confirmation-v1'}:{}),...(process.argv.includes('--invalid-first-viewing-reply')?{viewingReplyFault:'invalid-first-applied-v1'}:{}),...(process.argv.includes('--invalid-first-contact-reply')?{contactReplyFault:'invalid-first-applied-v1'}:{})});
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
  if(process.argv.includes('--web')){
    // No staff credentials are inherited by the public web process.
    const publicEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('STAFF_')));
    webChild=spawn(process.execPath,[next,'dev','apps/web','-p','3002','-H','127.0.0.1'],{cwd:root,stdio:'inherit',env:{...publicEnv,NODE_ENV:'development',TENANT_SLUG:preview.tenantSlug,WEB_CATALOGUE_MODE:'connected',WEB_CATALOGUE_DATA:'synthetic',API_ORIGIN:preview.origin,ALLOW_LOOPBACK_API:'true',WEB_ENQUIRY_PROPERTY_MODE:'synthetic-v1',WEB_ENQUIRY_PREVIEW_MODE:'synthetic-v1',WEB_ENQUIRY_API_ORIGIN:preview.origin,WEB_ENQUIRY_INSTANCE:randomUUID()}});
    webChild.once('error',()=>{process.exitCode=1;console.error('The public enquiry preview could not start.');void stop();});
    webChild.once('exit',code=>{if(!closing)process.exitCode=code??1;void stop();});
    console.log('Synthetic public website enquiry: http://127.0.0.1:3002/enquire');
  }
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{process.exitCode=0;void stop();});
  console.log('Synthetic guest intake: http://127.0.0.1:3001/enquiry-intake');
  console.log('Synthetic admin enquiries: http://127.0.0.1:3001/enquiries/admin');
  console.log('Synthetic assigned-agent enquiries: http://127.0.0.1:3001/enquiries/agent');
  console.log('Shared disposable synthetic database; identity expires in 30 minutes. Changes disappear on stop.');
  if(process.argv.includes('--invalid-first-reschedule-reply'))console.log('Synthetic fault enabled: first applied reschedule returns an invalid receipt after commit; earlier saves and original recovery remain normal. Requires --web.');
  if(process.argv.includes('--invalid-first-confirmation-reply'))console.log('Synthetic fault enabled: first applied confirmation returns an invalid receipt after commit; requests/proposals and original reads/replay stay normal. Requires --web.');
  if(process.argv.includes('--invalid-first-viewing-reply'))console.log('Synthetic fault enabled: first applied viewing returns an invalid receipt after commit; original receipt read and exact replay remain available. Requires --web.');
  if(process.argv.includes('--invalid-first-contact-reply'))console.log('Synthetic fault enabled: first applied contact returns an invalid receipt after commit; original receipt read and exact replay remain available.');
}catch{
  process.exitCode=1;console.error('The synthetic enquiry preview could not start.');await stop();
}
