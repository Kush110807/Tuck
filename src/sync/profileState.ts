export type ProfileKind = 'local-only' | 'account';
export type AccountProfileStatus = 'signed-in' | 'signed-out' | 'remote-deleted';

export type LocalProfile = Readonly<{
  key: 'local-only';
  kind: 'local-only';
  databaseName: string;
}>;

export type AccountProfile = Readonly<{
  key: string;
  kind: 'account';
  accountId: string;
  databaseName: string;
  status: AccountProfileStatus;
  syncPaused: boolean;
  pendingOutboxCount: number;
  pendingAssetTransfers: number;
}>;

export type Profile = LocalProfile | AccountProfile;

export type ProfileRegistryState = Readonly<{
  activeProfileKey: string;
  profiles: Readonly<Record<string, Profile>>;
  sessionGeneration: number;
}>;

export function accountProfileKey(accountId: string): string {
  return `account:${accountId}`;
}

export function createProfileRegistry(): ProfileRegistryState {
  const local: LocalProfile = { key: 'local-only', kind: 'local-only', databaseName: 'tuck-local.db' };
  return { activeProfileKey: local.key, profiles: { [local.key]: local }, sessionGeneration: 0 };
}

export function signInAccount(
  state: ProfileRegistryState,
  accountId: string,
  databaseName = `tuck-account-${accountId}.db`,
): ProfileRegistryState {
  const key = accountProfileKey(accountId);
  const existing = state.profiles[key];
  const profile: AccountProfile = existing?.kind === 'account'
    ? { ...existing, status: 'signed-in', syncPaused: false }
    : {
        key,
        kind: 'account',
        accountId,
        databaseName,
        status: 'signed-in',
        syncPaused: false,
        pendingOutboxCount: 0,
        pendingAssetTransfers: 0,
      };
  return {
    activeProfileKey: key,
    profiles: { ...state.profiles, [key]: profile },
    sessionGeneration: state.sessionGeneration + 1,
  };
}

export function updatePendingCounts(
  state: ProfileRegistryState,
  accountId: string,
  pendingOutboxCount: number,
  pendingAssetTransfers: number,
): ProfileRegistryState {
  const key = accountProfileKey(accountId);
  const existing = state.profiles[key];
  if (!existing || existing.kind !== 'account') return state;
  return {
    ...state,
    profiles: {
      ...state.profiles,
      [key]: { ...existing, pendingOutboxCount, pendingAssetTransfers },
    },
  };
}

/** Normal sign-out hides account data but preserves its database and pending work. */
export function signOutAccount(state: ProfileRegistryState, accountId: string): ProfileRegistryState {
  const key = accountProfileKey(accountId);
  const existing = state.profiles[key];
  if (!existing || existing.kind !== 'account') return state;
  return {
    activeProfileKey: state.activeProfileKey === key ? 'local-only' : state.activeProfileKey,
    profiles: {
      ...state.profiles,
      [key]: { ...existing, status: 'signed-out', syncPaused: true },
    },
    sessionGeneration: state.sessionGeneration + 1,
  };
}

export function globalSignOut(state: ProfileRegistryState): ProfileRegistryState {
  const profiles: Record<string, Profile> = {};
  for (const [key, profile] of Object.entries(state.profiles)) {
    profiles[key] = profile.kind === 'account'
      ? { ...profile, status: 'signed-out', syncPaused: true }
      : profile;
  }
  return { activeProfileKey: 'local-only', profiles, sessionGeneration: state.sessionGeneration + 1 };
}

export function markRemoteAccountDeleted(state: ProfileRegistryState, accountId: string): ProfileRegistryState {
  const key = accountProfileKey(accountId);
  const existing = state.profiles[key];
  if (!existing || existing.kind !== 'account') return state;
  return {
    activeProfileKey: state.activeProfileKey === key ? 'local-only' : state.activeProfileKey,
    profiles: {
      ...state.profiles,
      [key]: { ...existing, status: 'remote-deleted', syncPaused: true },
    },
    sessionGeneration: state.sessionGeneration + 1,
  };
}

export type RemoveAccountCacheDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; reason: 'UNSYNCED_OUTBOX' | 'PENDING_ASSET_TRANSFER' | 'ACCOUNT_ACTIVE' }>;

export function canRemoveAccountCache(profile: AccountProfile): RemoveAccountCacheDecision {
  if (profile.status === 'signed-in') return { allowed: false, reason: 'ACCOUNT_ACTIVE' };
  if (profile.pendingOutboxCount > 0) return { allowed: false, reason: 'UNSYNCED_OUTBOX' };
  if (profile.pendingAssetTransfers > 0) return { allowed: false, reason: 'PENDING_ASSET_TRANSFER' };
  return { allowed: true };
}
