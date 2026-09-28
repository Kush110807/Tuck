import { describe, expect, it } from 'vitest';
import {
  SYNC_PROTOCOL_VERSION,
  type CanonicalCollection,
  type CanonicalItem,
  type CollectionDeleteMutation,
  type CollectionPatchMutation,
  type ItemDeleteMutation,
  type ItemPatchMutation,
  type PushMutationsRequest,
} from '../../src/sync/protocol';
import { FakeSyncServer } from '../../src/sync/reference';

const ACCOUNT = 'account-a';
const DEVICE_A = 'device-a';
const DEVICE_B = 'device-b';

function collection(overrides: Partial<CanonicalCollection> = {}): CanonicalCollection {
  return {
    id: 'collection-1', name: 'Work', nameKey: 'work', createdAt: 10, updatedAt: 10, version: 1,
    ...overrides,
  };
}

function note(overrides: Partial<CanonicalItem> = {}): CanonicalItem {
  return {
    id: 'item-1', type: 'note', title: 'Title', body: 'Body', url: null, assetId: null,
    tags: ['Work'], collectionId: null, pinned: false, archived: false,
    createdAt: 10, updatedAt: 10, version: 1,
    ...overrides,
  };
}

function itemPatch(
  mutationId: string,
  baseServerVersion: number,
  changedFields: ItemPatchMutation['changedFields'],
  baseValues: ItemPatchMutation['baseValues'],
  newValues: ItemPatchMutation['newValues'],
  originDeviceId = DEVICE_A,
): ItemPatchMutation {
  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    accountId: ACCOUNT,
    mutationId,
    originDeviceId,
    entityType: 'item',
    entityId: 'item-1',
    action: 'patch',
    baseServerVersion,
    changedFields,
    baseValues,
    newValues,
  };
}

function collectionPatch(
  mutationId: string,
  baseServerVersion: number,
  baseName: string,
  nextName: string,
  updatedAt: number,
  originDeviceId = DEVICE_A,
): CollectionPatchMutation {
  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    accountId: ACCOUNT,
    mutationId,
    originDeviceId,
    entityType: 'collection',
    entityId: 'collection-1',
    action: 'patch',
    baseServerVersion,
    changedFields: ['name', 'updatedAt'],
    baseValues: { name: baseName },
    newValues: { name: nextName, updatedAt },
  };
}

function itemDelete(mutationId: string, baseServerVersion: number, originDeviceId = DEVICE_A): ItemDeleteMutation {
  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    accountId: ACCOUNT,
    mutationId,
    originDeviceId,
    entityType: 'item',
    entityId: 'item-1',
    action: 'delete',
    baseServerVersion,
    changedFields: [],
    baseValues: {},
    newValues: {},
  };
}

function collectionDelete(mutationId: string, baseServerVersion: number): CollectionDeleteMutation {
  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    accountId: ACCOUNT,
    mutationId,
    originDeviceId: DEVICE_A,
    entityType: 'collection',
    entityId: 'collection-1',
    action: 'delete',
    baseServerVersion,
    changedFields: [],
    baseValues: {},
    newValues: {},
  };
}

function push(server: FakeSyncServer, mutations: PushMutationsRequest['mutations']) {
  const response = server.push({ protocolVersion: SYNC_PROTOCOL_VERSION, accountId: ACCOUNT, mutations });
  expect(response.kind).toBe('ok');
  if (response.kind !== 'ok') throw new Error(response.message);
  return response;
}

describe('Phase 6A fake server mutation semantics', () => {
  it('serializes duplicate submissions idempotently without a second logical change', () => {
    const server = new FakeSyncServer(ACCOUNT, { now: () => 1000 });
    server.seedItem(note());
    const mutation = itemPatch('m1', 1, ['title', 'updatedAt'], { title: 'Title' }, { title: 'New', updatedAt: 20 });

    const first = push(server, [mutation]);
    const headAfterFirst = server.getHeadSequence();
    const second = push(server, [mutation]);

    expect(second.results[0]).toEqual(first.results[0]);
    expect(server.getHeadSequence()).toBe(headAfterFirst);
    expect(server.getItem('item-1')).toMatchObject({ title: 'New', version: 2 });
  });

  it('keeps an old mutation retry idempotent even after a later mutation succeeded', () => {
    const server = new FakeSyncServer(ACCOUNT);
    server.seedItem(note());
    const first = itemPatch('m1', 1, ['title', 'updatedAt'], { title: 'Title' }, { title: 'One', updatedAt: 20 });
    push(server, [first]);
    const second = itemPatch('m2', 2, ['body', 'updatedAt'], { body: 'Body' }, { body: 'Two', updatedAt: 30 });
    push(server, [second]);
    const head = server.getHeadSequence();

    const retry = push(server, [first]);
    expect(retry.results[0].kind).toBe('accepted');
    expect(server.getHeadSequence()).toBe(head);
    expect(server.getItem('item-1')).toMatchObject({ title: 'One', body: 'Two', version: 3 });
  });

  it('auto-merges disjoint title/body edits across a server-version mismatch', () => {
    const server = new FakeSyncServer(ACCOUNT);
    server.seedItem(note());
    push(server, [itemPatch('a-title', 1, ['title', 'updatedAt'], { title: 'Title' }, { title: 'A title', updatedAt: 20 })]);

    const staleBody = itemPatch(
      'b-body', 1, ['body', 'updatedAt'], { body: 'Body' }, { body: 'B body', updatedAt: 21 }, DEVICE_B,
    );
    const result = push(server, [staleBody]).results[0];

    expect(result.kind).toBe('accepted');
    expect(server.getItem('item-1')).toMatchObject({ title: 'A title', body: 'B body', version: 3 });
  });

  it('returns a conflict for concurrent body/body authored edits', () => {
    const server = new FakeSyncServer(ACCOUNT);
    server.seedItem(note());
    push(server, [itemPatch('a-body', 1, ['body', 'updatedAt'], { body: 'Body' }, { body: 'A body', updatedAt: 20 })]);
    const result = push(server, [
      itemPatch('b-body', 1, ['body', 'updatedAt'], { body: 'Body' }, { body: 'B body', updatedAt: 21 }, DEVICE_B),
    ]).results[0];

    expect(result).toMatchObject({ kind: 'conflict', reason: 'AUTHORED_FIELD_CONFLICT', conflictFields: ['body'] });
    expect(server.getItem('item-1')?.body).toBe('A body');
  });

  it('returns a conflict for concurrent title/title authored edits', () => {
    const server = new FakeSyncServer(ACCOUNT);
    server.seedItem(note());
    push(server, [itemPatch('a-title', 1, ['title', 'updatedAt'], { title: 'Title' }, { title: 'A', updatedAt: 20 })]);
    const result = push(server, [
      itemPatch('b-title', 1, ['title', 'updatedAt'], { title: 'Title' }, { title: 'B', updatedAt: 21 }, DEVICE_B),
    ]).results[0];

    expect(result).toMatchObject({ kind: 'conflict', reason: 'AUTHORED_FIELD_CONFLICT', conflictFields: ['title'] });
  });

  it('three-way merges tags with removal-by-either-side and unioned additions', () => {
    const server = new FakeSyncServer(ACCOUNT);
    server.seedItem(note({ tags: ['Study', 'Reading'] }));
    push(server, [
      itemPatch('a-tags', 1, ['tags', 'updatedAt'], { tags: ['Study', 'Reading'] }, { tags: ['Study', 'Important'], updatedAt: 20 }),
    ]);
    const result = push(server, [
      itemPatch(
        'b-tags', 1, ['tags', 'updatedAt'], { tags: ['Study', 'Reading'] },
        { tags: ['Study', 'Reading', 'Build'], updatedAt: 21 }, DEVICE_B,
      ),
    ]).results[0];

    expect(result.kind).toBe('accepted');
    expect(server.getItem('item-1')?.tags).toEqual(['Study', 'Important', 'Build']);
  });

  it('resolves pin concurrency by server processing order without using updatedAt', () => {
    const server = new FakeSyncServer(ACCOUNT);
    server.seedItem(note());
    push(server, [itemPatch('pin-a', 1, ['pinned'], { pinned: false }, { pinned: true })]);
    const result = push(server, [
      itemPatch('pin-b', 1, ['pinned'], { pinned: false }, { pinned: false }, DEVICE_B),
    ]).results[0];

    expect(result.kind).toBe('accepted');
    expect(server.getItem('item-1')).toMatchObject({ pinned: false, updatedAt: 10, version: 3 });
  });

  it('resolves archive/restore concurrency by server processing order', () => {
    const server = new FakeSyncServer(ACCOUNT);
    server.seedItem(note());
    push(server, [itemPatch('archive-a', 1, ['archived', 'updatedAt'], { archived: false }, { archived: true, updatedAt: 20 })]);
    push(server, [
      itemPatch('restore-b', 1, ['archived', 'updatedAt'], { archived: false }, { archived: false, updatedAt: 21 }, DEVICE_B),
    ]);
    expect(server.getItem('item-1')).toMatchObject({ archived: false, updatedAt: 21, version: 3 });
  });

  it('merges content edit versus archive because the fields are disjoint', () => {
    const server = new FakeSyncServer(ACCOUNT);
    server.seedItem(note());
    push(server, [itemPatch('archive', 1, ['archived', 'updatedAt'], { archived: false }, { archived: true, updatedAt: 20 })]);
    const result = push(server, [
      itemPatch('body', 1, ['body', 'updatedAt'], { body: 'Body' }, { body: 'Edited offline', updatedAt: 21 }, DEVICE_B),
    ]).results[0];
    expect(result.kind).toBe('accepted');
    expect(server.getItem('item-1')).toMatchObject({ archived: true, body: 'Edited offline', version: 3 });
  });

  it('returns an explicit collection rename conflict', () => {
    const server = new FakeSyncServer(ACCOUNT);
    server.seedCollection(collection());
    push(server, [collectionPatch('rename-a', 1, 'Work', 'Projects', 20)]);
    const result = push(server, [collectionPatch('rename-b', 1, 'Work', 'Office', 21, DEVICE_B)]).results[0];
    expect(result).toMatchObject({ kind: 'conflict', reason: 'COLLECTION_RENAME_CONFLICT', conflictFields: ['name'] });
  });

  it('lets Collection deletion win over assignment and emits an unfiled item version without changing updatedAt', () => {
    const server = new FakeSyncServer(ACCOUNT);
    server.seedCollection(collection());
    server.seedItem(note({ collectionId: 'collection-1' }));

    const result = push(server, [collectionDelete('delete-c', 1)]).results[0];
    expect(result.kind).toBe('accepted');
    expect(server.getCollection('collection-1')).toBeNull();
    expect(server.getItem('item-1')).toMatchObject({ collectionId: null, updatedAt: 10, version: 2 });
    expect(server.getTombstone('collection', 'collection-1')).not.toBeNull();
  });

  it('coerces an offline assignment to a now-deleted Collection back to Unfiled', () => {
    const server = new FakeSyncServer(ACCOUNT);
    server.seedCollection(collection());
    server.seedItem(note({ collectionId: 'collection-1' }));
    push(server, [collectionDelete('delete-c', 1)]);

    const result = push(server, [
      itemPatch(
        'assign-stale', 1, ['collectionId', 'updatedAt'], { collectionId: 'collection-1' },
        { collectionId: 'collection-1', updatedAt: 50 }, DEVICE_B,
      ),
    ]).results[0];
    expect(result.kind).toBe('accepted');
    if (result.kind === 'accepted') expect(result.warnings).toContain('COLLECTION_DELETED_COERCED_TO_UNFILED');
    expect(server.getItem('item-1')?.collectionId).toBeNull();
  });

  it('preserves a remote delete as a tombstone and conflicts a later offline edit', () => {
    const server = new FakeSyncServer(ACCOUNT);
    server.seedItem(note());
    push(server, [itemDelete('delete-a', 1)]);
    const result = push(server, [
      itemPatch('offline-edit', 1, ['body', 'updatedAt'], { body: 'Body' }, { body: 'Offline', updatedAt: 30 }, DEVICE_B),
    ]).results[0];
    expect(result).toMatchObject({ kind: 'conflict', reason: 'REMOTE_DELETED' });
    expect(server.getItem('item-1')).toBeNull();
    expect(server.getTombstone('item', 'item-1')).not.toBeNull();
  });

  it('rejects a stale delete after the server item changed, protecting authored content', () => {
    const server = new FakeSyncServer(ACCOUNT);
    server.seedItem(note());
    push(server, [itemPatch('edit-a', 1, ['body', 'updatedAt'], { body: 'Body' }, { body: 'New remote', updatedAt: 20 })]);
    const result = push(server, [itemDelete('delete-b', 1, DEVICE_B)]).results[0];
    expect(result).toMatchObject({ kind: 'conflict', reason: 'STALE_DELETE' });
    expect(server.getItem('item-1')?.body).toBe('New remote');
  });

  it('does not use the client clock as the concurrency authority', () => {
    const server = new FakeSyncServer(ACCOUNT);
    server.seedItem(note());
    push(server, [
      itemPatch('bad-clock', 1, ['title', 'updatedAt'], { title: 'Title' }, { title: 'Future clock', updatedAt: 9_999_999_999_999 }),
    ]);
    const result = push(server, [
      itemPatch('normal-clock', 1, ['body', 'updatedAt'], { body: 'Body' }, { body: 'Still merges', updatedAt: 11 }, DEVICE_B),
    ]).results[0];
    expect(result.kind).toBe('accepted');
    expect(server.getItem('item-1')).toMatchObject({ title: 'Future clock', body: 'Still merges', version: 3 });
  });

  it('rejects malformed mutations and wrong-account requests deterministically', () => {
    const server = new FakeSyncServer(ACCOUNT);
    server.seedItem(note());
    const malformed = { mutationId: 'bad' } as never;
    const malformedResult = push(server, [malformed]).results[0];
    expect(malformedResult).toMatchObject({ kind: 'rejected', code: 'MALFORMED_MUTATION' });

    const wrong = server.push(
      { protocolVersion: SYNC_PROTOCOL_VERSION, accountId: ACCOUNT, mutations: [] },
      'account-b',
    );
    expect(wrong).toMatchObject({ kind: 'error', code: 'WRONG_ACCOUNT' });
  });
});

describe('Phase 6A bootstrap, pull and retention semantics', () => {
  it('materializes a frozen second-device bootstrap snapshot with a corresponding head sequence', () => {
    const server = new FakeSyncServer(ACCOUNT, { now: () => 1000 });
    server.seedCollection(collection());
    server.seedItem(note({ collectionId: 'collection-1' }));

    const first = server.bootstrap({ protocolVersion: SYNC_PROTOCOL_VERSION, accountId: ACCOUNT, pageSize: 1 });
    expect(first.kind).toBe('page');
    if (first.kind !== 'page') throw new Error('bootstrap failed');
    expect(first.snapshotHeadSequence).toBe(0);
    expect(first.entries).toHaveLength(1);

    const second = server.bootstrap({
      protocolVersion: SYNC_PROTOCOL_VERSION,
      accountId: ACCOUNT,
      pageSize: 10,
      sessionId: first.sessionId,
      afterOrdinal: first.nextAfterOrdinal ?? 0,
    });
    expect(second.kind).toBe('page');
    if (second.kind !== 'page') throw new Error('bootstrap failed');
    expect([...first.entries, ...second.entries].map(entry => entry.snapshot.entityType)).toEqual(['collection', 'item']);
    expect(second.nextAfterOrdinal).toBeNull();
  });

  it('does not let a mutation during bootstrap get skipped', () => {
    const server = new FakeSyncServer(ACCOUNT);
    server.seedCollection(collection());
    server.seedItem(note());
    const first = server.bootstrap({ protocolVersion: SYNC_PROTOCOL_VERSION, accountId: ACCOUNT, pageSize: 1 });
    expect(first.kind).toBe('page');
    if (first.kind !== 'page') throw new Error('bootstrap failed');

    push(server, [itemPatch('during-bootstrap', 1, ['body', 'updatedAt'], { body: 'Body' }, { body: 'Changed', updatedAt: 20 })]);

    const resumed = server.bootstrap({
      protocolVersion: SYNC_PROTOCOL_VERSION,
      accountId: ACCOUNT,
      pageSize: 10,
      sessionId: first.sessionId,
      afterOrdinal: first.nextAfterOrdinal ?? 0,
    });
    expect(resumed.kind).toBe('page');
    if (resumed.kind !== 'page') throw new Error('bootstrap failed');
    const bootstrappedItem = resumed.entries.find(entry => entry.snapshot.entityType === 'item');
    if (!bootstrappedItem || bootstrappedItem.snapshot.entityType !== 'item') throw new Error('missing item');
    expect(bootstrappedItem.snapshot.entity.body).toBe('Body');

    const catchup = server.pull({
      protocolVersion: SYNC_PROTOCOL_VERSION,
      accountId: ACCOUNT,
      afterSequence: first.snapshotHeadSequence,
      limit: 10,
    });
    expect(catchup.kind).toBe('page');
    if (catchup.kind !== 'page') throw new Error('pull failed');
    expect(catchup.changes).toHaveLength(1);
    expect(catchup.changes[0].entityVersion).toBe(2);
    expect(catchup.nextAfterSequence).toBe(catchup.targetHeadSequence);
  });

  it('resumes an interrupted bootstrap from the same immutable session', () => {
    const server = new FakeSyncServer(ACCOUNT);
    server.seedCollection(collection());
    server.seedItem(note());
    const first = server.bootstrap({ protocolVersion: SYNC_PROTOCOL_VERSION, accountId: ACCOUNT, pageSize: 1 });
    expect(first.kind).toBe('page');
    if (first.kind !== 'page' || first.nextAfterOrdinal === null) throw new Error('expected another page');

    const resumed = server.bootstrap({
      protocolVersion: SYNC_PROTOCOL_VERSION,
      accountId: ACCOUNT,
      pageSize: 1,
      sessionId: first.sessionId,
      afterOrdinal: first.nextAfterOrdinal,
    });
    expect(resumed.kind).toBe('page');
    if (resumed.kind !== 'page') throw new Error('bootstrap failed');
    expect(resumed.sessionId).toBe(first.sessionId);
    expect(resumed.snapshotHeadSequence).toBe(first.snapshotHeadSequence);
    expect(resumed.entries[0].ordinal).toBe(2);
  });

  it('replays the same pull deterministically and uses a finite captured target head', () => {
    const server = new FakeSyncServer(ACCOUNT);
    server.seedItem(note());
    push(server, [itemPatch('m1', 1, ['title', 'updatedAt'], { title: 'Title' }, { title: 'One', updatedAt: 20 })]);
    push(server, [itemPatch('m2', 2, ['body', 'updatedAt'], { body: 'Body' }, { body: 'Two', updatedAt: 30 })]);

    const request = { protocolVersion: SYNC_PROTOCOL_VERSION, accountId: ACCOUNT, afterSequence: 0, limit: 1 } as const;
    const first = server.pull(request);
    const repeated = server.pull(request);
    expect(repeated).toEqual(first);
    expect(first.kind).toBe('page');
    if (first.kind !== 'page') throw new Error('pull failed');
    expect(first.hasMore).toBe(true);

    const second = server.pull({ ...request, afterSequence: first.nextAfterSequence, targetHeadSequence: first.targetHeadSequence });
    expect(second.kind).toBe('page');
    if (second.kind !== 'page') throw new Error('pull failed');
    expect(second.hasMore).toBe(false);
    expect(second.nextAfterSequence).toBe(first.targetHeadSequence);
  });

  it('returns rebootstrap_required when a cursor falls below retained change history', () => {
    const server = new FakeSyncServer(ACCOUNT);
    server.seedItem(note());
    push(server, [itemPatch('m1', 1, ['title', 'updatedAt'], { title: 'Title' }, { title: 'One', updatedAt: 20 })]);
    push(server, [itemPatch('m2', 2, ['body', 'updatedAt'], { body: 'Body' }, { body: 'Two', updatedAt: 30 })]);
    server.pruneChangesBefore(2);

    const response = server.pull({ protocolVersion: SYNC_PROTOCOL_VERSION, accountId: ACCOUNT, afterSequence: 0, limit: 10 });
    expect(response).toMatchObject({ kind: 'rebootstrap_required', minimumRetainedSequence: 2, serverHeadSequence: 2 });
    expect(server.getTombstone('item', 'item-1')).toBeNull();
  });
});
