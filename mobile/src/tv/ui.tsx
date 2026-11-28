// Building blocks shared by the TV pages: buttons, chips, posters and score badges, sized from
// the 1920 x 1080 designs with px().
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { fonts } from '../lib/theme';
import { px } from '../lib/tv';
import type { CardTitle } from '../lib/types';
import { Focusable, tvColors as c } from './focus';

export const T = StyleSheet.create({
  h1: {
    color: c.text,
    fontFamily: fonts.display,
    fontSize: px(112),
    lineHeight: px(104),
    textTransform: 'uppercase',
  },
  h1Small: {
    color: c.text,
    fontFamily: fonts.display,
    fontSize: px(84),
    lineHeight: px(80),
    textTransform: 'uppercase',
  },
  h2: {
    color: c.text,
    fontFamily: fonts.display,
    fontSize: px(32),
    letterSpacing: px(2),
    textTransform: 'uppercase',
  },
  meta: { color: '#c4c4cc', fontFamily: fonts.bodySemi, fontSize: px(22), letterSpacing: px(0.8) },
  body: { color: '#d6d6dc', fontFamily: fonts.body, fontSize: px(26), lineHeight: px(37) },
  small: { color: c.dim, fontFamily: fonts.body, fontSize: px(22), lineHeight: px(30) },
  label: { color: c.dim, fontFamily: fonts.bodyBold, fontSize: px(20), letterSpacing: px(2), textTransform: 'uppercase' },
  strong: { color: c.text, fontFamily: fonts.bodySemi },
});

/** Big rounded button: Watched, Hide, Add to Watchlist and so on. `primary` is the red one. */
export function TvButton({
  label,
  icon,
  primary,
  onPress,
  preferred,
  focusKey,
  busy,
  style,
}: {
  label: string;
  icon?: (color: string) => ReactNode;
  primary?: boolean;
  onPress: () => void;
  preferred?: boolean;
  focusKey?: string;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Focusable
      onPress={onPress}
      preferred={preferred}
      focusKey={focusKey}
      radius={px(16)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={(f) => [s.btn, primary && s.btnPrimary, f && !primary && s.btnFocused, style]}
    >
      {(f) => (
        <>
          {busy ? <ActivityIndicator color={primary || !f ? '#fff' : c.bg} /> : icon?.(primary || !f ? '#fff' : c.bg)}
          <Text style={[s.btnText, f && !primary && { color: c.bg }]}>{label}</Text>
        </>
      )}
    </Focusable>
  );
}

/** Round icon button in the header (search, filters, account). */
export function IconButton({
  label,
  children,
  onPress,
  badge,
  focusKey,
  filled,
}: {
  label: string;
  children: ReactNode;
  onPress: () => void;
  badge?: number;
  focusKey?: string;
  filled?: string;
}) {
  return (
    <Focusable
      onPress={onPress}
      focusKey={focusKey}
      radius={px(30)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[s.iconBtn, filled ? { backgroundColor: filled } : null]}
    >
      {children}
      {!!badge && (
        <View style={s.badge}>
          <Text style={s.badgeText}>{badge}</Text>
        </View>
      )}
    </Focusable>
  );
}

/** A filter chip or segment. White when on. */
export function Chip({
  label,
  on,
  onPress,
  focusKey,
  preferred,
}: {
  label: string;
  on?: boolean;
  onPress: () => void;
  focusKey?: string;
  preferred?: boolean;
}) {
  return (
    <Focusable
      onPress={onPress}
      focusKey={focusKey}
      preferred={preferred}
      radius={px(999)}
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      style={[s.chip, on && s.chipOn]}
    >
      <Text style={[s.chipText, on && { color: c.bg }]}>{label}</Text>
    </Focusable>
  );
}

export function ImdbBadge({ score, big }: { score: number | null; big?: boolean }) {
  return (
    <View style={[s.score, big && s.scoreBig]}>
      <Text style={s.imdbMark}>IMDb</Text>
      <Text style={[s.scoreText, big && { fontSize: px(40) }]}>{score === null ? '–' : score.toFixed(1)}</Text>
      {big && <Text style={[T.small, { marginLeft: px(-4) }]}>/ 10</Text>}
    </View>
  );
}

export function MetacriticBadge({ score, big }: { score: number | null; big?: boolean }) {
  const bg = score === null ? c.surface2 : score >= 61 ? '#4fbf7a' : score >= 40 ? '#f2c94c' : '#e3303c';
  return (
    <View style={[s.score, big && s.scoreBig]}>
      <View style={[s.mcMark, big && { width: px(56), height: px(48) }, { backgroundColor: bg }]}>
        <Text style={[s.mcText, big && { fontSize: px(26) }, score === null && { color: c.dim }]}>{score ?? '–'}</Text>
      </View>
      <Text style={[s.scoreText, { fontFamily: fonts.bodySemi }]}>Metacritic</Text>
    </View>
  );
}

/** "NETFLIX South Africa" or "DRIVE Media HDD". */
export function WhereBadge({ item }: { item: CardTitle }) {
  const w = item.where[0];
  if (!w) return null;
  return (
    <View style={s.score}>
      {w.kind === 'streaming' ? (
        <Text style={s.netflix}>{w.name.toUpperCase()}</Text>
      ) : (
        <Text style={[s.netflix, { color: c.text }]}>DRIVE</Text>
      )}
      <Text style={[s.scoreText, { fontFamily: fonts.bodySemi }]}>
        {w.kind === 'streaming' ? 'South Africa' : w.name}
      </Text>
    </View>
  );
}

export const POSTER_W = px(200);
export const POSTER_H = px(300);

/** A poster that can take focus. The poster image comes from TMDB; the name shows if there's none. */
export function PosterTile({
  item,
  onPress,
  onFocus,
  focusKey,
  preferred,
  showWhere,
  caption,
  width = POSTER_W,
}: {
  item: CardTitle;
  onPress: () => void;
  onFocus?: () => void;
  focusKey?: string;
  preferred?: boolean;
  showWhere?: boolean;
  caption?: string;
  width?: number;
}) {
  const height = width * 1.5;
  const w = item.where[0];
  return (
    <View style={{ width }}>
      <Focusable
        onPress={onPress}
        onFocus={onFocus}
        focusKey={focusKey}
        preferred={preferred}
        lift
        radius={px(14)}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${item.year}`}
        style={[s.poster, { width, height }]}
      >
        <View style={s.posterClip}>
          {item.posterUrl ? (
            <Image source={{ uri: item.posterUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
          ) : (
            <View style={s.posterFallback}>
              <Text style={s.posterName} numberOfLines={4}>
                {item.name}
              </Text>
            </View>
          )}
          {showWhere && w && (
            <View style={[s.loc, w.kind === 'streaming' ? { backgroundColor: c.netflix } : null]}>
              <Text style={s.locText}>{w.kind === 'streaming' ? w.name.toUpperCase() : 'DRIVE'}</Text>
            </View>
          )}
        </View>
      </Focusable>
      {caption ? (
        <Text style={[T.small, { marginTop: px(12) }]} numberOfLines={1}>
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

export function Loading() {
  return (
    <View style={{ height: POSTER_H, justifyContent: 'center' }}>
      <ActivityIndicator color={c.red} size="large" />
    </View>
  );
}

/** Empty or error state for a row or a page. */
export function EmptyNote({ title, text, action }: { title: string; text: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={{ gap: px(10), paddingVertical: px(24), maxWidth: px(1100) }}>
      <Text style={[T.h2, { fontSize: px(28) }]}>{title}</Text>
      <Text style={T.small}>{text}</Text>
      {action && <TvButton label={action.label} onPress={action.onPress} style={{ alignSelf: 'flex-start', marginTop: px(12) }} />}
    </View>
  );
}

const s = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: px(14),
    backgroundColor: c.surface2,
    borderRadius: px(16),
    paddingVertical: px(20),
    paddingHorizontal: px(34),
  },
  btnPrimary: { backgroundColor: c.red },
  btnFocused: { backgroundColor: c.text },
  btnText: { color: '#fff', fontFamily: fonts.bodyBold, fontSize: px(26) },
  iconBtn: {
    width: px(60),
    height: px(60),
    borderRadius: px(30),
    backgroundColor: 'rgba(46,46,51,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: px(-4),
    right: px(-4),
    minWidth: px(24),
    height: px(24),
    borderRadius: px(12),
    backgroundColor: c.red,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: px(4),
  },
  badgeText: { color: '#fff', fontFamily: fonts.bodyBold, fontSize: px(15) },
  chip: {
    backgroundColor: c.chip,
    borderRadius: px(999),
    paddingVertical: px(12),
    paddingHorizontal: px(26),
  },
  chipOn: { backgroundColor: c.chipOn },
  chipText: { color: c.text, fontFamily: fonts.bodySemi, fontSize: px(22) },
  score: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: px(10),
    backgroundColor: c.surface,
    borderRadius: px(10),
    paddingVertical: px(8),
    paddingLeft: px(8),
    paddingRight: px(16),
  },
  scoreBig: { paddingVertical: px(14), paddingLeft: px(14), paddingRight: px(22), borderRadius: px(14), gap: px(14) },
  imdbMark: {
    backgroundColor: c.imdb,
    color: '#000',
    fontFamily: fonts.display,
    fontSize: px(20),
    borderRadius: px(6),
    paddingHorizontal: px(8),
    paddingVertical: px(1),
    overflow: 'hidden',
  },
  scoreText: { color: c.text, fontFamily: fonts.bodyBold, fontSize: px(24) },
  mcMark: { width: px(36), height: px(30), borderRadius: px(6), alignItems: 'center', justifyContent: 'center' },
  mcText: { color: '#0b1a10', fontFamily: fonts.bodyHeavy, fontSize: px(18) },
  netflix: { color: c.red, fontFamily: fonts.display, fontSize: px(22), letterSpacing: px(1), paddingLeft: px(8) },
  poster: { borderRadius: px(14), backgroundColor: c.surface },
  // Clip the image here, not on the button, so the focus ring outside it isn't cut off.
  posterClip: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: px(14), overflow: 'hidden' },
  posterFallback: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: px(16),
    backgroundColor: '#2a3a52',
  },
  posterName: { color: '#fff', fontFamily: fonts.display, fontSize: px(26), lineHeight: px(26), textTransform: 'uppercase' },
  loc: {
    position: 'absolute',
    top: px(12),
    left: px(12),
    backgroundColor: 'rgba(20,20,22,0.85)',
    borderRadius: px(6),
    paddingVertical: px(3),
    paddingHorizontal: px(8),
  },
  locText: { color: '#fff', fontFamily: fonts.bodyBold, fontSize: px(15) },
});
