import { Pressable, StyleSheet, View } from 'react-native';

import { colors } from '../lib/theme';
import { StarIcon } from './Icons';

const SIZE = 26;

/**
 * Five stars in Letterboxd's half-star steps. Tap the left half of a star for a half, the right
 * half for a whole one. Tapping the current rating clears it.
 */
export function StarRating({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const pick = (v: number) => onChange(value === v ? null : v);
  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={value ? `Your rating: ${value} out of 5 stars` : 'Rate this title'}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const cur = value ?? 0;
        if (e.nativeEvent.actionName === 'increment') onChange(Math.min(5, cur + 0.5));
        else onChange(cur <= 0.5 ? null : cur - 0.5);
      }}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = Math.max(0, Math.min(1, (value ?? 0) - (n - 1))); // 0, 0.5 or 1
        return (
          <View key={n} style={styles.star}>
            <StarIcon size={SIZE} color={colors.letterboxdText} />
            {fill > 0 && (
              <View style={[styles.fill, { width: SIZE * fill }]} pointerEvents="none">
                <StarIcon size={SIZE} color={colors.letterboxd} filled />
              </View>
            )}
            <Pressable style={styles.half} onPress={() => pick(n - 0.5)} hitSlop={{ top: 6, bottom: 6 }} />
            <Pressable style={[styles.half, { left: SIZE / 2 }]} onPress={() => pick(n)} hitSlop={{ top: 6, bottom: 6 }} />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 2, alignItems: 'center' },
  star: { width: SIZE, height: SIZE },
  fill: { position: 'absolute', top: 0, left: 0, height: SIZE, overflow: 'hidden' },
  half: { position: 'absolute', top: 0, left: 0, width: SIZE / 2, height: SIZE },
});
