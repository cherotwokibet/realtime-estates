# Original resource inventory/preservation verification —29October2026

Owner:Boniface+Codex. Accept01-1 as completed resource inventory and read-only preservation only. This does not grant asset/design/client-data rights, prove account control, import old UAT results as replacement passes, or approve production backup/cutover.

The9October pinned [preservation manifest](../preservation-manifest.json) identifies four supplied local roots and2254 files. The independently written [read-only verifier](../../scripts/verify-preservation.mjs) rechecked every file's exact byte length/SHA256, resolved paths within each named root, checked that length/last-write time stayed stable during reading, and enumerated current non-generated files for omissions. It did not execute vendor code, install an APK, extract/replace an archive or alter a source file.

| Collection | Expected/verified files | Original bytes verified |
| --- | ---: | ---: |
| Vendor sources, APKs, proposals, design and supporting resources |1636/1636|574909691|
| Historical UAT evidence |345/345|4394347|
| Bedsitter Langata delivery media/resources |123/123|380651979|
| Studio Ruaka delivery media/resources |150/150|446896353|
| Total |2254/2254|1406852370|

No changed, missing, unstable, unlisted or unfollowed linked file was found within that declared inventory. Existing generated-directory exclusions remain explicit: `.dart_tool`, `.git`, `.gradle`, `build`, `node_modules`. This is not an assertion that generated dependencies or unrelated/cloud-only resources were archived.

All four existing original ZIP snapshots under `rebuild-preservation/2026-10-09` matched their9October byte lengths/SHA256 and remained read-only:

| Snapshot | Bytes | SHA256 |
| --- | ---: | --- |
| Bedsitter-langata-001-DELIVERY.zip |376147579|2322795cf7aed43acf833e0ca4d6178e88f6d31ac3505cc412a04f452215c6a7|
| studio-ruaka-001-DELIVERY.zip |440826649|6adc6cf777455fb55806e1e058d71201d7308d9e329e31872131e035a230ca04|
| uat.zip |2747774|c2638b275771817a4b4d081dd47ea7967e9840565f560214407cf41bf4a161e3|
| vendor.zip |489680785|9bb322169c03f20aa1b55dc5090447d89ec8a9e13025d9cfd8a56c680b618916|

Windows file attributes separately showed ReadOnly on all four; the verifier also confirmed no writable mode bits. These are existing same-device preserved originals, not a WORM/offsite guarantee or a tested production-data restore. The baseline manifest in Git is pinned by normalized-text SHA25635ff89ff4c35cefba122d0a9ad52eed69ebb91ed3186f8e91a8d728aab2089c0; every original/archive file is hashed byte-for-byte without line-ending normalization.

Actual final execution exited0 with `complete:true`,2254/2254 files, four matching read-only archives and zero failures/changes/omissions/links. [Structured result](2026-10-29-preservation/verification.json) and [raw final output](2026-10-29-preservation/final-run.txt) are retained. The initial successful result is also retained. The verifier was then refined to pin the manifest, write a running marker instead of leaving a stale successful result during a new run, and include explicit final status/completeness; the complete read-only verification was rerun successfully after that refinement. No hash count is presented as an application test count.

No original content or archive was overwritten or replaced. No real service/account/credential, vendor/live-system state or permissions were changed. No new source/API/device/operator/UAT/release gate is accepted. KES10,000 remains the total recurring client-price baseline. App/CI development stays local before1November; no GitHub Actions run, plan/spending/credit change or purchase occurred.

Checklist after accepting only01-1:45/97 (46% rounded),0/14 release gates. Four more whole tasks are needed to reach49/97 and cross50%. Next: preserve/publish this checkpoint, then finish the normalized catalogue deployment composition and remaining public/native integration/performance verification. Design-rights/account/operator/production/actual-device evidence remains open independently.
