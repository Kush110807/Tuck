import type { AssetId } from './protocol';

export type AssetLocalState =
  | 'remote_known_not_downloaded'
  | 'download_pending'
  | 'available'
  | 'download_failed'
  | 'missing'
  | 'corrupt';

export type AssetRemoteState = 'unknown' | 'staging' | 'ready';
export type AssetUploadState = 'not_scheduled' | 'not_required' | 'pending' | 'failed' | 'uploaded';

/** Asset state is asset-scoped: one immutable ready Asset may be referenced by many Items. */
export type AssetSyncState = Readonly<{
  assetId: AssetId;
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
        uploadState: state.uploadState === 'pending' || state.uploadState === 'failed' || state.uploadState === 'not_scheduled'
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

export function remoteKnownAssetState(assetId: AssetId): AssetSyncState {
  return {
    assetId,
    localState: 'remote_known_not_downloaded',
    remoteState: 'ready',
    uploadState: 'not_required',
    uploadAttempts: 0,
    downloadAttempts: 0,
    lastErrorCode: null,
  };
}

/** Existing pre-sync local images migrate here: available, remote unknown, upload not yet scheduled. */
export function localUnscheduledAssetState(assetId: AssetId): AssetSyncState {
  return {
    assetId,
    localState: 'available',
    remoteState: 'unknown',
    uploadState: 'not_scheduled',
    uploadAttempts: 0,
    downloadAttempts: 0,
    lastErrorCode: null,
  };
}

export function localPendingAssetState(assetId: AssetId): AssetSyncState {
  return {
    ...localUnscheduledAssetState(assetId),
    uploadState: 'pending',
  };
}
