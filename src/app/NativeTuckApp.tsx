import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ExpoSecureStoreAuthStorage, SupabaseAuthService, parseMagicLinkCallback, type AuthSession } from '../auth';
import { createBootController, createExpoImagePickerAdapter, createReactNativeLinkOpener } from '../controllers';
import { createTuckDataLayer } from '../data';
import { readSupabasePublicConfig, type SupabasePublicConfig } from '../config/supabase';
import { AppNavigator, type ProductionServices } from '../navigation/AppNavigator';
import { createMutationMailbox } from '../navigation/MutationMailbox';
import { useControllerProps } from '../navigation/useControllerProps';
import { SyncAwareImageStore, SyncEngine, SyncTriggerRepository, type SyncViewState } from '../sync';
import { SupabaseAssetTransport, SupabaseSyncTransport } from '../sync/transport';
import { BootGate } from '../ui/components/BootGate';
import { AuthLandingScreen } from './AuthLandingScreen';
import { LocalModeBar, SyncStatusBar } from './SyncStatusBar';

function readConfigSafely(): { config: SupabasePublicConfig | null; error: string | null } {
  try { return { config: readSupabasePublicConfig(), error: null }; }
  catch (error) { return { config: null, error: error instanceof Error ? error.message : 'Supabase configuration is invalid.' }; }
}

function LocalWorkspace({ onSignIn }: Readonly<{ onSignIn(): void }>) {
  const dataLayer = useMemo(() => createTuckDataLayer(), []);
  const mailbox = useMemo(() => createMutationMailbox(), []);
  const imagePicker = useMemo(() => createExpoImagePickerAdapter(), []);
  const linkOpener = useMemo(() => createReactNativeLinkOpener(), []);
  const bootController = useMemo(() => createBootController(dataLayer.repository), [dataLayer.repository]);
  const bootProps = useControllerProps(bootController);
  const services = useMemo<ProductionServices>(() => ({ repository: dataLayer.repository, imageStore: dataLayer.imageStore, imagePicker, linkOpener, mailbox }), [dataLayer, imagePicker, linkOpener, mailbox]);
  useEffect(() => { void bootController.start(); }, [bootController]);
  return <View style={{ flex: 1 }}><LocalModeBar onSignIn={onSignIn} />{bootProps.state.kind === 'ready' ? <AppNavigator services={services} /> : <BootGate {...bootProps} />}</View>;
}

function AccountWorkspace({ auth, config, session, onSignOut }: Readonly<{
  auth: SupabaseAuthService;
  config: SupabasePublicConfig;
  session: AuthSession;
  onSignOut(): void;
}>) {
  const dataLayer = useMemo(() => createTuckDataLayer({
    initialSyncProfile: { kind: 'account', accountId: session.user.id, syncEnabled: true },
  }), [session.user.id]);
  const tokenProvider = useCallback(async () => {
    const current = auth.currentSession();
    if (!current) return null;
    if (current.expiresAtEpochMs <= Date.now() + 30_000) {
      try { return (await auth.refreshSession()).accessToken; } catch { return null; }
    }
    return current.accessToken;
  }, [auth]);
  const transport = useMemo(() => new SupabaseSyncTransport(config, tokenProvider), [config, tokenProvider]);
  const assetTransport = useMemo(() => new SupabaseAssetTransport(config, tokenProvider), [config, tokenProvider]);
  const engine = useMemo(() => new SyncEngine(dataLayer.syncStore, transport, assetTransport, dataLayer.imageStore), [assetTransport, dataLayer, transport]);
  const repository = useMemo(() => new SyncTriggerRepository(dataLayer.repository, engine), [dataLayer.repository, engine]);
  const imageStore = useMemo(() => new SyncAwareImageStore(dataLayer.imageStore, engine), [dataLayer.imageStore, engine]);
  const mailbox = useMemo(() => createMutationMailbox(), []);
  const imagePicker = useMemo(() => createExpoImagePickerAdapter(), []);
  const linkOpener = useMemo(() => createReactNativeLinkOpener(), []);
  const bootController = useMemo(() => createBootController(repository), [repository]);
  const bootProps = useControllerProps(bootController);
  const [syncState, setSyncState] = useState<SyncViewState>(() => engine.currentState());
  const [initialSyncReady, setInitialSyncReady] = useState(false);
  const services = useMemo<ProductionServices>(() => ({ repository, imageStore, imagePicker, linkOpener, mailbox }), [repository, imageStore, imagePicker, linkOpener, mailbox]);

  useEffect(() => engine.subscribe(setSyncState), [engine]);
  useEffect(() => { void bootController.start(); }, [bootController]);
  useEffect(() => {
    if (bootProps.state.kind !== 'ready') return;
    let active = true;
    const establish = async () => {
      const before = await dataLayer.syncStore.getLocalSyncCheckpoint();
      if (active && before.ok && before.value.initialSyncState === 'complete') setInitialSyncReady(true);
      await engine.runOnce('startup');
      const after = await dataLayer.syncStore.getLocalSyncCheckpoint();
      if (active && after.ok && after.value.initialSyncState === 'complete') setInitialSyncReady(true);
    };
    void establish();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void engine.runOnce('foreground'); });
    const poll = setInterval(() => { if (AppState.currentState === 'active') void engine.runOnce('poll'); }, 4000);
    return () => { active = false; subscription.remove(); clearInterval(poll); };
  }, [bootProps.state.kind, dataLayer.syncStore, engine]);

  const retryInitialSync = async () => {
    await engine.runOnce('retry');
    const checkpoint = await dataLayer.syncStore.getLocalSyncCheckpoint();
    if (checkpoint.ok && checkpoint.value.initialSyncState === 'complete') setInitialSyncReady(true);
  };

  return <View style={{ flex: 1 }}>
    <SyncStatusBar state={syncState} email={session.user.email} onRetry={() => void retryInitialSync()} onSync={() => void engine.runOnce('manual')} onSignOut={onSignOut} />
    {bootProps.state.kind !== 'ready'
      ? <BootGate {...bootProps} />
      : initialSyncReady
        ? <AppNavigator services={services} dataRevision={syncState.dataRevision} />
        : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
            <ActivityIndicator />
            <Text style={{ marginTop: 12, fontWeight: '700' }}>Bringing your Tuck library to this device…</Text>
            {syncState.kind === 'error' || syncState.kind === 'offline_pending'
              ? <Pressable style={{ marginTop: 16, padding: 12 }} onPress={() => void retryInitialSync()}><Text style={{ color: '#3F5A45', fontWeight: '700' }}>Retry</Text></Pressable>
              : null}
          </View>}
  </View>;
}

export function NativeTuckApp() {
  const configState = useMemo(readConfigSafely, []);
  const auth = useMemo(() => configState.config ? new SupabaseAuthService(configState.config, new ExpoSecureStoreAuthStorage(SecureStore)) : null, [configState.config]);
  const [mode, setMode] = useState<'restoring' | 'signed_out' | 'local'>('restoring');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(configState.error);

  const handleUrl = useCallback(async (url: string) => {
    if (!auth) return;
    const callback = parseMagicLinkCallback(url);
    if (!callback) return;
    setAuthBusy(true);
    try {
      const next = await auth.acceptRedirectSession(callback);
      setSession(next); setMode('signed_out'); setAuthMessage(null);
    } catch (error) { setAuthMessage(error instanceof Error ? error.message : 'Could not complete sign-in.'); }
    finally { setAuthBusy(false); }
  }, [auth]);

  useEffect(() => {
    if (!auth) { setMode('local'); return; }
    let active = true;
    void auth.restoreSession().then(restored => {
      if (!active) return;
      setSession(restored);
      setMode('signed_out');
    }).catch(error => {
      if (!active) return;
      setAuthMessage(error instanceof Error ? error.message : 'Could not restore sign-in.');
      setMode('signed_out');
    });
    void Linking.getInitialURL().then(url => { if (url) void handleUrl(url); });
    const subscription = Linking.addEventListener('url', event => { void handleUrl(event.url); });
    return () => { active = false; subscription.remove(); };
  }, [auth, handleUrl]);

  const requestEmail = useCallback(async (email: string) => {
    if (!auth) throw new Error('Cloud sync is not configured in this build.');
    setAuthBusy(true);
    try {
      await auth.requestMagicLink(email, 'tuck://auth/callback');
      setAuthMessage('Check your email and open the Tuck sign-in link on this device.');
    } finally { setAuthBusy(false); }
  }, [auth]);

  const signOut = useCallback(() => {
    if (!auth) return;
    void auth.signOutCurrentDevice().catch(() => undefined).finally(() => { setSession(null); setMode('signed_out'); });
  }, [auth]);

  return <SafeAreaProvider><StatusBar style="dark" />{
    session && configState.config
      ? <AccountWorkspace key={session.user.id} auth={auth!} config={configState.config} session={session} onSignOut={signOut} />
      : mode === 'local'
        ? <LocalWorkspace onSignIn={() => setMode('signed_out')} />
        : <AuthLandingScreen onContinueEmail={requestEmail} onContinueLocal={() => setMode('local')} busy={authBusy || mode === 'restoring'} message={authMessage} />
  }</SafeAreaProvider>;
}
