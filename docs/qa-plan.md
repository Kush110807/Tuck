# Workstream C QA plan

Baseline verified before editing: `1af6a69f6638e3c2fd26319efd253084e24760e0`.

Status vocabulary is intentionally strict:
- **PASSED** — actually executed and met the expected result.
- **FAILED** — actually executed and did not complete or did not meet the expected result.
- **NOT RUN** — no execution evidence exists yet.

C may perform integration QA, but C is not the independent Phase 3 reviewer. Independent release evidence belongs in master-owned `docs/independent-audit.md` and must be produced by a reviewer who did not implement app code.

## Automated C coverage

| Area | Test intent | Current outcome |
|---|---|---|
| Boot | initialization failure remains blocking; Retry can reach ready | **NOT RUN** under Vitest; supplemental runtime scenario **PASSED** |
| Inbox list | image rows resolve to none/available/missing without hiding metadata | **NOT RUN** under Vitest; supplemental runtime scenario **PASSED** |
| Inbox list | a slower old search response cannot replace a newer query result | **NOT RUN** under Vitest; supplemental runtime scenario **PASSED** |
| Inbox list | mailbox notice is consumed once on focus; destination refreshes and exposes feedback | **NOT RUN** under Vitest; supplemental runtime scenario **PASSED** |
| Inbox list | Inbox enforces `archived: false` | **NOT RUN** under Vitest |
| Editor | dirty state, cancel, keep-editing and confirmed discard flow | **NOT RUN** under Vitest |
| Editor | picker cancellation leaves the draft unchanged; selection dirties the image draft and previews the temporary URI | **NOT RUN** under Vitest; supplemental runtime scenario **PASSED** |
| Editor | duplicate Save taps are synchronously guarded; notice/navigation occur only after repository success | **NOT RUN** under Vitest |
| Editor | timestamp conflict rebases untouched fields from the latest item, preserves touched fields and retries with the fresh timestamp | **NOT RUN** under Vitest; supplemental runtime scenario **PASSED** |
| Editor | missing edit target maps to `missing`; a missing image file still permits image metadata editing | **NOT RUN** under Vitest |
| Detail | missing image file yields ready metadata plus `image: missing` | **NOT RUN** under Vitest |
| Detail | delete requires confirmation, duplicate confirmation is guarded, and success publishes before returning to origin | **NOT RUN** under Vitest; supplemental runtime scenario **PASSED** |
| Detail | archive/restore pending state blocks duplicate mutation/back navigation; conflict refreshes latest data and retains failure feedback | **NOT RUN** under Vitest; pending-guard supplemental runtime scenario **PASSED** |
| Detail | failed external-link open is exposed as feedback | **NOT RUN** under Vitest |
| Native adapters | picker cancel/selection/permission outcomes and HTTP(S)-only external links | **NOT RUN** under Vitest; injected-adapter supplemental runtime scenario **PASSED** |

Test files are under `tests/controllers/**`; B is represented only by C-owned interface-level doubles under `tests/mocks/**`. The real master-owned `MutationMailbox` is used in the list focus handoff test. The adapter shapes were also reviewed against the official Expo SDK 57 ImagePicker reference and React Native 0.86 `Linking.openURL` reference; this is an API review, not device execution.

## Verification commands for this handoff

Run from the repository root after dependencies can be restored:

```bash
npm ci
npm run typecheck
npm test
```

Additional C-only static check used in this environment (temporary module declarations outside the repository stand in only for unavailable installed native packages):

```bash
tsc --noEmit -p /tmp/tuckc-test-tsconfig.json
```

Current environment result:
- `npm ci` — **FAILED**: online restore repeatedly hit npm registry DNS `EAI_AGAIN` and was interrupted before completion; a deterministic `npm ci --offline --no-audit --no-fund` retry also **FAILED** with `ENOTCACHED` for `zod-3.25.76.tgz`.
- `npm run typecheck` — **FAILED (environment/dependency restore)**: the command ran, but the incomplete install is missing `node`, `react`, `react-native` type definitions and `expo/tsconfig.base`. This is not evidence of a C source type error.
- `npm test` — **FAILED (environment/dependency restore)**: the command ran, but `vitest` is not installed because `npm ci` could not complete.
- `npx --offline expo lint` — **FAILED (environment/dependency restore)**: npm returned `ENOTCACHED` for `expo`; no lint execution occurred.
- C-only strict TypeScript check with temporary external-module stubs — **PASSED** for contracts + C source + C tests.
- Supplemental compiled C runtime smoke harness — **PASSED**: 9 scenarios covering boot retry, missing list images, stale query suppression, one-shot mailbox refresh, picker cancellation/selection, editor conflict rebase/retry, duplicate delete + pending Back guarding, duplicate archive + pending Back guarding, and picker/link adapter mapping. This is supplemental evidence, not a Vitest or device substitute.

The standard project commands must be rerun by master/integration once registry access is available. A green C-only check is not a substitute for the locked project toolchain.

## Physical Android phone QA matrix

The user has confirmed a physical Android phone is available, but model, OS version and installed-build evidence are still absent. Every row below is therefore **NOT RUN** for this handoff.

| Journey / condition | Expected result | Outcome |
|---|---|---|
| Install exact integrated build | Record source SHA, build ID/link/hash, phone model and Android version; app installs | **NOT RUN** |
| First launch / initialization | Boot remains blocking while initializing; init failure shows Retry; successful empty DB shows a genuine empty Inbox, not fixtures | **NOT RUN** |
| Create note | Save once, Detail opens, success feedback appears after destination focus, item survives force-close/relaunch | **NOT RUN** |
| Create link | Valid HTTP(S) link saves; Detail external-open launches browser; invalid URL remains a validation error | **NOT RUN** |
| Create image | System picker selects JPEG/PNG/WebP; saved image is app-owned and survives force-close/relaunch | **NOT RUN** |
| Picker cancellation | Cancel returns to unchanged editor; dirty state does not change solely because of cancellation | **NOT RUN** |
| Picker permission denial / native failure | Editor remains usable and shows picker error; no item is written | **NOT RUN** |
| Replace image | New image appears only after confirmed save; old-file cleanup behavior is verified through B/integration logs or inspection | **NOT RUN** |
| Missing image file | Item title/tags/caption remain visible in list/detail/editor with missing-image treatment | **NOT RUN** |
| Edit note/link/image | Existing data loads; changes save once; Detail refreshes on focus and shows success feedback | **NOT RUN** |
| Dirty Android hardware Back | Dirty Editor opens discard confirmation; Keep Editing stays; Discard exits; pending save blocks exit | **NOT RUN** |
| Archive | Active Detail archives once, returns to Inbox, Inbox refreshes and success feedback is shown | **NOT RUN** |
| Restore | Archived Detail restores once, returns to Archive, Archive refreshes and success feedback is shown | **NOT RUN** |
| Delete cancel | Request Delete opens confirmation; Cancel makes no repository change | **NOT RUN** |
| Delete confirm + rapid double tap | Exactly one delete reaches repository; after success return to originating list with feedback | **NOT RUN** |
| Save rapid double tap | Exactly one create/update reaches repository while mutation is pending | **NOT RUN** |
| Rapid search typing | Final visible rows always correspond to the newest query even if an older request completes later | **NOT RUN** |
| Combined search/type/tag filters | Text + type + tag + archived scope combine with AND and list remains deterministically sorted | **NOT RUN** |
| Timestamp conflict | Stale edit/archive/delete does not overwrite newer data; user gets conflict feedback and can act on refreshed/latest data | **NOT RUN** |
| List filter retention | Returning from Detail/Edit keeps mounted Inbox/Archive query/filter state where navigator preserves the list | **NOT RUN** |
| Mailbox one-shot feedback | Success feedback is delivered to the intended destination/item once and does not repeat on a later focus | **NOT RUN** |
| Link open failure | Native browser/open failure shows error feedback without changing item data | **NOT RUN** |
| Force-close/relaunch | Saved items, archive state and persistent images remain correct; no preview fixture data appears | **NOT RUN** |
| Offline / airplane mode | Local CRUD/search/archive still work without network dependency | **NOT RUN** |
| Large text / screen reader | A-owned labels remain understandable at large font scale; controls are announced; no controller action becomes inaccessible | **NOT RUN** |
| 44 pt touch targets | A-owned interactive controls meet the frozen UI target on the physical device | **NOT RUN** |

## Integration-specific checks

1. Master must create exactly one app-level `MutationMailbox` instance and inject that same instance into all C controllers. Creating a mailbox per screen breaks cross-screen delivery.
2. Keep Inbox and Archive controller instances mounted with their screens where navigation permits; recreating them discards query/filter state.
3. Master/A wrapper should subscribe to each controller with `controller.subscribe(...)`, trigger a React render on notification, then read the fresh `controller.props`. Do not cache a props snapshot indefinitely.
4. Call `BootController.start()` during app bootstrap and do not mount ready list content until boot reaches `ready`.
5. For an edit Editor, call `EditorController.load()` on first mount. Create mode is synchronously ready. Android hardware Back must call `EditorController.requestExit()` rather than bypassing dirty/pending handling.
6. Call Inbox/Archive/Detail `onFocus()` from navigation focus lifecycle. It consumes destination notices, refreshes only that destination when needed and exposes one-shot feedback.
7. Inject B's production `ItemRepository` and `ImageStore`; do not import C test doubles or master preview fixtures into production.
8. Inject `createExpoImagePickerAdapter()` and `createReactNativeLinkOpener()` in production. Native adapter behavior still requires installed-device verification.
9. After A + B + C are integrated, rerun `npm ci`, `npm run typecheck`, `npm test`, then the phone matrix against the exact integrated revision.

## Known QA risks remaining

- No A or B implementation was present in the supplied baseline, so this handoff verifies C against frozen interfaces/test doubles rather than real screen or SQLite/file behavior.
- Native picker/browser behavior has not been exercised on Android.
- Locked dependency restoration failed in this execution environment because npm registry DNS resolution returned `EAI_AGAIN`; standard Vitest/typecheck evidence is therefore still required.
- C cannot provide the independent Phase 3 review by ownership rule.
