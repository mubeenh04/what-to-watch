import type { CardTitle, HomeFilters, TitleRow, WhereToWatch } from './types';

export const MAX_SYNOPSIS_WORDS = 50;

/** Cuts a synopsis to at most 50 words, adding an ellipsis when it was cut. */
export function trimSynopsis(text: string | null | undefined, maxWords = MAX_SYNOPSIS_WORDS): string {
  const words = (text ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'No synopsis available.';
  if (words.length <= maxWords) return words.join(' ');
  return words.slice(0, maxWords).join(' ').replace(/[,;:.!?-]+$/, '') + '…';
}

/** IMDb comes back from PostgREST as a string for NUMERIC columns. */
export function toScore(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function letterboxdUrl(name: string, stored: string | null): string {
  if (stored) return stored;
  return 'https://letterboxd.com/search/' + encodeURIComponent(name) + '/';
}

/**
 * Where to watch: streaming services first (by display order), then local drives.
 * A Home title with no availability row was marked downloaded in the app, so it is on a drive.
 */
export function whereToWatch(row: TitleRow): WhereToWatch[] {
  const avail = row.title.title_availability ?? [];
  const streaming = avail
    .filter((a) => a.source_type === 'streaming' && a.streaming_service)
    .sort((a, b) => a.streaming_service!.display_order - b.streaming_service!.display_order);
  const out: WhereToWatch[] = [];
  const seen = new Set<string>();
  for (const a of streaming) {
    const s = a.streaming_service!;
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    out.push({ kind: 'streaming', name: s.name, logoUrl: s.logo_url, url: a.watch_url });
  }
  const local = avail.find((a) => a.source_type === 'local');
  if (local) out.push({ kind: 'local', name: local.local_drive?.name ?? 'Drive' });
  if (!out.length && row.status === 'home') out.push({ kind: 'local', name: 'Drive' });
  return out;
}

/**
 * Posters come from TMDB's image CDN (the sync stores a w500 URL). The card is 112pt wide,
 * so w342 is sharp on 3x screens and about half the download.
 */
export function posterForCard(url: string | null): string | null {
  if (!url) return null;
  return url.replace(/\/t\/p\/(w\d+|original)\//, '/t/p/w342/');
}

export function toCard(row: TitleRow): CardTitle {
  const t = row.title;
  const genres = [...(t.title_genre ?? [])]
    .sort((a, b) => a.rank - b.rank)
    .map((g) => g.genre?.name)
    .filter((n): n is string => !!n)
    .slice(0, 2);
  const cast = [...(t.title_cast ?? [])]
    .sort((a, b) => a.billing_order - b.billing_order)
    .map((c) => c.person?.name)
    .filter((n): n is string => !!n)
    .slice(0, 2);
  return {
    id: t.title_id,
    type: t.title_type,
    status: row.status,
    name: t.name,
    year: t.release_year,
    endYear: t.end_year,
    synopsis: trimSynopsis(t.synopsis),
    posterUrl: posterForCard(t.poster_url),
    imdb: toScore(t.imdb_rating),
    metacritic: toScore(t.metacritic_score),
    genres,
    cast,
    where: whereToWatch(row),
    letterboxdUrl: letterboxdUrl(t.name, t.letterboxd_url),
    watchedAt: row.watched_at,
  };
}

export function formatWatched(iso: string | null, now = new Date()): string {
  if (!iso) return 'Watched';
  const d = new Date(iso);
  const days = Math.floor((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days <= 0) return 'Watched today';
  if (days === 1) return 'Watched yesterday';
  if (days < 7) return `Watched ${days} days ago`;
  const sameYear = d.getFullYear() === now.getFullYear();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `Watched ${d.getDate()} ${months[d.getMonth()]}${sameYear ? '' : ' ' + d.getFullYear()}`;
}
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function yearLabel(year: number, endYear: number | null, type: 'movie' | 'series'): string {
  if (type === 'series' && endYear && endYear !== year) return `${year}–${endYear}`;
  return String(year);
}

/** Number of active filters, for the badge on the filter button. */
export function activeFilterCount(f: HomeFilters): number {
  let n = 0;
  if (f.yearFrom !== null || f.yearTo !== null) n++;
  n += f.genreIds.length;
  if (f.location !== 'all') n++;
  if (f.imdbMin > 0) n++;
  if (f.metacriticMin > 0) n++;
  return n;
}
