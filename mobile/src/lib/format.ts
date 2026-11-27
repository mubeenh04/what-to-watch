import type { CardTitle, HomeFilters, ReleaseInfo, ReleaseStatus, ReleaseType, TitleRow, WhereToWatch } from './types';

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

/**
 * Link to a title on Letterboxd. The film page we matched wins; otherwise movies use
 * letterboxd.com/tmdb/<id>, which Letterboxd redirects to the film's page. Letterboxd covers
 * few series, so series (and anything without a TMDB id) get a search link instead.
 */
export function letterboxdUrl(
  name: string,
  stored: string | null,
  tmdbId?: number | null,
  type: 'movie' | 'series' = 'movie',
): string {
  if (stored) return stored;
  if (type === 'movie' && tmdbId) return `https://letterboxd.com/tmdb/${tmdbId}/`;
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
    letterboxdUrl: letterboxdUrl(t.name, t.letterboxd_url, t.tmdb_id, t.title_type),
    rating: toScore(row.user_rating),
    watchedAt: row.watched_at,
    release: releaseInfo(row),
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
  n += f.releaseStatuses.length;
  return n;
}

export const RELEASE_LABELS: Record<ReleaseStatus, string> = {
  upcoming: 'Coming soon',
  premiered: 'Festival premiere',
  in_cinemas: 'In cinemas only',
  digital: 'Digital',
  physical: 'DVD/Blu-ray',
  on_tv: 'On TV',
};

const NEXT_LABELS: Record<ReleaseType, string> = {
  premiere: 'Premiere',
  theatrical_limited: 'In cinemas',
  theatrical: 'In cinemas',
  digital: 'Digital',
  physical: 'DVD/Blu-ray',
  tv: 'On TV',
};

/** Which release events put a title in each status (for the "since" date). */
const STATUS_TYPES: Record<ReleaseStatus, ReleaseType[]> = {
  upcoming: [],
  premiered: ['premiere'],
  in_cinemas: ['theatrical', 'theatrical_limited'],
  digital: ['digital', 'tv'],
  physical: ['physical'],
  on_tv: ['tv'],
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Nov", or "14 Nov 2025" outside the current year. Takes a YYYY-MM-DD date. */
export function shortDate(ymd: string, now = new Date()): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}${y === now.getFullYear() ? '' : ' ' + y}`;
}

const todayYmd = (now: Date) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/** Release status line for Explore and Watchlist cards, or null when TMDB has no dates. */
export function releaseInfo(row: TitleRow, now = new Date()): ReleaseInfo | null {
  const t = row.title;
  const status = t.release_status;
  if (!status) return null;
  const next = t.next_release_type && t.next_release_date ? { type: t.next_release_type, date: t.next_release_date } : null;

  if (status === 'upcoming') {
    if (!next) return { status, label: RELEASE_LABELS.upcoming, detail: null };
    return {
      status,
      label: `Coming ${shortDate(next.date, now)}`,
      detail: next.type === 'premiere' ? 'Festival premiere' : NEXT_LABELS[next.type],
    };
  }

  const today = todayYmd(now);
  const types = STATUS_TYPES[status];
  const since = (t.title_release ?? [])
    .filter((r) => types.includes(r.release_type) && r.release_date <= today)
    .map((r) => r.release_date)
    .sort()
    .pop();
  const bits: string[] = [];
  if (since) bits.push(`Since ${shortDate(since, now)}`);
  if (next) bits.push(`${NEXT_LABELS[next.type]} on ${shortDate(next.date, now)}`);
  return { status, label: RELEASE_LABELS[status], detail: bits.length ? bits.join(' · ') : null };
}
