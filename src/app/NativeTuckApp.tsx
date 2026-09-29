import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createBootController, createExpoImagePickerAdapter, createReactNativeLinkOpener } from '../controllers';
import { createTuckDataLayer } from '../data';
import { AppNavigator, type ProductionServices } from '../navigation/AppNavigator';
import { createMutationMailbox } from '../navigation/MutationMailbox';
import { useControllerProps } from '../navigation/useControllerProps';
import { BootGate } from '../ui/components/BootGate';

/** Competition entry: the mature local SQLite product opens immediately, with no auth/cloud dependency. */
function CompetitionWorkspace() {
  const dataLayer = useMemo(() => createTuckDataLayer(), []);
  const mailbox = useMemo(() => createMutationMailbox(), []);
  const imagePicker = useMemo(() => createExpoImagePickerAdapter(), []);
  const linkOpener = useMemo(() => createReactNativeLinkOpener(), []);
  const bootController = useMemo(() => createBootController(dataLayer.repository), [dataLayer.repository]);
  const bootProps = useControllerProps(bootController);
  const services = useMemo<ProductionServices>(() => ({
    repository: dataLayer.repository,
    imageStore: dataLayer.imageStore,
    imagePicker,
    linkOpener,
    mailbox,
  }), [dataLayer, imagePicker, linkOpener, mailbox]);

  useEffect(() => { void bootController.start(); }, [bootController]);

  return <View style={{ flex: 1 }}>{bootProps.state.kind === 'ready' ? <AppNavigator services={services} /> : <BootGate {...bootProps} />}</View>;
}

export function NativeTuckApp() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <CompetitionWorkspace />
    </SafeAreaProvider>
  );
}
