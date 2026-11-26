import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  LayoutAnimation,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { listTitles, moveTitle, StaleMoveError, type Section } from '../lib/api';
import { supabase } from '../lib/supabase';
import { colors, fonts } from '../lib/theme';
import type { Action, CardTitle, HomeFilters, Status, TitleType } from '../lib/types';
import { useAppData } from '../state/app-data';
import { useToast } from '../state/toast';
import { TitleCard, type CardKind } from './TitleCard';

/** Where each button sends a title, and what the toast says. */
const MOVES: Partial<Record<Action, { to: Status; message: (name: string) => string }>> = {
  watched: { to: 'history', message: (n) => `“${n}” moved to History` },
  hide: { to: 'hidden', message: (n) => `Hid “${n}”` },
  watchlist: { to: 'watchlist', message: (n) => `Added “${n}” to your Watchlist` },
  remove: { to: 'removed', message: (n) => `Removed “${n}”. It won't be recommended again` },
  downloaded: { to: 'home', message: (n) => `“${n}” moved to Home` },
};

export const EMPTY_TEXT: Record<CardKind, string> = {
  home: 'Nothing here yet. Titles on Netflix or your drives show up here.',
  explore: "You've gone through every recommendation. New picks will show up here.",
  watchlist: 'Nothing to get right now. Add titles from Explore.',
  history: 'Nothing watched yet. Tap Watched on any title and it lands here.',
};

type Props = {
  section: Section;
  type: TitleType | null;
  kind: CardKind;
  filters?: HomeFilters;
  search?: string;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
};

export function TitleList({ section, type, kind, filters, search, hasActiveFilters, onClearFilters }: Props) {
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
        const res = await listTitles(supabase, { section, type, filters, search, offset: 0 });
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
    [section, type, filters, search],
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
      const res = await listTitles(supabase, { section, type, filters, search, offset: items.length });
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
  }, [hasMore, loadingMore, loading, section, type, filters, search, items.length]);

  const onAction = useCallback(
    async (item: CardTitle, action: Action) => {
      const move = MOVES[action];
      if (!move) return;
      const from = item.status;
      Haptics.selectionAsync().catch(() => {});
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      const index = items.findIndex((i) => i.id === item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      try {
        await moveTitle(supabase, userId, item.id, from, move.to, action);
        ownBumps.current++;
        bump();
        toast(move.message(item.name), {
          undo: async () => {
            try {
              await moveTitle(supabase, userId, item.id, move.to, from, 'undo');
            } catch (e) {
              toast(e instanceof StaleMoveError ? e.message : "Couldn't undo. Try again.", { error: true });
            }
            bump();
          },
        });
      } catch (e) {
        if (e instanceof StaleMoveError) {
          toast(e.message, { error: true });
          bump();
          return;
        }
        // Put the card back where it was.
        setItems((prev) => {
          const next = [...prev];
          next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
          return next;
        });
        toast("Couldn't save that. Check your connection and try again.", { error: true });
      }
    },
    [items, userId, bump, toast],
  );

  if (loading && !items.length) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.red} />
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(i) => String(i.id)}
      renderItem={({ item }) => <TitleCard item={item} kind={kind} onAction={onAction} />}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={Separator}
      onEndReached={loadMore}
      onEndReachedThreshold={0.6}
      initialNumToRender={6}
      windowSize={7}
      removeClippedSubviews
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load('refresh')}
          tintColor={colors.red}
          colors={[colors.red]}
          progressBackgroundColor={colors.surface}
        />
      }
      ListFooterComponent={
        loadingMore ? <ActivityIndicator style={{ marginVertical: 16 }} color={colors.muted} /> : undefined
      }
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      ListEmptyComponent={
        error ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>SOMETHING WENT WRONG</Text>
            <Text style={styles.emptyText}>{error}</Text>
            <Pressable style={styles.emptyBtn} onPress={() => load('initial')}>
              <Text style={styles.emptyBtnText}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>ALL CLEAR</Text>
            <Text style={styles.emptyText}>
              {search
                ? `Nothing matches “${search}”${hasActiveFilters ? ' with these filters' : ''}.`
                : hasActiveFilters
                  ? 'Nothing matches these filters. Try a wider year range or lower minimum scores.'
                  : EMPTY_TEXT[kind]}
            </Text>
            {hasActiveFilters && onClearFilters && (
              <Pressable style={styles.emptyBtn} onPress={onClearFilters}>
                <Text style={styles.emptyBtnText}>Clear filters</Text>
              </Pressable>
            )}
          </View>
        )
      }
    />
  );
}

const Separator = () => <View style={{ height: 14 }} />;

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 96, flexGrow: 1 },
  empty: { marginTop: 40, marginHorizontal: 10, alignItems: 'center' },
  emptyTitle: { color: colors.text, fontFamily: fonts.display, fontSize: 21, letterSpacing: 0.8, marginBottom: 6 },
  emptyText: { color: colors.muted, fontFamily: fonts.body, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  emptyBtn: {
    marginTop: 14,
    backgroundColor: colors.red,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  emptyBtnText: { color: '#fff', fontFamily: fonts.bodyBold, fontSize: 14 },
});
