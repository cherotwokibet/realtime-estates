# Admin draft gallery

11 October 2026. Assigned staff can read the current draft and its complete ordered photo set, propose a new cover/order, and remove an association after confirmation. These controls use the shared API client and the existing authenticated exact-version commands. They preserve unsaved text, including invalid input, across explicit gallery comparisons. Uploading files and displaying private image bytes are the next implementation slice.

## Workspace contract

`GET /v2/staff/listings/:listingId/revisions/:revision/workspace` reads the draft and every gallery association in one SQL statement. The revision version and ordered photos therefore come from one statement snapshot. Current membership, assignment, tenant policies and staff authorization still apply. Reading does not mutate the draft. Each photo exposes only its ID, position, alt text, accepted flag and sealed/legacy provenance; storage keys, processing identities and private job context are excluded.

The strict client validates exact shapes, resource bindings, unique IDs and ascending unique positions within the twelve-photo limit. Gaps remain visible for explicit order repair. Legacy and unaccepted rows are included in whole-set checks. No browser action converts metadata into verified provenance. Unsupported version tokens fail closed rather than being rounded or adopted.

## Editor behavior

- Move earlier/later changes a local proposed order. Save photo order submits the complete set once against the loaded version. A sparse set requires explicit repair before removal.
- Remove photo opens a confirmation identifying that photo. Confirming removes its association from this draft through the authenticated command; retained objects and previously approved snapshots remain governed by the existing backend retention contract.
- A synchronous flight guard blocks overlapping editor commands, including keyboard form submission. Proposed ordering, removal confirmation and unresolved gallery work block text save and submission.
- Before dispatch, the editor retains the original operation ID, resource, version and exact target/order. It validates any returned receipt against that original command. An uncertain response retains the same request context; checking its result performs a read and never resends the write. A missing receipt remains unresolved.
- A historical receipt does not establish the current gallery. Read current gallery fetches a fresh workspace for comparison. The user explicitly chooses to use the saved draft/photos or keep raw text edits with the current photos before further writes. A conflict never silently replaces the working text or adopts a newer version.
- Text recovery also compares gallery versions and photo membership. Identical text cannot bypass unresolved gallery work. Text-save readback requires the expected saved version, content and photos before confirming success.

Recovery state stays in memory. The navigation warning helps with pending work; refresh/browser-crash recovery is not implemented. No private draft content is persisted into browser storage or tracker exports.

## Local preview and UI limits

Run the existing `npm run dev:staff-preview` with the pinned Node runtime and free loopback ports3001/4101. Its signed synthetic staff identity remains server-side. The new BFF routes retain explicit development-only synthetic mode, exact loopback origin/Host/launch-instance checks, same-origin JSON writes, bounded bodies, strict token/UUID/full-order parsing and no-store responses. They refuse production. They expose workspace reads, removal, ordering and original-operation reads; they grant no upload, coordinator or finalization authority.

The seed photos are labelled SQL-only metadata fixtures with no image bytes. Cards honestly show Preview unavailable and provenance status. No upload button or fake verified image is presented. Four to twelve accepted photos are required by the backend submission gate. Removing a photo can leave fewer than four; the count is shown and submission remains subject to the authoritative server gate.

Desktop browser QA verified ordering, confirmation/removal, a second-tab version conflict, explicit current-gallery adoption, preservation of an invalid money field and subsequent text save. The attempted390px viewport remained1265px in the browser tool; narrow-device behavior is unverified. See [executed evidence](evidence/2026-10-11-admin-gallery.md).

## Next bounded work

Connect authenticated private file transport and quarantine to the already verified single-attempt processing and attachment contracts, then show image previews from authorized byte delivery. Persist original request context before writes, retain uncertain outcomes, and keep coordinator credentials inaccessible to the browser. Use synthetic images until rights and account control are evidenced. Real provider isolation, budgets/quotas, production PostgreSQL races, native/mobile/device/operator UAT, independent backup and all release gates remain open. KES10,000 is still the total recurring client price baseline; this checkpoint adds no paid service.
