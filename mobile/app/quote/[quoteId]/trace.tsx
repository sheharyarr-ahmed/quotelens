import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  LayoutAnimation,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { supabase } from '@/lib/supabase';
import { colors, radii, spacing, type as typography } from '@/lib/theme';
import { groupTraces, type AgentTraceRow } from '@/lib/traceGroups';

// Agent trace viewer (SPEC.md - Mobile UI/UX - Trace viewer): static fetch,
// vertical timeline of expandable node cards. One agent_traces query on
// open; pull-to-refresh covers mid-run peeking; no realtime here.

// The task blesses a dark-slate code surface inside the light theme; the
// background reuses the textPrimary token (#0F172A) as that slate.
const CODE_SURFACE_TEXT = '#E2E8F0';

function formatDuration(ms: number): string {
  return ms >= 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function formatTokens(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : `${count}`;
}

function formatJson(value: unknown): string {
  // JSON.stringify returns undefined for undefined input despite its typing.
  return JSON.stringify(value, null, 2) ?? 'null';
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <View style={styles.jsonSection}>
      <Text style={styles.jsonLabel}>{label}</Text>
      <ScrollView style={styles.jsonScroll} nestedScrollEnabled>
        <ScrollView horizontal contentContainerStyle={styles.jsonContent}>
          <Text style={styles.jsonText} selectable>
            {formatJson(value)}
          </Text>
        </ScrollView>
      </ScrollView>
    </View>
  );
}

function TraceCard({
  trace,
  isLast,
  isExpanded,
  onToggle,
}: {
  trace: AgentTraceRow;
  isLast: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <View style={styles.timelineRow}>
      <View style={styles.rail}>
        <View style={styles.dot} />
        {isLast ? null : <View style={styles.railLine} />}
      </View>
      <View style={styles.card}>
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: isExpanded }}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.nodeName}>{trace.node}</Text>
            <Ionicons
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.textMuted}
            />
          </View>
          <View style={styles.badgeRow}>
            <View style={styles.durationBadge}>
              <Text style={styles.durationText}>
                {formatDuration(trace.duration_ms)}
              </Text>
            </View>
            {trace.input_tokens !== null ? (
              <View style={styles.tokenChip}>
                <Text style={styles.tokenChipText}>
                  in {formatTokens(trace.input_tokens)}
                </Text>
              </View>
            ) : null}
            {trace.output_tokens !== null ? (
              <View style={styles.tokenChip}>
                <Text style={styles.tokenChipText}>
                  out {formatTokens(trace.output_tokens)}
                </Text>
              </View>
            ) : null}
          </View>
        </Pressable>
        {isExpanded ? (
          <>
            <JsonBlock label="Input" value={trace.input} />
            <JsonBlock label="Output" value={trace.output} />
          </>
        ) : null}
      </View>
    </View>
  );
}

export default function TraceScreen() {
  const { quoteId } = useLocalSearchParams<{ quoteId: string }>();
  const [traces, setTraces] = useState<AgentTraceRow[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const fetchTraces = useCallback(async () => {
    if (!quoteId) {
      return;
    }
    const { data, error } = await supabase
      .from('agent_traces')
      .select(
        'node, duration_ms, input_tokens, output_tokens, input, output, created_at',
      )
      .eq('quote_id', quoteId)
      .order('created_at', { ascending: true });
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setErrorMessage(null);
    setTraces((data ?? []) as AgentTraceRow[]);
  }, [quoteId]);

  useEffect(() => {
    void fetchTraces();
  }, [fetchTraces]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchTraces().finally(() => setRefreshing(false));
  }, [fetchTraces]);

  const toggle = useCallback((key: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  if (traces === null && errorMessage === null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const groups = groupTraces(traces ?? []);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={
        groups.length === 0 ? styles.emptyContent : styles.content
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      {errorMessage !== null ? (
        <Text style={styles.errorText}>
          Could not load the trace: {errorMessage}
        </Text>
      ) : null}
      {groups.length === 0 && errorMessage === null ? (
        <Text style={styles.emptyText}>
          No trace yet — generation may still be starting.
        </Text>
      ) : null}
      {groups.map((group, groupIndex) => (
        <View key={`attempt-${groupIndex + 1}`}>
          {groupIndex > 0 ? (
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerLabel}>Attempt {groupIndex + 1}</Text>
              <View style={styles.dividerLine} />
            </View>
          ) : null}
          {group.map((trace, index) => {
            const key = `${groupIndex}-${index}`;
            return (
              <TraceCard
                key={key}
                trace={trace}
                isLast={index === group.length - 1}
                isExpanded={expanded[key] === true}
                onToggle={() => toggle(key)}
              />
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  emptyContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  errorText: {
    ...typography.body,
    color: colors.danger,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  dividerLabel: {
    ...typography.captionBold,
    color: colors.textSecondary,
  },
  timelineRow: {
    flexDirection: 'row',
  },
  rail: {
    width: 20,
    alignItems: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
    marginTop: spacing.lg,
  },
  railLine: {
    flex: 1,
    width: 2,
    backgroundColor: colors.primary,
    opacity: 0.3,
    marginTop: spacing.xs,
  },
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    marginLeft: spacing.sm,
    marginBottom: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  nodeName: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  durationBadge: {
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  durationText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  tokenChip: {
    backgroundColor: colors.primaryLight,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  tokenChipText: {
    ...typography.captionBold,
    color: colors.primaryDark,
  },
  jsonSection: {
    marginTop: spacing.md,
  },
  jsonLabel: {
    ...typography.captionBold,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  jsonScroll: {
    maxHeight: 260,
    borderRadius: radii.sm,
    backgroundColor: colors.textPrimary,
  },
  jsonContent: {
    padding: spacing.sm,
  },
  jsonText: {
    ...typography.mono,
    color: CODE_SURFACE_TEXT,
    lineHeight: 18,
  },
});
