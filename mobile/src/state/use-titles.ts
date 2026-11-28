import { useCallback, useEffect, useRef, useState } from 'react';

import { listTitles, moveTitle, setRating, StaleMoveError, type Section } from '../lib/api';
import { supabase } from '../lib/supabase';
import type { Action, CardTitle, HomeFilters, Status, TitleType } from '../lib/types';
import { useAppData } from './app-data';
import { useToast } from './toast';

/** Where each button sends a title, and what the toast says. Shared by the phone and TV layouts. */
export const MOVES: Partial<Record<Action, { to: Status; message: (name: string) => string }>> = {
  watched: { to: 'history', message: (n) => `“${n}” moved to History` },
  hide: { to: 'hidden', message: (n) => `Hid “${n}”` },
  watchlist: { to: 'watchlist', message: (n) => `Added “${n}” to your Watchlist` },
  remove: { to: 'removed', message: (n) => `Removed “${n}”. It won't be recommended again` },
  downloaded: { to: 'home', message: (n) => `“${n}” moved to Home` },
  unhide: { to: 'home', message: (n) => `“${n}” is back in Home` },
  restore: { to: 'explore', message: (n) => `“${n}” is back in Explore` },
  unwatched: { to: 'home', message: (n) => `“${n}” moved back to Home` },
};

type Opts = {
  section: Section;
  type: TitleType | null;
  filters?: HomeFilters;
  search?: string;
  /** Page size; the TV loads a little more at a time. */
  limit?: number;
};

/**
 * One section's titles: first page, more on demand, and moves with Undo. A move drops the card
 * straight away and puts it back if saving fails. Used by the phone's TitleList and the TV pages.
 */
export function useTitles({ section, type, filters, search, limit }: Opts) {
  const { userId, version, bump } = useAppData();
  const toast = useToast();
  const [items, setItems] = useState<CardTitle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  // Moves this list made itself. Their version bump shouldn't reload the list (it already
  // dropped the card), only the counts elsewhere.
  const ownBumps = useRef(0);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const id = ++request.current;
      if (mode === 'refresh') setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await listTitles(supabase, { section, type, filters, search, offset: 0, limit });
        if (id !== request.current) return;
        setItems(res.items);
        setHasMore(res.hasMore);
      } catch (e) {
        if (id !== request.current) return;
        setError((e as Error)?.message || 'Could not load titles.');
      } finally {
        if (id === request.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [section, type, filters, search, limit],
  );

  // Reload when the tab, filters or (someone else's) moves change.
  const lastVersion = useRef(version);
  useEffect(() => {
    if (version !== lastVersion.current && ownBumps.current > 0) {
      ownBumps.current--;
      lastVersion.current = version;
      return;
    }
    lastVersion.current = version;
    load('initial');
  }, [load, version]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || loading) return;
    const id = request.current;
    setLoadingMore(true);
    try {
      const res = await listTitles(supabase, { section, type, filters, search, offset: items.length, limit });
      if (id !== request.current) return;
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...res.items.filter((i) => !seen.has(i.id))];
      });
      setHasMore(res.hasMore);
    } catch {
      // Leave hasMore as is; scrolling again will retry.
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, loading, section, type, filters, search, items.length, limit]);

  /** Moves a title out of this list. Resolves true once saved. */
  const move = useCallback(
    async (item: CardTitle, action: Action): Promise<boolean> => {
      const m = MOVES[action];
      if (!m) return false;
      const from = item.status;
      const index = items.findIndex((i) => i.id === item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      try {
        await moveTitle(supabase, userId, item.id, from, m.to, action);
        ownBumps.current++;
        bump();
        toast(m.message(item.name), {
          undo: async () => {
            try {
              await moveTitle(supabase, userId, item.id, m.to, from, 'undo');
            } catch (e) {
              toast(e instanceof StaleMoveError ? e.message : "Couldn't undo. Try again.", { error: true });
            }
            bump();
          },
        });
        return true;
      } catch (e) {
        if (e instanceof StaleMoveError) {
          toast(e.message, { error: true });
          bump();
          return false;
        }
        // Put the card back where it was.
        setItems((prev) => {
          const next = [...prev];
          next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
          return next;
        });
        toast("Couldn't save that. Check your connection and try again.", { error: true });
        return false;
      }
    },
    [items, userId, bump, toast],
  );

  const rate = useCallback(
    async (item: CardTitle, rating: number | null) => {
      const previous = item.rating;
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, rating } : i)));
      try {
        await setRating(supabase, userId, item.id, rating);
      } catch {
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, rating: previous } : i)));
        toast("Couldn't save your rating. Try again.", { error: true });
      }
    },
    [userId, toast],
  );

  return { items, loading, refreshing, loadingMore, hasMore, error, load, loadMore, move, rate };
}
