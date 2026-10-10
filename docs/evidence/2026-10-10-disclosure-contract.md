# Versioned disclosure checkpoint — 10 October 2026

Dates use Africa/Nairobi. Work is independently written and uses synthetic data. No vendor files, live service, production database, provider account or paid service was changed.

## Implemented

The shared domain now validates exact v2 pricing/location JSON and derives disclosure through the existing exact-money helper. It distinguishes mandatory/optional, known/quote-required, recurring/one-off and refundable-deposit costs. Empty legacy fees stay explicitly undeclared. Nullable county/town/area fields preserve missing information; the legacy locality label is retained without inventing a taxonomy mapping.

Ordered migration `0002_listing_disclosure.sql` extends revision/snapshot storage; `0001_foundation.sql` is unchanged. Independent SQL checks enforce exact fields, at most 32 unique charges, trimmed/control-free Unicode labels, positive safe known amounts, null quotes, valid timing/classification and safe mandatory/optional sums. `save_draft_v2` applies content and charges in one atomic update under existing current-assignment and optimistic-version rules. Its audit records the actual returned version. Compatible v1 saves preserve the additional fields; incompatible edits fail rather than discard fees.

Approval copies the exact reviewed revision pricing/location into the public snapshot. Draft edits, pending review, rejection and stale decisions preserve the last approved disclosure. Paused/archived listings stay governed by the existing commands. Public v2 output uses the same approved/fresh/available/enabled company stock and coordinate-precision policy as v1. Private addresses, staff identities, contacts and decision reasons stay outside it.

The API provides `/v2/properties` and authenticated v2 draft GET/PUT/submit routes alongside unchanged v1 routes. The public wire carries validated raw inputs, and `listPropertiesV2()` derives immutable shared disclosure. The client adds only the existing local domain workspace dependency; no new external runtime package was added. V2 draft bodies allow 128 KiB, with an actual regression proving a valid full Unicode description plus 32 maximal charge labels exceeds the old 64 KiB limit and is accepted. Oversized bodies remain rejected; v1 retains 64 KiB.

V2 body/response parsing also checks raw money number tokens. Fractional `9007199254740991.1` otherwise rounds into the safe integer9007199254740991 during JSON parsing. V2 requires integer-literal `amountMinor` numbers (no decimal/exponent notation), including escaped field names, before using the parsed value. Valid literal safe integers and null quotes remain supported; coordinate decimals and strings mentioning monetary fields remain unaffected. The parser uses syntax validation and lexical tokens rather than platform-specific JSON reviver context. V1 parsing remains unchanged.

## Actual verification

Bundled Node 24.19.0, installed pinned dependencies, Windows PowerShell. Root `npm test` completed with exit 0 and **177 checks passed, zero failures/skips**:

| Boundary | Passed checks | Evidence exercised |
|---|---:|---|
| Shared domain | 65 | Existing pricing plus 13 exact-wire/Unicode/copy cases and 9 raw-money JSON parser cases |
| Synthetic configuration | 5 | Existing tenant/configuration behavior |
| API/auth/HTTP | 41 | Existing signatures/transport/workflows plus 9 actual v2 service cases: legacy projection, private reads/writes, role/assignment/company denial, malformed/unsafe inputs, stale versions, atomic rent-to-sale edit, media gate Unicode body bounds and pre-rounding raw money rejection |
| Client transport/HTTP | 31 | Existing 19 plus 12 strict v2 response, privacy, exact amounts, malformed/unknown fields, cancellation/error, Unicode maxima/surrogates, raw monetary tokens and compatibility cases |
| Actual client/API/SQL integration | 7 | Existing v1 case plus v2 parent/subtests for two-company privacy, exact derived costs, legacy unknowns and approved snapshot retention through draft/review/rejection |
| Actual SQL policies/migrations | 28 | Existing 18 run against both migrations plus 10 new migration/validation/grants/atomicity/snapshot/current-assignment/paused/archive/freshness cases |

Runner totals include parent tests consistently with earlier checkpoints. Full logs: `disclosure-checkpoint-tests.txt`. Earlier 164/166-check intermediate runs are preserved in `disclosure-initial-tests.txt` and `disclosure-preprecision-tests.txt`. An intermediate typecheck overlapped a pending shared parser export and failed TS2305; `disclosure-intermediate-types.txt` preserves it. The new raw-money service assertion initially read the wrong level of the existing error envelope; `disclosure-intermediate-service-tests.txt` preserves that test failure. The assertion was corrected to `error.code`. The final full run supersedes both intermediate failures. Root `npm run typecheck` also completed exit 0 for all seven workspaces; log: `disclosure-types.txt`. Offline lock refresh succeeded with scripts/audit disabled and added only the local domain dependency metadata. `git diff --check` passed.

Independent read-only review found the v2 request-size issue and a base-display text mismatch: the legacy client used UTF-16 length while PostgreSQL counts Unicode code points. V2 alone now aligns title/description/locality/photo-alt bounds and rejects unpaired surrogates; v1/enquiry/config behavior remains unchanged. New regressions accept paired-emoji maxima, reject each over-limit field and unpaired surrogates, and verify v1 behavior at the second array position. Both corrections are included in final verification. No remaining blocking arithmetic/privacy/compatibility issue was identified in that bounded review.

## Practical limits and next work

These checks use disposable PGlite, actual migrations, restricted roles and real API serialization. Service tests inject synthetic verified subjects; separate existing tests exercise real ephemeral RS256/JWKS signatures. This is not deployed identity, hosted PostgreSQL/PostGIS/TLS/pooling, real media processing or provider compatibility evidence. Accepted media metadata is a trusted test bootstrap fixture, never a production upload path.

Web/admin/mobile still display explicitly synthetic legacy fixtures. No UI was changed in this checkpoint, so prior interface production-build and Android JS-export evidence is preserved without a redundant rebuild. Native/browser transport, physical devices, full accessibility, operator UAT and every release gate remain open. Legacy `PropertyDraft` and demo DTO conversion still need deliberate adapters; structured location labels are not a normalized authoritative taxonomy. The v2 client is public-read only; authenticated staff client integration remains to be built.

Next: connect synthetic public discovery/detail to v2 with explicit demo/connected/loading/empty/error states, full known/unknown fee disclosure and privacy-safe mapping. Then add authenticated staff editing, trusted media processing and moderation before claiming a full publication journey. Maintain the KES 10,000 total monthly client-price baseline and verify deployment compatibility before any provisioning.

Source/history recovery and private-dashboard publication are recorded separately outside the application checkout. Same-device recovery is not independent off-device backup. Checklist remains 13/97 and accepted stage gates 0/14; partial catalogue/contract work does not finish their broad deliverables.
