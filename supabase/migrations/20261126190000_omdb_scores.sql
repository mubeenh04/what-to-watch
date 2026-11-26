-- Nightly IMDb and Rotten Tomatoes scores from OMDb (secret OMDB_API_KEY).
-- Free tier is 1,000 calls a day, so each night scores at most 900 titles:
-- unscored Netflix ZA titles first, then unscored titles by TMDB popularity,
-- then scores older than 30 days (refresh).

-- TMDB popularity, used to decide which titles get scored first.
ALTER TABLE title ADD COLUMN tmdb_popularity REAL NULL;
CREATE INDEX ix_title_scores_queue ON title (scores_updated_at NULLS FIRST, tmdb_popularity DESC NULLS LAST)
    WHERE imdb_id IS NOT NULL;

-- Same as in tmdb_netflix_za, plus tmdb_popularity.
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

    RETURN v_title_id;
END;
$$;

-- Next titles to score.
CREATE OR REPLACE FUNCTION next_titles_for_scores(p_limit INTEGER)
RETURNS TABLE (title_id BIGINT, imdb_id VARCHAR)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT t.title_id, t.imdb_id
      FROM title t
     WHERE t.imdb_id IS NOT NULL
       AND (t.scores_updated_at IS NULL OR t.scores_updated_at < now() - interval '30 days')
     ORDER BY (t.scores_updated_at IS NULL) DESC,
              EXISTS (SELECT 1 FROM title_availability a
                       WHERE a.title_id = t.title_id AND a.source_type = 'streaming') DESC,
              t.tmdb_popularity DESC NULLS LAST,
              t.scores_updated_at ASC NULLS FIRST
     LIMIT p_limit;
$$;

-- p: [{"title_id": 1, "imdb_rating": 7.8, "rt_score": 93}, ...]  (nulls allowed)
-- Every listed title gets scores_updated_at = now(), so titles OMDb has no score for
-- aren't retried until the 30-day refresh.
CREATE OR REPLACE FUNCTION set_title_scores(p JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE title t
       SET imdb_rating       = COALESCE((x->>'imdb_rating')::numeric(3,1), t.imdb_rating),
           rt_score          = COALESCE((x->>'rt_score')::smallint, t.rt_score),
           scores_updated_at = now()
      FROM jsonb_array_elements(p) x
     WHERE t.title_id = (x->>'title_id')::bigint;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION next_titles_for_scores(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION set_title_scores(JSONB)         FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION next_titles_for_scores(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION set_title_scores(JSONB)         TO service_role;

-- 04:00 SAST every night, plus a first run straight away.
SELECT cron.schedule('omdb-scores', '0 2 * * *', $$SELECT public.run_tmdb_sync('{"mode":"scores","limit":900}')$$);
SELECT public.run_tmdb_sync('{"mode":"scores","limit":900}');
