import { describe, expect, it, vi } from 'vitest';
import { SYNC_PROTOCOL_VERSION } from '../../../src/sync/protocol';
import { SupabaseSyncTransport } from '../../../src/sync/transport';

const CONFIG = { url: 'https://example.supabase.co', anonKey: 'public-anon-key' } as const;
const ACCOUNT = '11111111-1111-4111-8111-111111111111';

describe('Phase 6B sync transport boundary', () => {
  it('calls the hardened push RPC without touching local persistence', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://example.supabase.co/rest/v1/rpc/tuck_push_mutations');
      const headers = new Headers(init?.headers);
      expect(headers.get('apikey')).toBe(CONFIG.anonKey);
      expect(headers.get('Authorization')).toBe('Bearer user-token');
      expect(JSON.parse(String(init?.body))).toEqual({
        p_request: { protocolVersion: 1, accountId: ACCOUNT, mutations: [] },
      });
      return new Response(JSON.stringify({ kind: 'ok', protocolVersion: 1, accountId: ACCOUNT, results: [], headSequence: 0 }), { status: 200 });
    });
    const transport = new SupabaseSyncTransport(CONFIG, () => 'user-token', fetchImpl as unknown as typeof fetch);
    await expect(transport.pushMutations({ protocolVersion: SYNC_PROTOCOL_VERSION, accountId: ACCOUNT, mutations: [] }))
      .resolves.toMatchObject({ kind: 'ok', headSequence: 0 });
  });

  it('uses the browser-safe default fetch wrapper', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async function (this: unknown, _input, _init) {
      expect(this).toBe(globalThis);
      return new Response(JSON.stringify({ kind: 'ok', protocolVersion: 1, accountId: ACCOUNT, results: [], headSequence: 0 }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchImpl);
    try {
      const transport = new SupabaseSyncTransport(CONFIG, () => 'user-token');
      await transport.pushMutations({ protocolVersion: SYNC_PROTOCOL_VERSION, accountId: ACCOUNT, mutations: [] });
      expect(fetchImpl).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('calls pull/bootstrap RPCs with the frozen wire request inside p_request', async () => {
    const names: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      names.push(url.split('/').at(-1) ?? '');
      return new Response(JSON.stringify({ kind: 'page' }), { status: 200 });
    });
    const transport = new SupabaseSyncTransport(CONFIG, async () => 'token', fetchImpl as unknown as typeof fetch);
    await transport.pullChanges({ protocolVersion: 1, accountId: ACCOUNT, afterSequence: 0, limit: 100 });
    await transport.bootstrap({ protocolVersion: 1, accountId: ACCOUNT, pageSize: 100 });
    expect(names).toEqual(['tuck_pull_changes', 'tuck_bootstrap']);
  });

  it('rejects calls without an authenticated token', async () => {
    const fetchImpl = vi.fn();
    const transport = new SupabaseSyncTransport(CONFIG, () => null, fetchImpl as unknown as typeof fetch);
    await expect(transport.pullChanges({ protocolVersion: 1, accountId: ACCOUNT, afterSequence: 0, limit: 10 }))
      .rejects.toThrow('Authenticated access token is required');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
