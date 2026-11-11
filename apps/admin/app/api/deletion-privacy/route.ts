import { deletionTriageBoundary } from '../../../lib/deletion-triage-server.ts';

export const dynamic = 'force-dynamic';
export const GET = (request: Request) =>
  deletionTriageBoundary(request, undefined, process.env, fetch, 'privacy');
