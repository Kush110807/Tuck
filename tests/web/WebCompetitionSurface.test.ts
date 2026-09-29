import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('competition entry surfaces', () => {
  it('Web competition entry is local and contains no auth/cloud activation', () => {
    const app = source('src/web/WebTuckApp.tsx');
    expect(app).toContain('WebLocalRepository');
    expect(app).not.toContain('SupabaseAuthService');
    expect(app).not.toContain('WebCloudClient');
    expect(app).not.toContain('readSupabasePublicConfig');
    expect(app).not.toContain('Continue with email');
    expect(app).not.toContain('Synced');
  });

  it('Android competition entry opens only the local SQLite workspace', () => {
    const app = source('src/app/NativeTuckApp.tsx');
    expect(app).toContain('createTuckDataLayer()');
    expect(app).not.toContain('SupabaseAuthService');
    expect(app).not.toContain('SyncEngine');
    expect(app).not.toContain('AuthLandingScreen');
    expect(app).not.toContain('SyncStatusBar');
  });

  it('preserves repaired cloud infrastructure for future launch', () => {
    const auth = source('src/auth/SupabaseAuthService.ts');
    const sync = source('src/sync/transport/SupabaseSyncTransport.ts');
    const asset = source('src/sync/transport/SupabaseAssetTransport.ts');
    expect(auth).toContain('globalThis.fetch(input, init)');
    expect(sync).toContain('globalThis.fetch(input, init)');
    expect(asset).toContain('globalThis.fetch(input, init)');
    expect(source('package.json')).toContain('"expo": "~57.0.26"');
  });


  it('keeps the primary competition navigation, empty states and keyboard shortcuts visible in the local Web surface', () => {
    const app = source('src/web/WebTuckApp.tsx');
    for (const label of ['Inbox', 'Notes', 'Images', 'Collections', 'Archive']) expect(app).toContain(`label=\"${label}\"`);
    expect(app).toContain("event.key === '/'");
    expect(app).toContain("event.key.toLowerCase() === 'n'");
    expect(app).toContain("event.key === 'Escape'");
    expect(app).toContain('Nothing tucked yet.');
    expect(app).toContain('Your notes will live here.');
    expect(app).toContain('A visual shelf for things worth remembering.');
    expect(app).toContain('Nothing archived.');
    expect(app).toContain('Nothing matches that search.');
  });

  it('ships a GitHub Pages workflow and static Web build script', () => {
    const workflow = source('.github/workflows/pages.yml');
    expect(workflow).toContain('actions/deploy-pages@v4');
    expect(workflow).toContain('EXPO_PUBLIC_BASE_URL');
    expect(source('package.json')).toContain('"web:build"');
  });
});
