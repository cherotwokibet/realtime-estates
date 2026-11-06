import { handlePublicFloorPlan } from '../../../../../../lib/public-floor-plan';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handlePublicFloorPlan(request, process.env);
