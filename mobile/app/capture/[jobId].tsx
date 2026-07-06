import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

// Camera + audio capture session; media uploads go direct to Supabase
// Storage under RLS-scoped paths (SPEC.md - Data flow, auth, and access).
export default function CaptureScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  return (
    <View style={styles.container}>
      <Text>Capture session for job {jobId}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
