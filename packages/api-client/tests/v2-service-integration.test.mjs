import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createApiService,createLocalEnquiryLimiter} from '../../../apps/api/dist/service.js';
import {PostgresTransactionDatabase} from '../../../apps/api/dist/database.js';
import {RealtorApiClient} from '../dist/index.js';

const id=number=>`00000000-0000-4000-8000-${String(number).padStart(12,'0')}`;
const TENANT=id(1),OTHER=id(2),ADMIN=id(10),OTHERADMIN=id(20),LEGACY=id(90),LISTING=id(100),OTHERLISTING=id(200);
const baseContent={title:'Synthetic v2 integration studio',description:'Synthetic migration-backed test, never live inventory.',purpose:'rent',propertyType:'studio',currency:'KES',amountMinor:2000001,rentPeriod:'month',bedrooms:0,privateBathrooms:1,sharedBathrooms:null,country:'KE',locality:'Synthetic public area',publicPrecision:'area',latitude:-1.3,longitude:36.7,privateAddress:'PRIVATE SYNTHETIC ADDRESS'};
const charge=(patch={})=>({id:'service',name:'Service fee',amountStatus:'known',amountMinor:10001,timing:'per_rental_period',classification:'fee',mandatory:true,...patch});
const pricing={declaration:'complete',charges:[charge(),charge({id:'deposit',name:'Refundable deposit',amountMinor:2000001,timing:'one_off',classification:'refundable_deposit'}),charge({id:'legal',name:'Legal fee quote',amountStatus:'quote_required',amountMinor:null,timing:'one_off'}),charge({id:'parking',name:'Optional parking',amountMinor:30001,mandatory:false})]};
const location={county:'Synthetic County A',town:'Synthetic Town A',area:'Synthetic Area A'};
const content={...baseContent,pricing,location};

async function bootstrapAs(db,tenant,actor,operation){
  await db.exec('BEGIN; SET LOCAL ROLE api_runtime;');
  try{
    await db.query(`SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)`,[tenant,actor]);
    const result=await operation(db);await db.exec('COMMIT');return result;
  }catch(error){await db.exec('ROLLBACK');throw error;}
}
async function syntheticMedia(db,tenant,listing,revision){
  // Trusted accepted metadata only: this does not test uploaded bytes or a media processor.
  for(let position=0;position<4;position++)await db.query(`INSERT INTO app_private.revision_media(tenant_id,listing_id,revision_no,id,public_object_key,content_type,bytes,width,height,sha256,alt_text,position,accepted)
    VALUES($1,$2,$3,$4,$5,'image/webp',100,100,100,$6,'Synthetic accepted concept view',$7,true)`,[tenant,listing,revision,id(Number(listing.slice(-3))*100+revision*10+position),`synthetic/v2/${listing}-${revision}-${position}.webp`,'a'.repeat(64),position]);
}
async function seedPublished(db,tenant,admin,listing,listingContent,v2){
  await bootstrapAs(db,tenant,admin,async query=>{
    await query.query('SELECT app_api.create_listing($1,$2)',[listing,`synthetic-v2-${listing.slice(-3)}`]);
    await query.query(`SELECT app_api.${v2?'save_draft_v2':'save_draft'}($1,1,0,$2::jsonb)`,[listing,JSON.stringify(listingContent)]);
    await query.query(`SELECT app_api.confirm_availability($1,1,'available')`,[listing]);
  });
  await syntheticMedia(db,tenant,listing,1);
  await bootstrapAs(db,tenant,admin,async query=>{
    await query.query('SELECT app_api.submit_revision($1,1,2)',[listing]);
    await query.query('SELECT app_api.decide_revision($1,1,3,true)',[listing]);
  });
}

test('v2 client integrates with actual migrations, API service and restricted tenant transactions',async t=>{
  const db=new PGlite();
  try{
    await db.exec(await readFile(new URL('../../../database/migrations/0001_foundation.sql',import.meta.url),'utf8'));
    await db.query(`INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'v2-client-a','Synthetic V2 A'),($2,'v2-client-b','Synthetic V2 B')`,[TENANT,OTHER]);
    for(const [tenant,admin] of [[TENANT,ADMIN],[OTHER,OTHERADMIN]])await db.query(`INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')`,[tenant,admin]);
    // An already-published v1 row must remain available after applying the additive migration.
    await seedPublished(db,TENANT,ADMIN,LEGACY,{...baseContent,title:'Synthetic legacy studio'},false);
    await db.exec(await readFile(new URL('../../../database/migrations/0002_listing_disclosure.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../../database/migrations/0003_registered_media_jobs.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../../database/migrations/0004_media_processing.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../../database/migrations/0005_media_upload_context.sql',import.meta.url),'utf8'));
    await seedPublished(db,TENANT,ADMIN,LISTING,content,true);
    await seedPublished(db,OTHER,OTHERADMIN,OTHERLISTING,{...content,title:'Synthetic other-company studio',amountMinor:9900001,pricing:{declaration:'complete',charges:[]},location:{county:'Synthetic County B',town:null,area:null}},true);
    // Prepare accepted revision-2 metadata as a trusted fixture while still the bootstrap owner.
    // The runtime below edits/submits/rejects it exclusively through restricted RPCs.
    await bootstrapAs(db,TENANT,ADMIN,query=>query.query('SELECT app_api.save_draft_v2($1,2,0,$2::jsonb)',[LISTING,JSON.stringify({...content,title:'Synthetic initial replacement draft'})]));
    await syntheticMedia(db,TENANT,LISTING,2);
    await db.exec('CREATE ROLE api_client_v2_test_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; GRANT api_runtime TO api_client_v2_test_login; SET SESSION AUTHORIZATION api_client_v2_test_login;');
    // Serialize the single PGlite connection rather than interleave transaction contexts.
    let tail=Promise.resolve();
    const pool={async connect(){let unlock;const next=new Promise(resolve=>{unlock=resolve;});const previous=tail;tail=next;await previous;return {query:(sql,args)=>db.query(sql,args?[...args]:[]),release(){unlock();}};}};
    const database=new PostgresTransactionDatabase(pool);await database.checkConnection();
    const makeService=tenantId=>createApiService({database,tenantId,privacyNoticeVersion:'synthetic-v1',verifyAuthorization:async()=>{throw new Error('Guest-only synthetic client test; no provider verification.');},limiter:createLocalEnquiryLimiter({limit:100})});
    const service=makeService(TENANT),otherService=makeService(OTHER);
    let lastWire;
    const api=new RealtorApiClient({baseUrl:'https://v2-a.example.invalid',privacyNoticeVersion:'synthetic-v1',fetch:async(input,init)=>{
      const response=await service(new Request(input,init));lastWire=await response.clone().json();return response;
    }});
    const otherApi=new RealtorApiClient({baseUrl:'https://v2-b.example.invalid',privacyNoticeVersion:'synthetic-v1',fetch:(input,init)=>otherService(new Request(input,init))});
    const transaction=(operation,tenantId=TENANT,actorId=ADMIN)=>database.transaction({tenantId,actorId,correlationId:id(500)},operation);
    const published=async()=>{const result=(await api.listPropertiesV2()).items.find(row=>row.id===LISTING);assert.ok(result);return result;};
    let initial;

    await t.test('v2 public projection preserves exact disclosure, omits private data and isolates two companies',async()=>{
      initial=await published();
      assert.equal(initial.amountMinor,2000001);assert.equal(initial.pricing.knownMandatory.recurringSubtotal.minorUnits,2010002);
      assert.equal(initial.pricing.knownMandatory.refundableDeposit.minorUnits,2000001);assert.equal(initial.pricing.knownMandatory.initialSubtotal.minorUnits,4010003);
      assert.equal(initial.pricing.optionalCosts.knownInitialExtras.minorUnits,30001);
      assert.equal(initial.pricing.disclosureDeclaration,'complete');assert.equal(initial.pricing.mandatoryAmountsComplete,false);
      assert.deepEqual(initial.pricing.unresolvedMandatoryChargeIds,['legal']);assert.deepEqual(initial.location,location);
      assert.equal(initial.latitude,null);assert.equal(initial.longitude,null);
      const wire=lastWire.items.find(row=>row.id===LISTING);
      assert.deepEqual(wire.pricing,pricing);assert.deepEqual(wire.location,location);
      assert.deepEqual(Object.keys(wire.pricing).sort(),['charges','declaration']);
      for(const field of ['tenantId','privateAddress','private_address','assignedAgentId','createdById','phone','email'])assert.equal(field in wire,false,field);
      assert.equal(JSON.stringify(lastWire).includes('PRIVATE SYNTHETIC ADDRESS'),false);
      assert.equal(JSON.stringify(lastWire).includes('Synthetic County B'),false);
      const other=(await otherApi.listPropertiesV2()).items;
      assert.deepEqual(other.map(row=>row.id),[OTHERLISTING]);assert.equal(other[0].location.county,'Synthetic County B');
      assert.equal(other[0].pricing.mandatoryAmountsComplete,true);
    });

    await t.test('v1 stays compatible and contains no v2 extension fields',async()=>{
      const v1=(await api.listProperties()).items.find(row=>row.id===LISTING);
      assert.ok(v1);const {pricing:ignoredPricing,location:ignoredLocation,...v2Base}=initial;
      assert.deepEqual(v1,v2Base);assert.equal('pricing' in v1,false);assert.equal('location' in v1,false);
      assert.equal('pricing' in lastWire.items.find(row=>row.id===LISTING),false);
      assert.equal('location' in lastWire.items.find(row=>row.id===LISTING),false);
    });

    await t.test('pre-migration published rows expose explicitly undeclared fees and null structured location',async()=>{
      const legacy=(await api.listPropertiesV2()).items.find(row=>row.id===LEGACY);
      assert.ok(legacy);assert.equal(legacy.pricing.disclosureDeclaration,'not_declared');
      assert.equal(legacy.pricing.mandatoryAmountsComplete,false);assert.equal(legacy.pricing.hasUnresolvedMandatoryAmounts,true);
      assert.deepEqual(legacy.pricing.charges,[]);assert.deepEqual(legacy.location,{county:null,town:null,area:null});
    });

    await t.test('changed draft, pending review and rejection keep the original published price and location snapshot',async()=>{
      const replacement={...content,title:'Synthetic unpublished replacement',amountMinor:8800001,pricing:{declaration:'complete',charges:[]},location:{county:'Synthetic Draft County',town:null,area:null}};
      const saved=await transaction(query=>query.query('SELECT app_api.save_draft_v2($1,2,2,$2::jsonb) AS version',[LISTING,JSON.stringify(replacement)]));
      assert.equal(Number(saved.rows[0].version),3);
      assert.deepEqual(await published(),initial);
      await transaction(query=>query.query('SELECT app_api.submit_revision($1,2,3)',[LISTING]));
      assert.deepEqual(await published(),initial);
      await transaction(query=>query.query(`SELECT app_api.decide_revision($1,2,4,false,'Synthetic rejection: replacement details need correction')`,[LISTING]));
      assert.deepEqual(await published(),initial);
    });

    await t.test('a subsequent new draft persists extensions without replacing the public snapshot or crossing company',async()=>{
      const next={...content,title:'Synthetic next draft',pricing:{declaration:'incomplete',charges:[]},location:{county:null,town:'Synthetic Next Town',area:null}};
      const saved=await transaction(query=>query.query('SELECT app_api.save_draft_v2($1,3,0,$2::jsonb) AS version',[LISTING,JSON.stringify(next)]));
      assert.equal(Number(saved.rows[0].version),2);
      const stored=await transaction(query=>query.query('SELECT state,pricing,location FROM app_private.listing_revisions WHERE listing_id=$1 AND revision_no=3',[LISTING]));
      assert.equal(stored.rows[0].state,'draft');assert.deepEqual(stored.rows[0].pricing,next.pricing);assert.deepEqual(stored.rows[0].location,next.location);
      assert.deepEqual(await published(),initial);
      await assert.rejects(()=>transaction(query=>query.query('SELECT app_api.save_draft_v2($1,2,0,$2::jsonb)',[OTHERLISTING,JSON.stringify(next)])),error=>error.code==='P0002');
      const other=(await otherApi.listPropertiesV2()).items;
      assert.deepEqual(other.map(row=>row.id),[OTHERLISTING]);assert.equal(other[0].amountMinor,9900001);
    });
  }finally{await db.close();}
});
