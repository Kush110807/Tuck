import { describe, expect, it } from 'vitest';
import {
  DESIGNED_LOCAL_SCHEMA_VERSION,
  SYNC_PROTOCOL_VERSION,
  canonicalMutableCollectionValues,
  canonicalMutableItemValues,
  type ItemPatchMutation,
} from '../../src/sync/protocol';

describe('Phase 6A protocol contract serialization', () => {
  it('freezes protocol v1 and designed local schema v3 without changing the live repository schema', () => {
    expect(SYNC_PROTOCOL_VERSION).toBe(1);
    expect(DESIGNED_LOCAL_SCHEMA_VERSION).toBe(3);
  });

  it('round-trips a mutation as transport-neutral JSON', () => {
    const mutation: ItemPatchMutation = {
      protocolVersion: SYNC_PROTOCOL_VERSION,
      accountId: 'account-a',
      mutationId: '11111111-1111-4111-8111-111111111111',
      originDeviceId: 'device-a',
      entityType: 'item',
      entityId: 'item-1',
      action: 'patch',
      baseServerVersion: 7,
      changedFields: ['title', 'tags', 'updatedAt'],
      baseValues: { title: 'Old', tags: ['Work'] },
      newValues: { title: 'New', tags: ['Work', 'AI'], updatedAt: 100 },
    };
    expect(JSON.parse(JSON.stringify(mutation))).toEqual(mutation);
  });

  it('keeps domain timestamps separate from server versions in canonical values', () => {
    const item = canonicalMutableItemValues({
      id: 'i', type: 'note', title: 'T', body: 'B', url: null, assetId: null, tags: [],
      collectionId: null, pinned: false, archived: false, createdAt: 100, updatedAt: 200, version: 99,
    });
    const collection = canonicalMutableCollectionValues({
      id: 'c', name: 'Work', nameKey: 'work', createdAt: 100, updatedAt: 200, version: 88,
    });
    expect(item.updatedAt).toBe(200);
    expect('version' in item).toBe(false);
    expect(collection.updatedAt).toBe(200);
    expect('version' in collection).toBe(false);
  });
});
