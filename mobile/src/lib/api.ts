// All reads and writes the app makes. Everything goes through PostgREST with the signed-in
// user's token, so row-level security limits it to the user's own rows.
import type { SupabaseClient, User } from '@supabase/supabase-js';

import { PAGE_SIZE } from './config';
import { toCard } from './format';
import type { Action, CardTitle, Genre, HomeFilters, Status, TitleRow, TitleType } from './types';

export type Section = 'home' | 'explore' | 'watchlist' | 'history';

const TITLE_FIELDS = `title_id,title_type,name,release_year,end_year,synopsis,poster_url,imdb_rating,metacritic_score,letterboxd_url,
  title_genre(rank,genre(name)),
  title_cast(billing_order,person(name)),
  title_availability(source_type,watch_url,streaming_service(name,logo_url,display_order),local_drive(name))`;

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
): Q {
  const f = section === 'home' ? filters : undefined;
  const fields =
    select === 'rows'
      ? `title_id,status,status_changed_at,watched_at,title!inner(${TITLE_FIELDS}${filterEmbeds(f)})`
      : `title_id,title!inner(title_type${filterEmbeds(f)})`;
  let q: Q = client
    .from('user_title')
    .select(fields, select === 'count' ? { count: 'exact', head: true } : undefined)
    .eq('status', section);
  if (type) q = q.eq('title.title_type', type);
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

export async function listTitles(
  client: SupabaseClient,
  opts: { section: Section; type: TitleType | null; filters?: HomeFilters; offset?: number; limit?: number },
): Promise<{ items: CardTitle[]; hasMore: boolean }> {
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
): Promise<number> {
  const { count, error } = await sectionQuery(client, section, type, filters, 'count');
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
    const { error: evErr } = await client.from('title_status_event').insert(
      ids.map((title_id) => ({ user_id: userId, title_id, from_status: 'hidden', to_status: 'home', action: 'unhide' })),
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

export type CatalogueInfo = { minYear: number; maxYear: number; hasImdb: boolean; hasMetacritic: boolean };

/** Year range and whether any scores exist yet (they are empty until a score source is added). */
export async function catalogueInfo(client: SupabaseClient): Promise<CatalogueInfo> {
  const [lo, hi, imdb, meta] = await Promise.all([
    client.from('title').select('release_year').order('release_year').limit(1),
    client.from('title').select('release_year').order('release_year', { ascending: false }).limit(1),
    client.from('title').select('title_id').not('imdb_rating', 'is', null).limit(1),
    client.from('title').select('title_id').not('metacritic_score', 'is', null).limit(1),
  ]);
  for (const r of [lo, hi, imdb, meta]) if (r.error) throw r.error;
  const thisYear = new Date().getFullYear();
  return {
    minYear: lo.data?.[0]?.release_year ?? 1900,
    maxYear: hi.data?.[0]?.release_year ?? thisYear,
    hasImdb: !!imdb.data?.length,
    hasMetacritic: !!meta.data?.length,
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

  const displayName =
    (user.user_metadata?.display_name as string | undefined) || user.email?.split('@')[0] || 'Me';
  const { data: created, error: insErr } = await client
    .from('app_user')
    .insert({ user_id: user.id, display_name: displayName.slice(0, 100), region_code: 'ZA' })
    .select('user_id,display_name,region_code')
    .single();
  if (insErr) {
    // Someone else (another device) created it in the meantime.
    if (insErr.code === '23505') return ensureProfile(client, user);
    throw insErr;
  }
  return created as Profile;
}
