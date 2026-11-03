# Private video author workflow — checkpoint290

Observed 3 November2026 EAT. Owner: Boniface + Codex. Local synthetic development only. This advances unfinished task06-4; 51/97 broad deliverables (53% rounded), zero accepted release gates remain unchanged.

## Connected behavior

An explicitly enabled current-authorized author page now edits private video metadata on an adopted reference revision. The server binds instance, tenant, actor, listing, revision and current version before rendering and before dispatch. Ordinary revisions deliberately have no fallback into this workspace. `STAFF_PREVIEW_VIDEO=synthetic-private-listing-video-v1` requires the existing reference-draft mode; omitted, invalid and production configuration fails closed. The isolated video SQL proposal remains default-off and outside normal migrations.

The author selects YouTube or Vimeo, supplies a strict provider identifier and title, or explicitly removes the selection. Review retains and reads back the complete immutable command before any request. Storage failure blocks dispatch; malformed or foreign retained entries remain locked. Reload restores uncertainty without automatic network activity. Recovery is an explicit browser BFF request whose upstream operation is a GET of the same complete original. Deliberate exact replay requires a separate acknowledgement; a refusal after an uncertain replay cannot erase the unknown outcome. Confirmed outcomes require explicit acknowledgement and verified storage removal before fresh preparation.

New reference-draft and author/reviewer transition preparation cooperates with the video original lock. Video preparation/save/replay checks the reciprocal draft/transition originals. Recovery remains distinct. Browser transport contains no upstream bearer and accepts only bounded no-store responses. The BFF uses fixed server credentials, same-origin loopback development restrictions, route/body/scope equality and current-session readback. A post-commit access-read failure stays uncertain. Next-injected forwarding headers are ignored as authority. No provider request, embed, autoplay, thumbnail fetch or public video projection was introduced.

## Executed verification

- Full admin library/BFF/controller suite:525 passed; rendered page/UI suite:44 passed (`video290-admin-final1.txt`).
- Full maintained signed reference composition:18 passed (`video290-reference-final1.txt`), including two new video flows also retained separately in `video290-signed2.txt`.
- Focused video retention/transport:10 passed (`video290-focused1.txt`); two rendered video cases in `video290-rendered1.txt`. These overlap the full suites.
- Test TypeScript compilation and full current Next admin production build passed (`video290-compile-final4.txt`, `video290-next-final1.txt`), including the new dynamic page and save/recover routes.
- Changed code formatting passed after formatting the test-config JSON (`video290-format-final2.txt`); earlier format/compiler/setup failures remain retained, not counted as passes.

The signed tests compose actual HTTP, JWKS, SDK and restricted PGlite: explicit reference adoption, corrupt committed response, uncertainty, restored original, GET recovery, fresh null removal, and a post-save invalid-signature current-session read. The latter returns401 after a committed write and retains uncertainty until normal recovery. Wrong browser actor scope is refused before mutation. Domain349/SDK337/API358 checks from checkpoint287 retain their original date/source; their full suites were not rerun here. Counts overlap and are not a completion percentage.

## Actual browser evidence

The disposable owned fixture explicitly adopted fictional listing `00000000-0000-4000-8000-000000000400`, revision1, via the signed SDK before opening the page. This is programmatic setup, not a browser adoption acceptance claim.

The stable second fixture began at draft version3. The author reviewed YouTube identifier `abcdefghijk`, title “Synthetic browser tour second fixture”, and saved original `d6580d78-70aa-4906-a735-132954a07260`. The first reply was deliberately corrupted after commit; the BFF returned502 and the page retained uncertainty. Full reload showed saved version4 and restored the SAME original/expected3 without another write. Explicit “Check original video request” recovered it. After acknowledgement, a fresh explicit removal `b239bda3-e4d3-4166-af7f-80b10371113a`, expected4, resolved200. Acknowledgement and fresh read showed version5 and selection None. `video290-preview-run2.txt` records this actual sequence.

At390×844, document client and scroll width both390. Provider/title/identifier controls measured48px high and about278px wide, fully inside the viewport; keyboard focus traversal was inspected. [Actual narrow author screenshot](video290-author-narrow.jpg). No physical-device or assistive-technology pass is inferred.

An earlier disposable run reviewed/revised an unsent original and reached uncertain save, but the Next development compiler hit its384MiB heap limit during reload. That fixture was lost and is NOT a recovery pass. The owned Next child was restarted with640MiB and the full flow above was then verified. `video290-preview-memory1.txt` retains this limitation. Stable tab13 closed and viewport override reset. Error tab12 cleanup was refused by the browser URL policy; no policy bypass was attempted. Owned preview was stopped, port3132 no longer listened, and generated next-env was restored to SHA2561862AC4BBBC5192D4BF562161DF66EA547ED3E67173100656AB606AE9797DB2B. User tabs and protected ports were preserved.

## Remaining work and boundaries

Implement reviewer visibility and immutable approved public/native video projection, with explicit outbound navigation and no implicit third-party fetch. Complete ordinary-author UI and combined preparation/recovery compatibility; cooperative locks are unit-tested here, not an actual combined-parent browser pass. Add floor-plan assets through the bounded decoder/metadata stripping/provenance path with explicit role/count semantics; videos and floor plans must not silently satisfy photo minimum. Complete the maintained media/browser matrix before closing06-4. Then07-6 favourites/account and08-7 audit remain priorities.

Exact-replay button, browser access-loss/refusal, reviewer/public/native video, provider playback, floor-plan bytes, physical device/AT/operator UAT, hosted concurrency/restart, production configuration/schema rollout and cutover were not accepted here. Source preservation and private dashboard publication are recorded separately at291/292. KES10,000 total monthly/realtor; no application GitHub push/Actions, spending/credits/plan, vendor resource or old-live-system change.
