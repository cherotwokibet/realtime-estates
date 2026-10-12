import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {allowedEnquiryActions,createEnquiryCommand,enquiryActionLabel,enquiryStatusLabel,enquiryForm,enquiryFormsEqual,toNairobiInput,fromNairobiInput,formatEnquiryTime,enquiryDueLabel,validateEnquiryCommand} from '../dist/tests/lib/enquiry-model.js';
import {createEnquiryPreviewClient,EnquiryPreviewError} from '../dist/tests/lib/enquiry-client.js';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ENQUIRY=id(100),LISTING=id(200),AGENT=id(300),OTHER=id(301),OPERATION=id(400),INSTANCE=id(900);
const NOW='2026-10-12T08:20:30.123Z',NEXT='2026-10-13T12:00:00.456Z',BASE='/api/enquiry-preview/admin';
const summary=(patch={})=>({id:ENQUIRY,listingId:LISTING,contactedRevision:2,name:'Synthetic prospect',origin:'web',status:'assigned',assignedAgentId:AGENT,nextActionAt:null,version:'1',createdAt:NOW,updatedAt:NOW,...patch});
const detail=(patch={})=>({...summary(),phone:'+254712345678',email:null,message:'Synthetic multiline\nmessage\twith\r\nlegacy\u0085text.',noticeVersion:'synthetic-v1',closureReason:null,...patch});
const assign=(patch={})=>({operationId:OPERATION,kind:'assign',expectedVersion:'1',assignedAgentId:AGENT,status:null,nextActionAt:null,reason:null,...patch});
function receipt(command=assign(),patch={}){const {operationId,kind,expectedVersion,assignedAgentId,status,nextActionAt,reason}=command;return {operationId,enquiryId:ENQUIRY,kind,expectedVersion,request:{assignedAgentId,status,nextActionAt,reason},outcome:'applied',reason:null,result:{version:String(BigInt(expectedVersion)+1n),status:kind==='assign'?'assigned':kind==='reschedule'?'contacted':status,assignedAgentId:AGENT,nextActionAt:kind==='assign'?null:nextActionAt,closureReason:kind==='transition'?reason:null},completedAt:NOW,...patch};}
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});
const error=(status=403,code='FORBIDDEN',uncertain=false,patch={})=>json({error:{code,message:'Private upstream diagnostic must stay hidden'},submissionUncertain:uncertain,...patch},status);
const client=(fetch,extra={})=>createEnquiryPreviewClient({basePath:BASE,instanceId:INSTANCE,fetch,...extra});
const rejects=(operation,kind,uncertain=false,status)=>assert.rejects(operation,value=>value instanceof EnquiryPreviewError&&value.kind===kind&&value.uncertain===uncertain&&(status===undefined||value.status===status));
function controlled(parts,{headers={},status=200,hang=false,readError=false}={}){
 let index=0,reads=0,cancels=0,releases=0;
 const reader={async read(){reads++;if(readError)throw new Error('private transport diagnostics');if(hang)return new Promise(()=>{});return index<parts.length?{done:false,value:typeof parts[index]==='function'?parts[index++]():parts[index++]}:{done:true,value:undefined};},cancel(){cancels++;return Promise.resolve();},releaseLock(){releases++;}};
 const response={status,ok:status>=200&&status<300,redirected:false,url:'',headers:new Headers({'Content-Type':'application/json',...headers}),body:{getReader(){return reader;},cancel(){cancels++;return Promise.resolve();}},text(){throw new Error('Unbounded text reads are forbidden');},json(){throw new Error('Unbounded JSON reads are forbidden');},arrayBuffer(){throw new Error('Unbounded body reads are forbidden');}};
 return {response,get reads(){return reads;},get cancels(){return cancels;},get releases(){return releases;}};
}
const bytes=value=>new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value));

test('lifecycle choices reflect persisted states without granting permission or inventing transitions',()=>{
 const expected={new:['close_lost','spam'],assigned:['contact','close_lost','spam'],contacted:['qualify','reschedule','close_lost','spam'],qualified:['close_won','reschedule','close_lost','spam'],closed_won:['reopen'],closed_lost:['reopen'],spam:['reopen']};
 for(const [status,actions] of Object.entries(expected)){assert.deepEqual(allowedEnquiryActions(detail({status}), 'agent'),actions);const admin=allowedEnquiryActions(detail({status}),'admin');assert.ok(admin.includes('assign'));assert.equal(new Set(admin).size,admin.length);assert.ok(Object.isFrozen(admin));}
 assert.equal(allowedEnquiryActions(detail({status:'new'}),'admin')[0],'assign');assert.throws(()=>allowedEnquiryActions(detail({status:'viewing'}),'admin'));
 assert.equal(enquiryActionLabel('contact'),'Record contact');assert.equal(enquiryStatusLabel('closed_lost'),'Closed · lost');
});

test('form and command factories retain raw dates/reasons while binding exactly seven original fields',()=>{
 const saved=detail(),form=enquiryForm(saved,'agent');assert.deepEqual(form,{action:'contact',assignedAgentId:AGENT,nextActionLocal:'',reason:''});
 form.nextActionLocal='2026-10-13T15:00:00.456';form.reason='  ignored raw notes  ';const raw=structuredClone(form);
 const command=createEnquiryCommand(saved,form,OPERATION,'agent');assert.deepEqual(command,{operationId:OPERATION,kind:'transition',expectedVersion:'1',assignedAgentId:null,status:'contacted',nextActionAt:NEXT,reason:null});assert.ok(Object.isFrozen(command));assert.deepEqual(form,raw);assert.equal(enquiryFormsEqual(form,raw),true);
 form.action='close_lost';form.reason='  Requested closure  ';const closed=createEnquiryCommand(saved,form,OPERATION,'agent');assert.equal(closed.reason,'Requested closure');assert.equal(closed.nextActionAt,null);assert.equal(form.reason,'  Requested closure  ');
 const assigned={...form,action:'assign',assignedAgentId:OTHER,nextActionLocal:'bad date',reason:'raw\nunused'};assert.equal(createEnquiryCommand(saved,assigned,OPERATION,'admin').assignedAgentId,OTHER);assert.throws(()=>createEnquiryCommand(saved,assigned,OPERATION,'agent'));
 assert.throws(()=>createEnquiryCommand(saved,{...form,action:'qualify'},OPERATION,'admin'));assert.equal(enquiryFormsEqual(form,{...form,reason:'changed'}),false);
});

test('reopen follows the actual saved assignment and reason, rescheduling preserves millisecond intent',()=>{
 for(const assignedAgentId of [null,AGENT]){const saved=detail({status:'closed_lost',assignedAgentId,closureReason:'Prior recorded reason'}),form=enquiryForm(saved,'admin');assert.equal(form.reason,'');form.reason='Reopening requested';const command=createEnquiryCommand(saved,form,OPERATION,'admin');assert.equal(command.status,assignedAgentId===null?'new':'assigned');assert.equal(command.reason,'Reopening requested');}
 const saved=detail({status:'qualified',nextActionAt:NEXT}),form=enquiryForm(saved,'agent');assert.equal(form.nextActionLocal,'2026-10-13T15:00:00.456');form.action='reschedule';assert.deepEqual(createEnquiryCommand(saved,form,OPERATION,'agent'),assign({kind:'reschedule',assignedAgentId:null,nextActionAt:NEXT}));
 const prior=structuredClone(form);form.nextActionLocal='2026-02-30T12:00';assert.throws(()=>createEnquiryCommand(saved,form,OPERATION,'agent'));assert.equal(form.nextActionLocal,'2026-02-30T12:00');assert.equal(enquiryFormsEqual(form,prior),false);
});

test('Nairobi civil conversion is exact at midnight, leap days, low years and fractional seconds',()=>{
 const cases=[['2026-10-13T00:00','2026-10-12T21:00:00.000Z'],['2024-02-29T00:15:30.001','2024-02-28T21:15:30.001Z'],['0001-01-01T03:00:00.123','0001-01-01T00:00:00.123Z'],['0099-12-31T23:59:59.999','0099-12-31T20:59:59.999Z'],['9999-12-31T23:59:59.999','9999-12-31T20:59:59.999Z'],['2026-10-13T15:00:00.4','2026-10-13T12:00:00.400Z']];
 for(const [local,wire] of cases){assert.equal(fromNairobiInput(local),wire);assert.equal(fromNairobiInput(toNairobiInput(wire)),wire);}
 assert.equal(toNairobiInput(null),'');assert.equal(formatEnquiryTime(null),'Not scheduled');assert.match(formatEnquiryTime(NEXT),/15:00:00.*EAT \(UTC\+03:00\)/);
 for(const local of ['',null,'0000-01-01T03:00','0001-01-01T02:59','2026-02-29T12:00','2026-04-31T12:00','2026-13-01T12:00','2026-01-01T24:00','2026-01-01T00:60','2026-01-01T00:00:60','2026-01-01T00:00:00.0000','2026-01-01T00:00Z','2026-1-1T00:00'])assert.throws(()=>fromNairobiInput(local));
 for(const wire of ['0000-01-01T00:00:00.000Z','2026-02-30T00:00:00.000Z','2026-10-13T12:00:00Z','9999-12-31T21:00:00.000Z'])assert.throws(()=>toNairobiInput(wire));
});

test('Nairobi date helpers produce identical results under unrelated host timezones',()=>{
 const moduleUrl=new URL('../dist/tests/lib/enquiry-model.js',import.meta.url).href;
 const code=`import {fromNairobiInput,toNairobiInput,formatEnquiryTime} from ${JSON.stringify(moduleUrl)};process.stdout.write(JSON.stringify([fromNairobiInput('2026-10-13T00:00:00.456'),toNairobiInput('2026-10-13T12:00:00.456Z'),formatEnquiryTime('2026-10-13T12:00:00.456Z')]));`;
 const results=['UTC','America/Los_Angeles','Asia/Tokyo'].map(TZ=>{const child=spawnSync(process.execPath,['--input-type=module','--eval',code],{env:{...process.env,TZ},encoding:'utf8',timeout:5000});assert.equal(child.status,0,child.stderr);return child.stdout;});
 assert.equal(new Set(results).size,1);assert.equal(JSON.parse(results[0])[0],'2026-10-12T21:00:00.456Z');
});

test('follow-up due labels use EAT civil days and never infer a completion or viewing',()=>{
 const now=Date.parse('2026-10-12T20:30:00.000Z');assert.equal(enquiryDueLabel(null,now),'No follow-up scheduled');assert.equal(enquiryDueLabel('2026-10-12T20:29:00.000Z',now),'Overdue');assert.equal(enquiryDueLabel('2026-10-12T20:45:00.000Z',now),'Due today');assert.equal(enquiryDueLabel('2026-10-12T21:00:00.000Z',now),'Due tomorrow');assert.equal(enquiryDueLabel('2026-10-14T21:00:00.000Z',now),'Upcoming');
});

test('command validation refuses extra authority, accessors, unsupported versions and malformed selectors',()=>{
 let getters=0;const accessor=assign();Object.defineProperty(accessor,'kind',{enumerable:true,get(){getters++;throw new Error('getter');}});
 const missing=assign();delete missing.reason;const hidden=assign();Object.defineProperty(hidden,'actorId',{value:OTHER});
 for(const command of [null,[],accessor,missing,hidden,{...assign(),tenantId:OTHER},{...assign(),[Symbol('x')]:true},Object.assign(Object.create({}),assign()),assign({assignedAgentId:null}),assign({status:'assigned'}),assign({kind:'reschedule',assignedAgentId:null,nextActionAt:null}),assign({kind:'transition',assignedAgentId:null,status:'contacted',nextActionAt:null}),assign({kind:'transition',assignedAgentId:null,status:'spam',reason:'bad\nreason'}),assign({kind:'transition',assignedAgentId:null,status:'spam',reason:'bad\ud800'})])assert.throws(()=>validateEnquiryCommand(command));
 for(const expectedVersion of ['0','01','+1','1e0','1.0',1,'9007199254740991','9223372036854775807'])assert.throws(()=>validateEnquiryCommand(assign({expectedVersion})));
 const valid=assign({kind:'transition',assignedAgentId:null,status:'spam',reason:'😀'.repeat(1000)});assert.equal(validateEnquiryCommand(valid).reason,valid.reason);assert.throws(()=>validateEnquiryCommand({...valid,reason:'😀'.repeat(1001)}));assert.equal(getters,0);
 assert.equal(validateEnquiryCommand(assign({expectedVersion:'9007199254740990'})).expectedVersion,'9007199254740990');
});

test('browser transport uses fixed actor paths, omitted credentials, instance header and frozen bounded DTOs',async()=>{
 const calls=[],api=client(async(path,init)=>{calls.push({path,init});return path.includes('/assignees')?json({items:[{userId:AGENT,role:'agent'}],limit:100,truncated:false}):path.includes('?')?json({items:[summary()],limit:50,truncated:false}):json(detail());});
 const list=await api.list(),value=await api.detail(ENQUIRY.toUpperCase()),directory=await api.assignees();assert.deepEqual(list.items,[summary()]);assert.deepEqual(value,detail());assert.ok(Object.isFrozen(list)&&Object.isFrozen(list.items)&&Object.isFrozen(list.items[0])&&Object.isFrozen(directory.items[0]));
 assert.deepEqual(calls.map(call=>call.path),[BASE+'/enquiries?limit=50',BASE+'/enquiries/'+ENQUIRY,BASE+'/assignees?limit=100']);
 for(const {init} of calls){assert.equal(init.method,'GET');assert.equal(init.credentials,'omit');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.equal(init.body,undefined);assert.deepEqual(init.headers,{Accept:'application/json','X-Preview-Instance':INSTANCE});}
 const agent=client(async path=>{assert.equal(path,'/api/enquiry-preview/agent/enquiries?limit=50');return json({items:[],limit:50,truncated:false});},{basePath:'/api/enquiry-preview/agent'});await agent.list();
});

test('apply snapshots canonical command/options and emits one numeric seven-field wire request',async()=>{
 const config={basePath:BASE,instanceId:INSTANCE,timeoutMs:1000},original=assign({expectedVersion:'9007199254740990'}),saved=structuredClone(original);let seen,calls=0;
 config.fetch=async(path,init)=>{calls++;seen={path,init,body:JSON.parse(init.body)};config.instanceId=OTHER;original.assignedAgentId=OTHER;original.expectedVersion='2';await new Promise(resolve=>setImmediate(resolve));return json(receipt(saved));};
 const api=createEnquiryPreviewClient(config),pending=api.apply(ENQUIRY,original);original.reason='changed after dispatch';const value=await pending;
 assert.equal(calls,1);assert.deepEqual(seen.body,{...saved,expectedVersion:9007199254740990});assert.equal(seen.init.headers['X-Preview-Instance'],INSTANCE);assert.equal(seen.init.headers['Content-Type'],'application/json');assert.equal(value.result.version,'9007199254740991');assert.ok(Object.isFrozen(value.request)&&Object.isFrozen(value.result));
});

test('pre-dispatch client configuration, selectors, signal and command failures never become uncertain',async()=>{
 let getters=0,calls=0;const getter={basePath:BASE,instanceId:INSTANCE};Object.defineProperty(getter,'fetch',{enumerable:true,get(){getters++;throw new Error('getter');}});
 for(const config of [null,{},getter,{basePath:'https://other.invalid',instanceId:INSTANCE},{basePath:BASE+'?tenant='+OTHER,instanceId:INSTANCE},{basePath:BASE,instanceId:'bad'},{basePath:BASE,instanceId:INSTANCE,timeoutMs:null},{basePath:BASE,instanceId:INSTANCE,timeoutMs:0},{basePath:BASE,instanceId:INSTANCE,timeoutMs:30001},{basePath:BASE,instanceId:INSTANCE,actorId:OTHER}])assert.throws(()=>createEnquiryPreviewClient(config),value=>value.kind==='validation'&&!value.uncertain);
 const api=client(async()=>{calls++;return json(receipt());});for(const selected of ['bad',ENQUIRY+'?actor='+OTHER,null]){await rejects(()=>api.detail(selected),'validation');await rejects(()=>api.apply(selected,assign()),'validation');await rejects(()=>api.recover(selected,assign()),'validation');}
 await rejects(()=>api.apply(ENQUIRY,assign({expectedVersion:'01'})),'validation');await rejects(()=>api.apply(ENQUIRY,assign(),{}),'validation');assert.equal(getters,0);assert.equal(calls,0);
});

test('bounded stream collector accepts byte chunks and exact cap without unbounded response methods',async()=>{
 const encoded=bytes(detail()),padded=new Uint8Array(512*1024);padded.fill(32);padded.set(encoded);const stream=controlled([padded.subarray(0,200),padded.subarray(200)],{headers:{'Content-Length':String(padded.length)}});
 assert.deepEqual(await client(async()=>stream.response).detail(ENQUIRY),detail());assert.equal(stream.reads,3);assert.equal(stream.cancels,1);assert.equal(stream.releases,1);
 const reuse=new Uint8Array(encoded.length+2),view=reuse.subarray(1,-1);view.set(encoded);let getters=0;for(const key of ['buffer','byteLength','byteOffset'])Object.defineProperty(view,key,{get(){getters++;throw new Error('getter');}});
 const reused=controlled([view,()=>{reuse.fill(255);return new Uint8Array();}]);assert.deepEqual(await client(async()=>reused.response).detail(ENQUIRY),detail());assert.equal(getters,0);
});

test('oversized, inconsistent, shared, detached and invalid UTF-8 streams are cancelled conservatively',async()=>{
 const encoded=bytes(detail()),detached=new Uint8Array([1]);structuredClone(detached,{transfer:[detached.buffer]});
 const chunks=[new Uint8Array(512*1024+1),new Uint16Array([1]),new Proxy(new Uint8Array([1]),{}),detached,new Uint8Array([0xff])];if(typeof SharedArrayBuffer==='function')chunks.push(new Uint8Array(new SharedArrayBuffer(1)));
 for(const chunk of chunks){const stream=controlled([chunk]);await rejects(()=>client(async()=>stream.response).apply(ENQUIRY,assign()),'response',true);assert.ok(stream.cancels>=1);}
 for(const declared of ['0','01','+1','1e1',String(512*1024+1)]){const stream=controlled([encoded],{headers:{'Content-Length':declared}});await rejects(()=>client(async()=>stream.response).detail(ENQUIRY),'response');assert.equal(stream.reads,0);assert.equal(stream.cancels,1);}
 for(const declared of [String(encoded.length-1),String(encoded.length+1)]){const stream=controlled([encoded],{headers:{'Content-Length':declared}});await rejects(()=>client(async()=>stream.response).detail(ENQUIRY),'response');assert.ok(stream.cancels>=1);}
 const over=controlled([new Uint8Array(512*1024+1),()=>{throw new Error('No second admission');}]);await rejects(()=>client(async()=>over.response).detail(ENQUIRY),'response');assert.equal(over.reads,1);
});

test('standard browser-decoded compression remains bounded and redirects/ranges/wrong scopes fail',async()=>{
 for(const encoding of ['gzip','br','deflate']){const stream=controlled([bytes(detail())],{headers:{'Content-Encoding':encoding,'Content-Length':'20'}});assert.deepEqual(await client(async()=>stream.response).detail(ENQUIRY),detail());}
 for(const headers of [{'Content-Encoding':'unknown'},{'Content-Range':'bytes 0-10/20'},{'Content-Type':'text/html'}]){const stream=controlled([bytes(detail())],{headers});await rejects(()=>client(async()=>stream.response).detail(ENQUIRY),'response');assert.equal(stream.reads,0);assert.equal(stream.cancels,1);}
 for(const patch of [{redirected:true},{url:'http://127.0.0.1:3001/api/enquiry-preview/agent/enquiries/'+ENQUIRY},{url:'http://127.0.0.1:3001'+BASE+'/enquiries/'+ENQUIRY+'#fragment'},{status:302},{status:201}]){const stream=controlled([bytes(receipt())]);Object.assign(stream.response,patch);await rejects(()=>client(async()=>stream.response).apply(ENQUIRY,assign()),'response',true);}
});

test('raw duplicate decoded keys, rounded integer tokens and private or inconsistent page fields fail',async()=>{
 const page=JSON.stringify({items:[summary()],limit:50,truncated:false});for(const source of [page.replace('"limit":50','"limit":5e1'),page.replace('"contactedRevision":2','"contactedRevision":2.0000000000000001'),page.replace('"name":"Synthetic prospect"','"name":"Original","na\\u006de":"Changed"')])await rejects(()=>client(async()=>new Response(source,{headers:{'Content-Type':'application/json'}})).list(),'response');
 const cases=[{items:[],limit:50,truncated:true},{items:[summary(),summary()],limit:50,truncated:false},{items:[],limit:49,truncated:false},{items:[{...summary(),phone:'+254712345678'}],limit:50,truncated:false},{items:[],limit:50,truncated:false,total:0},{items:Array.from({length:51},(_,index)=>summary({id:id(index+1000)})),limit:50,truncated:false}];for(const value of cases)await rejects(()=>client(async()=>json(value)).list(),'response');
 for(const items of [[{userId:AGENT,role:'customer'}],[{userId:AGENT,role:'agent',name:'Invented label'}],[{userId:AGENT,role:'agent'},{userId:AGENT,role:'admin'}]])await rejects(()=>client(async()=>json({items,limit:100,truncated:false})).assignees(),'response');
});

test('detail and original receipt correlation failures cannot adopt unrelated or malformed state',async()=>{
 await rejects(()=>client(async()=>json(detail({id:OTHER}))).detail(ENQUIRY),'response');const values=[receipt(assign(),{enquiryId:OTHER}),receipt(assign(),{operationId:OTHER}),receipt(assign({assignedAgentId:OTHER})),receipt(assign({expectedVersion:'2'})),{...receipt(),result:{...receipt().result,version:'1'}},{...receipt(),request:{...receipt().request,tenantId:OTHER}}];
 for(const value of values){let calls=0;const api=client(async()=>{calls++;return json(value);});await rejects(()=>api.apply(ENQUIRY,assign()),'response',true);assert.equal(calls,1);await rejects(()=>api.recover(ENQUIRY,assign()),'response');assert.equal(calls,2);}
});

test('known safe HTTP failures hide diagnostic text, respect uncertainty and never retry',async()=>{
 const statuses=[[400,'INVALID_INPUT'],[401,'UNAUTHENTICATED'],[403,'FORBIDDEN'],[404,'NOT_FOUND'],[409,'CONFLICT'],[413,'BODY_TOO_LARGE'],[415,'JSON_REQUIRED'],[422,'INVALID_STATE'],[429,'RATE_LIMITED'],[499,'CANCELLED'],[502,'PREVIEW_UNAVAILABLE'],[503,'SERVICE_UNAVAILABLE'],[504,'PREVIEW_UNAVAILABLE']];
 for(const [status,code] of statuses){let calls=0;const api=client(async()=>{calls++;return error(status,code);});await assert.rejects(()=>api.apply(ENQUIRY,assign()),value=>value.kind==='http'&&value.status===status&&value.uncertain===(status>=500||status===499)&&!value.message.includes('Private upstream'));assert.equal(calls,1);await rejects(()=>api.detail(ENQUIRY),'http',false,status);}
 await rejects(()=>client(async()=>error(404,'NOT_FOUND',true)).apply(ENQUIRY,assign()),'http',true,404);await rejects(()=>client(async()=>error(404,'NOT_FOUND',true)).detail(ENQUIRY),'http',false,404);
 for(const response of [error(403,'UNKNOWN'),error(404,'FORBIDDEN'),error(403,'FORBIDDEN',false,{stack:'private'}),json({error:{code:'FORBIDDEN',message:'Denied'}},403),json({error:{code:'FORBIDDEN',message:'Denied',private:true},submissionUncertain:false},403)])await rejects(()=>client(async()=>response).apply(ENQUIRY,assign()),'response',true);
});

test('a lost committed reply recovers only the retained original operation without another POST',async()=>{
 const calls=[],saved=receipt();let currentVersion='1';const api=client(async(path,init)=>{calls.push({path,method:init.method});if(init.method==='POST'){currentVersion='2';throw new Error('Lost reply with private diagnostics');}return json(saved);});
 const command=assign();await rejects(()=>api.apply(ENQUIRY,command),'network',true);currentVersion='9';assert.deepEqual(await api.recover(ENQUIRY,command),saved);assert.equal(currentVersion,'9');assert.deepEqual(calls,[{path:BASE+'/enquiries/'+ENQUIRY+'/operations',method:'POST'},{path:BASE+'/enquiries/'+ENQUIRY+'/operations/'+OPERATION,method:'GET'}]);
 await rejects(()=>client(async()=>error(404,'NOT_FOUND')).recover(ENQUIRY,command),'http',false,404);
});

test('deadlines and cancellation bound pending transports/streams and retain write uncertainty',async()=>{
 let calls=0;const api=client(async()=>{calls++;return new Promise(()=>{});},{timeoutMs:10});await rejects(()=>api.apply(ENQUIRY,assign()),'timeout',true);assert.equal(calls,1);await rejects(()=>api.detail(ENQUIRY),'timeout');
 const before=new AbortController();before.abort();await rejects(()=>api.apply(ENQUIRY,assign(),before.signal),'cancelled');assert.equal(calls,2);
 const hanging=controlled([],{hang:true});await rejects(()=>client(async()=>hanging.response,{timeoutMs:10}).apply(ENQUIRY,assign()),'timeout',true);assert.equal(hanging.cancels,1);
 const controller=new AbortController();const cancelled=client(async()=>{queueMicrotask(()=>controller.abort());return new Promise(()=>{});});await rejects(()=>cancelled.apply(ENQUIRY,assign(),controller.signal),'cancelled',true);
 let emptyReads=0,cancels=0;const response={status:200,redirected:false,url:'',headers:new Headers({'Content-Type':'application/json'}),body:{getReader(){return {async read(){emptyReads++;return {done:false,value:new Uint8Array()};},cancel(){cancels++;return Promise.resolve();},releaseLock(){}};}}};
 await rejects(()=>client(async()=>response,{timeoutMs:10}).detail(ENQUIRY),'timeout');assert.ok(emptyReads>0);assert.equal(cancels,1);
});

test('late ignored fetch completions are cancelled after abort and cannot become usable data',async()=>{
 let resolve;const controller=new AbortController(),api=client(()=>new Promise(done=>{resolve=done;}));const pending=api.detail(ENQUIRY,controller.signal);controller.abort();await rejects(()=>pending,'cancelled');let cancels=0;
 resolve({body:{cancel(){cancels++;return Promise.resolve();}}});await new Promise(done=>setImmediate(done));assert.equal(cancels,1);
});
