import type { RelativeImagePath, Result } from '../contracts';
import type {
  BootstrapEntry,
  CanonicalAsset,
  CanonicalCollection,
  CanonicalItem,
  ChangeSequence,
  InitialSyncState,
  PushMutationResult,
  ServerVersion,
  SyncChange,
  SyncEntityType,
  SyncMutation,
} from './protocol';

export type LocalSyncProfile = Readonly<{
  profileKind: 'local-only' | 'account';
  accountId: string | null;
  deviceId: string;
  syncEnabled: boolean;
}>;

export type LocalEntitySyncState = Readonly<{
  entityType: SyncEntityType;
  entityId: string;
  localRevision: number;
  serverVersion: ServerVersion | null;
  lastSyncedLocalRevision: number | null;
}>;

export type DurableOutboxMutation = Readonly<{
  position: number;
  mutation: SyncMutation;
  createdLocalRevision: number;
  dependsOnAssetId: string | null;
  state: 'queued' | 'blocked';
  attemptCount: number;
  lastErrorCode: string | null;
  queuedAt: number;
}>;

export type LocalSyncCheckpoint = Readonly<{
  pullCursor: ChangeSequence;
  minimumRetainedSequence: ChangeSequence;
  initialSyncState: InitialSyncState;
  bootstrapSessionId: string | null;
  bootstrapAfterOrdinal: number | null;
  bootstrapSnapshotHeadSequence: ChangeSequence | null;
  catchupTargetHeadSequence: ChangeSequence | null;
  lastSuccessfulSyncAt: number | null;
}>;

export type LocalBootstrapCheckpointUpdate = Readonly<{
  initialSyncState: InitialSyncState;
  bootstrapSessionId?: string | null;
  bootstrapAfterOrdinal?: number | null;
  bootstrapSnapshotHeadSequence?: ChangeSequence | null;
  catchupTargetHeadSequence?: ChangeSequence | null;
}>;

export type LocalBootstrapPage = Readonly<{
  sessionId: string;
  snapshotHeadSequence: ChangeSequence;
  entries: readonly Readonly<{ ordinal: number; snapshot: BootstrapEntry }>[];
  nextAfterOrdinal: number | null;
}>;

export type LocalPushResultApplication = Readonly<{
  sent: DurableOutboxMutation;
  result: PushMutationResult;
}>;

export type LocalPushApplySummary = Readonly<{
  accepted: number;
  conflicts: number;
  resolvedConflicts: number;
  rejected: number;
  blockedMutationIds: readonly string[];
}>;

export type LocalAssetUploadCandidate = Readonly<{
  assetId: string;
  imagePath: RelativeImagePath;
  uploadState: 'not_scheduled' | 'not_required' | 'pending' | 'failed' | 'uploaded';
  remoteState: 'unknown' | 'staging' | 'ready';
  uploadAttempts: number;
}>;

export type LocalAssetDownloadCandidate = Readonly<{
  assetId: string;
  imagePath: RelativeImagePath;
  mimeType: CanonicalAsset['mimeType'];
  byteSize: number;
  localState: 'remote_known_not_downloaded' | 'download_pending' | 'available' | 'download_failed' | 'missing' | 'corrupt';
  downloadAttempts: number;
}>;

export type RemoteItemApply = Readonly<{
  canonical: CanonicalItem;
  /** Optional already-downloaded app-owned path. Missing bytes are allowed. */
  imagePath?: RelativeImagePath | null;
}>;

export type RemoteCollectionApply = Readonly<{ canonical: CanonicalCollection }>;

/**
 * Local sync persistence boundary. Network scheduling lives in SyncEngine; these
 * methods only perform durable SQLite state transitions.
 */
export interface LocalSyncRepository {
  getLocalSyncProfile(): Promise<Result<LocalSyncProfile>>;
  getLocalSyncCheckpoint(): Promise<Result<LocalSyncCheckpoint>>;
  getEntitySyncState(entityType: SyncEntityType, entityId: string): Promise<Result<LocalEntitySyncState>>;
  listDurableOutbox(limit?: number): Promise<Result<readonly DurableOutboxMutation[]>>;
  updateBootstrapCheckpoint(update: LocalBootstrapCheckpointUpdate): Promise<Result<void>>;
  applyBootstrapPage(page: LocalBootstrapPage): Promise<Result<void>>;
  resetBootstrapForRetry(): Promise<Result<void>>;
  applyPushResults(applications: readonly LocalPushResultApplication[]): Promise<Result<LocalPushApplySummary>>;
  markOutboxTransportFailure(mutationIds: readonly string[], errorCode: string): Promise<Result<void>>;
  getAssetUploadCandidate(assetId: string): Promise<Result<LocalAssetUploadCandidate>>;
  markAssetUploadAttempt(assetId: string): Promise<Result<void>>;
  markAssetUploadReady(asset: CanonicalAsset): Promise<Result<void>>;
  markAssetUploadFailed(assetId: string, errorCode: string): Promise<Result<void>>;
  getAssetDownloadCandidateForPath(path: RelativeImagePath): Promise<Result<LocalAssetDownloadCandidate>>;
  markAssetDownloadAttempt(assetId: string): Promise<Result<void>>;
  markAssetDownloaded(assetId: string, path: RelativeImagePath): Promise<Result<void>>;
  markAssetDownloadFailed(assetId: string, errorCode: string): Promise<Result<void>>;
  /** Applies a pulled batch and advances its cursor in one SQLite transaction. */
  applyRemoteChanges(
    changes: readonly SyncChange[],
    nextPullCursor: ChangeSequence,
    minimumRetainedSequence?: ChangeSequence,
    options?: Readonly<{ completeInitialSyncAtTarget?: ChangeSequence }>,
  ): Promise<Result<void>>;
}
