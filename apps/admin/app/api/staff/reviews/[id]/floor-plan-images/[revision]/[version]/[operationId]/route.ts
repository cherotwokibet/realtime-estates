import { reviewFloorPlanImageRequest } from '../../../../../../../../../lib/floor-plan-image-server.ts';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => reviewFloorPlanImageRequest(request);
