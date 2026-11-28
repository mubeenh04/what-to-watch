import { Image } from 'expo-image';
import { memo, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { CheckIcon, DownloadIcon } from '../components/Icons';
import { countTitles } from '../lib/api';
import { shortDate, yearLabel } from '../lib/format';
import { supabase } from '../lib/supabase';
import { fonts } from '../lib/theme';
import { SAFE_X, SAFE_Y, px } from '../lib/tv';
import type { Action, CardTitle, TitleType } from '../lib/types';
import { useAppData } from '../state/app-data';
import { useTitles } from '../state/use-titles';
import { tvColors as c } from './focus';
import { Chip, EmptyNote, T, TvButton } from './ui';

/** Watchlist: titles to download or stream, one row each with Mark downloaded and Watched. */
export function WatchlistPage() {
  const { version } = useAppData();
  const [type, setType] = useState<TitleType>('movie');
  const [counts, setCounts] = useState<Record<TitleType, number | null>>({ movie: null, series: null });
  const list = useTitles({ section: 'watchlist', type, limit: 30 });

  useEffect(() => {
    let live = true;
    Promise.all([countTitles(supabase, 'watchlist', 'movie'), countTitles(supabase, 'watchlist', 'series')])
      .then(([movie, series]) => live && setCounts({ movie, series }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [version]);

  const label = (t: TitleType, name: string) => (counts[t] === null ? name : `${name} · ${counts[t]}`);

  return (
    <View style={styles.page}>
      <View style={styles.bar}>
        <Chip label={label('movie', 'Movies')} on={type === 'movie'} onPress={() => setType('movie')} focusKey="wl:movie" />
        <Chip label={label('series', 'Series')} on={type === 'series'} onPress={() => setType('series')} focusKey="wl:series" />
        <View style={styles.note}>
          <Svg width={px(24)} height={px(24)} viewBox="0 0 24 24" fill="none" stroke={c.dim} strokeWidth={2}>
            <Circle cx="12" cy="12" r="9" />
            <Path d="M12 8v4l3 2" />
          </Svg>
          <Text style={T.small}>Titles move to Home by themselves when Netflix SA adds them</Text>
        </View>
      </View>

      {list.loading && !list.items.length ? (
        <ActivityIndicator color={c.red} size="large" style={{ marginTop: px(120) }} />
      ) : (
        <FlatList
          style={styles.list}
          contentContainerStyle={{ paddingHorizontal: SAFE_X, paddingVertical: px(20), gap: px(20) }}
          data={list.items}
          keyExtractor={(i) => String(i.id)}
          renderItem={({ item, index }) => <Row item={item} first={index === 0} onAction={(a) => list.move(item, a)} />}
          onEndReached={list.loadMore}
          onEndReachedThreshold={1}
          removeClippedSubviews={false}
          ListEmptyComponent={
            list.error ? (
              <EmptyNote title="Something went wrong" text={list.error} action={{ label: 'Try again', onPress: () => list.load('initial') }} />
            ) : (
              <EmptyNote title="All clear" text="Nothing to get right now. Add titles from Explore." />
            )
          }
        />
      )}

      <View style={styles.hints} pointerEvents="none">
        <Text style={T.small}>
          <Text style={T.strong}>◀▶</Text> Choose action
        </Text>
        <Text style={T.small}>
          <Text style={T.strong}>▲▼</Text> Titles
        </Text>
        <Text style={T.small}>
          <Text style={T.strong}>OK</Text> Do it
        </Text>
      </View>
    </View>
  );
}

const Row = memo(function Row({
  item,
  first,
  onAction,
}: {
  item: CardTitle;
  first: boolean;
  onAction: (a: Action) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState<Action | null>(null);
  const run = async (a: Action) => {
    setBusy(a);
    const ok = await onAction(a);
    if (!ok) setBusy(null);
  };
  const added = item.statusChangedAt ? `Added ${shortDate(item.statusChangedAt)}` : 'On your Watchlist';
  const status = [added, item.release ? item.release.label : 'not on Netflix SA', item.release?.detail].filter(Boolean).join(' · ');

  return (
    <View style={styles.row}>
      <View style={styles.thumb}>
        {item.posterUrl ? <Image source={{ uri: item.posterUrl }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      </View>
      <View style={{ flex: 1, gap: px(10) }}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        <View style={{ flexDirection: 'row', gap: px(16), alignItems: 'center' }}>
          <Text style={T.meta}>
            {yearLabel(item.year, item.endYear, item.type)}
            {item.genres.length ? ` · ${item.genres.join(', ')}` : ''}
          </Text>
          <View style={styles.mini}>
            <Text style={styles.imdb}>IMDb</Text>
            <Text style={styles.miniText}>{item.imdb === null ? '–' : item.imdb.toFixed(1)}</Text>
          </View>
          <View style={styles.mini}>
            <View style={[styles.mc, item.metacritic === null && { backgroundColor: c.surface2 }]}>
              <Text style={[styles.mcText, item.metacritic === null && { color: c.dim }]}>{item.metacritic ?? '–'}</Text>
            </View>
            <Text style={styles.miniText}>Metacritic</Text>
          </View>
        </View>
        <Text style={[T.small, { fontSize: px(20) }]} numberOfLines={1}>
          {status}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: px(14) }}>
        <TvButton
          label="Mark downloaded"
          preferred={first}
          focusKey={`wl:${item.id}:dl`}
          busy={busy === 'downloaded'}
          icon={(col) => <DownloadIcon size={px(26)} color={col} />}
          onPress={() => run('downloaded')}
        />
        <TvButton
          label="Watched"
          focusKey={`wl:${item.id}:w`}
          busy={busy === 'watched'}
          icon={(col) => <CheckIcon size={px(24)} color={col} />}
          onPress={() => run('watched')}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.app },
  bar: {
    position: 'absolute',
    top: px(170),
    left: SAFE_X,
    right: SAFE_X,
    flexDirection: 'row',
    alignItems: 'center',
    gap: px(14),
  },
  note: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: px(12) },
  list: { position: 'absolute', top: px(250), left: 0, right: 0, bottom: px(110) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: px(32),
    paddingVertical: px(20),
    paddingLeft: px(20),
    paddingRight: px(28),
    borderRadius: px(20),
    backgroundColor: '#222226',
  },
  thumb: { width: px(120), height: px(180), borderRadius: px(12), overflow: 'hidden', backgroundColor: c.surface2 },
  name: { color: c.text, fontFamily: fonts.display, fontSize: px(44), textTransform: 'uppercase' },
  mini: { flexDirection: 'row', alignItems: 'center', gap: px(8) },
  miniText: { color: c.text, fontFamily: fonts.bodyBold, fontSize: px(22) },
  imdb: {
    backgroundColor: c.imdb,
    color: '#000',
    fontFamily: fonts.display,
    fontSize: px(17),
    borderRadius: px(5),
    paddingHorizontal: px(7),
    overflow: 'hidden',
  },
  mc: { backgroundColor: '#4fbf7a', borderRadius: px(5), width: px(32), height: px(26), alignItems: 'center', justifyContent: 'center' },
  mcText: { color: '#0b1a10', fontFamily: fonts.bodyHeavy, fontSize: px(16) },
  hints: { position: 'absolute', right: SAFE_X, bottom: SAFE_Y, flexDirection: 'row', gap: px(28) },
});
