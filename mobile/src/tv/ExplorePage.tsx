import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { CheckIcon, CloseIcon, PlusIcon } from '../components/Icons';
import { yearLabel } from '../lib/format';
import { SAFE_X, px } from '../lib/tv';
import type { Action, CardTitle, TitleType } from '../lib/types';
import { useAppData } from '../state/app-data';
import { useTitles } from '../state/use-titles';
import { tvColors as c, usePulse } from './focus';
import { Backdrop } from './HomePage';
import { PosterRow } from './PosterRow';
import { ImdbBadge, MetacriticBadge, T, TvButton } from './ui';

const LIMIT = 30;

/**
 * Explore: recommendations that aren't on Netflix SA or a drive. The focused poster fills the top
 * with why it's suggested; OK on a poster jumps up to its buttons.
 */
export function ExplorePage() {
  const { filters } = useAppData();
  const f = filters.explore;
  const movies = useTitles({ section: 'explore', type: 'movie', filters: f, limit: LIMIT });
  const series = useTitles({ section: 'explore', type: 'series', filters: f, limit: LIMIT });
  const [sel, setSel] = useState<CardTitle | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [focusButtons, pulseButtons] = usePulse();

  const lists: Record<TitleType, ReturnType<typeof useTitles>> = { movie: movies, series };
  const all = [...movies.items, ...series.items];
  const shown = sel && all.some((i) => i.id === sel.id) ? sel : (movies.items[0] ?? series.items[0] ?? null);

  const onFocusItem = useCallback((item: CardTitle) => setSel(item), []);
  const onPressItem = useCallback(
    (item: CardTitle) => {
      setSel(item);
      pulseButtons();
    },
    [pulseButtons],
  );

  const act = async (action: Action) => {
    if (!shown || busy) return;
    const list = lists[shown.type];
    const idx = list.items.findIndex((i) => i.id === shown.id);
    const next = list.items[idx + 1] ?? list.items[idx - 1] ?? null;
    setBusy(action);
    const ok = await list.move(shown, action);
    setBusy(null);
    if (ok) setSel(next);
  };

  return (
    <View style={styles.page}>
      {shown && <Backdrop item={shown} />}

      {shown && (
        <View style={styles.hero}>
          {shown.reason ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: px(12) }}>
              <Svg width={px(24)} height={px(24)} viewBox="0 0 24 24" fill="none" stroke={c.redSoftText} strokeWidth={2}>
                <Path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z" />
              </Svg>
              <Text style={[T.meta, { color: c.redSoftText }]}>{shown.reason}</Text>
            </View>
          ) : null}
          <Text style={[T.h1, { fontSize: px(88), lineHeight: px(92) }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
            {shown.name}
          </Text>
          <View style={{ flexDirection: 'row', gap: px(14), alignItems: 'center', flexWrap: 'wrap' }}>
            <Text style={T.meta}>
              {yearLabel(shown.year, shown.endYear, shown.type)}
              {shown.genres.length ? ` · ${shown.genres.join(', ')}` : ''}
            </Text>
            <ImdbBadge score={shown.imdb} />
            <MetacriticBadge score={shown.metacritic} />
            <Text style={T.meta}>{shown.release ? shown.release.label : 'Not on Netflix SA or your drive'}</Text>
          </View>
          <Text style={[T.body, { fontSize: px(24), lineHeight: px(35) }]} numberOfLines={2}>
            {shown.synopsis}
          </Text>
          <View style={{ flexDirection: 'row', gap: px(18), marginTop: px(6) }}>
            <TvButton
              label="Add to Watchlist"
              primary
              preferred={focusButtons}
              focusKey="explore:add"
              busy={busy === 'watchlist'}
              icon={(col) => <PlusIcon size={px(28)} color={col} />}
              onPress={() => act('watchlist')}
            />
            <TvButton
              label="Watched"
              focusKey="explore:watched"
              busy={busy === 'watched'}
              icon={(col) => <CheckIcon size={px(26)} color={col} />}
              onPress={() => act('watched')}
            />
            <TvButton
              label="Not for me"
              focusKey="explore:remove"
              busy={busy === 'remove'}
              icon={(col) => <CloseIcon size={px(20)} color={col} />}
              onPress={() => act('remove')}
            />
          </View>
          <Text style={[T.small, { fontSize: px(18) }]}>Not for me moves it to Removed so it never comes back.</Text>
        </View>
      )}

      <ScrollView style={styles.rows} contentContainerStyle={{ paddingBottom: px(80) }} showsVerticalScrollIndicator={false}>
        <PosterRow
          rowKey="explore-movies"
          title="Picks for you · Movies"
          items={movies.items}
          loading={movies.loading}
          error={movies.error}
          emptyText="You've gone through every movie pick. New ones show up here."
          onRetry={() => movies.load('initial')}
          onEndReached={movies.loadMore}
          onFocusItem={onFocusItem}
          onPressItem={onPressItem}
          focusFirst
        />
        <PosterRow
          rowKey="explore-series"
          title="Picks for you · Series"
          items={series.items}
          loading={series.loading}
          error={series.error}
          emptyText="You've gone through every series pick."
          onRetry={() => series.load('initial')}
          onEndReached={series.loadMore}
          onFocusItem={onFocusItem}
          onPressItem={onPressItem}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.app },
  hero: { position: 'absolute', left: SAFE_X, top: px(160), width: px(1100), gap: px(16) },
  rows: { position: 'absolute', left: 0, right: 0, top: px(700), bottom: 0 },
});
