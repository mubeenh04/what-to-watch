import { forwardRef, useImperativeHandle, useState, type ReactNode } from 'react';
import { View } from 'react-native';

export type PagerHandle = { setPage: (index: number) => void };

type Props = { pages: ReactNode[]; initialPage?: number; onPageSelected: (index: number) => void };

/** Web stand-in for previews: shows one page at a time, switched by the tab row. */
export const Pager = forwardRef<PagerHandle, Props>(function Pager({ pages, initialPage = 0, onPageSelected }, ref) {
  const [page, setPage] = useState(initialPage);
  useImperativeHandle(ref, () => ({
    setPage: (i) => {
      setPage(i);
      onPageSelected(i);
    },
  }));
  return <View style={{ flex: 1 }}>{pages[page]}</View>;
});
