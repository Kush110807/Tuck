import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Feedback, ItemQuery, ListState } from '../../contracts';
import { colors, space } from '../../theme/tokens';
import { EmptyState } from '../components/EmptyState';
import { FeedbackBanner } from '../components/FeedbackBanner';
import { FilterBar } from '../components/FilterBar';
import { ItemCard } from '../components/ItemCard';
import { ScreenHeader } from '../components/ScreenHeader';
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
  headerActions?: ReactNode;
  headerLeading?: ReactNode;
  contentBottomInset?: number;
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
  headerLeading,
  contentBottomInset = space.xxl,
}: ListScreenViewProps) {
  const query = state.query;
  const rows = state.kind === 'ready' ? state.rows : state.previousRows;
  const availableTags = state.kind === 'ready' ? state.availableTags : tagsFromPreviousRows(state);
  const filtered = queryHasFilters(query);

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.screen, { paddingBottom: contentBottomInset }]}
      style={styles.scroll}
    >
      <ScreenHeader title={title} subtitle={subtitle} leading={headerLeading} trailing={headerActions} />

      {feedback ? <FeedbackBanner feedback={feedback} onDismiss={onDismissFeedback} /> : null}

      <View style={styles.discovery}>
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
      </View>

      {rows.length > 0 ? (
        <Text style={styles.count} accessibilityLiveRegion="polite">
          {rows.length} thing{rows.length === 1 ? '' : 's'}
          {state.kind === 'loading' ? ' · refreshing' : ''}
        </Text>
      ) : null}

      {state.kind === 'loading' ? <LoadingPanel label={rows.length > 0 ? 'Refreshing items…' : 'Loading items…'} compact={rows.length > 0} /> : null}
      {state.kind === 'failed' ? <ErrorPanel title="Couldn’t load items" error={state.error} onRetry={onRetry} compact={rows.length > 0} /> : null}

      {state.kind === 'ready' && rows.length === 0 ? (
        filtered ? (
          <EmptyState
            title="Nothing matches that search"
            message="Try another phrase or clear your active filters."
            actionLabel="Clear filters"
            onAction={() => onQueryChange({ ...query, text: '', type: 'all', tagKey: null })}
          />
        ) : (
          <EmptyState title={emptyTitle} message={emptyMessage} />
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

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  screen: { flexGrow: 1, paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.lg },
  discovery: { gap: space.sm },
  count: { color: colors.tertiaryText, fontSize: 12, lineHeight: 18, fontWeight: '700', paddingHorizontal: 2 },
  list: { gap: space.sm },
});
