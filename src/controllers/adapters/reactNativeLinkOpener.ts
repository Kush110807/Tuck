import type { AppError, LinkOpener, Result } from '../../contracts';

type OpenUrl = (url: string) => Promise<unknown>;

function failed(message: string): Result<void> {
  const error: AppError = { code: 'OPEN_FAILED', message };
  return { ok: false, error };
}

export class ReactNativeLinkOpener implements LinkOpener {
  constructor(private readonly injectedOpenUrl?: OpenUrl) {}

  async openHttpUrl(url: string): Promise<Result<void>> {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return failed('Only HTTP and HTTPS links can be opened.');
      }
    } catch {
      return failed('Only valid HTTP and HTTPS links can be opened.');
    }
    try {
      const openUrl = this.injectedOpenUrl ?? await this.loadOpenUrl();
      await openUrl(url);
      return { ok: true, value: undefined };
    } catch {
      return failed('The link could not be opened.');
    }
  }

  private async loadOpenUrl(): Promise<OpenUrl> {
    const { Linking } = await import('react-native');
    return url => Linking.openURL(url);
  }
}

export function createReactNativeLinkOpener(): ReactNativeLinkOpener {
  return new ReactNativeLinkOpener();
}
