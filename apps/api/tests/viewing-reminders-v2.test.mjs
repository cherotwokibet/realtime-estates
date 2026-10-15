import assert from 'node:assert/strict';import test from 'node:test';import {createApiService} from '../dist/service.js';import {reminderFixture} from '../../../packages/domain/test-helpers/reminder-fixtures.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,tenant=id(1),actor=id(2);
function fixture({enabled=true,role='agent',admission,captured,failure}={}){
 const f=reminderFixture({enquiry:id(3),viewing:id(4),actor,listing:id(5)}),calls=[],contexts=[];admission??=f.admission;captured??=f.captured;
 const database={async transaction(context,work){contexts.push(context);return work({async query(sql,args){calls.push({sql,args});if(sql.includes('staff_role'))return {rows:[{role}]};if(failure)throw failure;return {rows:[{receipt:sql.includes('capture_viewing_reminder')||sql.includes('read_viewing_reminder_attempt')?captured:admission}]};}});}};
 const options={database,tenantId:tenant,privacyNoticeVersion:'synthetic-v1',uuid:()=>id(900),verifyAuthorization:async request=>{if(request.headers.get('authorization')!=='Bearer synthetic')throw new Error('PRIVATE AUTH');return {actorId:actor};},...(enabled?{reminderCaptureMode:'capture-only-v1'}:{})};
 return {...f,calls,contexts,options,service:createApiService(options)};
}
const req=(path,{method='GET',value,raw,authorization='Bearer synthetic',headers={}}={})=>new Request('https://synthetic.invalid'+path,{method,headers:{...(authorization?{Authorization:authorization}:{}),...(value!==undefined||raw!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(value!==undefined||raw!==undefined?{body:raw??JSON.stringify(value)}:{})});
const paths=f=>({admit:`/v2/staff/enquiries/${f.enquiry}/viewings/${f.viewing}/reminder-admissions`,original:`/v2/staff/enquiries/${f.enquiry}/viewing-reminder-admissions/${f.admissionCommand.operationId}`,capture:`/v2/staff/enquiries/${f.enquiry}/viewing-reminder-admissions/${f.admissionCommand.operationId}/captures`,recover:`/v2/staff/enquiries/${f.enquiry}/viewing-reminder-admissions/${f.admissionCommand.operationId}/capture-operations/${f.captureCommand.operationId}`});
const wire=f=>({...f.admissionCommand,expectedVersion:3});
test('reminder routes require exact trusted opt-in and retain default disabled behavior',async()=>{
 const f=fixture({enabled:false});for(const path of Object.values(paths(f)))assert.equal((await f.service(req(path))).status,404);assert.equal(f.calls.length,0);assert.throws(()=>createApiService({...f.options,reminderCaptureMode:'live'}));
});
test('admission POST binds six typed SQL arguments and original GET retains exact route-scoped facts',async()=>{
 const f=fixture(),p=paths(f);assert.deepEqual(await (await f.service(req(p.admit,{method:'POST',value:wire(f)}))).json(),f.admission);const call=f.calls.find(x=>x.sql.includes('admit_viewing_reminder'));assert.deepEqual(call.args,[f.enquiry,f.viewing,f.admissionCommand.operationId,'3',f.admissionCommand.dueAt,f.admissionCommand.expiresAt]);assert.equal(f.contexts[0].tenantId,tenant);assert.equal(f.contexts[0].actorId,actor);
 f.calls.length=0;assert.deepEqual(await (await f.service(req(p.original))).json(),f.admission);assert.deepEqual(f.calls.find(x=>x.sql.includes('read_viewing_reminder_admission')).args,[f.enquiry,f.admissionCommand.operationId]);assert.equal(f.calls.some(x=>x.sql.includes('admit_viewing_reminder(')),false);
});
test('capture POST reads immutable admission then binds three arguments while recovery remains read-only',async()=>{
 const f=fixture(),p=paths(f);assert.deepEqual(await (await f.service(req(p.capture,{method:'POST',value:f.captureCommand}))).json(),f.captured);assert.deepEqual(f.calls.filter(x=>!x.sql.includes('staff_role')).map(x=>x.args),[[f.enquiry,f.admissionCommand.operationId],[f.enquiry,f.admissionCommand.operationId,f.captureCommand.operationId]]);
 f.calls.length=0;assert.deepEqual(await (await f.service(req(p.recover))).json(),f.captured);assert.ok(f.calls.every(x=>!x.sql.includes('capture_viewing_reminder(')));assert.deepEqual(f.calls.at(-1).args,[f.enquiry,f.admissionCommand.operationId,f.captureCommand.operationId]);
});
test('reminder body authority duplicate keys ambiguous versions clocks and oversize data fail before SQL',async()=>{
 const f=fixture(),p=paths(f);for(const value of [{...wire(f),actorId:actor},{...wire(f),mode:'capture-only-v1'},{...wire(f),expectedVersion:'3'},{...wire(f),dueAt:'2020-01-01T08:35:00Z'}])assert.equal((await f.service(req(p.admit,{method:'POST',value}))).status,400);
 for(const raw of [JSON.stringify(wire(f)).replace('"expectedVersion":3','"expectedVersion":3e0'),JSON.stringify(wire(f)).replace('"dueAt":','"dueAt":"duplicate","dueAt":')])assert.equal((await f.service(req(p.admit,{method:'POST',raw}))).status,400);
 for(const value of [{...f.captureCommand,now:'2020-01-01T08:40:00.000Z'},{...f.captureCommand,admissionOperationId:f.admissionCommand.operationId},{...f.captureCommand,mode:'live'}])assert.equal((await f.service(req(p.capture,{method:'POST',value}))).status,400);
 assert.equal((await f.service(req(p.capture,{method:'POST',raw:' '.repeat(4097)}))).status,413);assert.equal(f.calls.length,0);
});
test('reminder route query header method and exact body-length boundaries cannot override context',async()=>{
 const f=fixture(),p=paths(f);for(const suffix of ['?tenantId=other','?','#context'])assert.equal((await f.service(req(p.capture+suffix,{method:'POST',value:f.captureCommand}))).status,400);
 for(const headers of [{'X-Actor-Id':actor},{Cookie:'synthetic=forged'},{'If-Match':'3'},{'Content-Length':'01'},{'Content-Length':'1'}])assert.equal((await f.service(req(p.capture,{method:'POST',value:f.captureCommand,headers}))).status,400);
 assert.equal((await f.service(req(p.original,{headers:{'Content-Type':'application/json'}}))).status,400);assert.equal((await f.service(req(p.admit))).status,405);assert.equal((await f.service(req(p.recover,{method:'POST',value:f.captureCommand}))).status,405);assert.equal(f.calls.length,0);
});
test('reminder authentication and active staff membership precede all privileged queries',async()=>{
 const f=fixture(),p=paths(f);assert.equal((await f.service(req(p.capture,{method:'POST',value:f.captureCommand,authorization:null}))).status,401);assert.equal((await f.service(req(p.original,{authorization:'Bearer wrong'}))).status,401);assert.equal(f.calls.length,0);
 const customer=fixture({role:'customer'});assert.equal((await customer.service(req(paths(customer).capture,{method:'POST',value:customer.captureCommand}))).status,403);assert.ok(customer.calls.every(x=>x.sql.includes('staff_role')));
});
test('unusable source receipts and requester mismatch stay sanitized and refused admissions never capture',async()=>{
 const base=fixture();for(const admission of [{...base.admission,actorId:id(99)},{...base.admission,operationId:id(99)},{...base.admission,mode:'live'}]){const f=fixture({admission});const response=await f.service(req(paths(f).capture,{method:'POST',value:f.captureCommand}));assert.equal(response.status,503);assert.equal(f.calls.some(x=>x.sql.includes('capture_viewing_reminder(')),false);}
 const refused=fixture({admission:{...base.admission,outcome:'refused',reason:'INVALID_STATE',candidate:null}});assert.equal((await refused.service(req(paths(refused).capture,{method:'POST',value:refused.captureCommand}))).status,422);assert.equal(refused.calls.some(x=>x.sql.includes('capture_viewing_reminder(')),false);
 const altered=fixture({captured:{...base.captured,actorId:id(99)}});assert.equal((await altered.service(req(paths(altered).capture,{method:'POST',value:altered.captureCommand}))).status,503);
 const denied=fixture({failure:Object.assign(new Error('PRIVATE SQL MESSAGE'),{code:'P0002'})});const response=await denied.service(req(paths(denied).original));assert.equal(response.status,404);assert.equal((await response.text()).includes('PRIVATE'),false);
});
