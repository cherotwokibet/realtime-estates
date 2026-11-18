import { hostedIdentity } from '../../../lib/hosted-identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handle = hostedIdentity.handle;
export const GET = handle;
export const POST = handle;
