import { CommonActions, createNavigationContainerRef, StackActions } from '@react-navigation/native';
import type { ItemId, ListRoute, NavigationActions, RootStackParams } from '../contracts';

export const navigationRef = createNavigationContainerRef<RootStackParams>();

function resetInbox() {
  if (navigationRef.isReady()) navigationRef.dispatch(CommonActions.reset({
    index: 0, routes: [{ name: 'Inbox' }],
  }));
}
function popToExisting(name: ListRoute): boolean {
  if (!navigationRef.isReady()) return false;
  const routes = navigationRef.getRootState()?.routes;
  if (!routes) return false;
  const index = routes.findLastIndex(route => route.name === name);
  if (index < 0) return false;
  const count = routes.length - 1 - index;
  if (count > 0) navigationRef.dispatch(StackActions.pop(count));
  return true;
}

/** Master-owned route operations. C publishes a notice only after success. */
export const navigationActions: NavigationActions = {
  showDetail(id: ItemId, origin: ListRoute) {
    if (navigationRef.isReady()) navigationRef.dispatch(StackActions.push('Detail', { id, origin }));
  },
  completeCreate(id: ItemId) {
    if (navigationRef.isReady()) navigationRef.dispatch(StackActions.replace('Detail', { id, origin: 'Inbox' }));
  },
  completeEdit(id: ItemId, origin: ListRoute) {
    if (!navigationRef.isReady()) return;
    const routes = navigationRef.getRootState()?.routes;
    if (!routes) return;
    const previous = routes[routes.length - 2];
    if (previous?.name === 'Detail' && (previous.params as RootStackParams['Detail'] | undefined)?.id === id) {
      navigationRef.dispatch(StackActions.pop(1));
    } else {
      navigationRef.dispatch(StackActions.replace('Detail', { id, origin }));
    }
  },
  returnToList(origin: ListRoute) {
    if (!popToExisting(origin)) resetInbox();
  },
  openEditor(params: RootStackParams['Editor']) {
    if (navigationRef.isReady()) navigationRef.dispatch(StackActions.push('Editor', params));
  },
  openArchive() {
    if (navigationRef.isReady()) navigationRef.navigate('Archive');
  },
  goBackOrInbox() {
    if (!navigationRef.isReady()) return;
    if (navigationRef.canGoBack()) navigationRef.goBack();
    else resetInbox();
  },
};
