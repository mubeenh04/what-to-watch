import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { View } from 'react-native';

import { catalogueInfo, countTitles, listGenres, type CatalogueInfo } from '../lib/api';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { emptyFilters, type Genre, type HomeFilters } from '../lib/types';

export type FilterPage = 'home' | 'explore' | 'watchlist';

type AppData = {
  userId: string;
  /** Goes up after every move, so lists and counts refetch. */
  version: number;
  bump: () => void;
  /** Filters are kept per page: Home, Explore and Watchlist each have their own. */
  filters: Record<FilterPage, HomeFilters>;
  setFilters: (page: FilterPage, f: HomeFilters) => void;
  genres: Genre[];
  catalogue: CatalogueInfo | null;
  watchlistCount: number;
};

const Ctx = createContext<AppData | null>(null);

export function AppDataProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [filters, setAll] = useState<Record<FilterPage, HomeFilters>>({
    home: emptyFilters,
    explore: emptyFilters,
    watchlist: emptyFilters,
  });
  const setFilters = useCallback((page: FilterPage, f: HomeFilters) => setAll((prev) => ({ ...prev, [page]: f })), []);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueInfo | null>(null);
  // Lists wait for the catalogue check, which also decides whether release columns exist yet.
  const [ready, setReady] = useState(false);
  const [watchlistCount, setWatchlistCount] = useState(0);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    listGenres(supabase)
      .then(setGenres)
      .catch(() => {});
    catalogueInfo(supabase)
      .then(setCatalogue)
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    countTitles(supabase, 'watchlist', null)
      .then(setWatchlistCount)
      .catch(() => {});
  }, [version]);

  const value = useMemo(
    () => ({ userId, version, bump, filters, setFilters, genres, catalogue, watchlistCount }),
    [userId, version, bump, filters, setFilters, genres, catalogue, watchlistCount],
  );
  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.app }} />;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppData() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppData must be used inside AppDataProvider');
  return v;
}
