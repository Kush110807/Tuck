import type { AuthStorage } from './types';

/**
 * Minimal structural boundary for expo-secure-store. Phase 6B deliberately does
 * not add an Expo package merely to instantiate auth before sign-in UI exists.
 * The later composition root can inject the real SecureStore module here.
 */
export interface ExpoSecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export class ExpoSecureStoreAuthStorage implements AuthStorage {
  constructor(private readonly secureStore: ExpoSecureStoreLike) {}

  getItem(key: string): Promise<string | null> {
    return this.secureStore.getItemAsync(key);
  }

  setItem(key: string, value: string): Promise<void> {
    return this.secureStore.setItemAsync(key, value);
  }

  removeItem(key: string): Promise<void> {
    return this.secureStore.deleteItemAsync(key);
  }
}
