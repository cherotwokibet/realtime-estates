import { floorPlanImageRequest } from '../../../../../../../../../lib/floor-plan-image-server.ts';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => floorPlanImageRequest(request);
