# Task07-4 acceptance audit —30October2026

Canonical scope: implement working WhatsApp/call/enquiry actions and fake-listing reporting; avoid unnecessary signup gates. Final scoped verification is recorded in ../2026-10-30-listing-reports.md; canonical acceptance is applied separately.

| Requirement | Current authoritative evidence | Remaining verification |
| --- | --- | --- |
| Configured call/WhatsApp links | apps/web/components/PublicCompanyContent.tsx constructs fixed tel and wa.me destinations from validated company configuration; public-company-content.test.mjs verifies normalized phone, WhatsApp opt-in, escaping and absent-channel refusal. Included in full web114/114. | These verify handoff links, not real phone calls/provider delivery. Do not contact real numbers. |
| Guest general and property enquiries | docs/public-enquiry.md, docs/property-enquiry.md and docs/enquiry-intake-form.md record actual synthetic guest capture and same-record authorized staff readback. Current full web114 and SDK307 retain affected regression coverage. | Confirm current source wiring and current final builds; no production channel/account consent inferred. |
| Anonymous concern capture | browser/public-fixed-uncertain.dom.txt and public-fixed-recovered.dom.txt show exact retained operation, deliberately malformed committed reply, explicit original GET and honest saved acknowledgment without signup. Signed HTTP3/3 verifies one row and exact replay. | Complete web/admin builds passed; complete SQL run363/364 plus separately corrected inventory1/1, no runtime change. |
| Company/admin handling | browser/admin-recovered.dom.txt proves version2 original recovery after uncertain review; admin-reviewed.dom.txt and admin-reviewed-320.png prove terminal reviewed queue. Admin BFF3/3; full admin448+34, initial-render1. | Complete web/admin builds passed. |
| Publication independence | browser/public-after-review.dom.txt and1280/320 screenshots show approved stock still public after report review; SQL/API tests cover restricted writes. | Complete SQL run retained; sole expected-table inventory failure corrected/retested. |
| No fabricated completion | No real fraud conclusion, outbound message, provider delivery, device/operator acceptance or launch gate is inferred. Synthetic metadata fixture has no photo bytes. | All14 release gates remain open. |

All named scopes now have evidence. Apply canonical acceptance with preserved failure/retest limits, source backup and verified private publication. SDK reports now belong to standard unit/integration commands. Preserve vendor/live resources and browser notes; no app push/Actions before1November.
