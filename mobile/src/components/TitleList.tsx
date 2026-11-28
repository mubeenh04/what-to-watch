import * as Haptics from 'expo-haptics';
import { useCallback } from 'react';
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

import type { Section } from '../lib/api';
import { colors, fonts } from '../lib/theme';
import type { Action, CardTitle, HomeFilters, TitleType } from '../lib/types';
import { useTitles } from '../state/use-titles';
import { TitleCard, type CardKind } from './TitleCard';

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
  const { items, loading, refreshing, loadingMore, error, load, loadMore, move, rate } = useTitles({
    section,
    type,
    filters,
    search,
  });

  const onAction = useCallback(
    (item: CardTitle, action: Action) => {
      Haptics.selectionAsync().catch(() => {});
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      move(item, action);
    },
    [move],
  );

  const onRate = useCallback(
    (item: CardTitle, rating: number | null) => {
      Haptics.selectionAsync().catch(() => {});
      rate(item, rating);
    },
    [rate],
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
      renderItem={({ item }) => <TitleCard item={item} kind={kind} onAction={onAction} onRate={kind === 'history' ? onRate : undefined} />}
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
