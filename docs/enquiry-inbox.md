# Connected synthetic enquiry inbox

12 October 2026. Independently written development preview, using fictional data and the existing shared enquiry contracts. KES10,000 remains the total monthly client price baseline. No paid provider, production account or original vendor resource was changed.

## Run and scope

Run `npm run dev:enquiry-preview` with the project's pinned Node24 runtime. It builds shared packages/API, creates a disposable restricted-role database, signs fixed local admin and agent identities, and launches one Next process at `http://127.0.0.1:3001/enquiries/admin` and `/enquiries/agent`. Both roles use the same database. The simulation expires after30 minutes; stopping discards its database. This is not production authentication, an operator identity picker, or persistent CRM hosting. The production environment and absent/invalid opt-in configuration refuse these routes.

The `synthetic-v1` mode seeds five fictional general enquiries per each of two synthetic companies through actual capture/assignment/contact SQL operations. It refuses combination with native/media/pending-review modes. No phone recipient is seeded; email uses example.invalid. Signed credentials are non-enumerable local composition values, child-server environment only, never printed or serialized to browser props. The launcher prints only labelled localhost URLs and drains its child/API/JWKS/database on shutdown.

## Queue, actions and dates

The admin sees current company enquiries; the agent sees their current assignment. Queue reads load at most50, staff directory at most100, disclose truncation and provide manual refresh. Local filters apply only to the loaded slice. No complete company, overdue or performance totals are inferred. Staff are labelled by actual supplied ID/role without invented profiles.

Private detail renders contact/message/notice as escaped text and retains original contacted property/revision when present. Admin assignment, record contact, qualification, follow-up reschedule, closure and reasoned reopening use the existing seven-field immutable commands and current SQL authorization. Saving contact does not send a message or confirm a viewing. This slice's browser fixtures are general enquiries; property references have backend/model tests, not a new browser property-enquiry claim.

Dates are entered as Nairobi civil times, explicitly UTC+03:00, converted without host-local parsing, and retain seconds/milliseconds. Past dates remain valid and visibly overdue. Dates outside the representable Nairobi years0001–9999 are rejected; no local-time guessing or clamping. The date input listens for native input/change events. Actual browser entry initially failed to update React state through change alone; adding input handling was then verified with the exact timestamp.

## Working state and uncertain commands

Saved snapshot, raw input, original immutable command/receipt and current comparison are separate. A synchronous write lock snapshots one UUID/body and prevents another command while its result is unresolved. Original receipts are historical and never silently become the editable current version. Check current enquiry is read-only; Use this current version explicitly adopts its version and preserves the raw action/date/reason/staff selection for review. Stale conflict retains the original request and raw fields. No automatic retry, explicit replay button or automatic fresh-version adoption is supplied.

After an ambiguous dispatched failure, Recover original result performs a GET bound to the complete retained command. Missing/denied/malformed recovery does not prove noncommit and keeps the new-save lock. Known pre-dispatch/refused failures keep raw input. Current401/403/404 hides cached private saved/current/queue/directory data. Shared read-generation guards plus aborts prevent earlier queue/detail/current/directory successes from repopulating it after denial or teardown. An explicit directory reload supports authorized recovery. The guard does not replace server authorization or promise continuous revocation during transmission.

Switching selected enquiry with changed input/completed receipt requires explicit discard. An unresolved command cannot be discarded through this control. Tab-local before-unload protection warns on drafts/retained commands, but reload, browser close, developer hot reload or process loss can still lose tab-local intent. No private localStorage persistence or crash recovery is claimed. Avoid editing/reloading the development code while using the preview.

## Server boundary

Fixed development-only actor routes use server-only bearer identities, loopback request/Host/Origin/fetch-site checks, per-role instance binding and narrow exact paths/queries. Browser bearer/cookie/tenant/actor overrides are refused. POST reads bounded duplicate-aware JSON, exact literal numeric versions and unused nulls; shared SDK returns validated DTOs and safe errors. Responses are private/no-store. Browser reads collect at most512KiB decoded JSON with abort/deadline and no automatic retry. Production/provider session, persistent hosted composition and distributed controls are separate release work.

## Remaining work

Next connect reviewed public/protected-staff enquiry intake to this workflow with notice/idempotency and explicit capture recovery, then implement attributable contact history and viewing request/confirmation/cancellation. Keep viewing state separate from contacted/qualified. A measured390px browser layout is verified; add browser lost-reply recovery/reload tests, physical devices, further breakpoints and operator/accessibility review. Production identity/persistence, real PostgreSQL multi-connection races, independent backup/private platform remote, rights/account control and all launch gates remain open. Do not retire the live vendor system without replacement verification and cutover approval.
