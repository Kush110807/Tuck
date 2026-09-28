export type AuthUser = Readonly<{
  id: string;
  email: string | null;
}>;

export type AuthSession = Readonly<{
  accessToken: string;
  refreshToken: string;
  expiresAtEpochMs: number;
  user: AuthUser;
}>;

export type AuthState =
  | Readonly<{ kind: 'signed_out'; generation: number }>
  | Readonly<{ kind: 'signed_in'; generation: number; session: AuthSession }>;

export type AuthErrorCode =
  | 'CONFIGURATION'
  | 'NETWORK'
  | 'INVALID_RESPONSE'
  | 'AUTH_REJECTED'
  | 'NO_SESSION';

export class AuthServiceError extends Error {
  constructor(readonly code: AuthErrorCode, message: string, readonly status?: number) {
    super(message);
    this.name = 'AuthServiceError';
  }
}

export interface AuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export type AuthStateListener = (state: AuthState) => void;
