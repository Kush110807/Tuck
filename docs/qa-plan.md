# Tuck Phase 4 repaired-candidate QA plan

**Candidate status:** repaired candidate — verification incomplete. This checklist is for the repaired revision and its independent re-review. Do not copy Phase 2/Phase 3 results onto a new build without rerunning them.

Status vocabulary: **PASS**, **FAIL**, **BLOCKED**, **NOT RUN**.

## Record identity before phone testing

- Git SHA: ____________________
- build/client ID: ____________________
- APK SHA-256 if applicable: ____________________
- phone model: ____________________
- Android version/API: ____________________
- install/launch method: ____________________
- test date/time: ____________________

## Focused NEW-01 retest — create another item

The prior repaired SHA `b1f0dba85a1cb278785776441a40ed33f6dfad6b` was exercised on **Motorola Edge 40 / Android 15**. It passed the recorded core journeys but failed because Inbox creation controls disappeared once an active item existed. The rows below must be rerun on the new repair SHA/build; do not carry the old device results forward.

| Check | Expected result | Status |
|---|---|---|
| Empty Inbox | Add note / Add link / Add image are visible | **NOT RUN** |
| Create item 1, return to populated Inbox | Same create controls remain visible while item 1 stays active | **NOT RUN** |
| Create item 2 immediately | Item 2 can be created/saved without archiving item 1 | **NOT RUN** |
| All / Notes / Images filters | General create controls remain visible under every type filter | **NOT RUN** |
| Search/tag zero-match state | Create controls remain visible and Clear filters remains available | **NOT RUN** |
| Narrow screen + large text | Create/header controls wrap/reflow without losing Archive or creation actions | **NOT RUN** |

## Focused P3 repair checks

| ID | Check | Expected result | Status |
|---|---|---|---|
| P3-01 | Start with valid DB but make app image-directory enumeration unavailable where fault injection permits | Boot/metadata remain usable; no deletion inferred from incomplete image listing; maintenance remains retryable | **NOT RUN** |
| P3-01 | Restore image storage and invoke/later trigger cleanup | Pending/skipped reconciliation can recover without harming referenced files | **NOT RUN** |
| P3-01 | Real DB open/migration/integrity failure | Boot remains failed with Retry; app does not fake an empty Inbox | **NOT RUN** |
| P3-02 | Stored image resolution returns non-missing failure | Detail and edit Editor retain title/caption/tags/actions/draft; show image-only degraded state | **NOT RUN** |
| P3-02 | Retry image after storage recovers | Image becomes available without changing stored reference or draft | **NOT RUN** |
| P3-02 | Physical image file absent | Metadata remains usable; image is specifically shown as missing | **NOT RUN** |
| P3-03 | Media permission denied/not granted, then choose image through system picker | Supported Android library picker still launches; no unnecessary broad permission gate | **NOT RUN** |
| P3-03 | Built manifest permission surface | No unused camera/audio or legacy broad external-storage permission is present in the standalone build for this library-only flow | **NOT RUN** |
| P3-03 | Cancel picker | Draft and existing image selection remain unchanged; no error | **NOT RUN** |
| P3-03 | Provider/picker launch failure | Useful image error; draft unchanged | **NOT RUN** |
| P3-04 | Valid JPEG, PNG and WebP | Accepted and saved when <=10 MiB and natively decodable | **NOT RUN** |
| P3-04 | Valid provider asset with unavailable MIME metadata | Content is inspected; supported decodable image is not rejected solely for missing MIME | **NOT RUN** |
| P3-04 | MIME/bytes mismatch; corrupt/truncated/non-image bytes | Rejected before metadata points to the new image | **NOT RUN** |
| P3-04 | Actual file >10 MiB | Rejected with image-specific guidance; draft remains | **NOT RUN** |
| P3-04 | Failed replacement validation/copy | Original image/reference/metadata remain unchanged | **NOT RUN** |
| P3-04 | Stored file later fails native `<Image>` decode/render | Fallback appears; metadata/actions remain; manual retry available; no automatic retry loop | **NOT RUN** |
| P3-05 | Open edit route after item was deleted | Returns to Inbox once with explanatory feedback | **NOT RUN** |
| P3-05 | Item disappears after Editor loaded, then Save | No success/Detail navigation; returns once to Inbox with feedback | **NOT RUN** |
| P3-05 | Transient DB failure while editing | Remains in Editor with failure; not mistaken for deletion | **NOT RUN** |
| P3-06 | Select tag, then add search/type filter yielding zero rows | Selected tag remains visible and individually clearable | **NOT RUN** |
| P3-06 | Clear only selected tag, keep/clear other criteria as intended | Query updates normally and expected rows can recover | **NOT RUN** |

## Critical Stage 1 journeys

| Journey | Expected result | Status |
|---|---|---|
| First launch | Real empty Inbox, no fixture records | **NOT RUN** |
| Create note | Save once, open Detail, completed Editor absent from Back stack | **NOT RUN** |
| Create HTTP(S) link | Save/open externally; invalid scheme rejected | **NOT RUN** |
| Create image | Supported validated image copied into app storage; metadata persists | **NOT RUN** |
| Tags | NFKC/whitespace normalization, no duplicate normalized tags, limits enforced | **NOT RUN** |
| Search | Title/body/caption/URL/tag substring matching | **NOT RUN** |
| Combined filters | Search + type + tag + archive scope use AND | **NOT RUN** |
| Deterministic order | `updatedAt DESC`, then ID ascending for ties | **NOT RUN** |
| Edit note/link/image | Existing values load; one save updates Detail | **NOT RUN** |
| Duplicate Save | Rapid taps produce one write/navigation outcome | **NOT RUN** |
| Conflict | Local draft preserved; no write before explicit overwrite choice | **NOT RUN** |
| Second conflict | Another server change before confirmed overwrite requires another confirmation; draft stays | **NOT RUN** |
| Archive | One mutation; return Inbox; success once; item no longer in Inbox | **NOT RUN** |
| Restore | One mutation; return Archive; success once; item no longer in Archive | **NOT RUN** |
| Revisit both lists | Persisted state is current whenever focused | **NOT RUN** |
| Delete | Explicit confirmation; one deletion; return origin with one success | **NOT RUN** |
| Link-open failure | Error feedback only; saved data unchanged | **NOT RUN** |

## Image/file ordering fault injection

Where safely testable, verify:

- new image copy/validation completes before metadata commit;
- failed create DB transaction cleans or queues new orphan;
- replacement copies/validates new first, transactionally updates reference + queues old, removes old only after commit;
- failed replacement before/at commit leaves original item/image intact and cleans/queues only the new orphan;
- delete queues image within metadata transaction and removes physical file only after commit;
- failed physical cleanup stays queued and does not resurrect metadata;
- reconciliation never deletes a referenced path and does not act on an incomplete reference/enumeration result.

## Android Back, lifecycle, persistence, offline

| Check | Expected result | Status |
|---|---|---|
| Clean Editor Android Back/Cancel | Exits immediately | **NOT RUN** |
| Dirty Editor Android Back/Cancel | Keep editing / Discard prompt | **NOT RUN** |
| Pending Save Back | Cannot escape/race mutation | **NOT RUN** |
| Pending archive/delete Back | Cannot race confirmed mutation | **NOT RUN** |
| Force-close/relaunch | Items/edits/archive/tags/copied images persist | **NOT RUN** |
| Airplane mode | All local CRUD/search/filter/archive/delete continue; external web may fail normally | **NOT RUN** |
| Image picker activity destruction stress | Enable Android developer option “Don’t keep activities” or equivalent stress; select image and record result/recovery | **NOT RUN** — additional lifecycle risk, not one of P3-01..P3-06 |

For the activity-destruction stress check, Expo documents `getPendingResultAsync()` as the recovery mechanism when Android kills `MainActivity`. Tuck does not currently claim this recovery path; record actual behavior rather than converting this known coverage risk into an assumed pass/fail of the six confirmed repairs.

## Layout/accessibility

| Check | Expected result | Status |
|---|---|---|
| Narrow Android screen | No critical overflow; filters/tags/actions reachable | **NOT RUN** |
| Keyboard | Editor fields/Save/Cancel remain reachable; no trapped controls | **NOT RUN** |
| Large text/font scale | Important content/actions remain usable and reflow | **NOT RUN** |
| TalkBack | Labels/roles/status/error reading order understandable | **NOT RUN** |
| Touch targets | Interactive controls meet 44 pt target | **NOT RUN** |

## Build/install gate

Before treating phone results as candidate evidence, record the exact same source revision used for:

```bash
npm ci
npm run typecheck
npm test
npm run export:android
npx expo install --check
```

If building APK through EAS:

```bash
npx eas-cli@latest build --platform android --profile preview
```

Record build ID and APK checksum. Do not treat JavaScript export, Metro startup or QR rendering as native build/install verification.
