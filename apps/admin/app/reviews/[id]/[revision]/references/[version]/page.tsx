import ReferenceReviewWorkspace from '../../../../../../components/ReferenceReviewWorkspace.tsx';
import {
  readReferenceModerationScreen,
  type ReferenceModerationScreen,
} from '../../../../../../lib/reference-moderation-screen.ts';
export const dynamic = 'force-dynamic';
export default async function ReferenceReviewPage({
  params,
}: {
  params: Promise<{ id: string; revision: string; version: string }>;
}) {
  const { id, revision, version } = await params;
  let screen: ReferenceModerationScreen | null = null;
  try {
    screen = await readReferenceModerationScreen(id, revision, version);
  } catch {
    /* Keep private upstream errors and credentials on the server. */
  }
  return (
    <main className="draft-main" id="reference-review-main">
      <a href="/reviews">Pending reviews</a>
      <p>Local synthetic reference review</p>
      {screen ? (
        <ReferenceReviewWorkspace {...screen} />
      ) : (
        <section className="draft-panel">
          <h1>Reference review unavailable</h1>
          <p role="alert">
            An enabled synthetic preview and current reviewer access are required. Retained
            originals remain in this tab.
          </p>
        </section>
      )}
    </main>
  );
}
