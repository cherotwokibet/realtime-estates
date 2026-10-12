import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiService} from '../dist/service.js';
import {DatabaseSafetyError} from '../dist/database.js';

// API-boundary doubles only. Root's separate SDK/service integration exercises
// the actual restricted SQL migration and persisted command recovery.
const id = value => `00000000-0000-4000-8000-${String(value).padStart(12,'0')}`;
const TENANT=id(1),ADMIN=id(10),AGENT=id(11),ENQUIRY=id(100),LISTING=id(200),OP=id(300);
const NOW='2026-10-12T06:00:00.000Z',DUE='2026-10-11T09:15:00.123Z';
const base='/v2/staff/enquiries';
const summary=(extra={})=>({id:ENQUIRY,listingId:LISTING,contactedRevision:3,name:'Synthetic Prospect',origin:'web',status:'new',assignedAgentId:null,nextActionAt:null,version:'1',createdAt:NOW,updatedAt:NOW,...extra});
const detail=(extra={})=>({...summary(),phone:'+254700000000',email:null,message:'Synthetic enquiry.\nRetain raw contact text.',noticeVersion:'synthetic-notice-v1',closureReason:null,...extra});
const command=(extra={})=>({operationId:OP,kind:'assign',expectedVersion:1,assignedAgentId:AGENT,status:null,nextActionAt:null,reason:null,...extra});
function receipt(body=command(),extra={}){
  return {operationId:body.operationId,enquiryId:ENQUIRY,kind:body.kind,expectedVersion:String(body.expectedVersion),
    request:{assignedAgentId:body.assignedAgentId,status:body.status,nextActionAt:body.nextActionAt,reason:body.reason},
    outcome:'applied',reason:null,result:{version:String(body.expectedVersion+1),status:body.kind==='assign'?'assigned':body.kind==='transition'?body.status:'contacted',assignedAgentId:AGENT,nextActionAt:body.nextActionAt,closureReason:body.reason},completedAt:NOW,...extra};
}
function fixture({role='admin',rows=[summary()],privateDetail=detail(),directory={items:[{userId:AGENT,role:'agent'}],limit:100,truncated:false},operation=receipt(),failure}={}){
  const calls=[],contexts=[];
  const database={async transaction(context,work){contexts.push({...context});return work({async query(sql,args=[]){
    calls.push({sql,args:structuredClone(args)});
    if(sql.includes('app_api.record_enquiry'))return {rows:[{id:ENQUIRY}]};
    if(sql.includes('app_private.staff_role'))return {rows:[{role}]};
    if(failure)throw failure;
    if(sql.includes('list_enquiry_assignees'))return {rows:[{page:directory}]};
    if(sql.includes('execute_enquiry_operation')||sql.includes('read_enquiry_operation'))return {rows:[{receipt:operation}]};
    if(sql.includes('e.id=$2'))return {rows:privateDetail===null?[]:[privateDetail]};
    return {rows};
  }});}};
  const service=createApiService({database,tenantId:TENANT,privacyNoticeVersion:'synthetic-notice-v1',verifyAuthorization:async request=>{
    if(request.headers.get('authorization')==='Bearer synthetic-admin')return {actorId:ADMIN};
    if(request.headers.get('authorization')==='Bearer synthetic-agent')return {actorId:AGENT};
    throw new Error('PRIVATE AUTHENTICATION DIAGNOSTIC');
  }});
  return {service,calls,contexts};
}
function request(path,{method='GET',body,raw,actor='admin',headers={}}={}){
  return new Request('https://synthetic.invalid'+path,{method,headers:{...(actor===null?{}:{Authorization:`Bearer synthetic-${actor}`}),...(body===undefined&&raw===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined&&raw===undefined?{}:{body:raw??JSON.stringify(body)})});
}
async function safeFailure(response,status,code){
  assert.equal(response.status,status);
  const body=await response.json();assert.equal(body.error.code,code);
  assert.equal(response.headers.get('x-request-id'),body.requestId);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.doesNotMatch(JSON.stringify(body),/PRIVATE|SQL SECRET|storageKey|password/);
  return body;
}

test('staff enquiry v2 keeps verified identity and fixed tenant separate from request context',async()=>{
  for(const path of [base,`${base}/${ENQUIRY}`,`${base}/${ENQUIRY}/operations/${OP}`,'/v2/staff/enquiry-assignees']){
    for(const actor of [null,'invalid']){
      const f=fixture();await safeFailure(await f.service(request(path,{actor})),401,'UNAUTHENTICATED');assert.equal(f.contexts.length,0);
    }
    const f=fixture({role:'customer'});await safeFailure(await f.service(request(path)),403,'FORBIDDEN');
    assert.equal(f.calls.length,1);
  }
  const f=fixture();await f.service(request(base));assert.equal(f.contexts[0].tenantId,TENANT);assert.equal(f.contexts[0].actorId,ADMIN);
  const agent=fixture({role:'agent'});await safeFailure(await agent.service(request('/v2/staff/enquiry-assignees',{actor:'agent'})),403,'FORBIDDEN');
  assert.equal(agent.calls.length,1);
});

test('bounded stable summary pages fetch one extra and never forward contact or private storage facts',async()=>{
  const rows=Array.from({length:3},(_,index)=>({...detail({id:id(100+index)}),tenantId:TENANT,requestedById:ADMIN,idempotencyKey:OP,storageKey:'SQL SECRET'}));
  const f=fixture({rows}),response=await f.service(request(base+'?limit=2')),page=await response.json();
  assert.equal(response.status,200);assert.equal(page.limit,2);assert.equal(page.truncated,true);assert.equal(page.items.length,2);
  assert.deepEqual(Object.keys(page.items[0]).sort(),Object.keys(summary()).sort());
  assert.equal(JSON.stringify(page).includes('SQL SECRET'),false);
  const query=f.calls.find(c=>c.sql.includes('FROM app_private.enquiries'));
  assert.match(query.sql,/ORDER BY e\.created_at DESC,e\.id ASC/);assert.deepEqual(query.args,[TENANT,3]);
  const empty=fixture({rows:[]});assert.deepEqual(await (await empty.service(request(base))).json(),{items:[],limit:50,truncated:false});
  const bounded=fixture({rows:[summary()]});assert.equal((await (await bounded.service(request(base+'?limit=1'))).json()).truncated,false);
});

test('detail exposes only agreed contact fields, preserves general/property references and canonical dates',async()=>{
  const privateDetail={...detail({listingId:null,contactedRevision:null,name:' Synthetic name ',message:' Synthetic text\n ',noticeVersion:' notice-v1 ',createdAt:'2026-10-12T06:00:00.000456Z'}),tenantId:TENANT,idempotencyKey:OP,requestedById:ADMIN};
  const f=fixture({privateDetail}),response=await f.service(request(`${base}/${ENQUIRY}`)),loaded=await response.json();
  assert.equal(response.status,200);assert.deepEqual(Object.keys(loaded).sort(),Object.keys(detail()).sort());
  assert.equal(loaded.listingId,null);assert.equal(loaded.contactedRevision,null);assert.equal(loaded.createdAt,NOW);
  assert.equal(loaded.message,privateDetail.message);assert.equal(loaded.name,privateDetail.name);assert.equal(loaded.noticeVersion,privateDetail.noticeVersion);
  assert.equal(loaded.phone,'+254700000000');assert.equal(loaded.email,null);
  const absent=fixture({privateDetail:null});await safeFailure(await absent.service(request(`${base}/${ENQUIRY}`)),404,'NOT_FOUND');
});

test('admin assignee picker has a bounded explicit page and only real IDs and roles',async()=>{
  const directory={items:[{userId:ADMIN,role:'admin',name:'SQL SECRET',active:true},{userId:AGENT,role:'agent',phone:'SQL SECRET'}],limit:2,truncated:true};
  const f=fixture({directory}),response=await f.service(request('/v2/staff/enquiry-assignees?limit=2'));
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{items:[{userId:ADMIN,role:'admin'},{userId:AGENT,role:'agent'}],limit:2,truncated:true});
  assert.deepEqual(f.calls.find(c=>c.sql.includes('list_enquiry_assignees')).args,[2]);
  const defaults=fixture();assert.equal((await (await defaults.service(request('/v2/staff/enquiry-assignees'))).json()).limit,100);
});

test('query, resource and method guards refuse unsupported selectors before a database transaction',async()=>{
  const f=fixture();
  for(const suffix of ['?tenantId='+id(2),'?actorId='+AGENT,'?limit=1&limit=2','?limit=0','?limit=01','?limit=101','?limit=1e1','?limit=1.0','?limit=','?limit=-1','?cursor=x']){
    await safeFailure(await f.service(request(base+suffix)),400,'INVALID_INPUT');
    await safeFailure(await f.service(request('/v2/staff/enquiry-assignees'+suffix)),400,'INVALID_INPUT');
  }
  for(const path of [`${base}/${ENQUIRY}?limit=1`,`${base}/${ENQUIRY}/operations?tenantId=${TENANT}`,`${base}/${ENQUIRY}/operations/${OP}?x=1`,`${base}/not-a-uuid`])await safeFailure(await f.service(request(path)),400,'INVALID_INPUT');
  for(const [path,method,allow] of [[base,'POST','GET'],['/v2/staff/enquiry-assignees','POST','GET'],[`${base}/${ENQUIRY}`,'PUT','GET'],[`${base}/${ENQUIRY}/operations`,'GET','POST'],[`${base}/${ENQUIRY}/operations/${OP}`,'POST','GET']]){
    const response=await f.service(request(path,{method}));await safeFailure(response,405,'METHOD_NOT_ALLOWED');assert.equal(response.headers.get('allow'),allow);
  }
  assert.equal(f.contexts.length,0);
  await safeFailure(await f.service(request(`${base}/${ENQUIRY}/transitions`)),404,'NOT_FOUND');
});

test('each exact original command crosses one RPC with server context and returns only its matching durable snapshot',async()=>{
  for(const body of [command(),command({kind:'transition',assignedAgentId:null,status:'contacted',nextActionAt:DUE}),command({kind:'reschedule',assignedAgentId:null,nextActionAt:DUE})]){
    const operation={...receipt(body),tenantId:TENANT,requestedById:ADMIN,storageKey:'SQL SECRET',result:{...receipt(body).result,phone:'SQL SECRET'}};
    const f=fixture({operation}),response=await f.service(request(`${base}/${ENQUIRY}/operations`,{method:'POST',body})),loaded=await response.json();
    assert.equal(response.status,200);assert.deepEqual(Object.keys(loaded).sort(),Object.keys(receipt(body)).sort());
    assert.deepEqual(loaded,receipt(body));assert.equal(JSON.stringify(loaded).includes('SQL SECRET'),false);
    const calls=f.calls.filter(c=>c.sql.includes('execute_enquiry_operation'));
    assert.equal(calls.length,1);assert.deepEqual(calls[0].args,[ENQUIRY,OP,1,body.kind,body.assignedAgentId,body.status,body.nextActionAt,body.reason]);
    assert.equal(f.contexts[0].actorId,ADMIN);assert.equal(f.contexts[0].tenantId,TENANT);
  }
});

test('strict original JSON rejects fractional/exponent versions, escaped duplicate keys and omitted or irrelevant selectors',async()=>{
  const f=fixture(),path=`${base}/${ENQUIRY}/operations`;
  const valid=JSON.stringify(command());
  for(const token of ['1.0','1e0','1.00000000000000001','9007199254740991','9007199254740992','0','-1','"1"','null']){
    const raw=valid.replace('"expectedVersion":1',`"expectedVersion":${token}`);
    const response=await f.service(request(path,{method:'POST',raw}));assert.equal(response.status,400,token);
  }
  for(const raw of [valid.replace('"expectedVersion":1','"expectedVersion":1,"expectedVersion":1'),valid.replace('"expectedVersion":1','"expectedVersion":1,"expected\\u0056ersion":1'),valid.replace('"reason":null','"reason":null,"reason":null'),'{'])await safeFailure(await f.service(request(path,{method:'POST',raw})),400,'INVALID_JSON');
  const missing={...command()};delete missing.reason;
  const invalid=[missing,{...command(),tenantId:TENANT},command({kind:'invented'}),command({assignedAgentId:null}),command({status:'contacted'}),command({nextActionAt:DUE}),command({reason:'irrelevant'}),command({kind:'transition',assignedAgentId:null,status:'contacted'}),command({kind:'transition',assignedAgentId:null,status:'closed_lost',reason:null}),command({kind:'transition',assignedAgentId:null,status:'assigned',reason:null}),command({kind:'transition',assignedAgentId:null,status:'closed_won',reason:'irrelevant'}),command({kind:'reschedule',assignedAgentId:null,nextActionAt:null}),command({kind:'reschedule',assignedAgentId:null,nextActionAt:DUE,reason:'irrelevant'})];
  for(const body of invalid)await safeFailure(await f.service(request(path,{method:'POST',body})),400,'INVALID_INPUT');
  assert.equal(f.contexts.length,0);
});

test('dated follow-up accepts a past due instant and refuses ambiguous time, reason and body framing inputs',async()=>{
  const path=`${base}/${ENQUIRY}/operations`;
  for(const value of ['2026-10-12T06:00:00Z','2026-10-12T06:00:00.000+00:00','2026-02-30T06:00:00.000Z','0000-10-12T06:00:00.000Z','2026-10-12T06:00:00.000001Z']){
    const f=fixture();await safeFailure(await f.service(request(path,{method:'POST',body:command({kind:'reschedule',assignedAgentId:null,nextActionAt:value})})),400,'INVALID_INPUT');assert.equal(f.contexts.length,0);
  }
  for(const reason of ['', ' whitespace ', 'x'.repeat(1001),'line\nbreak','x\u0085x','\ud800']){
    const f=fixture();await safeFailure(await f.service(request(path,{method:'POST',body:command({kind:'transition',assignedAgentId:null,status:'closed_lost',reason})})),400,'INVALID_INPUT');
  }
  const f=fixture();await safeFailure(await f.service(request(path,{method:'POST',body:command(),headers:{'Content-Type':'text/plain'}})),415,'JSON_REQUIRED');
  await safeFailure(await f.service(request(path,{method:'POST',raw:' '.repeat(8193)})),413,'BODY_TOO_LARGE');
  await safeFailure(await f.service(request(path,{method:'POST',body:command(),headers:{'Content-Length':'8193'}})),413,'BODY_TOO_LARGE');
});

test('read-only recovery uses only exact original identities and returns historical outcome instead of current-state inference',async()=>{
  const original=receipt(),f=fixture({operation:original});
  for(let index=0;index<2;index++)assert.deepEqual(await (await f.service(request(`${base}/${ENQUIRY}/operations/${OP}`))).json(),original);
  assert.equal(f.calls.filter(c=>c.sql.includes('read_enquiry_operation')).length,2);
  assert.equal(f.calls.filter(c=>c.sql.includes('execute_enquiry_operation')).length,0);
  assert.deepEqual(f.calls.find(c=>c.sql.includes('read_enquiry_operation')).args,[ENQUIRY,OP]);
});

test('durable noops, stale conflicts and business rejections keep their original expected and result versions',async()=>{
  const assign=command(),reschedule=command({kind:'reschedule',assignedAgentId:null,nextActionAt:DUE});
  const cases=[receipt(assign,{outcome:'noop',result:{...receipt(assign).result,version:'1'}}),receipt(reschedule,{outcome:'noop',result:{...receipt(reschedule).result,version:'1'}}),receipt(assign,{outcome:'conflict',reason:'VERSION_CONFLICT',result:{...receipt(assign).result,version:'4'}}),receipt(assign,{outcome:'rejected',reason:'ASSIGNEE_UNAVAILABLE',result:{version:'1',status:'new',assignedAgentId:null,nextActionAt:null,closureReason:null}}),receipt(reschedule,{outcome:'rejected',reason:'INVALID_TRANSITION',result:{version:'1',status:'new',assignedAgentId:null,nextActionAt:null,closureReason:null}})];
  for(const operation of cases){const f=fixture({operation}),response=await f.service(request(`${base}/${ENQUIRY}/operations/${OP}`));assert.equal(response.status,200);assert.deepEqual(await response.json(),operation);}
});

test('malformed or mismatched database receipts fail closed without disclosing SQL or contact payloads',async()=>{
  const valid=receipt();
  const bad=[null,{}, {...valid,enquiryId:id(999)},{...valid,operationId:id(999)},{...valid,expectedVersion:'01'},{...valid,expectedVersion:'9007199254740991'},{...valid,kind:'unknown'}, {...valid,request:{...valid.request,reason:'irrelevant'}},{...valid,request:{...valid.request,actorId:ADMIN}},{...valid,result:{...valid.result,version:'9007199254740992'}},{...valid,result:{...valid.result,status:'won'}},{...valid,result:{...valid.result,version:'1'}},{...valid,outcome:'noop'}, {...valid,outcome:'conflict',reason:'VERSION_CONFLICT',result:{...valid.result,version:'1'}},{...valid,outcome:'rejected',reason:'INVALID_TRANSITION',result:{...valid.result,version:'1'}},{...valid,completedAt:'2026-02-30T00:00:00.000Z'}];
  for(const operation of bad){const f=fixture({operation});await safeFailure(await f.service(request(`${base}/${ENQUIRY}/operations/${OP}`)),503,'SERVICE_UNAVAILABLE');}
  const mismatch=fixture({operation:receipt(command({assignedAgentId:ADMIN}))});await safeFailure(await mismatch.service(request(`${base}/${ENQUIRY}/operations`,{method:'POST',body:command()})),503,'SERVICE_UNAVAILABLE');
});

test('applied and noop receipts bind status and closure facts to the original kind and reason',async()=>{
  const transition=command({kind:'transition',assignedAgentId:null,status:'qualified',nextActionAt:DUE});
  const reopen=command({kind:'transition',assignedAgentId:null,status:'assigned',reason:'Synthetic reason to reopen'});
  const reschedule=command({kind:'reschedule',assignedAgentId:null,nextActionAt:DUE});
  const bad=[
    receipt(command(),{result:{...receipt().result,status:'new'}}),
    receipt(command(),{outcome:'noop',result:{...receipt().result,version:'1',status:'new'}}),
    receipt(transition,{result:{...receipt(transition).result,closureReason:'Unrelated reason'}}),
    receipt(reopen,{result:{...receipt(reopen).result,closureReason:'A different reason'}}),
    receipt(reschedule,{result:{...receipt(reschedule).result,status:'assigned'}}),
    receipt(reschedule,{outcome:'noop',result:{...receipt(reschedule).result,version:'1',status:'assigned'}}),
  ];
  for(const operation of bad){const f=fixture({operation});await safeFailure(await f.service(request(`${base}/${ENQUIRY}/operations/${OP}`)),503,'SERVICE_UNAVAILABLE');}
  const valid=fixture({operation:receipt(reopen)}),response=await valid.service(request(`${base}/${ENQUIRY}/operations/${OP}`));
  assert.equal(response.status,200);assert.equal((await response.json()).result.closureReason,reopen.reason);
});

test('malformed list, detail and directory projections cannot become success or leak private fields',async()=>{
  for(const row of [summary({version:'0'}),summary({listingId:null}),summary({contactedRevision:1.5}),summary({origin:'other'}),summary({status:'won'}),summary({name:'\ud800'}),summary({status:'contacted',nextActionAt:null})]){
    const f=fixture({rows:[row]});await safeFailure(await f.service(request(base)),503,'SERVICE_UNAVAILABLE');
  }
  for(const privateDetail of [detail({id:id(999)}),detail({phone:null,email:null}),detail({message:'\u0000secret'}),detail({noticeVersion:''}),detail({status:'closed_lost',closureReason:null})]){
    const f=fixture({privateDetail});await safeFailure(await f.service(request(`${base}/${ENQUIRY}`)),503,'SERVICE_UNAVAILABLE');
  }
  for(const directory of [{items:[{userId:AGENT,role:'customer'}],limit:100,truncated:false},{items:[{userId:AGENT,role:'agent'},{userId:AGENT,role:'agent'}],limit:100,truncated:false},{items:[],limit:100,truncated:true},{items:[],limit:50,truncated:false}]){
    const f=fixture({directory});await safeFailure(await f.service(request('/v2/staff/enquiry-assignees')),503,'SERVICE_UNAVAILABLE');
  }
});

test('database permission, missing, conflict and safety failures keep existing safe status/error mapping',async()=>{
  for(const [code,status,error] of [['42501',403,'FORBIDDEN'],['P0002',404,'NOT_FOUND'],['40001',409,'CONFLICT'],['23514',422,'INVALID_STATE'],['UNKNOWN',503,'SERVICE_UNAVAILABLE']]){
    const f=fixture({failure:Object.assign(new Error('SQL SECRET password'),{code})});await safeFailure(await f.service(request(`${base}/${ENQUIRY}/operations`,{method:'POST',body:command()})),status,error);
    assert.equal(f.calls.filter(c=>c.sql.includes('execute_enquiry_operation')).length,1);
  }
  const f=fixture({failure:new DatabaseSafetyError()});await safeFailure(await f.service(request(base)),503,'SERVICE_UNAVAILABLE');
});

const captureBody=()=>({listingId:null,name:'Fictional Prospect',email:'PROSPECT@example.invalid',message:'Fictional staff intake',noticeVersion:'synthetic-notice-v1',noticeAcknowledged:true});
test('protected staff capture derives attribution and canonical contact within fixed session context',async()=>{
  for(const actor of ['admin','agent']){
    const f=fixture({role:actor});const result=await f.service(request('/v2/staff/enquiry-captures',{method:'POST',actor,body:captureBody(),headers:{'Idempotency-Key':OP}}));
    assert.equal(result.status,201);assert.deepEqual(await result.json(),{id:ENQUIRY});
    assert.equal(f.contexts[0].tenantId,TENANT);assert.equal(f.contexts[0].actorId,actor==='admin'?ADMIN:AGENT);
    assert.equal(f.calls[0].sql.includes('staff_role'),true);
    const call=f.calls.find(c=>c.sql.includes('record_enquiry'));assert.equal(call.args[1],OP);assert.equal(call.args[5],'prospect@example.invalid');assert.equal(call.args[7],'staff');
  }
});
test('staff capture rejects unauthenticated, nonstaff and caller attribution without a write',async()=>{
  for(const actor of [null,'invalid']){const f=fixture();await safeFailure(await f.service(request('/v2/staff/enquiry-captures',{method:'POST',actor,body:captureBody(),headers:{'Idempotency-Key':OP}})),401,'UNAUTHENTICATED');assert.equal(f.contexts.length,0);}
  const denied=fixture({role:'customer'});await safeFailure(await denied.service(request('/v2/staff/enquiry-captures',{method:'POST',body:captureBody(),headers:{'Idempotency-Key':OP}})),403,'FORBIDDEN');assert.equal(denied.calls.length,1);
  for(const field of ['origin','actorId','tenantId','requestedById']){const f=fixture();await safeFailure(await f.service(request('/v2/staff/enquiry-captures',{method:'POST',body:{...captureBody(),[field]:ADMIN},headers:{'Idempotency-Key':OP}})),400,'INVALID_INPUT');assert.equal(f.calls.length,0);}
  const query=fixture();await safeFailure(await query.service(request('/v2/staff/enquiry-captures?limit=1',{method:'POST',body:captureBody(),headers:{'Idempotency-Key':OP}})),400,'INVALID_INPUT');assert.equal(query.calls.length,0);
});
