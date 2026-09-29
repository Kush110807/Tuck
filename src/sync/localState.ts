import type { RelativeImagePath, Result } from '../contracts';
import type {
  CanonicalCollection,
  CanonicalItem,
  ChangeSequence,
  InitialSyncState,
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

export type RemoteItemApply = Readonly<{
  canonical: CanonicalItem;
  /** Optional already-downloaded app-owned path. Missing bytes are allowed. */
  imagePath?: RelativeImagePath | null;
}>;

export type RemoteCollectionApply = Readonly<{ canonical: CanonicalCollection }>;

/**
 * Local Phase 6C persistence boundary. No method here performs network I/O.
 * Phase 6D may orchestrate these primitives with the frozen transport layer.
 */
export interface LocalSyncRepository {
  getLocalSyncProfile(): Promise<Result<LocalSyncProfile>>;
  getLocalSyncCheckpoint(): Promise<Result<LocalSyncCheckpoint>>;
  getEntitySyncState(entityType: SyncEntityType, entityId: string): Promise<Result<LocalEntitySyncState>>;
  listDurableOutbox(limit?: number): Promise<Result<readonly DurableOutboxMutation[]>>;
  updateBootstrapCheckpoint(update: LocalBootstrapCheckpointUpdate): Promise<Result<void>>;
  /** Applies a pulled batch and advances its cursor in one SQLite transaction. */
  applyRemoteChanges(
    changes: readonly SyncChange[],
    nextPullCursor: ChangeSequence,
    minimumRetainedSequence?: ChangeSequence,
  ): Promise<Result<void>>;
}
