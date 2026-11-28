import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import { QrCode } from '../components/QrCode';
import { formatWatched, shortDate, yearLabel } from '../lib/format';
import { fonts } from '../lib/theme';
import { SAFE_X, SAFE_Y, px } from '../lib/tv';
import type { Action, CardTitle } from '../lib/types';
import { useTitles } from '../state/use-titles';
import { tvColors as c, usePulse } from './focus';
import { EmptyNote, PosterTile, T, TvButton } from './ui';

type GridSection = 'history' | 'hidden' | 'removed';

const COPY: Record<
  GridSection,
  { intro: string; empty: string; action: Action; button: string; hint: string }
> = {
  history: {
    intro: "Everything you've watched, newest first",
    empty: 'Nothing watched yet. Press Watched on any title and it lands here.',
    action: 'unwatched',
    button: 'Move back to Home',
    hint: 'Show rating code',
  },
  hidden: {
    intro: 'Titles you hid from Home. Unhide puts one back.',
    empty: 'Nothing hidden.',
    action: 'unhide',
    button: 'Unhide',
    hint: 'Choose',
  },
  removed: {
    intro: "Picks you said weren't for you. They are never recommended again unless you restore them.",
    empty: 'Nothing removed.',
    action: 'restore',
    button: 'Restore to Explore',
    hint: 'Choose',
  },
};

const COLS = 5;
const GAP = px(28);
const GRID_W = px(1100);
const TILE_W = Math.floor((GRID_W - GAP * (COLS - 1)) / COLS);

/** History, Hidden and Removed: a poster grid with the chosen title's panel on the right. */
export function GridPage({ section }: { section: GridSection }) {
  const copy = COPY[section];
  const list = useTitles({ section, type: null, limit: 40 });
  const [sel, setSel] = useState<CardTitle | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusAction, pulseAction] = usePulse();
  const shown = sel && list.items.some((i) => i.id === sel.id) ? sel : (list.items[0] ?? null);

  const caption = (i: CardTitle) => {
    const when =
      section === 'history'
        ? formatWatched(i.watchedAt).replace(/^Watched /, '')
        : i.statusChangedAt
          ? shortDate(i.statusChangedAt)
          : String(i.year);
    return i.type === 'series' ? `${when} · series` : when;
  };

  const act = async () => {
    if (!shown || busy) return;
    const idx = list.items.findIndex((i) => i.id === shown.id);
    const next = list.items[idx + 1] ?? list.items[idx - 1] ?? null;
    setBusy(true);
    const ok = await list.move(shown, copy.action);
    setBusy(false);
    if (ok) setSel(next);
  };

  const renderItem = useCallback(
    ({ item, index }: { item: CardTitle; index: number }) => (
      <PosterTile
        item={item}
        width={TILE_W}
        caption={caption(item)}
        focusKey={`${section}:${item.id}`}
        preferred={index === 0}
        onFocus={() => setSel(item)}
        onPress={() => {
          setSel(item);
          pulseAction();
        }}
      />
    ),
    // caption only depends on section.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [section, pulseAction],
  );

  return (
    <View style={styles.page}>
      <Text style={[T.small, styles.intro]}>{copy.intro}</Text>

      {list.loading && !list.items.length ? (
        <ActivityIndicator color={c.red} size="large" style={{ marginTop: px(300) }} />
      ) : (
        <FlatList
          style={styles.grid}
          contentContainerStyle={{ padding: px(20), paddingBottom: px(80), gap: GAP }}
          columnWrapperStyle={{ gap: GAP }}
          numColumns={COLS}
          data={list.items}
          keyExtractor={(i) => String(i.id)}
          renderItem={renderItem}
          onEndReached={list.loadMore}
          onEndReachedThreshold={1}
          removeClippedSubviews={false}
          ListEmptyComponent={
            list.error ? (
              <EmptyNote title="Something went wrong" text={list.error} action={{ label: 'Try again', onPress: () => list.load('initial') }} />
            ) : (
              <EmptyNote title="All clear" text={copy.empty} />
            )
          }
        />
      )}

      {shown && (
        <View style={styles.aside}>
          <Text style={T.label}>
            {section === 'history'
              ? formatWatched(shown.watchedAt)
              : section === 'hidden'
                ? 'Hidden from Home'
                : 'Not for me'}
          </Text>
          <Text style={[T.h1, { fontSize: px(72), lineHeight: px(68) }]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6}>
            {shown.name}
          </Text>
          <Text style={T.meta} numberOfLines={2}>
            {[yearLabel(shown.year, shown.endYear, shown.type), shown.genres.join(', '), shown.cast.join(', ')]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {section === 'history' && (
            <View style={styles.qrBox}>
              <View style={styles.qr}>
                <QrCode value={shown.letterboxdUrl} size={px(172)} accessibilityLabel={`QR code that opens ${shown.name} on Letterboxd`} />
              </View>
              <View style={{ flex: 1, gap: px(10) }}>
                <Text style={styles.qrTitle}>Rate it on Letterboxd</Text>
                <Text style={[T.small, { fontSize: px(20), lineHeight: px(28), color: '#c4c4cc' }]}>
                  Scan with your phone to open this {shown.type === 'movie' ? 'film' : 'series'} on Letterboxd. Typing on a TV
                  remote is slow, so rating happens on the phone.
                </Text>
                {shown.rating !== null && (
                  <Text style={[T.small, { color: c.letterboxdText }]}>Your rating: {'★'.repeat(Math.floor(shown.rating))}{shown.rating % 1 ? '½' : ''}</Text>
                )}
              </View>
            </View>
          )}
          <TvButton label={copy.button} preferred={focusAction} busy={busy} onPress={act} focusKey={`${section}:action`} />
        </View>
      )}

      <View style={styles.footer} pointerEvents="none">
        <Text style={T.small}>
          <Text style={T.strong}>OK</Text> {copy.hint}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.app },
  intro: { position: 'absolute', left: SAFE_X, top: px(165), fontSize: px(24), color: '#c4c4cc' },
  grid: { position: 'absolute', left: SAFE_X - px(20), top: px(210), width: GRID_W + px(40), bottom: px(100) },
  aside: {
    position: 'absolute',
    right: SAFE_X,
    top: px(230),
    width: px(560),
    backgroundColor: c.surface,
    borderRadius: px(24),
    padding: px(40),
    gap: px(22),
  },
  qrBox: { flexDirection: 'row', gap: px(26), alignItems: 'center', backgroundColor: c.app, borderRadius: px(18), padding: px(22) },
  qr: { backgroundColor: '#fff', borderRadius: px(12), padding: px(14) },
  qrTitle: { color: c.text, fontFamily: fonts.bodyBold, fontSize: px(26) },
  footer: { position: 'absolute', right: SAFE_X, bottom: SAFE_Y, flexDirection: 'row', gap: px(28) },
});
