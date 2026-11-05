import { floorPlanRequest } from '../../../../../../../../lib/floor-plan-server.ts';
export const dynamic = 'force-dynamic';
export const POST = (request: Request) => floorPlanRequest(request);
