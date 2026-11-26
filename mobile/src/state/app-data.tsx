import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { catalogueInfo, countTitles, listGenres, type CatalogueInfo } from '../lib/api';
import { supabase } from '../lib/supabase';
import { emptyFilters, type Genre, type HomeFilters } from '../lib/types';

type AppData = {
  userId: string;
  /** Goes up after every move, so lists and counts refetch. */
  version: number;
  bump: () => void;
  filters: HomeFilters;
  setFilters: (f: HomeFilters) => void;
  genres: Genre[];
  catalogue: CatalogueInfo | null;
  watchlistCount: number;
};

const Ctx = createContext<AppData | null>(null);

export function AppDataProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [filters, setFilters] = useState<HomeFilters>(emptyFilters);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueInfo | null>(null);
  const [watchlistCount, setWatchlistCount] = useState(0);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    listGenres(supabase).then(setGenres).catch(() => {});
    catalogueInfo(supabase).then(setCatalogue).catch(() => {});
  }, []);

  useEffect(() => {
    countTitles(supabase, 'watchlist', null)
      .then(setWatchlistCount)
      .catch(() => {});
  }, [version]);

  const value = useMemo(
    () => ({ userId, version, bump, filters, setFilters, genres, catalogue, watchlistCount }),
    [userId, version, bump, filters, genres, catalogue, watchlistCount],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppData() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppData must be used inside AppDataProvider');
  return v;
}
