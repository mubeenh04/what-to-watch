-- Letterboxd import: films a user has logged on Letterboxd go to their History.
--
-- Flow
--  1. scripts/letterboxd/build_import_sql.py turns a Letterboxd export zip into INSERTs for
--     letterboxd_import (one row per film, keyed by Letterboxd username). The generated file
--     holds personal data, so it is never committed.
--  2. tmdb-sync mode "letterboxd" matches each pending row to TMDB (the film's Letterboxd page
--     first, then a strict name + year search), adds missing titles to the catalogue and marks
--     the row matched, or puts it on the review list (match_status 'review') instead of guessing.
--  3. apply_letterboxd_import() moves matched films to History for the app_user whose
--     letterboxd_username matches. It runs after matching, and again by trigger when a profile
--     is created or gets its letterboxd_username, so an import loaded before sign-in waits.
--
-- Rules: History rows are never changed. Home, Explore and Watchlist rows move to History.
-- Hidden and Removed rows are left alone (reported as kept_hidden / kept_removed).

-- ---------- The user's own rating (Letterboxd scale, 0.5 to 5 stars) ----------
ALTER TABLE user_title ADD COLUMN user_rating NUMERIC(2,1) NULL
    CHECK ((user_rating BETWEEN 0.5 AND 5) AND user_rating * 2 = floor(user_rating * 2));

-- ---------- Staging + review list ----------
CREATE TABLE letterboxd_import (
    import_row_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    letterboxd_username  VARCHAR(100) NOT NULL,
    film_name            VARCHAR(300) NOT NULL,
    film_year            SMALLINT     NULL,
    letterboxd_uri       VARCHAR(500) NULL,          -- film link from watched.csv / ratings.csv
    watched_on           DATE         NOT NULL,      -- latest diary date, else the watched.csv date
    rating               NUMERIC(2,1) NULL CHECK (rating BETWEEN 0.5 AND 5),
    match_status         VARCHAR(10)  NOT NULL DEFAULT 'pending'
                         CHECK (match_status IN ('pending', 'matched', 'review')),
    match_method         VARCHAR(20)  NULL,          -- letterboxd_page, tmdb_search, manual
    review_reason        VARCHAR(300) NULL,
    candidates           JSONB        NULL,          -- TMDB options shown on the review list
    title_type           title_type   NULL,
    tmdb_id              INTEGER      NULL,          -- set by hand to resolve a review row
    title_id             BIGINT       NULL REFERENCES title (title_id) ON DELETE SET NULL,
    letterboxd_film_url  VARCHAR(500) NULL,
    matched_at           TIMESTAMPTZ  NULL,
    user_id              UUID         NULL REFERENCES app_user (user_id) ON DELETE SET NULL,
    applied_at           TIMESTAMPTZ  NULL,
    applied_result       VARCHAR(20)  NULL,          -- added, moved_from_<status>, already_history, kept_<status>
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (letterboxd_username, film_name, film_year)
);
CREATE INDEX ix_letterboxd_import_status ON letterboxd_import (match_status, applied_at);

ALTER TABLE letterboxd_import ENABLE ROW LEVEL SECURITY;
-- A signed-in user can read their own import (for an in-app review list later).
CREATE POLICY letterboxd_import_select_own ON letterboxd_import
    FOR SELECT TO authenticated
    USING (lower(letterboxd_username) = (SELECT lower(letterboxd_username) FROM app_user
                                          WHERE user_id = auth.uid()));

-- ---------- Apply matched rows to History ----------
-- p_username NULL = every username that has a profile. Returns counts per result.
CREATE OR REPLACE FUNCTION apply_letterboxd_import(p_username TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSONB;
BEGIN
    DROP TABLE IF EXISTS _lb;
    CREATE TEMP TABLE _lb ON COMMIT DROP AS
    SELECT DISTINCT ON (u.user_id, i.title_id)
           i.import_row_id, u.user_id, i.title_id, i.rating,
           -- noon in South Africa, so the date never shifts in the app
           (i.watched_on + TIME '12:00') AT TIME ZONE 'Africa/Johannesburg' AS watched_at,
           ut.status AS old_status
      FROM letterboxd_import i
      JOIN app_user u ON lower(u.letterboxd_username) = lower(i.letterboxd_username)
      LEFT JOIN user_title ut ON ut.user_id = u.user_id AND ut.title_id = i.title_id
     WHERE i.match_status = 'matched'
       AND i.title_id IS NOT NULL
       AND i.applied_at IS NULL
       AND (p_username IS NULL OR lower(i.letterboxd_username) = lower(p_username))
     ORDER BY u.user_id, i.title_id, i.watched_on DESC;

    -- New to the user: straight into History.
    INSERT INTO user_title (user_id, title_id, status, watched_at, user_rating)
    SELECT user_id, title_id, 'history', watched_at, rating FROM _lb WHERE old_status IS NULL
    ON CONFLICT (user_id, title_id) DO NOTHING;

    -- Home / Explore / Watchlist: move to History.
    UPDATE user_title ut
       SET status = 'history', status_changed_at = now(), watched_at = l.watched_at,
           user_rating = COALESCE(l.rating, ut.user_rating)
      FROM _lb l
     WHERE ut.user_id = l.user_id AND ut.title_id = l.title_id
       AND l.old_status IN ('home', 'explore', 'watchlist')
       AND ut.status = l.old_status;

    INSERT INTO title_status_event (user_id, title_id, from_status, to_status, action)
    SELECT user_id, title_id, old_status, 'history', 'letterboxd'
      FROM _lb WHERE old_status IS NULL OR old_status IN ('home', 'explore', 'watchlist');

    -- Mark every import row for these users/titles as applied (duplicates included).
    UPDATE letterboxd_import i
       SET applied_at = now(), user_id = l.user_id,
           applied_result = CASE
               WHEN l.old_status IS NULL                             THEN 'added'
               WHEN l.old_status IN ('home', 'explore', 'watchlist') THEN 'moved_from_' || l.old_status
               WHEN l.old_status = 'history'                         THEN 'already_history'
               ELSE 'kept_' || l.old_status END
      FROM _lb l
      JOIN app_user u ON u.user_id = l.user_id
     WHERE i.title_id = l.title_id
       AND lower(i.letterboxd_username) = lower(u.letterboxd_username)
       AND i.match_status = 'matched' AND i.applied_at IS NULL;

    SELECT COALESCE(jsonb_object_agg(r, n), '{}') INTO v_result
      FROM (SELECT CASE
                     WHEN old_status IS NULL THEN 'added'
                     WHEN old_status IN ('home', 'explore', 'watchlist') THEN 'moved_from_' || old_status
                     WHEN old_status = 'history' THEN 'already_history'
                     ELSE 'kept_' || old_status END AS r, count(*) AS n
              FROM _lb GROUP BY 1) s;
    RETURN v_result;
END;
$$;

-- A profile that is created later (first sign-in) or gets its Letterboxd username picks up
-- any import waiting for it.
CREATE OR REPLACE FUNCTION trg_apply_letterboxd_import()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM apply_letterboxd_import(NEW.letterboxd_username);
    RETURN NULL;
END;
$$;
CREATE TRIGGER letterboxd_import_for_profile
AFTER INSERT OR UPDATE OF letterboxd_username ON app_user
FOR EACH ROW WHEN (NEW.letterboxd_username IS NOT NULL)
EXECUTE FUNCTION trg_apply_letterboxd_import();

-- Resolve a review-list row by hand: give it the right TMDB id, then run the matcher again
-- (SELECT run_tmdb_sync('{"mode":"letterboxd"}')).
CREATE OR REPLACE FUNCTION resolve_letterboxd_review(p_import_row_id BIGINT, p_tmdb_id INTEGER,
                                                     p_type title_type DEFAULT 'movie')
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE letterboxd_import
       SET tmdb_id = p_tmdb_id, title_type = p_type, match_status = 'pending',
           review_reason = NULL, applied_at = NULL
     WHERE import_row_id = p_import_row_id;
$$;

REVOKE ALL ON FUNCTION apply_letterboxd_import(TEXT)                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION trg_apply_letterboxd_import()                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION resolve_letterboxd_review(BIGINT, INTEGER, title_type) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_letterboxd_import(TEXT)                        TO service_role;
GRANT EXECUTE ON FUNCTION resolve_letterboxd_review(BIGINT, INTEGER, title_type) TO service_role;
