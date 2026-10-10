import assert from 'node:assert/strict';
import {request} from 'node:http';
import test from 'node:test';
import {RealtorApiClient} from '../../../packages/api-client/dist/index.js';
import {PREVIEW_FIXTURES,startSyntheticPreview} from './synthetic-preview.mjs';

const client=preview=>new RealtorApiClient({baseUrl:preview.origin,privacyNoticeVersion:'synthetic-preview-notice-v1',allowLoopbackHttp:true});
const hostProbe=(origin,absolute=false)=>new Promise((resolve,reject)=>{
  const outgoing=request(origin+'/v2/properties',{...(absolute?{path:origin+'/v2/properties'}:{}),headers:{Host:'untrusted.example.invalid'}},incoming=>{
    incoming.resume();incoming.once('end',()=>resolve(incoming.statusCode));
  });outgoing.once('error',reject);outgoing.end();
});

test('synthetic preview rejects production and invalid startup configuration before creating a listener',async()=>{
  for(const options of [{tenantSlug:'constructor'},{tenantSlug:'other-company'},{scenario:'tenant-selected-by-request'},{port:-1},{port:65536},{port:1.5}])await assert.rejects(()=>startSyntheticPreview(options));
  const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
  try{await assert.rejects(()=>startSyntheticPreview({port:0}),/refuses NODE_ENV=production/);}
  finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});

test('normal Realtime preview uses real HTTP, v2 client/service and restricted SQL with exact synthetic disclosures',async()=>{
  const preview=await startSyntheticPreview({port:0});
  try{
    assert.match(preview.origin,/^http:\/\/127\.0\.0\.1:\d+$/);
    const api=client(preview),page=await api.listPropertiesV2({limit:100});
    assert.deepEqual(page.items.map(row=>row.id).sort(),[PREVIEW_FIXTURES.rentId,PREVIEW_FIXTURES.saleId].sort());
    const rent=page.items.find(row=>row.id===PREVIEW_FIXTURES.rentId),sale=page.items.find(row=>row.id===PREVIEW_FIXTURES.saleId);
    assert.equal(rent.amountMinor,2000000);assert.equal(rent.rentPeriod,'month');
    assert.equal(rent.pricing.knownMandatory.recurringSubtotal.minorUnits,2100000);
    assert.equal(rent.pricing.knownMandatory.refundableDeposit.minorUnits,2000000);
    assert.equal(rent.pricing.knownMandatory.oneOffFees.minorUnits,50000);
    assert.equal(rent.pricing.knownMandatory.initialSubtotal.minorUnits,4150000);
    assert.equal(rent.pricing.mandatoryAmountsComplete,true);
    assert.equal(rent.pricing.optionalCosts.knownInitialExtras.minorUnits,30000);
    assert.deepEqual(rent.pricing.optionalCosts.quoteRequiredChargeIds,['cleaning-quote']);
    assert.equal(sale.amountMinor,99999900);assert.equal(sale.rentPeriod,null);
    assert.equal(sale.pricing.knownMandatory.initialSubtotal.minorUnits,100149900);
    assert.equal(sale.pricing.mandatoryAmountsComplete,false);
    assert.deepEqual(sale.pricing.unresolvedMandatoryChargeIds,['third-party-quote']);
    assert.deepEqual(sale.location,{county:null,town:null,area:null});
    assert.equal(page.items.some(row=>row.id===PREVIEW_FIXTURES.otherCompanyListingId),false);
    const response=await fetch(preview.origin+'/v2/properties');assert.equal(response.headers.get('x-synthetic-preview'),'true');
    const wire=await response.json();assert.equal(JSON.stringify(wire).includes('PRIVATE SYNTHETIC FIXTURE ADDRESS'),false);
    for(const row of wire.items){assert.equal('tenantId' in row,false);assert.equal('privateAddress' in row,false);assert.equal(row.latitude,null);assert.equal(row.photos.length,4);}
    const health=await (await fetch(preview.origin+'/health')).json();assert.equal(health.synthetic,true);assert.equal(health.authentication,false);assert.equal(health.persistentStorage,false);assert.equal(health.productionReady,false);assert.equal(health.media,'metadata-only');
    assert.equal((await api.listProperties()).items.length,2,'Actual v1 projection remains compatible.');
    const concurrent=await Promise.all(Array.from({length:4},()=>api.listPropertiesV2()));assert.ok(concurrent.every(page=>page.items.length===2),'Complete transaction checkouts are serialized.');
    assert.equal(await hostProbe(preview.origin),404);
    assert.equal(await hostProbe(preview.origin,true),404,'Absolute-form targets cannot bypass the Host guard.');
    assert.equal((await fetch(preview.origin+'/v2/properties?tenantId=other')).status,400);
    assert.equal((await fetch(preview.origin+'/v2/properties?scenario=error')).status,400);
    assert.equal((await fetch(preview.origin+'/v2/properties?limit=1&limit=100')).status,400);
    assert.equal((await fetch(preview.origin+'/v2/properties',{headers:{Authorization:'Bearer synthetic-guard-test'}})).status,400);
    assert.equal((await fetch(preview.origin+'/v1/enquiries',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,405);
    assert.equal((await fetch(preview.origin+'/'+wire.items[0].photos[0].key)).status,404,'There are no image bytes behind fixture metadata.');
  }finally{await preview.close();}
});

test('Sample Homes startup selects only its own row and preserves exact cents with unknown charge coverage',async()=>{
  const preview=await startSyntheticPreview({tenantSlug:'sample-homes',port:0});
  try{
    const page=await client(preview).listPropertiesV2();assert.deepEqual(page.items.map(row=>row.id),[PREVIEW_FIXTURES.otherCompanyListingId]);
    assert.equal(page.items[0].amountMinor,3300001);assert.equal(page.items[0].pricing.disclosureDeclaration,'not_declared');assert.equal(page.items[0].pricing.mandatoryAmountsComplete,false);
    assert.deepEqual(page.items[0].location,{county:null,town:'Synthetic Sample Town',area:null});
  }finally{await preview.close();}
});

test('empty startup pauses configured synthetic stock through SQL instead of leaking other-company rows or falling back',async()=>{
  const preview=await startSyntheticPreview({scenario:'empty',port:0});
  try{assert.deepEqual(await client(preview).listPropertiesV2(),{items:[],limit:50});}
  finally{await preview.close();}
});

test('error startup returns the actual service safe unavailable error, never a successful empty/fallback catalogue',async()=>{
  const preview=await startSyntheticPreview({scenario:'error',port:0});
  try{
    await assert.rejects(()=>client(preview).listPropertiesV2(),error=>error.kind==='HTTP'&&error.status===503&&error.serverCode==='SERVICE_UNAVAILABLE');
    const health=await (await fetch(preview.origin+'/health')).json();assert.equal(health.scenario,'error');assert.equal(health.synthetic,true);
  }finally{await preview.close();}
});
