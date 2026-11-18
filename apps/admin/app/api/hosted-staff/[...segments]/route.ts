import { hostedStaff } from '../../../../lib/hosted-staff-runtime';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
async function handle(request: Request) {
  try {
    const staff = hostedStaff();
    if (staff) return await staff.handle(request);
  } catch {
    /* Fail closed; never use preview authority. */
  }
  return Response.json(
    { error: 'STAFF_UNAVAILABLE' },
    { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
  );
}
export const GET = handle;
export const POST = handle;
