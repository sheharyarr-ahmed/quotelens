// Photo citation thumbnails for a quote line (SPEC.md v1.3 - Mobile UI/UX -
// Live assembly). On live-arriving rows the thumbnails scale in from zero
// ~150ms after the row lands: the second beat of the entry choreography.

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';

import { colors, radii } from '@/lib/theme';

const THUMB_SIZE = 32;
const THUMB_BEAT_DELAY_MS = 150;
const MAX_THUMBS = 3;

interface PhotoCitationProps {
  citations: string[];
  photoUrls: ReadonlyMap<string, string>;
  /** Play the delayed scale-in beat (live rows only). */
  animateIn?: boolean;
}

export function PhotoCitation({
  citations,
  photoUrls,
  animateIn = false,
}: PhotoCitationProps) {
  const scale = useSharedValue(animateIn ? 0 : 1);

  useEffect(() => {
    if (animateIn) {
      scale.value = withDelay(
        THUMB_BEAT_DELAY_MS,
        withSpring(1, { damping: 14, stiffness: 220 }),
      );
    }
  }, [animateIn, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  if (citations.length === 0) {
    return null;
  }

  return (
    <Animated.View style={[styles.row, animatedStyle]}>
      {citations.slice(0, MAX_THUMBS).map((citation, index) => {
        const url = photoUrls.get(citation);
        return (
          <View
            key={citation}
            style={[styles.thumbWrap, index > 0 && styles.overlap]}
          >
            {url ? (
              <Image
                source={{ uri: url }}
                style={styles.thumb}
                contentFit="cover"
                accessibilityLabel={`Photo ${citation}`}
              />
            ) : (
              <View style={styles.fallback}>
                <Ionicons
                  name="image-outline"
                  size={16}
                  color={colors.textMuted}
                />
              </View>
            )}
          </View>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    flex: 1,
    justifyContent: 'center',
  },
  overlap: { marginLeft: -10 },
  row: { alignItems: 'center', flexDirection: 'row' },
  thumb: { flex: 1 },
  thumbWrap: {
    backgroundColor: colors.surface,
    borderColor: colors.background,
    borderRadius: radii.md,
    borderWidth: 2,
    height: THUMB_SIZE,
    overflow: 'hidden',
    width: THUMB_SIZE,
  },
});
