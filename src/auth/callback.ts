export type MagicLinkCallback = Readonly<{
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  expiresAt?: number;
}>;

function paramsFromUrl(url: string): URLSearchParams[] {
  try {
    const parsed = new URL(url);
    return [parsed.searchParams, new URLSearchParams(parsed.hash.replace(/^#/, ''))];
  } catch {
    const [beforeHash, hash = ''] = url.split('#', 2);
    const query = beforeHash.includes('?') ? beforeHash.slice(beforeHash.indexOf('?') + 1) : '';
    return [new URLSearchParams(query), new URLSearchParams(hash)];
  }
}

export function parseMagicLinkCallback(url: string): MagicLinkCallback | null {
  for (const params of paramsFromUrl(url)) {
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (!accessToken || !refreshToken) continue;
    const expiresInRaw = params.get('expires_in');
    const expiresAtRaw = params.get('expires_at');
    const expiresIn = expiresInRaw === null ? undefined : Number(expiresInRaw);
    const expiresAt = expiresAtRaw === null ? undefined : Number(expiresAtRaw);
    return {
      accessToken,
      refreshToken,
      ...(Number.isFinite(expiresIn) ? { expiresIn } : {}),
      ...(Number.isFinite(expiresAt) ? { expiresAt } : {}),
    };
  }
  return null;
}
