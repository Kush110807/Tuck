import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParams } from '../contracts';
import { colors } from '../theme/tokens';
import { PlaceholderScreen } from './PlaceholderScreen';
import { navigationRef } from './navigationActions';

const Stack = createNativeStackNavigator<RootStackParams>();

function Inbox({ navigation }: NativeStackScreenProps<RootStackParams, 'Inbox'>) {
  return <PlaceholderScreen title="Inbox" subtitle="Save notes, links, and images for later."
    actions={[
      { label: 'Preview create route', onPress: () => navigation.navigate('Editor', { mode: 'create', type: 'note', origin: 'Inbox' }) },
      { label: 'Preview detail route', onPress: () => navigation.navigate('Detail', { id: 'scaffold-route-only', origin: 'Inbox' }) },
      { label: 'Open Archive route', onPress: () => navigation.navigate('Archive') },
    ]} />;
}
function Archive({ navigation }: NativeStackScreenProps<RootStackParams, 'Archive'>) {
  return <PlaceholderScreen title="Archive" subtitle="Archived items will appear here."
    actions={[{ label: 'Preview archived Detail route',
      onPress: () => navigation.navigate('Detail', { id: 'scaffold-route-only', origin: 'Archive' }) }]} />;
}
function Editor({ route }: NativeStackScreenProps<RootStackParams, 'Editor'>) {
  return <PlaceholderScreen title="Editor" subtitle={route.params.mode === 'create'
    ? `Create a ${route.params.type}.` : `Edit item ${route.params.id}.`} actions={[]} />;
}
function Detail({ route }: NativeStackScreenProps<RootStackParams, 'Detail'>) {
  return <PlaceholderScreen title="Detail" subtitle={`Route preview only · from ${route.params.origin}.`}
    actions={[]} />;
}

export function AppNavigator() {
  return <NavigationContainer ref={navigationRef}>
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.background },
      headerTintColor: colors.text, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="Inbox" component={Inbox} />
      <Stack.Screen name="Editor" component={Editor} />
      <Stack.Screen name="Detail" component={Detail} />
      <Stack.Screen name="Archive" component={Archive} />
    </Stack.Navigator>
  </NavigationContainer>;
}
