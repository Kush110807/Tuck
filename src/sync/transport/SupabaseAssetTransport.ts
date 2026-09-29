import type { SupabasePublicConfig } from '../../config/supabase';
import type { CanonicalAsset } from '../protocol';
import type { AccessTokenProvider } from './SupabaseSyncTransport';
import { SyncTransportError } from './SupabaseSyncTransport';

type FetchLike = typeof fetch;

const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

export type AssetStagingResponse =
  | Readonly<{ kind: 'staging' | 'existing'; assetId: string; storagePath: string; state?: 'staging' | 'ready'; version: number }>
  | Readonly<{ kind: 'error'; code: string; message?: string }>;

export type AssetFinalizeResponse =
  | Readonly<{ kind: 'ready'; asset: Readonly<{ entityType: 'asset'; entity: CanonicalAsset }>; changeSequence: number | null }>
  | Readonly<{ kind: 'error'; code: string; message?: string }>;

export type DownloadedAsset = Readonly<{
  bytes: Uint8Array;
  contentType: string | null;
}>;

function encodeStoragePath(path: string): string {
  return path.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

export class SupabaseAssetTransport {
  constructor(
    private readonly config: SupabasePublicConfig,
    private readonly accessToken: AccessTokenProvider,
    private readonly fetchImpl: FetchLike = defaultFetch,
  ) {}

  async createStaging(assetId: string, mimeType: CanonicalAsset['mimeType'], byteSize: number): Promise<AssetStagingResponse> {
    return this.restRpc<AssetStagingResponse>('tuck_create_asset_staging', {
      p_asset_id: assetId,
      p_mime_type: mimeType,
      p_byte_size: byteSize,
    });
  }

  async upload(storagePath: string, mimeType: CanonicalAsset['mimeType'], bytes: Uint8Array): Promise<void> {
    const token = await this.requireToken();
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.config.url}/storage/v1/object/tuck-assets/${encodeStoragePath(storagePath)}`,
        {
          method: 'POST',
          headers: {
            apikey: this.config.anonKey,
            Authorization: `Bearer ${token}`,
            'Content-Type': mimeType,
            'x-upsert': 'false',
          },
          body: bytes as unknown as BodyInit,
        },
      );
    } catch (error) {
      throw new SyncTransportError(error instanceof Error ? error.message : 'Asset upload failed.');
    }
    if (!response.ok) {
      const text = await response.text();
      // A retry can legitimately observe the create-once object already present.
      // The finalize RPC verifies exact size + MIME before making it visible.
      if (response.status !== 409) {
        throw new SyncTransportError(text || `Asset upload failed with HTTP ${response.status}.`, response.status);
      }
    }
  }

  async finalize(assetId: string, originDeviceId: string): Promise<AssetFinalizeResponse> {
    return this.restRpc<AssetFinalizeResponse>('tuck_finalize_asset', {
      p_asset_id: assetId,
      p_origin_device_id: originDeviceId,
    });
  }

  async download(storagePath: string): Promise<DownloadedAsset> {
    const token = await this.requireToken();
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.config.url}/storage/v1/object/tuck-assets/${encodeStoragePath(storagePath)}`,
        {
          method: 'GET',
          headers: { apikey: this.config.anonKey, Authorization: `Bearer ${token}` },
        },
      );
    } catch (error) {
      throw new SyncTransportError(error instanceof Error ? error.message : 'Asset download failed.');
    }
    if (!response.ok) {
      const text = await response.text();
      throw new SyncTransportError(text || `Asset download failed with HTTP ${response.status}.`, response.status);
    }
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get('content-type'),
    };
  }

  private async restRpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
    const token = await this.requireToken();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.url}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
          apikey: this.config.anonKey,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new SyncTransportError(error instanceof Error ? error.message : `RPC ${name} failed.`);
    }
    const text = await response.text();
    if (!response.ok) throw new SyncTransportError(text || `RPC ${name} failed.`, response.status);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new SyncTransportError(`RPC ${name} returned malformed JSON.`, response.status);
    }
  }

  private async requireToken(): Promise<string> {
    const token = await this.accessToken();
    if (!token) throw new SyncTransportError('Authenticated access token is required.', 401);
    return token;
  }
}
