import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { initPersistence } from '../services/storage';
import { colors } from './theme';
import type { RootStackParamList } from './navigation';
import { CaptureScreen } from './screens/CaptureScreen';
import { ConnectScreen } from './screens/ConnectScreen';
import { ExportScreen } from './screens/ExportScreen';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { SettingsScreen } from './screens/SettingsScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    primary: colors.primary,
  },
};

export function Root() {
  useEffect(() => {
    initPersistence();
    disableTileCache();
  }, []);

  return (
    <NavigationContainer theme={theme}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <Stack.Navigator
        initialRouteName="Projects"
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
        }}>
        <Stack.Screen name="Projects" component={ProjectsScreen} options={{ title: 'Roof MRI — GPS Scanning' }} />
        <Stack.Screen name="Capture" component={CaptureScreen} options={{ title: 'Capture', headerTransparent: true, headerTintColor: '#fff' }} />
        <Stack.Screen name="Connect" component={ConnectScreen} options={{ title: 'Receiver & corrections' }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
        <Stack.Screen name="Export" component={ExportScreen} options={{ title: 'Export' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

/**
 * Google Map Tiles API policy: no offline tile storage. MapLibre keeps a
 * persistent "ambient cache" by default — shrink it to zero so tiles are only
 * ever held per HTTP Cache-Control semantics in memory during the session.
 */
async function disableTileCache(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const maplibre: Record<string, any> = require('@maplibre/maplibre-react-native');
    const offlineManager = maplibre.OfflineManager ?? maplibre.offlineManager;
    await offlineManager?.setMaximumAmbientCacheSize?.(0);
  } catch {
    // Older/newer lib versions without the API — documented in README.
  }
}
