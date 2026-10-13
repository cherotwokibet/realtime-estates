import assert from 'node:assert/strict';
import test from 'node:test';
import {validateViewingProperties} from '../dist/tests/lib/viewing-properties.js';
import {createEnquiryPreviewClient,EnquiryPreviewError} from '../dist/tests/lib/enquiry-client.js';
import {GET} from '../dist/tests/app/api/enquiry-preview/[actor]/viewing-properties/route.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const choice={id:id(100),title:'Fictional studio',locality:'Synthetic locality',purpose:'rent'},page={items:[choice],limit:25,mayBeTruncated:false};
test('public property choices freeze bounded unique labels and refuse hidden authority or invented completeness',()=>{
 const result=validateViewingProperties(page);assert.deepEqual(result,page);assert.ok(Object.isFrozen(result.items[0]));
 for(const value of [{...page,actorId:id(1)},{...page,mayBeTruncated:true},{...page,items:[choice,choice]},{...page,items:[{...choice,privateAddress:'private'}]},{...page,items:[{...choice,title:'a\u0000b'}]},{...page,items:[{...choice,id:'manual-id'}]},{...page,items:[{...choice,purpose:'lease'}]}])assert.throws(()=>validateViewingProperties(value));
 const full={items:Array.from({length:25},(_,index)=>({...choice,id:id(100+index)})),limit:25,mayBeTruncated:true};assert.equal(validateViewingProperties(full).items.length,25);assert.throws(()=>validateViewingProperties({...full,mayBeTruncated:false}));
});
test('browser property choices are bounded same-origin reads without identity and malformed replies stay read-only',async()=>{
 let captured;const client=createEnquiryPreviewClient({basePath:'/api/enquiry-preview/agent',instanceId:id(3),fetch:async(url,init)=>{captured={url,init};return Response.json(page);}});
 assert.deepEqual(await client.viewingProperties(),page);assert.equal(captured.url,'/api/enquiry-preview/agent/viewing-properties?limit=25');assert.equal(captured.init.method,'GET');assert.equal(captured.init.body,undefined);assert.equal(captured.init.credentials,'omit');assert.equal(new Headers(captured.init.headers).get('authorization'),null);
 const bad=createEnquiryPreviewClient({basePath:'/api/enquiry-preview/agent',instanceId:id(3),fetch:async()=>Response.json({...page,items:[choice,choice]})});await assert.rejects(()=>bad.viewingProperties(),e=>e instanceof EnquiryPreviewError&&!e.uncertain);
});
test('property BFF fixes company catalogue,projects public labels only and refuses caller context before dispatch',async t=>{
 const oldEnv={...process.env},oldFetch=globalThis.fetch;
 Object.assign(process.env,{NODE_ENV:'development',STAFF_ENQUIRY_PREVIEW_MODE:'synthetic-v1',STAFF_PREVIEW_API_ORIGIN:'http://127.0.0.1:4101',STAFF_ENQUIRY_ADMIN_TOKEN:'admin.fixed.token',STAFF_ENQUIRY_ADMIN_ID:id(1),STAFF_ENQUIRY_ADMIN_INSTANCE:id(3),STAFF_ENQUIRY_AGENT_TOKEN:'agent.fixed.token',STAFF_ENQUIRY_AGENT_ID:id(2),STAFF_ENQUIRY_AGENT_INSTANCE:id(4)});
 t.after(()=>{globalThis.fetch=oldFetch;for(const key of Object.keys(process.env))if(!(key in oldEnv))delete process.env[key];Object.assign(process.env,oldEnv);});
 const property={...choice,slug:'fictional-studio',revision:1,description:'Fictional property only.',propertyType:'studio',currency:'KES',amountMinor:2000000,rentPeriod:'month',bedrooms:0,privateBathrooms:1,sharedBathrooms:null,country:'KE',publicPrecision:'area',latitude:null,longitude:null,photos:Array.from({length:4},(_,index)=>({key:`synthetic/picker-${index}.webp`,alt:`Fictional metadata ${index}`})),pricing:{declaration:'not_declared',charges:[]},location:{county:'Synthetic County',town:null,area:null}};
 let calls=[];globalThis.fetch=async(url,init)=>{calls.push({url:String(url),init});return Response.json({items:[property],limit:25},{headers:{'X-Request-Id':id(9)}});};
 const request=(suffix='?limit=25',headers={})=>new Request('http://127.0.0.1:3001/api/enquiry-preview/admin/viewing-properties'+suffix,{headers:{host:'127.0.0.1:3001','sec-fetch-site':'same-origin','x-preview-instance':id(3),...headers}}),context={params:Promise.resolve({actor:'admin'})};
 const response=await GET(request(),context);assert.equal(response.status,200);assert.deepEqual(await response.json(),page);assert.equal(response.headers.get('cache-control'),'private, no-store, max-age=0');assert.equal(calls.length,1);assert.equal(calls[0].url,'http://127.0.0.1:4101/v2/properties?limit=25');assert.equal(new Headers(calls[0].init.headers).get('authorization'),null);
 calls=[];for(const suffix of ['?tenantId=foreign','?limit=26','?limit=25&limit=25','?limit=025','?limit=25&actor=agent'])assert.equal((await GET(request(suffix),context)).status,400);assert.equal((await GET(request('?limit=25',{'x-tenant-id':id(99)}),context)).status,400);assert.equal((await GET(request('?limit=25',{'x-preview-instance':id(99)}),context)).status,403);assert.equal(calls.length,0);
 globalThis.fetch=async()=>Response.json({items:[{...property,privateAddress:'private'}],limit:25});const malformed=await GET(request(),context);assert.equal(malformed.status,502);assert.equal((await malformed.json()).submissionUncertain,false);
});
