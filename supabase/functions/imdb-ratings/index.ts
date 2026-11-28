// imdb-ratings: IMDb rating and vote count for every title, from IMDb's daily dataset.
//
// https://datasets.imdbws.com/title.ratings.tsv.gz lists tconst, averageRating and numVotes for
// every rated IMDb title and is refreshed daily (IMDb non-commercial datasets, personal use).
// One download covers every title with an imdb_id, so OMDb's 1,000 free calls a day are only
// needed for Metacritic.
//
// POST, JSON body (optional): { "dry_run": true } downloads and matches without writing.
// Auth: service role key, or x-sync-secret matching the Vault secret tmdb_sync_secret.
// Scheduled by pg_cron job imdb-ratings (migration imdb_ratings).

import { createClient } from "jsr:@supabase/supabase-js@2";

const IMDB_RATINGS_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BATCH = 5000;

const db = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY, {
  auth: { persistSession: false },
});

async function authorised(req: Request): Promise<boolean> {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (SERVICE_KEY && bearer === SERVICE_KEY) return true;
  const given = req.headers.get("x-sync-secret");
  if (!given) return false;
  const { data, error } = await db.rpc("check_sync_secret", { p_secret: given });
  return !error && data === true;
}

async function ourImdbIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += 1000) { // PostgREST returns at most 1,000 rows
    const { data, error } = await db.from("title").select("imdb_id")
      .not("imdb_id", "is", null).order("title_id").range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data) ids.add(r.imdb_id as string);
    if (data.length < 1000) break;
  }
  return ids;
}

async function run(dryRun: boolean) {
  const ids = await ourImdbIds();

  const res = await fetch(IMDB_RATINGS_URL);
  if (!res.ok || !res.body) throw new Error(`IMDb dataset: HTTP ${res.status}`);
  const reader = res.body.pipeThrough(new DecompressionStream("gzip"))
    .pipeThrough(new TextDecoderStream()).getReader();

  const hits: { i: string; r: number; v: number }[] = [];
  let rows = 0;
  const take = (line: string) => {
    const tab = line.indexOf("\t");
    if (tab <= 0) return;
    rows++;
    const id = line.slice(0, tab);
    if (!ids.has(id)) return;
    const [, r, v] = line.split("\t");
    const rating = Number(r), votes = Number(v);
    if (Number.isFinite(rating) && rating >= 0 && rating <= 10 && Number.isInteger(votes) && votes >= 0) {
      hits.push({ i: id, r: rating, v: votes });
    }
  };

  let rest = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = rest + value;
    let start = 0, nl: number;
    while ((nl = chunk.indexOf("\n", start)) !== -1) {
      take(chunk.slice(start, nl));
      start = nl + 1;
    }
    rest = chunk.slice(start);
  }
  if (rest) take(rest);

  let updated = 0;
  const errors: string[] = [];
  if (!dryRun) {
    for (let k = 0; k < hits.length; k += BATCH) {
      const { data, error } = await db.rpc("set_imdb_ratings", { p: hits.slice(k, k + BATCH) });
      if (error) errors.push(`set_imdb_ratings: ${error.message}`);
      else updated += data as number;
    }
  }
  return {
    dry_run: dryRun,
    titles_with_imdb_id: ids.size,
    dataset_rows: Math.max(rows - 1, 0), // minus the header line
    matched: hits.length,
    updated,
    sample: hits.slice(0, 3),
    errors,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!(await authorised(req))) return json({ error: "unauthorised" }, 401);
  const body = await req.json().catch(() => ({}));
  try {
    return json({ mode: "imdb_ratings", ...await run(body.dry_run === true) });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
