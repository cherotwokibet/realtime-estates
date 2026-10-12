import test from 'node:test';
import assert from 'node:assert/strict';
import {createEnquiryProxyTransport,RealtorApiClient} from '../dist/index.js';
const origin='https://agency.example.invalid',instanceId='00000000-0000-4000-8000-000000000910',id='00000000-0000-4000-8000-000000000911';
const response=()=>{const r=new Response(JSON.stringify({id}),{status:201,headers:{'content-type':'application/json'}});Object.defineProperty(r,'url',{value:origin+'/api/enquiry-intake',configurable:true});return r;};
const options=fetch=>({origin,instanceId,fetch});
const init=()=>({method:'POST',body:'{}',headers:{'content-type':'application/json','Idempotency-Key':id}});
test('transport freezes its destination and instance, omits cookies and refuses redirects',async()=>{
 let captured;const config=options(async(url,init)=>{captured={url,init};return response();}),transport=createEnquiryProxyTransport(config);config.origin='https://other.example.invalid';config.instanceId=id;
 const abort=new AbortController();const result=await transport(origin+'/v1/enquiries',{...init(),signal:abort.signal,credentials:'include',redirect:'follow'});
 assert.equal(captured.url,origin+'/api/enquiry-intake');assert.equal(captured.init.headers.get('x-preview-instance'),instanceId);assert.equal(captured.init.credentials,'omit');assert.equal(captured.init.redirect,'error');assert.equal(captured.init.cache,'no-store');assert.equal(captured.init.signal,abort.signal);assert.equal(result.url,'');assert.deepEqual(await result.json(),{id});
});
test('wrong origins, paths, methods and identity headers never reach fetch',async()=>{
 let calls=0;const transport=createEnquiryProxyTransport(options(async()=>{calls++;return response();}));
 for(const url of [origin+'/v1/enquiries?x=1',origin+'/v1/enquiries#x','https://other.example.invalid/v1/enquiries',origin+'/v2/staff/enquiries'])await assert.rejects(transport(url,init()));
 for(const name of ['Authorization','Cookie','X-Tenant-Id','X-Actor-Id','X-Preview-Instance'])await assert.rejects(transport(origin+'/v1/enquiries',{...init(),headers:{[name]:'untrusted'}}));
 await assert.rejects(transport(origin+'/v1/enquiries',{...init(),method:'GET'}));assert.equal(calls,0);
});
test('destination mismatch or redirected response stays uncertain without automatic replay',async()=>{
 for(const redirected of [false,true]){
  let calls=0;const client=new RealtorApiClient({baseUrl:origin,privacyNoticeVersion:'synthetic-v1',fetch:createEnquiryProxyTransport(options(async()=>{calls++;const r=response();if(redirected)Object.defineProperty(r,'redirected',{value:true});else Object.defineProperty(r,'url',{value:'https://other.example.invalid/'});return r;}))});
  const attempt=client.preparePublicEnquiry({name:'Fictional guest',email:'guest@example.invalid',message:'Synthetic enquiry',origin:'web',noticeVersion:'synthetic-v1',noticeAcknowledged:true},id);
  await assert.rejects(attempt.submit());assert.equal(attempt.state.status,'uncertain');assert.equal(calls,1);
 }
});
test('configuration permits HTTPS and explicit loopback only',()=>{
 for(const value of ['http://agency.example.invalid','https://agency.example.invalid/','https://user:pass@agency.example.invalid','https://agency.example.invalid/path','file:///tmp'])assert.throws(()=>createEnquiryProxyTransport({...options(async()=>response()),origin:value}));
 for(const value of [origin,'http://127.0.0.1:3001','http://localhost:3000','http://[::1]:3000'])assert.equal(typeof createEnquiryProxyTransport({...options(async()=>response()),origin:value}),'function');
 assert.throws(()=>createEnquiryProxyTransport({...options(async()=>response()),instanceId:'bad'}));
});
test('same-origin response supports explicit byte-identical retry after a lost reply',async()=>{
 const calls=[];const client=new RealtorApiClient({baseUrl:origin,privacyNoticeVersion:'synthetic-v1',fetch:createEnquiryProxyTransport(options(async(url,init)=>{calls.push({url,init});if(calls.length===1)throw Error('lost');return response();}))});
 const attempt=client.preparePublicEnquiry({name:'Fictional guest',email:'guest@example.invalid',message:'  Synthetic enquiry  ',origin:'web',noticeVersion:'synthetic-v1',noticeAcknowledged:true},id);
 await assert.rejects(attempt.submit());assert.deepEqual(await attempt.retryOriginal(),{id});assert.equal(calls.length,2);assert.equal(calls[0].init.body,calls[1].init.body);assert.equal(calls[0].init.headers.get('idempotency-key'),calls[1].init.headers.get('idempotency-key'));assert.equal(calls[1].init.headers.has('authorization'),false);
});
