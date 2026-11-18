import { configuredBrowserIdentityRoutes } from '@realtor/api/dist/browser-identity-runtime.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handle = configuredBrowserIdentityRoutes();
export const GET = handle;
export const POST = handle;
