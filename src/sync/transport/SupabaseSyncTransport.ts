import type { SupabasePublicConfig } from '../../config/supabase';
import type {
  BootstrapRequest,
  BootstrapResponse,
  PullChangesRequest,
  PullChangesResponse,
  PushMutationsRequest,
  PushMutationsResponse,
} from '../protocol';

type FetchLike = typeof fetch;

const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

export class SyncTransportError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'SyncTransportError';
  }
}

export type AccessTokenProvider = () => string | null | Promise<string | null>;

/**
 * Network boundary only. Nothing here touches SQLite/controllers/UI or schedules
 * synchronization after local CRUD; Phase 6D owns that wiring.
 */
export class SupabaseSyncTransport {
  constructor(
    private readonly config: SupabasePublicConfig,
    private readonly accessToken: AccessTokenProvider,
    private readonly fetchImpl: FetchLike = defaultFetch,
  ) {}

  pushMutations(request: PushMutationsRequest): Promise<PushMutationsResponse> {
    return this.rpc<PushMutationsResponse>('tuck_push_mutations', request);
  }

  pullChanges(request: PullChangesRequest): Promise<PullChangesResponse> {
    return this.rpc<PullChangesResponse>('tuck_pull_changes', request);
  }

  bootstrap(request: BootstrapRequest): Promise<BootstrapResponse> {
    return this.rpc<BootstrapResponse>('tuck_bootstrap', request);
  }

  private async rpc<T>(name: string, request: unknown): Promise<T> {
    const token = await this.accessToken();
    if (!token) throw new SyncTransportError('Authenticated access token is required.');
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.url}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
          apikey: this.config.anonKey,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_request: request }),
      });
    } catch (error) {
      throw new SyncTransportError(error instanceof Error ? error.message : 'Sync transport request failed.');
    }
    const text = await response.text();
    if (!response.ok) throw new SyncTransportError(text || `RPC ${name} failed.`, response.status);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new SyncTransportError(`RPC ${name} returned malformed JSON.`, response.status);
    }
  }
}
