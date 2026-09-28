import { describe, expect, it } from 'vitest';
import {
  buildConflictCopyTitle,
  makeConflictCopy,
  mergeTagsThreeWay,
} from '../../src/sync/merge';
import {
  canApplySyncResponse,
  canRemoveAccountCache,
  createProfileRegistry,
  globalSignOut,
  markRemoteAccountDeleted,
  signInAccount,
  signOutAccount,
  updatePendingCounts,
} from '../../src/sync/profileState';
import {
  localPendingAssetState,
  localUnscheduledAssetState,
  reduceAssetState,
  remoteKnownAssetState,
} from '../../src/sync/assetState';
import type { CanonicalItem } from '../../src/sync/protocol';

describe('Phase 6A merge/conflict-copy helpers', () => {
  it('merges tags deterministically by normalized key', () => {
    expect(mergeTagsThreeWay(
      ['Study', 'Reading'],
      ['Study', 'Build'],
      ['study', 'Important'],
    )).toEqual(['Study', 'Build', 'Important']);
  });

  it('covers the frozen tag merge edge matrix deterministically', () => {
    expect(mergeTagsThreeWay(['Base'], ['Base', 'Same'], ['Base', 'same'])).toEqual(['Base', 'Same']);
    expect(mergeTagsThreeWay(['Keep', 'Remove'], ['Keep', 'Remove'], ['Keep'])).toEqual(['Keep']);
    expect(mergeTagsThreeWay(['Keep', 'Remove'], ['Keep'], ['Keep'])).toEqual(['Keep']);
    expect(mergeTagsThreeWay([], ['Alpha'], ['alpha'])).toEqual(['Alpha']);
    expect(mergeTagsThreeWay([], ['Café'], ['Café'])).toEqual(['Café']);
    expect(mergeTagsThreeWay(['Base'], ['Base', 'Server 1', 'Server 2'], ['Base', 'Local 1', 'Local 2']))
      .toEqual(['Base', 'Server 1', 'Server 2', 'Local 1', 'Local 2']);
  });

  it('creates a normal local conflict copy without leaking version numbers to the title', () => {
    const local: Omit<CanonicalItem, 'version'> = {
      id: 'item-1', type: 'note', title: 'Plan', body: 'Local body', url: null, assetId: null,
      tags: ['Work'], collectionId: 'collection-1', pinned: true, archived: false,
      createdAt: 1, updatedAt: 2,
    };
    const copy = makeConflictCopy({
      localItem: local,
      originalItemId: 'item-1',
      newItemId: 'item-conflict',
      validCollectionIds: new Set(['collection-1']),
    });
    expect(copy).toMatchObject({
      id: 'item-conflict', title: 'Plan (conflict copy)', body: 'Local body', tags: ['Work'],
      collectionId: 'collection-1', pinned: true, archived: false,
    });
  });

  it('allows an image conflict copy to reuse the same immutable AssetId', () => {
    const local: Omit<CanonicalItem, 'version'> = {
      id: 'image-1', type: 'image', title: 'Reference', body: 'Local caption', url: null, assetId: 'asset-x',
      tags: ['Visual'], collectionId: null, pinned: false, archived: false, createdAt: 1, updatedAt: 2,
    };
    const copy = makeConflictCopy({
      localItem: local,
      originalItemId: 'image-1',
      newItemId: 'image-copy',
      validCollectionIds: new Set(),
    });
    expect(local.assetId).toBe('asset-x');
    expect(copy.assetId).toBe('asset-x');
    expect(copy.id).toBe('image-copy');
  });

  it('moves a conflict copy to Unfiled if its original Collection was deleted', () => {
    const local: Omit<CanonicalItem, 'version'> = {
      id: 'item-1', type: 'note', title: 'Plan', body: 'Local body', url: null, assetId: null,
      tags: [], collectionId: 'gone', pinned: false, archived: true, createdAt: 1, updatedAt: 2,
    };
    expect(makeConflictCopy({
      localItem: local,
      originalItemId: 'item-1',
      newItemId: 'copy',
      validCollectionIds: new Set(),
    })).toMatchObject({ collectionId: null, archived: true });
  });

  it('bounds the conflict-copy title to the existing title limit', () => {
    const title = buildConflictCopyTitle('😀'.repeat(120));
    expect([...title].length).toBeLessThanOrEqual(120);
    expect(title.endsWith(' (conflict copy)')).toBe(true);
  });
});

describe('Phase 6A local profile/logout state machine', () => {
  it('isolates account profiles and preserves pending outbox work on normal logout', () => {
    let state = createProfileRegistry();
    state = signInAccount(state, 'a');
    state = updatePendingCounts(state, 'a', 3, 1);
    state = signOutAccount(state, 'a');

    expect(state.activeProfileKey).toBe('local-only');
    expect(state.profiles['account:a']).toMatchObject({
      kind: 'account', status: 'signed-out', syncPaused: true,
      pendingOutboxCount: 3, pendingAssetTransfers: 1,
    });

    state = signInAccount(state, 'b');
    expect(state.activeProfileKey).toBe('account:b');
    expect(state.profiles['account:a']).toMatchObject({ pendingOutboxCount: 3, status: 'signed-out' });

    state = signInAccount(state, 'a');
    expect(state.profiles['account:a']).toMatchObject({ status: 'signed-in', syncPaused: false, pendingOutboxCount: 3 });
  });

  it('rejects late account-A responses after switching to B or resuming A under a new generation', () => {
    let state = signInAccount(createProfileRegistry(), 'a');
    const a1 = state.sessionGeneration;
    expect(canApplySyncResponse(state, 'a', a1)).toBe(true);

    state = signInAccount(state, 'b');
    expect(canApplySyncResponse(state, 'a', a1)).toBe(false);
    expect(canApplySyncResponse(state, 'b', state.sessionGeneration)).toBe(true);

    state = signInAccount(state, 'a');
    expect(canApplySyncResponse(state, 'a', a1)).toBe(false);
    expect(canApplySyncResponse(state, 'a', state.sessionGeneration)).toBe(true);
  });

  it('blocks local cache removal while unsynced-only work or transfers remain', () => {
    let state = signInAccount(createProfileRegistry(), 'a');
    state = updatePendingCounts(state, 'a', 1, 0);
    state = signOutAccount(state, 'a');
    const profile = state.profiles['account:a'];
    if (!profile || profile.kind !== 'account') throw new Error('missing account profile');
    expect(canRemoveAccountCache(profile)).toEqual({ allowed: false, reason: 'UNSYNCED_OUTBOX' });

    state = updatePendingCounts(state, 'a', 0, 1);
    const withTransfer = state.profiles['account:a'];
    if (!withTransfer || withTransfer.kind !== 'account') throw new Error('missing account profile');
    expect(canRemoveAccountCache(withTransfer)).toEqual({ allowed: false, reason: 'PENDING_ASSET_TRANSFER' });

    state = updatePendingCounts(state, 'a', 0, 0);
    const safe = state.profiles['account:a'];
    if (!safe || safe.kind !== 'account') throw new Error('missing account profile');
    expect(canRemoveAccountCache(safe)).toEqual({ allowed: true });
  });

  it('global sign-out pauses all account profiles without deleting their databases', () => {
    let state = signInAccount(createProfileRegistry(), 'a');
    state = signInAccount(state, 'b');
    state = globalSignOut(state);
    expect(state.activeProfileKey).toBe('local-only');
    expect(state.profiles['account:a']).toMatchObject({ status: 'signed-out', syncPaused: true });
    expect(state.profiles['account:b']).toMatchObject({ status: 'signed-out', syncPaused: true });
  });

  it('marks a remotely deleted account as non-syncable while retaining local recovery data', () => {
    let state = signInAccount(createProfileRegistry(), 'a');
    state = updatePendingCounts(state, 'a', 2, 0);
    state = markRemoteAccountDeleted(state, 'a');
    expect(state.activeProfileKey).toBe('local-only');
    expect(state.profiles['account:a']).toMatchObject({
      status: 'remote-deleted', syncPaused: true, pendingOutboxCount: 2,
    });
  });
});

describe('Phase 6A asset state model', () => {
  it('distinguishes a known remote asset from a genuinely missing local file', () => {
    const remote = remoteKnownAssetState('asset-1');
    expect(remote).toMatchObject({
      localState: 'remote_known_not_downloaded', remoteState: 'ready', uploadState: 'not_required',
    });
    const missing = reduceAssetState(remote, { type: 'LOCAL_FILE_MISSING' });
    expect(missing).toMatchObject({ localState: 'missing', remoteState: 'ready' });
  });

  it('keeps migrated local images not_scheduled until sync explicitly queues upload', () => {
    let state = localUnscheduledAssetState('asset-1');
    expect(state).toMatchObject({ localState: 'available', remoteState: 'unknown', uploadState: 'not_scheduled', uploadAttempts: 0 });
    state = reduceAssetState(state, { type: 'QUEUE_UPLOAD' });
    expect(state).toMatchObject({ uploadState: 'pending', uploadAttempts: 1 });
    state = reduceAssetState(state, { type: 'UPLOAD_READY' });
    expect(state).toMatchObject({ uploadState: 'uploaded', remoteState: 'ready' });
  });

  it('supports not_scheduled -> pending -> failed -> pending -> uploaded retry flow', () => {
    let state = localUnscheduledAssetState('asset-retry');
    state = reduceAssetState(state, { type: 'QUEUE_UPLOAD' });
    state = reduceAssetState(state, { type: 'UPLOAD_FAILED', errorCode: 'NETWORK' });
    expect(state).toMatchObject({ uploadState: 'failed', uploadAttempts: 1 });
    state = reduceAssetState(state, { type: 'QUEUE_UPLOAD' });
    state = reduceAssetState(state, { type: 'UPLOAD_READY' });
    expect(state).toMatchObject({ uploadState: 'uploaded', remoteState: 'ready', uploadAttempts: 2 });
  });

  it('models upload retry independently from local availability', () => {
    let state = localPendingAssetState('asset-1');
    state = reduceAssetState(state, { type: 'QUEUE_UPLOAD' });
    state = reduceAssetState(state, { type: 'UPLOAD_FAILED', errorCode: 'NETWORK' });
    expect(state).toMatchObject({ localState: 'available', uploadState: 'failed', remoteState: 'unknown', uploadAttempts: 1 });
    state = reduceAssetState(state, { type: 'QUEUE_UPLOAD' });
    state = reduceAssetState(state, { type: 'UPLOAD_READY' });
    expect(state).toMatchObject({ localState: 'available', uploadState: 'uploaded', remoteState: 'ready', uploadAttempts: 2 });
  });

  it('models download pending/failure/retry without overloading imagePath', () => {
    let state = remoteKnownAssetState('asset-1');
    state = reduceAssetState(state, { type: 'QUEUE_DOWNLOAD' });
    expect(state).toMatchObject({ localState: 'download_pending', downloadAttempts: 1 });
    state = reduceAssetState(state, { type: 'DOWNLOAD_FAILED', errorCode: 'TIMEOUT' });
    expect(state).toMatchObject({ localState: 'download_failed', lastErrorCode: 'TIMEOUT' });
    state = reduceAssetState(state, { type: 'QUEUE_DOWNLOAD' });
    state = reduceAssetState(state, { type: 'DOWNLOAD_AVAILABLE' });
    expect(state).toMatchObject({ localState: 'available', downloadAttempts: 2, lastErrorCode: null });
  });
});
