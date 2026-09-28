# Tuck — BYTE App Development Stage 1

**Status: Phase 2 integrated candidate.** This revision integrates the Stage 1 UI, interaction controllers, SQLite repository, persistent app-owned image storage, production navigation, and native adapters. It is **not** a submission-ready release: the canonical dependency-backed checks, Android native launch/APK build, physical-phone matrix, and independent Phase 3 audit still require evidence where marked below.

## Stage 1 scope

Tuck is an Android-first, single-device save-for-later app for **notes, links, and images**. It includes Inbox, Editor, Detail, and Archive; text search; type and tag filters; create/view/edit/delete; archive/restore; external link opening; local SQLite persistence; and persistent copied image files.

Deliberately out of scope: login/authentication, backend/cloud sync, multi-device data, Share-menu intake, AI, notifications, and archive undo.

The production app starts empty. `src/preview/**`, `src/ui/previews/**`, `src/contracts/fixtureSpec.ts`, and `assets/fixtures/**` exist only for preview/test development and are not imported by production `App.tsx` or the production navigation graph.

## Architecture

Production startup creates exactly one shared data layer with `createTuckDataLayer()` and exactly one app-level `MutationMailbox`. `BootController` initializes SQLite before the navigator mounts. Screen wrappers keep controllers stable for a route, subscribe/unsubscribe to controller notifications, reread current props after each notification, and connect navigation focus to Inbox/Archive/Detail refresh.

- `src/ui/**` — presentational screens/components only.
- `src/controllers/**` — screen state, pending guards, picker/link adapters, stale-response handling, conflict/confirmation logic.
- `src/domain/**` — validation, normalization, matching rules.
- `src/data/**` — SQLite repository and app-owned image persistence.
- `src/navigation/**` — native-stack wiring, guarded Android Back integration, navigation actions, cross-screen mutation mailbox.

See [docs/architecture.md](docs/architecture.md) and [docs/CONTRACT_RULES.md](docs/CONTRACT_RULES.md).

## Pinned runtime

The lockfile pins the integrated Expo SDK 57 stack, including Expo `~57.0.25`, React Native `0.86.3`, React `19.2.3`, SQLite `~57.0.3`, FileSystem `~57.0.7`, and ImagePicker `~57.0.20`.

Use Node **22.13 or newer** for Expo SDK 57. The current integration environment used Node `22.16.0` and npm `10.9.2`.

## Fresh-checkout commands

```bash
npm ci
npm run typecheck
npm test
npm run export:android
npm start
```

`npm run export:android` is a JavaScript/static Expo export check. It is **not** an APK/native-build pass.

### Current Phase 2 verification status

As of 28 September 2026 in the integration environment:

- Baseline commit `1af6a69f6638e3c2fd26319efd253084e24760e0` was verified before integration.
- A, B, and C were integrated as separate commits before master integration fixes.
- A strict TypeScript check of the contracts/domain/core controllers using the system TypeScript compiler passed without production typing stubs.
- `npm ci` is currently **BLOCKED** by npm-registry network/DNS access; offline install is **BLOCKED** because the lockfile tarballs are not cached.
- Therefore canonical `npm run typecheck`, `npm test`, Expo dependency checks, and `npm run export:android` cannot be treated as passed until dependencies install successfully.
- Android native launch, APK build, and physical-phone testing are **NOT RUN**.

Exact command results are recorded in [docs/phase2-verification.md](docs/phase2-verification.md), build gates in [docs/release.md](docs/release.md), and the device matrix in [docs/qa-plan.md](docs/qa-plan.md).

## Run on the confirmed physical Android phone

After `npm ci` succeeds on a machine with network access:

1. Run `npm run typecheck` and `npm test` first.
2. Run `npm start` and open the project on the phone using an SDK-57-compatible Expo development client/Expo Go route available to that machine. Record the phone model and Android version before testing.
3. Exercise the complete checklist in `docs/qa-plan.md`, including all three create types, tags/search/combined filters, view/edit, archive/restore/delete, image replacement and picker cancellation, dirty-editor Android Back, force-close/relaunch persistence, and airplane-mode local operations.
4. Do not infer an APK or native-build pass from Metro or JavaScript export success.

## Installable APK route

`eas.json` already defines an internal `preview` profile with `android.buildType: "apk"`. This environment does not have usable EAS authentication/build access or a local Android SDK, so no APK is claimed.

On an authorized machine/account, keep credentials out of chat and Git, then:

```bash
npm ci
npx eas-cli@latest init          # only if this repo is not already linked to an EAS project
npx eas-cli@latest build --platform android --profile preview
```

Complete Expo login/credential prompts locally. Record the source SHA, EAS build ID, downloaded APK checksum, phone model/Android version, and installed-app results. If EAS is unavailable, use a properly configured Android SDK/Gradle machine instead.

## Important integration behavior

- Duplicate Save/archive/delete actions are synchronously blocked while pending.
- Stale list/image responses are generation-guarded; lists refresh whenever revisited.
- Mutation success feedback is one-shot through the shared mailbox.
- Edit conflicts preserve the exact local draft. Tuck fetches the latest timestamp but **does not overwrite automatically**; the user must explicitly choose “Overwrite newer version” before another write is attempted.
- Selected images are copied before metadata commit; replacement/deletion ordering and queued cleanup protect metadata/file consistency.
- Missing image files do not hide or disable the item's metadata operations.
- Local note/link/image text is trimmed consistently by the domain validator; tags/search use the same normalization rules.

## Phase 3

The next gate is an **independent reviewer who implemented none of A, B, C, or master integration**. Use [docs/phase3-reviewer-handoff.md](docs/phase3-reviewer-handoff.md). That reviewer owns `docs/independent-audit.md`; this Phase 2 handoff does not claim to perform that audit.
