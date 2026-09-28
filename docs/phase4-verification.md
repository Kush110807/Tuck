# Phase 4 confirmed repairs — verification record

Date: 28 September 2026 (IST).

**Role:** master implementer performing confirmed repairs. This is not an independent audit.

**Candidate classification:** **repaired candidate — verification incomplete**.

## 1. Provenance

| Evidence | Result |
|---|---|
| Required Phase 2 starting commit | **PASS** — `9ab9be28d70c66235a2aabd287b87ed5c1c9a568` |
| Phase 2 candidate ZIP SHA-256 | **PASS** — `ae44024f18710ad9e65396c0bf7a370f64342e0e1f9e6ad3dfb8440a7d0e22d2` |
| Phase 3 audit ZIP SHA-256 | **PASS** — `4b8b9290e8c6b7a28d915a2c96e4bf5f4dee72e87423a125310c6af03a45a7e2` |
| Repair branch | `phase4-confirmed-repairs`, created from the exact audited commit |
| Original audit evidence | Preserved byte-for-byte at `docs/evidence/Tuck_Phase3_Independent_Audit_9ab9be2.zip` |
| Phase 4 dependency changes | **None** |

The original Phase 3 evidence remains unmodified. In particular, its `audit-core-scenarios.js` intentionally treats the old Detail image failure and stale Editor behavior as expected reproduction outcomes. Its exit 0 is historical evidence only and is **not** counted as a repaired behavior pass.

## 2. Repair matrix

| Finding | Confirmed cause | Main changed files | Repair | Regression/reproduction evidence | Remaining limitation |
|---|---|---|---|---|---|
| **P3-01** | `initialize()` converted image cleanup/reconciliation/enumeration failures into `INIT_FAILED` before marking metadata ready. | `src/data/SQLiteItemRepository.ts`; `tests/data/SQLiteItemRepository.initialization.test.ts` | DB open/migrate/`PRAGMA quick_check` and database failures reading/writing maintenance metadata remain fatal. Physical cleanup failures stay queued. Filesystem-only enumeration/reconciliation failures are recoverable; reconciliation stays pending for retry and never deletes without first obtaining the complete DB reference set. | Original source reproduced enumeration failure => `INIT_FAILED` + blocked list. Repaired actual repository source with mocked Expo boundary: **3/3 PASS** (recoverable enumeration + later retry; real integrity failure still blocks; cleanup-queue SQLite failure still blocks). Committed Vitest regression added. | Needs Expo SQLite/FileSystem/native Android execution once dependencies/build are available. |
| **P3-02** | `resolveImageState()` propagated non-missing image errors, causing Detail/Editor to become whole-screen failures. | `src/contracts/index.ts`; `src/controllers/helpers.ts`; `src/controllers/detailController.ts`; `src/controllers/editorController.ts`; `src/ui/**` image consumers | Added `ImageViewState.unavailable { error }`. Metadata screens stay ready; Editor has image-only retry, Detail retries refresh; missing remains distinct; draft/reference preserved. | Original audit core reproduced Detail `kind:'failed'`. Repaired core scenarios: Detail degradation/retry and Editor degradation/draft-preserving retry **PASS**; committed Detail/Editor tests include `OPEN_FAILED`, ordinary missing and recovery. | Native renderer/storage error varieties still require phone verification. |
| **P3-03** | Adapter requested media-library permission before launching the system library picker and returned `PERMISSION_DENIED` without launching. | `src/controllers/adapters/expoImagePickerAdapter.ts`; `app.json`; `tests/controllers/adapters.test.ts` | Removed permission preflight for image-only system library selection. Cancellation remains normal; launch/provider failure maps to `PICKER_FAILED`. `app.json` disables unused camera/audio permission injection and blocks legacy Android `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE` permissions for this library-only flow. | Original source reproduced denied permission => launch count 0. Repaired adapter source: **3/3 PASS**, including denied/unused permission method not gating launch. | Android provider/OEM behavior and activity destruction are device checks. `getPendingResultAsync()` is not added; activity destruction remains an explicit stress-risk check rather than a seventh confirmed defect. |
| **P3-04** | Store trusted picker MIME/extension, did not inspect/decode actual bytes, rejected missing MIME, and UI had no render-error fallback. | `src/contracts/index.ts`; `src/domain/imageFormat.ts`; `src/domain/validation.ts`; `src/data/PersistentImageStore.ts`; `src/ui/components/imagePresentation.ts`; `ImagePickerField.tsx`; `ItemCard.tsx`; `DetailScreen.tsx`; related tests | MIME is optional/advisory. Store enforces actual 10 MiB size, detects JPEG/PNG/WebP byte identity, checks supplied MIME agreement, probes native `Image.getSize()` before and after copy, and UI handles `<Image onError>` with manual fallback/retry. Replacement ordering is unchanged; validation/copy failure occurs before metadata transaction. | Original source reproduced missing-MIME rejection and arbitrary bytes labeled JPEG being persisted. Repaired image-store source with mocked FS/decoder: **7/7 PASS**; committed format/store/render tests plus failed-replacement preservation test. | Byte recognition + RN decoder probe is not a complete independent codec parser. Native Android content-provider/decoder/render behavior must be verified on device. |
| **P3-05** | Missing edit item stayed on Editor missing state with no automatic safe return/feedback. | `src/controllers/editorController.ts`; `tests/controllers/editorController.test.ts` | Confirmed `NOT_FOUND` during initial load, save, or conflict refresh sets missing state, publishes one informational Inbox notice and returns to Inbox once. `DB_FAILED` remains an Editor failure. | Original audit core reproduced `{kind:'missing'}` with zero navigation calls. Repaired scenarios cover initial and save-time disappearance; committed tests also distinguish DB failure. **PASS** at controller layer. | Native navigation transition/back-stack behavior still needs phone/native-stack verification. |
| **P3-06** | `availableTags` was derived only from already-filtered rows, so selected tag vanished when another criterion produced zero rows. | `src/controllers/listControllers.ts`; `tests/controllers/listControllers.test.ts` | Controller remembers observed normalized display labels and retains only the currently selected known tag in `availableTags` during zero-match states. Clear action removes the tag normally. Query semantics unchanged. | Original controller reproduced active `tagKey:'study'` with `availableTags:[]`. Repaired scenario retains `Study`, clears it, then recovers rows. **PASS**. | Persistence of filter UI across full route reconstruction remains governed by normal route/controller lifetime and needs native journey confirmation. |

## 3. Original-defect reproduction

The exact audited commit was checked out in a separate detached Git worktree. No repair source was copied into it.

- **P3-01:** executed the original `SQLiteItemRepository` source with a mocked Expo boundary where image enumeration fails. Result: `initialize()` returned `INIT_FAILED`, then metadata `list()` remained blocked.
- **P3-02 / P3-05:** executed the preserved independent `audit-core-scenarios.js`. It reported the original Detail image-resolution error as whole-screen `failed` and stale edit target as `missing` with no navigation. Its successful exit is intentionally **not** a repair assertion.
- **P3-03:** executed the original picker adapter source with denied media permission. Result: `PERMISSION_DENIED`; picker launch was not called.
- **P3-04:** executed the original picker/store source. Missing MIME was rejected; arbitrary non-image bytes labeled `image/jpeg` were accepted and copied with `.jpg` extension.
- **P3-06:** executed the original list controller. With active `tagKey:'study'` plus zero-match text, the query still held `study` but `availableTags` became empty.

The authoritative original audit artifact is preserved at `docs/evidence/Tuck_Phase3_Independent_Audit_9ab9be2.zip`. Concise reproduction and repaired-source execution logs are preserved under `docs/evidence/phase4/`; the portable corrected assertions remain the committed tests under `tests/**`.

## 4. Regression evidence — repaired source

### 4.1 Dependency-free production TypeScript

Executed with system TypeScript `5.8.3` over actual production contracts/domain/core controller files, with no replacement typings or source stubs:

**PASS**.

All project TypeScript/TSX source and test files were syntax-transpiled with the same compiler after the final source repair: **PASS — 68/68**.

### 4.2 Repaired controller scenarios

Executed against compiled repaired production controllers plus the committed controller mocks:

**PASS — 10/10**:

1. Detail `OPEN_FAILED` degrades to image-unavailable while retaining metadata, then retry recovers.
2. Editor image resolution failure retains metadata/draft/stored path; image-only retry recovers.
3. Initial edit `NOT_FOUND` returns to Inbox once with one notice.
4. Save-time `NOT_FOUND` returns to Inbox without false save success.
5. Second concurrent modification before confirmed overwrite preserves draft and requires another confirmation (`expectedUpdatedAt` sequence 100 → 200 → 300).
6. Selected tag remains visible/clearable during zero matches.
7. Duplicate Save is guarded.
8. Stale old-query image resolution cannot replace a newer query.
9. Mailbox feedback is one-shot while focus still refreshes.
10. Duplicate archive/delete and pending Back guards remain effective.

### 4.3 Repository startup boundary

Executed the actual repaired `SQLiteItemRepository.ts` source with a mocked Expo SQLite/image-store boundary:

**PASS — 3/3**:

- recoverable image enumeration failure does not block initialization/list; later retry reconciles the orphan;
- SQLite integrity failure still returns `INIT_FAILED`, blocks list access, and does not attempt image maintenance;
- SQLite failure while reading the cleanup queue remains fatal and does not fall through to filesystem enumeration.

This is a **mocked Expo boundary test**, not a real Expo SQLite test.

### 4.4 Image validation

Executed the actual repaired `PersistentImageStore.ts` source with a mocked Expo filesystem and injected decoder:

**PASS — 7/7**:

- valid PNG with missing MIME accepted by byte detection + decoder;
- MIME/byte mismatch rejected;
- truncated/corrupt bytes rejected;
- signature-valid input rejected when native decoder probe fails;
- actual 10 MiB+ size rejected before decode/copy.

This does not prove Android provider/decoder behavior.

### 4.5 Picker adapter

Executed the actual repaired picker adapter source:

**PASS — 3/3**:

- denied/unused media permission function does not gate launch;
- cancellation is `cancelled`;
- provider launch error is `PICKER_FAILED`.


### 4.6 Stored render fallback

Executed the pure production `imagePresentation.ts` rule without React Native dependencies:

**PASS — 2/2**:

- an available stored URI becomes a `render-failed` fallback only after a renderer error;
- ordinary `missing` and resolution `unavailable` remain distinct fallback reasons.

Actual `<Image onError>` delivery remains a native React Native/device check.

### 4.7 Image mutation ordering

Executed the actual repaired `SQLiteItemRepository.ts` source with mocked SQLite/image-store boundaries:

**PASS — 4/4**:

- replacement copies the new image before queuing/changing metadata and removes the old image only after commit;
- failed replacement validation/copy leaves old metadata/reference/file untouched;
- failed DB commit cleans the new copy and does not remove the old file;
- delete queues the old image with metadata mutation before physical removal.

This remains mocked-boundary evidence, not native Expo SQLite/FileSystem proof.

## 5. Committed regression coverage

The project test suite now contains explicit regressions for:

- recoverable startup enumeration failure + later reconciliation;
- fatal DB integrity failure;
- Detail/Editor `OPEN_FAILED`, missing image and successful retry;
- no picker permission gate, minimized Android manifest permissions, and missing MIME metadata;
- JPEG/PNG/WebP byte detection and native decoder probing;
- mislabeled/truncated/decoder-rejected/oversized image selection;
- failed replacement preserving old image/metadata ordering;
- stored-image render-error fallback;
- initial and save-time disappeared edit target, plus non-`NOT_FOUND` DB failure;
- second conflict before confirmed overwrite;
- active selected tag through zero matches;
- existing duplicate mutation, stale-response, mailbox/focus and missing-image metadata coverage.

These committed Vitest tests are **NOT YET EXECUTED under Vitest** because the dependency installation is blocked.

## 6. Canonical dependency-backed commands

A single bounded clean online install was attempted after the repair work. The execution environment transport timed out before npm completed. The same online attempt was not repeated. One offline check then identified the first missing lockfile artifact.

| Command | Actual result | Classification |
|---|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund` | execution-environment transport timeout before dependency restoration | **BLOCKED** |
| `npm ci --offline --ignore-scripts --no-audit --no-fund` | exit 1, `ENOTCACHED` for `zod-3.25.76.tgz` | **BLOCKED** |
| `npm run typecheck` | exit 2; `expo/tsconfig.base` and Node/React/RN typings unavailable because dependencies are absent | **BLOCKED** |
| `npm test` | exit 127; `vitest: not found` | **BLOCKED** |
| `npm run export:android` | exit 127; `expo: not found` | **BLOCKED** |
| `npx --offline expo install --check` | exit 1; Expo package not cached (`ENOTCACHED`) | **BLOCKED** |

No lockfile regeneration, typing stub, test removal, or contract weakening was used to force a pass.

## 7. Source/Git/hygiene checks

Final packaging must rerun and record:

- required starting commit remains an ancestor;
- clean worktree;
- `git fsck --full`;
- `git diff --check`;
- package/lockfile root dependency maps still match;
- production graph contains no preview/fixture seeding;
- presentational UI contains no persistence/picker/browser/navigation API imports;
- no tracked credentials, `.env`, keystore, signing material, dependency tree, build caches, or generated native folders.

The final external handoff records the exact packaged Git SHA and ZIP SHA-256 because a Git commit cannot reliably contain its own final hash.

## 8. Native/APK/device status

- Android JavaScript export: **BLOCKED** by dependency installation.
- Native Android build/APK: **NOT RUN**; no local Android SDK/EAS authenticated build route is available in this environment.
- APK install: **NOT RUN**.
- Physical Android verification: **NOT RUN**; phone is available from the user, but model/Android version/build identity/results are pending.

Use `docs/qa-plan.md` for the exact phone matrix and `docs/independent-rereview-handoff.md` for separate re-review.

## 9. Device-discovered repair NEW-01 — persistent Inbox create affordance

A physical-device pass against the prior repaired candidate `b1f0dba85a1cb278785776441a40ed33f6dfad6b` on **Motorola Edge 40 / Android 15** found one additional release-blocking production defect after the P3-01..P3-06 source repairs.

### Prior-device evidence on `b1f0dba...`

**PASS:** cold launch; reopen after closing; create first item; edit/save; dirty-editor discard confirmation; archive; restore; search; no-results state; image display/persistence; persistence after restart.

**FAIL — NEW-01:** after the first active item existed, Inbox no longer displayed any Add/New-item control. The same absence occurred under Notes and Images. Archiving the only active item made the empty-state create controls visible again.

### Root cause

`src/ui/screens/InboxScreen.tsx` supplied the three create buttons only through `ListScreenView.emptyAction`. `ListScreenView` renders `emptyAction` solely when the list is `ready`, has zero rows, and has no active filters. Creation was therefore accidentally coupled to the unfiltered empty state even though `InboxScreenProps.onAdd(type)` and `InboxController` remained valid in every list state.

### Repair

The existing Add note / Add link / Add image buttons now render in Inbox's always-present `headerActions` area alongside Archive. The empty-state-only placement was removed. No shared contract change was required.

This keeps the general creation path visible independently of:

- zero, one, or many active items;
- All / Notes / Links / Images filters;
- search or tag filters, including zero-match states;
- loading/refresh, failed-load-with-previous-rows, feedback and normal list rendering.

### Regression evidence

Committed regressions:

- `tests/ui/InboxScreen.createAffordance.test.ts` guards the exact production wiring: all three create controls are in the unconditional header path and are not passed through `emptyAction`.
- `tests/controllers/listControllers.test.ts` now verifies create navigation before the first row, after an active item is present, and under All / Notes / Images filters including a zero-row Images result.

Supplemental dependency-free repaired-source checks executed after the change:

- **PASS** — UI source wiring: create controls are unconditional header actions rather than an empty-state action.
- **PASS** — compiled production `InboxController`: create path works with empty state, one active item, and All / Notes / Images query states.
- **PASS** — syntax transpile of `InboxScreen.tsx` and the two changed regression test files with system TypeScript 5.8.3.

The committed Vitest regressions have not yet executed under Vitest because the clean dependency installation remains blocked; see the command record below.

### Canonical command attempt after NEW-01 repair

A fresh online `npm ci --ignore-scripts --no-audit --no-fund` was attempted once. It made partial progress but hit the execution-environment transport timeout. An offline check then failed with `ENOTCACHED` for `zod-3.25.76.tgz`. The partial `node_modules` tree is excluded from the candidate.

| Command | Actual result | Classification |
|---|---|---|
| `npm run typecheck` | exit 2; `expo/tsconfig.base` and Node/React/RN type definitions unavailable in the incomplete dependency tree | **BLOCKED** |
| `npm test` | exit 127; `vitest: not found` | **BLOCKED** |
| `npm run export:android` | exit 127; `expo: not found` | **BLOCKED** |
| `npx expo install --check` | attempted; dependency/package resolution did not complete before the bounded execution timeout | **BLOCKED** |
| `git status --short` | empty after committed repair/docs changes; rerun again during ZIP verification | **PASS** |

### Required phone retest for NEW-01

Run on the exact new candidate/build identity:

1. Launch Inbox with zero active items and confirm Add note, Add link and Add image are visible.
2. Create and save item 1; return to Inbox and confirm the three create controls remain visible while item 1 is still active.
3. Immediately create and save item 2 without archiving item 1.
4. With active items present, switch through All, Notes and Images and confirm the general creation controls remain visible in every filter, including a zero-match Images/Notes state.
5. Apply search/tag criteria that yield no matches and confirm creation controls remain visible while Clear filters still behaves normally.
6. Recheck empty, loading/refresh, failure-with-previous-items, feedback and Archive entry behavior for visual/layout regressions.

This NEW-01 repair has **not yet been independently re-reviewed** and the new candidate has **not yet been phone-retested**.
