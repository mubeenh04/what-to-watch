import Slider from '@react-native-community/slider';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { countTitles, hiddenCount, unhideAll } from '../lib/api';
import { supabase } from '../lib/supabase';
import { colors, fonts } from '../lib/theme';
import { RELEASE_LABELS } from '../lib/format';
import { emptyFilters, type LocationFilter, type ReleaseFilter, type TitleType } from '../lib/types';
import { useAppData, type FilterPage } from '../state/app-data';
import { useToast } from '../state/toast';
import { BottomSheet } from './BottomSheet';
import { DriveIcon, MetacriticIcon, ScreenIcon } from './Icons';

type Props = { visible: boolean; onClose: () => void; page: FilterPage; type: TitleType | null; search?: string };

type Fields = { year: boolean; genre: boolean; location: boolean; scores: boolean; release: boolean; hidden: boolean };

/** Which filters each page offers. Location is Home only; release status is Explore and Watchlist only. */
export function filterFields(page: FilterPage, hasRelease: boolean): Fields {
  switch (page) {
    case 'home':
      return { year: true, genre: true, location: true, scores: true, release: false, hidden: true };
    case 'explore':
      return { year: true, genre: true, location: false, scores: true, release: hasRelease, hidden: false };
    default:
      return { year: false, genre: false, location: false, scores: false, release: hasRelease, hidden: false };
  }
}

export const hasFilterFields = (page: FilterPage, hasRelease: boolean) =>
  Object.values(filterFields(page, hasRelease)).some(Boolean);

const RELEASE_OPTIONS: { key: ReleaseFilter; label: string }[] = [
  { key: 'upcoming', label: RELEASE_LABELS.upcoming },
  { key: 'premiered', label: RELEASE_LABELS.premiered },
  { key: 'in_cinemas', label: RELEASE_LABELS.in_cinemas },
  { key: 'digital', label: RELEASE_LABELS.digital },
  { key: 'physical', label: RELEASE_LABELS.physical },
  { key: 'on_tv', label: RELEASE_LABELS.on_tv },
  { key: 'unknown', label: 'Not known' },
];

/** Filters for one page: year, genre, location (Home only), and minimum IMDb and Metacritic scores. Applies live. */
export function FilterSheet({ visible, onClose, page, type, search }: Props) {
  const { filters, setFilters: setPageFilters, genres, catalogue, version, userId, bump } = useAppData();
  const f = filters[page];
  const setFilters = (next: typeof f) => setPageFilters(page, next);
  const show = filterFields(page, !!catalogue?.hasReleaseStatus);
  const toast = useToast();
  const [resultCount, setResultCount] = useState<number | null>(null);
  const [hidden, setHidden] = useState(0);

  const minYear = catalogue?.minYear ?? 1900;
  const maxYear = catalogue?.maxYear ?? new Date().getFullYear();
  const from = f.yearFrom ?? minYear;
  const to = f.yearTo ?? maxYear;

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const t = setTimeout(() => {
      countTitles(supabase, page, type, f, search)
        .then((n) => !cancelled && setResultCount(n))
        .catch(() => !cancelled && setResultCount(null));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [visible, f, type, version, page, search]);

  useEffect(() => {
    if (visible && show.hidden)
      hiddenCount(supabase)
        .then(setHidden)
        .catch(() => {});
  }, [visible, version, show.hidden]);

  const setYears = (a: number, b: number) =>
    setFilters({ ...f, yearFrom: a <= minYear ? null : a, yearTo: b >= maxYear ? null : b });

  const toggleGenre = (id: number) =>
    setFilters({ ...f, genreIds: f.genreIds.includes(id) ? f.genreIds.filter((g) => g !== id) : [...f.genreIds, id] });

  const noun =
    type === 'movie'
      ? resultCount === 1
        ? 'movie'
        : 'movies'
      : type === 'series'
        ? 'series'
        : resultCount === 1
          ? 'title'
          : 'titles';

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      header={
        <View style={styles.head}>
          <Text style={styles.h2}>FILTERS</Text>
          <Pressable hitSlop={8} onPress={() => setFilters(emptyFilters)}>
            <Text style={styles.link}>Reset</Text>
          </Pressable>
        </View>
      }
      footer={
        <Pressable style={({ pressed }) => [styles.primary, pressed && { opacity: 0.8 }]} onPress={onClose}>
          <Text style={styles.primaryText}>
            {resultCount === null ? 'Show results' : `Show ${resultCount.toLocaleString('en-ZA')} ${noun}`}
          </Text>
        </Pressable>
      }
    >
      <ScrollView contentContainerStyle={styles.body}>
        {show.release && (
          <Group label="Release">
            <View style={styles.chips}>
              {RELEASE_OPTIONS.map((o) => {
                const on = f.releaseStatuses.includes(o.key);
                return (
                  <Pressable
                    key={o.key}
                    onPress={() =>
                      setFilters({
                        ...f,
                        releaseStatuses: on ? f.releaseStatuses.filter((r) => r !== o.key) : [...f.releaseStatuses, o.key],
                      })
                    }
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={[styles.chip, on && styles.chipOn]}
                  >
                    <Text style={styles.chipText}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Group>
        )}

        {show.year && (
          <Group label="Year" value={`${from}–${to}`}>
            <Text style={styles.sliderLabel}>From</Text>
            <Slider
              minimumValue={minYear}
              maximumValue={maxYear}
              step={1}
              value={from}
              onSlidingComplete={(v) => setYears(Math.round(v), Math.max(Math.round(v), to))}
              {...sliderColors}
              accessibilityLabel="From year"
            />
            <Text style={styles.sliderLabel}>To</Text>
            <Slider
              minimumValue={minYear}
              maximumValue={maxYear}
              step={1}
              value={to}
              onSlidingComplete={(v) => setYears(Math.min(from, Math.round(v)), Math.round(v))}
              {...sliderColors}
              accessibilityLabel="To year"
            />
          </Group>
        )}

        {show.genre && (
          <Group label="Genre">
            <View style={styles.chips}>
              {genres.map((g) => {
                const on = f.genreIds.includes(g.genre_id);
                return (
                  <Pressable
                    key={g.genre_id}
                    onPress={() => toggleGenre(g.genre_id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={[styles.chip, on && styles.chipOn]}
                  >
                    <Text style={styles.chipText}>{g.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Group>
        )}

        {show.location && (
          <Group label="Location">
            <View style={styles.seg}>
              {(
                [
                  ['all', 'All', null],
                  [
                    'streaming',
                    'Streaming',
                    <ScreenIcon key="s" color={f.location === 'streaming' ? colors.text : colors.muted} />,
                  ],
                  [
                    'local',
                    'Local drive',
                    <DriveIcon key="d" size={15} color={f.location === 'local' ? colors.text : colors.muted} />,
                  ],
                ] as [LocationFilter, string, React.ReactNode][]
              ).map(([key, label, icon]) => {
                const on = f.location === key;
                return (
                  <Pressable
                    key={key}
                    style={[styles.segBtn, on && styles.segBtnOn]}
                    onPress={() => setFilters({ ...f, location: key })}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    {icon}
                    <Text style={[styles.segText, on && { color: colors.text }]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Group>
        )}

        {show.scores && (
          <>
            <Group
              label={
                <View style={styles.scoreLabel}>
                  <View style={styles.imdbBadge}>
                    <Text style={styles.imdbText}>IMDb</Text>
                  </View>
                  <Text style={styles.label}>MINIMUM</Text>
                </View>
              }
              value={
                catalogue?.hasImdb === false ? 'Not available yet' : f.imdbMin > 0 ? `${f.imdbMin.toFixed(1)}+` : 'Any'
              }
            >
              <Slider
                minimumValue={0}
                maximumValue={9}
                step={0.5}
                value={f.imdbMin}
                disabled={catalogue?.hasImdb === false}
                onSlidingComplete={(v) => setFilters({ ...f, imdbMin: v })}
                {...sliderColors}
                accessibilityLabel="Minimum IMDb score"
              />
            </Group>

            <Group
              label={
                <View style={styles.scoreLabel}>
                  <MetacriticIcon size={16} />
                  <Text style={styles.label}>METACRITIC MINIMUM</Text>
                </View>
              }
              value={
                catalogue?.hasMetacritic === false
                  ? 'Not available yet'
                  : f.metacriticMin > 0
                    ? `${f.metacriticMin}+`
                    : 'Any'
              }
            >
              <Slider
                minimumValue={0}
                maximumValue={100}
                step={5}
                value={f.metacriticMin}
                disabled={catalogue?.hasMetacritic === false}
                onSlidingComplete={(v) => setFilters({ ...f, metacriticMin: v })}
                {...sliderColors}
                accessibilityLabel="Minimum Metacritic score"
              />
            </Group>
            {(catalogue?.hasImdb === false || catalogue?.hasMetacritic === false) && (
              <Text style={styles.note}>Scores haven't been loaded yet, so the score filters are off for now.</Text>
            )}
            {(f.imdbMin > 0 || f.metacriticMin > 0) && (
              <Text style={styles.note}>Titles without a score are left out while a minimum is set.</Text>
            )}
          </>
        )}

        {show.hidden && hidden > 0 && (
          <View style={styles.hiddenRow}>
            <Text style={styles.hiddenText}>
              {hidden} hidden {hidden === 1 ? 'title' : 'titles'}
            </Text>
            <Pressable
              style={styles.hiddenBtn}
              onPress={async () => {
                try {
                  const n = await unhideAll(supabase, userId);
                  setHidden(0);
                  bump();
                  toast(`${n} ${n === 1 ? 'title is' : 'titles are'} back on Home`);
                } catch {
                  toast("Couldn't show hidden titles. Try again.", { error: true });
                }
              }}
            >
              <Text style={styles.hiddenBtnText}>Show again</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const sliderColors = {
  minimumTrackTintColor: colors.red,
  maximumTrackTintColor: colors.line,
  thumbTintColor: colors.red,
};

function Group({ label, value, children }: { label: React.ReactNode; value?: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <View style={styles.labelRow}>
        {typeof label === 'string' ? <Text style={styles.label}>{label.toUpperCase()}</Text> : label}
        {value && <Text style={styles.value}>{value}</Text>}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  h2: { color: colors.text, fontFamily: fonts.display, fontSize: 26, letterSpacing: 0.8 },
  link: { color: colors.red, fontFamily: fonts.bodyBold, fontSize: 14 },
  body: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12, gap: 22 },
  group: { gap: 8 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { color: colors.muted, fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.3 },
  value: { color: colors.text, fontFamily: fonts.bodySemi, fontSize: 13, fontVariant: ['tabular-nums'] },
  sliderLabel: { color: colors.muted, fontFamily: fonts.body, fontSize: 12, marginBottom: -4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  chipOn: { backgroundColor: colors.red, borderColor: colors.red },
  chipText: { color: colors.text, fontFamily: fonts.bodySemi, fontSize: 13 },
  seg: {
    flexDirection: 'row',
    backgroundColor: colors.surface2,
    borderRadius: 11,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.line,
  },
  segBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 8,
    paddingVertical: 9,
  },
  segBtnOn: { backgroundColor: colors.app },
  segText: { color: colors.muted, fontFamily: fonts.bodySemi, fontSize: 13 },
  scoreLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  imdbBadge: { backgroundColor: colors.imdb, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2 },
  imdbText: { color: '#000', fontFamily: fonts.display, fontSize: 11, lineHeight: 12 },
  note: { color: colors.muted, fontFamily: fonts.body, fontSize: 12, lineHeight: 17, marginTop: -12 },
  hiddenRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 11,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  hiddenText: { color: colors.text, fontFamily: fonts.body, fontSize: 13 },
  hiddenBtn: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  hiddenBtnText: { color: colors.text, fontFamily: fonts.bodySemi, fontSize: 12 },
  primary: {
    marginHorizontal: 20,
    marginTop: 6,
    backgroundColor: colors.red,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: { color: '#fff', fontFamily: fonts.bodyBold, fontSize: 15 },
});
