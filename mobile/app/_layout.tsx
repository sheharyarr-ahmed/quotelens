import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)/login" options={{ title: 'Sign in' }} />
      <Stack.Screen name="capture/[jobId]" options={{ title: 'Capture' }} />
      <Stack.Screen name="quote/[quoteId]/index" options={{ title: 'Quote' }} />
      <Stack.Screen name="quote/[quoteId]/trace" options={{ title: 'Agent trace' }} />
    </Stack>
  );
}
