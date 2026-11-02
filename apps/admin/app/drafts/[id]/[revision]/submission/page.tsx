import ReferenceReviewWorkspace from '../../../../../components/ReferenceReviewWorkspace.tsx';
import { readReferenceSubmissionScreen } from '../../../../../lib/reference-submission-screen.ts';
import type { ReferenceModerationScreen } from '../../../../../lib/reference-moderation-screen.ts';
export const dynamic = 'force-dynamic';
export default async function ReferenceSubmissionPage({
  params,
}: {
  params: Promise<{ id: string; revision: string }>;
}) {
  const { id, revision } = await params;
  let screen: ReferenceModerationScreen | null = null;
  try {
    screen = await readReferenceSubmissionScreen(id, revision);
  } catch {
    /* No private errors, stale context or ordinary fallback. */
  }
  return (
    <main className="draft-main">
      <a href="/listings">Listing queue</a>
      {screen ? (
        <ReferenceReviewWorkspace {...screen} purpose="author" />
      ) : (
        <section className="draft-panel">
          <h1>Reference submission unavailable</h1>
          <p role="alert">
            Fresh assigned-staff access and compatible reference readers are required. Retained
            originals remain in this tab.
          </p>
        </section>
      )}
    </main>
  );
}
