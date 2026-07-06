import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

// Agent trace viewer: every pipeline node with input, output, duration,
// and token count (SPEC.md - Goal 8).
export default function TraceScreen() {
  const { quoteId } = useLocalSearchParams<{ quoteId: string }>();
  return (
    <View style={styles.container}>
      <Text>Agent trace for quote {quoteId}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
