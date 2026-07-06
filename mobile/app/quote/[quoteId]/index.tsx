import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

// Review/edit screen: Realtime-subscribed live assembly renderer
// (LiveAssemblyList) arrives next milestone.
export default function QuoteReviewScreen() {
  const { quoteId } = useLocalSearchParams<{ quoteId: string }>();
  return (
    <View style={styles.container}>
      <Text>Quote {quoteId}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
