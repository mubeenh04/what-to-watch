-- IMDb ratings for every title from IMDb's daily dataset (Edge Function imdb-ratings),
-- instead of waiting for OMDb's 1,000 calls a day. OMDb stays on for Metacritic.

ALTER TABLE title ADD COLUMN IF NOT EXISTS imdb_votes INTEGER NULL CHECK (imdb_votes >= 0);
ALTER TABLE title ADD COLUMN IF NOT EXISTS imdb_rating_updated_at TIMESTAMPTZ NULL;

-- p: [{"i": "tt0111161", "r": 9.3, "v": 3000000}, ...]
CREATE OR REPLACE FUNCTION set_imdb_ratings(p JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE title t
       SET imdb_rating            = (x->>'r')::numeric(3,1),
           imdb_votes             = (x->>'v')::integer,
           imdb_rating_updated_at = now()
      FROM jsonb_array_elements(p) x
     WHERE t.imdb_id = x->>'i';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION set_imdb_ratings(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_imdb_ratings(JSONB) TO service_role;

-- OMDb no longer decides the IMDb rating once the dataset has one (the dataset is newer).
CREATE OR REPLACE FUNCTION set_title_scores(p JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE title t
       SET imdb_rating       = CASE WHEN t.imdb_rating_updated_at IS NOT NULL THEN t.imdb_rating
                                    ELSE COALESCE((x->>'imdb_rating')::numeric(3,1), t.imdb_rating) END,
           rt_score          = COALESCE((x->>'rt_score')::smallint, t.rt_score),
           metacritic_score  = COALESCE((x->>'metacritic_score')::smallint, t.metacritic_score),
           scores_updated_at = now()
      FROM jsonb_array_elements(p) x
     WHERE t.title_id = (x->>'title_id')::bigint;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION set_title_scores(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_title_scores(JSONB) TO service_role;

CREATE OR REPLACE FUNCTION run_imdb_ratings(p_body JSONB DEFAULT '{}')
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT net.http_post(
        url     := 'https://ezedrdpzhgtwrfjmupvf.supabase.co/functions/v1/imdb-ratings',
        body    := p_body,
        headers := jsonb_build_object(
                     'content-type', 'application/json',
                     'x-sync-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
                                        WHERE name = 'tmdb_sync_secret')),
        timeout_milliseconds := 150000);
$$;
REVOKE ALL ON FUNCTION run_imdb_ratings(JSONB) FROM PUBLIC, anon, authenticated;

-- 04:30 SAST every night (after the TMDB sync has added new titles), plus a first run now.
SELECT cron.schedule('imdb-ratings', '30 2 * * *', $$SELECT public.run_imdb_ratings()$$);
SELECT public.run_imdb_ratings();
