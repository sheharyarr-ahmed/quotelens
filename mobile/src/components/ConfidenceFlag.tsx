import { StyleSheet, Text, View } from 'react-native';

import type { Confidence } from '@/lib/quote-schema';

// The model declaring uncertainty is a feature: inferred lines render with
// a visible flag (SPEC.md - Quote schema and integrity).
export function ConfidenceFlag({ confidence }: { confidence: Confidence }) {
  if (confidence !== 'inferred') {
    return null;
  }
  return (
    <View style={styles.badge}>
      <Text style={styles.label}>inferred</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: '#FEF3C7',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  label: { color: '#92400E', fontSize: 12, fontWeight: '600' },
});
