import { Ionicons } from '@expo/vector-icons';
import { CameraView } from 'expo-camera';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PermissionGate } from '@/components/PermissionGate';
import {
  COUNTDOWN_THRESHOLD_SECONDS,
  MAX_PHOTOS,
  MAX_RECORDING_SECONDS,
  useCaptureSession,
  type CapturedPhoto,
  type RecordingStatus,
} from '@/hooks/useCaptureSession';
import { colors, radii, spacing, type } from '@/lib/theme';

// Walk-and-talk capture session (SPEC.md - Mobile UI/UX - Capture session):
// full-screen viewfinder, pinned REC indicator, thumbnail strip, eager
// uploads, then a light-surface review phase that gates Generate on every
// upload succeeding.

function mmss(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function CaptureScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  return (
    <PermissionGate>
      <CaptureSessionScreen jobId={jobId} />
    </PermissionGate>
  );
}

function CaptureSessionScreen({ jobId }: { jobId: string }) {
  const session = useCaptureSession(jobId);
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [shutterBusy, setShutterBusy] = useState(false);

  const { state } = session;
  const { photos, recording, phase, audio } = state;

  // Leaving mid-session asks "Discard capture?"; the replace() fired by a
  // successful Generate runs in the 'generating' phase, so it never trips
  // the guard. Re-dispatching data.action is the documented escape hatch.
  usePreventRemove(phase !== 'generating', ({ data }) => {
    Alert.alert(
      'Discard capture?',
      'Photos and the walkthrough recording from this session will be deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            void session.discard();
            navigation.dispatch(data.action);
          },
        },
      ],
    );
  });

  const onShutter = async () => {
    const camera = cameraRef.current;
    if (!camera || shutterBusy || photos.length >= MAX_PHOTOS) {
      return;
    }
    setShutterBusy(true);
    try {
      const picture = await camera.takePictureAsync({ quality: 0.7 });
      await session.addPhoto(picture.uri);
    } catch (error) {
      Alert.alert(
        'Photo failed',
        error instanceof Error ? error.message : 'Could not capture the photo.',
      );
    } finally {
      setShutterBusy(false);
    }
  };

  const onGenerate = async () => {
    try {
      const quoteId = await session.generate();
      router.replace(`/quote/${quoteId}`);
    } catch (error) {
      Alert.alert(
        'Could not start generation',
        error instanceof Error ? error.message : 'Unknown error.',
      );
    }
  };

  if (phase !== 'capturing') {
    return (
      <View
        style={[
          styles.reviewContainer,
          { paddingBottom: insets.bottom + spacing.lg, paddingTop: insets.top + spacing.lg },
        ]}
      >
        <Text style={styles.reviewTitle}>Review capture</Text>
        <Text style={styles.reviewSubtitle}>
          Job photos ({photos.length}/{MAX_PHOTOS})
        </Text>

        <ScrollView style={styles.reviewScroll} contentContainerStyle={styles.reviewGrid}>
          {photos.map((photo) => (
            <PhotoTile
              key={photo.photoId}
              photo={photo}
              onRetry={() => session.retryPhotoUpload(photo.photoId)}
              onRemove={() => session.removePhoto(photo.photoId)}
            />
          ))}
          {photos.length === 0 && (
            <Text style={styles.reviewEmpty}>
              No photos captured. A quote needs at least one photo to cite.
            </Text>
          )}
        </ScrollView>

        <View style={styles.audioRow}>
          <View style={styles.audioIconCircle}>
            <Ionicons name="mic" size={20} color={colors.primary} />
          </View>
          <View style={styles.audioMeta}>
            <Text style={styles.audioTitle}>Walkthrough audio</Text>
            <Text style={styles.audioCaption}>{mmss(audio.durationSec ?? 0)}</Text>
          </View>
          {audio.uploadState === 'uploading' && (
            <ActivityIndicator size="small" color={colors.primary} />
          )}
          {audio.uploadState === 'done' && (
            <Ionicons name="checkmark-circle" size={22} color={colors.success} />
          )}
          {audio.uploadState === 'failed' && (
            <Pressable
              accessibilityRole="button"
              style={styles.audioRetry}
              onPress={session.retryAudioUpload}
            >
              <Ionicons name="refresh" size={14} color={colors.textOnPrimary} />
              <Text style={styles.audioRetryLabel}>Retry</Text>
            </Pressable>
          )}
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={!session.canGenerate}
          style={[styles.generateButton, !session.canGenerate && styles.generateButtonDisabled]}
          onPress={() => {
            void onGenerate();
          }}
        >
          {phase === 'generating' ? (
            <ActivityIndicator size="small" color={colors.textOnPrimary} />
          ) : (
            <Text style={styles.generateLabel}>Generate quote</Text>
          )}
        </Pressable>
        {!session.canGenerate && phase === 'review' && (
          <Text style={styles.generateHint}>
            Generate unlocks when every upload has finished - retry or remove failed items.
          </Text>
        )}
      </View>
    );
  }

  const atPhotoLimit = photos.length >= MAX_PHOTOS;
  const shutterDisabled = !cameraReady || shutterBusy || atPhotoLimit;

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        onCameraReady={() => setCameraReady(true)}
      />

      <View style={[styles.topBar, { top: insets.top + spacing.md }]}>
        <RecPill status={recording.status} elapsedSec={recording.elapsedSec} />
        <Pressable
          accessibilityRole="button"
          style={styles.finishButton}
          onPress={() => {
            void session.finishAndReview();
          }}
        >
          <Text style={styles.finishLabel}>Finish &amp; Review</Text>
        </Pressable>
      </View>

      {recording.status === 'paused' && (
        <View style={[styles.pausedBanner, { top: insets.top + spacing.md + 52 }]}>
          <Ionicons name="pause-circle" size={18} color={colors.warningLight} />
          <Text style={styles.pausedLabel}>Recording paused</Text>
          <Pressable
            accessibilityRole="button"
            style={styles.resumeButton}
            onPress={session.resumeRecording}
          >
            <Text style={styles.resumeLabel}>Resume</Text>
          </Pressable>
        </View>
      )}

      <View style={[styles.bottomArea, { paddingBottom: insets.bottom + spacing.lg }]}>
        {atPhotoLimit && <Text style={styles.limitNotice}>Photo limit reached (10/10)</Text>}
        {photos.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.strip}
            contentContainerStyle={styles.stripContent}
          >
            {photos.map((photo) => (
              <StripThumb
                key={photo.photoId}
                photo={photo}
                onRetry={() => session.retryPhotoUpload(photo.photoId)}
                onRemove={() => session.removePhoto(photo.photoId)}
              />
            ))}
          </ScrollView>
        )}
        <View style={styles.shutterRow}>
          <Text style={styles.photoCount}>
            {photos.length}/{MAX_PHOTOS}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={shutterDisabled}
            style={[styles.shutterOuter, shutterDisabled && styles.shutterDisabled]}
            onPress={() => {
              void onShutter();
            }}
          >
            <View style={styles.shutterInner} />
          </Pressable>
          <View style={styles.shutterSpacer} />
        </View>
      </View>
    </View>
  );
}

// Pinned REC indicator: pulsing red dot + elapsed mm:ss; past 2:30 it flips
// to danger countdown styling showing time remaining to 3:00.
function RecPill({ status, elapsedSec }: { status: RecordingStatus; elapsedSec: number }) {
  const [pulse] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (status !== 'recording') {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.2, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [status, pulse]);

  const countdown = elapsedSec >= COUNTDOWN_THRESHOLD_SECONDS;
  return (
    <View style={[styles.recPill, countdown && styles.recPillCountdown]}>
      {status === 'paused' ? (
        <Ionicons name="pause" size={12} color={colors.textOnPrimary} />
      ) : (
        <Animated.View style={[styles.recDot, { opacity: pulse }]} />
      )}
      <Text style={styles.recLabel}>
        {countdown ? `${mmss(MAX_RECORDING_SECONDS - elapsedSec)} left` : mmss(elapsedSec)}
      </Text>
    </View>
  );
}

// Per-thumbnail upload state: spinner while uploading, check when done, red
// retry badge on failure (tap retries); the x (or a long-press) removes.
function StripThumb({
  photo,
  onRetry,
  onRemove,
}: {
  photo: CapturedPhoto;
  onRetry: () => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.thumbWrap}>
      <Pressable
        accessibilityRole="imagebutton"
        onPress={photo.uploadState === 'failed' ? onRetry : undefined}
        onLongPress={onRemove}
      >
        <Image source={{ uri: photo.localUri }} style={styles.thumb} />
        {photo.uploadState === 'uploading' && (
          <View style={styles.thumbOverlay}>
            <ActivityIndicator size="small" color={colors.textOnPrimary} />
          </View>
        )}
        {photo.uploadState === 'done' && (
          <View style={styles.thumbBadge}>
            <Ionicons name="checkmark-circle" size={16} color={colors.success} />
          </View>
        )}
        {photo.uploadState === 'failed' && (
          <View style={[styles.thumbBadge, styles.thumbBadgeFailed]}>
            <Ionicons name="refresh" size={12} color={colors.textOnPrimary} />
          </View>
        )}
      </Pressable>
      <Pressable accessibilityRole="button" style={styles.thumbRemove} hitSlop={8} onPress={onRemove}>
        <Ionicons name="close" size={12} color={colors.textOnPrimary} />
      </Pressable>
    </View>
  );
}

// Review-phase tile: same state badges on light surfaces.
function PhotoTile({
  photo,
  onRetry,
  onRemove,
}: {
  photo: CapturedPhoto;
  onRetry: () => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.tileWrap}>
      <Pressable
        accessibilityRole="imagebutton"
        onPress={photo.uploadState === 'failed' ? onRetry : undefined}
        onLongPress={onRemove}
      >
        <Image source={{ uri: photo.localUri }} style={styles.tile} />
        {photo.uploadState === 'uploading' && (
          <View style={styles.thumbOverlay}>
            <ActivityIndicator size="small" color={colors.textOnPrimary} />
          </View>
        )}
        {photo.uploadState === 'done' && (
          <View style={styles.thumbBadge}>
            <Ionicons name="checkmark-circle" size={18} color={colors.success} />
          </View>
        )}
        {photo.uploadState === 'failed' && (
          <View style={[styles.thumbBadge, styles.thumbBadgeFailed]}>
            <Ionicons name="refresh" size={14} color={colors.textOnPrimary} />
          </View>
        )}
      </Pressable>
      <Pressable accessibilityRole="button" style={styles.thumbRemove} hitSlop={8} onPress={onRemove}>
        <Ionicons name="close" size={12} color={colors.textOnPrimary} />
      </Pressable>
    </View>
  );
}

const scrim = 'rgba(15, 23, 42, 0.55)';

const styles = StyleSheet.create({
  audioCaption: {
    ...type.caption,
    color: colors.textSecondary,
  },
  audioIconCircle: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radii.pill,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  audioMeta: {
    flex: 1,
    gap: 2,
  },
  audioRetry: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  audioRetryLabel: {
    ...type.captionBold,
    color: colors.textOnPrimary,
  },
  audioRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  audioTitle: {
    ...type.bodyBold,
    color: colors.textPrimary,
  },
  bottomArea: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  container: {
    backgroundColor: colors.textPrimary,
    flex: 1,
  },
  finishButton: {
    backgroundColor: scrim,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  finishLabel: {
    ...type.captionBold,
    color: colors.textOnPrimary,
  },
  generateButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    justifyContent: 'center',
    marginTop: spacing.lg,
    minHeight: 52,
    paddingVertical: spacing.md,
  },
  generateButtonDisabled: {
    backgroundColor: colors.textMuted,
  },
  generateHint: {
    ...type.caption,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  generateLabel: {
    ...type.bodyBold,
    color: colors.textOnPrimary,
  },
  limitNotice: {
    ...type.captionBold,
    alignSelf: 'center',
    backgroundColor: scrim,
    borderRadius: radii.pill,
    color: colors.warningLight,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  pausedBanner: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: scrim,
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    position: 'absolute',
  },
  pausedLabel: {
    ...type.captionBold,
    color: colors.textOnPrimary,
  },
  photoCount: {
    ...type.captionBold,
    color: colors.textOnPrimary,
    flex: 1,
    textAlign: 'center',
  },
  recDot: {
    backgroundColor: colors.recording,
    borderRadius: radii.pill,
    height: 10,
    width: 10,
  },
  recLabel: {
    ...type.captionBold,
    color: colors.textOnPrimary,
    fontVariant: ['tabular-nums'],
  },
  recPill: {
    alignItems: 'center',
    backgroundColor: scrim,
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  recPillCountdown: {
    backgroundColor: colors.danger,
  },
  resumeButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  resumeLabel: {
    ...type.captionBold,
    color: colors.textOnPrimary,
  },
  reviewContainer: {
    backgroundColor: colors.background,
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  reviewEmpty: {
    ...type.body,
    color: colors.textMuted,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  reviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingBottom: spacing.lg,
    paddingTop: spacing.md,
  },
  reviewScroll: {
    flex: 1,
  },
  reviewSubtitle: {
    ...type.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  reviewTitle: {
    ...type.title,
    color: colors.textPrimary,
  },
  shutterDisabled: {
    opacity: 0.4,
  },
  shutterInner: {
    backgroundColor: colors.textOnPrimary,
    borderRadius: radii.pill,
    height: 56,
    width: 56,
  },
  shutterOuter: {
    alignItems: 'center',
    borderColor: colors.textOnPrimary,
    borderRadius: radii.pill,
    borderWidth: 4,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  shutterRow: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
  },
  shutterSpacer: {
    flex: 1,
  },
  strip: {
    flexGrow: 0,
    marginBottom: spacing.md,
  },
  stripContent: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  thumb: {
    borderRadius: radii.sm,
    height: 60,
    width: 60,
  },
  thumbBadge: {
    backgroundColor: colors.textOnPrimary,
    borderRadius: radii.pill,
    bottom: 2,
    position: 'absolute',
    right: 2,
  },
  thumbBadgeFailed: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  thumbOverlay: {
    alignItems: 'center',
    backgroundColor: scrim,
    borderRadius: radii.sm,
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  thumbRemove: {
    alignItems: 'center',
    backgroundColor: scrim,
    borderRadius: radii.pill,
    height: 18,
    justifyContent: 'center',
    position: 'absolute',
    right: -4,
    top: -4,
    width: 18,
    zIndex: 1,
  },
  thumbWrap: {
    position: 'relative',
  },
  tile: {
    borderRadius: radii.md,
    height: 96,
    width: 96,
  },
  tileWrap: {
    position: 'relative',
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 0,
    paddingHorizontal: spacing.lg,
    position: 'absolute',
    right: 0,
    zIndex: 2,
  },
});
