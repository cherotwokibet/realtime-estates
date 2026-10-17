# Reviewer media admin proxies — 17 October 2026

The admin app now has separate fixed development-only GET routes:

- `/api/staff/reviews/:listing/:revision/media-gallery`
- `/api/staff/reviews/:listing/:revision/media/:media/preview`

Both are compiled Next route handlers with dynamic rendering, using server-only `review-media-server.ts`. The shared internal handler is selected only by the two fixed exported entry points; browser input cannot choose a policy or upstream endpoint. Existing draft-image proxy code is unchanged.

The proxies require the configured synthetic media mode and instance, exact loopback Host, same-origin context, canonical revision/version and media identities. Browser Authorization, cookies, caller actor/tenant/role context, framing, queries, range and conditional requests are refused. The upstream bearer remains on the server. Only the new fixed reviewer SDK methods are called, with cancellation and30-second timeout. Gallery output is validated again; image output is independently checked for exact tuple, MIME and bounded byte length, then copied into an owned response.

Successes and errors use private no-store/nosniff/same-origin resource headers. Safe failures preserve relevant denial/stale/unavailable status without SQL, upstream cookies, redirects, private paths or credential disclosure. Already-cancelled requests do no upstream work; production refuses these synthetic adapters.

Verification: all246 admin checks passed, including eight new parent/subtest checks exercising both compiled routes, server credential isolation, instance/origin/site denials, context/framing/query/version rejection, malformed upstream projections/bytes, sanitized status mapping, cancellation and production refusal. These use controlled upstream fetch responses through the real SDK; they are not signed real-server/native/browser image checks. Eight workspace type checks/four package builds and final admin production build passed. Installed Next route-handler and server/client documentation was read before implementation. No new failed test or build run occurred.

The review screen remains unchanged and still displays photo references. No reviewer browser/device/UAT/current-CI/hosted PostgreSQL/cutover verification is claimed. Prior771 API/SDK/integration/domain/preview and252 database checks were not rerun here. Rights/accounts/retention/legacy RPC retirement, native access-loss/decision-during-I/O and launch gates remain open. KES10,000 total monthly client price, old live service and vendor resources remain intact.

Next: connect a bounded gallery browser transport and a reviewer-specific fixed image batch to the pending-review UI. Reuse the private image reader's two-read limit, timeout, response URL/tuple checks, safe denial and object URL cleanup while keeping draft/reviewer paths pinned by separate factories. Clear/abort images on review changes, decision attempts, stale or denied reads and unmount. Add meaningful browser transport/batch tests, then launch a fresh native preview and inspect gallery-discovered decoded images in the actual browser. Read Next client guidance and apps/admin/AGENTS.md before UI work.
