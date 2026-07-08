// The animated live-assembly list (SPEC.md v1.3 - Mobile UI/UX - Live
// assembly motion). Two-beat entry choreography for live rows (FadeInDown
// + spring scale settle, then the photo thumbnail's delayed scale-in inside
// the row), LinearTransition for list shifting, and an identity-preserving
// retraction: fresh rows, the revising banner, and retracted rows are all
// keyed siblings in ONE child array, so on retry_started the previous
// attempt's rows animate down under the banner and dim in place instead of
// remounting. History rows fold with live=false and render with no entry
// animation. Animation is driven by real pipeline events only.

import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  withSpring,
  withTiming,
  type LayoutAnimation,
} from 'react-native-reanimated';

import { QuoteLineItemRow } from '@/components/QuoteLineItemRow';
import { RollingTotal } from '@/components/RollingTotal';
import type { QuoteLineItem } from '@/lib/quote-schema';
import { colors, radii, spacing, type as typography } from '@/lib/theme';

export interface AssemblyRow {
  key: string;
  item: QuoteLineItem;
  live: boolean;
  /** Present once the row is backed by a real quote_line_items row. */
  dbId?: string;
}

interface LiveAssemblyListProps {
  rows: AssemblyRow[];
  retracted: AssemblyRow[];
  attempt: number;
  revising: boolean;
  photoUrls: ReadonlyMap<string, string>;
  /** Drafted-row index -> validation message (failed state). */
  rowErrors: ReadonlyMap<number, string>;
  editable: boolean;
  highlightedIds: readonly string[];
  onPressRow?: (dbId: string) => void;
  onDeleteRow?: (dbId: string) => void;
}

// First beat: the row fades in from below with a slight spring scale settle.
const rowEntering = (): LayoutAnimation => {
  'worklet';
  return {
    initialValues: {
      opacity: 0,
      transform: [{ translateY: 20 }, { scale: 0.95 }],
    },
    animations: {
      opacity: withTiming(1, { duration: 240 }),
      transform: [
        { translateY: withSpring(0, { damping: 18, stiffness: 210 }) },
        { scale: withSpring(1, { damping: 15, stiffness: 190 }) },
      ],
    },
  };
};

const listShift = LinearTransition.springify().damping(20).stiffness(220);

export function LiveAssemblyList({
  rows,
  retracted,
  attempt,
  revising,
  photoUrls,
  rowErrors,
  editable,
  highlightedIds,
  onPressRow,
  onDeleteRow,
}: LiveAssemblyListProps) {
  const retractedSum = retracted.reduce(
    (sum, row) => sum + (row.item.total_cents ?? 0),
    0,
  );

  const children: ReactNode[] = rows.map((row, index) => {
    const dbId = row.dbId;
    return (
      <Animated.View
        key={row.key}
        entering={row.live ? rowEntering : undefined}
        exiting={FadeOut.duration(220)}
        layout={listShift}
        style={styles.rowWrap}
      >
        <QuoteLineItemRow
          item={row.item}
          photoUrls={photoUrls}
          live={row.live}
          errorText={rowErrors.get(index)}
          editable={editable && dbId !== undefined}
          highlighted={dbId !== undefined && highlightedIds.includes(dbId)}
          onPress={
            dbId !== undefined && onPressRow
              ? () => onPressRow(dbId)
              : undefined
          }
          onDelete={
            dbId !== undefined && onDeleteRow
              ? () => onDeleteRow(dbId)
              : undefined
          }
        />
      </Animated.View>
    );
  });

  if (revising && retracted.length > 0) {
    children.push(
      <Animated.View
        key="revising-banner"
        entering={FadeIn.duration(220)}
        exiting={FadeOut.duration(220)}
        layout={listShift}
        style={styles.revisingBanner}
      >
        <View style={styles.revisingLeft}>
          <Ionicons name="refresh" size={16} color={colors.warning} />
          <Text style={styles.revisingLabel}>
            Revising draft — attempt {attempt}
          </Text>
        </View>
        <RollingTotal cents={retractedSum} struck style={styles.revisingTotal} />
      </Animated.View>,
    );
  }

  // The dimmed group animates out (FadeOut) when generation_completed
  // clears `retracted`.
  for (const row of retracted) {
    children.push(
      <Animated.View
        key={row.key}
        exiting={FadeOut.duration(260)}
        layout={listShift}
        style={styles.rowWrap}
      >
        <QuoteLineItemRow item={row.item} photoUrls={photoUrls} dimmed />
      </Animated.View>,
    );
  }

  return <View style={styles.list}>{children}</View>;
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  revisingBanner: {
    alignItems: 'center',
    backgroundColor: colors.warningLight,
    borderRadius: radii.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  revisingLabel: { ...typography.captionBold, color: colors.warning },
  revisingLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  revisingTotal: { ...typography.captionBold },
  rowWrap: { width: '100%' },
});
