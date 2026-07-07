import { StyleSheet, Text, View } from 'react-native';

// Quotes list; populated from Supabase next milestone.
export default function QuotesListScreen() {
  return (
    <View style={styles.container}>
      <Text>No quotes yet. Create a job and capture a walkthrough.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
