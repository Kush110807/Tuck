# Phase 2 verification record

Date: 28 September 2026.

## Input integrity and Git checkpoints

| Evidence | Result |
|---|---|
| Baseline HEAD before integration | **PASSED** — `1af6a69f6638e3c2fd26319efd253084e24760e0` |
| Baseline working tree | **PASSED** — clean before handoff integration |
| Workstream A ZIP SHA-256 | **PASSED** — `3892f1ff1f037139e1ce97d4b71fee2cbea264d3fa833f1faa64ee072be45ffc` |
| Workstream B ZIP SHA-256 | **PASSED** — `68b34883c17955a3924e78801a412b476fde2710fd568b03ca51462e6e1777c2` |
| Workstream C ZIP SHA-256 | **PASSED** — `c34f4abc70a220768496c052a6a0c9005b1442b4d4bb064591640d6829d1ae0e` |
| A ownership | **PASSED** — only `src/ui/**` |
| B ownership | **PASSED** — only `src/domain/**`, `src/data/**` |
| C ownership | **PASSED** — only `src/controllers/**`, C tests, `docs/qa-plan.md` |
| A integration commit | `603f35835dd7e301fc9e6c38fcd182e2c7df670d` |
| B integration commit | `29bd3546fe915c9dbd5d755ed3dee935794d7937` |
| C integration commit | `2a5a7c9b741ff3aae36d9f1cc80268679ed95bfb` |
| Master production-wiring checkpoint | `46ffa34` (`Wire production services and controller navigation`) |

## Phase 2 source checks

| Check | Actual result |
|---|---|
| `git diff --check` | **PASSED** |
| Production scan for preview/fixture imports | **PASSED** — none found under `App.tsx` + production navigation/controllers/data/domain/UI screens/components |
| UI scan for direct persistence/picker/browser/navigation APIs | **PASSED** |
| Package vs lockfile dependency/devDependency versions | **PASSED** — exact root maps match; no dependency version changed in Phase 2 |
| Strict platform-neutral TypeScript check of contracts/domain/core controllers with `types: []` | **PASSED** |
| Supplemental runtime smoke: normalization + explicit conflict decision + cross-list revisit freshness | **PASSED** |

The supplemental TypeScript/runtime checks deliberately exclude React Native/Expo-dependent modules. They do not replace the canonical project checks below.

## Canonical project commands

| Command | Result |
|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund` | **BLOCKED** — registry tarball fetches failed with `EAI_AGAIN` (including `zod`, `yargs`, `yaml` and others); the final bounded retry also reached the integration timeout with no usable dependency tree |
| `npm ci --offline --ignore-scripts --no-audit --no-fund` | **BLOCKED**, exit `1` — `ENOTCACHED` for `https://registry.npmjs.org/zod/-/zod-3.25.76.tgz` |
| `npm run typecheck` | **BLOCKED**, exit `2` — dependencies absent; `expo/tsconfig.base` and Node/React/React Native type definitions cannot resolve |
| `npm test` | **BLOCKED**, exit `127` — `vitest: not found` because dependency restore is blocked |
| `npm run export:android` | **BLOCKED**, exit `127` — `expo: not found` because dependency restore is blocked |
| `npx --offline expo install --check` | **BLOCKED**, exit `1` — Expo package metadata is not available to npm in offline cache (`ENOTCACHED`) |
| `npx --offline expo-doctor` | **BLOCKED**, exit `1` — `expo-doctor` is not present in npm cache (`ENOTCACHED`) |

These are environment/package-access blockers, not converted into passes or hidden by test/type stubs.

## Dependency compatibility review

A source-level compatibility review against Expo's current official documentation was completed even though the CLI compatibility command is blocked:

- Expo SDK 57 maps to React Native `0.86`, React `19.2.3`, and Node `22.13.x` minimum; this project uses React Native `0.86.3`, React `19.2.3`, and was inspected under Node `22.16.0`.
- Current Expo references recommend `expo-sqlite ~57.0.3`, `expo-file-system ~57.0.7`, and `expo-image-picker ~57.0.20`, matching this project's declared package lines and lockfile resolutions.
- Expo's APK documentation confirms an EAS profile with `distribution: "internal"` and/or `android.buildType: "apk"` is an installable APK route; this repository's `preview` profile uses both.

This review is **not** a substitute for `npx expo install --check` / Expo Doctor against an installed dependency tree.

## Android/build evidence

- Java is available.
- `adb`, standalone Gradle, EAS CLI, and a local Android SDK were not found.
- `eas.json` requests an internal Android APK through `android.buildType: "apk"`.
- Native Android launch: **NOT RUN**.
- APK build: **NOT RUN**.
- APK install: **NOT RUN**.
- Physical Android phone tests: **NOT RUN**; phone availability is confirmed, but model/Android version/results are pending.

## Remaining mandatory rerun after package access is restored

```bash
npm ci
npm run typecheck
npm test
npm run export:android
npx expo install --check
```

Then build/install the exact candidate revision and execute `docs/qa-plan.md` before independent Phase 3 review.
