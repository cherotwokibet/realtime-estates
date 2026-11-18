# Browser identity cancellation — checkpoint 445

18 November 2026 EAT. Completed the server-side login/callback/logout lifecycle needed before connecting provider sessions to private customer/staff adapters. An earlier callback could finish provider exchange and issue a session after logout had already cleared the browser. This change keeps cancellation authoritative during issuance and on subsequent session reads.

## Implementation

Login state is now matched by hash before a transaction can be claimed. The claim is one-use and retains the browser-binding record during provider exchange. One SQL statement checks the live claim, links its issued session and inserts the encrypted session. Logout cancels the binding and removes its linked session; starting another login with the old binding also cancels it. Callbacks recheck the resulting session before returning a cookie. authenticate() rechecks the session after asynchronous token verification.

Each session read also requires a surviving issuance marker. Under PostgreSQL Read Committed, a cancellation statement can wait on a callback's update but miss its newly inserted session in that statement's original snapshot. Marker absence therefore denies an orphan independently of physical cleanup. This concurrency reasoning follows the [official transaction isolation documentation](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED); the actual orphan state is tested locally. No multi-connection hosted PostgreSQL execution is claimed.

Expiry cleanup retains issuance markers for unexpired sessions. The proposal adds a claimed flag, hashed state, a session link and a unique link index. It remains outside accepted migrations. The identity runtime role now requires UPDATE as well as SELECT/INSERT/DELETE on the dedicated table. Existing installations of the earlier proposal need a reviewed migration; no staging schema was changed in this session.

Hosted configuration now refuses all actual STAFF_PREVIEW_* keys and WEB_CUSTOMER_PREVIEW_CONFIG even when their value is empty. The earlier single STAFF_PREVIEW_CONFIG guard did not cover the real staff preview variables.

## Verification actually run

- API TypeScript compilation passed.
- **31 focused checks passed, zero failures/skips:** 17 identity/store/runtime cases and 14 existing verifier cases. See 2026-11-18-identity-cancellation-tests.txt. Current-source whole API suite was not rerun; the earlier 411-pass result remains checkpoint 444 evidence.
- Signed local HTTP provider plus actual disposable SQL tested logout with a callback paused before session issuance and paused after SQL issuance. Both callbacks were refused and no session survived. The tests also retain replay, cross-company, signature/audience, encrypted-store restart, tampering and configuration checks.
- A forged state leaves the legitimate login available. A physically retained session with its issuance marker removed is denied. Cleanup at the login deadline preserves an unexpired issued session.
- Both web and admin production builds passed; logs are retained alongside this evidence. No browser/device/provider-account/hosted-PostgreSQL verification was run.

## Continuation

Keep tasks 04-3, 04-5 and 05-1 open, with 55/97 verified deliverables and 0/14 accepted gates. Next connect the authenticated-session reader to the existing customer and staff server adapters, add usable sign-in/logout navigation and cache clearing, and verify current membership on every protected operation. Provider-wide logout, upstream credential revocation and already-authorized downstream mutations remain separate requirements. Continue locally while controlled staging project names and account evidence are pending. The earlier 11 mobile-toolchain dependency advisories remain unresolved. No billing, vendor/live resource, paid service or production deployment changed. KES 10,000 per realtor/month remains the total recurring baseline.
