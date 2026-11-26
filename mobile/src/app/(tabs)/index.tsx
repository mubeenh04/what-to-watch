import { SectionScreen, type TabDef } from '../../components/SectionScreen';

const TABS: TabDef[] = [
  { key: 'movie', label: 'Movies', section: 'home', type: 'movie', kind: 'home' },
  { key: 'series', label: 'Series', section: 'home', type: 'series', kind: 'home' },
];

export default function Home() {
  return <SectionScreen page="home" tabs={TABS} />;
}
