-- OMDb no longer returns Rotten Tomatoes scores (checked 2026-11-26: only IMDb and Metacritic).
-- Store OMDb's Metacritic score (0-100) as the card's second score.
ALTER TABLE title ADD COLUMN metacritic_score SMALLINT NULL CHECK (metacritic_score BETWEEN 0 AND 100);

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

-- Re-queue the titles scored before Metacritic was stored, so tonight's run picks them up first.
UPDATE title SET scores_updated_at = NULL WHERE scores_updated_at IS NOT NULL AND metacritic_score IS NULL;
