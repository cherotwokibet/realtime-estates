# Existing-staff workspace checkpoint251 — 2 November 2026

Independently authored local synthetic implementation. Task08-4 remains open;49/97 tasks and0/14 release gates unchanged.

Added bounded private membership pages (stable member-ID order,1..20 rows, explicit cursor, existing agent/admin rows including inactive staff, customers and foreign company excluded). Exact immutable shared page validation binds cursor/order/cardinality and private current projections. Isolated SQL directory reads require current company admin on every call.

Connected the directory through API/SDK, a separately enabled current-instance admin BFF, strict browser transport and the shared retained-write controller. Membership writes share the one-pending-operation gate with branches/invitations/revocations. Self-target changes fail before persistence; uncertain writes cannot be replaced/discarded and recover by original GET. Role-loss403 and wrong-actor replies retain the original. The mounted UI adopts a fresh member/version before explicit role/active-access preparation, review and submission; acknowledgement requires fresh adoption for another change. Self changes are unavailable. Directory rows show synthetic member IDs; verified account display names are still pending.

Default branch/invitation preview does not enable membership changes. The separate STAFF_MEMBERSHIP_PREVIEW_MODE=synthetic-existing-members-v1 flag and explicit launcher --memberships opt-in are required. Loader returns memberships:null when absent; enabled failed reads fail closed. Invitation copy now distinguishes request capture from existing-staff access changes. No membership creation, customer conversion, branch authorization or recipient redemption was added.

## Executed checks

- Full domain336/336: staff-directory251-domain-full.txt.
- Isolated restricted SQL7/7: staff-directory251-sql.txt.
- Focused membership API9/9: staff-directory251-api.txt. Prior full API328 belongs to248; no fresh full API total claimed.
- Full standard SDK326/326: staff-directory251-sdk-full.txt.
- Full admin server/model/controller487/487: staff-directory251-admin-full.txt.
- Full SSR/model UI38/38: staff-directory251-ui-full.txt.
- Focused BFF/browser/controller12/12: staff-directory251-focused-final.txt.
- Signed loader/BFF/browser-adapter/controller HTTP/restricted SQL8/8: staff-directory251-integration-verified.txt. Includes existing branch/invitation regressions, separate-mode directory access, agent/foreign refusal, persisted uncertain membership change, store-restored GET-only original recovery, current revoked state, immediate denial of the same existing agent token, and explicit reactivation/promotion allowing a current privileged read with that token.
- Domain/API/SDK builds and admin test TypeScript compilation passed. Launcher/API-preview syntax and whitespace checks passed.

Counts overlap. These are source, model, SSR and signed adapter checks. No actual Next/browser interaction or current production build for the NEW membership controls has run.248 browser/build evidence remains historical and covers branch/invitation/revocation controls, not these membership controls. At this checkpoint free memory652320KiB; no new preview or user-process closure attempted.

## Failures retained

Initial focused11/12 used an incomplete fake upstream403 envelope without its required requestId/header; strict SDK correctly treated it as malformed. Corrected fixture final12/12 passed. Initial combined integration5/8 and focused retest0/3 exposed a missing membership base-query allowance in the disposable preview adapter plus an invalid boolean enquiry fixture option. Added only the explicit-mode base-path allowance; service still validates the exact query. Corrected fixture uses synthetic-v1. The next run7/8 reached a wrong test assertion: current staff session intentionally exposes identity only, not a role property. Corrected test verifies identity and an actual privileged directory read after promotion. Final8/8 passed. All initial logs remain alongside final evidence; no failures suppressed.

## Exact next steps

Boniface + Codex: when memory permits, run the current full admin production build, then node scripts/staff-directory-preview.mjs --memberships --lost-results. In the actual owned browser verify self-change absence, adopt member/version, revoke/promote/reactivate, committed corrupt reply lock and original GET, reload/scope/access-loss handling and narrow/keyboard layout; inspect current page readback. Never infer these unrun checks passed. Then implement recipient-verified single-use invitation issuance/redemption before08-4 completion. Use trusted verified issuer/subject/email, never body identity. Digest-only secrets need explicit lost-secret recovery policy; no silent token replacement. Align tenant-first locks across branch/invitation/revoke/member writers and check wall-clock expiry after decision locks. Existing membership conversion, production identity/delivery, hosted concurrent sessions, devices/operator UAT, ownership and cutover remain separate.

A subagent reported a usage limit during a read-only design review. No additional agents were dispatched, no credits/reset/plan changes made and no usage bypass attempted. Save this checkpoint and await later authorized continuation if capacity remains exhausted. No GitHub application push/Actions, purchase, vendor-original or old-live change.
