# Shared behavior after Phase 4 confirmed repairs

These rules derive from Phase 0 v2 plus documented integration amendments. Phase 4 makes narrow contract changes required by the independent findings; the persisted item model and Stage 1 scope are unchanged.

## Contract amendments now in force

1. **Image selection metadata is advisory.** `ImageSelection.mimeType` may be a supported MIME string, `null`, or absent. The persistent image store validates actual content before accepting a new image reference. A supplied supported MIME value must agree with detected bytes.
2. **Image display has four states.** `ImageViewState` is `none`, `available`, `missing`, or `unavailable`. `missing` means the valid app-owned path does not currently exist. `unavailable` means resolving the image failed for another image-specific reason and carries the `AppError`. Neither condition hides item metadata.
3. **Edit image retry is explicit.** `EditorScreenProps.onRetryImage()` retries resolution of the existing stored image without replacing its path or discarding the draft. `ImagePickerFieldProps.onRetry` is an optional presentational recovery action.
4. **Stored render failure is presentation-local.** If React Native reports `Image.onError` for a URI previously resolved as available, UI switches to a fallback and offers manual retry where appropriate. It does not mutate or clear `imagePath`.

## Resolved integration rules

1. **List images:** `ListState` contains `ItemListRow[]`; each row pairs metadata with its resolved `ImageViewState`. UI never manufactures app-owned file paths.
2. **Editor states:** `EditorState` remains `loading`, `ready`, `missing`, or `failed`. Ready state includes validation/mutation state, preview, dirty flag, discard confirmation, and conflict confirmation. Picker cancellation leaves the draft unchanged. Pending Save blocks exit and duplicate writes.
3. **Edit conflicts:** repository `CONFLICT` never causes automatic timestamp refresh + overwrite. The current draft is preserved; the newest record is held only as a candidate concurrency baseline. A write occurs only after explicit overwrite confirmation. If another change races that confirmation, another conflict requires another explicit decision.
4. **Disappeared edit target:** a confirmed repository `NOT_FOUND` on initial edit load, conflict refresh, or edit write publishes one informational Inbox notice and returns to Inbox once. `DB_FAILED` and other transient errors do not take this deletion path.
5. **Cross-screen results:** one app-level `MutationMailbox` publishes only after confirmed writes. Feedback is one-shot and destination-specific; lists/detail also refresh on focus.
6. **Fixture isolation:** fixtures/previews are test/development-only. Production starts empty.

## Initialization and maintenance boundary

The metadata database is the startup gate. Database open, migration, verified integrity failure, or database failure while reading/writing the cleanup/reconciliation metadata returns `INIT_FAILED` and keeps the navigator blocked.

Filesystem-side image maintenance is recoverable after those database checks succeed:

- queued physical deletions remain queued if file removal cannot complete;
- interrupted-file reconciliation reads the complete DB reference set before enumerating/deleting app-owned files;
- a filesystem-only image-directory enumeration/reconciliation failure does not make otherwise readable metadata inaccessible;
- skipped reconciliation remains pending and is retried at later safe maintenance points or through `retryPendingFileCleanup()`;
- database failures are not converted into success, and reconciliation never runs after failed metadata DB initialization.

Image operations still surface image-specific failures when they actually need image storage.

## Field/search semantics

Item type, ID and `createdAt` cannot change. `expectedUpdatedAt` guards update/archive/restore/delete. Omitted update properties retain current values; `tags: []` clears tags; `caption: null` clears image caption; image replacement is explicit.

Title, note body, URL, and nonblank image caption are trimmed before persistence. Title is required and at most 120 characters. Note body is required and at most 10,000 characters. Image caption is optional and at most 10,000 characters. URL is at most 2,000 characters and must parse as `http:` or `https:`.

Image selections are JPEG/PNG/WebP only and at most 10 MiB by actual file size. The store inspects bytes for supported format identity and probes native decodability before committing a new image reference.

Tags: maximum eight, maximum 24 characters after Unicode NFKC normalization, trimming, and internal-whitespace collapse. Comparison keys use lowercase and first normalized display spelling wins. Search uses the same normalized comparison rule. Search text, exact tag key, type, and archived flag combine with AND; sort is `updatedAt DESC, id ASC`.

An active tag that was already resolved to a display label remains present in `availableTags` while that controller is mounted even if another active criterion produces zero rows, so it stays individually clearable. Inbox and Archive keep separate controller/query scope.

## File/database order

Persist images under safe app-owned `images/<UUID>.<approved extension>` paths. Create validates/copies before DB commit. Replacement validates/copies new first, transactionally changes metadata and queues old, then removes old only after commit. Delete transactionally removes metadata and queues its image path, then removes the file. A failed replacement before commit retains the old metadata/reference/file.

## Navigation and guards

Create success removes the completed Editor from the back stack and opens Detail. Edit success returns to the existing Detail where possible. Archive returns to Inbox; restore returns to Archive; delete returns to the origin list. Dirty Editor exit requires Keep editing/Discard. Pending Save/archive/delete blocks competing exit/mutation. Native stack gestures/headers do not bypass controller guards, and Android hardware Back uses the same boundaries.
