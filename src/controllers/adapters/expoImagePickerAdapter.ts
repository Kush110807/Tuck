import type { AppError, ImagePickerAdapter, ImageSelection, PickImageOutcome, SupportedImageMimeType } from '../../contracts';

type PickerAsset = { uri: string; mimeType?: string | null; fileSize?: number };
type PickerResult = { canceled: boolean; assets: PickerAsset[] | null };

type ExpoImagePickerApi = {
  launchImageLibraryAsync(options: {
    mediaTypes: readonly ['images'];
    allowsMultipleSelection: false;
    quality: number;
  }): Promise<PickerResult>;
  // Intentionally optional and unused. SDK 57's system library picker does not
  // require a media-library permission request simply to launch.
  requestMediaLibraryPermissionsAsync?: () => Promise<{ granted: boolean }>;
};

const supportedMimeTypes = new Set<SupportedImageMimeType>(['image/jpeg', 'image/png', 'image/webp']);

function failure(code: AppError['code'], message: string): PickImageOutcome {
  return { kind: 'failed', error: { code, message, field: 'image' } };
}

export class ExpoImagePickerAdapter implements ImagePickerAdapter {
  constructor(private readonly injectedApi?: ExpoImagePickerApi) {}

  async pickOne(): Promise<PickImageOutcome> {
    try {
      const api = this.injectedApi ?? await this.loadApi();
      const result = await api.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        quality: 1,
      });
      if (result.canceled) return { kind: 'cancelled' };
      const asset = result.assets?.[0];
      if (!asset?.uri) return failure('PICKER_FAILED', 'The image picker did not return a usable image.');

      const reportedMime = asset.mimeType && supportedMimeTypes.has(asset.mimeType as SupportedImageMimeType)
        ? asset.mimeType as SupportedImageMimeType
        : null;
      const selection: ImageSelection = {
        temporaryUri: asset.uri,
        mimeType: reportedMime,
        ...(typeof asset.fileSize === 'number' ? { reportedBytes: asset.fileSize } : {}),
      };
      return { kind: 'selected', selection };
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
