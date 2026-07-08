import { Ionicons } from '@expo/vector-icons';
import {
  getRecordingPermissionsAsync,
  PermissionStatus,
  requestRecordingPermissionsAsync,
  type PermissionResponse,
} from 'expo-audio';
import { useCameraPermissions } from 'expo-camera';
import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, type } from '@/lib/theme';

// Pre-permission gate (SPEC.md - Mobile UI/UX - Capture session): explain
// why camera + mic are needed BEFORE the OS prompts fire. Children render
// only once both permissions are granted; a hard denial gets a settings
// link, never a half-working camera.

export function PermissionGate({ children }: { children: ReactNode }) {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, setMicPermission] = useState<PermissionResponse | null>(null);
  const [requesting, setRequesting] = useState(false);

  // Silent status read on mount so the already-granted fast path never
  // flashes the explainer.
  useEffect(() => {
    let mounted = true;
    getRecordingPermissionsAsync()
      .then((response) => {
        if (mounted) {
          setMicPermission(response);
        }
      })
      .catch(() => {
        // Fall through to the explainer rather than spinning forever.
        if (mounted) {
          setMicPermission({
            status: PermissionStatus.UNDETERMINED,
            granted: false,
            canAskAgain: true,
            expires: 'never',
          });
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const requestBoth = async () => {
    setRequesting(true);
    try {
      await requestCameraPermission();
      const mic = await requestRecordingPermissionsAsync();
      setMicPermission(mic);
    } finally {
      setRequesting(false);
    }
  };

  // Still resolving the current statuses: render a quiet placeholder.
  if (cameraPermission === null || micPermission === null) {
    return <View style={styles.container} />;
  }

  if (cameraPermission.granted && micPermission.granted) {
    return <>{children}</>;
  }

  const blocked =
    (!cameraPermission.granted && !cameraPermission.canAskAgain) ||
    (!micPermission.granted && !micPermission.canAskAgain);

  if (blocked) {
    return (
      <View style={styles.container}>
        <View style={styles.iconCircleDanger}>
          <Ionicons name="alert-circle" size={36} color={colors.danger} />
        </View>
        <Text style={styles.heading}>Camera or microphone blocked</Text>
        <Text style={styles.explainer}>
          QuoteLens cannot run a capture session without the camera and microphone. Enable both for
          QuoteLens in your device settings, then come back.
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.primaryButton}
          onPress={() => {
            void Linking.openSettings();
          }}
        >
          <Ionicons name="settings-outline" size={18} color={colors.textOnPrimary} />
          <Text style={styles.primaryButtonLabel}>Open Settings</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.iconCircle}>
        <Ionicons name="camera" size={36} color={colors.primary} />
      </View>
      <Text style={styles.heading}>Ready to walk the job?</Text>
      <Text style={styles.explainer}>
        A capture session records one continuous walkthrough while you snap photos of the work
        area.
      </Text>

      <View style={styles.rationaleRow}>
        <Ionicons name="camera-outline" size={22} color={colors.primary} />
        <Text style={styles.rationaleText}>
          Camera - every quote line cites photo evidence from the job site.
        </Text>
      </View>
      <View style={styles.rationaleRow}>
        <Ionicons name="mic-outline" size={22} color={colors.primary} />
        <Text style={styles.rationaleText}>
          Microphone - your spoken walkthrough becomes the quote draft.
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        style={[styles.primaryButton, requesting && styles.primaryButtonDisabled]}
        disabled={requesting}
        onPress={() => {
          void requestBoth();
        }}
      >
        <Text style={styles.primaryButtonLabel}>Allow camera &amp; microphone</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  explainer: {
    ...type.body,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
    textAlign: 'center',
  },
  heading: {
    ...type.heading,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  iconCircle: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radii.pill,
    height: 72,
    justifyContent: 'center',
    marginBottom: spacing.lg,
    width: 72,
  },
  iconCircleDanger: {
    alignItems: 'center',
    backgroundColor: colors.dangerLight,
    borderRadius: radii.pill,
    height: 72,
    justifyContent: 'center',
    marginBottom: spacing.lg,
    width: 72,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonLabel: {
    ...type.bodyBold,
    color: colors.textOnPrimary,
  },
  rationaleRow: {
    alignItems: 'center',
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  rationaleText: {
    ...type.caption,
    color: colors.textSecondary,
    flex: 1,
  },
});
