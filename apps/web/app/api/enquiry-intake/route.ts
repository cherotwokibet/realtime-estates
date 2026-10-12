import {handleSyntheticEnquiry} from '@realtor/api-client';
import {publicIntakeConfig,authorizePublicIntake} from '../../../lib/intake-config';
export const dynamic='force-dynamic';
export function POST(request:Request):Promise<Response>{
 // Invalid/disabled configuration is handled by the shared fail-closed authorization boundary.
 let scope:ReturnType<typeof publicIntakeConfig>|undefined;
 try{scope=publicIntakeConfig(process.env);}catch{}
 return handleSyntheticEnquiry(request,{apiOrigin:scope?.apiOrigin??'',noticeVersion:scope?.noticeVersion??'',authorize:r=>{if(!scope)throw new Error('Unavailable');authorizePublicIntake(r,scope.instanceId);}});
}
