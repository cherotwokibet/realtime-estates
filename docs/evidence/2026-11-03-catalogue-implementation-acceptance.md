# Catalogue implementation review — checkpoint284

3 November2026 EAT. Owner: Boniface + Codex. Reviewed source: `38ae2a22707bbf078a878cbd2c2ece20df45aa60`, including connected author transitions from `435c49c48eb1377996b835c42dbd9a5a62db082b`. This checkpoint changes the evidence classification; it adds no application behavior or database migration.

The whole **local build task06-1** is accepted against its unchanged literal criterion: “Implement properties/listings, normalized location taxonomy, exact numeric prices, fees, beds/baths and amenities.” The maintained configurable authoring/API/read paths now implement every listed data capability. This is local synthetic implementation acceptance, consistent with the existing distinction between build tasks and release gates. It is not production activation or acceptance of stage06.

Earlier notes kept06-1 open for both missing author submit/withdraw controls and a controlled deployment boundary. Checkpoint281 implemented and browser-verified those controls. This review explicitly corrects the remaining classification: artifact attestation, schema rollout/rollback and hosted admission belong to release/operations compatibility, which remains open. No claim is made that the existing owner-side admission helper is an installed deployment controller. The denominator stays97, only06-1 changes from false to true, and no other task, deferred scope, stage status or gate is accepted: **51/97,53% rounded,0/14 gates**.

## Literal criterion and connected evidence

| Criterion | Maintained implementation | Verification supporting local acceptance |
| --- | --- | --- |
| Properties/listings | Shared `property.ts` and `staff-draft-content.ts`; guarded allocation, combined draft and successor commands; mixed ordinary/adopted route selection; configured reference creation/edit/review/author submission pages | Fresh domain/API/SDK and34 service composition checks; prior actual ordinary allocation/recovery checkpoint167, reference creation156, successor164, combined editing278 and submit/withdraw281. No new browser run is implied by this review. |
| Normalized location taxonomy | `listing-reference-catalogue.ts` validates stable UUID county→locality→neighbourhood hierarchy, exact catalogue version, parent relationships and selection; explicit owner catalogue installation; immutable historical snapshots | Fresh SQL candidate/install/activation checks include restricted runtime, stale/new write denial, atomic rollback and historical originals. Fresh service composition checks preserve exact catalogue selections through API/SDK/recovery. Synthetic labels only; real Kenyan location coverage/rights are not accepted. |
| Exact numeric prices | `money.ts`, `pricing.ts`, property and staff validators use safe integer KES minor units and strict decimal conversion; purpose/period pairing retained through complete commands and public read projections | Fresh domain/API/SDK/web/native-model suites; prior browser exact21000.03 readback278 and successor20000.01/123.45 proof164. No floating-point UI rounding is used as persistence authority. |
| Fees | Full combined property form and shared pricing contract include named known/quote-required charges, classification, period and deposit; creation/edit review preserves the complete unsent/sent original | Fresh property/SDK/API/web/native-model checks; prior combined save/reload/recovery278 and corrected390px fee form. Existing public fee disclosure evidence remains separately dated. |
| Beds/baths | Canonical property types, nullable integer bedrooms, private/shared bathroom disclosures and land/studio restrictions in the shared staff validator; combined author form/API/public projections | Fresh shared validators, API, SDK and public web/native-model regressions. Full all-type import/device/operator matrix remains a release-case gap. |
| Amenities | Stable amenity UUIDs and catalogue version, unique IDs/codes and property-type applicability; combined selections, snapshots and historical public reading | Fresh catalogue domain, restricted SQL, API/SDK composition and web/native-model checks. Unknown/duplicate/inapplicable IDs fail closed; no CSV label-to-ID invention. |

The configured path is connected, rather than a standalone validator: maintained admin pages load current server-owned identity and persisted protocol/context; strict BFF/client use the signed API and restricted SQL; saved snapshots feed submission/review/public readers. Ordinary paths remain available. Reference features and the six SQL proposals remain explicitly opt-in/default-off. This review does not install them into a normal or live database.

## Checks actually executed in this checkpoint

All commands ran locally under the relocated workspace with synthetic fixtures and a384MiB Node heap. No GitHub Actions or application remote push was used. Counts overlap and must not be summed into a completion measure.

| Scope | Passed | Raw evidence |
| --- | ---: | --- |
| Domain, SDK and API compilation | success | [build log](catalogue284-builds.txt) |
| Full shared domain |343| [domain](catalogue284-domain.txt) |
| Full SDK unit suite |333| [SDK](catalogue284-sdk.txt) |
| Full compiled API suite |355| [API](catalogue284-api.txt) |
| Seven reference SQL/admission files |73| [SQL](catalogue284-sql.txt) |
| Four reference SDK/API service-integration files |34| [composition](catalogue284-composition.txt) |
| Full web test compile and suite |114| [web](catalogue284-web.txt) |
| Full mobile test compile and model/preview suite |24| [mobile](catalogue284-mobile.txt) |

SQL command: `node --test --test-concurrency=1 database/tests/listing-reference-*.test.mjs database/tests/reference-deployment-admission.test.mjs`. It uses current reviewed default migrations through0037 and six explicitly isolated proposals. It is restricted PGlite fixture evidence; some admission-policy checks use a labelled query adapter, not hosted locking evidence. Composition runs `listing-reference-v3`, `reference-moderation-v3`, `reference-creation-v3` and `reference-successor-v3` service-integration test files under `packages/api-client/tests/`. Web/mobile commands are their maintained workspace `npm test` scripts. No failures, skipped or cancelled checks in these final logs.

The full admin515/rendered42, signed author composition16 and full admin production build belong to checkpoint281 and are reused as dated unchanged-source evidence, not rerun here. Actual assigned-agent withdrawal502→reload/same original→GET200→fresh submit200/pending/unpublished and durable no-photo422 refusal are documented in [submission evidence](2026-11-03-reference-submission.md). Positive photos there were fabricated sealed metadata, not processed image bytes. Prior combined property/browser/fee evidence is [checkpoint278](2026-11-03-catalogue-workflow.md).

## Explicitly open after local build acceptance

- Controlled artifact-derived configuration/schema admission, exclusive owner lease and writer drain, serialized DDL/grants, bounded activation/health/reconciliation, deployment upgrade/rollback and hosted PostgreSQL races. The helper alone does not implement these.
- Real rights/accounts/location data, provider identity/storage/delivery, durable hosted composition, actual Android/iOS and assistive technology, complete browser boundary/import matrices, operator UAT and migration/cutover approval. All35 complete release cases and14 gates remain unaccepted.
- The13-column CSV preview stays read-only with no implicit reference IDs. Floor plans/video06-4, favourites/account07-6 and all-action audit08-7 are separate incomplete tasks. Accepting06-1 does not close them.

Next local work: inspect06-4's exact requirement and existing media/video contracts, then implement the smallest complete floor-plan/video authoring→validation→saved/public-read path without provider spending or implicit embeds. Preserve protected draft/media originals and ordinary/adopted compatibility. Record deployment admission as an explicit release prerequisite rather than repeatedly blocking completed local data implementation. KES10,000 remains the total monthly client price; vendor resources and the old live system remain unchanged.
