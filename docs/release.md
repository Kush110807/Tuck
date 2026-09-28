# Phase 4 build and verification record

**Candidate classification:** repaired candidate — verification incomplete.

This document distinguishes source/mock evidence from dependency-backed Expo checks and from installed Android evidence.

## Environment inspected on 28 September 2026

- Node: `v22.16.0`
- npm: `10.9.2`
- system TypeScript available: `5.8.3`
- Java available
- `adb`: not available in this environment
- local Android SDK/standalone Gradle: not available
- EAS CLI/authenticated build access: not available here
- physical Android phone: user confirms availability; model/Android version/build identity/results remain pending

## Clean dependency attempt

One bounded online `npm ci --ignore-scripts --no-audit --no-fund` attempt was made after repairs. The container transport timed out before npm could complete and no usable `node_modules` tree was restored. The same online attempt was not repeated.

One offline lockfile install was then attempted and failed with `ENOTCACHED` for `https://registry.npmjs.org/zod/-/zod-3.25.76.tgz`.

Accordingly:

| Command | Phase 4 result |
|---|---|
| `npm ci` | **BLOCKED** — environment transport/package access |
| `npm ci --offline --ignore-scripts --no-audit --no-fund` | **BLOCKED**, exit 1 — `zod-3.25.76.tgz` not cached |
| `npm run typecheck` | **BLOCKED**, exit 2 — installed Expo/React/RN/Node typings/config absent after blocked install |
| `npm test` | **BLOCKED**, exit 127 — `vitest: not found` |
| `npm run export:android` | **BLOCKED**, exit 127 — `expo: not found` |
| `npx --offline expo install --check` | **BLOCKED**, exit 1 — Expo package not cached |

These blockers are not classified as application failures and are not replaced by production typing stubs.

## Supplemental repair verification

Without modifying production typings or dependencies, Phase 4 separately executed:

- dependency-free strict TypeScript over production contracts/domain/core controllers — **PASS**;
- syntax transpilation of all changed TypeScript/TSX files with the real system TypeScript compiler — **PASS**;
- repaired controller scenarios — **PASS 10/10**;
- `SQLiteItemRepository` startup-boundary scenarios against the actual repaired repository source with mocked Expo DB/filesystem boundary — **PASS 3/3**;
- `PersistentImageStore` validation scenarios against the actual repaired source with mocked Expo filesystem/native decoder boundary — **PASS 7/7**;
- repaired ImagePicker adapter scenarios — **PASS 3/3**;
- pure stored-image presentation recovery scenarios — **PASS 2/2**;
- mocked repository image copy/replace/delete ordering scenarios — **PASS 4/4**.

These are source/mock-layer evidence only. They do not prove Expo SQLite/FileSystem/ImagePicker behavior on Android and do not replace `npm test`.

## APK route

`eas.json` retains the internal APK profile. No APK was built here because package/EAS access and local Android build tooling are unavailable.

On an authorized machine/account:

```bash
npm ci
npm run typecheck
npm test
npm run export:android
npx expo install --check
npx eas-cli@latest build --platform android --profile preview
```

If the project is not yet linked to EAS, perform the project-link/init step locally. Keep Expo credentials, tokens, keystores and signing material out of chat and Git.

Record:

- exact source Git SHA;
- EAS/native build ID;
- APK SHA-256;
- phone model and Android version/API;
- install/launch result;
- full `docs/qa-plan.md` results.

A JavaScript export, Metro launch, or QR code is not an APK/native-install pass.

## Open gates before any submission-readiness decision

- successful lockfile dependency installation;
- canonical project typecheck;
- committed Vitest suite;
- Android JavaScript export;
- Expo installed-tree dependency check;
- native Android build/install;
- physical-phone functional/relaunch/offline/layout/accessibility matrix;
- independent re-review of P3-01 through P3-06 and adjacent journeys on this repaired source/build.
