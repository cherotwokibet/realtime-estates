# Installed media dependency licence inventory

10 October 2026, Africa/Nairobi. **Local file inventory only; redistribution review remains open.** Sharp was not imported or executed for this review. No package was installed and no application/tracker file was changed. Decoder safety, production isolation, deployment compatibility and release acceptance are separate questions.

## Scope and exact sources

All paths below are relative to the exact installed checkout root `C:\Users\BONIFACE\OneDrive\Documentos\ChatGPT\RealEstate\realtor-platform\`. They identify files inspected on disk, not an upstream release or an independently reconstructed binary.

| Installed package | Version / declaration | Exact source paths under that root |
| --- | --- | --- |
| `sharp` | 0.35.5; `Apache-2.0`; Node >=20.9.0 | `node_modules/sharp/package.json`, `node_modules/sharp/LICENSE` |
| `@img/sharp-win32-x64` | 0.35.5; `Apache-2.0 AND LGPL-3.0-or-later` | `node_modules/@img/sharp-win32-x64/package.json`, `LICENSE`, `README.md`, `versions.json` in that same package directory |
| `@img/colour` | 1.1.0; `MIT` | `node_modules/@img/colour/package.json`, `node_modules/@img/colour/LICENSE.md` |
| `detect-libc` | 2.1.2; `Apache-2.0` | `node_modules/detect-libc/package.json`, `node_modules/detect-libc/LICENSE` |
| `semver` | 7.8.5; `ISC` | `node_modules/semver/package.json`, `node_modules/semver/LICENSE` |

The new media workspace implementer reports a direct default import from `sharp` plus Node built-ins, with no direct native-package import. Static inspection of `node_modules/sharp/package.json` resolves that ESM import to `dist/index.mjs`; the source imports `@img/colour`, `detect-libc` and `semver` through its module graph. `dist/sharp.mjs` contains the Windows x64 loader branch for `@img/sharp-win32-x64/sharp.node`; the installed native package's `index.cjs` points to `lib/sharp-win32-x64-0.35.5.node`. This establishes the installed candidate dependency graph, not an executed resolution trace. Other OS/Wasm optional dependencies and Sharp development dependencies were not treated as installed runtime dependencies. `@emnapi` was absent from this checkout's top-level `node_modules`.

`@img/colour/LICENSE.md` contains separate MIT copyright/permission notices for bundled `color`, `color-convert`, `color-string` and `color-name`. Its package metadata lists development inputs 5.0.3, 3.1.3, 2.1.4 and 2.1.0 respectively; those are recorded build inputs, not independently verified component versions in the bundled JavaScript. Node built-ins belong to the separately supplied Node runtime; this inventory does not review redistribution of Node or its bundled dependencies.

## Native bundle: distinct from Sharp's JavaScript licence

The native package contains `lib/sharp-win32-x64-0.35.5.node`, `lib/libvips-cpp-8.18.7.dll` and `lib/libvips-42.dll`. Its `LICENSE` file contains the Apache 2.0 text. Its **README also contains a third-party licensing table**, and its package declaration includes LGPL. No separate `NOTICE`, `COPYING`, LGPL licence text or individual codec licence files were present in the complete native-package file listing. Absence of those files is an inventory gap; it does not make their terms disappear.

The following versions are supplied by that installed package's `versions.json`; licence descriptions are the installed README's declarations, not independent determinations of every binary's licence or link composition.

| Bundled library (version-file key where different) | Recorded version | README licence description |
| --- | --- | --- |
| aom | 3.15.1 | BSD 2-Clause + Alliance for Open Media Patent License 1.0 |
| libarchive (`archive`) | 3.8.9 | BSD 2-Clause |
| cairo | 1.18.6 | Mozilla Public License 1.1 |
| cgif | 0.5.4 | MIT |
| libexif (`exif`) | 0.6.26 | LGPLv3 |
| expat | 2.8.5 | MIT |
| libffi (`ffi`) | 3.8.0 | MIT |
| fontconfig | 2.18.3 | fontconfig licence, BSD-like |
| freetype | 2.14.3 | freetype licence, BSD-like |
| fribidi | 1.0.17 | LGPLv3 |
| glib | 2.90.0 | LGPLv3 |
| harfbuzz | 14.5.0 | MIT |
| libheif (`heif`) | 1.23.5 | LGPLv3 |
| highway | 1.4.0 | BSD 3-Clause |
| libimagequant (`imagequant`) | 2.4.1 | BSD 2-Clause; README links a specific fork's COPYRIGHT |
| lcms | 2.19.1 | MIT |
| mozjpeg | 0826579 | zlib, IJG and BSD 3-Clause |
| pango | 1.58.2 | LGPLv3 |
| pixman | 0.46.4 | MIT |
| libpng (`png`) | 1.6.58 | libpng licence |
| proxy-libintl | 0.5 | LGPLv3 |
| librsvg (`rsvg`) | 2.63.2 | LGPLv3 |
| libtiff (`tiff`) | 4.7.2 | libtiff licence, BSD-like |
| libultrahdr (`uhdr`) | 2.0.2 | MIT |
| libvips (`vips`) | 8.18.7 | LGPLv3 |
| libwebp (`webp`) | 1.6.0 | New BSD |
| libxml2 (`xml2`) | 2.15.4 | MIT |
| zlib-ng | 2.3.3 | zlib |
| libnsgif | Not present in `versions.json` | MIT; named in README only |

The README states that its LGPLv3 use is through the “any later version” clause of LGPLv2 or LGPLv2.1. Limiting accepted input formats to JPEG/PNG/WebP does not establish that other bundled libraries are absent from a redistributed native package. Exact native linkage, matching source archives/build configuration and completeness of component attribution were not proved by reading these files.

## File identity

SHA-256 values below identify the exact local files read. These are reproducibility evidence, not signature/authenticity checks. Files may change when dependencies are reinstalled or another platform is selected.

| File under checkout root | SHA-256 |
| --- | --- |
| `node_modules/sharp/package.json` | `ad4a2535d72eb638053a38867b1abf43c328cd1c1dbae5cf4172d498365a8b97` |
| `node_modules/sharp/LICENSE` | `73ba74dfaa520b49a401b5d21459a8523a146f3b7518a833eea5efa85130bf68` |
| `node_modules/@img/sharp-win32-x64/package.json` | `697b3d89590e3b988b51764bd22dfd6f4a1b35cd4eb12c664eca7987e8ee6115` |
| `node_modules/@img/sharp-win32-x64/LICENSE` | `dc1f5d2d43c5531dfe0acaf4e950ea5dbe3e61e1850cf0e983bda7efc10d6693` |
| `node_modules/@img/sharp-win32-x64/README.md` | `3d083ada5ebafe1e6c227daa7b061d4254b61df4a3901c359ffdeac817ce5866` |
| `node_modules/@img/sharp-win32-x64/versions.json` | `e2611d5d854815a8b33c8a3d2ec649511a9596ccf16844e8eae7cf81e79881c4` |
| `node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.5.node` | `971048779f9c8598df14641dfc03c625885c93f473a788e65ca2deb50d0b083e` |
| `node_modules/@img/sharp-win32-x64/lib/libvips-cpp-8.18.7.dll` | `25001dbd05305a0a29119ab49933622c70b4a20ea12ef1d5d20ca40181db53bf` |
| `node_modules/@img/sharp-win32-x64/lib/libvips-42.dll` | `06dab07cc386748513337a31672b1d5269fbc770a14ff403080575665bf0813f` |
| `node_modules/@img/colour/LICENSE.md` | `e2eaa4603c14cb26f301e88648c12a853fa3f0f5da6d4b0972958c666e7f2ab8` |
| `node_modules/detect-libc/LICENSE` | `b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1` |
| `node_modules/semver/LICENSE` | `4ec3d4c66cd87f5c8d8ad911b10f99bf27cb00cdfcff82621956e379186b016b` |

## Remaining redistribution review

Before shipping any runtime/native bundle to a client or deployment artifact, inventory that exact platform artifact and collect the matching component copyright/licence texts and notices. Resolve the native package's LGPL/MPL components, matching source/build materials and applicable redistribution conditions for the actual distribution method; preserve the existing Apache/MIT/ISC and codec notices. The README's external links and version table alone are not a complete third-party notice/source package. Identify libnsgif's exact build version and reconcile any undocumented components. Repeat for Linux, managed transformations or another codec build rather than carrying over this Windows result.

No third-party component was re-licensed, no legal compliance conclusion was made and no production media/privacy/security gate was accepted by this inventory. The independently owned application can maintain its own source ownership while separately tracking the licences of its dependencies.
