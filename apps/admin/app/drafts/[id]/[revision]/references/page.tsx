import ReferenceDraftWorkspace from '../../../../../components/ReferenceDraftWorkspace.tsx';
import { type ReferenceDraftScreen } from '../../../../../lib/reference-draft-screen.ts';
import { readReferenceEntryScreen } from '../../../../../lib/mixed-draft-screen.ts';
export const dynamic = 'force-dynamic';
export default async function ReferencePage({
  params,
}: {
  params: Promise<{ id: string; revision: string }>;
}) {
  const { id, revision } = await params;
  let screen: ReferenceDraftScreen | null = null;
  try {
    screen = await readReferenceEntryScreen(id, revision);
  } catch {
    /* Fail closed without serializing private upstream errors or stale draft props. */
  }
  return (
    <main className="draft-main" id="reference-main">
      <a href="/listings">Listing queue</a>
      <h1>Draft location and amenities</h1>
      <p>Local synthetic reference preview</p>
      {screen ? (
        <ReferenceDraftWorkspace
          key={JSON.stringify([
            screen.scope,
            screen.revision,
            screen.expectedVersion,
            screen.catalogue.version,
          ])}
          {...screen}
        />
      ) : (
        <section className="draft-panel">
          <h2>Reference draft unavailable</h2>
          <p role="alert">
            An enabled synthetic preview and fresh access to this editable draft are required.
          </p>
        </section>
      )}
    </main>
  );
}
