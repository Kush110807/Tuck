import type { SupabasePublicConfig } from '../config/supabase';
import {
  AuthServiceError,
  type AuthSession,
  type AuthState,
  type AuthStateListener,
  type AuthStorage,
} from './types';

const SESSION_STORAGE_KEY = 'tuck.auth.session.v1';
const REFRESH_SKEW_MS = 60_000;

type FetchLike = typeof fetch;

type GoTrueTokenResponse = Readonly<{
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  expires_at?: unknown;
  user?: unknown;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseUser(value: unknown): AuthSession['user'] | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return null;
  return { id: value.id, email: typeof value.email === 'string' ? value.email : null };
}

function parseTokenResponse(value: unknown, now: number): AuthSession | null {
  if (!isRecord(value)) return null;
  const token = value as GoTrueTokenResponse;
  if (typeof token.access_token !== 'string' || !token.access_token ||
      typeof token.refresh_token !== 'string' || !token.refresh_token) return null;
  const user = parseUser(token.user);
  if (!user) return null;

  let expiresAtEpochMs: number | null = null;
  if (typeof token.expires_at === 'number' && Number.isFinite(token.expires_at)) {
    expiresAtEpochMs = Math.trunc(token.expires_at * 1000);
  } else if (typeof token.expires_in === 'number' && Number.isFinite(token.expires_in)) {
    expiresAtEpochMs = now + Math.trunc(token.expires_in * 1000);
  }
  if (expiresAtEpochMs === null || expiresAtEpochMs <= 0) return null;
  return { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAtEpochMs, user };
}

function parseStoredSession(value: string): AuthSession | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed) || typeof parsed.accessToken !== 'string' || typeof parsed.refreshToken !== 'string' ||
        typeof parsed.expiresAtEpochMs !== 'number' || !Number.isFinite(parsed.expiresAtEpochMs)) return null;
    const user = parseUser(parsed.user);
    return user ? {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAtEpochMs: parsed.expiresAtEpochMs,
      user,
    } : null;
  } catch {
    return null;
  }
}

export class SupabaseAuthService {
  private session: AuthSession | null = null;
  private generation = 0;
  private readonly listeners = new Set<AuthStateListener>();

  constructor(
    private readonly config: SupabasePublicConfig,
    private readonly storage: AuthStorage,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  currentSession(): AuthSession | null {
    return this.session;
  }

  currentState(): AuthState {
    return this.session
      ? { kind: 'signed_in', generation: this.generation, session: this.session }
      : { kind: 'signed_out', generation: this.generation };
  }

  sessionGeneration(): number {
    return this.generation;
  }

  isGenerationCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  onAuthStateChange(listener: AuthStateListener): () => void {
    this.listeners.add(listener);
    listener(this.currentState());
    return () => this.listeners.delete(listener);
  }

  async requestMagicLink(email: string, redirectTo?: string): Promise<void> {
    const normalized = email.trim();
    if (!normalized || !normalized.includes('@')) {
      throw new AuthServiceError('AUTH_REJECTED', 'Enter a valid email address.');
    }
    const path = redirectTo
      ? `/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`
      : '/auth/v1/otp';
    await this.request(path, {
      method: 'POST',
      body: JSON.stringify({ email: normalized, create_user: true }),
    }, false);
  }

  /**
   * Callback/deep-link handling can pass the verified GoTrue token response here.
   * Phase 6B intentionally does not add sign-in UI or navigation wiring.
   */
  async acceptTokenResponse(tokenResponse: unknown): Promise<AuthSession> {
    const parsed = parseTokenResponse(tokenResponse, this.now());
    if (!parsed) throw new AuthServiceError('INVALID_RESPONSE', 'Supabase returned an invalid session payload.');
    await this.setSession(parsed);
    return parsed;
  }

  async restoreSession(): Promise<AuthSession | null> {
    const serialized = await this.storage.getItem(SESSION_STORAGE_KEY);
    if (!serialized) {
      this.session = null;
      return null;
    }
    const stored = parseStoredSession(serialized);
    if (!stored) {
      await this.clearLocalSession();
      return null;
    }
    this.session = stored;
    if (stored.expiresAtEpochMs <= this.now() + REFRESH_SKEW_MS) {
      try {
        return await this.refreshSession();
      } catch (error) {
        await this.clearLocalSession();
        throw error;
      }
    }
    this.emit();
    return stored;
  }

  async refreshSession(): Promise<AuthSession> {
    const current = this.session;
    if (!current) throw new AuthServiceError('NO_SESSION', 'No active session is available to refresh.');
    const payload = await this.request(
      '/auth/v1/token?grant_type=refresh_token',
      { method: 'POST', body: JSON.stringify({ refresh_token: current.refreshToken }) },
      false,
    );
    const next = parseTokenResponse(payload, this.now());
    if (!next) throw new AuthServiceError('INVALID_RESPONSE', 'Supabase returned an invalid refreshed session.');
    await this.setSession(next);
    return next;
  }

  async signOutCurrentDevice(): Promise<void> {
    await this.signOut('local');
  }

  async signOutGlobally(): Promise<void> {
    await this.signOut('global');
  }

  async requestAccountDeletion(): Promise<void> {
    const current = this.session;
    if (!current) throw new AuthServiceError('NO_SESSION', 'Sign in before requesting account deletion.');
    await this.request('/rest/v1/rpc/tuck_request_account_deletion', {
      method: 'POST',
      headers: { Authorization: `Bearer ${current.accessToken}` },
      body: '{}',
    }, true);
  }

  private async signOut(scope: 'local' | 'global'): Promise<void> {
    const current = this.session;
    // Local privacy boundary wins over network availability: once sign-out is
    // requested, the active tokens are removed locally even if revocation fails.
    try {
      if (current) {
        await this.request(`/auth/v1/logout?scope=${scope}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${current.accessToken}` },
        }, false);
      }
    } finally {
      await this.clearLocalSession();
    }
  }

  private async setSession(session: AuthSession): Promise<void> {
    this.session = session;
    this.generation += 1;
    await this.storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    this.emit();
  }

  private async clearLocalSession(): Promise<void> {
    const hadSession = this.session !== null || await this.storage.getItem(SESSION_STORAGE_KEY) !== null;
    this.session = null;
    await this.storage.removeItem(SESSION_STORAGE_KEY);
    if (hadSession) this.generation += 1;
    this.emit();
  }

  private emit(): void {
    const state = this.currentState();
    for (const listener of this.listeners) listener(state);
  }

  private async request(path: string, init: RequestInit, isRest: boolean): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.url}${path}`, {
        ...init,
        headers: {
          apikey: this.config.anonKey,
          ...(isRest ? { 'Content-Type': 'application/json' } : {
            Authorization: `Bearer ${this.config.anonKey}`,
            'Content-Type': 'application/json',
          }),
          ...init.headers,
        },
      });
    } catch (error) {
      throw new AuthServiceError('NETWORK', error instanceof Error ? error.message : 'Network request failed.');
    }

    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try { payload = JSON.parse(text) as unknown; } catch { payload = text; }
    }
    if (!response.ok) {
      const message = isRecord(payload) && typeof payload.msg === 'string'
        ? payload.msg
        : isRecord(payload) && typeof payload.message === 'string'
          ? payload.message
          : `Supabase request failed with HTTP ${response.status}.`;
      throw new AuthServiceError('AUTH_REJECTED', message, response.status);
    }
    return payload;
  }
}
