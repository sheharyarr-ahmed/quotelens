import { StyleSheet, Text, View } from 'react-native';

// Magic-link auth via Supabase lands here next milestone.
export default function LoginScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>QuoteLens</Text>
      <Text>Sign in with a magic link.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 24, fontWeight: '600' },
});
