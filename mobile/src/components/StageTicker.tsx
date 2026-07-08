// Pipeline stage ticker for the pre-first-item wait (SPEC.md v1.3 - Mobile
// UI/UX - Waiting state). Driven exclusively by real agent_traces inserts:
// each node's trace row ticks its checklist entry. Once items stream the
// parent renders the compact single-line variant.

import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';

import { colors, radii, spacing, type as typography } from '@/lib/theme';

// Friendly labels in pipeline run order; transcribe and analyze_photos run
// in parallel so either may tick first.
const STAGES: readonly { node: string; label: string }[] = [
  { node: 'transcribe', label: 'Transcribing audio' },
  { node: 'analyze_photos', label: 'Analyzing photos' },
  { node: 'parse_walkthrough', label: 'Parsing walkthrough' },
  { node: 'match_pricebook', label: 'Matching price book' },
  { node: 'draft_line_items', label: 'Drafting line items' },
  { node: 'validate', label: 'Validating' },
  { node: 'compile_quote', label: 'Finalizing' },
];

interface StageTickerProps {
  stagesDone: string[];
  /** Single-line variant shown once line items start streaming. */
  compact?: boolean;
}

export function StageTicker({ stagesDone, compact = false }: StageTickerProps) {
  const done = new Set(stagesDone);
  const currentIndex = STAGES.findIndex((stage) => !done.has(stage.node));

  if (compact) {
    const label =
      currentIndex === -1 ? 'Finalizing' : STAGES[currentIndex].label;
    return (
      <Animated.View
        entering={FadeIn.duration(200)}
        layout={LinearTransition.springify().damping(20).stiffness(220)}
        style={styles.compact}
      >
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={styles.compactLabel}>{label}…</Text>
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={FadeIn.duration(200)} style={styles.card}>
      <Text style={styles.heading}>Building your quote</Text>
      {STAGES.map((stage, index) => {
        const isDone = done.has(stage.node);
        const isCurrent = !isDone && index === currentIndex;
        return (
          <View key={stage.node} style={styles.row}>
            <View style={styles.iconSlot}>
              {isDone ? (
                <Ionicons
                  name="checkmark-circle"
                  size={20}
                  color={colors.primary}
                />
              ) : isCurrent ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons
                  name="ellipse-outline"
                  size={18}
                  color={colors.textMuted}
                />
              )}
            </View>
            <Text
              style={[
                styles.label,
                isDone && styles.labelDone,
                !isDone && !isCurrent && styles.labelPending,
              ]}
            >
              {stage.label}
            </Text>
          </View>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
  compact: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  compactLabel: { ...typography.caption, color: colors.textSecondary },
  heading: {
    ...typography.captionBold,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  iconSlot: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  label: { ...typography.body, color: colors.textPrimary },
  labelDone: { color: colors.textSecondary },
  labelPending: { color: colors.textMuted },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
});
