-- Fix: genre_id (SMALLINT identity) ran out at 32,767 because every title upsert's
-- INSERT ... ON CONFLICT DO NOTHING used up sequence values, although only ~27 genres exist.
-- 1) widen genre_id to INTEGER, 2) stop wasting sequence values,
-- 3) rewind the popular-movies backfill past the slices that failed (19:44-19:50 UTC).

ALTER TABLE title_genre ALTER COLUMN genre_id TYPE INTEGER;
ALTER TABLE genre       ALTER COLUMN genre_id TYPE INTEGER;
ALTER TABLE genre       ALTER COLUMN genre_id SET MAXVALUE 2147483647;
ALTER TABLE genre       ALTER COLUMN genre_id RESTART WITH 100000;

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
    -- Only insert names that are new: ON CONFLICT alone still uses up a sequence value per row.
    INSERT INTO genre (name)
    SELECT DISTINCT left(g, 50) FROM jsonb_array_elements_text(COALESCE(p->'genres', '[]')) g
     WHERE NOT EXISTS (SELECT 1 FROM genre x WHERE x.name = left(g, 50))
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

UPDATE sync_backfill SET year = 2019, page = 1, updated_at = now() WHERE id = 'popular:movie' AND NOT done;
