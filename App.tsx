import { useEffect, useMemo } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createBootController, createExpoImagePickerAdapter, createReactNativeLinkOpener } from './src/controllers';
import { createTuckDataLayer } from './src/data';
import { AppNavigator, type ProductionServices } from './src/navigation/AppNavigator';
import { createMutationMailbox } from './src/navigation/MutationMailbox';
import { useControllerProps } from './src/navigation/useControllerProps';
import { BootGate } from './src/ui/components/BootGate';

export default function App() {
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

  useEffect(() => {
    void bootController.start();
  }, [bootController]);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {bootProps.state.kind === 'ready'
        ? <AppNavigator services={services} />
        : <BootGate {...bootProps} />}
    </SafeAreaProvider>
  );
}
