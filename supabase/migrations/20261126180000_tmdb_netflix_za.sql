-- TMDB link: Netflix South Africa as the only streaming service.
-- Availability comes from TMDB's per-country watch providers (JustWatch data).

-- ---------- Streaming service: map to TMDB provider ids ----------
ALTER TABLE streaming_service ADD COLUMN tmdb_provider_id INTEGER NULL UNIQUE;

INSERT INTO streaming_service (name, logo_url, is_subscribed, display_order, tmdb_provider_id)
VALUES ('Netflix', NULL, TRUE, 1, 8)
ON CONFLICT (name) DO UPDATE
   SET tmdb_provider_id = EXCLUDED.tmdb_provider_id,
       is_subscribed    = TRUE;

-- ---------- Sync bookkeeping ----------
ALTER TABLE title ADD COLUMN tmdb_synced_at TIMESTAMPTZ NULL;
CREATE INDEX ix_title_tmdb_synced ON title (tmdb_synced_at NULLS FIRST);

-- ---------- Replace a title's streaming rows for one region ----------
-- p_providers: [{"provider_id": 8, "link": "https://www.themoviedb.org/movie/.../watch?locale=ZA"}]
-- Only flatrate (subscription) providers should be passed in.
CREATE OR REPLACE FUNCTION set_title_providers(p_title_id BIGINT, p_region CHAR(2), p_providers JSONB)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    -- Remove rows for tracked services that TMDB no longer lists in this region.
    DELETE FROM title_availability a
     USING streaming_service s
     WHERE a.service_id = s.service_id
       AND a.title_id = p_title_id
       AND a.region_code = p_region
       AND s.tmdb_provider_id IS NOT NULL
       AND NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(p_providers) p
              WHERE (p->>'provider_id')::int = s.tmdb_provider_id);

    -- Add or refresh rows for tracked services TMDB does list.
    INSERT INTO title_availability (title_id, source_type, service_id, region_code, watch_url, last_checked_at)
    SELECT p_title_id, 'streaming', s.service_id, p_region, left(p->>'link', 1000), now()
      FROM jsonb_array_elements(p_providers) p
      JOIN streaming_service s ON s.tmdb_provider_id = (p->>'provider_id')::int
    ON CONFLICT (title_id, service_id, region_code) WHERE service_id IS NOT NULL
    DO UPDATE SET watch_url = EXCLUDED.watch_url, last_checked_at = now();
END;
$$;

-- ---------- Upsert one title from a TMDB payload ----------
-- p: {type: movie|series, tmdb_id, name, release_year, end_year, synopsis, poster_url, imdb_id,
--     genres: [name, ...], cast: [{tmdb_id, name, character}, ...], providers: [...]}
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
                            imdb_id, tmdb_id, letterboxd_url, tmdb_synced_at, updated_at)
    VALUES ((p->>'type')::title_type,
            left(p->>'name', 300),
            (p->>'release_year')::smallint,
            (p->>'end_year')::smallint,
            p->>'synopsis',
            p->>'poster_url',
            v_imdb,
            (p->>'tmdb_id')::int,
            CASE WHEN p->>'type' = 'movie' THEN 'https://letterboxd.com/tmdb/' || (p->>'tmdb_id') END,
            now(), now())
    ON CONFLICT (tmdb_id, title_type) DO UPDATE
       SET name           = EXCLUDED.name,
           release_year   = EXCLUDED.release_year,
           end_year       = EXCLUDED.end_year,
           synopsis       = EXCLUDED.synopsis,
           poster_url     = EXCLUDED.poster_url,
           imdb_id        = COALESCE(EXCLUDED.imdb_id, t.imdb_id),
           letterboxd_url = COALESCE(t.letterboxd_url, EXCLUDED.letterboxd_url),
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

-- ---------- Place titles in Home or Explore ----------
-- A title is "available" to a user when it has a streaming row on a subscribed service for
-- the user's region (Netflix ZA today) or a row on a local drive.
-- * Watchlist and Explore titles that become available move to Home (action 'sync').
-- * Titles the user has no row for yet go to Home if available, otherwise to Explore.
-- * Home, History, Hidden and Removed are never touched.
-- A title TMDB can't confirm for the user's region is not available, so it never auto-moves.
-- Returns the number of rows moved or added.
CREATE OR REPLACE FUNCTION apply_availability_moves(p_title_ids BIGINT[] DEFAULT NULL, p_user_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_moved INTEGER := 0;
    v_added INTEGER := 0;
BEGIN
    DROP TABLE IF EXISTS _available;
    CREATE TEMP TABLE _available ON COMMIT DROP AS
    SELECT DISTINCT u.user_id, a.title_id
      FROM title_availability a
      JOIN streaming_service s ON s.service_id = a.service_id AND s.is_subscribed
      JOIN app_user u          ON u.region_code = a.region_code
     WHERE a.source_type = 'streaming'
       AND (p_title_ids IS NULL OR a.title_id = ANY (p_title_ids))
       AND (p_user_id IS NULL OR u.user_id = p_user_id)
    UNION
    SELECT u.user_id, a.title_id
      FROM title_availability a
     CROSS JOIN app_user u
     WHERE a.source_type = 'local'
       AND (p_title_ids IS NULL OR a.title_id = ANY (p_title_ids))
       AND (p_user_id IS NULL OR u.user_id = p_user_id);

    -- Watchlist / Explore -> Home
    DROP TABLE IF EXISTS _moved;
    CREATE TEMP TABLE _moved ON COMMIT DROP AS
    SELECT ut.user_id, ut.title_id, ut.status AS old_status
      FROM user_title ut
      JOIN _available av ON av.user_id = ut.user_id AND av.title_id = ut.title_id
     WHERE ut.status IN ('watchlist', 'explore');

    UPDATE user_title ut
       SET status = 'home', status_changed_at = now()
      FROM _moved m
     WHERE ut.user_id = m.user_id AND ut.title_id = m.title_id;

    INSERT INTO title_status_event (user_id, title_id, from_status, to_status, action)
    SELECT user_id, title_id, old_status, 'home', 'sync' FROM _moved;
    GET DIAGNOSTICS v_moved = ROW_COUNT;

    -- New to this user -> Home if available, else Explore
    DROP TABLE IF EXISTS _added;
    CREATE TEMP TABLE _added (user_id UUID, title_id BIGINT, status title_status) ON COMMIT DROP;

    WITH ins AS (
        INSERT INTO user_title (user_id, title_id, status, recommended_at)
        SELECT u.user_id, t.title_id,
               CASE WHEN av.title_id IS NOT NULL THEN 'home' ELSE 'explore' END::title_status,
               CASE WHEN av.title_id IS NULL THEN now() END
          FROM title t
         CROSS JOIN app_user u
          LEFT JOIN _available av ON av.user_id = u.user_id AND av.title_id = t.title_id
         WHERE (p_title_ids IS NULL OR t.title_id = ANY (p_title_ids))
           AND (p_user_id IS NULL OR u.user_id = p_user_id)
        ON CONFLICT (user_id, title_id) DO NOTHING
        RETURNING user_id, title_id, status
    )
    INSERT INTO _added SELECT user_id, title_id, status FROM ins;

    INSERT INTO title_status_event (user_id, title_id, from_status, to_status, action)
    SELECT user_id, title_id, NULL, status, 'sync' FROM _added;
    GET DIAGNOSTICS v_added = ROW_COUNT;

    RETURN v_moved + v_added;
END;
$$;

-- ---------- Triggers ----------
-- A new profile gets every synced title placed in Home or Explore straight away.
CREATE OR REPLACE FUNCTION trg_place_titles_for_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM apply_availability_moves(NULL, NEW.user_id);
    RETURN NULL;
END;
$$;
CREATE TRIGGER place_titles_for_new_user
AFTER INSERT ON app_user
FOR EACH ROW EXECUTE FUNCTION trg_place_titles_for_new_user();

-- Adding hard-drive rows moves those titles to Home (from Watchlist or Explore).
CREATE OR REPLACE FUNCTION trg_local_availability_moves()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ids BIGINT[];
BEGIN
    SELECT array_agg(DISTINCT title_id) INTO v_ids FROM new_rows WHERE source_type = 'local';
    IF v_ids IS NOT NULL THEN
        PERFORM apply_availability_moves(v_ids);
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER local_availability_moves
AFTER INSERT ON title_availability
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION trg_local_availability_moves();

-- Only the sync job (service role) may call these.
REVOKE ALL ON FUNCTION set_title_providers(BIGINT, CHAR, JSONB)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION upsert_tmdb_title(JSONB, CHAR)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION apply_availability_moves(BIGINT[], UUID)  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_title_providers(BIGINT, CHAR, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION upsert_tmdb_title(JSONB, CHAR)           TO service_role;
GRANT EXECUTE ON FUNCTION apply_availability_moves(BIGINT[], UUID) TO service_role;
REVOKE ALL ON FUNCTION trg_place_titles_for_new_user()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION trg_local_availability_moves()            FROM PUBLIC, anon, authenticated;
