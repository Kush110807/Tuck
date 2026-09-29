import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SyncViewState } from '../sync/SyncEngine';
import { colors, minimumTouchSize, space } from '../theme/tokens';

function labelFor(state: SyncViewState): string {
  switch (state.kind) {
    case 'syncing': return 'Syncing…';
    case 'synced': return '☁ Synced';
    case 'offline_pending': return state.pendingCount > 0 ? `Offline · ${state.pendingCount} waiting` : 'Offline';
    case 'error': return "Couldn't sync";
    case 'local_saved': return state.pendingCount > 0 ? `Saved · ${state.pendingCount} waiting` : 'Saved';
  }
}

export function SyncStatusBar({ state, email, onRetry, onSync, onSignOut }: Readonly<{
  state: SyncViewState;
  email: string | null;
  onRetry(): void;
  onSync(): void;
  onSignOut(): void;
}>) {
  const needsRetry = state.kind === 'error' || state.kind === 'offline_pending';
  return (
    <View style={styles.root}>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={styles.email}>{email ?? 'Tuck account'}</Text>
        <Text numberOfLines={1} style={[styles.status, state.kind === 'error' && styles.error]}>{labelFor(state)}</Text>
        {state.message ? <Text numberOfLines={2} style={[styles.detail, state.kind === 'error' && styles.error]}>{state.message}</Text> : null}
      </View>
      {needsRetry
        ? <Pressable accessibilityRole="button" style={styles.action} onPress={onRetry}><Text style={styles.actionText}>Retry</Text></Pressable>
        : <Pressable accessibilityRole="button" style={styles.action} onPress={onSync} disabled={state.kind === 'syncing'}><Text style={styles.actionText}>Sync</Text></Pressable>}
      <Pressable accessibilityRole="button" style={styles.action} onPress={onSignOut}><Text style={styles.actionText}>Sign out</Text></Pressable>
    </View>
  );
}

export function LocalModeBar({ onSignIn }: Readonly<{ onSignIn(): void }>) {
  return <View style={styles.root}><View style={styles.copy}><Text style={styles.email}>Local mode</Text><Text style={styles.status}>Saved on this device</Text></View><Pressable style={styles.action} onPress={onSignIn}><Text style={styles.actionText}>Sign in</Text></Pressable></View>;
}

const styles = StyleSheet.create({
  root: { minHeight: 48, paddingHorizontal: space.lg, backgroundColor: colors.primarySoft, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  copy: { flex: 1, minWidth: 0 },
  email: { fontSize: 12, fontWeight: '700', color: colors.text },
  status: { fontSize: 11, color: colors.secondaryText, marginTop: 1 },
  detail: { fontSize: 11, color: colors.secondaryText, marginTop: 2 },
  error: { color: colors.error },
  action: { minHeight: minimumTouchSize, paddingHorizontal: space.sm, justifyContent: 'center' },
  actionText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
});
