import { floorPlanRequest } from '../../../../../../../../../lib/floor-plan-server.ts';
export const dynamic = 'force-dynamic';
export const PUT = (request: Request) => floorPlanRequest(request);
export const GET = (request: Request) => floorPlanRequest(request);
