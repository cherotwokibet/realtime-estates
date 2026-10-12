import IntakeWorkspace from '../../../shared/IntakeWorkspace';
import {publicIntakeConfig} from '../../lib/intake-config';
import {tenantBrand} from '../../lib/tenant';
import '../../../shared/intake.css';
export const dynamic='force-dynamic';
export default function Enquire(){
 let scope:ReturnType<typeof publicIntakeConfig>|undefined;
 try{scope=publicIntakeConfig(process.env);}catch{}
 return <main id="main" className="intake-shell"><header><a href="/">{tenantBrand.name}</a><a href="/">Explore homes →</a></header>{scope?<IntakeWorkspace instanceId={scope.instanceId} showInbox={false}/>:<section className="intake-card"><h1>Enquiries are unavailable in this preview.</h1><p>No contact details are collected here. Return to the catalogue to explore the demonstration.</p></section>}</main>;
}
