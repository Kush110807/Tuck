import type { AssetId } from './protocol';

export type AssetLocalState =
  | 'remote_known_not_downloaded'
  | 'download_pending'
  | 'available'
  | 'download_failed'
  | 'missing'
  | 'corrupt';

export type AssetRemoteState = 'unknown' | 'staging' | 'ready';
export type AssetUploadState = 'not_required' | 'pending' | 'failed' | 'uploaded';

export type AssetSyncState = Readonly<{
  assetId: AssetId;
  itemId: string;
  localState: AssetLocalState;
  remoteState: AssetRemoteState;
  uploadState: AssetUploadState;
  uploadAttempts: number;
  downloadAttempts: number;
  lastErrorCode: string | null;
}>;

export type AssetEvent =
  | Readonly<{ type: 'REMOTE_METADATA'; remoteState: 'staging' | 'ready' }>
  | Readonly<{ type: 'QUEUE_UPLOAD' }>
  | Readonly<{ type: 'UPLOAD_FAILED'; errorCode: string }>
  | Readonly<{ type: 'UPLOAD_READY' }>
  | Readonly<{ type: 'QUEUE_DOWNLOAD' }>
  | Readonly<{ type: 'DOWNLOAD_FAILED'; errorCode: string }>
  | Readonly<{ type: 'DOWNLOAD_AVAILABLE' }>
  | Readonly<{ type: 'LOCAL_FILE_MISSING' }>
  | Readonly<{ type: 'LOCAL_FILE_CORRUPT' }>;

export function reduceAssetState(state: AssetSyncState, event: AssetEvent): AssetSyncState {
  switch (event.type) {
    case 'REMOTE_METADATA':
      return {
        ...state,
        remoteState: event.remoteState,
        localState: state.localState === 'available' ? 'available' : 'remote_known_not_downloaded',
        uploadState: state.uploadState === 'pending' || state.uploadState === 'failed'
          ? state.uploadState
          : 'not_required',
        lastErrorCode: null,
      };
    case 'QUEUE_UPLOAD':
      return { ...state, uploadState: 'pending', uploadAttempts: state.uploadAttempts + 1, lastErrorCode: null };
    case 'UPLOAD_FAILED':
      return { ...state, uploadState: 'failed', lastErrorCode: event.errorCode };
    case 'UPLOAD_READY':
      return { ...state, remoteState: 'ready', uploadState: 'uploaded', lastErrorCode: null };
    case 'QUEUE_DOWNLOAD':
      return {
        ...state,
        localState: 'download_pending',
        downloadAttempts: state.downloadAttempts + 1,
        lastErrorCode: null,
      };
    case 'DOWNLOAD_FAILED':
      return { ...state, localState: 'download_failed', lastErrorCode: event.errorCode };
    case 'DOWNLOAD_AVAILABLE':
      return { ...state, localState: 'available', lastErrorCode: null };
    case 'LOCAL_FILE_MISSING':
      return { ...state, localState: 'missing', lastErrorCode: 'LOCAL_FILE_MISSING' };
    case 'LOCAL_FILE_CORRUPT':
      return { ...state, localState: 'corrupt', lastErrorCode: 'LOCAL_FILE_CORRUPT' };
  }
}

export function remoteKnownAssetState(assetId: AssetId, itemId: string): AssetSyncState {
  return {
    assetId,
    itemId,
    localState: 'remote_known_not_downloaded',
    remoteState: 'ready',
    uploadState: 'not_required',
    uploadAttempts: 0,
    downloadAttempts: 0,
    lastErrorCode: null,
  };
}

export function localPendingAssetState(assetId: AssetId, itemId: string): AssetSyncState {
  return {
    assetId,
    itemId,
    localState: 'available',
    remoteState: 'unknown',
    uploadState: 'pending',
    uploadAttempts: 0,
    downloadAttempts: 0,
    lastErrorCode: null,
  };
}
