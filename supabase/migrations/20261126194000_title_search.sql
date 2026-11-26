-- Fuzzy title search for the app's Home search bar.
-- Matches title names (and the top-billed cast) by trigram similarity, so typos and partial
-- words still match: "dnue" finds "Dune", "godzila" finds "Godzilla Minus One".

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS ix_title_name_trgm  ON title  USING gin (lower(name) extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_person_name_trgm ON person USING gin (lower(name) extensions.gin_trgm_ops);

-- Returns the signed-in user's titles in one section that match p_query, best match first.
-- SECURITY INVOKER: row-level security still limits it to the caller's own user_title rows.
CREATE OR REPLACE FUNCTION search_my_titles(
    p_query  TEXT,
    p_status title_status,
    p_type   title_type DEFAULT NULL,
    p_limit  INTEGER    DEFAULT 100
)
RETURNS TABLE (title_id BIGINT, score REAL)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
SET pg_trgm.word_similarity_threshold = 0.2
SET pg_trgm.similarity_threshold = 0.3
AS $$
    WITH q AS (SELECT lower(btrim(p_query)) AS q),
    hits AS (
        -- Title names: substring matches rank highest, then fuzzy word matches.
        SELECT t.title_id,
               GREATEST(
                   CASE WHEN lower(t.name) LIKE q.q || '%' THEN 1.0
                        WHEN lower(t.name) LIKE '%' || q.q || '%' THEN 0.9
                        ELSE 0 END,
                   word_similarity(q.q, lower(t.name)),
                   similarity(q.q, lower(t.name)),
                   -- One-word typos such as swapped letters ("dnue"), which trigrams score low.
                   CASE WHEN length(q.q) >= 4 AND q.q !~ '\s' THEN
                        (SELECT CASE WHEN min(levenshtein(q.q, w)) <= 1 THEN 0.8
                                     WHEN min(levenshtein(q.q, w)) <= 2 THEN 0.6
                                     ELSE 0 END
                           FROM regexp_split_to_table(lower(t.name), '[^[:alnum:]]+') w
                          WHERE w <> '')
                        ELSE 0 END
               )::real AS score
          FROM title t, q
         WHERE q.q <> ''
           AND (q.q <% lower(t.name) OR q.q % lower(t.name) OR lower(t.name) LIKE '%' || q.q || '%')
        UNION ALL
        -- Actors in the top five billed, ranked a little below a name match.
        SELECT tc.title_id, (word_similarity(q.q, lower(p.name)) * 0.8)::real
          FROM person p
          JOIN title_cast tc ON tc.person_id = p.person_id AND tc.billing_order <= 5
         CROSS JOIN q
         WHERE length(q.q) >= 3
           AND q.q <% lower(p.name)
    )
    SELECT h.title_id, max(h.score) AS score
      FROM hits h
      JOIN user_title ut ON ut.title_id = h.title_id
                        AND ut.user_id = auth.uid()
                        AND ut.status = p_status
      JOIN title t ON t.title_id = h.title_id
     WHERE p_type IS NULL OR t.title_type = p_type
     GROUP BY h.title_id
     ORDER BY score DESC, h.title_id
     LIMIT LEAST(GREATEST(p_limit, 1), 200);
$$;

REVOKE ALL ON FUNCTION search_my_titles(TEXT, title_status, title_type, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION search_my_titles(TEXT, title_status, title_type, INTEGER) TO authenticated;
