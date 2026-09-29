import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SupabaseAuthService, parseMagicLinkCallback, type AuthSession } from '../auth';
import { readSupabasePublicConfig } from '../config/supabase';
import type { CanonicalCollection, CanonicalItem } from '../sync/protocol';
import { SupabaseAssetTransport, SupabaseSyncTransport } from '../sync/transport';
import { colors, radii, space } from '../theme/tokens';
import { LocalStorageAuthStorage } from './LocalStorageAuthStorage';
import { WebCloudClient } from './WebCloudClient';

type Section = 'inbox' | 'notes' | 'images' | 'collections' | 'archive' | 'account';
type NewItemKind = 'note' | 'link';

function deviceId(): string {
  const key = 'tuck.web.device.v1';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const next = globalThis.crypto?.randomUUID?.() ?? `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(key, next);
  return next;
}

function WebAuth({ auth, onSession }: { auth: SupabaseAuthService; onSession(session: AuthSession): void }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const redirect = `${window.location.origin}${window.location.pathname}`;
      await auth.requestMagicLink(email, redirect);
      setMessage('Check your email, then return to this tab.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not send link.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const callback = parseMagicLinkCallback(window.location.href);
    if (!callback) return;
    setBusy(true);
    void auth.acceptRedirectSession(callback)
      .then(session => {
        history.replaceState({}, document.title, window.location.pathname);
        onSession(session);
      })
      .catch(error => setMessage(error instanceof Error ? error.message : 'Could not sign in.'))
      .finally(() => setBusy(false));
  }, [auth, onSession]);

  return <View style={styles.authRoot}>
    <View style={styles.authCard}>
      <Text style={styles.brand}>Tuck</Text>
      <Text style={styles.authTitle}>Your things. Everywhere.</Text>
      <Text style={styles.muted}>Open the same library from Android and your laptop.</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        placeholder="you@example.com"
        onSubmitEditing={() => void submit()}
      />
      <Pressable style={styles.primary} onPress={() => void submit()} disabled={busy || !email.trim()}>
        {busy ? <ActivityIndicator /> : <Text style={styles.primaryText}>Continue with email</Text>}
      </Pressable>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  </View>;
}

function RemoteImage({ client, item }: { client: WebCloudClient; item: CanonicalItem }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setUri(null);
    if (!item.assetId) return;
    void client.imageUrl(item.assetId)
      .then(value => { if (active) setUri(value); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [client, item.assetId]);
  return uri
    ? <Image source={{ uri }} style={styles.thumb} />
    : <View style={[styles.thumb, styles.imagePlaceholder]}><Text style={styles.muted}>Image</Text></View>;
}

function ItemCard({
  client,
  item,
  collectionName,
  onEdit,
}: {
  client: WebCloudClient;
  item: CanonicalItem;
  collectionName: string | null;
  onEdit(item: CanonicalItem): void;
}) {
  return <Pressable style={styles.card} onPress={() => onEdit(item)}>
    <View style={styles.cardMain}>
      {item.type === 'image' ? <RemoteImage client={client} item={item} /> : null}
      <View style={{ flex: 1 }}>
        <View style={styles.cardTitleRow}>
          <Text numberOfLines={1} style={styles.cardTitle}>{item.title || 'Untitled'}</Text>
          {item.pinned ? <Text style={styles.pin}>Pinned</Text> : null}
        </View>
        {item.type === 'note' && item.body ? <Text numberOfLines={2} style={styles.preview}>{item.body}</Text> : null}
        {item.type === 'link' && item.url ? <Text numberOfLines={1} style={styles.preview}>{item.url}</Text> : null}
        {collectionName ? <Text numberOfLines={1} style={styles.collectionLabel}>{collectionName}</Text> : null}
        {item.tags.length ? <Text numberOfLines={1} style={styles.tags}>{item.tags.map(tag => `#${tag}`).join('  ')}</Text> : null}
      </View>
    </View>
  </Pressable>;
}

function EditorPanel({
  client,
  item,
  collections,
  onClose,
}: {
  client: WebCloudClient;
  item: CanonicalItem | null;
  collections: readonly CanonicalCollection[];
  onClose(): void;
}) {
  const [kind, setKind] = useState<NewItemKind>(item?.type === 'link' ? 'link' : 'note');
  const [title, setTitle] = useState(item?.title ?? '');
  const [body, setBody] = useState(item?.type === 'note' ? item.body ?? '' : '');
  const [url, setUrl] = useState(item?.type === 'link' ? item.url ?? '' : '');
  const [tags, setTags] = useState(item?.tags.join(', ') ?? '');
  const [collectionId, setCollectionId] = useState<string | null>(item?.collectionId ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedTags = () => tags.split(',').map(value => value.trim()).filter(Boolean);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (item) {
        await client.patchItem(item.id, {
          title,
          ...(item.type === 'note' ? { body } : {}),
          ...(item.type === 'link' ? { url } : {}),
          tags: normalizedTags(),
          collectionId,
        });
      } else if (kind === 'link') {
        await client.createLink(title, url, normalizedTags(), collectionId);
      } else {
        await client.createNote(title, body, normalizedTags(), collectionId);
      }
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const editKind = item?.type ?? kind;
  return <View style={styles.editor}>
    <View style={styles.editorHeader}>
      <Text style={styles.editorTitle}>{item ? 'Edit item' : `New ${kind}`}</Text>
      <Pressable onPress={onClose}><Text style={styles.actionText}>Close</Text></Pressable>
    </View>
    <ScrollView contentContainerStyle={{ gap: space.md }}>
      {!item ? <View style={styles.segmentRow}>
        <Pressable style={[styles.segment, kind === 'note' && styles.segmentActive]} onPress={() => setKind('note')}>
          <Text style={kind === 'note' ? styles.segmentTextActive : styles.segmentText}>Note</Text>
        </Pressable>
        <Pressable style={[styles.segment, kind === 'link' && styles.segmentActive]} onPress={() => setKind('link')}>
          <Text style={kind === 'link' ? styles.segmentTextActive : styles.segmentText}>Link</Text>
        </Pressable>
      </View> : null}
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Title" />
      {editKind === 'note'
        ? <TextInput style={[styles.input, styles.multiline]} value={body} onChangeText={setBody} multiline placeholder="Write something…" />
        : null}
      {editKind === 'link'
        ? <TextInput style={styles.input} value={url} onChangeText={setUrl} autoCapitalize="none" placeholder="https://…" />
        : null}
      <TextInput style={styles.input} value={tags} onChangeText={setTags} placeholder="tags, comma separated" />
      <View style={styles.collectionPicker}>
        <Text style={styles.pickerLabel}>Collection</Text>
        <View style={styles.collectionChoices}>
          <Pressable style={[styles.collectionChoice, collectionId === null && styles.collectionChoiceActive]} onPress={() => setCollectionId(null)}>
            <Text style={collectionId === null ? styles.segmentTextActive : styles.segmentText}>None</Text>
          </Pressable>
          {collections.map(collection => <Pressable
            key={collection.id}
            style={[styles.collectionChoice, collectionId === collection.id && styles.collectionChoiceActive]}
            onPress={() => setCollectionId(collection.id)}
          >
            <Text numberOfLines={1} style={collectionId === collection.id ? styles.segmentTextActive : styles.segmentText}>{collection.name}</Text>
          </Pressable>)}
        </View>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={styles.primary} onPress={() => void save()} disabled={busy}>
        <Text style={styles.primaryText}>{busy ? 'Saving…' : 'Save'}</Text>
      </Pressable>
      {item ? <>
        <Pressable style={styles.secondary} onPress={() => void client.patchItem(item.id, { pinned: !item.pinned }).then(onClose).catch(actionError => setError(actionError instanceof Error ? actionError.message : 'Could not update item.'))}>
          <Text style={styles.actionText}>{item.pinned ? 'Unpin' : 'Pin'}</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={() => void client.patchItem(item.id, { archived: !item.archived }).then(onClose).catch(actionError => setError(actionError instanceof Error ? actionError.message : 'Could not update item.'))}>
          <Text style={styles.actionText}>{item.archived ? 'Restore' : 'Archive'}</Text>
        </Pressable>
        <Pressable style={styles.danger} onPress={() => void client.deleteItem(item.id).then(onClose).catch(actionError => setError(actionError instanceof Error ? actionError.message : 'Could not delete item.'))}>
          <Text style={styles.dangerText}>Delete</Text>
        </Pressable>
      </> : null}
    </ScrollView>
  </View>;
}

function Workspace({ auth, session, onSignOut }: { auth: SupabaseAuthService; session: AuthSession; onSignOut(): void }) {
  const config = readSupabasePublicConfig()!;
  const [, render] = useReducer((value: number) => value + 1, 0);
  const [section, setSection] = useState<Section>('inbox');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<CanonicalItem | null | undefined>(undefined);
  const searchRef = useRef<TextInput>(null);
  const { width } = useWindowDimensions();
  const token = useCallback(async () => {
    const current = auth.currentSession();
    if (!current) return null;
    if (current.expiresAtEpochMs < Date.now() + 30_000) {
      try { return (await auth.refreshSession()).accessToken; } catch { return null; }
    }
    return current.accessToken;
  }, [auth]);
  const client = useMemo(() => new WebCloudClient(
    session.user.id,
    deviceId(),
    new SupabaseSyncTransport(config, token),
    new SupabaseAssetTransport(config, token),
  ), [config, session.user.id, token]);

  useEffect(() => {
    const unsubscribe = client.subscribe(render);
    void client.initialLoad();
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void client.refresh(); }, 3000);
    const focus = () => void client.refresh();
    const visibility = () => { if (document.visibilityState === 'visible') void client.refresh(); };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      unsubscribe();
      clearInterval(poll);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visibility);
      client.dispose();
    };
  }, [client]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if (event.key === 'Escape' && editing !== undefined) { event.preventDefault(); setEditing(undefined); return; }
      if (typing) return;
      if (event.key === '/') { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key.toLowerCase() === 'n' && section !== 'account' && section !== 'collections') { event.preventDefault(); setEditing(null); }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [editing, section]);

  const snapshot = client.snapshot();
  const collectionNames = new Map(snapshot.collections.map(collection => [collection.id, collection.name]));
  let items = snapshot.items.filter(item => section === 'archive' ? item.archived : !item.archived);
  if (section === 'notes') items = items.filter(item => item.type === 'note');
  if (section === 'images') items = items.filter(item => item.type === 'image');
  if (search.trim()) {
    const query = search.toLowerCase();
    items = items.filter(item => `${item.title} ${item.body ?? ''} ${item.url ?? ''} ${item.tags.join(' ')}`.toLowerCase().includes(query));
  }
  const nav: readonly [Section, string][] = [
    ['inbox', 'Inbox'], ['notes', 'Notes'], ['images', 'Images'], ['collections', 'Collections'], ['archive', 'Archive'], ['account', 'Account'],
  ];

  return <View style={[styles.workspace, width < 760 && styles.workspaceNarrow]}>
    <View style={[styles.sidebar, width < 760 && styles.sidebarNarrow]}>
      <Text style={styles.logo}>Tuck</Text>
      {nav.map(([key, label]) => <Pressable key={key} style={[styles.nav, section === key && styles.navActive]} onPress={() => setSection(key)}>
        <Text style={[styles.navText, section === key && styles.navTextActive]}>{label}</Text>
      </Pressable>)}
    </View>
    <View style={styles.main}>
      <View style={styles.topbar}>
        <View>
          <Text style={styles.pageTitle}>{nav.find(entry => entry[0] === section)?.[1]}</Text>
          <Text style={styles.sync}>{snapshot.syncing ? 'Syncing…' : snapshot.error ? "Couldn't sync" : '☁ Synced'}</Text>
        </View>
        <View style={styles.topActions}>
          {section !== 'account' && section !== 'collections' && !snapshot.loading
            ? <Pressable style={styles.newButton} onPress={() => setEditing(null)}><Text style={styles.primaryText}>+ New</Text></Pressable>
            : null}
          <Pressable style={styles.refresh} onPress={() => void client.refresh()}><Text style={styles.actionText}>Refresh</Text></Pressable>
        </View>
      </View>
      {snapshot.error ? <Text style={styles.errorBanner}>{snapshot.error}</Text> : null}
      {section === 'account'
        ? <View style={styles.accountCard}>
            <Text style={styles.cardTitle}>{session.user.email ?? 'Tuck account'}</Text>
            <Text style={styles.muted}>Secure cloud sync is active for this account.</Text>
            <Pressable style={styles.secondary} onPress={onSignOut}><Text style={styles.actionText}>Sign out</Text></Pressable>
          </View>
        : section === 'collections'
          ? <Collections client={client} collections={snapshot.collections} />
          : <>
              <TextInput ref={searchRef} style={styles.search} value={search} onChangeText={setSearch} placeholder="Search…" />
              <ScrollView contentContainerStyle={styles.grid}>
                {snapshot.loading
                  ? <ActivityIndicator />
                  : items.length
                    ? items.map(item => <ItemCard key={item.id} client={client} item={item} collectionName={item.collectionId ? collectionNames.get(item.collectionId) ?? null : null} onEdit={setEditing} />)
                    : <View style={styles.empty}><Text style={styles.cardTitle}>Nothing here yet</Text><Text style={styles.muted}>Tuck something on Android or create a note here.</Text></View>}
              </ScrollView>
            </>}
      {editing !== undefined
        ? <EditorPanel key={editing?.id ?? 'new'} client={client} item={editing} collections={snapshot.collections} onClose={() => setEditing(undefined)} />
        : null}
    </View>
  </View>;
}

function Collections({ client, collections }: { client: WebCloudClient; collections: readonly CanonicalCollection[] }) {
  const [name, setName] = useState('');
  return <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md }}>
    <View style={styles.collectionCreate}>
      <TextInput style={[styles.input, { flex: 1 }]} value={name} onChangeText={setName} placeholder="New collection" />
      <Pressable style={styles.newButton} onPress={() => { if (name.trim()) void client.createCollection(name).then(() => setName('')); }}>
        <Text style={styles.primaryText}>Add</Text>
      </Pressable>
    </View>
    {collections.map(collection => <View key={collection.id} style={styles.collectionRow}>
      <Text style={styles.cardTitle}>{collection.name}</Text>
      <Pressable onPress={() => {
        const next = prompt('Rename collection', collection.name);
        if (next?.trim()) void client.renameCollection(collection.id, next);
      }}><Text style={styles.actionText}>Rename</Text></Pressable>
      <Pressable onPress={() => { if (confirm(`Delete ${collection.name}?`)) void client.deleteCollection(collection.id); }}>
        <Text style={styles.dangerText}>Delete</Text>
      </Pressable>
    </View>)}
  </ScrollView>;
}

export function WebTuckApp() {
  const configState = useMemo(() => {
    try { return { config: readSupabasePublicConfig(), error: null }; }
    catch (error) { return { config: null, error: error instanceof Error ? error.message : 'Invalid Supabase configuration.' }; }
  }, []);
  const auth = useMemo(() => configState.config ? new SupabaseAuthService(configState.config, new LocalStorageAuthStorage()) : null, [configState.config]);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [restoring, setRestoring] = useState(true);
  useEffect(() => {
    if (!auth) { setRestoring(false); return; }
    void auth.restoreSession().then(setSession).catch(() => setSession(null)).finally(() => setRestoring(false));
  }, [auth]);
  if (configState.error || !auth) return <View style={styles.authRoot}><Text style={styles.error}>{configState.error ?? 'Cloud sync is not configured.'}</Text></View>;
  if (restoring) return <View style={styles.authRoot}><ActivityIndicator /></View>;
  if (!session) return <WebAuth auth={auth} onSession={setSession} />;
  return <Workspace auth={auth} session={session} onSignOut={() => void auth.signOutCurrentDevice().finally(() => setSession(null))} />;
}

const styles = StyleSheet.create({
  authRoot: { flex: 1, minHeight: '100vh' as never, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  authCard: { width: '100%', maxWidth: 440, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sheet, padding: space.xxl, gap: space.md },
  brand: { fontSize: 34, fontWeight: '800', color: colors.primary },
  authTitle: { fontSize: 24, fontWeight: '700', color: colors.text },
  muted: { color: colors.secondaryText, lineHeight: 20 },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radii.control, paddingHorizontal: space.md, backgroundColor: colors.surface, color: colors.text },
  primary: { minHeight: 46, borderRadius: radii.control, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  primaryText: { color: colors.surface, fontWeight: '700' },
  message: { color: colors.primary },
  workspace: { flex: 1, minHeight: '100vh' as never, flexDirection: 'row', backgroundColor: colors.background },
  workspaceNarrow: { flexDirection: 'column' },
  sidebar: { width: 220, padding: space.xl, backgroundColor: colors.surface, borderRightWidth: 1, borderRightColor: colors.border, gap: space.xs },
  sidebarNarrow: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', borderRightWidth: 0, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: space.md },
  logo: { fontSize: 28, fontWeight: '800', color: colors.primary, marginBottom: space.xl },
  nav: { paddingVertical: 10, paddingHorizontal: space.md, borderRadius: radii.control },
  navActive: { backgroundColor: colors.primarySoft },
  navText: { color: colors.secondaryText, fontWeight: '600' },
  navTextActive: { color: colors.primary },
  main: { flex: 1, minWidth: 0, position: 'relative' },
  topbar: { minHeight: 76, paddingHorizontal: space.xl, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pageTitle: { fontSize: 22, fontWeight: '700', color: colors.text },
  sync: { fontSize: 12, color: colors.secondaryText, marginTop: 2 },
  topActions: { flexDirection: 'row', gap: space.sm },
  newButton: { backgroundColor: colors.primary, borderRadius: radii.control, paddingHorizontal: space.lg, minHeight: 42, justifyContent: 'center' },
  refresh: { paddingHorizontal: space.md, minHeight: 42, justifyContent: 'center' },
  actionText: { color: colors.primary, fontWeight: '700' },
  search: { margin: space.xl, marginBottom: 0, minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radii.control, paddingHorizontal: space.md, backgroundColor: colors.surface },
  grid: { padding: space.xl, gap: space.md },
  card: { backgroundColor: colors.surface, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, padding: space.lg },
  cardMain: { flexDirection: 'row', gap: space.lg, alignItems: 'center' },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text, flexShrink: 1 },
  pin: { fontSize: 11, color: colors.primary, backgroundColor: colors.primarySoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  preview: { color: colors.secondaryText, marginTop: space.xs, lineHeight: 20 },
  tags: { color: colors.primary, marginTop: space.sm, fontSize: 12 },
  collectionLabel: { color: colors.secondaryText, marginTop: space.sm, fontSize: 12, fontWeight: '600' },
  thumb: { width: 76, height: 76, borderRadius: 12 },
  imagePlaceholder: { backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', padding: space.xxxl, gap: space.sm },
  editor: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '100%', maxWidth: 460, backgroundColor: colors.surface, borderLeftWidth: 1, borderLeftColor: colors.border, padding: space.xl, boxShadow: '-12px 0 30px rgba(0,0,0,0.08)' as never },
  editorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.xl },
  editorTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  multiline: { minHeight: 180, textAlignVertical: 'top', paddingTop: space.md },
  segmentRow: { flexDirection: 'row', gap: space.sm },
  segment: { minHeight: 40, paddingHorizontal: space.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radii.control, justifyContent: 'center' },
  segmentActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  segmentText: { color: colors.secondaryText, fontWeight: '600' },
  segmentTextActive: { color: colors.primary, fontWeight: '700' },
  collectionPicker: { gap: space.sm },
  pickerLabel: { color: colors.text, fontSize: 13, fontWeight: '700' },
  collectionChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  collectionChoice: { maxWidth: '100%', minHeight: 36, paddingHorizontal: space.md, borderWidth: 1, borderColor: colors.border, borderRadius: 18, justifyContent: 'center' },
  collectionChoiceActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  secondary: { minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radii.control, alignItems: 'center', justifyContent: 'center' },
  danger: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dangerText: { color: colors.error, fontWeight: '700' },
  error: { color: colors.error },
  errorBanner: { backgroundColor: colors.errorSoft, color: colors.error, padding: space.md },
  accountCard: { margin: space.xl, padding: space.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, gap: space.md },
  collectionCreate: { flexDirection: 'row', gap: space.sm },
  collectionRow: { minHeight: 58, padding: space.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, flexDirection: 'row', alignItems: 'center', gap: space.lg },
});
