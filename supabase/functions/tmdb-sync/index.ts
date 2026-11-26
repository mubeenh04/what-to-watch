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
  if (!(await authorised(req))) return json({ error: "unauthorised" }, 401);
  if (!TMDB_KEY) return json({ error: "TMDB_API_KEY secret is not set" }, 500);

  const started = Date.now();
  const body = await req.json().catch(() => ({}));
  const mode = body.mode ?? "discover";

  try {
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
