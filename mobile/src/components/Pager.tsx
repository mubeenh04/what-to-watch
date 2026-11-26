import { forwardRef, useImperativeHandle, useRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import PagerView from 'react-native-pager-view';

export type PagerHandle = { setPage: (index: number) => void };

type Props = { pages: ReactNode[]; initialPage?: number; onPageSelected: (index: number) => void };

/** Native swipeable pages (ViewPager2 on Android, UIPageViewController on iOS). */
export const Pager = forwardRef<PagerHandle, Props>(function Pager({ pages, initialPage = 0, onPageSelected }, ref) {
  const view = useRef<PagerView>(null);
  useImperativeHandle(ref, () => ({ setPage: (i) => view.current?.setPage(i) }), []);
  return (
    <PagerView
      ref={view}
      style={styles.pager}
      initialPage={initialPage}
      offscreenPageLimit={1}
      onPageSelected={(e) => onPageSelected(e.nativeEvent.position)}
    >
      {pages.map((p, i) => (
        <View key={i} style={styles.page} collapsable={false}>
          {p}
        </View>
      ))}
    </PagerView>
  );
});

const styles = StyleSheet.create({ pager: { flex: 1 }, page: { flex: 1 } });
