# Private listing video preparation — checkpoint287

3 November2026 EAT. Owner: Boniface + Codex. This is a connected, default-off synthetic backend slice of06-4. **51/97 tasks (53% rounded),0/14 release gates remain unchanged.** Floor-plan handling, the maintained author/reviewer UI, approved public/native video display and provider/device acceptance are still incomplete. No whole checklist item is closed.

## Implemented behavior

The shared `listing-video.ts` contract accepts one explicitly selected YouTube or Vimeo identifier and a bounded NFC title, or explicit null to remove the current selection. It accepts no arbitrary URL, query/tracking fields, embed HTML, thumbnail, location or extra metadata. Exact own data properties, canonical UUID/revision/version values, frozen command snapshots and strict duplicate-key/raw-number JSON parsing preserve the reviewed facts. The outbound-link helper constructs a canonical destination but performs no network request. No provider link was opened, fetched or embedded during this work.

The isolated `database/proposals/listing-video.sql` candidate adds immutable original commands and current private reads. Runtime has only three guarded functions and no raw table access. Every read/replay rechecks active company membership and current listing assignment. Writes lock the listing, serialize operation identity, require the current draft and exact shared revision version, advance that same version once and append a metadata-minimal audit event. Changed/stale commands conflict; exact replay returns the original without another version increment. Removal is another explicit versioned command, retaining previous originals. Transaction failure rolls back both the revision and operation. Decided revisions remain immutable. Existing public listing projection is unchanged.

The maintained API service exposes POST/GET `/v2/staff/listings/{listing}/video-operations/{operation}` and GET `/v2/staff/listings/{listing}/video-revisions/{revision}` only with trusted `listingVideoMode='synthetic-private-listing-video-v1'`. Invalid or production configuration fails closed; the request guard also refuses a process switched to production. Identity and company come from the verified server context. Query-selected context, cookies, context/conditional headers, duplicate JSON fields and mismatched command targets are refused. Request bytes/deadline and response contracts are bounded, and responses are no-store.

The maintained SDK adds `savePrivateListingVideo`, `getPrivateListingVideoOriginal` and `getPrivateListingVideo`. It snapshots before asynchronous I/O, uses the existing bounded private transport with omitted cookies/redirect refusal, requires no-store and binds saved/recovered records to the entire original. Unknown write outcomes remain uncertain; there is no automatic retry or replacement. A consumer must retain the original before sending and recover it explicitly. This checkpoint does **not** implement that browser retention UI.

The signed disposable preview explicitly installs only this reviewed proposal when opted in. Normal migrations, ordinary preview defaults, production launchers and old live resources are unchanged. There is deliberately no public video route or automatic publication: the reviewer/public snapshot boundary must be implemented before any exposure. A video selection is not a photo, does not create accepted image metadata and does not relax the existing submission minimum.

## Verification actually run

| Scope | Result | Raw evidence |
| --- | ---: | --- |
| Domain/SDK/API compilation | passed | [initial final build](video287-builds-final.txt), [SDK after no-store correction](video287-sdk-build3.txt) |
| Full domain |349 passed| [domain](video287-domain-final.txt) |
| Full SDK unit suite |337 passed| [SDK](video287-sdk-final.txt) |
| Full compiled API suite |358 passed| [API](video287-api-final.txt) |
| Restricted candidate SQL |3 passed| [SQL](video287-sql-final4.txt) |
| Actual signed HTTP/JWKS/SDK/restricted SQL composition |2 passed| [signed composition](video287-signed-final4.txt) |
| Ordinary signed preview/session/protocol compatibility |13 passed| [preview compatibility](video287-preview-final.txt) |
| Changed TypeScript/JavaScript formatting |passed| [format](video287-format-final.txt) |

Counts overlap. All final listed test logs have zero failures/skips/cancellations. Six new domain, four SDK and three API checks are included in their full suites; focused logs must not be added again. New SQL checks verify exact replay/clear/stale conflict, logical rollback, raw-table denial, current assignment/role/foreign-company/revocation refusals, decided-revision protection and unchanged public projection.

Actual signed composition consumed a successful committed POST reply and deliberately threw before returning it to the SDK. The SDK marked uncertainty; an explicit GET recovered the same complete command/version without a second POST. Deliberate exact replay returned the same record, a new stale operation conflicted, explicit removal cleared only current state, and the earlier original stayed readable. Altered signature/unknown listing and omitted feature mode were refused. Every owned loopback fixture closes in `finally`; no provider request or application browser/device journey is inferred.

Intermediate failures are retained: the first SQL fixture omitted required pricing/location facts; the next assumed version1 despite guarded allocation returning2; revocation needed its required timestamp. SDK tests corrected an incorrect redirect expectation (`error` is the existing stronger policy) and exposed a missing no-store requirement for the new lane, which was added and retested. These are development corrections, not additional accepted-release defect counts.

## Exact next work and limits

Connect a current-authorized private author workspace/BFF with review-before-send, exact current revision/version, scope-bound retained original and explicit GET-only uncertain recovery. Its preparation must cooperate with existing draft/media/transition originals rather than bypass their locks. Then implement reviewer visibility and immutable approved/public/native projection before enabling any outbound link. Public display must show the provider/destination and require explicit navigation with no embed, autoplay, thumbnail fetch or preconnect. No provider playback claim is supported by these metadata tests.

Implement floor-plan assets separately using the established bounded image decoder/metadata stripping and saved-media provenance. Define their role/count behavior explicitly so a floor plan or video cannot silently satisfy a photographic minimum. Complete responsive variants/gallery compatibility and actual interruption/browser checks before considering06-4 complete. Default schema/deployment admission, hosted concurrency/durability, provider permissions/rights, real devices/AT/operator UAT and cutover remain open. KES10,000 is still the total monthly client price; no application GitHub push/Actions, spending, credits or plan changes occurred.
