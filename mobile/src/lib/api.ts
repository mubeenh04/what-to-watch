// All reads and writes the app makes. Everything goes through PostgREST with the signed-in
// user's token, so row-level security limits it to the user's own rows.
import type { SupabaseClient, User } from '@supabase/supabase-js';

import { PAGE_SIZE } from './config';
import { toCard } from './format';
import type { RatedMovie } from './letterboxd';
import { displayNameFor } from './oauth-redirect';
import type { Action, CardTitle, Genre, HomeFilters, Status, TitleRow, TitleType } from './types';

export type Section = 'home' | 'explore' | 'watchlist' | 'history';

const BASE_TITLE_FIELDS = `title_id,title_type,name,release_year,end_year,synopsis,poster_url,imdb_rating,metacritic_score,letterboxd_url,tmdb_id,
  title_genre(rank,genre(name)),
  title_cast(billing_order,person(name)),
  title_availability(source_type,watch_url,streaming_service(name,logo_url,display_order),local_drive(name))`;

/**
 * Release status columns arrive with the release_status migration. Until the database has them
 * the app leaves them out of every query, so it works before and after that migration runs.
 */
let releaseEnabled = false;
export const isReleaseEnabled = () => releaseEnabled;
const RELEASE_FIELDS = `,release_status,next_release_type,next_release_date,title_release(release_type,release_date)`;
const titleFields = () => BASE_TITLE_FIELDS + (releaseEnabled ? RELEASE_FIELDS : '');

/** Extra embeds used only to filter Home by genre or location. */
function filterEmbeds(f: HomeFilters | undefined): string {
  if (!f) return '';
  let s = '';
  if (f.genreIds.length) s += ',gf:title_genre!inner(genre_id)';
  if (f.location === 'streaming') s += ',sf:title_availability!inner(source_type)';
  if (f.location === 'local') s += ',lf:title_availability(source_type),sf:title_availability(source_type)';
  return s;
}

// Loose builder type: the query builder's generics get in the way of reuse here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any;

function applyFilters(q: Q, f: HomeFilters | undefined): Q {
  if (!f) return q;
  if (f.yearFrom !== null) q = q.gte('title.release_year', f.yearFrom);
  if (f.yearTo !== null) q = q.lte('title.release_year', f.yearTo);
  if (f.imdbMin > 0) q = q.gte('title.imdb_rating', f.imdbMin);
  if (f.metacriticMin > 0) q = q.gte('title.metacritic_score', f.metacriticMin);
  if (f.genreIds.length) q = q.in('title.gf.genre_id', f.genreIds);
  if (releaseEnabled && f.releaseStatuses.length) {
    const known = f.releaseStatuses.filter((s) => s !== 'unknown');
    const parts = [];
    if (known.length) parts.push(`release_status.in.(${known.join(',')})`);
    if (f.releaseStatuses.includes('unknown')) parts.push('release_status.is.null');
    q = q.or(parts.join(','), { referencedTable: 'title' });
  }
  if (f.location === 'streaming') q = q.eq('title.sf.source_type', 'streaming');
  if (f.location === 'local') {
    // On a drive, or marked downloaded (Home with no streaming row).
    q = q
      .eq('title.lf.source_type', 'local')
      .eq('title.sf.source_type', 'streaming')
      .or('lf.not.is.null,sf.is.null', { referencedTable: 'title' });
  }
  return q;
}

function sectionQuery(
  client: SupabaseClient,
  section: Section,
  type: TitleType | null,
  filters: HomeFilters | undefined,
  select: 'rows' | 'count',
  titleIds?: number[],
): Q {
  const f = filters;
  const fields =
    select === 'rows'
      ? `title_id,status,status_changed_at,watched_at,user_rating,title!inner(${titleFields()}${filterEmbeds(f)})`
      : `title_id,title!inner(title_type${filterEmbeds(f)})`;
  let q: Q = client
    .from('user_title')
    .select(fields, select === 'count' ? { count: 'exact', head: true } : undefined)
    .eq('status', section);
  if (type) q = q.eq('title.title_type', type);
  if (titleIds) q = q.in('title_id', titleIds.length ? titleIds : [-1]);
  return applyFilters(q, f);
}

function orderFor(q: Q, section: Section): Q {
  switch (section) {
    case 'history':
      return q.order('watched_at', { ascending: false, nullsFirst: false }).order('title_id');
    case 'watchlist':
      return q.order('status_changed_at', { ascending: false }).order('title_id');
    case 'explore':
      return q
        .order('recommended_at', { ascending: false, nullsFirst: false })
        .order('title(release_year)', { ascending: false })
        .order('title_id');
    default:
      return q.order('title(release_year)', { ascending: false }).order('title_id');
  }
}

export const SEARCH_LIMIT = 100;

/**
 * Fuzzy search through the database function search_my_titles (typos and partial words match).
 * Returns title ids, best match first. Falls back to a plain "name contains" match if the
 * function isn't available.
 */
export async function searchTitleIds(
  client: SupabaseClient,
  query: string,
  section: Section,
  type: TitleType | null,
): Promise<number[]> {
  const { data, error } = await client.rpc('search_my_titles', {
    p_query: query,
    p_status: section,
    p_type: type,
    p_limit: SEARCH_LIMIT,
  });
  if (!error) {
    const rows = (data ?? []) as { title_id: number; score: number }[];
    // Drop the long tail of weak matches when there are strong ones.
    const best = rows[0]?.score ?? 0;
    return rows.filter((r) => r.score >= best * 0.5).map((r) => r.title_id);
  }
  // Function missing or failing: fall back to a plain substring match so search still works.
  console.warn('search_my_titles failed, using a simple match instead:', error.message);

  let q: Q = client
    .from('user_title')
    .select('title_id,title!inner(title_type,name)')
    .eq('status', section)
    .ilike('title.name', `%${query.replace(/[%_,()]/g, ' ').trim()}%`)
    .limit(SEARCH_LIMIT);
  if (type) q = q.eq('title.title_type', type);
  const res = await q;
  if (res.error) throw res.error;
  return ((res.data ?? []) as { title_id: number }[]).map((r) => r.title_id);
}

export type ListOpts = {
  section: Section;
  type: TitleType | null;
  filters?: HomeFilters;
  search?: string;
  offset?: number;
  limit?: number;
};

export async function listTitles(
  client: SupabaseClient,
  opts: ListOpts,
): Promise<{ items: CardTitle[]; hasMore: boolean }> {
  const search = opts.search?.trim();
  if (search) {
    // Search results come back in one go, best match first.
    if (opts.offset) return { items: [], hasMore: false };
    const ids = await searchTitleIds(client, search, opts.section, opts.type);
    if (!ids.length) return { items: [], hasMore: false };
    const { data, error } = await sectionQuery(client, opts.section, opts.type, opts.filters, 'rows', ids);
    if (error) throw error;
    const rank = new Map(ids.map((id, i) => [id, i]));
    const rows = ((data ?? []) as TitleRow[]).sort((a, b) => rank.get(a.title_id)! - rank.get(b.title_id)!);
    return { items: rows.map(toCard), hasMore: false };
  }
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? PAGE_SIZE;
  const q = orderFor(sectionQuery(client, opts.section, opts.type, opts.filters, 'rows'), opts.section);
  const { data, error } = await q.range(offset, offset + limit - 1);
  if (error) throw error;
  const rows = (data ?? []) as TitleRow[];
  return { items: rows.map(toCard), hasMore: rows.length === limit };
}

export async function countTitles(
  client: SupabaseClient,
  section: Section,
  type: TitleType | null,
  filters?: HomeFilters,
  search?: string,
): Promise<number> {
  let ids: number[] | undefined;
  if (search?.trim()) {
    ids = await searchTitleIds(client, search.trim(), section, type);
    if (!ids.length) return 0;
  }
  const { count, error } = await sectionQuery(client, section, type, filters, 'count', ids);
  if (error) throw error;
  return count ?? 0;
}

export class StaleMoveError extends Error {
  constructor() {
    super('This title has already moved to another section.');
  }
}

/**
 * Moves one title to another section. The update only applies while the title is still in
 * `from`, so a title can never be moved out of a section it has already left.
 */
export async function moveTitle(
  client: SupabaseClient,
  userId: string,
  titleId: number,
  from: Status,
  to: Status,
  action: Action,
): Promise<void> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: to, status_changed_at: now };
  if (to === 'history') patch.watched_at = now;
  else if (from === 'history') patch.watched_at = null;

  const { data, error } = await client
    .from('user_title')
    .update(patch)
    .eq('user_id', userId)
    .eq('title_id', titleId)
    .eq('status', from)
    .select('title_id');
  if (error) throw error;
  if (!data?.length) throw new StaleMoveError();

  const { error: evErr } = await client
    .from('title_status_event')
    .insert({ user_id: userId, title_id: titleId, from_status: from, to_status: to, action });
  // The move itself succeeded; a missing audit row is not worth failing the action over.
  if (evErr) console.warn('title_status_event insert failed', evErr.message);
}

/** Puts every hidden title back on Home. Returns how many moved. */
export async function unhideAll(client: SupabaseClient, userId: string): Promise<number> {
  const { data, error } = await client
    .from('user_title')
    .update({ status: 'home', status_changed_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('status', 'hidden')
    .select('title_id');
  if (error) throw error;
  const ids = (data ?? []).map((r: { title_id: number }) => r.title_id);
  if (ids.length) {
    const { error: evErr } = await client
      .from('title_status_event')
      .insert(
        ids.map((title_id) => ({
          user_id: userId,
          title_id,
          from_status: 'hidden',
          to_status: 'home',
          action: 'unhide',
        })),
      );
    if (evErr) console.warn('title_status_event insert failed', evErr.message);
  }
  return ids.length;
}

export async function hiddenCount(client: SupabaseClient): Promise<number> {
  const { count, error } = await client
    .from('user_title')
    .select('title_id', { count: 'exact', head: true })
    .eq('status', 'hidden');
  if (error) throw error;
  return count ?? 0;
}

export async function listGenres(client: SupabaseClient): Promise<Genre[]> {
  const { data, error } = await client.from('genre').select('genre_id,name').order('name');
  if (error) throw error;
  return (data ?? []) as Genre[];
}

export type CatalogueInfo = {
  minYear: number;
  maxYear: number;
  hasImdb: boolean;
  hasMetacritic: boolean;
  hasReleaseStatus: boolean;
};

/** Year range and whether any scores exist yet (they are empty until a score source is added). */
export async function catalogueInfo(client: SupabaseClient): Promise<CatalogueInfo> {
  const [lo, hi, imdb, meta, rel] = await Promise.all([
    client.from('title').select('release_year').order('release_year').limit(1),
    client.from('title').select('release_year').order('release_year', { ascending: false }).limit(1),
    client.from('title').select('title_id').not('imdb_rating', 'is', null).limit(1),
    client.from('title').select('title_id').not('metacritic_score', 'is', null).limit(1),
    // Fails until the release_status migration has run.
    client.from('title').select('release_status').limit(1),
  ]);
  releaseEnabled = !rel.error;
  for (const r of [lo, hi, imdb, meta]) if (r.error) throw r.error;
  const thisYear = new Date().getFullYear();
  return {
    minYear: lo.data?.[0]?.release_year ?? 1900,
    maxYear: hi.data?.[0]?.release_year ?? thisYear,
    hasImdb: !!imdb.data?.length,
    hasMetacritic: !!meta.data?.length,
    hasReleaseStatus: releaseEnabled,
  };
}

export type Profile = { user_id: string; display_name: string; region_code: string };

/**
 * The first sign-in creates the profile. A database trigger then places every synced title in
 * Home (on Netflix ZA or a drive) or Explore (everything else).
 */
export async function ensureProfile(client: SupabaseClient, user: User): Promise<Profile> {
  const { data, error } = await client
    .from('app_user')
    .select('user_id,display_name,region_code')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (data) return data as Profile;

  const displayName = displayNameFor(user);
  const { data: created, error: insErr } = await client
    .from('app_user')
    .insert({ user_id: user.id, display_name: displayName, region_code: 'ZA' })
    .select('user_id,display_name,region_code')
    .single();
  if (insErr) {
    // Someone else (another device) created it in the meantime.
    if (insErr.code === '23505') return ensureProfile(client, user);
    throw insErr;
  }
  return created as Profile;
}

/** Saves (or clears, with null) the user's rating for a title, in Letterboxd stars. */
export async function setRating(
  client: SupabaseClient,
  userId: string,
  titleId: number,
  rating: number | null,
): Promise<void> {
  const { data, error } = await client
    .from('user_title')
    .update({ user_rating: rating })
    .eq('user_id', userId)
    .eq('title_id', titleId)
    .select('title_id');
  if (error) throw error;
  if (!data?.length) throw new Error('That title is no longer in your list.');
}

/** Every rated movie in History, as rows ready for the Letterboxd CSV. */
export async function listRatedMovies(client: SupabaseClient): Promise<RatedMovie[]> {
  const out: RatedMovie[] = [];
  const size = 500;
  for (let from = 0; ; from += size) {
    const { data, error } = await client
      .from('user_title')
      .select('user_rating,title!inner(title_type,name,release_year,tmdb_id,imdb_id)')
      .eq('status', 'history')
      .eq('title.title_type', 'movie')
      .not('user_rating', 'is', null)
      .order('title_id')
      .range(from, from + size - 1);
    if (error) throw error;
    // PostgREST types an embedded to-one relation loosely, so read it as unknown.
    const rows = (data ?? []) as unknown as {
      user_rating: number | string;
      title: { name: string; release_year: number; tmdb_id: number | null; imdb_id: string | null };
    }[];
    for (const r of rows) {
      out.push({
        name: r.title.name,
        year: r.title.release_year,
        tmdbId: r.title.tmdb_id,
        imdbId: r.title.imdb_id,
        rating: Number(r.user_rating),
      });
    }
    if (rows.length < size) break;
  }
  return out;
}
