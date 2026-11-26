-- Initial seed: walk TMDB year by year for two sources, a slice every few minutes.
--   netflix: everything streaming on Netflix ZA (sorted into Home)
--   popular: every movie and series with 100+ TMDB votes, wherever it streams
--            (sorted into Home if on Netflix ZA, otherwise Explore)
-- The vote threshold is the TMDB_MIN_VOTES function secret (default 100).
CREATE TABLE sync_backfill (
    id           TEXT PRIMARY KEY,
    source       TEXT        NOT NULL CHECK (source IN ('netflix', 'popular')),
    title_type   title_type  NOT NULL,
    sort         SMALLINT    NOT NULL,
    year         SMALLINT    NOT NULL,   -- next year to fetch; walks down to 1900
    page         SMALLINT    NOT NULL DEFAULT 1,
    titles_seen  INTEGER     NOT NULL DEFAULT 0,
    done         BOOLEAN     NOT NULL DEFAULT FALSE,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE sync_backfill ENABLE ROW LEVEL SECURITY;   -- service role only

INSERT INTO sync_backfill (id, source, title_type, sort, year) VALUES
    ('netflix:movie',  'netflix', 'movie',  1, extract(year FROM now())::int + 1),
    ('netflix:series', 'netflix', 'series', 2, extract(year FROM now())::int + 1),
    ('popular:movie',  'popular', 'movie',  3, extract(year FROM now())::int + 1),
    ('popular:series', 'popular', 'series', 4, extract(year FROM now())::int + 1);

-- Stops the backfill schedule once every source is done.
CREATE OR REPLACE FUNCTION finish_tmdb_backfill()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'tmdb-backfill';
$$;
REVOKE ALL ON FUNCTION finish_tmdb_backfill() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finish_tmdb_backfill() TO service_role;

-- One slice every 2 minutes until done (each slice is capped at ~110 s).
SELECT cron.schedule('tmdb-backfill', '*/2 * * * *', $$SELECT public.run_tmdb_sync('{"mode":"backfill","max_titles":400}')$$);
