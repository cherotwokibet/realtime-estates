# Connected mobile gallery checkpoint383 - 10 November2026 EAT

Implemented actual published-photo loading and previous/next gallery controls in the connected mobile property detail. This is a partial09-2 feature, not completion of favourites/enquiries or a device check. Canonical55/97(57%),0/14 gates remain unchanged.

## Result

MOBILE_CATALOGUE_PHOTOS=synthetic-native-v1 is an explicit development-only public build option. Strict config rejects unsupported values, orphan flags, accessors and extra authority fields. Default builds keep photos off. The gallery replaces the metadata-only placeholder only when enabled, requests one image at a time and displays loading, approved empty and unavailable states separately. Controls have labels, edge disabling and48px minimum height; this is code inspection/build evidence, not an assistive-technology pass.

The loader derives an exact API image route from canonical synthetic photo descriptors and configured API origin. Descriptor URLs, alias queries, unsupported formats, duplicates, sparse/accessor metadata and invalid indexes are rejected before IO. It omits credentials, refuses redirects/retries, enforces no-store/nosniff/WebP headers, bounded exact content length up to10MiB, RIFF/WEBP framing and cancellation/deadlines over uncooperative transport and stream reads. Current publication, tenant and retained-output hash/provenance are checked by the existing API around actual output IO. Public photo descriptors omit hashes, so this client does not claim independent SHA256 verification.

Only a data URI made from owned bytes reaches native Image. No provider URL, staff credential, disk/offline image cache or build-time customer token is introduced. Scope/key binding and effect cleanup prevent an old completion from filling another photo/property; decoder error clears the image and reports unavailable. Shared in-memory base64 encoding was extracted from the floor-plan loader; byte-for-byte encoding and floor regressions pass.

## Verification actually run

Full mobile37/37 plus actual Windows/native published-gallery HTTP1/1 passed:38 checks,0 skips. Focused11 and final6 photo checks overlap, not additional. Logs mobile383-suite.txt, mobile383-native-http.txt, mobile383-focused.txt, mobile383-final-photo.txt. Six new tests cover exact selected target/anonymous flags/data URI, strict config, no-IO off/empty/preabort/invalid descriptors, bad headers/overflow/truncation/framing, late/uncooperative response and stalled-body cancellation, bounded base64 chunk/padding and encoding cancellation.

Actual native fixture uploaded, processed, attached, submitted and approved four distinct synthetic photos. Each image was independently decoded with sharp, dimensions320/328/336/344 by240 and EXIF absent; the mobile loader's four data URIs matched those actual listening API bytes exactly. After signed publication pause it returned unavailable. Root realtor-public-gallery-DcofXA retained after fixture.close; no app/browser user data was used. This invokes the mobile TypeScript model with Node fetch, not the Expo/native adapter or phone decoder. API dev test imports the model source through the pinned Node24 TypeScript support, avoiding a dependency on ignored generated mobile test artifacts.

Mobile typecheck, changed-file format/diff and actual Android Hermes export passed (660 modules,2.2MB): mobile383-types.txt/mobile383-android.txt. Export includes imported gallery/native code but default public photo flag remains off. No browser render/emulator/physical Android/iOS/AT/operator/store or launch check was run. adb/emulator were not found on PATH; other installations were not exhaustively searched. No claim that the device gate passed.

## Exact next steps

Continue09-2 connected native customer session/favourites and enquiry/viewing journeys using existing shared SDK and web recovery patterns. First inspect the actual customer session adapter and synthetic preview entry flow; do not embed bearer tokens or add a token-entry product screen. Native auth/identity account-control work remains05-1/09-1 as applicable. Then verify native gallery rendering/network interruption and lifecycle on an actual supported runtime under09-6, keeping physical/device/AT gates explicit.

Boniface + Codex own follow-up. KES10,000 total recurring baseline retained. No provider/account purchases, Actions, plan/credit changes, vendor/live writes or cutover. Private dashboard publication and preserved browser state are recorded after deployment.
