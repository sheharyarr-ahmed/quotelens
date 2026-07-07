import { StyleSheet, Text, View } from 'react-native';

// New-job modal: job name + trade/price-book picker, lands in capture
// (SPEC.md - Mobile UI/UX - Navigation and structure).
export default function NewJobScreen() {
  return (
    <View style={styles.container}>
      <Text>New job</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
