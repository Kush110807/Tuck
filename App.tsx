import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppNavigator } from './src/navigation/AppNavigator';

/** Phase 1A launch shell. Production repository wiring arrives during integration. */
export default function App() {
  return <SafeAreaProvider><StatusBar style="dark" /><AppNavigator /></SafeAreaProvider>;
}
