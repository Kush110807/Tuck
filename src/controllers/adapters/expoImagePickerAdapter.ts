import type { AppError, ImagePickerAdapter, ImageSelection, PickImageOutcome } from '../../contracts';

type PickerPermission = { granted: boolean };
type PickerAsset = { uri: string; mimeType?: string | null; fileSize?: number };
type PickerResult = { canceled: boolean; assets: PickerAsset[] | null };

type ExpoImagePickerApi = {
  requestMediaLibraryPermissionsAsync(): Promise<PickerPermission>;
  launchImageLibraryAsync(options: {
    mediaTypes: readonly ['images'];
    allowsMultipleSelection: false;
    quality: number;
  }): Promise<PickerResult>;
};

const supportedMimeTypes = new Set<ImageSelection['mimeType']>(['image/jpeg', 'image/png', 'image/webp']);

function failure(code: AppError['code'], message: string): PickImageOutcome {
  return { kind: 'failed', error: { code, message, field: 'image' } };
}

export class ExpoImagePickerAdapter implements ImagePickerAdapter {
  constructor(private readonly injectedApi?: ExpoImagePickerApi) {}

  async pickOne(): Promise<PickImageOutcome> {
    try {
      const api = this.injectedApi ?? await this.loadApi();
      const permission = await api.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return failure('PERMISSION_DENIED', 'Photo-library permission is required to choose an image.');

      const result = await api.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        quality: 1,
      });
      if (result.canceled) return { kind: 'cancelled' };
      const asset = result.assets?.[0];
      if (!asset?.uri) return failure('PICKER_FAILED', 'The image picker did not return a usable image.');
      if (!asset.mimeType || !supportedMimeTypes.has(asset.mimeType as ImageSelection['mimeType'])) {
        return failure('IMAGE_UNSUPPORTED', 'Choose a JPEG, PNG or WebP image.');
      }
      return {
        kind: 'selected',
        selection: {
          temporaryUri: asset.uri,
          mimeType: asset.mimeType as ImageSelection['mimeType'],
          ...(typeof asset.fileSize === 'number' ? { reportedBytes: asset.fileSize } : {}),
        },
      };
    } catch {
      return failure('PICKER_FAILED', 'The image picker could not be opened.');
    }
  }

  private async loadApi(): Promise<ExpoImagePickerApi> {
    return await import('expo-image-picker') as unknown as ExpoImagePickerApi;
  }
}

export function createExpoImagePickerAdapter(): ExpoImagePickerAdapter {
  return new ExpoImagePickerAdapter();
}
