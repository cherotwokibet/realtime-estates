import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalogueLoader,resolveCatalogueConfig,parseCatalogueFilters,CATALOGUE_UNAVAILABLE_MESSAGE} from '../dist/tests/lib/catalogue.js';

const id=number=>`00000000-0000-4000-8000-${String(number).padStart(12,'0')}`;
const property=(patch={})=>({id:id(100),slug:'synthetic-web-studio',revision:1,title:'Synthetic catalogue studio',description:'Synthetic web data-layer test; never live inventory.',purpose:'rent',propertyType:'studio',currency:'KES',amountMinor:2000001,rentPeriod:'month',bedrooms:0,privateBathrooms:1,sharedBathrooms:null,country:'KE',locality:'Synthetic locality',publicPrecision:'area',latitude:null,longitude:null,photos:[0,1,2,3].map(position=>({key:`synthetic/web-${position}.webp`,alt:`Synthetic metadata view ${position}`})),pricing:{declaration:'complete',charges:[{id:'setup',name:'Setup fee',amountStatus:'known',amountMinor:101,timing:'one_off',classification:'fee',mandatory:true}]},location:{county:'Synthetic County',town:'Synthetic Town',area:'Synthetic Area'},...patch});
const connectedEnvironment={WEB_CATALOGUE_MODE:'connected',API_ORIGIN:'https://catalogue.example.invalid',TENANT_SLUG:'realtime-estates',WEB_CATALOGUE_DATA:'synthetic'};
const json=payload=>new Response(JSON.stringify(payload),{headers:{'Content-Type':'application/json'}});
function connected(items=[property()],environment={},fetch){
  return createCatalogueLoader(resolveCatalogueConfig({...connectedEnvironment,...environment}),{fetch:fetch??(async()=>json({items,limit:100}))});
}
const ready=result=>{assert.notEqual(result.mode,'error');return result;};

test('default mode stays synthetic demo even with an API origin, with company-separated immutable fixtures',async()=>{
  let calls=0;
  const realtime=createCatalogueLoader(resolveCatalogueConfig({API_ORIGIN:'https://ignored.example.invalid'}),{fetch:async()=>{calls++;throw new Error('Demo must not connect');}});
  const result=ready(await realtime.list());
  assert.equal(result.mode,'demo');assert.equal(result.dataKind,'synthetic');assert.equal(result.items.length,4);
  assert.equal(result.limit,null);assert.equal(result.mayBeTruncated,false);assert.equal(calls,0);
  const sample=createCatalogueLoader(resolveCatalogueConfig({TENANT_SLUG:'sample-homes'}));
  const other=ready(await sample.list());
  assert.deepEqual(other.items.map(item=>item.id),['sample-property-1']);
  assert.equal(result.items.some(item=>item.id==='sample-property-1'),false);
  assert.equal((await sample.detail('demo-langata-1')).status,'not_found');
  const first=result.items[0];
  assert.equal(first.revision,null);assert.equal(first.pricing.disclosureDeclaration,'not_declared');
  assert.equal(first.pricing.mandatoryAmountsComplete,false);assert.equal(first.pricing.hasUnresolvedMandatoryAmounts,true);
  assert.equal(first.areaSqm,24);assert.equal(first.bathrooms,1);assert.equal(first.privateBathrooms,null);assert.equal(first.sharedBathrooms,null);
  assert.equal(first.amenitiesKnown,true);assert.deepEqual(first.photos,[]);
  for(const value of [result,result.items,first,first.location,first.amenities,first.pricing])assert.ok(Object.isFrozen(value));
});

test('malformed deployment configuration fails generically and never triggers transport or demo fallback',async()=>{
  const invalid=[{WEB_CATALOGUE_MODE:''},{WEB_CATALOGUE_MODE:'automatic'},{TENANT_SLUG:'forged-company'},{WEB_CATALOGUE_DATA:'live'},
    {WEB_CATALOGUE_MODE:'connected'},
    ...['http://public.example.invalid','https://user:private-secret@example.invalid','https://example.invalid/v2','https://example.invalid/?token=private-secret',' https://example.invalid'].map(API_ORIGIN=>({WEB_CATALOGUE_MODE:'connected',API_ORIGIN})),
  ];
  for(const environment of invalid){
    let calls=0;const resolution=resolveCatalogueConfig(environment);assert.equal(resolution.status,'error');
    const result=await createCatalogueLoader(resolution,{fetch:async()=>{calls++;throw new Error('Must not connect');}}).list();
    assert.equal(result.mode,'error');assert.equal(result.code,'CONFIGURATION');assert.equal(calls,0);
    assert.equal(result.message.includes('private-secret'),false);assert.equal('items' in result,false);
  }
});

test('loopback HTTP requires exact development-only opt-in',()=>{
  const base={WEB_CATALOGUE_MODE:'connected',API_ORIGIN:'http://127.0.0.1:4100'};
  for(const environment of [{...base},{...base,ALLOW_LOOPBACK_API:'false',NODE_ENV:'development'},{...base,ALLOW_LOOPBACK_API:'1',NODE_ENV:'development'},{...base,ALLOW_LOOPBACK_API:'true',NODE_ENV:'production'},{...base,ALLOW_LOOPBACK_API:'true'}])assert.equal(resolveCatalogueConfig(environment).status,'error');
  for(const NODE_ENV of ['development','test'])assert.equal(resolveCatalogueConfig({...base,ALLOW_LOOPBACK_API:'true',NODE_ENV}).status,'ready');
  assert.equal(resolveCatalogueConfig({...base,API_ORIGIN:'http://localhost.evil.invalid',ALLOW_LOOPBACK_API:'true',NODE_ENV:'development'}).status,'error');
  assert.equal(resolveCatalogueConfig({...connectedEnvironment,NODE_ENV:'production'}).status,'ready');
});

test('connected projection preserves exact v2 disclosure and location while undisclosed fields remain unknown',async()=>{
  let seen;
  const result=ready(await connected(undefined,{},async(url,init)=>{seen={url,init};return json({items:[property()],limit:100});}).list());
  assert.equal(result.mode,'connected');assert.equal(result.dataKind,'synthetic');assert.equal(result.sourceLabel,'API connected · Preview environment');
  const item=result.items[0];
  assert.equal(item.priceMinor,2000001);assert.equal(item.pricing.knownMandatory.initialSubtotal.minorUnits,2000102);
  assert.equal(item.pricing.mandatoryAmountsComplete,true);assert.equal(item.rentalPeriod,'month');assert.equal(item.bedrooms,0);
  assert.deepEqual(item.location,{county:'Synthetic County',town:'Synthetic Town',area:'Synthetic Area'});
  assert.equal(item.areaSqm,null);assert.deepEqual(item.amenities,[]);assert.equal(item.amenitiesKnown,false);
  assert.equal(item.bathrooms,null);assert.equal(item.privateBathrooms,1);assert.equal(item.sharedBathrooms,null);
  assert.equal(item.photos[0].key,'synthetic/web-0.webp');assert.equal(item.photos.some(photo=>photo.key.startsWith('/demo/')),false);
  assert.equal(seen.url,'https://catalogue.example.invalid/v2/properties?limit=100');
  assert.equal(seen.init.cache,'no-store');assert.equal(seen.init.credentials,'omit');assert.equal(seen.init.redirect,'error');assert.equal(seen.init.headers.Authorization,undefined);
  for(const value of [result,result.items,item,item.location,item.amenities,item.photos,item.photos[0],item.pricing])assert.ok(Object.isFrozen(value));
});

test('connected maximum-price filters compare exact cents inclusively and preserve existing invalid-input messages',async()=>{
  const loader=connected();
  assert.equal(ready(await loader.list({max:'20000.01',period:'month'})).items.length,1);
  assert.equal(ready(await loader.list({max:'20000.00',period:'month'})).items.length,0);
  for(const [max,error] of [['0','Enter a positive maximum price in KES.'],['-1','Enter a valid KES amount with at most two decimal places.'],['20000.001','Enter a valid KES amount with at most two decimal places.']]){
    const result=ready(await loader.list({max,period:'month'}));assert.equal(result.filters.error,error);assert.equal(result.items.length,0);
  }
});

test('rental price filters require an explicit period and never convert mixed rent periods or hide sales',async()=>{
  const periods=['day','week','month','year'];
  const amounts=[100001,800001,2000001,20000001];
  const properties=periods.map((rentPeriod,index)=>property({id:id(100+index),slug:`synthetic-${rentPeriod}`,rentPeriod,amountMinor:amounts[index]}));
  properties.push(property({id:id(104),slug:'synthetic-sale',purpose:'sale',rentPeriod:null}));
  const loader=connected(properties);
  const all=ready(await loader.list());assert.equal(all.filters.period,'');assert.equal(all.items.length,5);
  assert.deepEqual(ready(await loader.list({period:'month'})).items.map(item=>item.id),[id(102),id(104)]);
  assert.deepEqual(ready(await loader.list({purpose:'rent',period:'week'})).items.map(item=>item.id),[id(101)]);
  for(const purpose of ['', 'rent']){
    const result=ready(await loader.list({purpose,max:'20000.01'}));
    assert.equal(result.filters.error,'Choose a rental period when filtering rent by price.');assert.equal(result.items.length,0);
  }
  assert.deepEqual(ready(await loader.list({purpose:'rent',period:'month',max:'20000.01'})).items.map(item=>item.id),[id(102)]);
  assert.equal(ready(await loader.list({purpose:'rent',period:'year',max:'20000.01'})).items.length,0);
  assert.deepEqual(ready(await loader.list({purpose:'sale',max:'20000.01'})).items.map(item=>item.id),[id(104)]);
  assert.deepEqual(ready(await loader.list({purpose:'sale',period:'day',max:'20000.01'})).items.map(item=>item.id),[id(104)]);
});

test('rental period input validates malformed, repeated and unknown choices while keeping price validation specific',async()=>{
  const loader=connected();
  for(const period of [['day','month'],[],42]){
    const result=ready(await loader.list({period}));assert.equal(result.filters.error,'Use one value for each search filter.');assert.equal(result.items.length,0);
  }
  for(const period of ['annually','MONTH']){
    const result=ready(await loader.list({period}));assert.equal(result.filters.error,'Choose a supported rental period.');assert.equal(result.items.length,0);
  }
  assert.equal(parseCatalogueFilters({period:' month '}).period,'month');
  assert.equal(parseCatalogueFilters({period:'',max:'not-money'}).error,'Enter a valid KES amount with at most two decimal places.');
  assert.equal(parseCatalogueFilters({purpose:'sale',max:'20000.01'}).error,null);
});

test('local location filtering uses known county, town, area and locality without converting nulls into places',async()=>{
  const loader=connected();
  for(const location of ['county','TOWN','Synthetic Area','locality'])assert.equal(ready(await loader.list({location})).items.length,1);
  const unknown=connected([property({location:{county:null,town:null,area:null},locality:'Somewhere supplied'})]);
  assert.equal(ready(await unknown.list({location:'null'})).items.length,0);
  assert.equal(ready(await unknown.list({location:'somewhere'})).items.length,1);
});

test('all nine API property types can be filtered while malformed/repeated filters retain shared validation',async()=>{
  const types=['apartment','bedsitter','studio','maisonette','townhouse','bungalow','villa','land','commercial'];
  const properties=types.map((propertyType,index)=>property({id:id(100+index),slug:`synthetic-${propertyType}`,propertyType,bedrooms:['studio','bedsitter'].includes(propertyType)?0:['land','commercial'].includes(propertyType)?null:2}));
  const loader=connected(properties);
  for(const type of types){const result=ready(await loader.list({type}));assert.equal(result.filters.error,null);assert.deepEqual(result.items.map(item=>item.type),[type]);}
  for(const [query,error] of [[{purpose:'lease'},'Choose rent or buy.'],[{type:'castle'},'Choose a supported property type.'],[{location:['one','two']},'Use one value for each search filter.'],[{type:['studio','villa']},'Use one value for each search filter.']]){
    const result=ready(await loader.list(query));assert.equal(result.filters.error,error);assert.equal(result.items.length,0);
  }
  assert.equal(parseCatalogueFilters({type:' villa ',purpose:'rent'}).type,'villa');
});

test('connected upstream failures, malformed/private responses and precision violations never become demo or empty success',async()=>{
  const transports=[
    async()=>{throw new Error('PRIVATE synthetic transport detail');},
    async()=>new Response('<html>PRIVATE failure</html>',{status:500,headers:{'Content-Type':'text/html'}}),
    async()=>json({items:[property({privateAddress:'PRIVATE synthetic address'})],limit:100}),
    async()=>new Response(JSON.stringify({items:[property()],limit:100}).replace('"amountMinor":2000001','"amountMinor":2000001.00000000001'),{headers:{'Content-Type':'application/json'}}),
  ];
  for(const fetch of transports){const result=await connected(undefined,{},fetch).list();assert.equal(result.mode,'error');assert.equal(result.sourceMode,'connected');assert.equal(result.message,CATALOGUE_UNAVAILABLE_MESSAGE);assert.equal('items' in result,false);assert.equal(result.message.includes('PRIVATE'),false);}
});

test('an empty connected catalogue is an explicit successful empty result',async()=>{
  const loader=connected([]);const result=ready(await loader.list());
  assert.equal(result.mode,'connected');assert.equal(result.sourceCount,0);assert.equal(result.items.length,0);assert.equal(result.mayBeTruncated,false);
  assert.equal((await loader.detail(id(999))).status,'not_found');
});

test('a full bounded catalogue warns about truncation and a missing detail remains incomplete rather than a false 404',async()=>{
  const items=Array.from({length:100},(_,index)=>property({id:id(index+100),slug:`synthetic-bounded-${index}`}));
  const loader=connected(items);const result=ready(await loader.list({max:'0.01',period:'month'}));
  assert.equal(result.items.length,0);assert.equal(result.sourceCount,100);assert.equal(result.limit,100);assert.equal(result.mayBeTruncated,true);
  const found=await loader.detail(id(199));assert.equal(found.status,'found');assert.equal(found.property.id,id(199));
  const missing=await loader.detail(id(999));assert.equal(missing.status,'incomplete');assert.equal(missing.limit,100);
  const complete=connected(items.slice(0,99));assert.equal((await complete.detail(id(999))).status,'not_found');
});

test('every load makes a fresh no-store read and browser query values cannot select origin or company',async()=>{
  const calls=[];
  const loader=connected(undefined,{},async(url,init)=>{calls.push({url,init});return json({items:[property({amountMinor:2000000+calls.length})],limit:100});});
  const first=ready(await loader.list({API_ORIGIN:'https://forged.example.invalid',TENANT_SLUG:'sample-homes'}));
  const second=ready(await loader.list());
  assert.equal(first.items[0].priceMinor,2000001);assert.equal(second.items[0].priceMinor,2000002);assert.equal(calls.length,2);
  for(const call of calls){assert.equal(call.url,'https://catalogue.example.invalid/v2/properties?limit=100');assert.equal(call.init.cache,'no-store');}
});

test('connected source alone never declares data real or live',async()=>{
  const result=ready(await connected(undefined,{WEB_CATALOGUE_DATA:undefined}).list());
  assert.equal(result.dataKind,'unspecified');assert.equal(result.sourceLabel,'API connected · Preview environment');
  assert.equal('isLive' in result,false);
});
