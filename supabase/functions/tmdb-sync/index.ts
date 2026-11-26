// tmdb-sync: pulls titles from TMDB into the What to Watch schema.
//
// Netflix South Africa (TMDB provider 8, region ZA) is the only subscribed service.
// * Titles streaming on Netflix ZA land in Home.
// * Other titles (TMDB trending) land in Explore.
// * Watchlist/Explore titles move to Home once TMDB lists them on Netflix ZA
//   (or once a local-drive row exists for them).
// Placement is done by the database function apply_availability_moves().
//
// Secrets: TMDB_API_KEY (TMDB "API Read Access Token" or v3 API key), OMDB_API_KEY (scores).
// Optional: TMDB_REGION (default ZA). Auth: service role key, or x-sync-secret matching the
// Vault secret tmdb_sync_secret (see migration sync_schedule).
//
// Request body (POST, JSON), all optional:
//   { "mode": "discover", "pages": 3, "start_page": 1 }   Netflix ZA catalogue + trending for Explore
//   { "mode": "title", "tmdb_id": 603, "type": "movie" }   one title (type: movie | series)
//   { "mode": "refresh", "limit": 100 }                    re-check the least recently synced titles
//     add "missing_release": true to re-fetch titles synced before release data existed
//   { "mode": "backfill", "max_titles": 400 }              next slice of the initial seed (cursor in sync_backfill)
//   { "mode": "estimate" }                                 how many titles each seed source holds
//   { "mode": "scores", "limit": 900 }                     IMDb + Metacritic (+ RT if OMDb has it) from OMDb
//   { "mode": "omdb_probe", "imdb_id": "tt0111161" }       which rating sources OMDb returns (1 call)
//   { "mode": "letterboxd", "limit": 150 }                 match pending letterboxd_import rows to TMDB,
//     add missing titles, then move matched films to History (apply_letterboxd_import)
//   { "mode": "local_scan", "drive": "Media HDD", "volume": "My Passport", "scan_id": "<uuid>",
//     "files": [...], "final": true }                     store one chunk of a hard drive scan
//   { "mode": "local_match", "limit": 300 }               match pending local_file rows to TMDB and
//     add title_availability rows (source 'local'), which moves the titles to Home
//   { "mode": "local_review" }                            the hard drive review list (read only)
//   The hard drive scanner on the Mac may only call the local_* modes, with x-scan-secret
//   matching the Vault secret local_scan_secret.

import { createClient } from "jsr:@supabase/supabase-js@2";

type TitleType = "movie" | "series";
type Ref = { tmdb_id: number; type: TitleType };

const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";
const REGION = (Deno.env.get("TMDB_REGION") ?? "ZA").toUpperCase();
const TMDB_KEY = Deno.env.get("TMDB_API_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SYNC_SECRET = Deno.env.get("SYNC_SECRET") ?? "";
const CONCURRENCY = 10;
const MAX_PAGES = 10;
const CAST_LIMIT = 5;
const OMDB_KEY = Deno.env.get("OMDB_API_KEY") ?? "";

const db = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ---------- TMDB ----------
async function tmdb(path: string, params: Record<string, string | number> = {}) {
  const url = new URL(TMDB + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const headers: Record<string, string> = { accept: "application/json" };
  // v4 read tokens are JWTs; v3 keys are 32 hex characters.
  if (TMDB_KEY.includes(".")) headers.authorization = `Bearer ${TMDB_KEY}`;
  else url.searchParams.set("api_key", TMDB_KEY);

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? 1) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`TMDB ${res.status} on ${path}`);
    return await res.json();
  }
  throw new Error(`TMDB rate limit on ${path}`);
}

const tmdbKind = (t: TitleType) => (t === "movie" ? "movie" : "tv");

function year(date?: string | null): number | null {
  const y = date ? Number(date.slice(0, 4)) : NaN;
  return Number.isFinite(y) && y >= 1880 && y <= 2100 ? y : null;
}

// Schema allows at most 50 words and 400 characters.
function synopsis(text?: string | null): string {
  const words = (text ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "No synopsis available.";
  let out = words.slice(0, 50).join(" ");
  if (words.length > 50) out += "…";
  if (out.length > 400) {
    out = out.slice(0, 399);
    out = out.slice(0, out.lastIndexOf(" ")) + "…";
  }
  return out;
}

async function buildPayload(ref: Ref, providerIds: Set<number>) {
  const kind = tmdbKind(ref.type);
  const credits = ref.type === "movie" ? "credits" : "aggregate_credits";
  const d = await tmdb(`/${kind}/${ref.tmdb_id}`, {
    language: "en-US",
    append_to_response: `${credits},external_ids,watch/providers${ref.type === "movie" ? ",release_dates" : ""}`,
  });

  const releaseYear = year(ref.type === "movie" ? d.release_date : d.first_air_date);
  if (!releaseYear) return null; // schema requires a release year

  let endYear: number | null = null;
  if (ref.type === "series" && ["Ended", "Canceled"].includes(d.status)) {
    endYear = year(d.last_air_date);
    if (endYear && endYear < releaseYear) endYear = null;
  }

  const castSrc: any[] = (d[credits]?.cast ?? [])
    .slice()
    .sort((a: any, b: any) => (a.order ?? 999) - (b.order ?? 999))
    .slice(0, CAST_LIMIT);

  const za = d["watch/providers"]?.results?.[REGION];
  const providers = (za?.flatrate ?? [])
    .filter((p: any) => providerIds.has(p.provider_id))
    .map((p: any) => ({ provider_id: p.provider_id, link: za?.link ?? null }));

  // Release dates: the region's own, else US. TMDB types 1-6 (premiere ... TV).
  let releaseRegion: string | null = null;
  let releases: any[] = [];
  if (ref.type === "movie") {
    const byCountry: any[] = d.release_dates?.results ?? [];
    for (const c of [REGION, "US"]) {
      const hit = byCountry.find((x) => x.iso_3166_1 === c);
      if (hit?.release_dates?.length) {
        releaseRegion = c;
        releases = hit.release_dates.map((r: any) => ({
          type: r.type, date: r.release_date, certification: r.certification, note: r.note,
        }));
        break;
      }
    }
  }

  return {
    type: ref.type,
    tmdb_id: ref.tmdb_id,
    release_region: releaseRegion,
    releases,
    first_air_date: ref.type === "series" ? (d.first_air_date || null) : null,
    name: ref.type === "movie" ? d.title : d.name,
    release_year: releaseYear,
    end_year: endYear,
    synopsis: synopsis(d.overview),
    poster_url: d.poster_path ? `${IMG}/w500${d.poster_path}` : null,
    imdb_id: d.external_ids?.imdb_id ?? d.imdb_id ?? null,
    popularity: typeof d.popularity === "number" ? d.popularity : null,
    genres: (d.genres ?? []).map((g: any) => g.name),
    cast: castSrc.map((c: any) => ({
      tmdb_id: c.id,
      name: c.name,
      character: c.character ?? c.roles?.[0]?.character ?? null,
    })),
    providers,
  };
}

// ---------- Sources ----------
async function netflixPages(type: TitleType, start: number, pages: number): Promise<Ref[]> {
  const refs: Ref[] = [];
  for (let page = start; page < start + pages; page++) {
    const r = await tmdb(`/discover/${tmdbKind(type)}`, {
      watch_region: REGION,
      with_watch_providers: [...trackedIds].join("|"),
      with_watch_monetization_types: "flatrate",
      sort_by: "popularity.desc",
      page,
    });
    refs.push(...(r.results ?? []).map((x: any) => ({ tmdb_id: x.id, type })));
    if (page >= (r.total_pages ?? 0)) break;
  }
  return refs;
}

async function trendingPages(type: TitleType, start: number, pages: number): Promise<Ref[]> {
  const refs: Ref[] = [];
  for (let page = start; page < start + pages; page++) {
    const r = await tmdb(`/trending/${tmdbKind(type)}/week`, { page });
    refs.push(...(r.results ?? []).map((x: any) => ({ tmdb_id: x.id, type })));
    if (page >= (r.total_pages ?? 0)) break;
  }
  return refs;
}

// ---------- Initial seed (backfill) ----------
// Sources, each walked year by year (TMDB caps a query at 500 pages):
//   netflix: everything streaming on a tracked service in REGION
//   popular: everything with at least MIN_VOTES votes on TMDB, wherever it streams
const MIN_VOTES = Number(Deno.env.get("TMDB_MIN_VOTES") ?? 100);
const FIRST_YEAR = 1900;
const BUDGET_MS = 110_000;

function discoverParams(source: string, type: TitleType, year: number | null) {
  const p: Record<string, string | number> = { sort_by: "popularity.desc", include_adult: "false" };
  if (year !== null) p[type === "movie" ? "primary_release_year" : "first_air_date_year"] = year;
  if (source === "netflix") {
    p.watch_region = REGION;
    p.with_watch_providers = [...trackedIds].join("|");
    p.with_watch_monetization_types = "flatrate";
  } else {
    p["vote_count.gte"] = MIN_VOTES;
  }
  return p;
}

async function estimate() {
  const out: Record<string, number> = {};
  for (const source of ["netflix", "popular"]) {
    for (const type of ["movie", "series"] as TitleType[]) {
      const r = await tmdb(`/discover/${tmdbKind(type)}`, discoverParams(source, type, null));
      out[`${source}_${type}`] = r.total_results ?? 0;
    }
  }
  return out;
}

async function backfill(maxTitles: number, started: number) {
  const { data: rows, error } = await db.from("sync_backfill").select("*").eq("done", false).order("sort");
  if (error) throw error;
  const totals = { imported: 0, on_netflix_za: 0, skipped: 0, placed: 0, errors: [] as string[] };
  let processed = 0;

  for (const row of rows ?? []) {
    let { year, page } = row as { year: number; page: number };
    const type = row.title_type as TitleType;
    while (year >= FIRST_YEAR && processed < maxTitles && Date.now() - started < BUDGET_MS) {
      const r = await tmdb(`/discover/${tmdbKind(type)}`, { ...discoverParams(row.source, type, year), page });
      const refs: Ref[] = (r.results ?? []).map((x: any) => ({ tmdb_id: x.id, type }));
      if (refs.length) {
        const res = await importTitles(refs);
        totals.imported += res.imported;
        totals.on_netflix_za += res.on_netflix_za;
        totals.skipped += res.skipped;
        totals.placed += res.placed;
        totals.errors.push(...res.errors);
        processed += refs.length;
      }
      const lastPage = Math.min(r.total_pages ?? 0, 500);
      if (page >= lastPage) { year--; page = 1; } else page++;
      await db.from("sync_backfill").update({
        year, page, done: year < FIRST_YEAR, updated_at: new Date().toISOString(),
        titles_seen: (row.titles_seen ?? 0) + refs.length,
      }).eq("id", row.id);
      row.titles_seen = (row.titles_seen ?? 0) + refs.length;
    }
    if (processed >= maxTitles || Date.now() - started >= BUDGET_MS) break;
  }

  const { count } = await db.from("sync_backfill").select("id", { count: "exact", head: true }).eq("done", false);
  if (count === 0) await db.rpc("finish_tmdb_backfill");
  return { ...totals, errors: totals.errors.slice(0, 20), backfill_done: count === 0 };
}

// ---------- Scores (OMDb) ----------
// Free OMDb keys allow 1,000 calls a day; the nightly job asks for 900.
async function scores(limit: number, started: number) {
  if (!OMDB_KEY) throw new Error("OMDB_API_KEY secret is not set");
  const { data: queue, error } = await db.rpc("next_titles_for_scores", { p_limit: limit });
  if (error) throw error;

  let limited = false;
  const errors: string[] = [];
  const rows = await pool(queue ?? [], 8, async (t: { title_id: number; imdb_id: string }) => {
    if (limited || Date.now() - started > BUDGET_MS) return null;
    try {
      const url = new URL("https://www.omdbapi.com/");
      url.searchParams.set("apikey", OMDB_KEY);
      url.searchParams.set("i", t.imdb_id);
      const res = await fetch(url);
      if (res.status === 401 || res.status === 429) { limited = true; return null; }
      const o = await res.json();
      if (o.Response === "False") {
        if (/limit|invalid api key/i.test(o.Error ?? "")) { limited = true; return null; }
        return { title_id: t.title_id, imdb_rating: null, rt_score: null, metacritic_score: null }; // not on OMDb
      }
      const imdb = Number(o.imdbRating);
      const rt = (o.Ratings ?? []).find((r: any) => r.Source === "Rotten Tomatoes")?.Value;
      const rtNum = rt ? Number(String(rt).replace("%", "")) : NaN;
      const meta = Number(o.Metascore);
      return {
        title_id: t.title_id,
        imdb_rating: Number.isFinite(imdb) && imdb >= 0 && imdb <= 10 ? imdb : null,
        rt_score: Number.isFinite(rtNum) && rtNum >= 0 && rtNum <= 100 ? Math.round(rtNum) : null,
        metacritic_score: Number.isFinite(meta) && meta >= 0 && meta <= 100 ? Math.round(meta) : null,
      };
    } catch (e) {
      errors.push(`${t.imdb_id}: ${(e as Error).message}`);
      return null;
    }
  });

  const done = rows.filter((r) => r !== null);
  let updated = 0;
  if (done.length) {
    const { data, error: e2 } = await db.rpc("set_title_scores", { p: done });
    if (e2) errors.push(`set_title_scores: ${e2.message}`);
    else updated = data as number;
  }
  return {
    queued: queue?.length ?? 0,
    updated,
    with_imdb: done.filter((r) => r!.imdb_rating !== null).length,
    with_rt: done.filter((r) => r!.rt_score !== null).length,
    with_metacritic: done.filter((r) => r!.metacritic_score !== null).length,
    stopped_early: limited,
    errors: errors.slice(0, 20),
  };
}

// ---------- Letterboxd import ----------
// Each pending letterboxd_import row is matched to TMDB:
//  1. a TMDB id set by hand (resolve_letterboxd_review), else
//  2. the TMDB link on the film's Letterboxd page (exact; Letterboxd's data comes from TMDB), else
//  3. a strict search: same year, same normalised title, movie or series. Several exact hits are
//     only accepted when one clearly dominates (10x the votes of the next, 50+ votes).
// Anything else goes on the review list with its candidates. Nothing is guessed.
const LB_UA = "Mozilla/5.0 (compatible; what-to-watch-import/1.0)";

function normTitle(s: string): string {
  return (s ?? "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

async function letterboxdPage(uri: string): Promise<{ url: string; ref: Ref | null } | null> {
  try {
    const res = await fetch(uri, { redirect: "follow", headers: { "user-agent": LB_UA, accept: "text/html" } });
    if (!res.ok) return null;
    const html = await res.text();
    const url = res.url.startsWith("https://letterboxd.com/film/") ? res.url : uri;
    let m = html.match(/data-tmdb-id="(\d+)"[^>]*data-tmdb-type="(movie|tv)"/) ??
      html.match(/data-tmdb-type="(movie|tv)"[^>]*data-tmdb-id="(\d+)"/);
    if (m) {
      const [id, kind] = /^\d+$/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
      return { url, ref: { tmdb_id: Number(id), type: kind === "tv" ? "series" : "movie" } };
    }
    m = html.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
    if (m) return { url, ref: { tmdb_id: Number(m[2]), type: m[1] === "tv" ? "series" : "movie" } };
    return { url, ref: null };
  } catch {
    return null;
  }
}

type Candidate = { tmdb_id: number; type: TitleType; name: string; year: number | null; votes: number };

async function searchCandidates(name: string, filmYear: number | null) {
  const [mv, tv] = await Promise.all([
    tmdb("/search/movie", { query: name, include_adult: "false", ...(filmYear ? { primary_release_year: filmYear } : {}) }),
    tmdb("/search/tv", { query: name, include_adult: "false", ...(filmYear ? { first_air_date_year: filmYear } : {}) }),
  ]);
  const all: (Candidate & { names: string[] })[] = [
    ...(mv.results ?? []).map((r: any) => ({
      tmdb_id: r.id, type: "movie" as TitleType, name: r.title, year: year(r.release_date),
      votes: r.vote_count ?? 0, names: [r.title, r.original_title],
    })),
    ...(tv.results ?? []).map((r: any) => ({
      tmdb_id: r.id, type: "series" as TitleType, name: r.name, year: year(r.first_air_date),
      votes: r.vote_count ?? 0, names: [r.name, r.original_name],
    })),
  ];
  const sameYear = all.filter((c) => !filmYear || c.year === filmYear);
  const target = normTitle(name);
  const exact = sameYear
    .filter((c) => c.names.some((n) => normTitle(n) === target))
    .sort((a, b) => b.votes - a.votes);
  const strip = ({ names: _n, ...c }: Candidate & { names: string[] }) => c;

  if (exact.length === 1) return { ref: exact[0] as Ref, candidates: null, reason: null };
  if (exact.length > 1) {
    const [a, b] = exact;
    if (a.votes >= 50 && a.votes >= 10 * Math.max(b.votes, 1)) {
      return { ref: a as Ref, candidates: null, reason: null };
    }
    return { ref: null, candidates: exact.slice(0, 5).map(strip),
             reason: `${exact.length} TMDB titles named "${name}" from ${filmYear}` };
  }
  const near = (sameYear.length ? sameYear : all).sort((x, y) => y.votes - x.votes).slice(0, 5).map(strip);
  return { ref: null, candidates: near.length ? near : null,
           reason: sameYear.length ? `No TMDB title from ${filmYear} with exactly this name`
                                   : `Not found on TMDB for ${filmYear ?? "any year"}` };
}

async function letterboxdImport(limit: number, started: number) {
  const { data: rows, error } = await db.from("letterboxd_import")
    .select("import_row_id, film_name, film_year, letterboxd_uri, tmdb_id, title_type, letterboxd_film_url")
    .eq("match_status", "pending").order("import_row_id").limit(limit);
  if (error) throw error;

  const errors: string[] = [];
  const titleIds: number[] = [];
  let matched = 0, review = 0, viaPage = 0, viaSearch = 0, stoppedEarly = false;

  const toReview = async (id: number, reason: string, candidates: unknown, filmUrl: string | null) => {
    review++;
    const { error: e } = await db.from("letterboxd_import").update({
      match_status: "review", review_reason: reason.slice(0, 300), candidates,
      letterboxd_film_url: filmUrl, matched_at: new Date().toISOString(),
    }).eq("import_row_id", id);
    if (e) errors.push(`row ${id}: ${e.message}`);
  };

  await pool(rows ?? [], 5, async (r: any) => {
    if (Date.now() - started > 110_000) { stoppedEarly = true; return; }
    try {
      let ref: Ref | null = null;
      let method = "manual";
      let filmUrl: string | null = r.letterboxd_film_url ?? r.letterboxd_uri ?? null;
      if (r.tmdb_id && r.title_type) ref = { tmdb_id: r.tmdb_id, type: r.title_type };

      if (!ref && r.letterboxd_uri) {
        const page = await letterboxdPage(r.letterboxd_uri);
        if (page) {
          filmUrl = page.url;
          if (page.ref) { ref = page.ref; method = "letterboxd_page"; }
        }
      }
      if (!ref) {
        const s = await searchCandidates(r.film_name, r.film_year);
        if (!s.ref) return await toReview(r.import_row_id, s.reason!, s.candidates, filmUrl);
        ref = { tmdb_id: s.ref.tmdb_id, type: s.ref.type };
        method = "tmdb_search";
      }

      const payload = await buildPayload(ref, trackedIds);
      if (!payload) {
        return await toReview(r.import_row_id, `TMDB ${ref.type} ${ref.tmdb_id} has no release date`,
                              [{ tmdb_id: ref.tmdb_id, type: ref.type }], filmUrl);
      }
      const { data: titleId, error: e1 } = await db.rpc("upsert_tmdb_title", { p: payload, p_region: REGION });
      if (e1) throw new Error(e1.message);
      if (filmUrl) await db.from("title").update({ letterboxd_url: filmUrl.slice(0, 500) }).eq("title_id", titleId);

      const { error: e2 } = await db.from("letterboxd_import").update({
        match_status: "matched", match_method: method, tmdb_id: ref.tmdb_id, title_type: ref.type,
        title_id: titleId, letterboxd_film_url: filmUrl, review_reason: null, candidates: null,
        matched_at: new Date().toISOString(),
      }).eq("import_row_id", r.import_row_id);
      if (e2) throw new Error(e2.message);
      titleIds.push(titleId as number);
      matched++;
      if (method === "letterboxd_page") viaPage++;
      if (method === "tmdb_search") viaSearch++;
    } catch (e) {
      errors.push(`${r.film_name} (${r.film_year}): ${(e as Error).message}`); // stays pending
    }
  });

  // History first, so the user's own rows never pass through Home/Explore.
  const { data: applied, error: e3 } = await db.rpc("apply_letterboxd_import", { p_username: null });
  if (e3) errors.push(`apply_letterboxd_import: ${e3.message}`);
  if (titleIds.length) {
    const { error: e4 } = await db.rpc("apply_availability_moves", { p_title_ids: titleIds });
    if (e4) errors.push(`apply_availability_moves: ${e4.message}`);
  }
  const { count: pending } = await db.from("letterboxd_import")
    .select("import_row_id", { count: "exact", head: true }).eq("match_status", "pending");

  return { processed: rows?.length ?? 0, matched, via_letterboxd_page: viaPage, via_tmdb_search: viaSearch,
           review, still_pending: pending ?? null, stopped_early: stoppedEarly, applied,
           errors: errors.slice(0, 20) };
}

// ---------- Hard drive files ----------
// Pending local_file rows are grouped by what guessit read (kind + title + year + hints), so all
// episodes of a show or copies of a film need one lookup. Each group is matched by:
//  1. a TMDB id set by hand (resolve_local_file), else a {tmdb-123} hint in the file name
//  2. an IMDb id (tt1234567) in the file name, through TMDB /find
//  3. a strict search: episodes search TV only, films search movies only. Same title after
//     normalising, same year (or, when no title has that year, a single title one year off).
//     Without a year, one exact title must clearly dominate (10x the votes, 50+ votes).
// Anything else goes on the review list with its candidates. Nothing is guessed.

// Looser than normTitle: "Ocean's Eleven" and "Oceans.Eleven" compare equal.
function looseTitle(s: string): string {
  return normTitle((s ?? "").replace(/['’`]/g, "")).replace(/ /g, "");
}

async function searchLocal(name: string, fileYear: number | null, type: TitleType) {
  const kind = tmdbKind(type);
  const yearParam = type === "movie" ? "year" : "first_air_date_year";
  const toCand = (r: any) => ({
    tmdb_id: r.id as number, type, name: (type === "movie" ? r.title : r.name) as string,
    year: year(type === "movie" ? r.release_date : r.first_air_date), votes: (r.vote_count ?? 0) as number,
    names: type === "movie" ? [r.title, r.original_title] : [r.name, r.original_name],
  });
  const results: ReturnType<typeof toCand>[] = [];
  if (fileYear) {
    const r = await tmdb(`/search/${kind}`, { query: name, include_adult: "false", [yearParam]: fileYear });
    results.push(...(r.results ?? []).map(toCand));
  }
  const r2 = await tmdb(`/search/${kind}`, { query: name, include_adult: "false" });
  for (const c of (r2.results ?? []).map(toCand)) {
    if (!results.some((x) => x.tmdb_id === c.tmdb_id)) results.push(c);
  }

  const target = looseTitle(name);
  const exact = results.filter((c) => c.names.some((n: string) => n && looseTitle(n) === target))
    .sort((a, b) => b.votes - a.votes);
  const strip = ({ names: _n, ...c }: any): Candidate => c;
  const label = type === "movie" ? "film" : "series";

  if (fileYear) {
    const same = exact.filter((c) => c.year === fileYear);
    if (same.length === 1) return { ref: same[0] as Ref, method: "tmdb_search", candidates: null, reason: null };
    if (same.length > 1) {
      return { ref: null, method: null, candidates: same.slice(0, 5).map(strip),
               reason: `${same.length} TMDB ${label} titles named "${name}" from ${fileYear}` };
    }
    const near = exact.filter((c) => c.year && Math.abs(c.year - fileYear) === 1);
    if (near.length === 1) return { ref: near[0] as Ref, method: "near_year", candidates: null, reason: null };
    const opts = (exact.length ? exact : results).sort((a, b) => b.votes - a.votes).slice(0, 5).map(strip);
    return { ref: null, method: null, candidates: opts.length ? opts : null,
             reason: exact.length ? `TMDB has "${name}" but not from ${fileYear}`
                                  : `No TMDB ${label} named exactly "${name}"` };
  }

  if (exact.length === 1 && exact[0].votes >= 5) {
    return { ref: exact[0] as Ref, method: "tmdb_search", candidates: null, reason: null };
  }
  if (exact.length >= 1) {
    const [a, b] = exact;
    if (a.votes >= 50 && a.votes >= 10 * Math.max(b?.votes ?? 0, 1)) {
      return { ref: a as Ref, method: "tmdb_search", candidates: null, reason: null };
    }
    return { ref: null, method: null, candidates: exact.slice(0, 5).map(strip),
             reason: exact.length === 1 ? `Only a little-known TMDB ${label} is named "${name}" and the file has no year`
                                        : `${exact.length} TMDB ${label} titles named "${name}" and the file has no year` };
  }
  const opts = results.sort((a, b) => b.votes - a.votes).slice(0, 5).map(strip);
  return { ref: null, method: null, candidates: opts.length ? opts : null,
           reason: `No TMDB ${label} named exactly "${name}"` };
}

type LocalRow = {
  file_id: number; drive_id: number; file_path: string; parsed_title: string | null; parsed_year: number | null;
  parsed_kind: string | null; tmdb_hint: number | null; imdb_hint: string | null; tmdb_id: number | null;
  title_type: TitleType | null; match_method: string | null;
};

async function localMatch(limit: number, started: number) {
  const { data: rows, error } = await db.from("local_file")
    .select("file_id, drive_id, file_path, parsed_title, parsed_year, parsed_kind, tmdb_hint, imdb_hint, tmdb_id, title_type, match_method")
    .eq("match_status", "pending").order("file_id").limit(1000); // PostgREST max rows
  if (error) throw error;

  const groups = new Map<string, LocalRow[]>();
  for (const r of (rows ?? []) as LocalRow[]) {
    const k = r.tmdb_id && r.title_type ? `manual:${r.title_type}:${r.tmdb_id}`
      : [r.parsed_kind, looseTitle(r.parsed_title ?? ""), r.parsed_year, r.tmdb_hint, r.imdb_hint].join("|");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const work = [...groups.values()].slice(0, limit);

  const errors: string[] = [];
  let matchedFiles = 0, reviewFiles = 0, stoppedEarly = false;
  const methods: Record<string, number> = {};
  const ids = (g: LocalRow[]) => g.map((r) => r.file_id);

  const setRows = async (g: LocalRow[], values: Record<string, unknown>) => {
    for (let i = 0; i < g.length; i += 200) {
      const { error: e } = await db.from("local_file").update(values).in("file_id", ids(g).slice(i, i + 200));
      if (e) throw new Error(e.message);
    }
  };
  const toReview = async (g: LocalRow[], reason: string, candidates: unknown) => {
    await setRows(g, { match_status: "review", review_reason: reason.slice(0, 300), candidates,
                       matched_at: new Date().toISOString() });
    reviewFiles += g.length;
  };

  await pool(work, 5, async (g) => {
    if (Date.now() - started > 100_000) { stoppedEarly = true; return; }
    const r = g[0];
    const type: TitleType = r.parsed_kind === "episode" ? "series" : "movie";
    try {
      let ref: Ref | null = null;
      let method = "";
      if (r.tmdb_id && r.title_type) { ref = { tmdb_id: r.tmdb_id, type: r.title_type }; method = "manual"; }
      else if (r.tmdb_hint) { ref = { tmdb_id: r.tmdb_hint, type }; method = "tmdb_hint"; }
      else if (r.imdb_hint) {
        const f = await tmdb(`/find/${r.imdb_hint}`, { external_source: "imdb_id" });
        const hit = type === "movie" ? f.movie_results?.[0] : (f.tv_results?.[0] ?? f.tv_episode_results?.[0]);
        if (hit) {
          ref = { tmdb_id: hit.show_id ?? hit.id, type };
          method = "imdb_hint";
        }
      }
      if (!ref) {
        if (!r.parsed_title || looseTitle(r.parsed_title).length < 2) {
          return await toReview(g, "Couldn't read a title from the file name", null);
        }
        const s = await searchLocal(r.parsed_title, r.parsed_year, type);
        if (!s.ref) return await toReview(g, s.reason!, s.candidates);
        ref = { tmdb_id: s.ref.tmdb_id, type: s.ref.type };
        method = s.method!;
      }

      const payload = await buildPayload(ref, trackedIds).catch((e) => {
        if (String(e.message).includes("TMDB 404")) return undefined;
        throw e;
      });
      if (payload === undefined) {
        return await toReview(g, `TMDB ${ref.type} ${ref.tmdb_id} doesn't exist`, null);
      }
      if (!payload) {
        return await toReview(g, `TMDB ${ref.type} ${ref.tmdb_id} has no release date`,
                              [{ tmdb_id: ref.tmdb_id, type: ref.type }]);
      }
      const { data: titleId, error: e1 } = await db.rpc("upsert_tmdb_title", { p: payload, p_region: REGION });
      if (e1) throw new Error(e1.message);

      await setRows(g, {
        match_status: "matched", match_method: method, tmdb_id: ref.tmdb_id, title_type: ref.type,
        title_id: titleId, review_reason: null, candidates: null, matched_at: new Date().toISOString(),
      });
      matchedFiles += g.length;
      methods[method] = (methods[method] ?? 0) + 1;
    } catch (e) {
      errors.push(`${r.parsed_title ?? r.file_path} (${r.parsed_year ?? "no year"}): ${(e as Error).message}`); // stays pending
    }
  });

  // Availability rows for every matched file; the insert trigger moves those titles to Home.
  const { data: applied, error: e3 } = await db.rpc("apply_local_files", { p_drive_id: null });
  if (e3) errors.push(`apply_local_files: ${e3.message}`);

  const { count: pending } = await db.from("local_file")
    .select("file_id", { count: "exact", head: true }).eq("match_status", "pending");
  const { count: review } = await db.from("local_file")
    .select("file_id", { count: "exact", head: true }).eq("match_status", "review");

  return { groups: work.length, matched_files: matchedFiles, review_files: reviewFiles, methods,
           still_pending: pending ?? null, review_total: review ?? null, stopped_early: stoppedEarly,
           applied, errors: errors.slice(0, 20) };
}

async function localReview() {
  const { data, error } = await db.from("local_file")
    .select("file_id, file_path, parsed_title, parsed_year, parsed_kind, review_reason, candidates")
    .eq("match_status", "review").order("parsed_title").order("file_path").limit(1000);
  if (error) throw error;
  return { files: data };
}

// ---------- Helpers ----------
let trackedIds = new Set<number>();

async function loadTrackedProviders() {
  const { data, error } = await db
    .from("streaming_service")
    .select("service_id, tmdb_provider_id, logo_url")
    .eq("is_subscribed", true)
    .not("tmdb_provider_id", "is", null);
  if (error) throw error;
  trackedIds = new Set(data.map((s) => s.tmdb_provider_id as number));

  // Fill in missing logos from TMDB's provider list for the region.
  const missing = data.filter((s) => !s.logo_url);
  if (missing.length) {
    const list = await tmdb("/watch/providers/movie", { watch_region: REGION });
    for (const s of missing) {
      const p = (list.results ?? []).find((x: any) => x.provider_id === s.tmdb_provider_id);
      if (p?.logo_path) {
        await db.from("streaming_service")
          .update({ logo_url: `${IMG}/original${p.logo_path}` })
          .eq("service_id", s.service_id);
      }
    }
  }
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

function dedupe(refs: Ref[]): Ref[] {
  const seen = new Set<string>();
  return refs.filter((r) => {
    const k = `${r.type}:${r.tmdb_id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function importTitles(refs: Ref[]) {
  const errors: string[] = [];
  let skipped = 0;
  let onNetflix = 0;
  const ids = await pool(dedupe(refs), CONCURRENCY, async (ref) => {
    try {
      const payload = await buildPayload(ref, trackedIds);
      if (!payload) {
        skipped++;
        return null;
      }
      if (payload.providers.length) onNetflix++;
      const { data, error } = await db.rpc("upsert_tmdb_title", { p: payload, p_region: REGION });
      if (error) throw new Error(error.message);
      return data as number;
    } catch (e) {
      errors.push(`${ref.type} ${ref.tmdb_id}: ${(e as Error).message}`);
      return null;
    }
  });
  const titleIds = ids.filter((x): x is number => x !== null);

  let placed = 0;
  if (titleIds.length) {
    const { data, error } = await db.rpc("apply_availability_moves", { p_title_ids: titleIds });
    if (error) errors.push(`apply_availability_moves: ${error.message}`);
    else placed = data as number;
  }
  return { imported: titleIds.length, on_netflix_za: onNetflix, skipped, placed, errors: errors.slice(0, 20) };
}

// Callers send either the service role key, or x-sync-secret matching the
// Vault secret "tmdb_sync_secret" (used by the pg_cron schedule).
// The hard drive scanner sends x-scan-secret (Vault "local_scan_secret"): local_* modes only.
const LOCAL_MODES = ["local_scan", "local_match", "local_review"];

async function scannerAuthorised(req: Request): Promise<boolean> {
  const given = req.headers.get("x-scan-secret");
  if (!given) return false;
  const { data, error } = await db.rpc("check_local_scan_secret", { p_secret: given });
  return !error && data === true;
}

async function authorised(req: Request): Promise<boolean> {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (SERVICE_KEY && bearer === SERVICE_KEY) return true;
  const given = req.headers.get("x-sync-secret");
  if (!given) return false;
  if (SYNC_SECRET && given === SYNC_SECRET) return true;
  const { data, error } = await db.rpc("check_sync_secret", { p_secret: given });
  return !error && data === true;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// ---------- Handler ----------
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const started = Date.now();
  const body = await req.json().catch(() => ({}));
  const mode = body.mode ?? "discover";

  const ok = (await authorised(req)) || (LOCAL_MODES.includes(mode) && (await scannerAuthorised(req)));
  if (!ok) return json({ error: "unauthorised" }, 401);
  if (!TMDB_KEY) return json({ error: "TMDB_API_KEY secret is not set" }, 500);

  try {
    if (mode === "local_scan") {
      // Store one chunk of a scan. No TMDB calls.
      if (typeof body.drive !== "string" || !body.drive.trim()) return json({ error: "drive is required" }, 400);
      if (typeof body.scan_id !== "string") return json({ error: "scan_id is required" }, 400);
      if (!Array.isArray(body.files)) return json({ error: "files must be an array" }, 400);
      const { data, error } = await db.rpc("local_scan_sync", {
        p_drive: body.drive.trim(), p_volume: body.volume ?? null, p_scan_id: body.scan_id,
        p_files: body.files, p_final: body.final !== false, p_allow_shrink: body.allow_shrink === true,
      });
      if (error) throw new Error(error.message);
      return json({ mode, ...data });
    }
    if (mode === "local_review") return json({ mode, ...await localReview() });

    await loadTrackedProviders();
    if (!trackedIds.size) return json({ error: "no subscribed service has a tmdb_provider_id" }, 500);

    if (mode === "scores") {
      const limit = Math.min(Math.max(Number(body.limit ?? 900), 1), 1000);
      return json({ mode, ...await scores(limit, started) });
    }
    if (mode === "omdb_probe") {
      // Diagnostic: show which rating sources OMDb returns for one IMDb id (1 OMDb call).
      const url = new URL("https://www.omdbapi.com/");
      url.searchParams.set("apikey", OMDB_KEY);
      url.searchParams.set("i", String(body.imdb_id ?? "tt0111161"));
      const o = await (await fetch(url)).json();
      return json({ mode, keys: Object.keys(o), imdbRating: o.imdbRating, Ratings: o.Ratings ?? null,
                    Metascore: o.Metascore ?? null, Response: o.Response, Error: o.Error ?? null });
    }
    if (mode === "local_match") {
      const limit = Math.min(Math.max(Number(body.limit ?? 300), 1), 600);
      return json({ mode, ...await localMatch(limit, started) });
    }
    if (mode === "letterboxd") {
      const limit = Math.min(Math.max(Number(body.limit ?? 150), 1), 300);
      return json({ mode, ...await letterboxdImport(limit, started) });
    }
    if (mode === "estimate") return json({ mode, region: REGION, min_votes: MIN_VOTES, ...await estimate() });
    if (mode === "backfill") {
      const maxTitles = Math.min(Math.max(Number(body.max_titles ?? 400), 20), 1000);
      return json({ mode, region: REGION, ...await backfill(maxTitles, started) });
    }

    let refs: Ref[] = [];
    if (mode === "discover") {
      const pages = Math.min(Math.max(Number(body.pages ?? 3), 1), MAX_PAGES);
      const start = Math.max(Number(body.start_page ?? 1), 1);
      for (const type of ["movie", "series"] as TitleType[]) {
        refs.push(...await netflixPages(type, start, pages));
        refs.push(...await trendingPages(type, start, pages));
      }
    } else if (mode === "title") {
      const type: TitleType = body.type === "series" ? "series" : "movie";
      if (!Number.isInteger(body.tmdb_id)) return json({ error: "tmdb_id (integer) is required" }, 400);
      refs = [{ tmdb_id: body.tmdb_id, type }];
    } else if (mode === "refresh") {
      const limit = Math.min(Math.max(Number(body.limit ?? 100), 1), 400);
      let q = db.from("title").select("tmdb_id, title_type").not("tmdb_id", "is", null);
      // One-off release backfill: titles imported before release data was stored.
      if (body.missing_release) q = q.is("release_checked_at", null);
      const { data, error } = await q.order("tmdb_synced_at", { ascending: true, nullsFirst: true }).limit(limit);
      if (error) throw error;
      refs = data.map((t) => ({ tmdb_id: t.tmdb_id as number, type: t.title_type as TitleType }));
      if (body.missing_release && refs.length === 0) {
        await db.rpc("finish_release_backfill");
        return json({ mode, missing_release: true, done: true });
      }
    } else {
      return json({ error: `unknown mode ${mode}` }, 400);
    }

    const result = await importTitles(refs);
    return json({ mode, region: REGION, candidates: refs.length, ...result });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
