# Staff viewing calendar

28 October 2026. Independently written local implementation; synthetic data only. This calendar does not reserve staff time, establish attendance or send invitations/reminders. Vendor resources and the old live system remain intact.

`GET /v2/staff/viewings/calendar?fromAt=<canonical-UTC>&untilAt=<canonical-UTC>` accepts a positive half-open window of at most31 days. Both instants require exact milliseconds and `Z`. There are no caller-selected company, actor, role, assignee, version or notification parameters. Bodies, ambiguous/repeated/encoded query keys, cookies, range/conditional requests and authority headers are rejected.

Current active admins see their configured company. Agents see viewings belonging to enquiries currently assigned to them. Reassignment and revocation are checked on each fresh read. The API checks membership in its transaction; the narrow owner-defined SQL function checks it again and filters each current enquiry through `may_work`. Raw viewing tables remain unavailable to the runtime role. No write or audit entry is created by the calendar read.

The minimal projection contains a current read timestamp, the requested window, at most100 scheduled records and at most25 oldest unscheduled requests, each with a `hasMore` flag. It excludes prospect contact details, messages, private addresses, phone-agreement notes, notification recipients and evidence URLs. Displayed counts are never presented as company totals. Scheduled slots overlap the selected window; an end equal to the start boundary or a start equal to the end boundary is excluded. The current rescheduled slot is used. Cancelled/declined slots and recorded completion/no-show outcomes retain their calendar entry when a saved slot exists. Unscheduled requests cover all dates separately and do not assert an appointment.

The query uses canonical UTC slot text with C collation, an indexed range bounded by the existing four-hour maximum slot duration, and a separate requested-work index. The shared response contract verifies exact fields, window identity, overlap, limits, identities, current version strings and immutable snapshots. The API applies a transaction-local two-second query timeout. No production load or independent PostgreSQL concurrency result follows from these checks.

`/viewings/admin` and `/viewings/agent` render current authorized server reads with date/range controls, Nairobi time, clear empty/unavailable states and role-appropriate enquiry links. A calendar link reads the exact enquiry/viewing again in inspection mode. The saved snapshot can be explicitly refreshed. Preparing an action preserves existing version, evidence, uncertain-result and dirty-input guards; nothing is saved merely by opening a link. Historical receipts do not silently become the next working version. The overview and enquiry navigation expose the calendar only in the compatible configured local workspace.

## Local synthetic QA

Build shared packages and the API, then:

```powershell
$env:TENANT_SLUG='realtime-estates'
$env:OPERATIONS_UI_PORT='3116'
npm run dev:operations-preview
```

The launcher refuses production and an occupied admin development directory. It starts only loopback services with disposable SQL/identities and server-only bearer configuration. The default fixture contains current enquiries and explicitly historical2020 viewing states; use the calendar date control to inspect those dates, or deliberately propose new fictional slots.

Optional `--reminders` enables the existing **capture-only** test workflow. `--lost-reminder-result` additionally corrupts the first successful capture reply after its SQL commit, so visible uncertainty/original-result recovery can be verified. It requires `--reminders`. These flags cannot combine with `--reviews`, cannot select a provider or recipient, and send no messages. Use `npm run dev:operations-preview -- --reminders --lost-reminder-result` or invoke `node scripts/operations-preview.mjs` with those flags after builds.

The calendar makes unavailable external delivery explicit. Provider ownership/credentials, recipient/channel/consent, cadence, remote failure/retry/reconciliation and operator approval remain release work. A captured SQL test record is not notification delivery.

Executed results and scope are recorded separately in the dated checkpoint evidence. Production identity/hosting, physical devices, operator UAT and cutover gates remain open. KES10,000 remains the total recurring client price baseline.
