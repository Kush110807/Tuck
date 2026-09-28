import type { ArchiveScreenProps } from '../../contracts';
import { IconButton } from '../components/IconButton';
import { ListScreenView } from './ListScreenView';

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
      headerLeading={<IconButton icon="back" label="Back" onPress={onBack} />}
    />
  );
}
