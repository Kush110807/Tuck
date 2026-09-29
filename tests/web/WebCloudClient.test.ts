import { describe, expect, it, vi } from 'vitest';
import { WebCloudClient } from '../../src/web/WebCloudClient';
import type { SupabaseSyncTransport } from '../../src/sync/transport/SupabaseSyncTransport';
import type { SupabaseAssetTransport } from '../../src/sync/transport/SupabaseAssetTransport';

type BootstrapMethod = SupabaseSyncTransport['bootstrap'];
type PullMethod = SupabaseSyncTransport['pullChanges'];
type PushMethod = SupabaseSyncTransport['pushMutations'];
type DownloadMethod = SupabaseAssetTransport['download'];

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const DEVICE = '22222222-2222-4222-8222-222222222222';

function note(version = 1, body = 'Body') {
  return {
    id: '33333333-3333-4333-8333-333333333333', type: 'note' as const, title: 'Plan', body, url: null,
    assetId: null, tags: ['Work'], collectionId: null, pinned: false, archived: false,
    createdAt: 1, updatedAt: version, version,
  };
}

function makeClient(overrides: Partial<{ bootstrap: BootstrapMethod; pull: PullMethod; push: PushMethod; download: DownloadMethod }> = {}) {
  const defaultBootstrap: BootstrapMethod = async () => ({
    kind: 'page', protocolVersion: 1, accountId: ACCOUNT, sessionId: 's', snapshotHeadSequence: 1,
    entries: [{ ordinal: 1, snapshot: { entityType: 'item', entity: note() } }], nextAfterOrdinal: null,
    expiresAtEpochMs: Date.now() + 60_000,
  });
  const defaultPull: PullMethod = async request => ({
    kind: 'page', protocolVersion: 1, accountId: ACCOUNT, changes: [], nextAfterSequence: request.afterSequence,
    targetHeadSequence: request.afterSequence, minimumRetainedSequence: 1, hasMore: false,
  });
  const defaultPush: PushMethod = async request => ({
    kind: 'ok', protocolVersion: 1, accountId: ACCOUNT, headSequence: 2,
    results: request.mutations.map(mutation => ({
      kind: 'accepted' as const, mutationId: mutation.mutationId, serverVersion: 2, changeSequence: 2, changed: true, warnings: [],
      canonical: { entityType: 'item' as const, entity: { ...note(2, 'newValues' in mutation && 'body' in mutation.newValues ? mutation.newValues.body ?? 'Body' : 'Body'), id: mutation.entityId, title: 'newValues' in mutation && 'title' in mutation.newValues ? mutation.newValues.title ?? 'Plan' : 'Plan' } },
    })),
  });
  const defaultDownload: DownloadMethod = async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' });
  const bootstrap = vi.fn<BootstrapMethod>(overrides.bootstrap ?? defaultBootstrap);
  const pull = vi.fn<PullMethod>(overrides.pull ?? defaultPull);
  const push = vi.fn<PushMethod>(overrides.push ?? defaultPush);
  const download = vi.fn<DownloadMethod>(overrides.download ?? defaultDownload);
  const sync = { bootstrap, pullChanges: pull, pushMutations: push } as unknown as SupabaseSyncTransport;
  const assets = { download } as unknown as SupabaseAssetTransport;
  return { client: new WebCloudClient(ACCOUNT, DEVICE, sync, assets), bootstrap, pull, push, download };
}

describe('Phase 6D cloud-first web client', () => {
  it('loads authenticated canonical state with bootstrap then finite pull', async () => {
    const { client, bootstrap, pull } = makeClient();
    await client.initialLoad();
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(pull).toHaveBeenCalled();
    expect(client.snapshot().items).toEqual([note()]);
    expect(client.snapshot().loading).toBe(false);
  });

  it('creates and edits through the frozen push protocol and refreshes canonical state', async () => {
    const { client, push } = makeClient();
    await client.initialLoad();
    await client.createNote('New', 'Draft');
    const createdMutation = push.mock.calls[0][0].mutations[0];
    expect(createdMutation).toMatchObject({ accountId: ACCOUNT, originDeviceId: DEVICE, entityType: 'item', action: 'create' });
    expect(createdMutation.mutationId).toMatch(/^[0-9a-f-]{36}$/i);

    const created = client.snapshot().items.find(item => item.id === createdMutation.entityId)!;
    await client.patchItem(created.id, { body: 'Edited', pinned: true });
    const patch = push.mock.calls[1][0].mutations[0];
    expect(patch).toMatchObject({ entityType: 'item', action: 'patch', baseServerVersion: 2 });
    expect(patch.changedFields).toEqual(expect.arrayContaining(['body', 'pinned', 'updatedAt']));
  });

  it('downloads a ready private Asset once and reuses the browser object URL cache', async () => {
    const assetId = '44444444-4444-4444-8444-444444444444';
    const { client, download } = makeClient({
      bootstrap: async () => ({
        kind: 'page', protocolVersion: 1, accountId: ACCOUNT, sessionId: 's', snapshotHeadSequence: 1,
        entries: [{ ordinal: 1, snapshot: { entityType: 'asset', entity: { id: assetId, mimeType: 'image/png', byteSize: 3, remoteState: 'ready', version: 1 } } }],
        nextAfterOrdinal: null, expiresAtEpochMs: Date.now() + 60_000,
      }),
    });
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:tuck-image');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    try {
      await client.initialLoad();
      await expect(client.imageUrl(assetId)).resolves.toBe('blob:tuck-image');
      await expect(client.imageUrl(assetId)).resolves.toBe('blob:tuck-image');
      expect(download).toHaveBeenCalledTimes(1);
      client.dispose();
      expect(revoke).toHaveBeenCalledWith('blob:tuck-image');
    } finally {
      create.mockRestore();
      revoke.mockRestore();
    }
  });


  it('retries canonical bootstrap after a failed initial load instead of pulling from partial memory', async () => {
    let attempt = 0;
    const { client, bootstrap, pull } = makeClient({
      bootstrap: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('bootstrap offline');
        return {
          kind: 'page', protocolVersion: 1, accountId: ACCOUNT, sessionId: 'retry', snapshotHeadSequence: 1,
          entries: [{ ordinal: 1, snapshot: { entityType: 'item', entity: note() } }], nextAfterOrdinal: null,
          expiresAtEpochMs: Date.now() + 60_000,
        };
      },
    });
    await client.initialLoad();
    expect(client.snapshot().error).toContain('bootstrap offline');
    await client.refresh();
    expect(bootstrap).toHaveBeenCalledTimes(2);
    expect(pull).toHaveBeenCalledTimes(1);
    expect(client.snapshot().items).toEqual([note()]);
    expect(client.snapshot().error).toBeNull();
  });

  it('performs one clean rebootstrap when pull history is stale', async () => {
    let pulls = 0;
    const { client, bootstrap } = makeClient({
      pull: async (request: any) => {
        pulls += 1;
        if (pulls === 1) return { kind: 'rebootstrap_required', protocolVersion: 1, accountId: ACCOUNT, minimumRetainedSequence: 2, serverHeadSequence: 2 };
        return { kind: 'page', protocolVersion: 1, accountId: ACCOUNT, changes: [], nextAfterSequence: request.afterSequence,
          targetHeadSequence: request.afterSequence, minimumRetainedSequence: 2, hasMore: false };
      },
    });
    await client.initialLoad();
    expect(bootstrap).toHaveBeenCalledTimes(2);
    expect(client.snapshot().error).toBeNull();
  });
});
