import FloorPlanWorkspace from '../../../../../components/FloorPlanWorkspace.tsx';
import { readFloorPlanScreen } from '../../../../../lib/floor-plan-server.ts';
export const dynamic = 'force-dynamic';
export default async function FloorPlanPage({
  params,
}: {
  params: Promise<{ id: string; revision: string }>;
}) {
  const { id, revision } = await params;
  let screen: Awaited<ReturnType<typeof readFloorPlanScreen>> | null = null;
  try {
    screen = await readFloorPlanScreen(id, revision);
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
            <h1>Private floor plan unavailable</h1>
            <p>
              Current access, an adopted reference revision and compatible floor-plan preview are
              required. Retained originals have not been changed.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
