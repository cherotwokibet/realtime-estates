import {outcomeFixture} from '../../packages/domain/test-helpers/viewing-outcome-fixtures.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
// Owner-seeded, coherent historical saved states using normal constraints/guards.
// The attendance writes and original recovery below use actual signed HTTP/runtime SQL.
export async function seedHistoricalConfirmedViewing(db,{tenantId:T,enquiryId:E,listingId:L,actorId:AGENT,viewingId:viewing,later=false,offset}){
 const f=outcomeFixture({enquiry:E,viewing,listing:L,actor:AGENT,later}),states=f.history.items.slice(1).reverse(),receipts=[];let previous;
 for(const [index,item] of states.entries()){
  const s=item.schedule,operation=id(offset+index);let payload;
  if(item.kind==='request'){await db.query("INSERT INTO app_private.viewings(tenant_id,id,enquiry_id,listing_id,requested_by_id,status,version,preferred_slots,notes,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'requested',1,'[]'::jsonb,$6,$7,$7)",[T,viewing,E,L,AGENT,f.detail.notes,item.recordedAt]);payload={listingId:L,preferredSlots:[],notes:f.detail.notes};}
  else if(item.kind==='propose'){await db.query("UPDATE app_private.viewings SET status='proposed',version=$2,proposed_slot=$3::jsonb,updated_at=$4 WHERE id=$1",[viewing,s.version,JSON.stringify(s.proposedSlot),item.recordedAt]);payload={slot:s.proposedSlot};}
  else if(item.kind==='reschedule'){const c={...s.cycle,slot:s.proposedSlot,agreement:null,confirmedAt:null};await db.query("UPDATE app_private.viewings SET status='proposed',version=$2,current_cycle=$3::jsonb,first_cycle_status=status,first_cycle_updated_at=updated_at,updated_at=$4 WHERE id=$1",[viewing,s.version,JSON.stringify(c),item.recordedAt]);payload={slot:s.proposedSlot,reason:s.cycle.reason};}
  else {payload={slot:s.proposedSlot,...s.agreement};if(!s.cycle)await db.query("UPDATE app_private.viewings SET status='confirmed',version=$2,phone_agreement=$3::jsonb,confirmed_by_id=$4,proposed_at=updated_at,confirmed_at=$5,updated_at=$5 WHERE id=$1",[viewing,s.version,JSON.stringify(s.agreement),AGENT,item.recordedAt]);else await db.query("UPDATE app_private.viewings SET status='confirmed',version=$2,current_cycle=current_cycle||$3::jsonb,cycle_confirmed_by_id=$4,updated_at=$5 WHERE id=$1",[viewing,s.version,JSON.stringify({agreement:s.agreement,confirmedAt:item.recordedAt}),AGENT,item.recordedAt]);}
  const expected=previous?.schedule.version??'1',receipt={operationId:operation,enquiryId:E,viewingId:viewing,actorId:AGENT,kind:item.kind,expectedVersion:expected,observedVersion:expected,request:payload,outcome:'applied',reason:null,result:s,completedAt:item.recordedAt};
  await db.query('INSERT INTO app_private.viewing_operations(tenant_id,operation_id,enquiry_id,requester_id,kind,target_viewing_id,viewing_id,expected_version,request_payload,receipt,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)',[T,operation,E,AGENT,item.kind,item.kind==='request'?null:viewing,viewing,expected,JSON.stringify(payload),JSON.stringify(receipt),item.recordedAt]);receipts.push(receipt);previous=item;
 }
 return {fixture:f,receipts};
}
