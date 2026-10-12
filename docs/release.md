# Deployment-preparation verification report

The competition app is based on branded commit `099825bbbaeee45a6f782f9093ca836284ea3b63`, whose parent is accepted final QA repair `5fb52f8665c4e69f6d38f23691a5fe6f2db9b85d`. Its accepted functionality and competitions paths are unchanged by this release-preparation branch.

## Release scope

- Current competition web path is **browser-local IndexedDB**; no account or cross-device sync.
- Current competition Android path is **device-local SQLite**; production background cloud sync is not active in the competition entry point.
- The repository's future Supabase/Auth/Sync code is preserved but not activated for judges.
- Deployed static web requires no developer-hosted localhost server. Android requires a signed standalone APK to become independent of Expo Metro.

## Evidence from this execution environment

| Check | Result | Basis |
|---|---|---|
| Recovered branded source SHA | PASS | ZIP repository HEAD exactly `099825bb…` |
| Confirm final QA parent/ancestor | PASS | Git history includes `5fb52f8…` |
| Existing repo source/asset integrity | PASS | `git fsck --full` |
| Dependency-free web-export verifier tests | **PASS (6/6)** | Node built-in test runner |
| Dependency-free domain strict TypeScript check | **PASS** | Global TypeScript 5.8.3; domain modules only |
| TypeScript/TSX syntax transpilation | **PASS (130 files)** | Global TypeScript 5.8.3; syntax only, not full project typecheck |
| Branding icon files | **PASS** | Six configured PNG files opened and dimensions inspected |
| Package/lockfile root dependency parity | **PASS** | Node comparison of dependencies and devDependencies |
| Forbidden production credential check | PASS | Tracked-file inspection; does not inspect external accounts |
| Canonical `npm ci` | BLOCKED | Registry unavailable and npm cache incomplete (`styleq@0.1.3`) |
| `npx expo install --check` | BLOCKED | Complete dependencies not installed |
| `npm run typecheck` | BLOCKED | Complete dependencies not installed |
| `npm test` | BLOCKED | Complete dependencies not installed |
| `npm run web:build` | BLOCKED | Expo not installed locally |
| `npm run web:verify` against real static output | NOT RUN | No actual Expo export available |
| `npm run export:android` | BLOCKED | Expo not installed locally |
| Native Android APK/EAS build | NOT RUN | Signing/build account and completed dependency installation unavailable |
| Physical device / browser QA against real release | NOT RUN | No installed APK or hosted build available here |
| GitHub Pages successful deployment | NOT VERIFIED | Requires GitHub Pages configuration and completed Actions run |
| Competition submission | NOT VERIFIED | Requires confirmation from competition portal |

**Do not interpret source-level PASS as evidence that the app was built, published, installed, or submitted.** Historical Phase 6D QA evidence was recorded on the accepted parent, but is not a fresh end-to-end release verification.

## On a connected build runner

```bash
npm ci
npm run release:check
npx expo install --check
npm run typecheck
npm test
npm run web:build
npm run web:verify -- dist-web /
npm run export:android
```

For GitHub Pages use `EXPO_PUBLIC_BASE_URL=/Tuck` for the web build, and verify with `npm run web:verify -- dist-web /Tuck` (PowerShell form in `docs/competition/WEB_DEPLOYMENT.md`).

To produce a **real standalone Android APK**, use the `preview` build profile in `eas.json` via authenticated Expo/EAS build and install/test its output. The JS export is **not** an APK.

## Ownership/licensing note

The existing `LICENSE` was inherited from Expo scaffolding and credits 650 Industries; it is not proof that Tuck's original application code is correctly licensed. The project owner must confirm public code-distribution terms before representing the repository as open source.

## Deployment and submission

Follow [web deployment](competition/WEB_DEPLOYMENT.md) and [submission checklist](competition/SUBMISSION_CHECKLIST.md). Record URLs, EAS build ID, source SHA, hashes, and actual test outcomes once obtained. Do not push `.env`, signing files, node_modules, private local data or verification caches.
