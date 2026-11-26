import { SectionScreen, type TabDef } from '../../components/SectionScreen';

const TABS: TabDef[] = [
  { key: 'movie', label: 'Movies', section: 'explore', type: 'movie', kind: 'explore' },
  { key: 'series', label: 'Series', section: 'explore', type: 'series', kind: 'explore' },
];

export default function Explore() {
  return <SectionScreen page="explore" subtitle="Picks that aren't on Netflix or your drives." tabs={TABS} />;
}
