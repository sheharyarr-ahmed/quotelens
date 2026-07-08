// Rolling-number running total (SPEC.md v1.3 - Mobile UI/UX - Live assembly
// motion): a shared value eases to each new sum and the displayed cents
// follow it frame by frame via useAnimatedReaction -> runOnJS.

import { useEffect, useState } from 'react';
import { StyleSheet, Text, type TextStyle } from 'react-native';
import {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { colors, type as typography } from '@/lib/theme';

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const remainder = (abs % 100).toString().padStart(2, '0');
  return `${sign}$${dollars}.${remainder}`;
}

interface RollingTotalProps {
  cents: number;
  /** Dimmed struck variant for the retracted section header. */
  struck?: boolean;
  style?: TextStyle;
}

export function RollingTotal({ cents, struck = false, style }: RollingTotalProps) {
  const progress = useSharedValue(cents);
  const [displayCents, setDisplayCents] = useState(cents);

  useEffect(() => {
    progress.value = withTiming(cents, {
      duration: 550,
      easing: Easing.out(Easing.cubic),
    });
  }, [cents, progress]);

  useAnimatedReaction(
    () => Math.round(progress.value),
    (current, previous) => {
      if (previous === null || current !== previous) {
        runOnJS(setDisplayCents)(current);
      }
    },
  );

  return (
    <Text style={[styles.total, struck && styles.struck, style]}>
      {formatCents(displayCents)}
    </Text>
  );
}

const styles = StyleSheet.create({
  struck: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  total: { ...typography.heading, color: colors.textPrimary },
});
