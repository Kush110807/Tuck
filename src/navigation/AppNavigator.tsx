import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { BackHandler } from 'react-native';
import { NavigationContainer, useFocusEffect } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import type {
  ImagePickerAdapter,
  ImageStore,
  ItemRepository,
  LinkOpener,
  MutationMailbox,
  RootStackParams,
} from '../contracts';
import {
  createArchiveController,
  createDetailController,
  createEditorController,
  createInboxController,
} from '../controllers';
import { ArchiveScreen, DetailScreen, EditorScreen, InboxScreen } from '../ui/screens';
import { colors } from '../theme/tokens';
import { navigationActions, navigationRef } from './navigationActions';
import { useControllerProps } from './useControllerProps';

export type ProductionServices = Readonly<{
  repository: ItemRepository;
  imageStore: ImageStore;
  imagePicker: ImagePickerAdapter;
  linkOpener: LinkOpener;
  mailbox: MutationMailbox;
}>;

const ServicesContext = createContext<ProductionServices | null>(null);
const SyncRevisionContext = createContext(0);
const Stack = createNativeStackNavigator<RootStackParams>();

function useServices(): ProductionServices {
  const value = useContext(ServicesContext);
  if (!value) throw new Error('Tuck production services are not available.');
  return value;
}

function ScreenFrame({ children }: { children: ReactNode }) {
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>{children}</SafeAreaView>;
}

function useControllerFocus(onFocus: () => Promise<void>): void {
  useFocusEffect(useCallback(() => {
    void onFocus();
  }, [onFocus]));
}

function useHardwareBack(handler: () => void): void {
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handler();
      return true;
    });
    return () => subscription.remove();
  }, [handler]));
}

function InboxRoute() {
  const services = useServices();
  const syncRevision = useContext(SyncRevisionContext);
  const controller = useMemo(() => createInboxController(
    services.repository,
    services.imageStore,
    services.mailbox,
    navigationActions,
  ), [services]);
  const props = useControllerProps(controller);
  const focus = useCallback(() => controller.onFocus(), [controller]);
  useControllerFocus(focus);
  useEffect(() => { if (syncRevision > 0) void controller.refresh(); }, [controller, syncRevision]);

  return <ScreenFrame><InboxScreen {...props} /></ScreenFrame>;
}

function ArchiveRoute() {
  const services = useServices();
  const syncRevision = useContext(SyncRevisionContext);
  const controller = useMemo(() => createArchiveController(
    services.repository,
    services.imageStore,
    services.mailbox,
    navigationActions,
  ), [services]);
  const props = useControllerProps(controller);
  const focus = useCallback(() => controller.onFocus(), [controller]);
  const back = useCallback(() => controller.props.onBack(), [controller]);
  useControllerFocus(focus);
  useEffect(() => { if (syncRevision > 0) void controller.refresh(); }, [controller, syncRevision]);
  useHardwareBack(back);

  return <ScreenFrame><ArchiveScreen {...props} /></ScreenFrame>;
}

function EditorRoute({ route }: NativeStackScreenProps<RootStackParams, 'Editor'>) {
  const services = useServices();
  const paramsKey = route.params.mode === 'create'
    ? `create:${route.params.type}:${route.params.origin}`
    : `edit:${route.params.id}:${route.params.origin}`;
  const controller = useMemo(() => createEditorController(
    route.params,
    services.repository,
    services.imageStore,
    services.imagePicker,
    services.mailbox,
    navigationActions,
  // paramsKey deliberately represents the complete discriminated route identity.
  ), [services, paramsKey]);
  const props = useControllerProps(controller);
  const back = useCallback(() => controller.requestExit(), [controller]);
  useHardwareBack(back);

  useEffect(() => {
    if (route.params.mode === 'edit') void controller.load();
  }, [controller, route.params.mode]);

  return <ScreenFrame><EditorScreen {...props} /></ScreenFrame>;
}

function DetailRoute({ route }: NativeStackScreenProps<RootStackParams, 'Detail'>) {
  const services = useServices();
  const syncRevision = useContext(SyncRevisionContext);
  const controller = useMemo(() => createDetailController(
    route.params.id,
    route.params.origin,
    services.repository,
    services.imageStore,
    services.linkOpener,
    services.mailbox,
    navigationActions,
  ), [route.params.id, route.params.origin, services]);
  const props = useControllerProps(controller);
  const focus = useCallback(() => controller.onFocus(), [controller]);
  const back = useCallback(() => controller.props.onBack(), [controller]);
  useControllerFocus(focus);
  useEffect(() => { if (syncRevision > 0) void controller.refresh(); }, [controller, syncRevision]);
  useHardwareBack(back);

  return <ScreenFrame><DetailScreen {...props} /></ScreenFrame>;
}

export function AppNavigator({ services, dataRevision = 0 }: { services: ProductionServices; dataRevision?: number }) {
  return (
    <ServicesContext.Provider value={services}>
      <SyncRevisionContext.Provider value={dataRevision}>
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator
          initialRouteName="Inbox"
          screenOptions={{
            headerShown: false,
            gestureEnabled: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="Inbox" component={InboxRoute} />
          <Stack.Screen name="Editor" component={EditorRoute} />
          <Stack.Screen name="Detail" component={DetailRoute} />
          <Stack.Screen name="Archive" component={ArchiveRoute} />
        </Stack.Navigator>
      </NavigationContainer>
      </SyncRevisionContext.Provider>
    </ServicesContext.Provider>
  );
}
