import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useSession } from '@/hooks/useSession';
import { colors, type as typography } from '@/lib/theme';

// Jobs-first single stack, no tab bar (SPEC.md v1.3 - Mobile UI/UX).
// Stack.Protected owns the auth gate: signed out, only the login screen
// mounts; signed in, login is unreachable and the router lands on index.
export default function RootLayout() {
  const { session, loading } = useSession();

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="dark" />
      {loading ? (
        <View style={styles.splash}>
          <Text style={styles.brand}>QuoteLens</Text>
        </View>
      ) : (
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.primary,
            headerTitleStyle: { color: colors.textPrimary },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Protected guard={session !== null}>
            <Stack.Screen name="index" options={{ title: 'Jobs' }} />
            <Stack.Screen
              name="job/new"
              options={{ title: 'New job', presentation: 'modal' }}
            />
            <Stack.Screen name="capture/[jobId]" options={{ headerShown: false }} />
            <Stack.Screen name="quote/[quoteId]/index" options={{ title: 'Quote' }} />
            <Stack.Screen name="quote/[quoteId]/trace" options={{ title: 'Agent trace' }} />
          </Stack.Protected>
          <Stack.Protected guard={session === null}>
            <Stack.Screen name="(auth)/login" options={{ headerShown: false }} />
          </Stack.Protected>
        </Stack>
      )}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  brand: { ...typography.title, color: colors.primary },
  root: { flex: 1 },
  splash: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
  },
});
