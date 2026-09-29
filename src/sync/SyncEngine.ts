import type { ImageStore, RelativeImagePath } from '../contracts';
import type { PersistentImageStore } from '../data/PersistentImageStore';
import type {
  DurableOutboxMutation,
  LocalAssetDownloadCandidate,
  LocalSyncRepository,
} from './localState';
import {
  SYNC_PROTOCOL_VERSION,
  type BootstrapResponse,
  type CanonicalAsset,
  type PullChangesResponse,
} from './protocol';
import { SupabaseAssetTransport } from './transport/SupabaseAssetTransport';
import { SupabaseSyncTransport, SyncTransportError } from './transport/SupabaseSyncTransport';

export type SyncRunReason = 'startup' | 'local-write' | 'foreground' | 'manual' | 'reconnect' | 'retry' | 'poll';
export type SyncViewState = Readonly<{
  kind: 'local_saved' | 'syncing' | 'synced' | 'offline_pending' | 'error';
  pendingCount: number;
  lastSyncedAt: number | null;
  message: string | null;
  errorCode: string | null;
  dataRevision: number;
}>;

export type SyncStateListener = (state: SyncViewState) => void;

const BOOTSTRAP_PAGE_SIZE = 200;
const PUSH_BATCH_SIZE = 50;
const PULL_PAGE_SIZE = 200;

function protocolFailure(response: { kind: string; code?: string; message?: string }): Error {
  return new Error(`${response.code ?? response.kind}: ${response.message ?? 'Sync protocol request failed.'}`);
}

function storagePathFor(accountId: string, assetId: string, mimeType: CanonicalAsset['mimeType']): string {
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'webp';
  return `${accountId}/${assetId}/original.${extension}`;
}

/**
 * One foreground-safe orchestration path for the competition MVP. SQLite stays
 * authoritative for UX; this class only drains/pulls after local commits.
 */
export class SyncEngine {
  private readonly listeners = new Set<SyncStateListener>();
  private running: Promise<SyncViewState> | null = null;
  private state: SyncViewState = {
    kind: 'local_saved', pendingCount: 0, lastSyncedAt: null,
    message: null, errorCode: null, dataRevision: 0,
  };

  constructor(
    private readonly local: LocalSyncRepository,
    private readonly transport: SupabaseSyncTransport,
    private readonly assets: SupabaseAssetTransport,
    private readonly imageStore: Pick<PersistentImageStore, 'readForSync' | 'writeDownloadedAsset' | 'resolve'>,
  ) {}

  currentState(): SyncViewState { return this.state; }

  subscribe(listener: SyncStateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  noteLocalSave(): void {
    this.publish({ ...this.state, kind: 'local_saved', pendingCount: Math.max(1, this.state.pendingCount), message: null, errorCode: null });
    void this.refreshPending('local_saved', true);
  }

  runOnce(reason: SyncRunReason = 'manual'): Promise<SyncViewState> {
    if (this.running) return this.running;
    this.running = this.run(reason).finally(() => { this.running = null; });
    return this.running;
  }

  async ensureAssetForImagePath(path: RelativeImagePath): Promise<RelativeImagePath | null> {
    const resolved = await this.imageStore.resolve(path);
    if (resolved.ok && resolved.value.kind === 'available') return path;
    const candidateResult = await this.local.getAssetDownloadCandidateForPath(path);
    if (!candidateResult.ok) return null;
    const profile = await this.local.getLocalSyncProfile();
    if (!profile.ok || profile.value.profileKind !== 'account' || !profile.value.accountId || !profile.value.syncEnabled) return null;
    const cachedPath = await this.downloadAsset(profile.value.accountId, candidateResult.value);
    this.publish({ ...this.state, dataRevision: this.state.dataRevision + 1 });
    return cachedPath;
  }

  private async run(_reason: SyncRunReason): Promise<SyncViewState> {
    const profileResult = await this.local.getLocalSyncProfile();
    if (!profileResult.ok || profileResult.value.profileKind !== 'account' ||
        !profileResult.value.accountId || !profileResult.value.syncEnabled) {
      return this.refreshPending('local_saved');
    }
    const accountId = profileResult.value.accountId;
    this.publish({ ...this.state, kind: 'syncing', message: null, errorCode: null });

    try {
      await this.ensureBootstrap(accountId);
      let resolvedConflictCopies = 0;
      let outboxResult = await this.local.listDurableOutbox(PUSH_BATCH_SIZE);
      if (!outboxResult.ok) throw new Error(outboxResult.error.message);

      while (outboxResult.value.length > 0) {
        const queued = outboxResult.value.filter(row => row.state === 'queued');
        if (queued.length === 0) {
          return this.finishError('BLOCKED_MUTATION', 'Some changes need attention before syncing can continue.');
        }
        const batch = queued.slice(0, PUSH_BATCH_SIZE);
        for (const row of batch) {
          if (row.dependsOnAssetId) await this.ensureUploadedAsset(accountId, profileResult.value.deviceId, row.dependsOnAssetId);
        }
        let response;
        try {
          response = await this.transport.pushMutations({
            protocolVersion: SYNC_PROTOCOL_VERSION,
            accountId,
            mutations: batch.map(row => row.mutation),
          });
        } catch (error) {
          await this.local.markOutboxTransportFailure(batch.map(row => row.mutation.mutationId), this.errorCode(error));
          throw error;
        }
        if (response.kind !== 'ok') throw protocolFailure(response);
        const byId = new Map(batch.map(row => [row.mutation.mutationId, row]));
        const applications = response.results.map(result => {
          const sent = byId.get(result.mutationId);
          if (!sent) throw new Error(`Server returned an unexpected mutation result: ${result.mutationId}`);
          return { sent, result };
        });
        if (applications.length !== batch.length) throw new Error('Server did not return one result for every pushed mutation.');
        const applied = await this.local.applyPushResults(applications);
        if (!applied.ok) throw new Error(applied.error.message);
        this.bumpDataRevision();
        resolvedConflictCopies += applied.value.resolvedConflicts;
        if (applied.value.conflicts > 0 || applied.value.rejected > 0) {
          const mutationReuse = response.results.some(r => r.kind === 'rejected' && r.code === 'MUTATION_ID_REUSE');
          return this.finishError(
            mutationReuse ? 'MUTATION_ID_REUSE' : 'SYNC_CONFLICT',
            mutationReuse
              ? 'A queued change could not be safely retried. Your local change is still on this device.'
              : 'This item changed elsewhere. Your local version is still safe on this device.',
          );
        }
        outboxResult = await this.local.listDurableOutbox(PUSH_BATCH_SIZE);
        if (!outboxResult.ok) throw new Error(outboxResult.error.message);
      }

      await this.pullToFiniteHead(accountId, false);
      const checkpoint = await this.local.getLocalSyncCheckpoint();
      if (!checkpoint.ok) throw new Error(checkpoint.error.message);
      const pending = await this.local.listDurableOutbox(1);
      const pendingCount = pending.ok ? pending.value.length : 0;
      this.publish({
        ...this.state,
        kind: 'synced',
        pendingCount,
        lastSyncedAt: checkpoint.value.lastSuccessfulSyncAt ?? Date.now(),
        message: resolvedConflictCopies > 0 ? 'This item was edited on another device. Both versions were kept.' : null,
        errorCode: null,
      });
      return this.state;
    } catch (error) {
      const pending = await this.local.listDurableOutbox(1000);
      const pendingCount = pending.ok ? pending.value.length : this.state.pendingCount;
      const offline = error instanceof SyncTransportError && (error.status === undefined || error.status >= 500);
      this.publish({
        ...this.state,
        kind: offline ? 'offline_pending' : 'error',
        pendingCount,
        message: offline
          ? 'Changes are safe on this device and will sync when connection returns.'
          : (error instanceof Error ? error.message : 'Could not sync. Your changes are safe on this device.'),
        errorCode: this.errorCode(error),
      });
      return this.state;
    }
  }

  private async ensureBootstrap(accountId: string): Promise<void> {
    let checkpointResult = await this.local.getLocalSyncCheckpoint();
    if (!checkpointResult.ok) throw new Error(checkpointResult.error.message);
    let checkpoint = checkpointResult.value;
    if (checkpoint.initialSyncState === 'complete') return;

    if (checkpoint.initialSyncState === 'rebootstrap_required') {
      const reset = await this.local.resetBootstrapForRetry();
      if (!reset.ok) throw new Error(reset.error.message);
      checkpointResult = await this.local.getLocalSyncCheckpoint();
      if (!checkpointResult.ok) throw new Error(checkpointResult.error.message);
      checkpoint = checkpointResult.value;
    }

    if (checkpoint.initialSyncState === 'not_started' || checkpoint.initialSyncState === 'bootstrapping') {
      // Resume the materialized server snapshot when possible.
      for (;;) {
        const response: BootstrapResponse = await this.transport.bootstrap({
          protocolVersion: SYNC_PROTOCOL_VERSION,
          accountId,
          pageSize: BOOTSTRAP_PAGE_SIZE,
          ...(checkpoint.bootstrapSessionId ? { sessionId: checkpoint.bootstrapSessionId } : {}),
          ...(checkpoint.bootstrapAfterOrdinal !== null ? { afterOrdinal: checkpoint.bootstrapAfterOrdinal } : {}),
        });
        if (response.kind === 'bootstrap_expired') {
          const reset = await this.local.resetBootstrapForRetry();
          if (!reset.ok) throw new Error(reset.error.message);
          checkpointResult = await this.local.getLocalSyncCheckpoint();
          if (!checkpointResult.ok) throw new Error(checkpointResult.error.message);
          checkpoint = checkpointResult.value;
          continue;
        }
        if (response.kind !== 'page') throw protocolFailure(response);
        const applied = await this.local.applyBootstrapPage({
          sessionId: response.sessionId,
          snapshotHeadSequence: response.snapshotHeadSequence,
          entries: response.entries,
          nextAfterOrdinal: response.nextAfterOrdinal,
        });
        if (!applied.ok) throw new Error(applied.error.message);
        this.bumpDataRevision();
        checkpointResult = await this.local.getLocalSyncCheckpoint();
        if (!checkpointResult.ok) throw new Error(checkpointResult.error.message);
        checkpoint = checkpointResult.value;
        if (response.nextAfterOrdinal === null) break;
      }
    }

    await this.pullToFiniteHead(accountId, true);
  }

  private async pullToFiniteHead(accountId: string, completingInitialSync: boolean): Promise<void> {
    let checkpointResult = await this.local.getLocalSyncCheckpoint();
    if (!checkpointResult.ok) throw new Error(checkpointResult.error.message);
    let afterSequence = checkpointResult.value.pullCursor;
    let target: number | null = completingInitialSync ? checkpointResult.value.catchupTargetHeadSequence : null;

    for (;;) {
      const response: PullChangesResponse = await this.transport.pullChanges({
        protocolVersion: SYNC_PROTOCOL_VERSION,
        accountId,
        afterSequence,
        limit: PULL_PAGE_SIZE,
        targetHeadSequence: target,
      });
      if (response.kind === 'rebootstrap_required') {
        const reset = await this.local.resetBootstrapForRetry();
        if (!reset.ok) throw new Error(reset.error.message);
        if (!completingInitialSync) {
          await this.ensureBootstrap(accountId);
          return;
        }
        throw new Error('Server history changed during bootstrap catch-up; bootstrap restart required.');
      }
      if (response.kind !== 'page') throw protocolFailure(response);
      if (completingInitialSync && target === null) {
        const checkpointUpdate = await this.local.updateBootstrapCheckpoint({
          initialSyncState: 'catching_up',
          catchupTargetHeadSequence: response.targetHeadSequence,
        });
        if (!checkpointUpdate.ok) throw new Error(checkpointUpdate.error.message);
      }
      target = response.targetHeadSequence;
      const complete = completingInitialSync && !response.hasMore && response.nextAfterSequence === response.targetHeadSequence;
      const applied = await this.local.applyRemoteChanges(
        response.changes,
        response.nextAfterSequence,
        response.minimumRetainedSequence,
        complete ? { completeInitialSyncAtTarget: response.targetHeadSequence } : undefined,
      );
      if (!applied.ok) throw new Error(applied.error.message);
      if (response.changes.length > 0) this.bumpDataRevision();
      afterSequence = response.nextAfterSequence;
      if (!response.hasMore || afterSequence >= response.targetHeadSequence) {
        if (completingInitialSync && !complete) {
          // Empty page where cursor already equals target still needs the atomic
          // completion transition in local state.
          const finish = await this.local.applyRemoteChanges([], afterSequence, response.minimumRetainedSequence,
            { completeInitialSyncAtTarget: response.targetHeadSequence });
          if (!finish.ok) throw new Error(finish.error.message);
        }
        return;
      }
    }
  }

  private async ensureUploadedAsset(accountId: string, deviceId: string, assetId: string): Promise<void> {
    const candidateResult = await this.local.getAssetUploadCandidate(assetId);
    if (!candidateResult.ok) throw new Error(candidateResult.error.message);
    const candidate = candidateResult.value;
    if (candidate.remoteState === 'ready' && candidate.uploadState === 'uploaded') return;
    const bytes = await this.imageStore.readForSync(candidate.imagePath);
    if (!bytes.ok) {
      await this.local.markAssetUploadFailed(assetId, bytes.error.code);
      throw new Error(bytes.error.message);
    }
    await this.local.markAssetUploadAttempt(assetId);
    try {
      const staging = await this.assets.createStaging(assetId, bytes.value.mimeType, bytes.value.bytes.byteLength);
      if (staging.kind === 'error') throw protocolFailure(staging);
      if (staging.kind === 'staging' || staging.state !== 'ready') {
        await this.assets.upload(staging.storagePath, bytes.value.mimeType, bytes.value.bytes);
      }
      const finalized = await this.assets.finalize(assetId, deviceId);
      if (finalized.kind === 'error') throw protocolFailure(finalized);
      await this.local.markAssetUploadReady(finalized.asset.entity);
    } catch (error) {
      await this.local.markAssetUploadFailed(assetId, this.errorCode(error));
      throw error;
    }
  }

  private async downloadAsset(accountId: string, candidate: LocalAssetDownloadCandidate): Promise<RelativeImagePath> {
    await this.local.markAssetDownloadAttempt(candidate.assetId);
    try {
      const downloaded = await this.assets.download(storagePathFor(accountId, candidate.assetId, candidate.mimeType));
      if (downloaded.bytes.byteLength !== candidate.byteSize) throw new Error('Downloaded Asset size did not match metadata.');
      const saved = await this.imageStore.writeDownloadedAsset(candidate.assetId, candidate.mimeType, downloaded.bytes);
      if (!saved.ok) throw new Error(saved.error.message);
      const marked = await this.local.markAssetDownloaded(candidate.assetId, saved.value);
      if (!marked.ok) throw new Error(marked.error.message);
      return saved.value;
    } catch (error) {
      await this.local.markAssetDownloadFailed(candidate.assetId, this.errorCode(error));
      throw error;
    }
  }

  private async refreshPending(kind: SyncViewState['kind'], onlyIfStillKind = false): Promise<SyncViewState> {
    const pending = await this.local.listDurableOutbox(1000);
    if (onlyIfStillKind && this.state.kind !== kind) return this.state;
    this.publish({ ...this.state, kind, pendingCount: pending.ok ? pending.value.length : this.state.pendingCount });
    return this.state;
  }

  private finishError(code: string, message: string): SyncViewState {
    this.publish({ ...this.state, kind: 'error', errorCode: code, message });
    return this.state;
  }

  private errorCode(error: unknown): string {
    if (error instanceof SyncTransportError) return error.status ? `HTTP_${error.status}` : 'NETWORK';
    return error instanceof Error && error.message ? error.name || 'SYNC_ERROR' : 'SYNC_ERROR';
  }

  private bumpDataRevision(): void {
    this.publish({ ...this.state, dataRevision: this.state.dataRevision + 1 });
  }

  private publish(next: SyncViewState): void {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }
}

/** Lazy image resolver: local cache first, then one private Asset download. */
export class SyncAwareImageStore implements ImageStore {
  constructor(private readonly base: ImageStore, private readonly engine: SyncEngine) {}
  copySelected = (selection: Parameters<ImageStore['copySelected']>[0]) => this.base.copySelected(selection);
  removeFile = (path: RelativeImagePath) => this.base.removeFile(path);
  async resolve(path: RelativeImagePath): ReturnType<ImageStore['resolve']> {
    const first = await this.base.resolve(path);
    if (!first.ok || first.value.kind === 'available') return first;
    try {
      const cachedPath = await this.engine.ensureAssetForImagePath(path);
      if (cachedPath) return this.base.resolve(cachedPath);
    } catch { /* placeholder remains retryable */ }
    return this.base.resolve(path);
  }
}
