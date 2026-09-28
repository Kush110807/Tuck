# Phase 3 independent reviewer handoff (historical Phase 2 handoff)

> Phase 4 has repaired the six findings from this review cycle. For the repaired candidate use `docs/independent-rereview-handoff.md`. This file is retained as historical handoff context.

**Candidate status:** Phase 2 integrated candidate, not a release. The independent reviewer must not have implemented Workstream A, B, C, or master integration. The reviewer owns `docs/independent-audit.md`; do not overwrite this handoff with assumed results.

## Review basis

Verify the exact candidate Git SHA and, when available, the exact APK/build ID before testing. Compare implementation against Stage 1 and the integrated rules in:

- `README.md`
- `docs/CONTRACT_RULES.md`
- `docs/architecture.md`
- `docs/qa-plan.md`
- `docs/release.md`

Review production source, not only completion reports. Confirm production imports do not reach preview/test fixtures.

## Required independent checks

1. Fresh checkout: `npm ci`, `npm run typecheck`, `npm test`, `npm run export:android`, dependency compatibility check.
2. Boot/init failure behavior where reproducible; no false empty Inbox.
3. Create/reopen note, HTTP(S) link, and JPEG/PNG/WebP image; invalid inputs remain unsaved with useful guidance.
4. Search + type + tag combinations and deterministic/stable list behavior.
5. Edit all three types, including image replacement and picker cancellation.
6. Duplicate Save/archive/delete taps produce one write/navigation result.
7. Dirty-editor Cancel and Android Back; pending Save cannot be escaped.
8. Stale edit conflict preserves local draft and **does not write again until explicit overwrite confirmation**. Cancelling the overwrite prompt preserves the draft.
9. Archive/restore transitions; revisit both lists and verify each is current, with success feedback not repeating.
10. Delete confirmation; stale delete/archive conflict behavior; stale/missing IDs.
11. Missing image file leaves title/caption/tags/archive/edit/delete usable.
12. Image copy/replace/delete rollback/order and pending cleanup queue through repository tests and targeted fault injection where feasible.
13. Force-close/relaunch persistence and airplane-mode local operations.
14. Link-open failure does not mutate saved data.
15. Accessibility basics: large text, screen-reader labels/status, reading order, 44 pt controls, narrow Android layout.

## Evidence format

For every check record **PASS / FAIL / NOT RUN**, environment/build identifiers, exact reproduction steps for failures, expected vs actual behavior, severity, and supporting logs/screenshots where useful. Do not convert a JavaScript bundle export into a native-build pass or a source test into a device pass.

Any defect fixes belong to a later master repair commit; retest the defect and adjacent journeys on the new candidate before release consideration.
