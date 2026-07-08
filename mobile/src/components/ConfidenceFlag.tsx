import { StyleSheet, Text, View } from 'react-native';

import type { Confidence } from '@/lib/quote-schema';
import { colors, radii, spacing, type as typography } from '@/lib/theme';

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
    alignSelf: 'flex-start',
    backgroundColor: colors.warningLight,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  label: { ...typography.captionBold, color: colors.warning },
});
