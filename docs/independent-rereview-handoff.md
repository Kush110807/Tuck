# Phase 4 repaired candidate — independent re-review handoff

**Role separation:** this repaired candidate was produced by the master implementer. The next reviewer must independently verify the repairs and must not treat this document, the implementation reports, or supplemental mock-layer passes as proof of installed-app behavior.

**Starting audit basis:** Phase 3 audited commit `9ab9be28d70c66235a2aabd287b87ed5c1c9a568`. The original audit ZIP is preserved at `docs/evidence/Tuck_Phase3_Independent_Audit_9ab9be2.zip` with SHA-256 `4b8b9290e8c6b7a28d915a2c96e4bf5f4dee72e87423a125310c6af03a45a7e2`.

The final packaged repair SHA and package SHA-256 are supplied in the external Phase 4 handoff. Verify those before testing.

## Important audit-script warning

The original audit's `audit-core-scenarios.js` intentionally asserted the **old broken behavior** for Detail image-resolution failure and stale edit target. Its unchanged successful exit only proves the old candidate behaved as the old reproduction expected. Do **not** count it as a Phase 4 pass.

Use the repaired production source and the new committed regression assertions instead.

## Re-review P3-01 through P3-06

1. **P3-01 startup maintenance:** inject/induce image-directory enumeration failure after a valid metadata DB is available. Notes/links/metadata must still load. Ensure no orphan deletion occurs from incomplete information. Restore storage and verify explicit/later cleanup can recover. Separately confirm a real DB open/migration/integrity failure still blocks startup.
2. **P3-02 image resolution:** make an image store resolve return `OPEN_FAILED`. Detail and edit Editor must remain usable with title/caption/tags/actions/draft intact and show an image-only degraded state. Retry should recover. Also recheck ordinary missing-file behavior.
3. **P3-03 picker permission:** on Android, verify normal system image-library selection launches without a broad media-library permission gate. Denied/unavailable media permission must not itself block the supported system picker. Inspect the built Android manifest and confirm unused camera/audio plus legacy broad external-storage permissions are absent for this library-only flow. Cancellation must remain silent/normal; provider errors must preserve the draft.
4. **P3-04 content validation/rendering:** verify supported JPEG/PNG/WebP with normal and missing MIME metadata; mismatched bytes; corrupt/truncated input; >10 MiB actual files; replacement validation failure preserving the original image; and a stored file that later fails native rendering. Confirm no automatic render retry loop.
5. **P3-05 disappeared edit target:** verify initial edit load and later save-time `NOT_FOUND` return once to Inbox with explanatory feedback, never false save success/Detail navigation. Confirm a transient `DB_FAILED` stays in Editor. Recheck conflict overwrite for records that still exist.
6. **P3-06 active tag:** select a tag, combine another filter/search so zero rows match, verify the selected tag remains visible/individually clearable, then clear it and recover expected rows. Confirm AND semantics and Inbox/Archive separation.

## Additional device-discovered repair: NEW-01

The prior repaired candidate `b1f0dba85a1cb278785776441a40ed33f6dfad6b` was tested on a Motorola Edge 40 running Android 15. The device pass found that Add note/link/image were visible only when Inbox was empty; after item 1 existed, there was no create affordance until that item was archived.

The repair moves the existing three create actions from the empty-state-only slot into Inbox's unconditional header actions. No contract change was made. Independently recheck on the new candidate:

1. empty Inbox shows all three create controls;
2. after saving item 1, those controls remain visible and item 2 can be created immediately;
3. All / Notes / Images filters do not hide the general creation path;
4. a zero-match search/tag/type combination still shows creation controls while Clear filters works;
5. narrow-screen/large-text layout still exposes Archive and creation actions.

Do not treat the old Motorola pass as evidence for the new repair SHA; record the new source/build identity and rerun it.

## Adjacent regressions that must remain intact

- a second concurrent modification before confirmed overwrite requires a second explicit confirmation and preserves the local draft;
- duplicate Save/archive/delete guards;
- stale search and stale image-resolution suppression;
- one-shot destination feedback plus focus refresh;
- image copy-before-commit, failed replacement rollback, queue-before-old-delete, and queued cleanup;
- missing/unavailable image never hides metadata;
- dirty Editor Android Back and pending-operation guards;
- force-close/relaunch persistence and airplane-mode local CRUD.

## Verification layers — report separately

Label evidence as one of:

- **mocked controller/filesystem/Expo-boundary test**;
- **real SQLite test** (and say whether it uses the Expo repository or only the schema/SQL model);
- **canonical dependency-backed Vitest/typecheck/export**;
- **native Android build/install/device test**.

Do not describe the prior Python copied-schema audit as execution of `SQLiteItemRepository` through Expo SQLite.

## Canonical commands

From a clean checkout/package after dependencies are available:

```bash
npm ci
npm run typecheck
npm test
npm run export:android
npx expo install --check
```

Then build/install the exact same Git SHA and execute `docs/qa-plan.md`.

For every item report **PASS / FAIL / BLOCKED / NOT RUN**, exact source/build/device identifiers, reproduction steps, expected/actual behavior, and evidence. JavaScript export is not native install evidence.
