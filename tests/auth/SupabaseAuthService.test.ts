import { describe, expect, it, vi } from 'vitest';
import { ExpoSecureStoreAuthStorage, MemoryAuthStorage, SupabaseAuthService } from '../../src/auth';
import { readSupabasePublicConfig } from '../../src/config/supabase';

const CONFIG = { url: 'https://example.supabase.co', anonKey: 'public-anon-key' } as const;

function token(overrides: Record<string, unknown> = {}) {
  return {
    access_token: 'access-1',
    refresh_token: 'refresh-1',
    expires_in: 3600,
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'a@example.com' },
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('Phase 6B Supabase auth foundation', () => {
  it('adapts an Expo SecureStore-compatible implementation without importing UI or navigation', async () => {
    const values = new Map<string, string>();
    const secureStore = {
      getItemAsync: vi.fn(async (key: string) => values.get(key) ?? null),
      setItemAsync: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
      deleteItemAsync: vi.fn(async (key: string) => { values.delete(key); }),
    };
    const storage = new ExpoSecureStoreAuthStorage(secureStore);
    await storage.setItem('k', 'v');
    await expect(storage.getItem('k')).resolves.toBe('v');
    await storage.removeItem('k');
    await expect(storage.getItem('k')).resolves.toBeNull();
  });

  it('treats missing public config as local-only capable instead of gating app boot', () => {
    expect(readSupabasePublicConfig({})).toBeNull();
    expect(() => readSupabasePublicConfig({ EXPO_PUBLIC_SUPABASE_URL: 'https://x.test' })).toThrow();
  });

  it('restores no session without making a network request', async () => {
    const fetchImpl = vi.fn();
    const service = new SupabaseAuthService(CONFIG, new MemoryAuthStorage(), fetchImpl as typeof fetch);
    await expect(service.restoreSession()).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(service.currentState()).toMatchObject({ kind: 'signed_out', generation: 0 });
  });

  it('persists and restores a verified token response', async () => {
    const storage = new MemoryAuthStorage();
    const service = new SupabaseAuthService(CONFIG, storage, vi.fn() as unknown as typeof fetch, () => 1_000);
    const accepted = await service.acceptTokenResponse(token());
    expect(accepted.user.email).toBe('a@example.com');
    expect(service.sessionGeneration()).toBe(1);

    const restored = new SupabaseAuthService(CONFIG, storage, vi.fn() as unknown as typeof fetch, () => 2_000);
    await expect(restored.restoreSession()).resolves.toMatchObject({ accessToken: 'access-1' });
  });

  it('refreshes an expired/restored session and maps the new account session', async () => {
    const storage = new MemoryAuthStorage();
    const seed = new SupabaseAuthService(CONFIG, storage, vi.fn() as unknown as typeof fetch, () => 1_000);
    await seed.acceptTokenResponse(token({ expires_in: 1 }));

    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain('/auth/v1/token?grant_type=refresh_token');
      return jsonResponse(token({ access_token: 'access-2', refresh_token: 'refresh-2' }));
    });
    const service = new SupabaseAuthService(CONFIG, storage, fetchImpl as unknown as typeof fetch, () => 5_000);
    await expect(service.restoreSession()).resolves.toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-2' });
    expect(service.isGenerationCurrent(service.sessionGeneration())).toBe(true);
  });

  it('initiates email magic-link auth through the Supabase OTP endpoint', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://example.supabase.co/auth/v1/otp?redirect_to=tuck%3A%2F%2Fauth%2Fcallback');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ email: 'n@example.com', create_user: true });
      return jsonResponse({});
    });
    const service = new SupabaseAuthService(CONFIG, new MemoryAuthStorage(), fetchImpl as unknown as typeof fetch);
    await service.requestMagicLink('  n@example.com  ', 'tuck://auth/callback');
  });

  it('clears the local session on current-device sign-out even if revocation is offline', async () => {
    const storage = new MemoryAuthStorage();
    const service = new SupabaseAuthService(
      CONFIG,
      storage,
      vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch,
      () => 1_000,
    );
    await service.acceptTokenResponse(token());
    const before = service.sessionGeneration();
    await expect(service.signOutCurrentDevice()).rejects.toMatchObject({ code: 'NETWORK' });
    expect(service.currentSession()).toBeNull();
    expect(service.sessionGeneration()).toBe(before + 1);
  });

  it('uses global scope for global sign-out', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain('/auth/v1/logout?scope=global');
      return new Response('', { status: 204 });
    });
    const service = new SupabaseAuthService(CONFIG, new MemoryAuthStorage(), fetchImpl as unknown as typeof fetch, () => 1_000);
    await service.acceptTokenResponse(token());
    await service.signOutGlobally();
    expect(service.currentSession()).toBeNull();
  });

  it('exposes the authenticated account-deletion boundary without deleting local data itself', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/rpc/tuck_request_account_deletion')) {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1');
        return jsonResponse({ kind: 'ok', status: 'deleting' });
      }
      return jsonResponse({});
    });
    const service = new SupabaseAuthService(CONFIG, new MemoryAuthStorage(), fetchImpl as unknown as typeof fetch, () => 1_000);
    await service.acceptTokenResponse(token());
    await expect(service.requestAccountDeletion()).resolves.toBeUndefined();
  });
});
