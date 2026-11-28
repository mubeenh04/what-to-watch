import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { posterAtSize, yearLabel } from '../lib/format';
import { fonts } from '../lib/theme';
import { SAFE_X, px } from '../lib/tv';
import type { CardTitle } from '../lib/types';
import { useAppData } from '../state/app-data';
import { useTitles } from '../state/use-titles';
import { tvColors as c } from './focus';
import { PosterRow } from './PosterRow';
import type { OpenDetails } from './TvApp';
import { ImdbBadge, MetacriticBadge, T, TvButton, WhereBadge } from './ui';

const LIMIT = 30;

/** Home: the focused title large at the top, then a row of movies and a row of series. */
export function HomePage({
  openDetails,
  search,
  searchOpen,
  onSearch,
  onCloseSearch,
}: {
  openDetails: OpenDetails;
  search: string;
  searchOpen: boolean;
  onSearch: (q: string) => void;
  onCloseSearch: () => void;
}) {
  const { filters } = useAppData();
  const f = filters.home;
  const movies = useTitles({ section: 'home', type: 'movie', filters: f, search, limit: LIMIT });
  const series = useTitles({ section: 'home', type: 'series', filters: f, search, limit: LIMIT });
  const [spot, setSpot] = useState<CardTitle | null>(null);
  const [draft, setDraft] = useState(search);

  // Until something is focused, show the first movie.
  const first = movies.items[0] ?? series.items[0] ?? null;
  const shown = spot && [...movies.items, ...series.items].some((i) => i.id === spot.id) ? spot : first;

  useEffect(() => {
    if (!searchOpen) setDraft('');
  }, [searchOpen]);

  const onFocusItem = useCallback((item: CardTitle) => setSpot(item), []);
  const openMovie = useCallback((item: CardTitle) => openDetails(item, movies.move), [openDetails, movies.move]);
  const openSeries = useCallback((item: CardTitle) => openDetails(item, series.move), [openDetails, series.move]);

  const subtitle = search ? `Matching “${search}”` : 'On Netflix SA or your drive';

  return (
    <View style={styles.page}>
      {shown && <Backdrop item={shown} />}

      <View style={styles.spot}>
        {searchOpen ? (
          <View style={{ gap: px(22) }}>
            <Text style={T.label}>Search Home</Text>
            <TextInput
              autoFocus
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={() => onSearch(draft.trim())}
              returnKeyType="search"
              placeholder="Title or actor"
              placeholderTextColor={c.dim}
              style={styles.search}
            />
            <View style={{ flexDirection: 'row', gap: px(16) }}>
              <TvButton label="Search" primary onPress={() => onSearch(draft.trim())} />
              <TvButton label={search ? 'Clear search' : 'Cancel'} onPress={onCloseSearch} />
            </View>
          </View>
        ) : shown ? (
          <Spotlight item={shown} />
        ) : null}
      </View>

      <ScrollView style={styles.rows} contentContainerStyle={{ paddingBottom: px(80) }} showsVerticalScrollIndicator={false}>
        <PosterRow
          rowKey="home-movies"
          title="Movies ready to watch"
          subtitle={subtitle}
          items={movies.items}
          loading={movies.loading}
          error={movies.error}
          emptyText={search ? 'No movies match.' : 'No movies here yet. Titles on Netflix or your drives show up here.'}
          onRetry={() => movies.load('initial')}
          onEndReached={movies.loadMore}
          onFocusItem={onFocusItem}
          onPressItem={openMovie}
          showWhere
          focusFirst={!searchOpen && !search}
        />
        <PosterRow
          rowKey="home-series"
          title="Series ready to watch"
          subtitle={subtitle}
          items={series.items}
          loading={series.loading}
          error={series.error}
          emptyText={search ? 'No series match.' : 'No series here yet.'}
          onRetry={() => series.load('initial')}
          onEndReached={series.loadMore}
          onFocusItem={onFocusItem}
          onPressItem={openSeries}
          showWhere
        />
      </ScrollView>

      <View style={styles.hints} pointerEvents="none">
        <Text style={T.small}>
          <Text style={T.strong}>OK</Text> Details
        </Text>
        <Text style={T.small}>
          <Text style={T.strong}>▲▼</Text> Rows
        </Text>
      </View>
    </View>
  );
}

/** The poster, large and faded into the background on the right (TMDB has it; we have no backdrops yet). */
export function Backdrop({ item }: { item: CardTitle }) {
  const uri = posterAtSize(item.posterUrl, 'w780');
  return (
    <View style={styles.backdrop} pointerEvents="none">
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" transition={250} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#2a3a52' }]} />
      )}
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundImage: `linear-gradient(90deg, ${c.app} 0%, rgba(27,27,30,0.85) 25%, rgba(27,27,30,0) 60%), linear-gradient(0deg, ${c.app} 0%, rgba(27,27,30,0) 40%)`,
          },
        ]}
      />
    </View>
  );
}

function Spotlight({ item }: { item: CardTitle }) {
  const meta = [item.type === 'movie' ? 'MOVIE' : 'SERIES', yearLabel(item.year, item.endYear, item.type), item.genres.join(', ').toUpperCase()]
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={{ gap: px(22) }}>
      <Text style={T.meta}>{meta}</Text>
      <Text style={T.h1} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
        {item.name}
      </Text>
      <View style={{ flexDirection: 'row', gap: px(14), alignItems: 'center' }}>
        <ImdbBadge score={item.imdb} />
        <MetacriticBadge score={item.metacritic} />
        <WhereBadge item={item} />
      </View>
      <Text style={T.body} numberOfLines={3}>
        {item.synopsis}
      </Text>
      {item.cast.length > 0 && (
        <Text style={T.small}>
          Starring <Text style={{ color: c.text }}>{item.cast.join(', ')}</Text>
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.app },
  backdrop: { position: 'absolute', right: 0, top: 0, width: px(1300), height: px(780) },
  spot: { position: 'absolute', left: SAFE_X, top: px(170), width: px(900) },
  rows: { position: 'absolute', left: 0, right: 0, top: px(600), bottom: 0 },
  search: {
    backgroundColor: c.surface2,
    color: c.text,
    fontFamily: fonts.bodySemi,
    fontSize: px(34),
    borderRadius: px(16),
    paddingHorizontal: px(28),
    paddingVertical: px(18),
  },
  hints: { position: 'absolute', right: SAFE_X, bottom: px(40), flexDirection: 'row', gap: px(28) },
});
