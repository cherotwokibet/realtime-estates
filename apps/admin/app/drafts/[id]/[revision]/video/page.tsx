import ListingVideoWorkspace from '../../../../../components/ListingVideoWorkspace.tsx';
import {
  readListingVideoScreen,
  type ListingVideoScreen,
} from '../../../../../lib/listing-video-screen.ts';
export const dynamic = 'force-dynamic';
export default async function VideoPage({
  params,
}: {
  params: Promise<{ id: string; revision: string }>;
}) {
  const { id, revision } = await params;
  let screen: ListingVideoScreen | null = null;
  try {
    screen = await readListingVideoScreen(id, revision);
  } catch {
    /* No stale private facts or retained-original deletion. */
  }
  return (
    <div className="draft-workspace">
      <main className="draft-main">
        <a href={`/drafts/${id}/${revision}`}>Back to saved draft</a>
        {screen ? (
          <ListingVideoWorkspace
            key={JSON.stringify([screen.scope, screen.state.version])}
            {...screen}
          />
        ) : (
          <section className="draft-panel">
            <h1>Private video unavailable</h1>
            <p>
              Current access, an adopted reference revision and compatible private video preview are
              required. Retained originals have not been changed.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
