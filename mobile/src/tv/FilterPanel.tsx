import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { filterFields } from '../components/FilterSheet';
import { countTitles } from '../lib/api';
import { RELEASE_LABELS } from '../lib/format';
import { supabase } from '../lib/supabase';
import { fonts } from '../lib/theme';
import { SAFE_Y, px } from '../lib/tv';
import { emptyFilters, type HomeFilters, type LocationFilter, type ReleaseFilter } from '../lib/types';
import { useAppData } from '../state/app-data';
import { Focusable, tvColors as c } from './focus';
import { Chip, T, TvButton } from './ui';

const DECADES: { label: string; from: number | null; to: number | null }[] = [
  { label: 'Any year', from: null, to: null },
  { label: '2020s', from: 2020, to: null },
  { label: '2010s', from: 2010, to: 2019 },
  { label: '2000s', from: 2000, to: 2009 },
  { label: 'Older', from: null, to: 1999 },
];

const WHERE: { key: LocationFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'streaming', label: 'Netflix SA' },
  { key: 'local', label: 'Hard drive' },
];

const RELEASES: ReleaseFilter[] = ['upcoming', 'premiered', 'in_cinemas', 'digital', 'physical', 'on_tv', 'unknown'];

/** Filters for Home or Explore as a side panel. Changes apply straight away, like on the phone. */
export function FilterPanel({ page, onClose }: { page: 'home' | 'explore'; onClose: () => void }) {
  const { filters, setFilters, genres, catalogue } = useAppData();
  const f = filters[page];
  const set = (next: Partial<HomeFilters>) => setFilters(page, { ...f, ...next });
  const show = filterFields(page, !!catalogue?.hasReleaseStatus);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    setCount(null);
    countTitles(supabase, page, null, f)
      .then((n) => live && setCount(n))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [page, f]);

  const decade = DECADES.find((d) => d.from === f.yearFrom && d.to === f.yearTo);

  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={styles.dim} />
      <View style={styles.panel}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <Text style={[T.h1, { fontSize: px(56), lineHeight: px(56) }]}>Filter {page === 'home' ? 'Home' : 'Explore'}</Text>
          <Text style={T.small}>
            <Text style={T.strong}>Back</Text> to close
          </Text>
        </View>

        <ScrollView contentContainerStyle={{ gap: px(34), padding: px(16), margin: px(-16) }} showsVerticalScrollIndicator={false}>
          {show.location && (
            <Group label="Where">
              {WHERE.map((w, i) => (
                <Chip key={w.key} label={w.label} on={f.location === w.key} onPress={() => set({ location: w.key })} preferred={i === 0} />
              ))}
            </Group>
          )}

          {show.genre && genres.length > 0 && (
            <Group label="Genre">
              {genres.map((g, i) => {
                const on = f.genreIds.includes(g.genre_id);
                return (
                  <Chip
                    key={g.genre_id}
                    label={g.name}
                    on={on}
                    preferred={!show.location && i === 0}
                    onPress={() =>
                      set({ genreIds: on ? f.genreIds.filter((id) => id !== g.genre_id) : [...f.genreIds, g.genre_id] })
                    }
                  />
                );
              })}
            </Group>
          )}

          {show.year && (
            <Group label="Released">
              {DECADES.map((d) => (
                <Chip key={d.label} label={d.label} on={decade === d} onPress={() => set({ yearFrom: d.from, yearTo: d.to })} />
              ))}
              {!decade && <Chip label={`${f.yearFrom ?? '…'}–${f.yearTo ?? '…'}`} on onPress={() => {}} />}
            </Group>
          )}

          {show.release && (
            <Group label="Release">
              {RELEASES.map((r) => {
                const on = f.releaseStatuses.includes(r);
                return (
                  <Chip
                    key={r}
                    label={r === 'unknown' ? 'Not known' : RELEASE_LABELS[r]}
                    on={on}
                    onPress={() =>
                      set({ releaseStatuses: on ? f.releaseStatuses.filter((x) => x !== r) : [...f.releaseStatuses, r] })
                    }
                  />
                );
              })}
            </Group>
          )}

          {show.scores && (
            <View style={{ flexDirection: 'row', gap: px(40) }}>
              <Stepper
                label="Min IMDb"
                value={f.imdbMin ? `${f.imdbMin.toFixed(1)}+` : 'Any'}
                onLess={() => set({ imdbMin: Math.max(0, f.imdbMin - 0.5) })}
                onMore={() => set({ imdbMin: Math.min(9, f.imdbMin + 0.5) })}
                disabled={catalogue ? !catalogue.hasImdb : false}
              />
              <Stepper
                label="Min Metacritic"
                value={f.metacriticMin ? `${f.metacriticMin}+` : 'Any'}
                onLess={() => set({ metacriticMin: Math.max(0, f.metacriticMin - 10) })}
                onMore={() => set({ metacriticMin: Math.min(90, f.metacriticMin + 10) })}
                disabled={catalogue ? !catalogue.hasMetacritic : false}
              />
            </View>
          )}
        </ScrollView>

        <View style={{ flexDirection: 'row', gap: px(16) }}>
          <TvButton
            label={count === null ? 'Show titles' : `Show ${count} title${count === 1 ? '' : 's'}`}
            primary
            onPress={onClose}
            style={{ flex: 1, justifyContent: 'center' }}
          />
          <TvButton label="Clear all" onPress={() => setFilters(page, emptyFilters)} />
        </View>
      </View>
    </View>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: px(14) }}>
      <Text style={T.label}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: px(12) }}>{children}</View>
    </View>
  );
}

/** − value + : the D-pad moves between the two buttons and OK changes the value. */
function Stepper({
  label,
  value,
  onLess,
  onMore,
  disabled,
}: {
  label: string;
  value: string;
  onLess: () => void;
  onMore: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={{ gap: px(14), opacity: disabled ? 0.5 : 1 }}>
      <Text style={T.label}>{label}</Text>
      <View style={styles.stepper}>
        <Focusable onPress={onLess} disabled={disabled} radius={px(30)} style={styles.step} accessibilityLabel={`Lower ${label}`}>
          <Text style={styles.stepText}>−</Text>
        </Focusable>
        <Text style={styles.stepValue}>{value}</Text>
        <Focusable onPress={onMore} disabled={disabled} radius={px(30)} style={styles.step} accessibilityLabel={`Raise ${label}`}>
          <Text style={styles.stepText}>+</Text>
        </Focusable>
      </View>
      {disabled && <Text style={[T.small, { fontSize: px(18) }]}>No scores yet</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(10,10,12,0.55)' },
  panel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: px(760),
    backgroundColor: c.panel,
    boxShadow: `${px(-30)}px 0 ${px(80)}px rgba(0,0,0,0.5)`,
    paddingTop: SAFE_Y,
    paddingBottom: SAFE_Y,
    paddingRight: px(96),
    paddingLeft: px(64),
    gap: px(30),
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: px(14), backgroundColor: c.chip, borderRadius: px(999), padding: px(6) },
  step: { width: px(60), height: px(60), borderRadius: px(30), alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface },
  stepText: { color: c.text, fontFamily: fonts.bodyBold, fontSize: px(32), lineHeight: px(36) },
  stepValue: { color: c.text, fontFamily: fonts.bodyBold, fontSize: px(26), minWidth: px(90), textAlign: 'center' },
});
