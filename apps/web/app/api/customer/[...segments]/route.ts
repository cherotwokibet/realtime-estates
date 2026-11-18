import { customerBridge } from '../../../../lib/customer-runtime';
import { normalizeCustomerRouteRequest } from '../../../../lib/customer-session';
import { hostedCustomer } from '../../../../lib/hosted-customer-runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  try {
    const hosted = hostedCustomer();
    if (hosted) return await hosted.handle(request);
  } catch {
    return Response.json(
      { error: 'CUSTOMER_UNAVAILABLE' },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      },
    );
  }
  const bridge = customerBridge();
  if (bridge) {
    try {
      return await bridge.handle(normalizeCustomerRouteRequest(request, bridge.webOrigin));
    } catch {
      return Response.json(
        { error: 'ORIGIN_REFUSED' },
        {
          status: 403,
          headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
        },
      );
    }
  }
  return Response.json(
    { error: 'CUSTOMER_UNAVAILABLE' },
    { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
  );
}
export const GET = handle;
export const POST = handle;
