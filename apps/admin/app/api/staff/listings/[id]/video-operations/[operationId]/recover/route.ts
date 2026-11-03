import { listingVideoRequest } from '../../../../../../../../lib/listing-video-server.ts';
export const dynamic = 'force-dynamic';
export const POST = (request: Request) => listingVideoRequest(request);
