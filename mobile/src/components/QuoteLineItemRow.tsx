// One quote line: description, quantity/unit/price caption, right-aligned
// total (or Unpriced chip), confidence flag, photo citation thumbnails,
// failed-validation edge, remote-edit highlight flash, and swipe-to-delete
// when editable (SPEC.md v1.3 - Mobile UI/UX - Review screen).

import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ConfidenceFlag } from '@/components/ConfidenceFlag';
import { PhotoCitation } from '@/components/PhotoCitation';
import { formatCents } from '@/components/RollingTotal';
import type { QuoteLineItem, Unit } from '@/lib/quote-schema';
import { colors, radii, spacing, type as typography } from '@/lib/theme';

const UNIT_LABELS: Record<Unit, string> = {
  sqft: 'sq ft',
  linear_ft: 'lin ft',
  each: 'each',
  flat: 'flat',
};

const HIGHLIGHT_FADE_MS = 1200;

interface QuoteLineItemRowProps {
  item: QuoteLineItem;
  photoUrls: ReadonlyMap<string, string>;
  /** Row arrived on the live channel: play the thumbnail second beat. */
  live?: boolean;
  /** Retracted styling: ~60% opacity with a struck dimmed total. */
  dimmed?: boolean;
  /** Validation message when this row is named in generation_failed. */
  errorText?: string;
  editable?: boolean;
  /** Remote edit just landed: flash a primaryLight wash over ~1.2s. */
  highlighted?: boolean;
  onPress?: () => void;
  onDelete?: () => void;
}

function formatQuantity(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2);
}

export function QuoteLineItemRow({
  item,
  photoUrls,
  live = false,
  dimmed = false,
  errorText,
  editable = false,
  highlighted = false,
  onPress,
  onDelete,
}: QuoteLineItemRowProps) {
  const highlightProgress = useSharedValue(0);

  useEffect(() => {
    if (highlighted) {
      highlightProgress.value = 1;
      highlightProgress.value = withTiming(0, { duration: HIGHLIGHT_FADE_MS });
    }
  }, [highlighted, highlightProgress]);

  const highlightStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      highlightProgress.value,
      [0, 1],
      [colors.background, colors.primaryLight],
    ),
  }));

  const unitLabel = UNIT_LABELS[item.unit];
  const priced = item.unit_price_cents !== null;
  const detail = priced
    ? `${formatQuantity(item.quantity)} ${unitLabel} × ${formatCents(item.unit_price_cents ?? 0)}`
    : `${formatQuantity(item.quantity)} ${unitLabel}`;

  const card = (
    <Animated.View
      style={[
        styles.card,
        highlightStyle,
        errorText != null && styles.cardError,
        dimmed && styles.cardDimmed,
      ]}
    >
      <Pressable
        onPress={editable ? onPress : undefined}
        disabled={!editable || !onPress}
        style={styles.press}
        accessibilityRole={editable ? 'button' : undefined}
        accessibilityLabel={
          editable ? `Edit line item: ${item.description}` : undefined
        }
      >
        <View style={styles.main}>
          <View style={styles.left}>
            <Text style={[styles.description, dimmed && styles.textDimmed]}>
              {item.description}
            </Text>
            <Text style={styles.detail}>{detail}</Text>
            <View style={styles.metaRow}>
              <PhotoCitation
                citations={item.photo_citations}
                photoUrls={photoUrls}
                animateIn={live}
              />
              <ConfidenceFlag confidence={item.confidence} />
            </View>
          </View>
          <View style={styles.right}>
            {priced && item.total_cents !== null ? (
              <Text
                style={[
                  styles.total,
                  dimmed && styles.totalDimmed,
                ]}
              >
                {formatCents(item.total_cents)}
              </Text>
            ) : (
              <View style={styles.unpricedChip}>
                <Ionicons
                  name="alert-circle-outline"
                  size={14}
                  color={colors.warning}
                />
                <Text style={styles.unpricedLabel}>Unpriced</Text>
              </View>
            )}
          </View>
        </View>
        {errorText != null && (
          <Text style={styles.errorText}>{errorText}</Text>
        )}
      </Pressable>
    </Animated.View>
  );

  if (!editable || !onDelete) {
    return card;
  }

  return (
    <ReanimatedSwipeable
      enabled={editable}
      friction={1.6}
      rightThreshold={56}
      overshootRight={false}
      renderRightActions={() => (
        <View style={styles.deleteUnderlay}>
          <Ionicons name="trash-outline" size={22} color={colors.textOnPrimary} />
          <Text style={styles.deleteLabel}>Delete</Text>
        </View>
      )}
      onSwipeableOpen={onDelete}
      containerStyle={styles.swipeContainer}
    >
      {card}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardDimmed: { opacity: 0.6 },
  cardError: {
    borderLeftColor: colors.danger,
    borderLeftWidth: 3,
  },
  deleteLabel: { ...typography.captionBold, color: colors.textOnPrimary },
  deleteUnderlay: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'flex-end',
    marginLeft: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  description: { ...typography.bodyBold, color: colors.textPrimary },
  detail: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  errorText: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.sm,
  },
  left: { flex: 1, paddingRight: spacing.md },
  main: { flexDirection: 'row' },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  press: { padding: spacing.md },
  right: { alignItems: 'flex-end', justifyContent: 'flex-start' },
  swipeContainer: { overflow: 'visible' },
  textDimmed: { color: colors.textSecondary },
  total: { ...typography.bodyBold, color: colors.textPrimary },
  totalDimmed: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  unpricedChip: {
    alignItems: 'center',
    backgroundColor: colors.warningLight,
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  unpricedLabel: { ...typography.captionBold, color: colors.warning },
});
