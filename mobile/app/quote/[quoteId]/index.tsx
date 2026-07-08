// Review screen (SPEC.md v1.3 - Mobile UI/UX - Review screen / Live
// assembly): folds realtime quote_events + agent_traces through the pure
// assembly reducer for the generating phases, then hands the settled quote
// over to DB-backed rows (useLineItemSync) for editing, deleting, sending
// and accepting. Animation is driven by real pipeline events only: rows
// arriving live animate, history recovery renders instantly.

import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { regenerateQuote } from '@/api/client';
import {
  LineItemEditorSheet,
  type LineItemEditorValues,
} from '@/components/LineItemEditorSheet';
import { LiveAssemblyList, type AssemblyRow } from '@/components/LiveAssemblyList';
import { RollingTotal } from '@/components/RollingTotal';
import { StageTicker } from '@/components/StageTicker';
import {
  extractRowErrors,
  type AssemblyAction,
} from '@/hooks/quoteAssemblyReducer';
import { useLineItemSync, type LineItemRow } from '@/hooks/useLineItemSync';
import { useQuoteAssembly, type QuoteRowChange } from '@/hooks/useQuoteAssembly';
import { fetchPhotoThumbs } from '@/lib/photoThumbs';
import type { QuoteLineItem, QuoteStatus } from '@/lib/quote-schema';
import { supabase } from '@/lib/supabase';
import { colors, radii, spacing, type as typography } from '@/lib/theme';

const WEB_BASE = process.env.EXPO_PUBLIC_WEB_URL ?? 'http://localhost:3000';

interface QuoteRow {
  id: string;
  job_id: string;
  status: QuoteStatus;
  share_token: string;
  subtotal_cents: number | null;
}

function toQuoteLineItem(row: LineItemRow): QuoteLineItem {
  return {
    description: row.description,
    quantity: row.quantity,
    unit: row.unit,
    price_book_item_id: row.price_book_item_id,
    unit_price_cents: row.unit_price_cents,
    total_cents: row.total_cents,
    photo_citations: row.photo_citations,
    confidence: row.confidence,
  };
}

async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error('Your session has expired. Sign in again.');
  }
  return token;
}

export default function QuoteReviewScreen() {
  const { quoteId } = useLocalSearchParams<{ quoteId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [quote, setQuote] = useState<QuoteRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [photoUrls, setPhotoUrls] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const [editing, setEditing] = useState<LineItemRow | null>(null);
  const [sending, setSending] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const { rows, refresh, applyLocal, removeLocal, highlightedIds } =
    useLineItemSync(quoteId);

  // Stable render keys per DB row id: when generation_completed swaps the
  // event-drafted rows for their DB-backed counterparts, reusing the drafted
  // keys keeps the Animated.Views mounted so nothing re-animates or ghosts.
  const keyMapRef = useRef(new Map<string, string>());
  const dispatchRef = useRef<Dispatch<AssemblyAction> | null>(null);
  const phaseRef = useRef<string>('loading');

  const handleQuoteUpdate = useCallback((row: QuoteRowChange) => {
    const nextStatus =
      typeof row.status === 'string' ? (row.status as QuoteStatus) : undefined;
    // Another device regenerated this quote: back to the ticker. The local
    // Regenerate action already resets before this echo lands (guarded by
    // phase so the reset never wipes a fresh run's folded state).
    if (
      nextStatus === 'generating' &&
      phaseRef.current !== 'waiting' &&
      phaseRef.current !== 'loading'
    ) {
      keyMapRef.current.clear();
      dispatchRef.current?.({ type: 'reset-regenerate' });
    }
    setQuote((prev) =>
      prev
        ? {
            ...prev,
            status: nextStatus ?? prev.status,
            share_token:
              typeof row.share_token === 'string'
                ? row.share_token
                : prev.share_token,
            subtotal_cents:
              row.subtotal_cents === undefined
                ? prev.subtotal_cents
                : row.subtotal_cents,
          }
        : prev,
    );
  }, []);

  const { state, dispatch } = useQuoteAssembly(quoteId, handleQuoteUpdate);
  const phase = state.phase;

  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const fetchQuote = useCallback(async () => {
    if (!quoteId) {
      return;
    }
    const { data, error } = await supabase
      .from('quotes')
      .select('id, job_id, status, share_token, subtotal_cents')
      .eq('id', quoteId)
      .single();
    if (error) {
      setLoadError(error.message);
      return;
    }
    const row = data as QuoteRow;
    setQuote(row);
    if (
      row.status === 'completed' ||
      row.status === 'sent' ||
      row.status === 'accepted'
    ) {
      // Reopening a finished quote just shows the quote: no ticker, no
      // entry animation (SPEC.md v1.3 catch-up rule).
      dispatch({ type: 'hydrate-completed' });
    }
  }, [quoteId, dispatch]);

  useEffect(() => {
    void fetchQuote();
  }, [fetchQuote]);

  // Editing operates only on DB rows: hydrate them whenever the assembly
  // settles (generation_completed / generation_failed folds in, or a settled
  // quote was opened). Re-fetching the quote row covers a missed realtime
  // status UPDATE.
  useEffect(() => {
    if (phase !== 'completed' && phase !== 'failed') {
      return;
    }
    void refresh().catch(() => {
      // Realtime inserts and the retry below cover a transient failure.
    });
    void fetchQuote();
  }, [phase, refresh, fetchQuote]);

  const jobId = quote?.job_id;
  useEffect(() => {
    if (!jobId) {
      return;
    }
    let stale = false;
    void fetchPhotoThumbs(jobId).then((map) => {
      if (!stale && map.size > 0) {
        setPhotoUrls(map);
      }
    });
    return () => {
      stale = true;
    };
  }, [jobId]);

  const status = quote?.status ?? null;
  const accepted = state.accepted || status === 'accepted';
  const sent = status === 'sent' || accepted;
  // Completed quotes are DB-backed even when every row was deleted; failed
  // runs may have persisted nothing, in which case the event-drafted rows
  // stay on screen (read-only) so the per-row errors have something to mark.
  const dbBacked =
    rows !== null &&
    (phase === 'completed' || (phase === 'failed' && rows.length > 0));
  const editable =
    dbBacked && !sent && (status === 'completed' || status === 'failed');

  const displayRows: AssemblyRow[] = useMemo(() => {
    if (dbBacked && rows !== null) {
      const keyMap = keyMapRef.current;
      // Drafted event order equals compiled position order, so when the
      // counts line up each DB row inherits its drafted row's key.
      const reusable = rows.length === state.items.length;
      return rows.map((row, index) => {
        let key = keyMap.get(row.id);
        if (key === undefined) {
          key = reusable ? state.items[index].key : `db-${row.id}`;
          keyMap.set(row.id, key);
        }
        return { key, item: toQuoteLineItem(row), live: false, dbId: row.id };
      });
    }
    return state.items.map((item) => ({
      key: item.key,
      item: item.item,
      live: item.live,
    }));
  }, [dbBacked, rows, state.items]);

  const retractedRows: AssemblyRow[] = useMemo(
    () =>
      state.retracted.map((item) => ({
        key: item.key,
        item: item.item,
        live: item.live,
      })),
    [state.retracted],
  );

  const rowErrors = useMemo(
    () =>
      phase === 'failed'
        ? extractRowErrors(state.failedErrors)
        : new Map<number, string>(),
    [phase, state.failedErrors],
  );

  const generalErrors = useMemo(
    () => state.failedErrors.filter((e) => !/^line_items\[\d+\]/.test(e)),
    [state.failedErrors],
  );

  const totalCents = useMemo(() => {
    if (dbBacked && rows !== null) {
      return rows.reduce((sum, row) => sum + (row.total_cents ?? 0), 0);
    }
    if (state.items.length > 0) {
      return state.items.reduce(
        (sum, drafted) => sum + (drafted.item.total_cents ?? 0),
        0,
      );
    }
    return quote?.subtotal_cents ?? 0;
  }, [dbBacked, rows, state.items, quote?.subtotal_cents]);

  const hasUnpriced =
    dbBacked &&
    rows !== null &&
    rows.some((row) => row.unit_price_cents === null);
  const canSend =
    !sending &&
    status === 'completed' &&
    phase === 'completed' &&
    dbBacked &&
    rows !== null &&
    rows.length > 0 &&
    !hasUnpriced;

  const recomputeSubtotal = useCallback(
    async (nextRows: LineItemRow[]) => {
      if (!quoteId) {
        return;
      }
      const subtotal = nextRows.reduce(
        (sum, row) => sum + (row.total_cents ?? 0),
        0,
      );
      const { error } = await supabase
        .from('quotes')
        .update({ subtotal_cents: subtotal })
        .eq('id', quoteId);
      if (error) {
        throw new Error(`Failed to update the total: ${error.message}`);
      }
      setQuote((prev) =>
        prev ? { ...prev, subtotal_cents: subtotal } : prev,
      );
    },
    [quoteId],
  );

  const handlePressRow = useCallback(
    (dbId: string) => {
      if (!editable || rows === null) {
        return;
      }
      const row = rows.find((candidate) => candidate.id === dbId);
      if (row) {
        setEditing(row);
      }
    },
    [editable, rows],
  );

  const handleSave = useCallback(
    async (values: LineItemEditorValues) => {
      const target = editing;
      if (!target) {
        return;
      }
      const total =
        values.unit_price_cents === null
          ? null
          : Math.round(values.quantity * values.unit_price_cents);
      const { error } = await supabase
        .from('quote_line_items')
        .update({
          description: values.description,
          quantity: values.quantity,
          unit: values.unit,
          unit_price_cents: values.unit_price_cents,
          total_cents: total,
        })
        .eq('id', target.id);
      if (error) {
        throw new Error(error.message);
      }
      applyLocal({ ...target, ...values, total_cents: total });
      const next = await refresh();
      await recomputeSubtotal(next);
    },
    [editing, applyLocal, refresh, recomputeSubtotal],
  );

  const handleDelete = useCallback(
    (dbId: string) => {
      removeLocal(dbId);
      void (async () => {
        try {
          const { error } = await supabase
            .from('quote_line_items')
            .delete()
            .eq('id', dbId);
          if (error) {
            throw new Error(error.message);
          }
          const next = await refresh();
          await recomputeSubtotal(next);
        } catch (error) {
          Alert.alert(
            'Delete failed',
            error instanceof Error ? error.message : String(error),
          );
          void refresh();
        }
      })();
    },
    [removeLocal, refresh, recomputeSubtotal],
  );

  const shareToken = quote?.share_token;
  const openShareSheet = useCallback(async () => {
    if (!shareToken) {
      return;
    }
    try {
      await Share.share({ message: `${WEB_BASE}/q/${shareToken}` });
    } catch {
      // The user dismissed the share sheet.
    }
  }, [shareToken]);

  const handleSend = useCallback(async () => {
    if (!quoteId || !canSend) {
      return;
    }
    setSending(true);
    try {
      const { error } = await supabase
        .from('quotes')
        .update({ status: 'sent' })
        .eq('id', quoteId);
      if (error) {
        throw new Error(error.message);
      }
      setQuote((prev) => (prev ? { ...prev, status: 'sent' } : prev));
      await openShareSheet();
    } catch (error) {
      Alert.alert(
        'Send failed',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setSending(false);
    }
  }, [quoteId, canSend, openShareSheet]);

  const handleRegenerate = useCallback(async () => {
    if (!quoteId || regenerating) {
      return;
    }
    setRegenerating(true);
    try {
      const token = await getAccessToken();
      await regenerateQuote(quoteId, token);
      // Reset AFTER the call succeeds; the retained event-id watermark makes
      // any replay of the old run's events a no-op.
      keyMapRef.current.clear();
      dispatch({ type: 'reset-regenerate' });
      setQuote((prev) => (prev ? { ...prev, status: 'generating' } : prev));
    } catch (error) {
      Alert.alert(
        'Regenerate failed',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setRegenerating(false);
    }
  }, [quoteId, regenerating, dispatch]);

  if (loadError !== null) {
    return (
      <View style={styles.centered}>
        <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
        <Text style={styles.loadErrorText}>
          Could not load this quote: {loadError}
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.retryButton}
          onPress={() => {
            setLoadError(null);
            void fetchQuote();
          }}
        >
          <Text style={styles.retryLabel}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const hydrating =
    !quote ||
    (phase === 'loading' && quote.status !== 'generating') ||
    (phase === 'completed' && rows === null && state.items.length === 0);
  if (hydrating) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const showFullTicker =
    status === 'generating' &&
    displayRows.length === 0 &&
    retractedRows.length === 0;
  const showCompactTicker =
    status === 'generating' &&
    !showFullTicker &&
    (phase === 'assembling' || phase === 'revising');

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {phase === 'failed' && (
          <Animated.View
            entering={FadeInDown.duration(240)}
            style={styles.failedBanner}
          >
            <View style={styles.failedHeader}>
              <Ionicons name="alert-circle" size={20} color={colors.danger} />
              <Text style={styles.failedTitle}>
                Couldn&apos;t finalize this quote
              </Text>
            </View>
            {generalErrors.map((error) => (
              <Text key={error} style={styles.failedDetail}>
                {error}
              </Text>
            ))}
            <Pressable
              accessibilityRole="button"
              disabled={regenerating}
              style={[
                styles.regenerateButton,
                regenerating && styles.buttonDisabled,
              ]}
              onPress={() => {
                void handleRegenerate();
              }}
            >
              {regenerating ? (
                <ActivityIndicator size="small" color={colors.textOnPrimary} />
              ) : (
                <>
                  <Ionicons
                    name="refresh"
                    size={16}
                    color={colors.textOnPrimary}
                  />
                  <Text style={styles.regenerateLabel}>Regenerate</Text>
                </>
              )}
            </Pressable>
          </Animated.View>
        )}

        <View style={styles.metaRow}>
          {accepted ? (
            <View style={[styles.statusChip, styles.acceptedChip]}>
              <Ionicons
                name="checkmark-circle"
                size={14}
                color={colors.success}
              />
              <Text style={[styles.statusChipLabel, styles.acceptedChipLabel]}>
                Accepted
              </Text>
            </View>
          ) : sent ? (
            <View style={styles.statusChip}>
              <Ionicons name="paper-plane" size={13} color={colors.primary} />
              <Text style={styles.statusChipLabel}>Sent</Text>
            </View>
          ) : (
            <View />
          )}
          <Pressable
            accessibilityRole="link"
            style={styles.traceLink}
            onPress={() => router.push(`/quote/${quoteId}/trace`)}
          >
            <Text style={styles.traceLinkLabel}>View agent trace</Text>
            <Ionicons
              name="chevron-forward"
              size={14}
              color={colors.primary}
            />
          </Pressable>
        </View>

        {showFullTicker ? (
          <StageTicker stagesDone={state.stagesDone} />
        ) : (
          <>
            <LiveAssemblyList
              rows={displayRows}
              retracted={retractedRows}
              attempt={state.attempt}
              revising={phase === 'revising'}
              photoUrls={photoUrls}
              rowErrors={rowErrors}
              editable={editable}
              highlightedIds={highlightedIds}
              onPressRow={handlePressRow}
              onDeleteRow={handleDelete}
            />
            {showCompactTicker && (
              <View style={styles.compactTickerWrap}>
                <StageTicker stagesDone={state.stagesDone} compact />
              </View>
            )}
            {phase === 'completed' && displayRows.length === 0 && (
              <Text style={styles.emptyText}>
                No line items on this quote.
              </Text>
            )}
          </>
        )}
      </ScrollView>

      {accepted && (
        <Animated.View
          entering={FadeInDown.springify().damping(18).stiffness(220)}
          pointerEvents="none"
          style={styles.acceptedOverlay}
        >
          <Ionicons
            name="checkmark-circle"
            size={18}
            color={colors.textOnPrimary}
          />
          <Text style={styles.acceptedOverlayLabel}>
            The client accepted this quote
          </Text>
        </Animated.View>
      )}

      <View
        style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}
      >
        {status === 'completed' && !sent && hasUnpriced && (
          <Text style={styles.footerHint}>
            Set a price on every line before sending
          </Text>
        )}
        <View style={styles.footerRow}>
          <View>
            <Text style={styles.footerCaption}>Subtotal</Text>
            <RollingTotal cents={totalCents} />
          </View>
          {sent ? (
            <Pressable
              accessibilityRole="button"
              style={styles.copyLinkButton}
              onPress={() => {
                void openShareSheet();
              }}
            >
              <Ionicons name="link-outline" size={18} color={colors.primary} />
              <Text style={styles.copyLinkLabel}>Copy link</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              disabled={!canSend}
              style={[styles.sendButton, !canSend && styles.buttonDisabled]}
              onPress={() => {
                void handleSend();
              }}
            >
              {sending ? (
                <ActivityIndicator size="small" color={colors.textOnPrimary} />
              ) : (
                <>
                  <Ionicons
                    name="paper-plane"
                    size={16}
                    color={colors.textOnPrimary}
                  />
                  <Text style={styles.sendLabel}>Send</Text>
                </>
              )}
            </Pressable>
          )}
        </View>
      </View>

      {editing !== null && (
        <LineItemEditorSheet
          initial={{
            description: editing.description,
            quantity: editing.quantity,
            unit: editing.unit,
            unit_price_cents: editing.unit_price_cents,
          }}
          onSave={handleSave}
          onClose={() => setEditing(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  acceptedChip: { backgroundColor: colors.successLight },
  acceptedChipLabel: { color: colors.success },
  acceptedOverlay: {
    alignItems: 'center',
    backgroundColor: colors.success,
    borderRadius: radii.pill,
    elevation: 4,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    left: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    position: 'absolute',
    right: spacing.lg,
    shadowColor: colors.textPrimary,
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    top: spacing.md,
  },
  acceptedOverlayLabel: {
    ...typography.bodyBold,
    color: colors.textOnPrimary,
  },
  buttonDisabled: { opacity: 0.45 },
  centered: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  compactTickerWrap: {
    alignItems: 'center',
    marginTop: spacing.md,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  copyLinkButton: {
    alignItems: 'center',
    borderColor: colors.primary,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  copyLinkLabel: { ...typography.bodyBold, color: colors.primary },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.xl,
    textAlign: 'center',
  },
  failedBanner: {
    backgroundColor: colors.dangerLight,
    borderRadius: radii.md,
    gap: spacing.sm,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  failedDetail: { ...typography.caption, color: colors.danger },
  failedHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  failedTitle: { ...typography.bodyBold, color: colors.danger, flex: 1 },
  footer: {
    backgroundColor: colors.background,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  footerCaption: { ...typography.caption, color: colors.textSecondary },
  footerHint: {
    ...typography.caption,
    color: colors.warning,
    marginBottom: spacing.sm,
  },
  footerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  loadErrorText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    minHeight: 28,
  },
  regenerateButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.danger,
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    marginTop: spacing.xs,
    minWidth: 132,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  regenerateLabel: { ...typography.captionBold, color: colors.textOnPrimary },
  retryButton: {
    borderColor: colors.primary,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  retryLabel: { ...typography.bodyBold, color: colors.primary },
  screen: { backgroundColor: colors.background, flex: 1 },
  scroll: { flex: 1 },
  sendButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minWidth: 120,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  sendLabel: { ...typography.bodyBold, color: colors.textOnPrimary },
  statusChip: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  statusChipLabel: { ...typography.captionBold, color: colors.primary },
  traceLink: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
    paddingVertical: spacing.xs,
  },
  traceLinkLabel: { ...typography.captionBold, color: colors.primary },
});
