# Connected recipient acceptance — 2 November 2026, checkpoint275

The independently written local staff invitation workflow now connects branch/capture and one-time issuance to a separately verified recipient acceptance screen, actual SQL membership grant, original recovery and existing-staff revocation. Task08-4 meets the local build completion criteria described below. This is synthetic local implementation acceptance; provider identity/email delivery, hosted concurrency, devices/operator UAT and all14 release gates remain unaccepted. It does not authorize live cutover.

## Boundary and retained-operation behavior

The new identity-only session contract contains configured company, signed recipient subject/email and authority:identity_only. Exact detached validators reject extra role, credential, membership and caller-authority fields. The separately opted-in API verifies the real synthetic JWT signature/issuer/audience/age and boolean verified-email claim, ignores signed role/company claims, and returns no membership assertion. Session GET requires no SQL transaction or existing staff membership. It stays default-off with the invitation candidate; noncanonical path/query/framing/method/cookie/conditional inputs are refused.

The recipient BFF requires its own synthetic recipient mode and separate trusted server credential. There is no admin-bearer fallback. Browser input cannot choose an actor, company or credential. Each grant/original request obtains a fresh verified recipient session; the returned receipt must match that recipient's subject. POST carries a canonical private code only in the bounded JSON body. GET originals return metadata only. Redirects, cacheable results, duplicate JSON and mismatched receipts fail closed; malformed post-write facts stay uncertain. No hidden write retry is introduced.

The browser/controller retains only scope and immutable invitation/operation IDs. The private code is a separate ephemeral argument; it never enters snapshots or retained serialization. The form clears its code when dispatching, and reload restores the same command as uncertain with no saved code or receipt. Recovery is GET-only by default. An explicitly confirmed replay requires the original code to be entered again. Validated known4xx refusals can be acknowledged safely; uncertain network, malformed and5xx results cannot be discarded. Current actor/company/email are rechecked after the preflight await; closed/changed scope blocks late updates. Original receipts explicitly describe past grants, never automatic reactivation of subsequently revoked staff.

The disposable CLI now supports separate admin/recipient views under --issue-invitations. The recipient UI process contains no ordinary/admin bearer. The fixture's separately signed nonmember token is nonenumerable and never returned by an HTTP credential endpoint or printed. This role switch is controlled local fixture infrastructure, not a production sign-in provider. --lost-acceptance corrupts only the first committed grant reply. Normal startup/provider resources remain unchanged.

## Executed verification

| Scope | Result | Raw evidence |
|---|---:|---|
| Full domain |343/343|recipient275-domain.txt|
| Full SDK |333/333|recipient275-sdk.txt|
| Full admin libraries/BFF/controller |504/504|recipient275-admin-final2.txt|
| Full rendered UI regression |39/39|recipient275-admin-final2.txt|
| Full compiled API |355/355|recipient275-api.txt|
| Focused contracts/SDK/signed HTTP |22/22|recipient275-focused.txt|
| Recipient BFF/controller plus signed HTTP/SQL composition |12/12|recipient275-connected-final2.txt|
| Existing preview and owned-child lifecycle |22/22|recipient275-preview.txt|
| Current full admin production build |passed|recipient275-next-final.txt|

Counts overlap. The focused22 comprise7 domain,7 SDK and8 HTTP checks included in their full suites. The composition12 comprise6 BFF and3 retained-controller checks included in admin504, plus3 actual signed loopback HTTP/JWKS/PGlite composition tests. Those3 verify a new captured agent grant, absence of admin authority in recipient staff proxies, wrong-recipient refusal, committed-reply loss/reload recovery, and original replay after administrator revocation without reactivating membership. The SQL proposals are unchanged in this checkpoint; prior33 focused SQL checks remain scoped to checkpoint272, not a newly run33-test result here. The current production build includes /invitations/accept and its session/operation routes.

Initial failures are retained. The preview initially omitted the new session path from its whitelist, producing404; the explicit mode-scoped route fixed this. A composition assertion incorrectly expected a role field in the existing identity-only staff-session DTO; it now verifies the current membership through the guarded admin reader. SSR checks initially expected the form before retained storage was restored and assumed lowercase autocomplete spelling; they now check the actual recovery-first disabled-code markup and case-insensitive HTML attribute semantics. No product pass is inferred from the failed logs recipient275-connected-initial/final or recipient275-admin/admin-final. The final successful files above supersede them.

## Actual owned browser evidence

Owned Next on127.0.0.1:3124, ephemeral signed identity/JWKS and disposable PostgreSQL only:

1. Admin capture dd9a0aa4-eb21-49a8-bf4b-b61cedb9dc04 and issue ec224e04-b079-4a8d-b6cb-d67680ee5a70 produced a43-character code. The code moved only through the rendered synthetic UI and test-session memory; its raw value was never logged or written to evidence. Issuer code view was explicitly discarded and acknowledged.
2. The CLI switched to a separately signed recipient50, invitation-recipient@synthetic.example.invalid. Its UI process had no admin bearer. The acceptance page showed identity-only context; loading /staff in this recipient view showed Staff operations unavailable with no private directory.
3. Acceptance operation5dcdb06b-0a66-4c3d-b782-eba09ac823a8 committed but its deliberately corrupted reply produced502. The UI retained uncertain state, prevented replacement/discard and cleared the code field to zero characters. GET original returned200 and the historical agent/member50 receipt. No automatic POST retry occurred.
4. A permitted reload after recovery retained the SAME operation as uncertain, again with a zero-character code field. A second GET recovered the same receipt. At390x844, document width390, wrapped IDs/email and visible keyboard focus were observed. Safe screenshot recipient275-narrow.jpg contains no raw code. The viewport was reset.
5. Switching back to the admin view and reading current data showed exactly one member50 row, active agent/version1, and the invitation used. Its consumed-invitation revocation control was disabled. This is a current read, separate from the historical grant receipt.
6. Administrator membership operationf01d7430-1c94-4ce1-b8f7-e85c88ecdfe0 revoked member50. A fresh page read showed inactive agent/version2.
7. New capturea14c702d-67d1-412a-8ae3-388c70591bbe and issuee1ed7e61-9b64-4b38-9cd4-c4e5dffac1da supplied a separate new code for that same recipient. Acceptance1b006631-7a44-42c2-8f08-2ffab6b75700 returned the deliberate nondisclosing404 refusal: existing company membership, including inactive membership, cannot be converted through a fresh invitation. The UI displayed refused, cleared the code, and acknowledgement reopened the fresh-request form without an uncertain-operation deadlock.

The second new-code refusal did not include another post-refusal membership page read; its nonwrite behavior is established by the validated refusal contract and executed SQL/BFF tests. Browser replay after revocation is not claimed; the signed composition tests explicitly prove it. Actual browser expiry crossing, wrong-company account switching, cross-instance retained recovery, mid-request authority loss, physical devices and complete assistive-technology testing remain unrun. Prior real delayed-statement expiry and authority-loss SQL regressions remain attached to their original checkpoints.

The owned tab was closed, all raw test-code variables discarded and viewport reset. Interactive tty quit closed the launcher/API fixture normally with exit0. Owned Next PIDs10316/20988/14672/13208 and the3124 listener were independently confirmed absent. No user window/tab, vendor/live process, purchase/credit/plan or application GitHub push/Actions change occurred.

## Local build acceptance for08-4

The whole local build item now has connected evidence for branch metadata/active selection, bounded company-private staff/invitation directories, reviewed capture/issuance and explicit code disposal, separately verified recipient acceptance, safe captured-role grants, accurate issued/used/revoked state, metadata-only lost-response/reload recovery, existing-membership refusal, versioned administrator role/access changes, self/last-admin protections and no reactivation through original replay. Earlier branch/current-company and role/permission proofs remain in the staff-management248, directory251, membership258, decision261, redemption264 and issuer272 evidence. Branch binding is captured metadata, not a claim of a new branch-level permission model.

Completing08-4 changes the broad local-build checklist from49/97 to50/97 (52% rounded), with every stage/exit gate still unaccepted. Email delivery, real provider accounts, hosted multi-session expiry/lock races, native/device/accessibility/operator acceptance and production migration/cutover are separately open. No deferred or external task is removed from the denominator. KES10,000 remains the total monthly price per realtor.

Next: finish normalized ordinary catalogue authoring/reads06-1, media/floor-plan/video handling06-4, favourites/account behavior07-6 and all-admin-action permission/audit verification08-7. The remaining API/browser refusal combinations and actual hosted concurrency must be carried into integrated QA; they are not silently marked passed. Owner Boniface + Codex.
