# Shared domain foundation

Independent TypeScript/ESM business logic with no runtime dependencies. Web, mobile, admin and the future server can use the same contracts and calculations. This package does not authenticate users, store records, send messages, validate image bytes or implement a backend.

`npm run build --workspace=@realtor/domain` compiles it. Build first, then `npm run test --workspace=@realtor/domain` runs deterministic Node tests using synthetic data.

## Money and filtering

`KesMoney` has `currency: "KES"` and integer `minorUnits` (100 cents per shilling). `kesFromMajor` accepts unformatted decimal **text**, never rounds an overprecise price and rejects unsafe amounts. Money helpers allow zero for totals; listing submission requires a positive price at or below `MAX_LISTING_PRICE_MINOR` (100,000,000,000,000 cents). `formatKes` preserves cents.

`calculatePriceBreakdown` separates recurring charges, non-refundable one-off charges and refundable deposits. Initial fees are all mandatory disclosed fixed KES amounts. Optional fees, estimates, unknown quotes, taxes and provider charges are not modeled. Do not label its result “all-inclusive”: it totals only the explicit supplied inputs. Sale listings do not accept recurring rental charges.

`matchesNumericRange` requires explicit inclusivity at every bound. “Over” uses `inclusive: false`; an exact count uses `exactNumericRange`. Zero bedrooms is valid; a 7+ filter must include exactly seven.

## Identity and policies

`Actor` contains a verified `subjectId`, active tenant memberships and an optional global platform-owner flag. Guests have a null subject and no memberships. `authorizePropertyAction` checks tenant context first, allows public reads within that context, restricts record creation/editing to tenant agents and review/publishing to tenant admins. An agent-created record must attribute creation and initial assignment to that agent. Subsequent private access follows `assignedAgentId`; immutable `ownerId` is creator history, not an ongoing permission. `createListing` defaults assignment to its creator; `assignListingAgent` requires tenant-admin authorization in the server adapter, and reassignment revokes the former agent's private access. Platform owners must supply matching tenant context, a reason and an audit identifier. The returned audit data is a requirement for the future server adapter to persist, not proof that an audit record exists.

Never create actors/memberships from browser-provided role or tenant fields. The future backend must resolve membership, map the tenant from trusted routing/session context, scope every query and transaction, and persist required audit records. Hiding a button provides no authorization. These policy tests are not end-to-end auth or database-isolation verification.

## Property revisions and workflows

`createListing`, `reviseListing`, `submitListing`, `reviewListing` and `publishListing` are pure transitions. Incomplete typed drafts may be saved; submission runs `validateListingDraft` using explicit configured `ListingRules`. The rules are configuration proposals until the pilot business rules are accepted. Media references must point to assets the server has independently validated and stored durably.

Moderation, publication and availability are separate fields. A revision pending review cannot be edited; withdraw it first. Reviews must match the pending revision, carry a reviewer/audit identifier and explain rejection/change requests. An admin approving their own record must explicitly acknowledge self-approval. Approval creates an approved snapshot; publishing is a separate authorized action. The currently published snapshot remains unchanged during draft editing, review and rejection, and until an accepted replacement is explicitly published. Normal discovery includes only a published snapshot whose availability is `available`; reserved/let/sold/withdrawn stock, paused, unpublished and archived records are excluded. Archived records are terminal in this initial model.

Persistence adapters are explicit: domain availability `let` maps to SQL `rented` through `availabilityToDatabase`/`availabilityFromDatabase`. Publication statuses now include `paused`; `pauseListing` represents temporary removal from discovery. `unpublishListing` remains an in-memory unpublished state and does not imply that SQL exposes an unpublish RPC. The current SQL slice approves and publishes together, checks availability freshness and can restore certain archived records; those operations require its own authoritative RPC constraints and are not identical to every pure-domain transition. The integration layer must not silently equate the two workflows.

Callers **must authorize before invoking transitions**; transition functions do not infer server identity. Concurrency/version checks, atomic persistence, legal property ownership, historical audit retention and media file verification belong to the future server and remain unimplemented.

`createEnquiry`/`transitionEnquiry` and `createViewing`/`transitionViewing` enforce explicit state progression and attributable in-memory events. A requested viewing is not a confirmed booking. Terminal outcomes cannot be overwritten in this initial model. Enquiry/viewing authorization, scheduling conflicts, reminders and event persistence still require backend implementation.

## Branding and phone support

`validateTenantBrandConfig(unknown)` validates a strictly allowlisted public configuration: tenant ID/slug, plain company text, hex colors, HTTPS/root-path logo, basic contact details, KES/en-KE and explicit feature booleans. Unknown fields are rejected to keep provider credentials out of this document. This validates syntax, not DNS/domain ownership, logo reuse rights, contact ownership or accessible color contrast. Render text using normal escaped framework output; allowlisted HTTPS URLs do not replace a future asset-fetch security policy.

`normalizeKenyanPhone` accepts only Kenyan mobile-format 07/01 numbers and their 254/+254 equivalents, with optional spaces, parentheses and hyphens. It does not support every country/prefix, verify allocation, prove number ownership or deliver messages. Synthetic examples intentionally use 0700000000/0100000000; do not treat them as real customer contacts.
