import { memo, useCallback } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { px, SAFE_X } from '../lib/tv';
import type { CardTitle } from '../lib/types';
import { EmptyNote, Loading, PosterTile, POSTER_H, T } from './ui';

type Props = {
  title: string;
  subtitle?: string;
  items: CardTitle[];
  loading: boolean;
  error: string | null;
  emptyText: string;
  onRetry: () => void;
  onEndReached: () => void;
  onFocusItem: (item: CardTitle) => void;
  onPressItem: (item: CardTitle) => void;
  /** Key prefix so focus can come back to the same poster. */
  rowKey: string;
  showWhere?: boolean;
  /** Give the first poster focus (first load of the page). */
  focusFirst?: boolean;
};

/** A titled, horizontally scrolling row of posters. Moving right past the end loads more. */
export const PosterRow = memo(function PosterRow({
  title,
  subtitle,
  items,
  loading,
  error,
  emptyText,
  onRetry,
  onEndReached,
  onFocusItem,
  onPressItem,
  rowKey,
  showWhere,
  focusFirst,
}: Props) {
  const renderItem = useCallback(
    ({ item, index }: { item: CardTitle; index: number }) => (
      <PosterTile
        item={item}
        focusKey={`${rowKey}:${item.id}`}
        preferred={focusFirst && index === 0}
        showWhere={showWhere}
        onFocus={() => onFocusItem(item)}
        onPress={() => onPressItem(item)}
      />
    ),
    [rowKey, focusFirst, showWhere, onFocusItem, onPressItem],
  );

  return (
    <View style={styles.row}>
      <View style={styles.head}>
        <Text style={T.h2}>{title}</Text>
        {subtitle ? <Text style={T.small}>{subtitle}</Text> : null}
      </View>
      {loading && !items.length ? (
        <View style={{ paddingLeft: SAFE_X }}>
          <Loading />
        </View>
      ) : error && !items.length ? (
        <View style={{ paddingLeft: SAFE_X }}>
          <EmptyNote title="Something went wrong" text={error} action={{ label: 'Try again', onPress: onRetry }} />
        </View>
      ) : !items.length ? (
        <View style={{ paddingLeft: SAFE_X, height: POSTER_H * 0.5 }}>
          <EmptyNote title="All clear" text={emptyText} />
        </View>
      ) : (
        <FlatList
          horizontal
          data={items}
          keyExtractor={(i) => String(i.id)}
          renderItem={renderItem}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={Gap}
          onEndReached={onEndReached}
          onEndReachedThreshold={2}
          initialNumToRender={10}
          windowSize={9}
          removeClippedSubviews={false}
        />
      )}
    </View>
  );
});

const Gap = () => <View style={{ width: px(28) }} />;

const styles = StyleSheet.create({
  row: { gap: px(4) },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: px(18), paddingLeft: SAFE_X },
  // Room above and below so the focus ring and lift aren't clipped.
  list: { paddingHorizontal: SAFE_X, paddingVertical: px(30) },
});
