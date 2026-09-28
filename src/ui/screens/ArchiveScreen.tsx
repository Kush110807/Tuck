import type { ArchiveScreenProps } from '../../contracts';
import { HeaderButton, ListScreenView } from './ListScreenView';

export function ArchiveScreen({
  state,
  feedback,
  onQueryChange,
  onOpen,
  onBack,
  onRetry,
  onDismissFeedback,
}: ArchiveScreenProps) {
  return (
    <ListScreenView
      title="Archive"
      subtitle="Items you’ve tucked away but still want to keep."
      state={state}
      feedback={feedback}
      emptyTitle="Archive is empty"
      emptyMessage="Archived items will appear here."
      onQueryChange={onQueryChange}
      onOpen={onOpen}
      onRetry={onRetry}
      onDismissFeedback={onDismissFeedback}
      headerActions={<HeaderButton label="Back" onPress={onBack} />}
    />
  );
}
