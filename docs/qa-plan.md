# Tuck Phase 2 QA plan and device checklist

This matrix belongs to the integrated candidate. Phase 3 must be executed independently by a reviewer who implemented none of A/B/C/master integration.

Status vocabulary:
- **PASSED** — actually executed and met the expected result.
- **FAILED** — actually executed and did not meet the expected result.
- **BLOCKED** — execution was attempted but an external/environment prerequisite prevented the intended check.
- **NOT RUN** — no execution evidence exists.

## Automated/source verification

| Check | Phase 2 status |
|---|---|
| Baseline SHA before integration is `1af6a69f6638e3c2fd26319efd253084e24760e0` | **PASSED** |
| A/B/C ZIP ownership matches reports | **PASSED** |
| A/B/C integrated as separate commits | **PASSED** |
| Production imports exclude preview/test fixtures | **PASSED** — final source scan before packaging found none |
| Supplemental strict TypeScript: contracts/domain/core controllers, no source stubs | **PASSED** |
| Supplemental runtime smoke: normalization + explicit conflict decision + cross-list revisit freshness | **PASSED** |
| `npm ci` from lockfile | **BLOCKED** — registry DNS/transport access failed and bounded online install timed out; offline install is `ENOTCACHED` for required tarballs |
| `npm run typecheck` with installed project dependencies | **BLOCKED** by dependency install |
| `npm test` including committed C + Phase 2 tests | **BLOCKED** by dependency install |
| `npm run export:android` | **BLOCKED** by dependency install / local Expo CLI unavailable |
| `npx expo install --check` / Expo Doctor | **BLOCKED** — installed tree/cache unavailable; offline commands return `ENOTCACHED` |
| Android native launch | **NOT RUN** |
| APK build/install | **NOT RUN** |
| Physical-phone matrix | **NOT RUN** |

Committed tests cover boot retry, list image states, stale search protection, one-shot mailbox behavior, dirty/discard, picker cancel/select, duplicate Save, explicit edit-conflict overwrite decision, missing edit/image states, archive/delete pending guards and conflicts, link-open failures, adapter mappings, domain trimming/normalization including Unicode limits, a Phase 2 archive/restore cross-list refresh flow, queued-cleanup resilience, replacement rollback, and image delete/replacement ordering. The new Vitest files are committed source coverage but remain **NOT EXECUTED under Vitest** until dependency restore succeeds.

## Physical Android phone setup

Record before testing:

- Git SHA: ____________________
- build/client identifier: ____________________
- phone model: ____________________
- Android version/API: ____________________
- install/launch method: Expo development client / Expo Go / APK / other: ____________________
- test date/time: ____________________

After dependency install succeeds, run `npm run typecheck` and `npm test`, then launch the exact same source revision. If using an APK, record its SHA-256 too.

## Core functional matrix

| Journey | Expected result | Status |
|---|---|---|
| First launch | Boot completes; real Inbox is empty; no fixture records appear | **NOT RUN** |
| Create note | Title/body/tags save once; Detail opens; completed Editor is absent from Back stack | **NOT RUN** |
| Create link | Valid explicit `http://` or `https://` URL saves; Open launches externally; invalid scheme is rejected | **NOT RUN** |
| Create image | JPEG/PNG/WebP selection copies into app storage; title/caption/tags persist | **NOT RUN** |
| Picker cancellation | Existing draft/image selection is unchanged and no error appears | **NOT RUN** |
| Image replacement | New image appears after save/relaunch; old file is not used by metadata | **NOT RUN** |
| Tags | Empty/duplicate normalized tags are not duplicated; max constraints show guidance | **NOT RUN** |
| Search | Normalized text search finds title/body/caption/URL/tag substring matches | **NOT RUN** |
| Combined filters | Search + type + tag + Inbox/Archive scope combine with AND | **NOT RUN** |
| View/edit note/link/image | Existing values load; one successful save updates Detail | **NOT RUN** |
| Duplicate Save | Rapid repeated Save causes one repository mutation/navigation outcome | **NOT RUN** |
| Edit conflict | Local draft remains unchanged; no retry/write occurs until explicit “Overwrite newer version”; cancel preserves draft | **NOT RUN** |
| Archive | Active item archives once, returns to Inbox, success shown once, item disappears there | **NOT RUN** |
| Restore | Archived item restores once, returns to Archive, success shown once, item disappears there | **NOT RUN** |
| Cross-list revisit | After archive/restore, both Inbox and Archive show current persisted state whenever revisited | **NOT RUN** |
| Delete | Confirmation required; confirmed delete happens once; returns to origin list with one-shot success | **NOT RUN** |
| Missing/stale ID | Detail/editor unavailable state is understandable and can return safely | **NOT RUN** |
| Missing image file | Metadata remains visible/editable/archiveable/deletable; image shown as missing | **NOT RUN** |
| Link-open failure | Error feedback appears; item data remains unchanged | **NOT RUN** |

## Back, lifecycle, persistence, and offline

| Check | Expected result | Status |
|---|---|---|
| Clean Editor Cancel/Android Back | Exits immediately | **NOT RUN** |
| Dirty Editor Cancel/Android Back | Keep editing / Discard confirmation appears | **NOT RUN** |
| Pending Save Back | Android Back/Cancel cannot escape while mutation is pending | **NOT RUN** |
| Pending archive/delete Back | Detail Back cannot race a confirmed mutation | **NOT RUN** |
| Force-close/relaunch | Items, edits, archive state, tags and copied images persist | **NOT RUN** |
| Airplane mode | Note/link/image local CRUD, search/filter, archive/restore/delete continue locally; external webpage may fail normally | **NOT RUN** |
| Reopen after cleanup failure | Metadata remains available; safe pending image deletion can retry later | **NOT RUN** |

## Accessibility/layout checks

| Check | Expected result | Status |
|---|---|---|
| Large font scale | Primary content/actions remain usable; important text is not forcibly single-line clipped | **NOT RUN** |
| Screen reader | Controls/states have understandable labels/roles; status/error announcements are useful | **NOT RUN** |
| Touch targets | Interactive controls meet the 44 pt target | **NOT RUN** |
| Narrow Android screen | No critical horizontal overflow; filters/tags/actions remain reachable | **NOT RUN** |

## Repository/image fault-injection targets for Phase 3

Where a test environment can safely simulate storage/DB failures, verify: create-copy + DB rollback cleanup; replacement copies new before commit and retains old record/file on failed commit; post-commit old-file cleanup failure stays queued; delete queues image before metadata commit and does not resurrect metadata on file-removal failure; interrupted/unreferenced app-owned files are reconciled only after successful DB initialization.
