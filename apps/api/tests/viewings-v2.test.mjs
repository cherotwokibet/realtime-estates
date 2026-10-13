import assert from 'node:assert/strict';
import test from 'node:test';
import {createApiService} from '../dist/service.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),actor=id(2),enquiry=id(3),viewing=id(4),listing=id(5),operation=id(6),time='2026-10-13T20:00:00.000Z';
const slot={startAt:'2090-01-01T09:00:00.000Z',endAt:'2090-01-01T10:00:00.000Z',timeZone:'Africa/Nairobi'};
const body={operationId:operation,expectedEnquiryVersion:2,listingId:listing,preferredSlots:[slot],notes:'  Private synthetic viewing.  '};
const schedule={viewingId:viewing,enquiryId:enquiry,listingId:listing,version:'1',status:'requested',preferredSlots:[slot],proposedSlot:null};
const receipt={operationId:operation,enquiryId:enquiry,viewingId:viewing,actorId:actor,kind:'request',expectedVersion:'2',observedVersion:'2',request:{listingId:listing,preferredSlots:[slot],notes:body.notes},outcome:'applied',reason:null,result:schedule,completedAt:time};
const detail={schedule,notes:body.notes,requestedById:actor,assignedAgentId:actor,createdAt:time,updatedAt:time};
const base=`/v2/staff/enquiries/${enquiry}`;
function fixture({result=receipt,privateDetail=detail,page={items:[detail],limit:25,truncated:false},role='agent',failure}={}){
 const calls=[],contexts=[];const database={async transaction(context,work){contexts.push(context);return work({async query(sql,args){calls.push({sql,args});if(sql.includes('staff_role'))return {rows:[{role}]};if(failure)throw failure;if(sql.includes('list_enquiry_viewings'))return {rows:[{page}]};if(sql.includes('app_api.read_viewing('))return {rows:[{detail:privateDetail}]};return {rows:[{receipt:result}]};}});}};
 return {calls,contexts,service:createApiService({database,tenantId:tenant,privacyNoticeVersion:'synthetic-v1',verifyAuthorization:async request=>{if(request.headers.get('authorization')!=='Bearer synthetic')throw new Error('PRIVATE AUTH');return {actorId:actor};}})};
}
const req=(path,{method='GET',value,raw,authorization='Bearer synthetic'}={})=>new Request('https://synthetic.invalid'+path,{method,headers:{...(authorization?{Authorization:authorization}:{}),...(value!==undefined||raw!==undefined?{'Content-Type':'application/json'}:{})},...(value!==undefined||raw!==undefined?{body:raw??JSON.stringify(value)}:{})});
test('viewing routes bind fixed verified authority,original facts and exact typed SQL arguments',async()=>{
 const f=fixture(),saved=await f.service(req(base+'/viewings',{method:'POST',value:body}));assert.equal(saved.status,200);assert.deepEqual(await saved.json(),receipt);assert.equal(f.contexts[0].tenantId,tenant);assert.equal(f.contexts[0].actorId,actor);
 const query=f.calls.find(c=>c.sql.includes('execute_viewing_operation'));assert.deepEqual(query.args,[enquiry,null,operation,'2','request',listing,JSON.stringify([slot]),body.notes,null]);
 assert.equal((await f.service(req(base+'/viewing-operations/'+operation))).status,200);assert.equal((await f.service(req(base+'/viewings/'+viewing))).status,200);assert.equal((await f.service(req(base+'/viewings'))).status,200);
});
test('viewing input rejects authority,extra facts,rounded versions,duplicates and query overrides before dispatch',async()=>{
 for(const value of [{...body,actorId:actor},{...body,tenantId:tenant},{...body,confirmed:true},{...body,expectedEnquiryVersion:'2'},{...body,preferredSlots:[{...slot,timeZone:null}]}]){const f=fixture();assert.equal((await f.service(req(base+'/viewings',{method:'POST',value}))).status,400);assert.equal(f.contexts.length,0);}
 for(const raw of [JSON.stringify(body).replace('"expectedEnquiryVersion":2','"expectedEnquiryVersion":2e0'),JSON.stringify(body).replace('"expectedEnquiryVersion":2','"expectedEnquiryVersion":2.00000000000000001'),JSON.stringify(body).replace('"notes":','"notes":"duplicate","notes":')]){const f=fixture();assert.equal((await f.service(req(base+'/viewings',{method:'POST',raw}))).status,400);assert.equal(f.contexts.length,0);}
 for(const suffix of ['/viewings?tenantId=foreign','/viewings?limit=26','/viewings?limit=01','/viewings?limit=1&limit=1',`/viewings/${viewing}?limit=1`]){const f=fixture();assert.equal((await f.service(req(base+suffix))).status,400);assert.equal(f.contexts.length,0);}
});
test('proposal route accepts only source-free first-proposal command and verified result',async()=>{
 const result={...receipt,kind:'propose',expectedVersion:'1',observedVersion:'1',request:{slot},result:{...schedule,version:'2',status:'proposed',proposedSlot:slot}},f=fixture({result});
 const response=await f.service(req(base+`/viewings/${viewing}/proposals`,{method:'POST',value:{operationId:operation,expectedVersion:1,slot}}));assert.equal(response.status,200);
 assert.deepEqual(f.calls.find(c=>c.sql.includes('execute_viewing_operation')).args,[enquiry,viewing,operation,'1','propose',null,null,null,JSON.stringify(slot)]);
 for(const [path,method] of [[`/viewings/${viewing}`,'POST'],[`/viewings/${viewing}/proposals`,'GET'],[`/viewing-operations/${operation}`,'POST'],['/viewings','PUT']])assert.equal((await f.service(req(base+path,{method}))).status,405);
});
test('malformed stored facts and wrong receipt actor/operation return sanitized service failure',async()=>{
 for(const result of [{...receipt,actorId:id(9)},{...receipt,request:{...receipt.request,notes:'changed'}},{...receipt,private:'SECRET'},{...receipt,result:{...schedule,enquiryId:id(9)}}]){const f=fixture({result}),response=await f.service(req(base+'/viewings',{method:'POST',value:body}));assert.equal(response.status,503);assert.equal((await response.text()).includes('SECRET'),false);}
 const wrong=fixture({result:{...receipt,operationId:id(9)}});assert.equal((await wrong.service(req(base+'/viewing-operations/'+operation))).status,503);
 const privateFailure=fixture({failure:{code:'P0002',message:'PRIVATE SQL'}}),response=await privateFailure.service(req(base+'/viewings'));assert.equal(response.status,404);assert.equal((await response.text()).includes('PRIVATE'),false);
 const customer=fixture({role:'customer'});assert.equal((await customer.service(req(base+'/viewings'))).status,403);assert.equal((await fixture().service(req(base+'/viewings',{authorization:null}))).status,401);
});
