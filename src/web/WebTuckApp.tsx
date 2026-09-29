import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { AppIcon } from '../ui/components/AppIcon';
import { colors, minimumTouchSize, radii, space } from '../theme/tokens';
import {
  WebLocalRepository,
  type WebItemKind,
  type WebLocalCollection,
  type WebLocalItem,
  type WebLocalSnapshot,
} from './WebLocalRepository';

type ViewKey = 'inbox' | 'notes' | 'images' | 'archive' | 'collections';
type TypeFilter = 'all' | WebItemKind;
type EditorState = { kind: 'create'; itemKind: Exclude<WebItemKind, 'image'>; collectionId: string | null } | { kind: 'edit'; id: string } | null;

const emptySnapshot: WebLocalSnapshot = { items: [], collections: [], schemaVersion: 1, seeded: false };

function formatRelativeTime(timestamp: number): string {
  const diff = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function domainFor(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

function pickImage(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

function LocalImage({ repository, imageId, style, label }: {
  repository: WebLocalRepository;
  imageId: string | null;
  style: object;
  label: string;
}) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setUri(null);
    if (!imageId) return () => { active = false; };
    void repository.imageUrl(imageId).then(next => { if (active) setUri(next); });
    return () => { active = false; };
  }, [imageId, repository]);
  if (!uri) return <View style={[style, styles.imagePlaceholder]}><AppIcon name="image" size={24} color={colors.tertiaryText} /></View>;
  return <Image source={{ uri }} resizeMode="cover" accessibilityLabel={label} style={style} />;
}

function NavButton({ label, icon, active, onPress, compact = false }: {
  label: string;
  icon: Parameters<typeof AppIcon>[0]['name'];
  active: boolean;
  onPress(): void;
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.navButton, compact && styles.navButtonCompact, active && styles.navButtonActive, pressed && styles.pressed]}
    >
      <AppIcon name={icon} size={18} color={active ? colors.primary : colors.secondaryText} />
      {!compact ? <Text numberOfLines={1} style={[styles.navLabel, active && styles.navLabelActive]}>{label}</Text> : null}
    </Pressable>
  );
}

function MobileNavButton({ label, active, onPress }: { label: string; active: boolean; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.mobileNavButton, active && styles.mobileNavButtonActive, pressed && styles.pressed]}
    >
      <Text numberOfLines={1} style={[styles.mobileNavLabel, active && styles.mobileNavLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function NewMenu({ onNote, onLink, onImage, onClose }: {
  onNote(): void;
  onLink(): void;
  onImage(): void;
  onClose(): void;
}) {
  return (
    <>
      <Pressable accessibilityLabel="Close new item menu" onPress={onClose} style={styles.menuBackdrop} />
      <View pointerEvents="box-none" style={styles.menuHost}><View style={styles.newMenu} accessibilityViewIsModal>
        <Text style={styles.menuEyebrow}>Tuck something</Text>
        {([
          ['note', 'Note', 'A thought, list or idea', onNote],
          ['link', 'Link', 'Something worth revisiting', onLink],
          ['image', 'Image', 'A visual reference', onImage],
        ] as const).map(([icon, title, subtitle, action]) => (
          <Pressable key={title} onPress={action} style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}>
            <View style={styles.menuIcon}><AppIcon name={icon} size={18} color={colors.primary} /></View>
            <View style={styles.menuCopy}>
              <Text style={styles.menuTitle}>{title}</Text>
              <Text style={styles.menuSubtitle}>{subtitle}</Text>
            </View>
            <AppIcon name="chevron" size={20} color={colors.tertiaryText} />
          </Pressable>
        ))}
      </View></View>
    </>
  );
}

function FilterPill({ label, active, onPress }: { label: string; active: boolean; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.filterPill, active && styles.filterPillActive, pressed && styles.pressed]}
    >
      <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ItemCard({ repository, item, collectionName, onOpen }: {
  repository: WebLocalRepository;
  item: WebLocalItem;
  collectionName: string | null;
  onOpen(): void;
}) {
  const [hovered, setHovered] = useState(false);
  const preview = item.kind === 'note' ? item.body : item.kind === 'link' ? domainFor(item.url) : '';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.kind}: ${item.title || 'Untitled'}`}
      onPress={onOpen}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [styles.card, item.kind === 'image' && styles.imageCard, hovered && styles.cardHovered, pressed && styles.cardPressed]}
    >
      {item.kind === 'image' ? (
        <LocalImage repository={repository} imageId={item.imageId} label={`${item.title || 'Untitled'} preview`} style={styles.cardImage} />
      ) : null}
      <View style={styles.cardContent}>
        {item.kind === 'link' ? <Text numberOfLines={1} style={styles.domain}>{domainFor(item.url)}</Text> : null}
        <View style={styles.cardTitleRow}>
          <Text numberOfLines={2} style={styles.cardTitle}>{item.title || 'Untitled'}</Text>
          {item.pinned ? <View style={styles.pinBadge}><AppIcon name="bookmark" size={14} color={colors.primary} /></View> : null}
        </View>
        {preview ? <Text numberOfLines={item.kind === 'note' ? 2 : 1} style={styles.cardPreview}>{preview}</Text> : null}
        <View style={styles.cardMetaRow}>
          <View style={styles.cardMetaLeft}>
            {item.tags.slice(0, 2).map(tag => <Text key={tag.toLowerCase()} numberOfLines={1} style={styles.metaTag}>{tag}</Text>)}
            {collectionName ? <Text numberOfLines={1} style={styles.metaCollection}>{collectionName}</Text> : null}
          </View>
          <Text style={styles.cardTime}>{formatRelativeTime(item.updatedAt)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function EmptyState({ view, searching, onNew }: { view: ViewKey; searching: boolean; onNew(): void }) {
  const copy = searching
    ? ['Nothing matches that search.', 'Try a shorter phrase or clear your filters.']
    : view === 'notes'
      ? ['Your notes will live here.', 'Tuck a thought before it disappears.']
      : view === 'images'
        ? ['A visual shelf for things worth remembering.', 'Add an image when something catches your eye.']
        : view === 'archive'
          ? ['Nothing archived.', 'Things you put away will wait here.']
          : ['Nothing tucked yet.', 'Save a thought, a link, or an image.'];
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}><AppIcon name={view === 'archive' ? 'archive' : 'bookmark'} size={24} color={colors.primary} /></View>
      <Text style={styles.emptyTitle}>{copy[0]}</Text>
      <Text style={styles.emptyMessage}>{copy[1]}</Text>
      {!searching && view !== 'archive' ? (
        <Pressable style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed]} onPress={onNew}>
          <Text style={styles.secondaryActionText}>+ Tuck something</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function CollectionManager({ repository, collections, mobile, onView }: { repository: WebLocalRepository; collections: readonly WebLocalCollection[]; mobile: boolean; onView(id: string): void }) {
  const [name, setName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [rename, setRename] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const submit = async () => {
    if (!name.trim()) return;
    await repository.createCollection(name);
    setName('');
  };
  return (
    <ScrollView contentContainerStyle={[styles.collectionPage, mobile && styles.collectionPageMobile]} keyboardShouldPersistTaps="handled">
      <View style={styles.collectionIntro}>
        <Text style={styles.sectionTitle}>Collections</Text>
        <Text style={styles.sectionSubtitle}>Group related things without hiding them from your library.</Text>
      </View>
      <View style={styles.collectionCreate}>
        <TextInput
          accessibilityLabel="New collection name"
          placeholder="New collection name"
          placeholderTextColor={colors.tertiaryText}
          value={name}
          onChangeText={setName}
          onSubmitEditing={() => void submit()}
          style={styles.collectionInput}
        />
        <Pressable onPress={() => void submit()} style={({ pressed }) => [styles.smallPrimary, pressed && styles.primaryPressed]}>
          <Text style={styles.primaryText}>Add</Text>
        </Pressable>
      </View>
      <View style={styles.collectionList}>
        {collections.length === 0 ? <Text style={styles.collectionEmpty}>No collections yet.</Text> : collections.map(collection => (
          <View key={collection.id} style={[styles.collectionRow, mobile && styles.collectionRowMobile]}>
            <View style={styles.collectionGlyph}><AppIcon name="bookmark" size={17} color={colors.primary} /></View>
            {renamingId === collection.id ? (
              <TextInput
                autoFocus
                value={rename}
                onChangeText={setRename}
                onSubmitEditing={() => void repository.renameCollection(collection.id, rename).then(() => setRenamingId(null))}
                style={styles.collectionRenameInput}
              />
            ) : <Text numberOfLines={1} style={styles.collectionName}>{collection.name}</Text>}
            {deleteId === collection.id ? (
              <View style={[styles.collectionActions, mobile && styles.collectionActionsMobile]}>
                <Pressable onPress={() => setDeleteId(null)} style={styles.textAction}><Text style={styles.quietActionText}>Cancel</Text></Pressable>
                <Pressable onPress={() => void repository.deleteCollection(collection.id).then(() => setDeleteId(null))} style={styles.textAction}><Text style={styles.dangerText}>Delete</Text></Pressable>
              </View>
            ) : (
              <View style={[styles.collectionActions, mobile && styles.collectionActionsMobile]}>
                <Pressable onPress={() => onView(collection.id)} style={styles.textAction}><Text style={styles.actionText}>View</Text></Pressable>
                <Pressable onPress={() => { setRenamingId(collection.id); setRename(collection.name); }} style={styles.textAction}><Text style={styles.quietActionText}>Rename</Text></Pressable>
                <Pressable onPress={() => setDeleteId(collection.id)} style={styles.textAction}><Text style={styles.dangerText}>Delete</Text></Pressable>
              </View>
            )}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function EditorPanel({ repository, state, item, collections, wide, mobile, onClose }: {
  repository: WebLocalRepository;
  state: EditorState;
  item: WebLocalItem | null;
  collections: readonly WebLocalCollection[];
  wide: boolean;
  mobile: boolean;
  onClose(): void;
}) {
  const createKind = state?.kind === 'create' ? state.itemKind : null;
  const kind = item?.kind ?? createKind ?? 'note';
  const [title, setTitle] = useState(item?.title ?? '');
  const [body, setBody] = useState(item?.body ?? '');
  const [url, setUrl] = useState(item?.url ?? '');
  const [collectionId, setCollectionId] = useState<string | null>(item?.collectionId ?? (state?.kind === 'create' ? state.collectionId : null));
  const [tags, setTags] = useState<string[]>([...(item?.tags ?? [])]);
  const [tagInput, setTagInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleRef = useRef<TextInput>(null);

  useEffect(() => { const timer = setTimeout(() => titleRef.current?.focus(), 80); return () => clearTimeout(timer); }, []);

  const addTag = () => {
    const next = tagInput.trim().replace(/^#/, '');
    if (!next || tags.some(tag => tag.toLowerCase() === next.toLowerCase())) { setTagInput(''); return; }
    setTags(current => [...current, next]);
    setTagInput('');
  };

  const save = async () => {
    setBusy(true); setMessage(null);
    try {
      if (item) {
        await repository.patchItem(item.id, { title, body, url, collectionId, tags });
      } else if (kind === 'link') {
        await repository.createLink(title, url, tags, collectionId);
      } else {
        await repository.createNote(title, body, tags, collectionId);
      }
      onClose();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save.'); }
    finally { setBusy(false); }
  };

  const replace = async () => {
    if (!item || item.kind !== 'image') return;
    const file = await pickImage();
    if (!file) return;
    await repository.replaceImage(item.id, file, file.name);
  };

  return (
    <>
      {!wide ? <Pressable accessibilityLabel="Close editor" onPress={onClose} style={styles.editorBackdrop} /> : null}
      <View style={[styles.editorPanel, !wide && styles.editorOverlay]} accessibilityViewIsModal={!wide}>
      <View style={[styles.editorTopbar, mobile && styles.editorTopbarMobile]}>
        <Pressable accessibilityLabel="Close editor" onPress={onClose} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
          <AppIcon name="close" size={22} color={colors.secondaryText} />
        </Pressable>
        <Text style={styles.editorContext}>{item ? item.kind.toUpperCase() : `NEW ${kind.toUpperCase()}`}</Text>
        <Pressable onPress={() => void save()} disabled={busy || (kind === 'link' && !url.trim())} style={({ pressed }) => [styles.doneButton, pressed && styles.primaryPressed]}>
          <Text style={styles.doneText}>{busy ? 'Saving…' : 'Done'}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={[styles.editorScroll, mobile && styles.editorScrollMobile]} keyboardShouldPersistTaps="handled">
        {item?.kind === 'image' ? (
          <View style={styles.editorImageBlock}>
            <LocalImage repository={repository} imageId={item.imageId} label={`${item.title} full image`} style={[styles.editorImage, mobile && styles.editorImageMobile]} />
            <Pressable onPress={() => void replace()} style={({ pressed }) => [styles.replaceButton, pressed && styles.pressed]}><Text style={styles.actionText}>Replace image</Text></Pressable>
          </View>
        ) : null}
        <TextInput
          ref={titleRef}
          accessibilityLabel="Title"
          value={title}
          onChangeText={setTitle}
          placeholder="Untitled"
          placeholderTextColor={colors.tertiaryText}
          multiline
          style={[styles.editorTitleInput, mobile && styles.editorTitleInputMobile]}
        />
        {kind === 'note' || kind === 'image' ? (
          <TextInput
            accessibilityLabel={kind === 'note' ? 'Note body' : 'Image caption'}
            value={body}
            onChangeText={setBody}
            placeholder={kind === 'note' ? 'Start writing…' : 'Add a caption…'}
            placeholderTextColor={colors.tertiaryText}
            multiline
            style={styles.editorBodyInput}
          />
        ) : null}
        {kind === 'link' ? (
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>LINK</Text>
            <TextInput accessibilityLabel="URL" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} placeholder="https://…" placeholderTextColor={colors.tertiaryText} style={styles.metaInput} />
          </View>
        ) : null}

        <View style={styles.editorDivider} />
        <View style={styles.metaBlock}>
          <Text style={styles.metaLabel}>COLLECTION</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            <FilterPill label="None" active={collectionId === null} onPress={() => setCollectionId(null)} />
            {collections.map(collection => <FilterPill key={collection.id} label={collection.name} active={collectionId === collection.id} onPress={() => setCollectionId(collection.id)} />)}
          </ScrollView>
        </View>
        <View style={styles.metaBlock}>
          <Text style={styles.metaLabel}>TAGS</Text>
          <View style={styles.tagEditorRow}>
            {tags.map(tag => (
              <Pressable key={tag.toLowerCase()} accessibilityLabel={`Remove tag ${tag}`} onPress={() => setTags(current => current.filter(value => value !== tag))} style={styles.editTag}>
                <Text style={styles.editTagText}>{tag}</Text><Text style={styles.editTagClose}> ×</Text>
              </Pressable>
            ))}
            <TextInput value={tagInput} onChangeText={setTagInput} onSubmitEditing={addTag} placeholder="Add tag" placeholderTextColor={colors.tertiaryText} style={styles.tagInput} />
          </View>
        </View>

        {message ? <Text style={styles.errorText}>{message}</Text> : null}

        {item ? (
          <View style={styles.editorSecondaryActions}>
            <Pressable onPress={() => void repository.patchItem(item.id, { pinned: !item.pinned })} style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed]}>
              <Text style={styles.secondaryActionText}>{item.pinned ? 'Unpin' : 'Pin'}</Text>
            </Pressable>
            <Pressable onPress={() => void repository.patchItem(item.id, { archived: !item.archived }).then(onClose)} style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed]}>
              <Text style={styles.secondaryActionText}>{item.archived ? 'Restore' : 'Archive'}</Text>
            </Pressable>
          </View>
        ) : null}

        {item ? (
          <View style={styles.dangerZone}>
            {confirmDelete ? (
              <View style={styles.deleteConfirm}>
                <View style={{ flex: 1 }}><Text style={styles.deleteConfirmTitle}>Delete permanently?</Text><Text style={styles.deleteConfirmCopy}>This can’t be undone.</Text></View>
                <Pressable onPress={() => setConfirmDelete(false)} style={styles.textAction}><Text style={styles.quietActionText}>Cancel</Text></Pressable>
                <Pressable onPress={() => void repository.deleteItem(item.id).then(onClose)} style={styles.textAction}><Text style={styles.dangerText}>Delete</Text></Pressable>
              </View>
            ) : <Pressable onPress={() => setConfirmDelete(true)} style={styles.textAction}><Text style={styles.dangerText}>Delete item</Text></Pressable>}
          </View>
        ) : null}
      </ScrollView>
      </View>
    </>
  );
}

export function WebTuckApp() {
  const repository = useMemo(() => new WebLocalRepository(), []);
  const [snapshot, setSnapshot] = useState<WebLocalSnapshot>(emptySnapshot);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [view, setView] = useState<ViewKey>('inbox');
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<EditorState>(null);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const searchRef = useRef<TextInput>(null);
  const { width } = useWindowDimensions();
  const compact = width < 1180;
  const mobile = width < 820;
  const wideEditor = width >= 1360;

  const reload = useCallback(async () => {
    try { setSnapshot(await repository.snapshot()); setReady(true); setStorageError(null); }
    catch (error) { setStorageError(error instanceof Error ? error.message : 'Could not open browser storage.'); setReady(true); }
  }, [repository]);

  useEffect(() => {
    let active = true;
    const unsubscribe = repository.subscribe(() => { if (active) void reload(); });
    void repository.initialize().then(() => { if (active) void reload(); }).catch(error => {
      if (!active) return;
      setStorageError(error instanceof Error ? error.message : 'Could not open browser storage.');
      setReady(true);
    });
    return () => { active = false; unsubscribe(); repository.dispose(); };
  }, [reload, repository]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if (event.key === 'Escape') {
        if (newMenuOpen) { event.preventDefault(); setNewMenuOpen(false); return; }
        if (editor) { event.preventDefault(); setEditor(null); return; }
      }
      if (typing) return;
      if (event.key === '/') { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); setNewMenuOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor, newMenuOpen]);

  const collectionNames = useMemo(() => new Map(snapshot.collections.map(collection => [collection.id, collection.name])), [snapshot.collections]);
  const effectiveType: TypeFilter = view === 'notes' ? 'note' : view === 'images' ? 'image' : typeFilter;
  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return snapshot.items.filter(item => {
      if (view === 'archive' ? !item.archived : item.archived) return false;
      if (effectiveType !== 'all' && item.kind !== effectiveType) return false;
      if (selectedCollectionId && item.collectionId !== selectedCollectionId) return false;
      if (query) {
        const collectionName = item.collectionId ? collectionNames.get(item.collectionId) ?? '' : '';
        const haystack = `${item.title} ${item.body} ${item.url} ${item.tags.join(' ')} ${collectionName}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [collectionNames, effectiveType, search, selectedCollectionId, snapshot.items, view]);

  const pinnedItems = visibleItems.filter(item => item.pinned);
  const regularItems = visibleItems.filter(item => !item.pinned);
  const selectedCollection = selectedCollectionId ? snapshot.collections.find(collection => collection.id === selectedCollectionId) ?? null : null;
  const title = selectedCollection?.name ?? (view === 'inbox' ? 'Inbox' : view === 'notes' ? 'Notes' : view === 'images' ? 'Images' : view === 'archive' ? 'Archive' : 'Collections');
  const itemCount = visibleItems.length;
  const editingItem = editor?.kind === 'edit' ? snapshot.items.find(item => item.id === editor.id) ?? null : null;

  const openNewImage = async () => {
    setNewMenuOpen(false);
    if (view === 'archive' || view === 'collections') { setView('inbox'); setSelectedCollectionId(null); }
    const file = await pickImage();
    if (!file) return;
    const item = await repository.createImage(file, file.name, '', [], selectedCollectionId);
    setEditor({ kind: 'edit', id: item.id });
  };

  const openNew = (kind: 'note' | 'link') => {
    setNewMenuOpen(false);
    const targetCollection = view === 'archive' || view === 'collections' ? null : selectedCollectionId;
    if (view === 'archive' || view === 'collections') { setView('inbox'); setSelectedCollectionId(null); }
    setEditor({ kind: 'create', itemKind: kind, collectionId: targetCollection });
  };
  const chooseView = (next: ViewKey) => { setView(next); setSelectedCollectionId(null); if (next === 'notes') setTypeFilter('note'); else if (next === 'images') setTypeFilter('image'); else setTypeFilter('all'); };

  return (
    <View style={styles.workspace}>
      {!mobile ? (
        <View style={[styles.sidebar, compact && styles.sidebarCompact]}>
          <View style={styles.brandBlock}>
            <Text style={styles.logo}>Tuck</Text>
            {!compact ? <Text style={styles.tagline}>Keep what matters. Find it fast.</Text> : null}
          </View>
          <Pressable onPress={() => setNewMenuOpen(true)} style={({ pressed }) => [styles.sidebarNew, compact && styles.sidebarNewCompact, pressed && styles.primaryPressed]}>
            <AppIcon name="add" size={19} color={colors.surface} />{!compact ? <Text style={styles.sidebarNewText}>New</Text> : null}
          </Pressable>
          <View style={styles.navGroup}>
            <NavButton icon="bookmark" label="Inbox" active={view === 'inbox' && !selectedCollectionId} onPress={() => chooseView('inbox')} compact={compact} />
            <NavButton icon="note" label="Notes" active={view === 'notes'} onPress={() => chooseView('notes')} compact={compact} />
            <NavButton icon="image" label="Images" active={view === 'images'} onPress={() => chooseView('images')} compact={compact} />
          </View>
          <View style={styles.navSection}>
            {!compact ? <Text style={styles.navSectionLabel}>COLLECTIONS</Text> : null}
            {!compact ? snapshot.collections.slice(0, 8).map(collection => (
              <Pressable key={collection.id} onPress={() => { setView('inbox'); setSelectedCollectionId(collection.id); setTypeFilter('all'); }} style={({ pressed }) => [styles.collectionNav, selectedCollectionId === collection.id && styles.collectionNavActive, pressed && styles.pressed]}>
                <View style={styles.collectionDot} /><Text numberOfLines={1} style={[styles.collectionNavText, selectedCollectionId === collection.id && styles.navLabelActive]}>{collection.name}</Text>
              </Pressable>
            )) : null}
            <NavButton icon="options" label="Collections" active={view === 'collections'} onPress={() => chooseView('collections')} compact={compact} />
          </View>
          <View style={styles.sidebarBottom}>
            <NavButton icon="archive" label="Archive" active={view === 'archive'} onPress={() => chooseView('archive')} compact={compact} />
          </View>
        </View>
      ) : null}

      <View style={styles.mainShell}>
        {mobile ? (
          <View style={styles.mobileHeader}>
            <View><Text style={styles.mobileLogo}>Tuck</Text><Text style={styles.mobileTagline}>Keep what matters. Find it fast.</Text></View>
            <Pressable accessibilityLabel="New item" onPress={() => setNewMenuOpen(true)} style={({ pressed }) => [styles.mobileNew, pressed && styles.primaryPressed]}><AppIcon name="add" size={22} color={colors.surface} /></Pressable>
          </View>
        ) : null}
        {mobile ? (
          <View style={styles.mobileNav}>
            <MobileNavButton label="Inbox" active={view === 'inbox' && !selectedCollectionId} onPress={() => chooseView('inbox')} />
            <MobileNavButton label="Notes" active={view === 'notes'} onPress={() => chooseView('notes')} />
            <MobileNavButton label="Images" active={view === 'images'} onPress={() => chooseView('images')} />
            <MobileNavButton label="Collections" active={view === 'collections'} onPress={() => chooseView('collections')} />
            <MobileNavButton label="Archive" active={view === 'archive'} onPress={() => chooseView('archive')} />
          </View>
        ) : null}

        <View style={styles.contentAndEditor}>
          <View style={styles.libraryPane}>
            {view === 'collections' ? (
              <CollectionManager repository={repository} collections={snapshot.collections} mobile={mobile} onView={id => { setView('inbox'); setSelectedCollectionId(id); setTypeFilter('all'); }} />
            ) : (
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.libraryScroll, mobile && styles.libraryScrollMobile]}>
                <View style={styles.libraryHeader}>
                  <View style={styles.libraryHeading}>
                    <Text accessibilityRole="header" style={styles.pageTitle}>{title}</Text>
                    <Text style={styles.itemCount}>{itemCount} {itemCount === 1 ? 'thing' : 'things'}</Text>
                  </View>
                  {!mobile ? (
                    <Pressable onPress={() => setNewMenuOpen(true)} style={({ pressed }) => [styles.topNew, pressed && styles.primaryPressed]}>
                      <AppIcon name="add" size={18} color={colors.surface} /><Text style={styles.primaryText}>New</Text>
                    </Pressable>
                  ) : null}
                </View>

                <View style={styles.searchBox}>
                  <AppIcon name="search" size={20} color={colors.secondaryText} />
                  <TextInput
                    ref={searchRef}
                    accessibilityLabel="Search your Tuck"
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Search anything…"
                    placeholderTextColor={colors.tertiaryText}
                    style={styles.searchInput}
                  />
                  {search ? <Pressable accessibilityLabel="Clear search" onPress={() => setSearch('')} style={styles.iconButton}><AppIcon name="close" size={19} color={colors.secondaryText} /></Pressable> : <Text style={styles.shortcutHint}>/</Text>}
                </View>

                {view !== 'archive' ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                    <FilterPill label="All" active={effectiveType === 'all'} onPress={() => { setView('inbox'); setTypeFilter('all'); }} />
                    <FilterPill label="Notes" active={effectiveType === 'note'} onPress={() => { setView('inbox'); setTypeFilter('note'); }} />
                    <FilterPill label="Images" active={effectiveType === 'image'} onPress={() => { setView('inbox'); setTypeFilter('image'); }} />
                    <FilterPill label="Links" active={effectiveType === 'link'} onPress={() => { setView('inbox'); setTypeFilter('link'); }} />
                    {selectedCollection ? <View style={styles.selectedCollectionChip}><Text numberOfLines={1} style={styles.selectedCollectionText}>{selectedCollection.name}</Text><Pressable accessibilityLabel="Clear collection filter" onPress={() => setSelectedCollectionId(null)}><AppIcon name="close" size={16} color={colors.primary} /></Pressable></View> : null}
                  </ScrollView>
                ) : null}

                {!ready ? <View style={styles.loadingSkeleton}><View style={styles.skeletonLine} /><View style={styles.skeletonCard} /><View style={styles.skeletonCard} /></View> : null}
                {storageError ? <View style={styles.storageError}><Text style={styles.errorTitle}>Browser storage is unavailable</Text><Text style={styles.errorCopy}>{storageError}</Text></View> : null}

                {ready && !storageError && visibleItems.length === 0 ? <EmptyState view={view} searching={Boolean(search.trim() || selectedCollectionId || (view === 'inbox' && typeFilter !== 'all'))} onNew={() => setNewMenuOpen(true)} /> : null}

                {pinnedItems.length > 0 ? (
                  <View style={styles.itemSection}>
                    <Text style={styles.sectionEyebrow}>PINNED</Text>
                    <View style={styles.cardGrid}>{pinnedItems.map(item => <ItemCard key={item.id} repository={repository} item={item} collectionName={item.collectionId ? collectionNames.get(item.collectionId) ?? null : null} onOpen={() => setEditor({ kind: 'edit', id: item.id })} />)}</View>
                  </View>
                ) : null}
                {regularItems.length > 0 ? (
                  <View style={styles.itemSection}>
                    <Text style={styles.sectionEyebrow}>{view === 'archive' ? 'ARCHIVED' : pinnedItems.length ? 'RECENT' : 'RECENT'}</Text>
                    <View style={styles.cardGrid}>{regularItems.map(item => <ItemCard key={item.id} repository={repository} item={item} collectionName={item.collectionId ? collectionNames.get(item.collectionId) ?? null : null} onOpen={() => setEditor({ kind: 'edit', id: item.id })} />)}</View>
                  </View>
                ) : null}
              </ScrollView>
            )}
          </View>
          {editor ? <EditorPanel key={editor.kind === 'edit' ? editor.id : `new-${editor.itemKind}-${editor.collectionId ?? 'none'}`} repository={repository} state={editor} item={editingItem} collections={snapshot.collections} wide={wideEditor} mobile={mobile} onClose={() => setEditor(null)} /> : null}
        </View>
      </View>
      {newMenuOpen ? <NewMenu onClose={() => setNewMenuOpen(false)} onNote={() => openNew('note')} onLink={() => openNew('link')} onImage={() => void openNewImage()} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  workspace: { flex: 1, minHeight: '100vh' as never, flexDirection: 'row', backgroundColor: colors.background },
  sidebar: { width: 244, minHeight: '100vh' as never, backgroundColor: '#F2EEE5', paddingHorizontal: 18, paddingTop: 28, paddingBottom: 20, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.divider },
  sidebarCompact: { width: 88, paddingHorizontal: 10 },
  brandBlock: { marginBottom: 22, paddingHorizontal: 8 },
  logo: { color: colors.text, fontSize: 31, lineHeight: 36, fontWeight: '900', letterSpacing: -0.9 },
  tagline: { marginTop: 4, color: colors.secondaryText, fontSize: 13, lineHeight: 19, maxWidth: 190 },
  sidebarNew: { minHeight: 44, borderRadius: 14, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 22, paddingHorizontal: 14 },
  sidebarNewText: { color: colors.surface, fontWeight: '800', fontSize: 14 },
  sidebarNewCompact: { width: 44, paddingHorizontal: 0, alignSelf: 'center' },
  navGroup: { gap: 3 },
  navSection: { marginTop: 22, gap: 3 },
  navSectionLabel: { paddingHorizontal: 12, marginBottom: 6, color: colors.tertiaryText, fontSize: 10, lineHeight: 16, fontWeight: '800', letterSpacing: 1.1 },
  navButton: { minHeight: 42, borderRadius: 12, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 10 },
  navButtonCompact: { justifyContent: 'center', paddingHorizontal: 8 },
  navButtonActive: { backgroundColor: '#E2E7DE' },
  navLabel: { color: colors.secondaryText, fontSize: 14, lineHeight: 20, fontWeight: '650' as never },
  navLabelActive: { color: colors.primary, fontWeight: '800' },
  collectionNav: { minHeight: 37, borderRadius: 11, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9 },
  collectionNavActive: { backgroundColor: colors.primarySoft },
  collectionDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#A5B5A7' },
  collectionNavText: { flex: 1, minWidth: 0, color: colors.secondaryText, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  sidebarBottom: { marginTop: 'auto' as never },
  mainShell: { flex: 1, minWidth: 0 },
  mobileHeader: { minHeight: 76, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.background },
  mobileLogo: { color: colors.text, fontSize: 27, lineHeight: 31, fontWeight: '900', letterSpacing: -0.7 },
  mobileTagline: { color: colors.secondaryText, fontSize: 12, lineHeight: 17 },
  mobileNew: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  mobileNav: { paddingHorizontal: 12, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 3 },
  mobileNavButton: { flex: 1, minWidth: 0, minHeight: 40, borderRadius: 12, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  mobileNavButtonActive: { backgroundColor: '#E2E7DE' },
  mobileNavLabel: { color: colors.secondaryText, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  mobileNavLabelActive: { color: colors.primary, fontWeight: '850' as never },
  contentAndEditor: { flex: 1, flexDirection: 'row', minHeight: 0 },
  libraryPane: { flex: 1, minWidth: 0 },
  libraryScroll: { paddingHorizontal: 34, paddingTop: 36, paddingBottom: 64, width: '100%', maxWidth: 860, alignSelf: 'center' },
  libraryScrollMobile: { paddingHorizontal: 16, paddingTop: 22, paddingBottom: 48 },
  libraryHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18, marginBottom: 24 },
  libraryHeading: { gap: 3 },
  pageTitle: { color: colors.text, fontSize: 30, lineHeight: 36, fontWeight: '850' as never, letterSpacing: -0.55 },
  itemCount: { color: colors.secondaryText, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  topNew: { minHeight: 42, borderRadius: 13, backgroundColor: colors.primary, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 7 },
  primaryText: { color: colors.surface, fontSize: 14, lineHeight: 20, fontWeight: '800' },
  searchBox: { minHeight: 52, borderRadius: 16, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.divider, flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 6, boxShadow: '0 3px 14px rgba(42, 45, 40, 0.04)' as never },
  searchInput: { flex: 1, minHeight: 50, paddingHorizontal: 11, color: colors.text, fontSize: 15, lineHeight: 21 },
  shortcutHint: { minWidth: 30, textAlign: 'center', color: colors.tertiaryText, fontSize: 12, fontWeight: '700', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.divider, borderRadius: 7, paddingVertical: 3 },
  iconButton: { minWidth: minimumTouchSize, minHeight: minimumTouchSize, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  filterRow: { paddingTop: 14, paddingBottom: 28, gap: 7, alignItems: 'center' },
  filterPill: { minHeight: 40, borderRadius: 18, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  filterPillActive: { backgroundColor: colors.primarySoft },
  filterPillText: { color: colors.secondaryText, fontSize: 13, lineHeight: 18, fontWeight: '650' as never },
  filterPillTextActive: { color: colors.primary, fontWeight: '800' },
  selectedCollectionChip: { maxWidth: 220, minHeight: 34, borderRadius: 18, paddingLeft: 13, paddingRight: 8, backgroundColor: '#EEE8DC', flexDirection: 'row', alignItems: 'center', gap: 5 },
  selectedCollectionText: { flexShrink: 1, color: colors.primary, fontSize: 13, fontWeight: '700' },
  itemSection: { gap: 10, marginBottom: 28 },
  sectionEyebrow: { color: colors.tertiaryText, fontSize: 10, lineHeight: 15, fontWeight: '850' as never, letterSpacing: 1.15, paddingHorizontal: 2 },
  cardGrid: { gap: 10 },
  card: { borderRadius: 18, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: '#DDD8CD', overflow: 'hidden', boxShadow: '0 2px 8px rgba(38, 41, 37, 0.025)' as never, transitionDuration: '170ms' as never, transitionProperty: 'transform, box-shadow, border-color, background-color' as never },
  imageCard: {},
  cardHovered: { borderColor: '#CEC8BB', boxShadow: '0 8px 24px rgba(38,41,37,0.07)' as never, transform: [{ translateY: -1 }] },
  cardPressed: { backgroundColor: '#FAF8F3', transform: [{ scale: 0.997 }] },
  cardImage: { width: '100%', height: 220, backgroundColor: colors.surfaceMuted },
  imagePlaceholder: { backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  cardContent: { paddingHorizontal: 18, paddingVertical: 16 },
  domain: { color: colors.primary, fontSize: 11, lineHeight: 16, fontWeight: '800', marginBottom: 4 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardTitle: { flex: 1, minWidth: 0, color: colors.text, fontSize: 17, lineHeight: 23, fontWeight: '760' as never, letterSpacing: -0.15 },
  pinBadge: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  cardPreview: { marginTop: 6, color: colors.secondaryText, fontSize: 14, lineHeight: 21 },
  cardMetaRow: { minHeight: 22, marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cardMetaLeft: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 },
  metaTag: { maxWidth: 120, color: colors.primary, fontSize: 11, lineHeight: 17, fontWeight: '650' as never },
  metaCollection: { maxWidth: 150, color: colors.secondaryText, fontSize: 11, lineHeight: 17, fontWeight: '650' as never },
  cardTime: { color: colors.tertiaryText, fontSize: 11, lineHeight: 17, fontWeight: '600' },
  emptyState: { minHeight: 320, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 9 },
  emptyIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  emptyTitle: { color: colors.text, fontSize: 20, lineHeight: 27, fontWeight: '800', textAlign: 'center' },
  emptyMessage: { maxWidth: 380, color: colors.secondaryText, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  secondaryAction: { minHeight: 40, borderRadius: 12, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  secondaryActionText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  loadingSkeleton: { paddingTop: 18, gap: 10 },
  skeletonLine: { width: 76, height: 10, borderRadius: 5, backgroundColor: colors.surfaceMuted },
  skeletonCard: { height: 112, borderRadius: 18, backgroundColor: '#ECE8DE' },
  storageError: { padding: 22, borderRadius: 16, backgroundColor: colors.errorSoft, gap: 5 },
  errorTitle: { color: colors.error, fontWeight: '800', fontSize: 16 },
  errorCopy: { color: colors.error, fontSize: 13, lineHeight: 20 },
  editorPanel: { width: 420, minWidth: 390, backgroundColor: colors.surface, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.divider, boxShadow: '-14px 0 30px rgba(38, 41, 37, 0.045)' as never, zIndex: 20 },
  editorBackdrop: { position: 'fixed' as never, left: 0, right: 0, top: 0, bottom: 0, zIndex: 18, backgroundColor: 'rgba(28,31,27,0.13)' },
  editorOverlay: { position: 'fixed' as never, right: 0, top: 0, bottom: 0, width: '100%', maxWidth: 520, minWidth: 0, boxShadow: '-20px 0 50px rgba(28,31,27,0.13)' as never },
  editorTopbar: { minHeight: 68, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  editorContext: { color: colors.tertiaryText, fontSize: 10, lineHeight: 15, fontWeight: '850' as never, letterSpacing: 1.1 },
  doneButton: { minHeight: 38, borderRadius: 12, paddingHorizontal: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  doneText: { color: colors.surface, fontSize: 13, fontWeight: '800' },
  editorScroll: { paddingHorizontal: 28, paddingTop: 24, paddingBottom: 48 },
  editorScrollMobile: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },
  editorImageBlock: { gap: 10, marginBottom: 20 },
  editorImage: { width: '100%', height: 230, borderRadius: 18, backgroundColor: colors.surfaceMuted },
  replaceButton: { alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center', paddingHorizontal: 4 },
  actionText: { color: colors.primary, fontSize: 13, lineHeight: 19, fontWeight: '800' },
  editorImageMobile: { height: 210, },
  editorTopbarMobile: { minHeight: 62, paddingHorizontal: 12 },
  editorTitleInput: { color: colors.text, fontSize: 29, lineHeight: 36, fontWeight: '800', letterSpacing: -0.55, paddingHorizontal: 0, paddingVertical: 4 },
  editorTitleInputMobile: { fontSize: 27, lineHeight: 34 },
  editorBodyInput: { minHeight: 190, color: colors.text, fontSize: 16, lineHeight: 27, paddingHorizontal: 0, paddingTop: 12, paddingBottom: 18, textAlignVertical: 'top' },
  editorDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider, marginVertical: 22 },
  metaBlock: { gap: 9, marginBottom: 18 },
  metaLabel: { color: colors.tertiaryText, fontSize: 10, lineHeight: 15, fontWeight: '850' as never, letterSpacing: 1.05 },
  metaInput: { minHeight: 44, borderRadius: 12, backgroundColor: colors.background, color: colors.text, paddingHorizontal: 13, fontSize: 14 },
  chipRow: { gap: 7, paddingRight: 12 },
  tagEditorRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 },
  editTag: { minHeight: 32, borderRadius: 16, backgroundColor: colors.primarySoft, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center' },
  editTagText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  editTagClose: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  tagInput: { minWidth: 90, minHeight: 34, paddingHorizontal: 8, color: colors.text, fontSize: 13 },
  editorSecondaryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  dangerZone: { marginTop: 30, paddingTop: 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  deleteConfirm: { minHeight: 66, borderRadius: 14, backgroundColor: colors.errorSoft, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  deleteConfirmTitle: { color: colors.text, fontSize: 13, fontWeight: '800' },
  deleteConfirmCopy: { color: colors.secondaryText, fontSize: 12, marginTop: 2 },
  textAction: { minHeight: 38, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  quietActionText: { color: colors.secondaryText, fontSize: 12, fontWeight: '750' as never },
  dangerText: { color: colors.error, fontSize: 12, fontWeight: '800' },
  errorText: { color: colors.error, fontSize: 13, lineHeight: 19 },
  collectionPage: { paddingHorizontal: 34, paddingTop: 36, paddingBottom: 64, width: '100%', maxWidth: 820, alignSelf: 'center' },
  collectionPageMobile: { paddingHorizontal: 16, paddingTop: 22, paddingBottom: 48 },
  collectionIntro: { gap: 5, marginBottom: 24 },
  sectionTitle: { color: colors.text, fontSize: 29, lineHeight: 36, fontWeight: '850' as never, letterSpacing: -0.4 },
  sectionSubtitle: { color: colors.secondaryText, fontSize: 14, lineHeight: 21 },
  collectionCreate: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 24 },
  collectionInput: { flex: 1, minHeight: 46, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.divider, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: 14 },
  smallPrimary: { minHeight: 44, borderRadius: 13, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  collectionList: { gap: 8 },
  collectionEmpty: { color: colors.secondaryText, fontSize: 14, paddingVertical: 18 },
  collectionRow: { minHeight: 60, borderRadius: 16, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.divider, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  collectionRowMobile: { flexWrap: 'wrap', paddingVertical: 8 },
  collectionGlyph: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  collectionName: { flex: 1, minWidth: 0, color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '750' as never },
  collectionRenameInput: { flex: 1, minWidth: 0, minHeight: 38, borderRadius: 10, backgroundColor: colors.background, color: colors.text, paddingHorizontal: 10 },
  collectionActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  collectionActionsMobile: { width: '100%', paddingLeft: 44, justifyContent: 'flex-start' },
  menuBackdrop: { position: 'fixed' as never, left: 0, right: 0, top: 0, bottom: 0, zIndex: 80, backgroundColor: 'rgba(28,31,27,0.16)' },
  menuHost: { position: 'fixed' as never, zIndex: 90, left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', paddingHorizontal: 16, paddingTop: '18vh' as never },
  newMenu: { width: '100%', maxWidth: 390, borderRadius: 22, backgroundColor: colors.surface, padding: 12, boxShadow: '0 24px 70px rgba(28,31,27,0.18)' as never },
  menuEyebrow: { color: colors.tertiaryText, fontSize: 10, lineHeight: 15, fontWeight: '850' as never, letterSpacing: 1.05, paddingHorizontal: 10, paddingVertical: 8 },
  menuRow: { minHeight: 64, borderRadius: 14, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 11 },
  menuRowPressed: { backgroundColor: colors.background },
  menuIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  menuCopy: { flex: 1, minWidth: 0 },
  menuTitle: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '800' },
  menuSubtitle: { color: colors.secondaryText, fontSize: 12, lineHeight: 18, marginTop: 1 },
  pressed: { opacity: 0.72 },
  primaryPressed: { backgroundColor: colors.primaryPressed },
});
