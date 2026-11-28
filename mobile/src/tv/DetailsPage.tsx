import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { CheckIcon, DownloadIcon, EyeOffIcon, PlusIcon, CloseIcon } from '../components/Icons';
import { posterAtSize, yearLabel } from '../lib/format';
import { fonts } from '../lib/theme';
import { SAFE_X, SAFE_Y, px } from '../lib/tv';
import type { Action, CardTitle } from '../lib/types';
import { useToast } from '../state/toast';
import { tvColors as c } from './focus';
import { ImdbBadge, MetacriticBadge, T, TvButton } from './ui';

const SECTION_LABEL: Record<string, string> = {
  home: 'In Home',
  explore: 'In Explore',
  watchlist: 'In Watchlist',
  history: 'Watched',
  hidden: 'Hidden',
  removed: 'Removed',
};

type Btn = { label: string; action: Action; icon: (color: string) => ReactNode };

const ICON = px(28);
const BUTTONS: Partial<Record<CardTitle['status'], Btn[]>> = {
  home: [
    { label: 'Watched', action: 'watched', icon: (col) => <CheckIcon size={ICON} color={col} /> },
    { label: 'Hide', action: 'hide', icon: (col) => <EyeOffIcon size={ICON} color={col} /> },
  ],
  explore: [
    { label: 'Add to Watchlist', action: 'watchlist', icon: (col) => <PlusIcon size={ICON} color={col} /> },
    { label: 'Watched', action: 'watched', icon: (col) => <CheckIcon size={ICON} color={col} /> },
    { label: 'Not for me', action: 'remove', icon: (col) => <CloseIcon size={px(22)} color={col} /> },
  ],
  watchlist: [
    { label: 'Mark downloaded', action: 'downloaded', icon: (col) => <DownloadIcon size={ICON} color={col} /> },
    { label: 'Watched', action: 'watched', icon: (col) => <CheckIcon size={ICON} color={col} /> },
  ],
};

/**
 * Opens the Netflix app on the title. We only know the title's name (TMDB doesn't give Netflix
 * ids), so this opens Netflix's search for it; if Netflix can't be opened, the toast says so.
 */
export async function openInNetflix(name: string): Promise<boolean> {
  const q = encodeURIComponent(name);
  for (const url of [`nflx://www.netflix.com/search?q=${q}`, `https://www.netflix.com/search?q=${q}`]) {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      // Try the next address.
    }
  }
  return false;
}

/** Full-screen details for one title, with the buttons for the section it's in. Back closes it. */
export function DetailsPage({
  item,
  move,
  onClose,
}: {
  item: CardTitle;
  move: (item: CardTitle, action: Action) => Promise<boolean>;
  onClose: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<Action | null>(null);
  const streaming = item.where.find((w) => w.kind === 'streaming');
  const local = item.where.find((w) => w.kind === 'local');
  const poster = posterAtSize(item.posterUrl, 'w780');
  const buttons = BUTTONS[item.status] ?? [];

  const run = async (action: Action) => {
    setBusy(action);
    const ok = await move(item, action);
    setBusy(null);
    if (ok) onClose();
  };

  return (
    <View style={styles.screen}>
      {poster && (
        <Image source={{ uri: poster }} style={[StyleSheet.absoluteFill, { opacity: 0.55 }]} contentFit="cover" blurRadius={18} />
      )}
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundImage: `linear-gradient(90deg, ${c.app} 0%, rgba(27,27,30,0.9) 38%, rgba(27,27,30,0.2) 75%), linear-gradient(0deg, ${c.app} 0%, rgba(27,27,30,0) 45%)`,
          },
        ]}
      />

      <View style={styles.back}>
        <Svg width={px(26)} height={px(26)} viewBox="0 0 24 24" fill="none" stroke="#c4c4cc" strokeWidth={2}>
          <Path d="M15 18l-6-6 6-6" />
        </Svg>
        <Text style={T.meta}>Back to {item.status === 'home' ? 'Home' : 'the list'}</Text>
      </View>

      <View style={styles.main}>
        <View style={{ flexDirection: 'row', gap: px(12) }}>
          <Text style={[styles.chip, styles.chipRed]}>{SECTION_LABEL[item.status]}</Text>
          {item.genres.map((g) => (
            <Text key={g} style={styles.chip}>
              {g}
            </Text>
          ))}
        </View>
        <Text style={[T.h1, { fontSize: px(128), lineHeight: px(118) }]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.55}>
          {item.name}
        </Text>
        <Text style={[T.meta, { fontSize: px(24), fontFamily: fonts.body }]}>
          {yearLabel(item.year, item.endYear, item.type)} · {item.type === 'movie' ? 'Movie' : 'Series'}
          {item.release ? ` · ${item.release.label}` : ''}
        </Text>
        <View style={{ flexDirection: 'row', gap: px(16) }}>
          <ImdbBadge score={item.imdb} big />
          <MetacriticBadge score={item.metacritic} big />
        </View>
        <Text style={[T.body, { fontSize: px(28), lineHeight: px(40), color: '#dcdce2' }]} numberOfLines={5}>
          {item.synopsis}
        </Text>
        <View style={{ flexDirection: 'row', gap: px(44) }}>
          {item.cast.length > 0 && (
            <View>
              <Text style={styles.lbl}>Starring</Text>
              <Text style={styles.val}>{item.cast.join(' · ')}</Text>
            </View>
          )}
          <View>
            <Text style={styles.lbl}>Where to watch</Text>
            <Text style={styles.val}>
              {streaming ? (
                <>
                  <Text style={styles.netflix}>{streaming.name.toUpperCase()}</Text> South Africa
                </>
              ) : local ? (
                `On your drive${local.name !== 'Drive' ? ` (${local.name})` : ''}`
              ) : (
                'Not on Netflix SA or your drive'
              )}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: px(20), marginTop: px(12) }}>
          {streaming && (
            <TvButton
              label={`Open in ${streaming.name}`}
              primary
              preferred
              icon={(col) => (
                <Svg width={px(30)} height={px(30)} viewBox="0 0 24 24" fill={col}>
                  <Path d="M7 4.5v15l13-7.5z" />
                </Svg>
              )}
              onPress={async () => {
                if (!(await openInNetflix(item.name))) toast(`Open Netflix and search for “${item.name}”.`);
              }}
            />
          )}
          {buttons.map((b, i) => (
            <TvButton
              key={b.action}
              label={b.label}
              primary={!streaming && i === 0}
              preferred={!streaming && i === 0}
              icon={b.icon}
              busy={busy === b.action}
              onPress={() => run(b.action)}
            />
          ))}
        </View>
      </View>

      <View style={styles.aside}>
        <View style={styles.poster}>
          {item.posterUrl ? (
            <Image source={{ uri: poster ?? item.posterUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <Text style={[T.h1Small, { fontSize: px(56) }]}>{item.name}</Text>
          )}
        </View>
        <Text style={[T.small, { fontSize: px(18) }]}>Poster from TMDB</Text>
      </View>

      <View style={styles.footer}>
        <Text style={styles.tmdb}>TMDB</Text>
        <Text style={[T.small, { flex: 1, fontSize: px(18) }]}>
          This product uses the TMDB API but is not endorsed or certified by TMDB. Scores from OMDb.
        </Text>
        <Text style={T.small}>
          <Text style={T.strong}>Back</Text> Return
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFill, backgroundColor: c.app },
  back: { position: 'absolute', left: SAFE_X, top: SAFE_Y, flexDirection: 'row', alignItems: 'center', gap: px(12) },
  main: { position: 'absolute', left: SAFE_X, top: px(150), width: px(1000), gap: px(26) },
  chip: {
    backgroundColor: c.surface2,
    color: c.text,
    borderRadius: px(999),
    paddingVertical: px(6),
    paddingHorizontal: px(16),
    fontSize: px(20),
    fontFamily: fonts.bodySemi,
    overflow: 'hidden',
  },
  chipRed: {
    backgroundColor: 'rgba(227,48,60,0.18)',
    color: c.redSoftText,
    borderWidth: 1,
    borderColor: 'rgba(227,48,60,0.45)',
    fontFamily: fonts.bodyBold,
  },
  lbl: { ...T.label, marginBottom: px(6) },
  val: { color: c.text, fontFamily: fonts.body, fontSize: px(24) },
  netflix: { color: c.red, fontFamily: fonts.display, letterSpacing: px(1) },
  aside: { position: 'absolute', right: SAFE_X, top: px(170), alignItems: 'flex-end', gap: px(16) },
  poster: {
    width: px(400),
    height: px(600),
    borderRadius: px(20),
    overflow: 'hidden',
    backgroundColor: '#2a3a52',
    justifyContent: 'flex-end',
    padding: px(28),
    boxShadow: `0 ${px(30)}px ${px(80)}px rgba(0,0,0,0.55)`,
  },
  footer: {
    position: 'absolute',
    left: SAFE_X,
    right: SAFE_X,
    bottom: SAFE_Y,
    flexDirection: 'row',
    alignItems: 'center',
    gap: px(20),
  },
  tmdb: {
    backgroundColor: '#0d253f',
    color: '#90cea1',
    fontFamily: fonts.bodyHeavy,
    fontSize: px(18),
    paddingHorizontal: px(10),
    paddingVertical: px(4),
    borderRadius: px(6),
    overflow: 'hidden',
  },
});
