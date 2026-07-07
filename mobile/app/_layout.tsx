import { Stack } from 'expo-router';

// Jobs-first single stack, no tab bar (SPEC.md - Mobile UI/UX).
export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Jobs' }} />
      <Stack.Screen name="(auth)/login" options={{ title: 'Sign in', headerShown: false }} />
      <Stack.Screen name="job/new" options={{ title: 'New job', presentation: 'modal' }} />
      <Stack.Screen name="capture/[jobId]" options={{ title: 'Capture', headerShown: false }} />
      <Stack.Screen name="quote/[quoteId]/index" options={{ title: 'Quote' }} />
      <Stack.Screen name="quote/[quoteId]/trace" options={{ title: 'Agent trace' }} />
    </Stack>
  );
}
