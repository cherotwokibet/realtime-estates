# UAT to replacement requirements

Source: UAT-2026-10-09/UAT-REPORT.md, 9 October 2026. Existing results are evidence about the vendor product, never replacement passes. Every requirement below is proposed and must be independently retested.

| ID | Priority | Existing finding | Decision | Replacement acceptance |
|---|---|---|---|---|
| R-001 | Retired | Table header accidentally parsed as a finding | Remove parsing artefact; retain ID history | No defect or implementation claim; authoritative report has 24 substantive findings |
| R-002 | P1 | Regular role can create listings | Redesign | Enforce listing-role authorization on writes and routes. |
| R-003 | P1 | Cross-account owner edit accepted | Redesign | Enforce authenticated owner on read/edit/write and derive actor from authenticated session. |
| R-004 | P1 | Logout leaves private owner view in another tab | Redesign | Clear private state and subscriptions in every tab on sign-out; recheck server permissions. |
| R-005 | P1 | Uploads stall without recovery | Redesign | Instrument failures; provide bounded timeout, retry/cancel and recoverable drafts; verify no partial/duplicate records. |
| R-006 | P1 | Admin password visible by default | Redesign | Mask by default and label optional visibility toggle. |
| R-007 | P1 | Startup module failures | Redesign | Fix script/module bundling and add bounded loading/error recovery. |
| R-008 | P2 | Edit bypasses minimum sale price | Redesign | Use consistent server and client create/edit validation. |
| R-009 | P2 | Strict Over bands include threshold | Redesign | Use strict > or rename to and above; document endpoint policy. |
| R-010 | P2 | Selected filters disagree with results after navigation | Redesign | Reapply retained filter state or reset chips when navigating. |
| R-011 | P2 | Exact prices hidden by card rounding | Redesign | Display exact/localized KES price or useful precision, with rental period. |
| R-012 | P2 | Extra charges and totals are unclear | Redesign | Separate base/each fee/total and recurrence; reject empty extra rows; show fee names in admin. |
| R-013 | P2 | Type/purpose columns use wrong values | Redesign | Use canonical purpose and property-type fields with correct labels. |
| R-014 | P2 | Bedroom and bathroom model loses detail | Redesign | Keep numeric bedroom counts, document grouped search meaning, model private/shared bathrooms. |
| R-015 | P2 | Phone normalization fails | Redesign | Normalize E.164 and accept consistent Kenyan local/international formats. |
| R-016 | P2 | Moderation states mislead owners | Redesign | Show pending/rejected/paused states and reasons consistently; handle moderation errors. |
| R-017 | P2 | Viewing/booking unavailable | Defer transaction booking; redesign viewing requests | Implement lifecycle or publish accurate availability; test cancellations/owner response/notifications/ledger end to end. |
| R-018 | P2 | Minimum photo rule inconsistent | Redesign | Align UI/business rule/server validation. |
| R-019 | P2 | Invalid-image selection accepted | Redesign | Validate actual file content and show useful media errors. |
| R-020 | P2 | Blank signed-in feedback persisted | Redesign | Trim and reject empty feedback; maintain auth checks. |
| R-021 | P2 | Contact/reporting gaps | Redesign | Provide working contact links and report/triage loop with accessible feedback. |
| R-022 | P2 | Commission taxonomy and currency differ | Redesign | Canonical Kenyan types/KES, explicit units and validated rates; verify nonzero booking ledger. |
| R-023 | P2 | Admin modules blank | Defer paid ads; redesign support queue | Implement queue/actions or useful empty/unavailable/error states. |
| R-024 | P2 | Keyboard and accessible controls incomplete | Redesign | Support keyboard, semantic names/focus/error announcements; complete WCAG2.2AA audit. |
| R-025 | P3 | Terms contain unfinished copy | Redesign | Publish reviewed finished text and working links. |

## Feature disposition

| Feature | Decision | Pilot behavior |
|---|---|---|
| Public catalogue, filters, details, favourites | Keep intent; rebuild | Exact KES prices, correct filters, available approved stock |
| Listing creation/edit and media | Keep intent; rebuild | Authorized agents, recoverable upload, moderated revisions |
| Admin moderation, users, FAQ | Keep intent; rebuild | Tenant-scoped roles, audit history, clear states |
| Contact and viewing | Redesign | WhatsApp/call links and request, assign, confirm, complete/cancel workflow |
| Payments, commissions, paid ads | Defer | No payment collection or earnings claims in pilot |
| Firebase Dynamic Links, placeholder policies, vendor code | Remove from replacement | Owned HTTPS links, reviewed policies, independently written code |
| Per-realtor copies | Redesign | Shared versioned platform with brand/configuration and tenant isolation |

Coverage corrected 9 October 2026: 24 substantive findings mapped; R-001 retires the mistakenly parsed table header; detailed tests and evidence remain in the preserved UAT snapshot.
