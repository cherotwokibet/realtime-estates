import FloorPlanWorkspace from '../../../../../components/FloorPlanWorkspace.tsx';
import { readReviewFloorPlanScreen } from '../../../../../lib/floor-plan-server.ts';
export const dynamic = 'force-dynamic';
export default async function FloorPlanPage({
  params,
}: {
  params: Promise<{ id: string; revision: string }>;
}) {
  const { id, revision } = await params;
  let screen: Awaited<ReturnType<typeof readReviewFloorPlanScreen>> | null = null;
  try {
    screen = await readReviewFloorPlanScreen(id, revision);
  } catch {
    /* No stale private facts or retained-original deletion. */
  }
  return (
    <div className="draft-workspace">
      <main className="draft-main">
        <a href="/reviews">Back to reviews</a>
        {screen ? (
          <FloorPlanWorkspace
            key={JSON.stringify([screen.scope, screen.state.version])}
            {...screen}
            editable={false}
          />
        ) : (
          <section className="draft-panel">
            <h1>Review floor plan unavailable</h1>
            <p>Current admin access and a pending or approved reference revision are required.</p>
          </section>
        )}
      </main>
    </div>
  );
}
