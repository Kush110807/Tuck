# Shared behavior after Phase 2 integration

These rules began as the frozen Phase 1 contracts. Master made one substantive Phase 2 contract extension for safe edit-conflict handling: ready Editor state now exposes `conflictConfirmationOpen`, and Editor props expose explicit confirm/cancel conflict-overwrite callbacks. No persistence model or dependency contract changed.

## Resolved integration rules

1. **List images:** `ListState` contains `ItemListRow[]`. Every row pairs a saved item with `ImageViewState` (`none`, `available`, or `missing`). C resolves rows through B's `ImageStore`; A never constructs file URIs. Missing image files never hide item metadata.
2. **Editor states:** `EditorState` is `loading`, `ready`, `missing`, or `failed`. A ready draft carries validation/mutation state, preview, dirty flag, discard confirmation, and conflict confirmation. Cancel/Android Back use `requestExit()`. Pending Save blocks exit and duplicate mutation. Picker cancellation leaves the draft unchanged.
3. **Edit conflicts:** repository `CONFLICT` never triggers an automatic timestamp refresh + retry. C preserves the user's current draft, fetches the newest record only as a possible overwrite baseline, explains the conflict through the confirmation UI, and writes again only after `onConfirmConflictOverwrite()`. `onCancelConflictOverwrite()` closes the prompt and preserves the draft. A normal Save while the conflict decision is open is ignored.
4. **Cross-screen results:** master owns one app-level `MutationMailbox`. C publishes only after confirmed writes and before navigation. Feedback is in-memory, one-shot, and destination-specific. Inbox/Archive/Detail consume relevant notices on focus; all list/detail focus events also refresh persisted state so mounted routes cannot remain stale after cross-list mutations.
5. **Fixture isolation:** exact fixtures remain available to tests/previews only. Production starts empty and production imports contain no preview/test fixture dependency.

## Field and search semantics

Repository initialization completes before the production navigator mounts. Initialization failure is a blocking Retry state, never an empty Inbox.

Item type, ID and `createdAt` cannot change. `expectedUpdatedAt` guards update/archive/restore/delete. An omitted update property retains its current value; `tags: []` clears tags; image `caption: null` clears the caption; image replacement is explicit.

Title, note body, URL, and nonblank image caption are trimmed before persistence. Title is required and at most 120 characters. Note body is required and at most 10,000 characters. Image caption is optional and at most 10,000 characters. URL is at most 2,000 characters and must already parse as `http:` or `https:`. JPEG/PNG/WebP image selection is limited to 10 MiB by actual file size.

Tags: maximum eight, each maximum 24 characters after Unicode NFKC normalization, trimming, and internal-whitespace collapse. Comparison keys use lowercase; first normalized display spelling wins. Empty tag entry is ignored and duplicates are not added. Search uses the same normalized comparison rule and substring matches title, note body/image caption, URL, or tag. Search text, exact tag key, type, and archived flag combine with AND. Sort is `updatedAt` descending then ID ascending. Inbox and Archive differ only by enforced archive state.

## File and database order

Persist copied images under app-owned `images/<UUID>.<approved extension>` and reject escaping paths. Create copies before DB commit. Replacement copies new first, transactionally changes the reference and queues old, then removes old after commit. Delete transactionally removes metadata and queues the image path, then removes the file. Safe cleanup failures remain queued and are retried later. Startup reconciliation is bounded to app-owned images and must never run after DB initialization failure.

## Navigation and guards

Create success replaces completed Editor with Detail. Edit success pops to an existing matching Detail when possible, otherwise replaces Editor with Detail. Archive returns to Inbox; restore returns to Archive; delete returns to Detail's originating list, with Inbox fallback for an unavailable route. Dirty Editor exit requires Keep editing/Discard. Detail Back is blocked during archive/delete. Native stack gestures/headers do not bypass these callbacks, and Android hardware Back is routed through the same controller boundaries.
