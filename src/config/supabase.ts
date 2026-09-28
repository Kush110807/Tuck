export type SupabasePublicConfig = Readonly<{
  url: string;
  anonKey: string;
}>;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, '');
}

/**
 * Reads only Expo-public variables. No service-role/database/JWT-signing secret
 * belongs in a mobile bundle.
 */
export function readSupabasePublicConfig(
  env?: Readonly<Record<string, string | undefined>>,
): SupabasePublicConfig | null {
  // Direct process.env property reads are intentional: Expo statically inlines
  // EXPO_PUBLIC_* values in application bundles. Tests may inject `env`.
  const source = env ?? {
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  };
  const rawUrl = source.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = source.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!rawUrl && !anonKey) return null;
  if (!rawUrl || !anonKey) {
    throw new Error('Both EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are required.');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('EXPO_PUBLIC_SUPABASE_URL must be a valid URL.');
  }
  const localHttp = parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !localHttp) {
    throw new Error('Supabase URL must use HTTPS outside local development.');
  }
  return { url: trimTrailingSlash(rawUrl), anonKey };
}
