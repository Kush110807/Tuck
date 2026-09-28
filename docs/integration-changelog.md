# Phase 2 integration change log

## Workstream preservation

Master verified the baseline SHA and ownership before merging. Workstream A, B, and C handoffs were committed separately, then master changes were applied afterward. No raw handoff report was treated as proof that the integrated source worked.

## Production wiring

- Replaced placeholder navigation with A's real Inbox/Editor/Detail/Archive screens.
- Constructed one shared `createTuckDataLayer()` and one shared app-level `MutationMailbox`.
- Added stable React route wrappers for C controllers and production picker/link adapters.
- Added subscription cleanup + fresh-props reread through `useControllerProps()`.
- Gated navigator mount on `BootController.start()` reaching ready.
- Connected Inbox/Archive/Detail `onFocus()` and edit Editor `load()` lifecycle.
- Routed Android Back through Editor/Detail/Archive controller boundaries; disabled stack gestures/native headers that could bypass them.

## Confirmed integration defects fixed

1. **Cross-list staleness:** lists previously refreshed on focus only when first-loaded or when their own mailbox notice existed. A restore/archive could leave the other still-mounted list stale. Lists now refresh on every focus while success feedback remains one-shot.
2. **Unsafe edit conflict retry:** C previously fetched a fresh timestamp after `CONFLICT`, rebased untouched fields, then allowed the next Save to overwrite without a distinct overwrite decision. Phase 2 adds an explicit conflict-confirmation state/callback pair. The exact draft is preserved and no retry happens until the user chooses overwrite.
3. **Text persistence mismatch:** B trimmed titles but not all type-specific persisted strings. Domain validation now trims note body, URL, and nonblank image caption consistently with the Stage 1 contract; blank captions normalize to null.
4. **Controller/domain normalization drift:** controller tag display/key handling now delegates to the domain normalizer and imports shared tag limits. Unicode limits are counted by code point consistently; `FormField` clips/counts the same way instead of relying on platform `maxLength` semantics.
5. **Link validation drift:** the production link opener now parses the URL and rechecks an exact `http:`/`https:` protocol instead of accepting any regex-shaped string.
6. **Production placeholder shell:** real controllers/data/UI now replace the baseline placeholder route content. Preview/test fixtures remain isolated from production imports.

## Tests added/updated

- C editor conflict test now requires explicit overwrite confirmation and verifies cancel preserves the dirty draft.
- List focus test verifies one-shot feedback plus refresh on every revisit.
- Domain tests cover trim/tag/search/update normalization consistency and Unicode code-point limits.
- Repository tests cover queued cleanup not blocking metadata, replacement copy/commit/cleanup ordering, failed replacement rollback cleanup, and delete queue/commit/file-removal ordering.
- Adapter tests now reject malformed HTTP(S)-looking URLs as well as non-HTTP schemes.

No native dependency version was changed during Phase 2 integration.
