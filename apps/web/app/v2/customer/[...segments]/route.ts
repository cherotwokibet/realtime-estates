import { nativeCustomerGateway } from '../../../../lib/native-customer-runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  try {
    const gateway = nativeCustomerGateway();
    if (gateway) return await gateway(request);
    return unavailable(404);
  } catch {
    return unavailable(503);
  }
}
function unavailable(status: number) {
  return Response.json(
    { error: { code: 'CUSTOMER_REQUEST_UNAVAILABLE' } },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        Vary: 'Authorization',
      },
    },
  );
}
export const GET = handle;
export const POST = handle;
export const HEAD = handle;
export const OPTIONS = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
