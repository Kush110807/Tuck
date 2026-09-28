import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type AppConfig = {
  expo: {
    android: { blockedPermissions?: string[] };
    plugins: Array<string | [string, Record<string, unknown>]>;
  };
};

const appConfig = JSON.parse(readFileSync(resolve(process.cwd(), 'app.json'), 'utf8')) as AppConfig;

describe('Android image-picker permission surface', () => {
  it('does not request unused camera/audio access and blocks broad legacy storage permissions', () => {
    const picker = appConfig.expo.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === 'expo-image-picker');
    expect(picker).toBeTruthy();
    if (!picker || !Array.isArray(picker)) throw new Error('expo-image-picker config missing');
    expect(picker[1]).toMatchObject({ cameraPermission: false, microphonePermission: false });

    expect(appConfig.expo.android.blockedPermissions).toEqual(expect.arrayContaining([
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ]));
  });
});
