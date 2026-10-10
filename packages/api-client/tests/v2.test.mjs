import test from 'node:test';
import assert from 'node:assert/strict';
import {RealtorApiClient,ApiClientError} from '../dist/index.js';

const ID='00000000-0000-4000-8000-000000000100';
const base={id:ID,slug:'synthetic-v2-studio',revision:1,title:'Synthetic v2 studio',description:'Synthetic public client test, never live inventory.',purpose:'rent',propertyType:'studio',currency:'KES',amountMinor:1800001,rentPeriod:'month',bedrooms:0,privateBathrooms:1,sharedBathrooms:null,country:'KE',locality:'Synthetic area',publicPrecision:'area',latitude:null,longitude:null,photos:[0,1,2,3].map(position=>({key:`synthetic/v2-${position}.webp`,alt:`Synthetic view ${position}`}))};
const location={county:'Synthetic county',town:'Synthetic town',area:'Synthetic area'};
const charge=(patch={})=>({id:'service',name:'Service charge',amountStatus:'known',amountMinor:20001,timing:'per_rental_period',classification:'fee',mandatory:true,...patch});
const property=(pricing={declaration:'not_declared',charges:[]},patch={})=>({...base,pricing,location,...patch});
const json=(payload,status=200)=>new Response(JSON.stringify(payload),{status,headers:{'Content-Type':'application/json'}});
const client=fetch=>new RealtorApiClient({baseUrl:'https://api.example.invalid',privacyNoticeVersion:'synthetic-v1',fetch});
const invalidResponse=operation=>assert.rejects(operation,error=>error instanceof ApiClientError&&error.kind==='INVALID_RESPONSE');
const requestProperty=input=>client(async()=>json({items:[input],limit:50})).listPropertiesV2();

test('v2 derives exact known mandatory subtotals and separates optional fees and refundable deposits',async()=>{
  const pricing={declaration:'complete',charges:[charge(),charge({id:'setup',name:'Setup fee',amountMinor:50001,timing:'one_off'}),charge({id:'deposit',name:'Refundable deposit',amountMinor:1800001,timing:'one_off',classification:'refundable_deposit'}),charge({id:'parking',name:'Optional parking',amountMinor:30001,mandatory:false})]};
  let seen;
  const api=client(async(url,init)=>{seen={url,init};return json({items:[property(pricing)],limit:7});});
  const page=await api.listPropertiesV2({limit:7});
  assert.equal(seen.url,'https://api.example.invalid/v2/properties?limit=7');
  assert.equal(seen.init.credentials,'omit');assert.equal(seen.init.redirect,'error');assert.equal(seen.init.cache,'no-store');
  const result=page.items[0];
  assert.equal(result.pricing.base.minorUnits,1800001);
  assert.equal(result.pricing.knownMandatory.recurringFees.minorUnits,20001);
  assert.equal(result.pricing.knownMandatory.recurringSubtotal.minorUnits,1820002);
  assert.equal(result.pricing.knownMandatory.oneOffFees.minorUnits,50001);
  assert.equal(result.pricing.knownMandatory.refundableDeposit.minorUnits,1800001);
  assert.equal(result.pricing.knownMandatory.initialSubtotal.minorUnits,3670004);
  assert.equal(result.pricing.optionalCosts.knownInitialExtras.minorUnits,30001);
  assert.equal(result.pricing.mandatoryAmountsComplete,true);
  assert.deepEqual(result.location,location);
  for(const value of [page,page.items,result,result.pricing,result.pricing.charges,result.pricing.charges[0],result.pricing.charges[0].amount,result.pricing.knownMandatory,result.location])assert.ok(Object.isFrozen(value));
});

test('unknown coverage and mandatory quotes remain unresolved while optional quotes do not contaminate mandatory totals',async()=>{
  for(const declaration of ['not_declared','incomplete']){
    const result=(await requestProperty(property({declaration,charges:[]}))).items[0].pricing;
    assert.equal(result.disclosureDeclaration,declaration);assert.equal(result.mandatoryAmountsComplete,false);
    assert.equal(result.hasUnresolvedMandatoryAmounts,true);assert.equal(result.knownMandatory.initialSubtotal.minorUnits,1800001);
  }
  const required=(await requestProperty(property({declaration:'complete',charges:[charge({amountStatus:'quote_required',amountMinor:null})]}))).items[0].pricing;
  assert.equal(required.mandatoryAmountsComplete,false);assert.equal(required.hasUnresolvedMandatoryAmounts,true);
  assert.deepEqual(required.unresolvedMandatoryChargeIds,['service']);assert.equal(required.knownMandatory.initialSubtotal.minorUnits,1800001);
  const optional=(await requestProperty(property({declaration:'complete',charges:[charge({amountStatus:'quote_required',amountMinor:null,mandatory:false})]}))).items[0].pricing;
  assert.equal(optional.mandatoryAmountsComplete,true);assert.equal(optional.hasUnresolvedMandatoryAmounts,false);
  assert.deepEqual(optional.optionalCosts.quoteRequiredChargeIds,['service']);assert.equal(optional.optionalCosts.knownInitialExtras.minorUnits,0);
});

test('sale disclosure has no rental recurring subtotal and nullable public components stay explicit',async()=>{
  const result=(await requestProperty(property({declaration:'complete',charges:[charge({timing:'one_off',amountMinor:1})]},{purpose:'sale',rentPeriod:null,location:{county:null,town:null,area:null}}))).items[0];
  assert.equal(result.pricing.rentalPeriod,null);assert.equal(result.pricing.knownMandatory.recurringSubtotal,null);
  assert.equal(result.pricing.knownMandatory.initialSubtotal.minorUnits,1800002);
  assert.deepEqual(result.location,{county:null,town:null,area:null});
  await invalidResponse(()=>requestProperty(property({declaration:'complete',charges:[charge()]},{purpose:'sale',rentPeriod:null})));
});

test('v2 rejects unknown fields and supplied derived totals at every extension boundary',async()=>{
  for(const input of [
    {...property(),tenantId:ID},
    property({declaration:'complete',charges:[],knownMandatory:{initialSubtotal:0}}),
    property({declaration:'complete',charges:[],privateNote:'Synthetic private note'}),
    property({declaration:'complete',charges:[charge({agentId:ID})]}),
    property(undefined,{location:{...location,privateAddress:'Synthetic private address'}}),
    property(undefined,{location:{...location,latitude:-1.3}}),
  ])await invalidResponse(()=>requestProperty(input));
  await invalidResponse(()=>client(async()=>json({items:[property()],limit:50,tenantId:ID})).listPropertiesV2());
});

test('v2 pricing wire validation rejects unsafe amounts, contradictory states, duplicate IDs and unbounded text/arrays',async()=>{
  const invalidPricing=[null,[],{}, {declaration:'invented',charges:[]},{declaration:'complete'},
    {declaration:'complete',charges:Array.from({length:33},(_,index)=>charge({id:`fee-${index}`}))},
    {declaration:'complete',charges:[charge(),charge()]},
    ...[{id:'x'.repeat(65)},{name:'x'.repeat(161)},{id:' '},{name:'bad\u0000name'},
      {amountMinor:0},{amountMinor:-1},{amountMinor:1.5},{amountMinor:'1'},{amountMinor:Number.MAX_SAFE_INTEGER+1},
      {amountMinor:null},{amountStatus:'quote_required',amountMinor:1},{amountStatus:'unknown'},{mandatory:'true'},
      {timing:'yearly'},{classification:'tax'},{classification:'refundable_deposit',timing:'per_rental_period'}
    ].map(patch=>({declaration:'complete',charges:[charge(patch)]})),
  ];
  for(const pricing of invalidPricing)await invalidResponse(()=>requestProperty(property(pricing)));
});

test('v2 public location requires exactly three bounded nullable strings',async()=>{
  for(const badLocation of [null,[],{}, {county:null,town:null}, {...location,county:4}, {...location,town:''}, {...location,area:' '}, {...location,area:'x'.repeat(161)}, {...location,county:'bad\u0000name'}, {...location,phone:'0700000000'}]){
    await invalidResponse(()=>requestProperty(property(undefined,{location:badLocation})));
  }
});

test('v1 remains exact and v2 does not silently accept an old or malformed base response',async()=>{
  const api=client(async url=>json({items:[url.includes('/v2/')?property():base],limit:50}));
  assert.deepEqual((await api.listProperties()).items[0],base);
  assert.equal('pricing' in (await api.listProperties()).items[0],false);
  assert.equal((await api.listPropertiesV2()).items[0].pricing.disclosureDeclaration,'not_declared');
  await invalidResponse(()=>client(async()=>json({items:[property()],limit:50})).listProperties());
  await invalidResponse(()=>requestProperty(base));
  await invalidResponse(()=>requestProperty(property(undefined,{amountMinor:0})));
  await invalidResponse(()=>requestProperty(property(undefined,{publicPrecision:'area',latitude:-1.3,longitude:36.7})));
  await invalidResponse(()=>client(async()=>json({items:[property()],limit:49})).listPropertiesV2());
});

test('v2 accepts SQL-valid astral display-text maxima while v1 retains its UTF-16 bounds for every item',async()=>{
  const astralMaximum=maximum=>'a'.repeat(maximum-1)+'🏠';
  const display={title:astralMaximum(160),description:astralMaximum(10000),locality:astralMaximum(160),photos:base.photos.map(photo=>({...photo,alt:astralMaximum(300)}))};
  const result=(await requestProperty(property(undefined,display))).items[0];
  for(const field of ['title','description','locality'])assert.equal(result[field],display[field]);
  assert.equal(result.photos[0].alt,display.photos[0].alt);
  for(const patch of [{title:display.title},{description:display.description},{locality:display.locality},{photos:display.photos}]){
    // Keep the invalid property second to guard against passing Array.map's index as a parser option.
    await invalidResponse(()=>client(async()=>json({items:[base,{...base,...patch}],limit:50})).listProperties());
  }
});

test('v2 rejects max-plus-one code points and unpaired surrogates independently for every base display field',async()=>{
  const astralOver=maximum=>'a'.repeat(maximum)+'🏠';
  for(const patch of [{title:astralOver(160)},{description:astralOver(10000)},{locality:astralOver(160)},{photos:[{...base.photos[0],alt:astralOver(300)},...base.photos.slice(1)]},
    {title:'Synthetic \ud800 title'},{description:'Synthetic \udfff description'},{locality:'Synthetic \ud800 locality'},{photos:[{...base.photos[0],alt:'Synthetic \udfff alternative text'},...base.photos.slice(1)]}]){
    await invalidResponse(()=>requestProperty(property(undefined,patch)));
  }
});

test('v2 validates raw money integer literals before rounding, including escaped keys, while v1 parsing stays unchanged',async()=>{
  const rawResponse=source=>new Response(source,{headers:{'Content-Type':'application/json'}});
  const raw=JSON.stringify({items:[property({declaration:'complete',charges:[charge({amountMinor:Number.MAX_SAFE_INTEGER,timing:'one_off',mandatory:false})]})],limit:50});
  const token='"amountMinor":9007199254740991';
  for(const replacement of ['"amountMinor":9007199254740991.1','"amountMinor":9007199254740991.0','"amountMinor":9.007199254740991e15','"amount\\u004dinor":9007199254740991.1','"\\u0061mountMinor":9.007199254740991e15']){
    const malformed=raw.replace(token,replacement);assert.notEqual(malformed,raw);
    await assert.rejects(()=>client(async()=>rawResponse(malformed)).listPropertiesV2(),error=>{
      assert.ok(error instanceof ApiClientError);assert.equal(error.kind,'INVALID_RESPONSE');
      assert.equal(error.message.includes('9007199254740991'),false);return true;
    });
  }
  for(const valid of [raw,raw.replace(token,'"amount\\u004dinor":9007199254740991')]){
    const result=(await client(async()=>rawResponse(valid)).listPropertiesV2()).items[0];
    assert.equal(result.pricing.optionalCosts.knownInitialExtras.minorUnits,Number.MAX_SAFE_INTEGER);
    assert.equal(result.pricing.mandatoryAmountsComplete,true);
  }
  const legacy=JSON.stringify({items:[base],limit:50}).replace('"amountMinor":1800001','"amountMinor":1800001e0');
  assert.equal((await client(async()=>rawResponse(legacy)).listProperties()).items[0].amountMinor,1800001);
});

test('v2 validates options before transport and uses only explicit per-call credentials',async()=>{
  const seen=[];const api=client(async(_,init)=>{seen.push(init);return json({items:[],limit:50});});
  await api.listPropertiesV2({bearerToken:'synthetic-token'});await api.listPropertiesV2();
  assert.equal(seen[0].headers.Authorization,'Bearer synthetic-token');assert.equal(seen[1].headers.Authorization,undefined);
  for(const options of [{limit:0},{limit:101},{limit:1.5},{tenantId:ID},{actorId:ID},{bearerToken:'bad\r\ntoken'}]){
    await assert.rejects(()=>api.listPropertiesV2(options),error=>error.kind==='VALIDATION');
  }
  assert.equal(seen.length,2);
});

test('v2 keeps no-retry network, redirect and whole-request timeout behavior',async()=>{
  let calls=0;
  await assert.rejects(()=>client(async()=>{calls++;throw new Error('Synthetic unreachable origin');}).listPropertiesV2(),error=>error.kind==='NETWORK');
  assert.equal(calls,1);
  await assert.rejects(()=>client(async()=>new Response(null,{status:302,headers:{Location:'https://untrusted.invalid'}})).listPropertiesV2(),error=>error.kind==='REDIRECT');
  await assert.rejects(()=>client(async()=>new Promise(()=>{})).listPropertiesV2({timeoutMs:5}),error=>error.kind==='TIMEOUT'&&!error.submissionUncertain);
  const controller=new AbortController();controller.abort();
  await assert.rejects(()=>client(async()=>{throw new Error('Must not run');}).listPropertiesV2({signal:controller.signal}),error=>error.kind==='CANCELLED');
});
