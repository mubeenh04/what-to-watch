-- Release status for Explore and Watchlist cards and filters.
-- Movies: TMDB /movie/{id}/release_dates for ZA, falling back to US when ZA has none.
-- Series: TMDB has no release_dates for TV, so status comes from the first air date.

CREATE TYPE release_type AS ENUM ('premiere', 'theatrical_limited', 'theatrical', 'digital', 'physical', 'tv');
-- Furthest stage reached as of today. Order matters: later values are "more available".
CREATE TYPE release_status AS ENUM ('upcoming', 'premiered', 'in_cinemas', 'digital', 'physical', 'on_tv');

-- One row per dated release event (TMDB types 1-6).
CREATE TABLE title_release (
    title_id       BIGINT       NOT NULL REFERENCES title (title_id) ON DELETE CASCADE,
    region_code    CHAR(2)      NOT NULL,          -- 'ZA', or 'US' when ZA had no dates
    release_type   release_type NOT NULL,
    release_date   DATE         NOT NULL,
    certification  VARCHAR(20)  NULL,              -- e.g. 16, PG-13
    note           VARCHAR(200) NULL,              -- e.g. festival name, "Netflix"
    PRIMARY KEY (title_id, region_code, release_type, release_date)
);
CREATE INDEX ix_title_release_date ON title_release (release_type, release_date);
ALTER TABLE title_release ENABLE ROW LEVEL SECURITY;
CREATE POLICY read_title_release ON title_release FOR SELECT TO authenticated USING (true);

-- Derived on title so cards and filters need no join.
ALTER TABLE title
    ADD COLUMN release_status     release_status NULL,
    ADD COLUMN release_region     CHAR(2)        NULL,
    ADD COLUMN next_release_type  release_type   NULL,   -- next dated event after today, if any
    ADD COLUMN next_release_date  DATE           NULL,
    ADD COLUMN release_checked_at TIMESTAMPTZ    NULL;   -- last time TMDB release data was stored
CREATE INDEX ix_title_release_status ON title (release_status);
CREATE INDEX ix_title_release_unchecked ON title (tmdb_synced_at) WHERE release_checked_at IS NULL;

-- Recompute status for some titles (or all when NULL). Run nightly so "upcoming" turns into
-- "in_cinemas" etc. as dates pass.
CREATE OR REPLACE FUNCTION refresh_release_status(p_title_ids BIGINT[] DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    WITH s AS (
        SELECT t.title_id,
               CASE
                 WHEN t.title_type = 'series' THEN
                   CASE WHEN EXISTS (SELECT 1 FROM title_release r WHERE r.title_id = t.title_id
                                       AND r.release_type = 'tv' AND r.release_date <= current_date)
                        THEN 'on_tv'
                        WHEN EXISTS (SELECT 1 FROM title_release r WHERE r.title_id = t.title_id)
                        THEN 'upcoming' END
                 ELSE
                   (SELECT CASE max(CASE r.release_type
                                      WHEN 'physical' THEN 5 WHEN 'digital' THEN 4 WHEN 'tv' THEN 4
                                      WHEN 'theatrical' THEN 3 WHEN 'theatrical_limited' THEN 3
                                      WHEN 'premiere' THEN 2 END)
                             WHEN 5 THEN 'physical' WHEN 4 THEN 'digital' WHEN 3 THEN 'in_cinemas'
                             WHEN 2 THEN 'premiered' END
                      FROM title_release r
                     WHERE r.title_id = t.title_id AND r.release_date <= current_date)
               END AS status,
               (SELECT r.release_type FROM title_release r
                 WHERE r.title_id = t.title_id AND r.release_date > current_date
                 ORDER BY r.release_date LIMIT 1) AS next_type,
               (SELECT min(r.release_date) FROM title_release r
                 WHERE r.title_id = t.title_id AND r.release_date > current_date) AS next_date,
               EXISTS (SELECT 1 FROM title_release r WHERE r.title_id = t.title_id) AS has_rows
          FROM title t
         WHERE p_title_ids IS NULL OR t.title_id = ANY (p_title_ids)
    )
    UPDATE title t
       SET release_status    = COALESCE(s.status::release_status,
                                        CASE WHEN s.has_rows THEN 'upcoming'::release_status END),
           next_release_type = s.next_type,
           next_release_date = s.next_date
      FROM s
     WHERE t.title_id = s.title_id
       AND (t.release_status IS DISTINCT FROM COALESCE(s.status::release_status,
                                        CASE WHEN s.has_rows THEN 'upcoming'::release_status END)
            OR t.next_release_type IS DISTINCT FROM s.next_type
            OR t.next_release_date IS DISTINCT FROM s.next_date);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- Replace a title's release rows. p_releases: [{"type": 3, "date": "2026-10-03", "certification": "16", "note": ""}]
-- (TMDB type numbers 1-6). For series pass an empty array and p_first_air_date.
CREATE OR REPLACE FUNCTION set_title_releases(p_title_id BIGINT, p_region CHAR(2), p_releases JSONB,
                                              p_first_air_date DATE DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    DELETE FROM title_release WHERE title_id = p_title_id;

    INSERT INTO title_release (title_id, region_code, release_type, release_date, certification, note)
    SELECT DISTINCT ON (rt, d) p_title_id, COALESCE(p_region, 'US'), rt, d,
           NULLIF(left(x->>'certification', 20), ''), NULLIF(left(x->>'note', 200), '')
      FROM jsonb_array_elements(COALESCE(p_releases, '[]')) x,
           LATERAL (SELECT (ARRAY['premiere','theatrical_limited','theatrical','digital','physical','tv'])
                             [(x->>'type')::int]::release_type AS rt,
                           left(x->>'date', 10)::date AS d) v
     WHERE (x->>'type')::int BETWEEN 1 AND 6 AND x->>'date' IS NOT NULL
    ON CONFLICT DO NOTHING;

    IF p_first_air_date IS NOT NULL THEN
        INSERT INTO title_release (title_id, region_code, release_type, release_date)
        VALUES (p_title_id, COALESCE(p_region, 'US'), 'tv', p_first_air_date)
        ON CONFLICT DO NOTHING;
    END IF;

    UPDATE title SET release_region = CASE WHEN EXISTS (SELECT 1 FROM title_release WHERE title_id = p_title_id)
                                           THEN COALESCE(p_region, 'US') END,
                     release_checked_at = now()
     WHERE title_id = p_title_id;
    PERFORM refresh_release_status(ARRAY[p_title_id]);
END;
$$;

-- Same as in omdb_scores, plus release data.
CREATE OR REPLACE FUNCTION upsert_tmdb_title(p JSONB, p_region CHAR(2) DEFAULT 'ZA')
RETURNS BIGINT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_title_id BIGINT;
    v_imdb     TEXT := NULLIF(p->>'imdb_id', '');
BEGIN
    -- imdb_id is unique; drop it rather than fail if another row already holds it.
    IF v_imdb IS NOT NULL AND EXISTS (
         SELECT 1 FROM title WHERE imdb_id = v_imdb
            AND NOT (tmdb_id = (p->>'tmdb_id')::int AND title_type = (p->>'type')::title_type)) THEN
        v_imdb := NULL;
    END IF;

    INSERT INTO title AS t (title_type, name, release_year, end_year, synopsis, poster_url,
                            imdb_id, tmdb_id, letterboxd_url, tmdb_popularity, tmdb_synced_at, updated_at)
    VALUES ((p->>'type')::title_type,
            left(p->>'name', 300),
            (p->>'release_year')::smallint,
            (p->>'end_year')::smallint,
            p->>'synopsis',
            p->>'poster_url',
            v_imdb,
            (p->>'tmdb_id')::int,
            CASE WHEN p->>'type' = 'movie' THEN 'https://letterboxd.com/tmdb/' || (p->>'tmdb_id') END,
            (p->>'popularity')::real,
            now(), now())
    ON CONFLICT (tmdb_id, title_type) DO UPDATE
       SET name           = EXCLUDED.name,
           release_year   = EXCLUDED.release_year,
           end_year       = EXCLUDED.end_year,
           synopsis       = EXCLUDED.synopsis,
           poster_url     = EXCLUDED.poster_url,
           imdb_id        = COALESCE(EXCLUDED.imdb_id, t.imdb_id),
           letterboxd_url = COALESCE(t.letterboxd_url, EXCLUDED.letterboxd_url),
           tmdb_popularity = COALESCE(EXCLUDED.tmdb_popularity, t.tmdb_popularity),
           tmdb_synced_at = now(),
           updated_at     = now()
    RETURNING title_id INTO v_title_id;

    -- Genres, in TMDB order (rank 1 and 2 show on the card).
    INSERT INTO genre (name)
    SELECT DISTINCT left(g, 50) FROM jsonb_array_elements_text(COALESCE(p->'genres', '[]')) g
    ON CONFLICT (name) DO NOTHING;

    DELETE FROM title_genre WHERE title_id = v_title_id;
    INSERT INTO title_genre (title_id, genre_id, rank)
    SELECT v_title_id, gr.genre_id, row_number() OVER (ORDER BY min(x.ord))
      FROM jsonb_array_elements_text(COALESCE(p->'genres', '[]')) WITH ORDINALITY x(g, ord)
      JOIN genre gr ON gr.name = left(x.g, 50)
     GROUP BY gr.genre_id;

    -- Cast, in billing order (1 and 2 show on the card).
    INSERT INTO person (name, tmdb_id)
    SELECT DISTINCT ON ((c->>'tmdb_id')::int) left(c->>'name', 200), (c->>'tmdb_id')::int
      FROM jsonb_array_elements(COALESCE(p->'cast', '[]')) c
    ON CONFLICT (tmdb_id) DO UPDATE SET name = EXCLUDED.name;

    DELETE FROM title_cast WHERE title_id = v_title_id;
    INSERT INTO title_cast (title_id, person_id, billing_order, character_name)
    SELECT v_title_id, pe.person_id, row_number() OVER (ORDER BY min(x.ord)),
           left(min(x.c->>'character'), 200)
      FROM jsonb_array_elements(COALESCE(p->'cast', '[]')) WITH ORDINALITY x(c, ord)
      JOIN person pe ON pe.tmdb_id = (x.c->>'tmdb_id')::int
     GROUP BY pe.person_id;

    IF p ? 'providers' THEN
        PERFORM set_title_providers(v_title_id, p_region, p->'providers');
    END IF;

    IF p ? 'releases' THEN
        PERFORM set_title_releases(v_title_id, p->>'release_region', p->'releases', (p->>'first_air_date')::date);
    END IF;

    RETURN v_title_id;
END;
$$;

-- Ends the one-off release backfill once every title has release data.
CREATE OR REPLACE FUNCTION finish_release_backfill()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'tmdb-release-backfill';
$$;

REVOKE ALL ON FUNCTION refresh_release_status(BIGINT[])               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION set_title_releases(BIGINT, CHAR, JSONB, DATE)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finish_release_backfill()                      FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION refresh_release_status(BIGINT[])              TO service_role;
GRANT EXECUTE ON FUNCTION set_title_releases(BIGINT, CHAR, JSONB, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION finish_release_backfill()                     TO service_role;

-- Nightly at 03:45 SAST: roll statuses forward as dates pass.
SELECT cron.schedule('release-status-refresh', '45 1 * * *', $$SELECT public.refresh_release_status()$$);

-- One-off: re-fetch titles imported before release data existed, 400 every 2 minutes
-- (about 1 to 2 hours), then the job removes itself.
SELECT cron.schedule('tmdb-release-backfill', '1-59/2 * * * *',
                     $$SELECT public.run_tmdb_sync('{"mode":"refresh","missing_release":true,"limit":400}')$$);
