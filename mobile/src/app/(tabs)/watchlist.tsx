import { SectionScreen, type TabDef } from '../../components/SectionScreen';

const TABS: TabDef[] = [
  { key: 'movie', label: 'Movies', section: 'watchlist', type: 'movie', kind: 'watchlist' },
  { key: 'series', label: 'Series', section: 'watchlist', type: 'series', kind: 'watchlist' },
  { key: 'history', label: 'History', section: 'history', type: null, kind: 'history' },
];

export default function Watchlist() {
  return (
    <SectionScreen
      page="watchlist"
      subtitle="To download or stream. Mark it downloaded when it's ready and it moves to Home."
      tabs={TABS}
    />
  );
}
