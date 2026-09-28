# Integration and repair change log

## Phase 2 integration

Master integrated A/B/C as separate commits from the frozen baseline, replaced placeholder production wiring with the real services/controllers/UI, and fixed cross-list focus refresh, explicit edit-conflict confirmation, normalization/link-validation drift, and production navigation. Phase 2 intentionally remained an integrated candidate pending independent review.

## Phase 3 independent audit

The independent reviewer audited commit `9ab9be28d70c66235a2aabd287b87ed5c1c9a568` and confirmed six findings P3-01 through P3-06. The original audit ZIP is preserved unchanged at `docs/evidence/Tuck_Phase3_Independent_Audit_9ab9be2.zip` with SHA-256 `4b8b9290e8c6b7a28d915a2c96e4bf5f4dee72e87423a125310c6af03a45a7e2`.

## Phase 4 confirmed repairs

### P3-01 — recoverable image maintenance blocked startup

`SQLiteItemRepository.initialize()` keeps DB open/migration/integrity and database-backed maintenance reads/writes fatal. Physical file-removal failures remain queued, while filesystem-only image enumeration/reconciliation failures are recoverable and stay pending for explicit/later retry. Reconciliation reads the complete DB reference set before image enumeration/deletion, so incomplete filesystem information is never used to delete files.

### P3-02 — image resolve error hid metadata

`ImageViewState` gains `unavailable { error }`. Detail and edit Editor now remain `ready` when metadata loaded but image resolution returned an image-specific error. Editor has a dedicated image retry that preserves the draft/stored path; Detail retries through normal refresh. Ordinary missing-file state stays distinct.

### P3-03 — unnecessary picker permission gate

The Expo ImagePicker adapter no longer calls `requestMediaLibraryPermissionsAsync()` before `launchImageLibraryAsync()` for this image-only system library flow. Cancellation, provider failure, and a successful pick remain distinct. Picker MIME metadata may be unavailable and is passed as `null` for content validation.

The app config also disables the ImagePicker plugin's unused Android camera and microphone permissions and blocks legacy `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE` manifest permissions for this library-only flow; no broad media-library permission is added by Tuck.

### P3-04 — actual image validation/render fallback

New `src/domain/imageFormat.ts` identifies supported image byte formats. `PersistentImageStore` now checks actual size, actual content identity, optional MIME agreement, and native decoder dimensions before accepting a path, then checks the copied app-owned file again. No new dependency was required. Detail, list cards and image editor previews use `Image.onError` fallback without clearing metadata or looping automatically.

Failed replacement before metadata transaction still retains the original item/reference/file; existing ordering tests were extended.

### P3-05 — disappeared edit target

Initial edit load, edit save, and conflict-refresh `NOT_FOUND` all route once to Inbox with an informational mailbox notice. DB/storage failures do not masquerade as deletion. Existing explicit conflict overwrite behavior is preserved.

### P3-06 — selected tag disappeared on zero matches

List controllers retain the observed display label for the currently selected tag while mounted so the chip remains visible and individually clearable even when another filter produces zero rows. Repository AND semantics, Inbox/Archive separation and deterministic sort are unchanged.

## Regression additions

Phase 4 adds/extends tests for startup enumeration failure + later recovery, fatal DB integrity/maintenance-table failure, Detail/Editor image degradation and retry, picker launch without permission gating, manifest permission minimization, missing MIME, JPEG/PNG/WebP content/decoder validation, oversized images, failed replacement preservation, stored-image render fallback, missing edit target paths, second conflict confirmation, and selected-tag zero-match recovery.

Canonical Vitest execution remains blocked in the current environment until the committed dependency tree can be installed; supplemental repaired-source execution is documented separately in `docs/phase4-verification.md`.
