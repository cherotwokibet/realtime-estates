import assert from 'node:assert/strict';
import test from 'node:test';
import {getEnquiryPreviewScope,enquiryPreviewRequest} from '../dist/tests/lib/enquiry-preview-server.js';
import {GET as listRoute,dynamic as listDynamic} from '../dist/tests/app/api/enquiry-preview/[actor]/enquiries/route.js';
import {GET as detailRoute} from '../dist/tests/app/api/enquiry-preview/[actor]/enquiries/[id]/route.js';
import {GET as directoryRoute} from '../dist/tests/app/api/enquiry-preview/[actor]/assignees/route.js';
import {POST as commandRoute} from '../dist/tests/app/api/enquiry-preview/[actor]/enquiries/[id]/operations/route.js';
import {GET as operationRoute} from '../dist/tests/app/api/enquiry-preview/[actor]/enquiries/[id]/operations/[operationId]/route.js';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ADMIN=id(1),AGENT=id(2),ADMIN_INSTANCE=id(3),AGENT_INSTANCE=id(4),ENQUIRY=id(5),OPERATION=id(6),REQUEST_ID=id(7);
const NOW='2026-10-12T12:00:00.000Z',NEXT='2026-10-11T12:00:00.000Z';
const env={NODE_ENV:'development',STAFF_ENQUIRY_PREVIEW_MODE:'synthetic-v1',STAFF_PREVIEW_API_ORIGIN:'http://127.0.0.1:4101',
  STAFF_ENQUIRY_ADMIN_TOKEN:'admin.fixed.token',STAFF_ENQUIRY_ADMIN_ID:ADMIN,STAFF_ENQUIRY_ADMIN_INSTANCE:ADMIN_INSTANCE,
  STAFF_ENQUIRY_AGENT_TOKEN:'agent.fixed.token',STAFF_ENQUIRY_AGENT_ID:AGENT,STAFF_ENQUIRY_AGENT_INSTANCE:AGENT_INSTANCE};
const message='The synthetic enquiry preview request could not be completed.';
const summary=(patch={})=>({id:ENQUIRY,listingId:null,contactedRevision:null,name:'Synthetic enquiry',origin:'web',status:'new',assignedAgentId:null,nextActionAt:null,version:'1',createdAt:NOW,updatedAt:NOW,...patch});
const detail=(patch={})=>({...summary(),phone:'+254712345678',email:null,message:'Synthetic only.\nOriginal text.',noticeVersion:'synthetic-v1',closureReason:null,...patch});
const command=(patch={})=>({operationId:OPERATION,kind:'assign',expectedVersion:1,assignedAgentId:AGENT,status:null,nextActionAt:null,reason:null,...patch});
function receipt(input=command(),patch={}){
  const {operationId,kind,expectedVersion,assignedAgentId,status,nextActionAt,reason}=input;
  return {operationId,enquiryId:ENQUIRY,kind,expectedVersion:String(expectedVersion),request:{assignedAgentId,status,nextActionAt,reason},outcome:'applied',reason:null,
    result:{version:String(BigInt(expectedVersion)+1n),status:kind==='assign'?'assigned':kind==='reschedule'?'contacted':status,assignedAgentId:AGENT,nextActionAt:kind==='assign'?null:nextActionAt,closureReason:kind==='transition'?reason:null},completedAt:NOW,...patch};
}
const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{'X-Request-Id':REQUEST_ID,...headers}});
function path(action,actor='admin'){
  const base=`/api/enquiry-preview/${actor}`;
  return action==='list'?`${base}/enquiries`:action==='assignees'?`${base}/assignees`:action==='detail'?`${base}/enquiries/${ENQUIRY}`:action==='command'?`${base}/enquiries/${ENQUIRY}/operations`:`${base}/enquiries/${ENQUIRY}/operations/${OPERATION}`;
}
function params(action,actor='admin'){
  return {actor,...(!['list','assignees'].includes(action)?{id:ENQUIRY}:{}),...(action==='operation'?{operationId:OPERATION}:{})};
}
function request(action,{actor='admin',url=`http://127.0.0.1:3001${path(action,actor)}`,headers={},method=action==='command'?'POST':'GET',body,signal}={}){
  return new Request(url,{method,signal,headers:{host:'127.0.0.1:3001',origin:'http://127.0.0.1:3001','sec-fetch-site':'same-origin',
    'x-preview-instance':actor==='admin'?ADMIN_INSTANCE:AGENT_INSTANCE,...(method==='POST'?{'content-type':'application/json'}:{}),...headers},
    ...(body===undefined?(method==='POST'?{body:JSON.stringify(command())}:{}):{body}),...(body instanceof ReadableStream?{duplex:'half'}:{})});
}
function privateHeaders(response){
  assert.equal(response.headers.get('cache-control'),'private, no-store, max-age=0');assert.equal(response.headers.get('pragma'),'no-cache');
  assert.equal(response.headers.get('expires'),'0');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('cross-origin-resource-policy'),'same-origin');
  for(const name of ['set-cookie','location','etag','x-request-id','x-actor-id','x-tenant-id'])assert.equal(response.headers.has(name),false,name);
}
async function error(response,status,code,uncertain=false){assert.equal(response.status,status);privateHeaders(response);assert.deepEqual(await response.json(),{error:{code,message},submissionUncertain:uncertain});}

// These exercise the actual exported server helper and Next route exports with
// the real SDK and controlled fetch. They do not prove real login or browser UI.
test('fixed synthetic enquiry BFF keeps credentials server-side, validates original commands, and preserves safe uncertainty',async t=>{
  const priorEnv={...process.env},priorFetch=globalThis.fetch;Object.assign(process.env,env);let calls=[];
  t.after(()=>{globalThis.fetch=priorFetch;for(const key of Object.keys(process.env))if(!Object.hasOwn(priorEnv,key))delete process.env[key];Object.assign(process.env,priorEnv);});
  const mock=(respond=()=>json({items:[],limit:50,truncated:false}))=>{calls=[];globalThis.fetch=async(url,init)=>{calls.push({url:String(url),init});return respond(url,init);};};

  await t.test('safe page scopes are frozen, exact, separate, and unavailable outside the explicit complete configuration',()=>{
    const scope=getEnquiryPreviewScope('admin',env);assert.deepEqual(scope,{actorId:ADMIN,role:'admin',instanceId:ADMIN_INSTANCE});assert.ok(Object.isFrozen(scope));
    assert.deepEqual(getEnquiryPreviewScope('agent',env),{actorId:AGENT,role:'agent',instanceId:AGENT_INSTANCE});
    assert.equal(JSON.stringify(scope).includes('token'),false);assert.equal(Object.hasOwn(scope,'origin'),false);
    for(const actor of ['customer','ADMIN','',undefined])assert.throws(()=>getEnquiryPreviewScope(actor,env));
    for(const patch of [{NODE_ENV:'production'},{STAFF_ENQUIRY_PREVIEW_MODE:''},{STAFF_ENQUIRY_AGENT_TOKEN:''},{STAFF_ENQUIRY_ADMIN_TOKEN:'invalid token'},
      {STAFF_PREVIEW_API_ORIGIN:'https://external.invalid'},{STAFF_PREVIEW_API_ORIGIN:'http://127.0.0.1:4101/?tenant=chosen'},
      {STAFF_ENQUIRY_AGENT_ID:ADMIN},{STAFF_ENQUIRY_AGENT_INSTANCE:ADMIN_INSTANCE},{STAFF_ENQUIRY_AGENT_TOKEN:env.STAFF_ENQUIRY_ADMIN_TOKEN},
      {STAFF_ENQUIRY_ADMIN_ID:'00000000-0000-0000-0000-000000000000'},{STAFF_ENQUIRY_AGENT_INSTANCE:'old'}])assert.throws(()=>getEnquiryPreviewScope('admin',{...env,...patch}));
  });

  await t.test('actual list and directory routes await params, use fixed server tokens and keep bounded raw DTOs',async()=>{
    mock(url=>url.includes('enquiry-assignees')?json({items:[{userId:AGENT,role:'agent'}],limit:100,truncated:false}):json({items:[summary()],limit:50,truncated:false}));
    let awaited=false;const response=await listRoute(request('list',{headers:{'accept-encoding':'gzip, br'}}),{params:Promise.resolve().then(()=>{awaited=true;return {actor:'admin'};})});
    assert.ok(awaited);assert.equal(listDynamic,'force-dynamic');assert.equal(response.status,200);privateHeaders(response);assert.deepEqual(await response.json(),{items:[summary()],limit:50,truncated:false});
    assert.equal((await directoryRoute(request('assignees'),{params:Promise.resolve({actor:'admin'})})).status,200);
    assert.equal(calls.length,2);assert.equal(calls[0].url,'http://127.0.0.1:4101/v2/staff/enquiries?limit=50');assert.equal(calls[1].url,'http://127.0.0.1:4101/v2/staff/enquiry-assignees?limit=100');
    for(const {init} of calls){const h=new Headers(init.headers);assert.equal(h.get('authorization'),'Bearer admin.fixed.token');assert.equal(init.method,'GET');assert.equal(init.body,undefined);assert.equal(init.credentials,'omit');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.ok(init.signal instanceof AbortSignal);
      for(const name of ['host','origin','cookie','x-preview-instance','x-actor-id','accept-encoding'])assert.equal(h.has(name),false,name);}
    mock(()=>json({items:[],limit:1,truncated:false}));const agentRequest=request('list',{actor:'agent',url:`http://localhost:3001${path('list','agent')}?limit=1`});agentRequest.headers.delete('origin');agentRequest.headers.set('sec-fetch-site','none');
    assert.equal((await enquiryPreviewRequest(agentRequest,{actor:'agent'},'list')).status,200);assert.equal(new Headers(calls[0].init.headers).get('authorization'),'Bearer agent.fixed.token');
  });

  await t.test('detail and original-operation routes return independent validated snapshots without commands',async()=>{
    const oldReceipt=receipt(),current=detail({status:'qualified',assignedAgentId:AGENT,nextActionAt:NEXT,version:'7'});
    mock(url=>url.endsWith(`/operations/${OPERATION}`)?json(oldReceipt):json(current));
    const historical=await operationRoute(request('operation'),{params:Promise.resolve(params('operation'))});assert.deepEqual(await historical.json(),oldReceipt);
    const currentResponse=await detailRoute(request('detail'),{params:Promise.resolve(params('detail'))});assert.deepEqual(await currentResponse.json(),current);
    assert.equal(calls.length,2);assert.ok(calls.every(call=>call.init.method==='GET'&&call.init.body===undefined));
    assert.equal(calls[0].url,`http://127.0.0.1:4101/v2/staff/enquiries/${ENQUIRY}/operations/${OPERATION}`);
  });

  await t.test('configuration and request authority guards refuse before upstream or body reads',async()=>{
    mock();const old=process.env.NODE_ENV;process.env.NODE_ENV='production';try{await error(await enquiryPreviewRequest(request('list'),params('list'),'list'),403,'PREVIEW_UNAVAILABLE');}finally{process.env.NODE_ENV=old;}
    for(const headers of [{host:'evil.invalid'},{host:'127.0.0.1:3001, 127.0.0.1:3001'},{origin:'http://evil.invalid'},
      {'x-preview-instance':AGENT_INSTANCE},{'x-preview-instance':`${ADMIN_INSTANCE}, ${ADMIN_INSTANCE}`},{'sec-fetch-site':'cross-site'},{authorization:'Bearer browser-selected'}])
      await error(await enquiryPreviewRequest(request('list',{headers}),params('list'),'list'),403,'PREVIEW_UNAVAILABLE');
    await error(await enquiryPreviewRequest(request('list',{url:`https://127.0.0.1:3001${path('list')}`}),params('list'),'list'),403,'PREVIEW_UNAVAILABLE');
    const wrongOrigin=request('command',{headers:{origin:'http://evil.invalid'}});await error(await enquiryPreviewRequest(wrongOrigin,params('command'),'command'),403,'PREVIEW_UNAVAILABLE');
    let pulls=0;const stream=new ReadableStream({pull(){pulls++;}},{highWaterMark:0});
    await error(await enquiryPreviewRequest(request('command',{headers:{cookie:'session=chosen'},body:stream}),params('command'),'command'),400,'INVALID_INPUT');
    assert.equal(pulls,0);await stream.cancel();assert.equal(calls.length,0);
  });

  await t.test('only the exact path, method, sole canonical bounded limit and fixed admin picker are admitted',async()=>{
    mock();
    for(const suffix of ['?','?limit=0','?limit=01','?limit=101','?limit=1.0','?limit=1e0','?limit=1&limit=1','?limit=1&tenant=selected','?%6cimit=1','?actor=agent','/','#selected'])
      await error(await enquiryPreviewRequest(request('list',{url:`http://127.0.0.1:3001${path('list')}${suffix}`}),params('list'),'list'),400,'INVALID_INPUT');
    for(const action of ['detail','operation','command'])await error(await enquiryPreviewRequest(request(action,{url:`http://127.0.0.1:3001${path(action)}?limit=1`}),params(action),action),400,'INVALID_INPUT');
    await error(await enquiryPreviewRequest(request('detail',{url:`http://127.0.0.1:3001${path('detail').replace('/enquiries/','/%65nquiries/')}`}),params('detail'),'detail'),400,'INVALID_INPUT');
    await error(await enquiryPreviewRequest(request('detail'),{actor:'admin',id:'bad'},'detail'),400,'INVALID_INPUT');
    await error(await enquiryPreviewRequest(request('operation'),{...params('operation'),operationId:id(99)},'operation'),400,'INVALID_INPUT');
    await error(await enquiryPreviewRequest(request('assignees',{actor:'agent'}),{actor:'agent'},'assignees'),403,'FORBIDDEN');
    await error(await enquiryPreviewRequest(request('detail',{method:'POST'}),params('detail'),'detail'),405,'METHOD_NOT_ALLOWED');
    assert.equal(calls.length,0);
  });

  await t.test('read framing and context selectors never reach the upstream SDK',async()=>{
    mock();for(const headers of [{cookie:'session=selected'},{'content-length':'0'},{'content-type':'application/json'},{'content-encoding':'identity'},
      {'transfer-encoding':'chunked'},{expect:'100-continue'},{range:'bytes=0-99'},{'if-match':'1'},{'if-none-match':'1'},
      {'x-actor-id':AGENT},{'x-tenant-id':id(99)},{'x-role':'admin'},{'x-revision-version':'1'}])
      await error(await enquiryPreviewRequest(request('list',{headers}),params('list'),'list'),400,'INVALID_INPUT');
    const unexpected=request('list');let pulls=0;const stream=new ReadableStream({pull(){pulls++;}},{highWaterMark:0});Object.defineProperty(unexpected,'body',{value:stream});
    await error(await enquiryPreviewRequest(unexpected,params('list'),'list'),400,'INVALID_INPUT');assert.equal(pulls,0);await stream.cancel();assert.equal(calls.length,0);
  });

  await t.test('actual POST route forwards one complete original command with the maximum exact incrementable number',async()=>{
    const original=command({expectedVersion:9007199254740990});mock((_url,init)=>json(receipt(JSON.parse(init.body))));
    const response=await commandRoute(request('command',{body:JSON.stringify(original)}),{params:Promise.resolve(params('command'))});assert.equal(response.status,200);privateHeaders(response);
    assert.deepEqual(await response.json(),receipt(original));assert.equal(calls.length,1);const {url,init}=calls[0];
    assert.equal(url,`http://127.0.0.1:4101/v2/staff/enquiries/${ENQUIRY}/operations`);assert.equal(init.method,'POST');assert.deepEqual(JSON.parse(init.body),original);
    assert.equal(new Headers(init.headers).get('authorization'),'Bearer admin.fixed.token');assert.equal(new Headers(init.headers).get('idempotency-key'),null);
    for(const input of [command({kind:'transition',assignedAgentId:null,status:'contacted',nextActionAt:NEXT}),command({kind:'reschedule',assignedAgentId:null,nextActionAt:NEXT})]){
      mock((_url,init)=>json(receipt(JSON.parse(init.body))));assert.equal((await enquiryPreviewRequest(request('command',{actor:'agent',body:JSON.stringify(input)}),params('command','agent'),'command')).status,200);
      assert.equal(calls.length,1);assert.equal(new Headers(calls[0].init.headers).get('authorization'),'Bearer agent.fixed.token');
    }
  });

  await t.test('strict complete command JSON refuses duplicates, escaped duplicates, fractions, exponents and semantic overrides before IO',async()=>{
    mock();const source=JSON.stringify(command()),missing=command();delete missing.reason;
    const invalid=[source.replace('"expectedVersion":1','"expectedVersion":1.0'),source.replace('"expectedVersion":1','"expectedVersion":1e0'),
      source.replace('"expectedVersion":1','"expectedVersion":1.0000000000000001'),source.replace('"expectedVersion":1','"expectedVersion":"1"'),
      source.replace('"expectedVersion":1','"expectedVersion":1,"expectedVersion":1'),source.replace('"expectedVersion":1','"expectedVersion":1,"expected\\u0056ersion":1'),
      source.replace('"reason":null','"reason":null,"re\\u0061son":null'),JSON.stringify(command({expectedVersion:9007199254740991})),JSON.stringify(command({expectedVersion:0})),
      JSON.stringify({...command(),tenantId:id(90)}),JSON.stringify(missing),JSON.stringify(command({assignedAgentId:null})),JSON.stringify(command({status:'assigned'})),
      JSON.stringify(command({reason:'unused'})),JSON.stringify(command({kind:'transition',assignedAgentId:null,status:'contacted',nextActionAt:null})),JSON.stringify(command({kind:'reschedule',assignedAgentId:null,nextActionAt:'0000-01-01T00:00:00.000Z'})),
      'null','[]','{malformed}'];
    for(const body of invalid)await error(await enquiryPreviewRequest(request('command',{body}),params('command'),'command'),400,'INVALID_INPUT');
    assert.equal(calls.length,0);
  });

  await t.test('actual command bytes, declared length, UTF-8 and framing are bounded before upstream admission',async()=>{
    mock();for(const headers of [{'content-length':'8193'},{'content-length':'0'},{'content-length':'01'},{'content-length':'1, 1'},
      {'transfer-encoding':'chunked'},{'content-encoding':'gzip'},{expect:'100-continue'},{'content-type':'application/json; charset=latin1'}])
      await error(await enquiryPreviewRequest(request('command',{headers}),params('command'),'command'),400,'INVALID_INPUT');
    for(const body of ['',JSON.stringify(command({reason:'x'.repeat(8192)})),new Uint8Array([0xff,0xfe])])
      await error(await enquiryPreviewRequest(request('command',{body}),params('command'),'command'),400,'INVALID_INPUT');
    const emptyChunks=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array());}},{highWaterMark:0});
    await error(await enquiryPreviewRequest(request('command',{body:emptyChunks}),params('command'),'command'),400,'INVALID_INPUT');
    await error(await enquiryPreviewRequest(request('command',{headers:{'content-length':'1'}}),params('command'),'command'),400,'INVALID_INPUT');
    const bytes=new TextEncoder().encode(JSON.stringify(command()));let step=0;const stream=new ReadableStream({pull(controller){if(step++===0)controller.enqueue(bytes);else{bytes.fill(0);controller.close();}}},{highWaterMark:0});
    mock((_url,init)=>json(receipt(JSON.parse(init.body))));assert.equal((await enquiryPreviewRequest(request('command',{body:stream}),params('command'),'command')).status,200);
    assert.equal(calls.length,1);assert.deepEqual(JSON.parse(calls[0].init.body),command());
  });

  await t.test('malformed success DTOs, private-field leaks and mismatched original receipts fail safely without a retry',async()=>{
    for(const value of [{items:[{...summary(),phone:'+254712345678'}],limit:50,truncated:false},{items:[],limit:1,truncated:false},{items:[],limit:50,truncated:true}]){
      mock(()=>json(value));await error(await enquiryPreviewRequest(request('list'),params('list'),'list'),502,'PREVIEW_UNAVAILABLE');assert.equal(calls.length,1);
    }
    for(const value of [receipt(command({operationId:id(99)})),receipt(command({assignedAgentId:ADMIN})),receipt(command(),{expectedVersion:'2'}),{...receipt(),privateStorageKey:'secret'}]){
      mock(()=>json(value));await error(await enquiryPreviewRequest(request('command'),params('command'),'command'),502,'PREVIEW_UNAVAILABLE',true);assert.equal(calls.length,1);
    }
    mock(()=>json({...detail(),tenantId:id(99)}));await error(await enquiryPreviewRequest(request('detail'),params('detail'),'detail'),502,'PREVIEW_UNAVAILABLE');assert.equal(calls.length,1);
  });

  await t.test('safe correlated upstream errors preserve status and post-dispatch uncertainty without diagnostics',async()=>{
    for(const [status,code] of [[401,'UNAUTHENTICATED'],[403,'FORBIDDEN'],[404,'NOT_FOUND'],[409,'CONFLICT'],[422,'INVALID_STATE'],[429,'RATE_LIMITED'],[503,'SERVICE_UNAVAILABLE']]){
      mock(()=>json({error:{code,message:'C:\\private\\diagnostic-secret'},requestId:REQUEST_ID},status));
      await error(await enquiryPreviewRequest(request('detail'),params('detail'),'detail'),status,code);assert.equal(calls.length,1);
      mock(()=>json({error:{code,message:'private diagnostic'},requestId:REQUEST_ID},status));
      await error(await enquiryPreviewRequest(request('command'),params('command'),'command'),status,code,status>=500);assert.equal(calls.length,1);
    }
    mock(()=>json({error:{code:'NOT_FOUND',message:'private'},requestId:id(99)},404));await error(await enquiryPreviewRequest(request('command'),params('command'),'command'),502,'PREVIEW_UNAVAILABLE',true);assert.equal(calls.length,1);
    mock(()=>{throw new Error('Private bearer token and tenant should not be echoed.');});await error(await enquiryPreviewRequest(request('command'),params('command'),'command'),502,'PREVIEW_UNAVAILABLE',true);assert.equal(calls.length,1);
    mock(()=>new Response(null,{status:302,headers:{location:'http://private.invalid/secret'}}));await error(await enquiryPreviewRequest(request('detail'),params('detail'),'detail'),502,'PREVIEW_UNAVAILABLE');assert.equal(calls.length,1);
  });

  await t.test('cancellation before admission is certain; cancellation after command dispatch remains uncertain',async()=>{
    mock();const pre=new AbortController();pre.abort();await error(await enquiryPreviewRequest(request('command',{signal:pre.signal}),params('command'),'command'),499,'CANCELLED');assert.equal(calls.length,0);
    let cancelled=false;const waiting=new AbortController(),stream=new ReadableStream({cancel(){cancelled=true;}},{highWaterMark:0});
    const pending=enquiryPreviewRequest(request('command',{body:stream,signal:waiting.signal}),params('command'),'command');setTimeout(()=>waiting.abort(),5);
    await error(await pending,499,'CANCELLED');assert.equal(cancelled,true);assert.equal(calls.length,0);
    const dispatched=new AbortController();mock((_url,init)=>{setTimeout(()=>dispatched.abort(),5);return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('late private transport failure')),{once:true}));});
    await error(await enquiryPreviewRequest(request('command',{signal:dispatched.signal}),params('command'),'command'),499,'CANCELLED',true);assert.equal(calls.length,1);
  });
});
