# Shared contract convergence — 10 October 2026

Status: implementation plan, not a completed storage/API/UI feature. The pure pricing disclosure helper is implemented; the existing property draft, SQL and v1 client retain their bounded initial contracts. This transition is the next local integration task before connecting more screens.

## Current boundaries

The domain property requires county/town and stores known mandatory `ListingFee` entries. SQL drafts and approved snapshots use flat `locality`, a base `amount_minor` and separate private/shared bathrooms, with no persisted charges. The demo uses `priceMinor`; the public v1 API/client uses `amountMinor`. These are explicit minor-unit aliases, not different currencies. The strict v1 client rejects unknown response fields, so silently adding pricing fields would break a currently verified consumer.

## Intended sequence

1. Define an explicit v2 public/staff contract and dedicated routes alongside v1. Keep v1 unchanged until its callers deliberately migrate. Use `calculatePricingDisclosure` as the canonical arithmetic/validation boundary: `amountStatus` is known or quote_required; quotes carry null; charge classification, timing and mandatory flag are explicit. Persist charge inputs and disclosure declaration, then derive public subtotals on the server. Bound row counts and label sizes at transport/storage boundaries.
2. Add a new ordered migration after `0001_foundation.sql`; retain the committed migration. Scope charges to the exact tenant/listing/revision through composite keys or strictly validated revision content. Initial and legacy data default to not_declared, with no automatic assertion that absent charges are zero. Editing or removing charges must use the existing optimistic version and current-assignment rules.
3. On approval, atomically copy the exact reviewed pricing inputs into the approved snapshot. Later draft edits, rejection, stale submissions and tenant reassignment cannot change the public price disclosure. Preserve paused/archived publication states. Limit public projections to approved/fresh/available company stock; never expose contact evidence, private addresses, actor data or administrative reasons.
4. Map county/town/area deliberately into public location fields; keep the legacy locality label when that is the only known information. Missing structured location stays unknown or blocks the relevant new submission rule; never fabricate county/town or coordinates to satisfy a type. Maintain the existing public-precision policy and private coordinate/address boundary. Shared/private bathrooms and true zero-bedroom studios must survive conversion.
5. Add API/client v2 validation and real service/SQL integration checks. Malformed, extra, fractional, unsafe or conflicting fields fail closed. Client display uses server-validated amounts with shared formatting; no fallback to demo on connected failures. Keep loading, empty, denied, unavailable and recoverable error states distinct.
6. Connect a synthetic web/admin/mobile journey incrementally. Show exact base/period, known mandatory subtotal, separate refundable deposit, optional rows and quote-required messages. Incomplete coverage remains visible. No all-inclusive claim follows from an empty array or a declared-complete flag alone.

## Required evidence

Verify exact sale/rent examples, optional quotes, incomplete coverage, unsafe totals, invalid charge combinations and legacy-default migration. At the SQL boundary test cross-company denial, approval snapshot immutability, stale optimistic versions, current assignment, paused/archive preservation and private-field projection. At the actual API/client boundary test real serialized v2 data and v1 compatibility. Review screens with keyboard and assistive technology and on Android/iOS separately; a Node transport test or JS export is not that evidence.

Synthetic fixture media remain bootstrap evidence only. A trusted upload processor, deployed identity/provider compatibility, real data rights and cutover approval remain separate prerequisites. This plan provisions no services and does not increase the KES 10,000 client-price baseline.
