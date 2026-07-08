import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  type ListRenderItem,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type JobListItem, useJobs } from '@/hooks/useJobs';
import type { QuoteStatus } from '@/lib/quote-schema';
import { supabase } from '@/lib/supabase';
import { colors, radii, spacing, type as typography } from '@/lib/theme';

// Home: jobs-first list, each card badged with its latest quote's status
// (SPEC.md - Mobile UI/UX - Navigation and structure).

const badgeConfig: Record<QuoteStatus, { label: string; bg: string; fg: string }> = {
  generating: { label: 'Generating', bg: colors.primaryLight, fg: colors.primary },
  completed: { label: 'Completed', bg: colors.successLight, fg: colors.success },
  failed: { label: 'Failed', bg: colors.dangerLight, fg: colors.danger },
  sent: { label: 'Sent', bg: colors.primaryLight, fg: colors.primaryDark },
  accepted: { label: 'Accepted', bg: colors.successLight, fg: colors.success },
};

function QuoteStatusBadge({ status }: { status: QuoteStatus | null }) {
  if (status === null) {
    return (
      <View style={[styles.badge, styles.badgeNeutral]}>
        <Text style={[styles.badgeLabel, { color: colors.textMuted }]}>No quote</Text>
      </View>
    );
  }
  const config = badgeConfig[status];
  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      {status === 'generating' ? (
        <ActivityIndicator size="small" color={config.fg} style={styles.badgeSpinner} />
      ) : null}
      <Text style={[styles.badgeLabel, { color: config.fg }]}>{config.label}</Text>
    </View>
  );
}

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (dayDiff <= 0) {
    return 'Today';
  }
  if (dayDiff === 1) {
    return 'Yesterday';
  }
  if (dayDiff < 7) {
    return `${dayDiff}d ago`;
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function JobCard({ job, onPress }: { job: JobListItem; onPress: (job: JobListItem) => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => onPress(job)}
    >
      <View style={styles.cardText}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {job.client_name}
        </Text>
        <Text style={styles.cardCaption} numberOfLines={1}>
          {job.trade} · {formatShortDate(job.created_at)}
        </Text>
      </View>
      <QuoteStatusBadge status={job.latestQuote?.status ?? null} />
    </Pressable>
  );
}

function EmptyState({ onNewJob }: { onNewJob: () => void }) {
  return (
    <View style={styles.empty}>
      <Ionicons name="briefcase-outline" size={44} color={colors.textMuted} />
      <Text style={styles.emptyTitle}>No jobs yet</Text>
      <Text style={styles.emptyBody}>
        Create a job, snap the work area, and talk through it — QuoteLens drafts the quote.
      </Text>
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
        onPress={onNewJob}
      >
        <Ionicons name="add" size={20} color={colors.textOnPrimary} />
        <Text style={styles.primaryButtonLabel}>New job</Text>
      </Pressable>
      <Text style={styles.emptyDisclosure}>
        Demo backend — first generation may be slow to wake.
      </Text>
    </View>
  );
}

function SignOutButton() {
  return (
    <Pressable
      accessibilityLabel="Sign out"
      accessibilityRole="button"
      hitSlop={8}
      onPress={() => {
        // Root layout redirects to login on the SIGNED_OUT auth event.
        void supabase.auth.signOut({ scope: 'local' });
      }}
    >
      <Ionicons name="log-out-outline" size={22} color={colors.textPrimary} />
    </Pressable>
  );
}

export default function JobsListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { jobs, loading, error, refetch } = useJobs();
  const [refreshing, setRefreshing] = useState(false);
  const firstFocus = useRef(true);

  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false; // useJobs already fetched on mount.
        return;
      }
      void refetch();
    }, [refetch]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refetch().finally(() => setRefreshing(false));
  }, [refetch]);

  const openJob = useCallback(
    (job: JobListItem) => {
      if (job.latestQuote) {
        router.push(`/quote/${job.latestQuote.id}`);
      } else {
        router.push(`/capture/${job.id}`);
      }
    },
    [router],
  );

  const openNewJob = useCallback(() => {
    router.push('/job/new');
  }, [router]);

  const renderItem = useCallback<ListRenderItem<JobListItem>>(
    ({ item }) => <JobCard job={item} onPress={openJob} />,
    [openJob],
  );

  const showFooterButton = !loading && jobs.length > 0;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerRight: () => <SignOutButton /> }} />
      {error !== null ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>Couldn’t load jobs: {error}</Text>
        </View>
      ) : null}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<EmptyState onNewJob={openNewJob} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        />
      )}
      {showFooterButton ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
            onPress={openNewJob}
          >
            <Ionicons name="add" size={20} color={colors.textOnPrimary} />
            <Text style={styles.primaryButtonLabel}>New job</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardPressed: { opacity: 0.7 },
  cardText: { flex: 1, gap: spacing.xs },
  cardTitle: { ...typography.bodyBold, color: colors.textPrimary },
  cardCaption: { ...typography.caption, color: colors.textSecondary },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm + spacing.xs,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  badgeNeutral: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeSpinner: { transform: [{ scale: 0.75 }] },
  badgeLabel: typography.captionBold,
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  emptyTitle: { ...typography.heading, color: colors.textPrimary },
  emptyBody: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emptyDisclosure: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  primaryButtonPressed: { backgroundColor: colors.primaryDark },
  primaryButtonLabel: { ...typography.bodyBold, color: colors.textOnPrimary },
  errorBanner: {
    backgroundColor: colors.dangerLight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  errorText: { ...typography.caption, color: colors.danger },
});
