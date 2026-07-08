// In-repo bottom sheet for editing a line item (SPEC.md v1.3 - Mobile UI/UX
// - Editing): absolute-fill pressable backdrop that fades, bottom card that
// springs up via Reanimated entering/exiting, KeyboardAvoidingView, and
// fields for description, quantity, unit (segmented chips), and unit price
// in dollars (stored as cents). No @gorhom/bottom-sheet.

import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';

import type { Unit } from '@/lib/quote-schema';
import { colors, radii, spacing, type as typography } from '@/lib/theme';

const UNIT_OPTIONS: readonly { value: Unit; label: string }[] = [
  { value: 'sqft', label: 'sq ft' },
  { value: 'linear_ft', label: 'lin ft' },
  { value: 'each', label: 'each' },
  { value: 'flat', label: 'flat' },
];

export interface LineItemEditorValues {
  description: string;
  quantity: number;
  unit: Unit;
  unit_price_cents: number | null;
}

interface LineItemEditorSheetProps {
  initial: LineItemEditorValues;
  onSave: (values: LineItemEditorValues) => Promise<void>;
  onClose: () => void;
}

function parseQuantity(text: string): number | null {
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** '' -> null (unpriced); otherwise dollars -> integer cents or 'invalid'. */
function parsePriceCents(text: string): number | null | 'invalid' {
  const trimmed = text.trim().replace(/^\$/, '');
  if (trimmed === '') {
    return null;
  }
  const value = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(value) || value < 0) {
    return 'invalid';
  }
  return Math.round(value * 100);
}

export function LineItemEditorSheet({
  initial,
  onSave,
  onClose,
}: LineItemEditorSheetProps) {
  const [description, setDescription] = useState(initial.description);
  const [quantityText, setQuantityText] = useState(
    Number.isInteger(initial.quantity)
      ? String(initial.quantity)
      : initial.quantity.toFixed(2),
  );
  const [unit, setUnit] = useState<Unit>(initial.unit);
  const [priceText, setPriceText] = useState(
    initial.unit_price_cents === null
      ? ''
      : (initial.unit_price_cents / 100).toFixed(2),
  );
  const [saving, setSaving] = useState(false);

  const quantity = parseQuantity(quantityText);
  const priceCents = parsePriceCents(priceText);
  const valid =
    description.trim().length > 0 && quantity !== null && priceCents !== 'invalid';
  const unpriced = priceCents === null;

  const handleSave = async () => {
    // `valid` already proves quantity !== null and priceCents !== 'invalid';
    // TS narrows both through the aliased condition, so re-checking them here
    // would be a compile error (comparison with no overlap).
    if (!valid || saving) {
      return;
    }
    setSaving(true);
    try {
      await onSave({
        description: description.trim(),
        quantity,
        unit,
        unit_price_cents: priceCents,
      });
      onClose();
    } catch (error) {
      Alert.alert(
        'Save failed',
        error instanceof Error ? error.message : String(error),
      );
      setSaving(false);
    }
  };

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Animated.View
        style={StyleSheet.absoluteFill}
        entering={FadeIn.duration(180)}
        exiting={FadeOut.duration(160)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={saving ? undefined : onClose}
          accessibilityRole="button"
          accessibilityLabel="Close editor"
        />
      </Animated.View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.avoider}
        pointerEvents="box-none"
      >
        <Animated.View
          entering={SlideInDown.springify().damping(26).stiffness(240)}
          exiting={SlideOutDown.duration(200)}
          style={styles.card}
        >
          <Text style={styles.title}>Edit line item</Text>

          <Text style={styles.label}>Description</Text>
          <TextInput
            style={styles.input}
            value={description}
            onChangeText={setDescription}
            placeholder="What is this line for?"
            placeholderTextColor={colors.textMuted}
          />

          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}>
              <Text style={styles.label}>Quantity</Text>
              <TextInput
                style={[styles.input, quantity === null && styles.inputError]}
                value={quantityText}
                onChangeText={setQuantityText}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={colors.textMuted}
              />
            </View>
            <View style={styles.fieldHalf}>
              <Text style={styles.label}>Unit price ($)</Text>
              <TextInput
                style={[
                  styles.input,
                  priceCents === 'invalid' && styles.inputError,
                ]}
                value={priceText}
                onChangeText={setPriceText}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.textMuted}
              />
            </View>
          </View>

          <Text style={styles.label}>Unit</Text>
          <View style={styles.segments}>
            {UNIT_OPTIONS.map((option) => {
              const selected = option.value === unit;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setUnit(option.value)}
                  style={[styles.segment, selected && styles.segmentSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text
                    style={[
                      styles.segmentLabel,
                      selected && styles.segmentLabelSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {unpriced && (
            <Text style={styles.unpricedHint}>Set a price before sending</Text>
          )}

          <View style={styles.actions}>
            <Pressable
              onPress={saving ? undefined : onClose}
              style={styles.cancelButton}
              accessibilityRole="button"
            >
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleSave}
              disabled={!valid || saving}
              style={[
                styles.saveButton,
                (!valid || saving) && styles.saveButtonDisabled,
              ]}
              accessibilityRole="button"
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.textOnPrimary} />
              ) : (
                <Text style={styles.saveLabel}>Save</Text>
              )}
            </Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  avoider: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    backgroundColor: colors.textPrimary,
    flex: 1,
    opacity: 0.35,
  },
  cancelButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  cancelLabel: { ...typography.bodyBold, color: colors.textSecondary },
  card: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  fieldHalf: { flex: 1 },
  fieldRow: { flexDirection: 'row', gap: spacing.md },
  input: {
    ...typography.body,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.textPrimary,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputError: { borderColor: colors.danger },
  label: {
    ...typography.captionBold,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  overlay: {
    // RN 0.86 types no longer export absoluteFillObject; inline the fill.
    bottom: 0,
    justifyContent: 'flex-end',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  saveButtonDisabled: { opacity: 0.5 },
  saveLabel: { ...typography.bodyBold, color: colors.textOnPrimary },
  segment: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    flex: 1,
    paddingVertical: spacing.sm,
  },
  segmentLabel: { ...typography.captionBold, color: colors.textSecondary },
  segmentLabelSelected: { color: colors.textOnPrimary },
  segmentSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  segments: { flexDirection: 'row', gap: spacing.sm },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  unpricedHint: {
    ...typography.caption,
    color: colors.warning,
    marginTop: spacing.sm,
  },
});
