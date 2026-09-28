# Frozen behaviour for Phase 1 workstreams

The declarations in `src/contracts/index.ts`, `src/contracts/fixtureSpec.ts`, `src/theme/tokens.ts` and `src/navigation/**` are master-owned. Request edits through master and distribute one new baseline revision to all workstreams.

## Four resolved gaps

1. **List images:** `ListState` contains `ItemListRow[]`. Every row pairs a saved item with `ImageViewState` (`none`, `available` with a resolved URI, or `missing`). B resolves a relative image path through `ImageStore`; C builds rows for A. A never constructs a file URI. For a note/link, image is `none`; for a missing image file, image is `missing` while metadata remains visible.
2. **Editor states:** `EditorState` is `loading`, `ready`, `missing`, or `failed`. Creation starts ready; editing loads by ID. `failed` offers `onRetry()` for a recoverable repository read; `missing` offers `onBackToInbox()`. A ready draft carries field errors, mutation state, image preview, `isDirty`, and `discardConfirmationOpen`. `onCancel()` and Android hardware Back call C's `requestExit()`. If dirty, C opens the confirmation: `onKeepEditing()` closes it, `onConfirmDiscard()` exits. During a pending mutation C blocks exit and duplicate actions. Picker cancellation alone does not dirty the draft.
3. **Cross-screen result:** Master owns `src/navigation/MutationMailbox.ts`. C publishes a typed notice **only after a confirmed repository mutation** and before navigation. The destination controller calls `consume(destination, itemId?)` on focus, refreshes only the affected list/detail and shows the notice's success feedback. Notices are in-memory, one-shot, destination-specific, at most ten pending. A failed refresh may show its own error without reversing an already confirmed mutation. B never publishes notices; A never consumes them. No optimistic list mutation is required.
4. **Fixture:** IDs, timestamps, text, tags and relative image path are frozen in `fixtureSpec.ts`; `assets/fixtures/fixture-card.png` is the bundled 96×96 PNG. Only C's tests and master's isolated preview may import it. The production app starts empty.

## Field and search semantics

`AppBootState` controls repository initialization before list loading. Failed initialization renders `BootGateProps` with Retry; it never renders a ready empty inbox.

Item type, ID and `createdAt` cannot change. `expectedUpdatedAt` guards update, archive, restore and delete; a stale value yields `CONFLICT` and no write. An omitted update property retains its value. `tags: []` clears all tags; omitted tags retain them. Image `caption: null` clears caption, omitted caption retains it. Omitted image change keeps the old file; image replacement is explicit; removing the required image without replacement is invalid. Save and deletion controls synchronously guard duplicate taps before awaiting a repository call.

Title is trimmed, required, at most 120 characters. Notes require nonblank body, at most 10,000 characters; image captions can be blank, at most 10,000. URL is `http:` or `https:` and at most 2,000 characters; no automatic scheme insertion. Images: JPEG, PNG or WebP, up to 10 MiB measured from the selected file. Picker `cancelled` is separate from `failed` and leaves the draft unchanged.

Tags: maximum eight, each maximum 24 characters after NFKC normalization, trimming and internal-whitespace collapse. Comparison keys use `toLowerCase()`; first normalized spelling is kept for display. Empty tag entry is ignored, duplicates do not add a second tag. Search uses the same normalization and matches a substring in any single field: title, body/caption, URL or tag. Search text, exact tag key, type and archived flag combine with AND. Sort `updatedAt` descending, then ID ascending. Inbox and Archive share the same rules; only the archived flag differs. Request generations prevent stale list responses overwriting newer queries. Database initialization failure is a blocking error with Retry, never an empty inbox.

## File and database order

Persist images under app-owned `images/<UUID>.<extension>`; validate that relative paths cannot escape the directory. On create, copy before database commit; on failed commit remove the new copy. On replace, copy new, transactionally write new reference and queue old path, then remove old after commit. On delete, transactionally remove metadata and queue its image path, then remove the file. Store failed cleanup in `pending_file_deletions`; retry on successful startup and after later successful mutations. Successful startup reconciliation removes unreferenced app-owned image files left by an interrupted create. Never reconcile when DB initialization fails. Missing image files do not block metadata reads or edits.

## Navigation and feedback

Create replaces Editor with Detail. Edit pops Editor to its existing Detail when possible, else replaces Editor with Detail. Archive returns Inbox; restore returns Archive; delete returns the Detail route's originating list. A missing origin falls back to Inbox. Cancel/Back in dirty Editor requests discard confirmation. Keep list controllers mounted where possible to retain filters. The placeholder navigator demonstrates route availability only; C and master will integrate hardware Back and actual result flow later.
