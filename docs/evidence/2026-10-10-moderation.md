# Moderation implementation evidence — 10 October 2026

Africa/Nairobi. Independently authored replacement code, signed synthetic identities and disposable data. No original vendor source, live deployment, account, production data or provider was changed.

## Delivered

The v2 API now exposes a current-admin-only pending review queue, exact revision detail and approve/reject decision commands. The existing SQL commands remain authoritative for tenant membership, revision locks/versions, submission state, fresh availability, exact reviewed snapshot replacement, rejection history and pause/archive preservation. No schema migration or media-write endpoint was added.

The shared API client validates queue/detail/receipt contracts, private raw content, Unicode rejection reasons, timestamps, exact amounts and separate listing/revision tokens. Bearer credentials remain per call. Decisions are never automatically retried; an actual committed approval followed by a deliberately lost response is reconciled through GET.

The admin review workspace loads those real local API/database projections. It shows named costs, known subtotals, private staff details, synthetic photo limitations and separate publication facts. An explicit acknowledgement is tied to the displayed revision version. Failed writes block another decision until successful readback. Local notes remain in open-tab memory and are not silently discarded while switching pending reviews. The production build and final integrated check results are recorded below only after their commands complete.

## Browser observations

Actual loopback Next UI → server-only BFF → authenticated API → restricted PGlite transactions, with both ordered migrations. Ephemeral RS256 keys/JWKS and a30-minute synthetic admin identity were used; no token was displayed or persisted. Actual viewport1280×720. A390×844 override returned1280×720 and was reset, so this checkpoint contains no390px or physical-device claim.

- Queue loaded two current-company pending revisions. Exact raw content showed studio0 bedrooms, separate private/shared bathrooms, unknown coordinates and the private synthetic staff address.
- KES20,000 monthly base +1,000 service +20,000 refundable deposit +500 one-off fee displayed21,000 known recurring and41,500 known initial. Unknown/incomplete declaration wording was reviewed and corrected so it does not invent mandatory quoted charges.
- Acknowledgement enabled a decision. Approval read back revision version4, listing version3 and publication status published; the result remained read-only. The UI does not infer public eligibility solely from approval.
- A second open view attempted rejection against version3 after approval. The actual409 retained its local rejection text, disabled decisions and required `Check latest review`; readback displayed the recorded approval. Queue selection was disabled while local pending notes remained.
- A multiline rejection note was rejected locally with an explicit one-paragraph/control-character explanation and retained its text. A valid reason then saved/read back as rejected. The paused listing remained paused, its private reason was shown and the review became read-only.
- Queue refresh after both decisions showed zero pending revisions and the empty state. Review→Overview navigation reached the separate read-only demo. No overview→editor/queue route or successor-draft creation acceptance is claimed.

Screenshots: [queue and saved approval](moderation-review-layout.png), [pending detail](moderation-review-ready.png), [stale attempt with retained notes](moderation-conflict.png), [approval publication facts](moderation-approved.png), [private rejection record](moderation-rejected.png). These are bounded desktop checks; no full accessibility, keyboard, device, operator UAT or release gate passed.

## Review corrections and resource evidence

Direct API decision requests now validate original expectedVersion tokens before JSON.parse can round a fractional number. Tests include3.0000000000000001,3.0,3e0,3E+0,zero/negative values, escaped keys and duplicate decoded keys; invalid attempts retain pending content/state. SDK canonical strings are independently bounded before numeric wire conversion. Other legacy write parsers are not silently claimed to have adopted this new lexical guard.

An initial integrated run passed265 checks. After the parser correction, focused API tests passed51/51. A subsequent full rerun encountered severe host memory pressure:587MiB free on a7,834MiB Windows host, and otherwise similar SQL cases took around100seconds. Only verified owned test runner/children were stopped; the first stop guard refused after one child finished and stopped nothing. The interrupted diagnostic output is preserved in moderation-retest-resource-stop.txt. Database, API integration and HTTP harness file concurrency is now bounded to one, retaining all cases. The final rerun is recorded separately in moderation-tests.txt; an interrupted run is never counted as a complete pass.

## Final completed verification

The final owned command completed with exit0 on10October2026: root npm test passed265 checks with0 failures/skips/cancellations; root npm run typecheck passed all seven workspaces; npm run build --workspace=@realtor/admin completed the optimized Next production build, including /reviews and its queue/detail/decision BFF routes. Logs: [full regression](moderation-tests.txt), [workspace typechecks](moderation-types.txt), [admin build](moderation-admin-build.txt). Test distribution:65 domain,5 demo,51 API,50 client transport,21 actual client/service integration,28 SQL,21 web,12 admin and12 real synthetic HTTP harness. No application runtime changed after that run; this follow-up adds documentation and completed logs.

The earlier stopped rerun remains diagnostic evidence only. Its resource problem was not counted as a pass. Browser control recovered after the final checks; current dashboard exports18/19 were preserved before the verified baseline update. This recovery is not new application/device/accessibility acceptance. The new trusted-media command/runtime documents are reviewed proposals; no codec, upload command or provider was executed or provisioned.

## Remaining work

Trusted photo-byte processing/storage, distinct-photo validation, processor-only finalize/remove/reorder commands with revision version increments, durable upload/recovery and real public image delivery remain open. Current accepted rows are bootstrap metadata only and can share keys/checksums; they do not establish verified photos or rights. See [trusted media plan](../trusted-media-plan.md).

Production sessions/provider compatibility, persistent hosted PostgreSQL/PostGIS/TLS/pooling, independent backup restore, full queue pagination/navigation, successor draft creation, complete discovery→enquiry→assignment→viewing integration, actual devices, operator UAT and cutover approval remain open. Remote CI has never run. Web/mobile source was unchanged; no new web build or mobile export/device pass is claimed. No dependency or paid service was added. Keep the KES10,000 total monthly client-price baseline and every stage exit gate open.
