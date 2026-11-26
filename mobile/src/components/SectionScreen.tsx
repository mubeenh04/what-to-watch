import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { countTitles, type Section } from '../lib/api';
import { activeFilterCount, RELEASE_LABELS } from '../lib/format';
import { supabase } from '../lib/supabase';
import { colors, fonts } from '../lib/theme';
import { emptyFilters, type HomeFilters, type TitleType } from '../lib/types';
import { useAppData } from '../state/app-data';
import { AboutSheet } from './AboutSheet';
import { FilterSheet, hasFilterFields } from './FilterSheet';
import { CloseIcon, FilterIcon, SearchIcon, UserIcon } from './Icons';
import { Pager, type PagerHandle } from './Pager';
import type { CardKind } from './TitleCard';
import { TitleList } from './TitleList';

export type TabDef = { key: string; label: string; section: Section; type: TitleType | null; kind: CardKind };

type Props = {
  page: 'home' | 'explore' | 'watchlist';
  subtitle?: string;
  tabs: TabDef[];
};

export function SectionScreen({ page, subtitle, tabs }: Props) {
  const insets = useSafeAreaInsets();
  const { version, filters: allFilters, setFilters: setPageFilters, genres, catalogue } = useAppData();
  const [tabIndex, setTabIndex] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const pager = useRef<PagerHandle>(null);
  const tab = tabs[tabIndex] ?? tabs[0];
  const hasSearch = page === 'home';
  const hasFilters = hasFilterFields(page, !!catalogue?.hasReleaseStatus);
  const filters = allFilters[page];
  const setFilters = useCallback((f: HomeFilters) => setPageFilters(page, f), [page, setPageFilters]);
  const nFilters = hasFilters ? activeFilterCount(filters) : 0;

  // Search as you type, once typing pauses.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchText.trim()), 300);
    return () => clearTimeout(t);
  }, [searchText]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      tabs.map((t) => countTitles(supabase, t.section, t.type, filtersFor(t), search || undefined).catch(() => null)),
    ).then((ns) => {
      if (cancelled) return;
      const next: Record<string, number> = {};
      tabs.forEach((t, i) => {
        if (ns[i] !== null) next[t.key] = ns[i]!;
      });
      setCounts(next);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, version, filters, search]);

  /** History has no filters of its own; everything else on the page shares the page's filters. */
  function filtersFor(t: TabDef): HomeFilters | undefined {
    return hasFilters && t.section !== 'history' ? filters : undefined;
  }

  const goTo = (i: number) => {
    setTabIndex(i);
    pager.current?.setPage(i);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.appbar}>
        {page === 'home' ? (
          <Text style={styles.brand} accessibilityRole="header">
            WHAT TO <Text style={{ color: colors.red }}>WATCH</Text>
          </Text>
        ) : (
          <Text style={styles.brand} accessibilityRole="header">
            {page.toUpperCase()}
          </Text>
        )}
        <View style={styles.appbarBtns}>
          {hasFilters && (
            <IconButton label="Filters" onPress={() => setSheetOpen(true)} badge={nFilters || undefined}>
              <FilterIcon color={colors.text} />
            </IconButton>
          )}
          <IconButton label="Account and about" onPress={() => setAboutOpen(true)}>
            <UserIcon color={colors.text} />
          </IconButton>
        </View>
      </View>
      {subtitle && <Text style={styles.sub}>{subtitle}</Text>}

      {hasSearch && (
        <View style={styles.search}>
          <SearchIcon color={colors.muted} />
          <TextInput
            style={styles.searchInput}
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search titles or actors"
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="never"
            accessibilityLabel="Search"
          />
          {searchText.length > 0 && (
            <Pressable
              hitSlop={10}
              onPress={() => setSearchText('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <View style={styles.clear}>
                <CloseIcon size={9} color={colors.app} />
              </View>
            </Pressable>
          )}
        </View>
      )}

      <View style={styles.tabs} accessibilityRole="tablist">
        {tabs.map((t, i) => {
          const selected = i === tabIndex;
          return (
            <Pressable
              key={t.key}
              style={styles.tab}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => goTo(i)}
            >
              <Text style={[styles.tabText, selected && styles.tabTextOn]}>{t.label.toUpperCase()}</Text>
              {counts[t.key] !== undefined && (
                <View style={[styles.count, selected && styles.countOn]}>
                  <Text style={[styles.countText, selected && styles.countTextOn]}>{formatCount(counts[t.key])}</Text>
                </View>
              )}
              {selected && <View style={styles.tabLine} />}
            </Pressable>
          );
        })}
      </View>

      {nFilters > 0 && tab.section !== 'history' && (
        <ActiveFilters filters={filters} genres={genres} onChange={setFilters} />
      )}

      <Pager
        ref={pager}
        onPageSelected={setTabIndex}
        pages={tabs.map((t) => (
          <TitleList
            key={t.key}
            section={t.section}
            type={t.type}
            kind={t.kind}
            filters={filtersFor(t)}
            search={hasSearch ? search : undefined}
            hasActiveFilters={!!filtersFor(t) && nFilters > 0}
            onClearFilters={() => setFilters(emptyFilters)}
          />
        ))}
      />

      <AboutSheet visible={aboutOpen} onClose={() => setAboutOpen(false)} />
      {hasFilters && (
        <FilterSheet
          visible={sheetOpen}
          onClose={() => setSheetOpen(false)}
          page={page}
          type={tab.section === 'history' ? null : tab.type}
          search={hasSearch ? search : undefined}
        />
      )}
    </View>
  );
}

const formatCount = (n: number) => (n >= 10000 ? `${Math.floor(n / 1000)}k` : n.toLocaleString('en-ZA'));

function IconButton({
  label,
  onPress,
  badge,
  children,
}: {
  label: string;
  onPress: () => void;
  badge?: number;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.iconbtn, pressed && { opacity: 0.7 }]}
    >
      {children}
      {badge !== undefined && (
        <View style={styles.dot}>
          <Text style={styles.dotText}>{badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

function ActiveFilters({
  filters,
  genres,
  onChange,
}: {
  filters: HomeFilters;
  genres: { genre_id: number; name: string }[];
  onChange: (f: HomeFilters) => void;
}) {
  const chips: { key: string; label: string; clear: () => HomeFilters }[] = [];
  if (filters.yearFrom !== null || filters.yearTo !== null)
    chips.push({
      key: 'year',
      label: `${filters.yearFrom ?? 'Any'}–${filters.yearTo ?? 'now'}`,
      clear: () => ({ ...filters, yearFrom: null, yearTo: null }),
    });
  for (const id of filters.genreIds)
    chips.push({
      key: 'g' + id,
      label: genres.find((g) => g.genre_id === id)?.name ?? 'Genre',
      clear: () => ({ ...filters, genreIds: filters.genreIds.filter((g) => g !== id) }),
    });
  if (filters.location !== 'all')
    chips.push({
      key: 'loc',
      label: filters.location === 'local' ? 'Local drive' : 'Streaming',
      clear: () => ({ ...filters, location: 'all' }),
    });
  if (filters.imdbMin > 0)
    chips.push({ key: 'imdb', label: `IMDb ${filters.imdbMin}+`, clear: () => ({ ...filters, imdbMin: 0 }) });
  for (const r of filters.releaseStatuses)
    chips.push({
      key: 'r' + r,
      label: r === 'unknown' ? 'Release not known' : RELEASE_LABELS[r],
      clear: () => ({ ...filters, releaseStatuses: filters.releaseStatuses.filter((x) => x !== r) }),
    });
  if (filters.metacriticMin > 0)
    chips.push({
      key: 'mc',
      label: `Metacritic ${filters.metacriticMin}+`,
      clear: () => ({ ...filters, metacriticMin: 0 }),
    });

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.activebar}
      contentContainerStyle={styles.activebarInner}
    >
      {chips.map((c) => (
        <View key={c.key} style={styles.achip}>
          <Text style={styles.achipText}>{c.label}</Text>
          <Pressable
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${c.label}`}
            onPress={() => onChange(c.clear())}
          >
            <CloseIcon color={colors.redSoftText} />
          </Pressable>
        </View>
      ))}
      {chips.length > 1 && (
        <Pressable style={[styles.achip, styles.achipClear]} onPress={() => onChange(emptyFilters)}>
          <Text style={[styles.achipText, { color: colors.muted }]}>Clear all</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.app },
  appbar: {
    paddingTop: 6,
    paddingHorizontal: 18,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  appbarBtns: { flexDirection: 'row', gap: 8 },
  brand: { color: colors.text, fontFamily: fonts.display, fontSize: 30, letterSpacing: 0.6 },
  iconbtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: colors.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotText: { color: '#fff', fontFamily: fonts.bodyBold, fontSize: 11 },
  sub: {
    marginTop: 4,
    marginHorizontal: 18,
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
  },
  tabs: {
    flexDirection: 'row',
    marginTop: 12,
    marginHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 12,
    paddingBottom: 11,
  },
  tabText: { color: colors.muted, fontFamily: fonts.display, fontSize: 15, letterSpacing: 1.2 },
  tabTextOn: { color: colors.text },
  tabLine: {
    position: 'absolute',
    left: '18%',
    right: '18%',
    bottom: -1,
    height: 3,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    backgroundColor: colors.red,
  },
  count: { backgroundColor: colors.surface2, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1 },
  countOn: { backgroundColor: colors.redTint },
  countText: { color: colors.muted, fontFamily: fonts.bodySemi, fontSize: 11 },
  countTextOn: { color: '#ff8a92' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    marginHorizontal: 18,
    paddingHorizontal: 12,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, color: colors.text, fontFamily: fonts.body, fontSize: 15, paddingVertical: 0 },
  clear: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activebar: { flexGrow: 0, flexShrink: 0 },
  activebarInner: { gap: 6, paddingTop: 12, paddingBottom: 2, paddingHorizontal: 18 },
  achip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.redTint,
    borderWidth: 1,
    borderColor: colors.redTintBorder,
    borderRadius: 999,
    paddingVertical: 5,
    paddingLeft: 11,
    paddingRight: 9,
  },
  achipClear: { backgroundColor: 'transparent', borderColor: colors.line, paddingRight: 11 },
  achipText: { color: colors.redSoftText, fontFamily: fonts.bodySemi, fontSize: 12 },
});
