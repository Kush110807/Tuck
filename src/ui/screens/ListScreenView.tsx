import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Feedback, ItemQuery, ListState } from '../../contracts';
import { colors, space } from '../../theme/tokens';
import { ActionButton } from '../components/ActionButton';
import { EmptyState } from '../components/EmptyState';
import { FeedbackBanner } from '../components/FeedbackBanner';
import { FilterBar } from '../components/FilterBar';
import { ItemCard } from '../components/ItemCard';
import { SearchField } from '../components/SearchField';
import { ErrorPanel, LoadingPanel } from '../components/ScreenStates';

type ListScreenViewProps = {
  title: string;
  subtitle: string;
  state: ListState;
  feedback: Feedback | null;
  emptyTitle: string;
  emptyMessage: string;
  onQueryChange(next: ItemQuery): void;
  onOpen(id: string): void;
  onRetry(): void;
  onDismissFeedback(): void;
  headerActions: ReactNode;
  emptyAction?: ReactNode;
};

function queryHasFilters(query: ItemQuery) {
  return query.text.trim().length > 0 || query.type !== 'all' || query.tagKey !== null;
}

function tagsFromPreviousRows(state: Extract<ListState, { kind: 'loading' | 'failed' }>): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const row of state.previousRows) {
    for (const tag of row.item.tags) {
      const key = tag.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(tag);
      }
    }
  }
  return result;
}

export function ListScreenView({
  title,
  subtitle,
  state,
  feedback,
  emptyTitle,
  emptyMessage,
  onQueryChange,
  onOpen,
  onRetry,
  onDismissFeedback,
  headerActions,
  emptyAction,
}: ListScreenViewProps) {
  const query = state.query;
  const rows = state.kind === 'ready' ? state.rows : state.previousRows;
  const availableTags = state.kind === 'ready' ? state.availableTags : tagsFromPreviousRows(state);
  const filtered = queryHasFilters(query);

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.screen}
      style={styles.scroll}
    >
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <View style={styles.headerActions}>{headerActions}</View>
      </View>

      {feedback ? <FeedbackBanner feedback={feedback} onDismiss={onDismissFeedback} /> : null}

      <SearchField
        value={query.text}
        onChangeText={text => onQueryChange({ ...query, text })}
        onClear={() => onQueryChange({ ...query, text: '' })}
      />
      <FilterBar
        type={query.type}
        tagKey={query.tagKey}
        availableTags={availableTags}
        onTypeChange={type => onQueryChange({ ...query, type })}
        onTagChange={tagKey => onQueryChange({ ...query, tagKey })}
      />

      {state.kind === 'loading' ? <LoadingPanel label={rows.length > 0 ? 'Refreshing items…' : 'Loading items…'} /> : null}
      {state.kind === 'failed' ? <ErrorPanel title="Couldn’t load items" error={state.error} onRetry={onRetry} /> : null}

      {state.kind === 'ready' && rows.length === 0 ? (
        filtered ? (
          <EmptyState
            title="No matches"
            message="Try a different search, item type, or tag."
            actionLabel="Clear filters"
            onAction={() => onQueryChange({ ...query, text: '', type: 'all', tagKey: null })}
          />
        ) : (
          <View style={styles.emptyWrap}>
            <EmptyState title={emptyTitle} message={emptyMessage} />
            {emptyAction}
          </View>
        )
      ) : null}

      {rows.length > 0 ? (
        <View style={styles.list} accessibilityLabel={`${rows.length} item${rows.length === 1 ? '' : 's'}`}>
          {rows.map(row => <ItemCard key={row.item.id} row={row} onPress={() => onOpen(row.item.id)} />)}
        </View>
      ) : null}
    </ScrollView>
  );
}

export function HeaderButton({ label, onPress, variant = 'secondary' }: {
  label: string;
  onPress(): void;
  variant?: 'primary' | 'secondary' | 'text';
}) {
  return <ActionButton label={label} onPress={onPress} variant={variant} />;
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  screen: { flexGrow: 1, padding: space.lg, gap: space.lg },
  header: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, alignItems: 'flex-start', justifyContent: 'space-between' },
  headerCopy: { flexGrow: 1, flexShrink: 1, flexBasis: 220, gap: space.xs },
  title: { color: colors.text, fontSize: 30, lineHeight: 38, fontWeight: '800' },
  subtitle: { color: colors.secondaryText, fontSize: 16, lineHeight: 24 },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  list: { gap: space.md },
  emptyWrap: { gap: space.md },
});
