# Phase 2 build and verification record

This document records what is and is not proven for the integrated candidate. A JavaScript export, TypeScript pass, unit test pass, native build, APK install, and phone journey are separate gates.

## Environment inspected on 28 September 2026

- Node: `v22.16.0`
- npm: `10.9.2`
- Git: `2.47.3`
- Java: OpenJDK `21.0.11`
- `adb`: not found
- standalone `gradle`: not found
- EAS CLI: not found
- local Android SDK environment variables/common SDK directories: not found
- physical Android phone: user confirms one is available; model, Android version, and test results are still pending

## Dependency-backed verification

Required fresh-checkout sequence:

```bash
npm ci
npm run typecheck
npm test
npm run export:android
npx expo install --check
npx expo-doctor
```

Observed in this integration environment:

- `npm ci --ignore-scripts --no-audit --no-fund` — **BLOCKED**: npm-registry DNS/transport access failed; the bounded online attempt timed out without restoring a usable dependency tree.
- `npm ci --offline --ignore-scripts --no-audit --no-fund` — **BLOCKED**, exit `1`: required lockfile tarball `zod-3.25.76.tgz` is not cached (`ENOTCACHED`).
- `npm run typecheck` — **BLOCKED by dependency restore**: local dependency tree is absent/incomplete, so Expo config and React/React Native/Node typings cannot resolve. This is not a source pass.
- `npm test` — **BLOCKED**, exit `127`: `vitest: not found` because the dependency tree is absent.
- `npm run export:android` — **BLOCKED**, exit `127`: `expo: not found` because the dependency tree is absent.
- `npx --offline expo install --check` — **BLOCKED**, exit `1`: npm reports `ENOTCACHED` for Expo.
- `npx --offline expo-doctor` — **BLOCKED**, exit `1`; `expo-doctor` is not present in the npm cache (`ENOTCACHED`).

A separate strict TypeScript check over the contracts, domain code, and core controllers using the system `tsc` passed without weakening production contracts or adding source stubs. It is supplemental evidence only and does not replace the canonical project check.

## Compatibility review

The lockfile/application pins Expo `~57.0.25`, React Native `0.86.3`, React `19.2.3`, `expo-sqlite ~57.0.3`, `expo-file-system ~57.0.7`, and `expo-image-picker ~57.0.20`. Expo's current SDK reference maps SDK 57 to React Native 0.86 / React 19.2.3 with Node 22.13.x minimum. Current Expo SQLite, FileSystem, and ImagePicker references recommend `~57.0.3`, `~57.0.7`, and `~57.0.20` respectively, matching this project's package lines. This source-level review is **PASSED**; the installed-tree `npx expo install --check` remains **BLOCKED** and must still be rerun.

## Development-phone route

Once dependencies install:

```bash
npm start
```

Use an SDK-57-compatible Expo development client/Expo Go path supported on the phone and host, then execute `docs/qa-plan.md`. Record the exact source SHA, phone model, Android version, client/build identifier, and each result. If LAN discovery is unavailable, use the Expo-supported alternate connection mode rather than treating a QR display as a pass.

## APK route

`eas.json` contains:

```json
{
  "build": {
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" }
    }
  }
}
```

No APK was produced in this environment because EAS authentication/build access is not available here and no local Android SDK is configured. On an authorized machine/account:

```bash
npm ci
npx eas-cli@latest init        # only if an EAS project link is absent
npx eas-cli@latest build --platform android --profile preview
```

Keep Expo credentials and signing material local; do not paste passwords, tokens, keystores, or private signing data into chat or commit them. Record EAS build ID, source SHA, APK SHA-256, install result, phone model/OS, and device test matrix.

A configured local Android SDK/Gradle machine is the fallback if EAS is unavailable.

## Release gates still open

- canonical installed-dependency typecheck
- full committed Vitest suite, including controller/domain/integration tests
- Android JavaScript export
- Expo dependency compatibility check
- Android native build/APK
- physical-phone functional/relaunch/offline/accessibility matrix
- independent Phase 3 audit by a reviewer who implemented none of A/B/C/master integration
- repair/retest cycle for any Phase 3 findings

Until those gates have evidence, call this revision an **integrated candidate**, not a release or submission-ready build.
