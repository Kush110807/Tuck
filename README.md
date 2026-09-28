# Tuck — BYTE App Development Stage 1

**Status: Phase 4 repaired candidate — verification incomplete.** This revision starts from the independently audited Phase 2 commit `9ab9be28d70c66235a2aabd287b87ed5c1c9a568` and repairs findings P3-01 through P3-06. It is **not** declared submission-ready: clean dependency-backed project checks, an Android native build/install, physical-phone verification, and an independent re-review of this repaired revision still require evidence.

## Stage 1 scope

Tuck is an Android-first, single-device save-for-later app for **notes, links, and images**. It includes Inbox, Editor, Detail, and Archive; text search; type and tag filters; create/view/edit/delete; archive/restore; external link opening; local SQLite persistence; and persistent app-owned image files.

Deliberately out of scope: login/authentication, backend/cloud sync, multi-device data, Share-menu intake, AI, notifications, and archive undo.

The production app starts empty. Preview modules and fixture data remain test/development-only and are not imported by the production graph.

## Architecture

Production startup creates one shared `createTuckDataLayer()` and one app-level `MutationMailbox`. `BootController` initializes the metadata repository before navigation mounts. Screen wrappers keep controllers stable for a route, subscribe/unsubscribe to controller notifications, reread controller props after each notification, and connect focus to Inbox/Archive/Detail refresh.

- `src/ui/**` — presentational screens/components and render fallbacks.
- `src/controllers/**` — screen state, pending guards, picker/link adapters, stale-response handling, conflict/confirmation logic.
- `src/domain/**` — validation, normalization, search rules, supported-image byte-format detection.
- `src/data/**` — SQLite repository and app-owned image persistence/validation.
- `src/navigation/**` — native-stack wiring, guarded Android Back integration, navigation actions, one-shot mutation mailbox.

See `docs/architecture.md`, `docs/CONTRACT_RULES.md`, and `docs/phase4-verification.md`.

## Phase 4 repair summary

The repaired candidate addresses all six independent findings without adding deferred features:

1. **P3-01 — startup maintenance boundary:** SQLite open/migration/integrity failures and database failures in maintenance metadata remain fatal. Physical cleanup failures stay queued, while filesystem-only image enumeration/reconciliation failures no longer block otherwise readable metadata. Skipped reconciliation remains pending for bounded retry.
2. **P3-02 — image-resolution degradation:** Detail and edit Editor retain metadata/draft/actions when image resolution itself fails. A distinct `unavailable` image state carries the error and supports retry. Ordinary `missing` remains separate.
3. **P3-03 — picker permission gate:** Android/system image-library launch no longer requests media-library permission as a prerequisite. Cancellation remains distinct from provider/launch failure. The app config also disables unused camera/audio permission injection and blocks legacy broad external-storage permissions for this library-only flow.
4. **P3-04 — image validation/render recovery:** picker MIME metadata is advisory/optional. The store checks actual bytes for JPEG/PNG/WebP identity, enforces the actual 10 MiB limit, probes the native image decoder before returning a persistent reference, and adds `Image.onError` fallbacks for later rendering failures. Failed replacement still leaves the old item/image intact.
5. **P3-05 — disappeared edit target:** confirmed `NOT_FOUND` during initial edit load, conflict refresh, or save returns once to Inbox with explanatory one-shot feedback; transient DB failures do not take that path.
6. **P3-06 — active tag visibility:** an already-selected tag remains visible and individually clearable even when another AND-combined criterion yields zero rows.

The prior explicit edit-conflict behavior is preserved: the local draft is not silently rebased or retried, and a second concurrent modification requires another explicit overwrite confirmation.

## Image validation boundary

Tuck now validates supported selections in layers:

- actual file size is checked against 10 MiB;
- actual bytes must identify as JPEG, PNG, or WebP rather than relying on MIME/extension;
- if the picker supplied a supported MIME value, it must agree with detected bytes;
- React Native's native image decoder is probed with `Image.getSize()` before the persistent path is accepted;
- the rendered `<Image>` also has `onError` fallback so a stored file that later becomes unreadable does not hide metadata or loop retries.

This is a proportionate pre-commit validation strategy, not a claim to implement a full independent image codec/parser. Exact Android content-provider behavior and decoder/render parity remain native-device verification items.

## Pinned runtime

The manifest/lockfile still use the Phase 2 Expo SDK 57 stack: Expo `~57.0.25`, React Native `0.86.3`, React `19.2.3`, SQLite `~57.0.3`, FileSystem `~57.0.7`, and ImagePicker `~57.0.20`. **No new dependency was added for Phase 4.**

Use Node 22.13 or newer for Expo SDK 57. The Phase 4 environment used Node `22.16.0` and npm `10.9.2`.

## Fresh-checkout verification commands

```bash
npm ci
npm run typecheck
npm test
npm run export:android
npx expo install --check
```

`npm run export:android` is a JavaScript/static Expo export check. It is **not** a native APK/install pass.

### Current Phase 4 verification status

- Phase 2 candidate ZIP identity and embedded starting commit were verified before repairs.
- Repair source and regression coverage are committed on a repair branch descended directly from the required starting commit.
- Supplemental dependency-free production TypeScript for contracts/domain/core controllers passed with system TypeScript 5.8.3 and no production typing stubs.
- Supplemental repaired-source execution passed controller, startup-boundary, image-validation, and picker scenarios; exact counts and limits are in `docs/phase4-verification.md`.
- Clean online `npm ci` is **BLOCKED** by the execution environment transport timeout. One offline install check is **BLOCKED** with `ENOTCACHED` for `zod-3.25.76.tgz`.
- Because the dependency tree is absent, canonical `npm run typecheck`, `npm test`, `npm run export:android`, and `npx expo install --check` are **BLOCKED**, not passed.
- Android native launch, APK build/install, and physical-phone tests are **NOT RUN**.

## Phone verification

Once package/build access is available, use the exact packaged repair commit and complete `docs/qa-plan.md`. Record source SHA, build/client ID, phone model, Android version, and each result. Focused Phase 4 checks include image-storage startup degradation/recovery, image-resolution retry, permission-denied/system-picker behavior, content validation, render fallback, disappeared edit targets, active-tag zero-match recovery, and Android activity destruction during image selection.

## APK route

`eas.json` defines an internal Android APK profile. On an authorized machine/account, keep credentials/signing material local and run:

```bash
npm ci
npm run typecheck
npm test
npm run export:android
npx expo install --check
npx eas-cli@latest build --platform android --profile preview
```

If the repo is not linked to an EAS project, initialize/link it locally first. Do not treat Metro or a JavaScript export as a native-build pass.

## Independent re-review

Use `docs/independent-rereview-handoff.md` in the existing Phase 3 review context. The original audit evidence is preserved byte-for-byte at `docs/evidence/Tuck_Phase3_Independent_Audit_9ab9be2.zip`; its SHA-256 is recorded in the Phase 4 verification document. The original `audit-core-scenarios.js` intentionally asserted the old broken behavior for two findings and must **not** be counted unchanged as a repair pass.
