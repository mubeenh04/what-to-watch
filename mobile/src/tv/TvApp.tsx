// The Google TV layout: six sections as tabs along the top, moved through with the D-pad.
// It uses the same account, lists and moves as the phone app, so both always show the same titles.
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';

import { FilterIcon, SearchIcon } from '../components/Icons';
import { activeFilterCount } from '../lib/format';
import { fonts } from '../lib/theme';
import { SAFE_X, SAFE_Y, px } from '../lib/tv';
import type { Action, CardTitle } from '../lib/types';
import { useAppData } from '../state/app-data';
import { useSession } from '../state/session';
import { AccountPanel } from './AccountPanel';
import { DetailsPage } from './DetailsPage';
import { ExplorePage } from './ExplorePage';
import { FilterPanel } from './FilterPanel';
import { Focusable, FocusLayer, tvColors as c } from './focus';
import { GridPage } from './GridPage';
import { HomePage } from './HomePage';
import { IconButton } from './ui';
import { WatchlistPage } from './WatchlistPage';

export type TvPage = 'home' | 'explore' | 'watchlist' | 'history' | 'hidden' | 'removed';

const TABS: { key: TvPage; label: string }[] = [
  { key: 'home', label: 'Home' },
  { key: 'explore', label: 'Explore' },
  { key: 'watchlist', label: 'Watchlist' },
  { key: 'history', label: 'History' },
  { key: 'hidden', label: 'Hidden' },
  { key: 'removed', label: 'Removed' },
];

/** What the details page shows, and how its buttons move the title (through the list it came from). */
export type OpenDetails = (item: CardTitle, move: (item: CardTitle, action: Action) => Promise<boolean>) => void;

export function TvApp() {
  const [page, setPage] = useState<TvPage>('home');
  const [details, setDetails] = useState<{ item: CardTitle; move: (i: CardTitle, a: Action) => Promise<boolean> } | null>(null);
  const [panel, setPanel] = useState<'filters' | 'account' | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { filters } = useAppData();

  const openDetails = useCallback<OpenDetails>((item, move) => setDetails({ item, move }), []);

  // The remote's Back button closes whatever is on top, then returns to Home, then leaves the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (details) setDetails(null);
      else if (panel) setPanel(null);
      else if (searchOpen || search) {
        setSearchOpen(false);
        setSearch('');
      } else if (page !== 'home') setPage('home');
      else return false;
      return true;
    });
    return () => sub.remove();
  }, [details, panel, searchOpen, search, page]);

  const filterPage = page === 'home' || page === 'explore' ? page : null;
  const filterCount = filterPage ? activeFilterCount(filters[filterPage]) : 0;
  const covered = !!details || !!panel;

  return (
    <View style={styles.screen}>
      <FocusLayer enabled={!covered}>
        <View style={StyleSheet.absoluteFill}>
          {page === 'home' && (
            <HomePage
              openDetails={openDetails}
              search={search}
              searchOpen={searchOpen}
              onSearch={setSearch}
              onCloseSearch={() => {
                setSearchOpen(false);
                setSearch('');
              }}
            />
          )}
          {page === 'explore' && <ExplorePage />}
          {page === 'watchlist' && <WatchlistPage />}
          {(page === 'history' || page === 'hidden' || page === 'removed') && <GridPage key={page} section={page} />}
        </View>

        <Header
          page={page}
          onPage={(p) => {
            setPage(p);
            setSearchOpen(false);
            setSearch('');
          }}
          onSearch={page === 'home' ? () => setSearchOpen(true) : undefined}
          onFilters={filterPage ? () => setPanel('filters') : undefined}
          filterCount={filterCount}
          onAccount={() => setPanel('account')}
        />
      </FocusLayer>

      {details && (
        <FocusLayer enabled>
          <DetailsPage
            item={details.item}
            move={details.move}
            onClose={() => setDetails(null)}
          />
        </FocusLayer>
      )}
      {panel === 'filters' && filterPage && (
        <FocusLayer enabled>
          <FilterPanel page={filterPage} onClose={() => setPanel(null)} />
        </FocusLayer>
      )}
      {panel === 'account' && (
        <FocusLayer enabled>
          <AccountPanel onClose={() => setPanel(null)} />
        </FocusLayer>
      )}
    </View>
  );
}

function Header({
  page,
  onPage,
  onSearch,
  onFilters,
  filterCount,
  onAccount,
}: {
  page: TvPage;
  onPage: (p: TvPage) => void;
  onSearch?: () => void;
  onFilters?: () => void;
  filterCount: number;
  onAccount: () => void;
}) {
  const { profile } = useSession();
  const initial = (profile?.display_name || '?').trim().charAt(0).toUpperCase();
  return (
    <View style={styles.header} pointerEvents="box-none">
      <Text style={styles.logo}>
        WHAT <Text style={{ color: c.red }}>TO</Text> WATCH
      </Text>
      <View style={styles.tabs}>
        {TABS.map((t) => {
          const on = t.key === page;
          return (
            <Focusable
              key={t.key}
              focusKey={`tab:${t.key}`}
              onPress={() => onPage(t.key)}
              radius={px(999)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              style={[styles.tab, on && styles.tabOn]}
            >
              <Text style={[styles.tabText, on && { color: c.bg }]}>{t.label.toUpperCase()}</Text>
            </Focusable>
          );
        })}
      </View>
      <View style={styles.right}>
        {onSearch && (
          <IconButton label="Search" onPress={onSearch} focusKey="hdr:search">
            <SearchIcon size={px(28)} color={c.text} />
          </IconButton>
        )}
        {onFilters && (
          <IconButton
            label={filterCount ? `Filters, ${filterCount} on` : 'Filters'}
            onPress={onFilters}
            badge={filterCount}
            focusKey="hdr:filters"
          >
            <FilterIcon size={px(28)} color={c.text} />
          </IconButton>
        )}
        <IconButton label="Account" onPress={onAccount} focusKey="hdr:account" filled={c.redDeep}>
          <Text style={styles.avatar}>{initial}</Text>
        </IconButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.app },
  header: {
    position: 'absolute',
    top: SAFE_Y,
    left: SAFE_X,
    right: SAFE_X,
    flexDirection: 'row',
    alignItems: 'center',
    gap: px(40),
  },
  logo: { color: c.text, fontFamily: fonts.display, fontSize: px(44), letterSpacing: px(1) },
  tabs: { flexDirection: 'row', gap: px(6), marginLeft: px(24) },
  tab: { paddingVertical: px(12), paddingHorizontal: px(26), borderRadius: px(999) },
  tabOn: { backgroundColor: c.text },
  tabText: { color: c.dim, fontFamily: fonts.display, fontSize: px(24), letterSpacing: px(2) },
  right: { marginLeft: 'auto', flexDirection: 'row', gap: px(16), alignItems: 'center' },
  avatar: { color: '#fff', fontFamily: fonts.bodyBold, fontSize: px(26) },
});
