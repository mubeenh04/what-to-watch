-- Hard drive scan: video files on a local drive become titles in What to Watch.
--
-- Flow
--  1. scripts/local-drive/scan.py runs on the Mac (nightly, and when the drive is plugged in).
--     It walks the drive, skips samples/extras/tiny files, reads each file name with guessit and
--     sends the list to the tmdb-sync Edge Function (mode "local_scan"). It never renames,
--     moves or opens the files.
--  2. local_scan_sync() stores the list in local_file (one row per file). Files that are gone
--     from the drive lose their row and their title_availability row.
--  3. tmdb-sync mode "local_match" matches pending files to TMDB, grouped by title, so 40
--     episode files cost one search. Unclear names go on the review list (match_status
--     'review') instead of being guessed.
--  4. apply_local_files() adds a title_availability row (source_type 'local') per matched file.
--     The existing trigger local_availability_moves then moves those titles to Home, unless
--     they are in History, Hidden or Removed (apply_availability_moves never touches those).
--
-- Auth: the Mac sends x-scan-secret, matching the Vault secret local_scan_secret. That secret
-- only opens the local_* modes. Read it once in the SQL editor for the Mac's env file:
--   SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'local_scan_secret';

-- ---------- Drives ----------
ALTER TABLE local_drive ADD COLUMN IF NOT EXISTS last_file_count INTEGER NULL;
ALTER TABLE local_drive ADD COLUMN IF NOT EXISTS last_scan_id    UUID    NULL;

-- ---------- One row per video file ----------
CREATE TABLE IF NOT EXISTS local_file (
    file_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    drive_id       SMALLINT      NOT NULL REFERENCES local_drive (drive_id) ON DELETE CASCADE,
    file_path      VARCHAR(1000) NOT NULL,     -- relative to the drive (volume) root
    file_size      BIGINT        NULL,
    modified_at    TIMESTAMPTZ   NULL,
    -- What guessit read from the path
    parsed_title   VARCHAR(300)  NULL,
    parsed_year    SMALLINT      NULL,
    parsed_kind    VARCHAR(10)   NULL CHECK (parsed_kind IN ('movie', 'episode')),
    season         SMALLINT      NULL,
    episode        SMALLINT      NULL,
    tmdb_hint      INTEGER       NULL,         -- {tmdb-603} / [tmdbid-603] in the name
    imdb_hint      VARCHAR(12)   NULL,         -- tt0133093 in the name
    -- Matching
    match_status   VARCHAR(10)   NOT NULL DEFAULT 'pending'
                   CHECK (match_status IN ('pending', 'matched', 'review', 'ignored')),
    match_method   VARCHAR(20)   NULL,         -- tmdb_hint, imdb_hint, tmdb_search, near_year, manual
    review_reason  VARCHAR(300)  NULL,
    candidates     JSONB         NULL,         -- TMDB options shown on the review list
    title_type     title_type    NULL,
    tmdb_id        INTEGER       NULL,         -- set by hand to resolve a review row
    title_id       BIGINT        NULL REFERENCES title (title_id) ON DELETE SET NULL,
    matched_at     TIMESTAMPTZ   NULL,
    last_scan_id   UUID          NULL,
    first_seen_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    last_seen_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    UNIQUE (drive_id, file_path)
);
CREATE INDEX IF NOT EXISTS ix_local_file_status ON local_file (match_status, drive_id);
CREATE INDEX IF NOT EXISTS ix_local_file_title  ON local_file (title_id);

ALTER TABLE local_file ENABLE ROW LEVEL SECURITY;
-- Readable in the app (for an in-app review list later); written only by the sync job.
DROP POLICY IF EXISTS read_local_file ON local_file;
CREATE POLICY read_local_file ON local_file FOR SELECT TO authenticated USING (true);

-- ---------- Scanner secret ----------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'local_scan_secret') THEN
        PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'local_scan_secret',
                                    'Secret for the hard drive scanner on the Mac (tmdb-sync local_* modes only)');
    END IF;
END $$;

CREATE OR REPLACE FUNCTION check_local_scan_secret(p_secret TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets
                    WHERE name = 'local_scan_secret' AND decrypted_secret = p_secret);
$$;

-- ---------- Store one chunk of a scan ----------
-- p_files: [{path, size, mtime, title, year, kind, season, episode, tmdb_hint, imdb_hint}, ...]
-- A scan is sent in chunks with the same p_scan_id; p_final marks the last one. On the final
-- chunk, files of this drive that were not in the scan are dropped (with their availability
-- rows), unless the file count fell by more than half, which usually means the wrong folder or
-- a half-mounted drive. p_allow_shrink overrides that check.
CREATE OR REPLACE FUNCTION local_scan_sync(p_drive TEXT, p_volume TEXT, p_scan_id UUID, p_files JSONB,
                                           p_final BOOLEAN DEFAULT TRUE, p_allow_shrink BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_drive    SMALLINT;
    v_prev     INTEGER;
    v_new      INTEGER := 0;
    v_seen     INTEGER := 0;
    v_gone     INTEGER := 0;
    v_total    INTEGER;
    v_warning  TEXT;
BEGIN
    INSERT INTO local_drive (name, volume_label) VALUES (left(p_drive, 100), left(p_volume, 100))
    ON CONFLICT (name) DO UPDATE SET volume_label = COALESCE(EXCLUDED.volume_label, local_drive.volume_label)
    RETURNING drive_id, last_file_count INTO v_drive, v_prev;

    WITH f AS (
        SELECT left(x->>'path', 1000)                         AS file_path,
               NULLIF(x->>'size', '')::bigint                 AS file_size,
               NULLIF(x->>'mtime', '')::timestamptz           AS modified_at,
               left(NULLIF(btrim(x->>'title'), ''), 300)      AS parsed_title,
               CASE WHEN (x->>'year') ~ '^\d{4}$' AND (x->>'year')::int BETWEEN 1880 AND 2100
                    THEN (x->>'year')::smallint END           AS parsed_year,
               CASE WHEN x->>'kind' IN ('movie', 'episode') THEN x->>'kind' END AS parsed_kind,
               CASE WHEN (x->>'season')  ~ '^\d{1,4}$' THEN (x->>'season')::smallint END  AS season,
               CASE WHEN (x->>'episode') ~ '^\d{1,4}$' THEN (x->>'episode')::smallint END AS episode,
               CASE WHEN (x->>'tmdb_hint') ~ '^\d{1,9}$' THEN (x->>'tmdb_hint')::int END AS tmdb_hint,
               CASE WHEN (x->>'imdb_hint') ~ '^tt\d{5,10}$' THEN x->>'imdb_hint' END     AS imdb_hint
          FROM jsonb_array_elements(COALESCE(p_files, '[]')) x
         WHERE COALESCE(x->>'path', '') <> ''
    ), up AS (
        INSERT INTO local_file AS lf (drive_id, file_path, file_size, modified_at, parsed_title, parsed_year,
                                      parsed_kind, season, episode, tmdb_hint, imdb_hint, last_scan_id)
        SELECT DISTINCT ON (file_path) v_drive, file_path, file_size, modified_at, parsed_title, parsed_year,
               parsed_kind, season, episode, tmdb_hint, imdb_hint, p_scan_id
          FROM f
        ON CONFLICT (drive_id, file_path) DO UPDATE
           SET file_size    = EXCLUDED.file_size,
               modified_at  = EXCLUDED.modified_at,
               season       = EXCLUDED.season,
               episode      = EXCLUDED.episode,
               last_scan_id = EXCLUDED.last_scan_id,
               last_seen_at = now(),
               -- A newer parser reading the same name differently: match it again
               -- (unless it was matched or ignored by hand).
               parsed_title = EXCLUDED.parsed_title,
               parsed_year  = EXCLUDED.parsed_year,
               parsed_kind  = EXCLUDED.parsed_kind,
               tmdb_hint    = EXCLUDED.tmdb_hint,
               imdb_hint    = EXCLUDED.imdb_hint,
               match_status = CASE
                   WHEN lf.match_method = 'manual' OR lf.match_status = 'ignored' THEN lf.match_status
                   WHEN (lf.parsed_title, lf.parsed_year, lf.parsed_kind, lf.tmdb_hint, lf.imdb_hint)
                        IS DISTINCT FROM
                        (EXCLUDED.parsed_title, EXCLUDED.parsed_year, EXCLUDED.parsed_kind,
                         EXCLUDED.tmdb_hint, EXCLUDED.imdb_hint) THEN 'pending'
                   ELSE lf.match_status END
        RETURNING (xmax = 0) AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted), count(*) INTO v_new, v_seen FROM up;

    IF p_final THEN
        SELECT count(*) INTO v_total FROM local_file WHERE drive_id = v_drive AND last_scan_id = p_scan_id;

        IF NOT p_allow_shrink AND COALESCE(v_prev, 0) >= 20 AND v_total < v_prev / 2 THEN
            v_warning := format('Scan found %s files, last scan found %s. Nothing was removed. '
                                'Run with --allow-shrink if files really were deleted.', v_total, v_prev);
        ELSE
            DELETE FROM title_availability a
             USING local_file lf
             WHERE lf.drive_id = v_drive AND lf.last_scan_id IS DISTINCT FROM p_scan_id
               AND a.drive_id = lf.drive_id AND a.file_path = lf.file_path;
            DELETE FROM local_file WHERE drive_id = v_drive AND last_scan_id IS DISTINCT FROM p_scan_id;
            GET DIAGNOSTICS v_gone = ROW_COUNT;
            UPDATE local_drive SET last_file_count = v_total WHERE drive_id = v_drive;
        END IF;

        UPDATE local_drive SET last_scanned_at = now(), last_scan_id = p_scan_id WHERE drive_id = v_drive;
    END IF;

    RETURN jsonb_build_object('drive_id', v_drive, 'files_in_chunk', v_seen, 'new_files', v_new,
                              'removed_files', v_gone, 'files_on_drive', v_total, 'warning', v_warning);
END;
$$;

-- ---------- Matched files -> title_availability ----------
-- One availability row per file (episodes too). Inserting them fires local_availability_moves,
-- which moves the titles to Home (or adds them to Home when new), never touching History,
-- Hidden or Removed. Rows whose file now points at another title are replaced.
CREATE OR REPLACE FUNCTION apply_local_files(p_drive_id SMALLINT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_removed INTEGER := 0;
    v_added   INTEGER := 0;
BEGIN
    -- Stale rows: the file is no longer matched, or matched to a different title.
    DELETE FROM title_availability a
     USING local_file lf
     WHERE a.source_type = 'local'
       AND a.drive_id = lf.drive_id AND a.file_path = lf.file_path
       AND (p_drive_id IS NULL OR lf.drive_id = p_drive_id)
       AND (lf.match_status <> 'matched' OR lf.title_id IS DISTINCT FROM a.title_id);
    GET DIAGNOSTICS v_removed = ROW_COUNT;

    INSERT INTO title_availability (title_id, source_type, drive_id, file_path, last_checked_at)
    SELECT lf.title_id, 'local', lf.drive_id, lf.file_path, now()
      FROM local_file lf
     WHERE lf.match_status = 'matched' AND lf.title_id IS NOT NULL
       AND (p_drive_id IS NULL OR lf.drive_id = p_drive_id)
    ON CONFLICT (title_id, drive_id, file_path) WHERE drive_id IS NOT NULL
    DO UPDATE SET last_checked_at = now();
    GET DIAGNOSTICS v_added = ROW_COUNT;  -- includes refreshed rows

    RETURN jsonb_build_object('availability_rows', v_added, 'stale_rows_removed', v_removed,
        'titles_on_drives', (SELECT count(DISTINCT title_id) FROM local_file
                              WHERE match_status = 'matched'
                                AND (p_drive_id IS NULL OR drive_id = p_drive_id)));
END;
$$;

-- ---------- Review list helpers (run in the SQL editor) ----------
-- Give a file the right TMDB title. Every file on the drive that was read the same way
-- (same title, year and kind, e.g. all episodes of one show) gets it too.
-- Then run the matcher again: SELECT run_tmdb_sync('{"mode":"local_match"}');
CREATE OR REPLACE FUNCTION resolve_local_file(p_file_id BIGINT, p_tmdb_id INTEGER,
                                              p_type title_type DEFAULT 'movie')
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_n INTEGER;
BEGIN
    UPDATE local_file lf
       SET tmdb_id = p_tmdb_id, title_type = p_type, match_status = 'pending', match_method = 'manual',
           review_reason = NULL, candidates = NULL, title_id = NULL
      FROM local_file src
     WHERE src.file_id = p_file_id
       AND lf.drive_id = src.drive_id
       AND (lf.file_id = src.file_id OR
            (lf.match_status IN ('review', 'pending')
             AND lf.parsed_title IS NOT DISTINCT FROM src.parsed_title
             AND lf.parsed_year  IS NOT DISTINCT FROM src.parsed_year
             AND lf.parsed_kind  IS NOT DISTINCT FROM src.parsed_kind));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$$;

-- Not a film or show (home videos, clips): leave it out of the app for good.
-- p_same_name also ignores every file on the drive that was read the same way.
CREATE OR REPLACE FUNCTION ignore_local_file(p_file_id BIGINT, p_same_name BOOLEAN DEFAULT TRUE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_n INTEGER;
BEGIN
    UPDATE local_file lf
       SET match_status = 'ignored', title_id = NULL, review_reason = NULL, candidates = NULL
      FROM local_file src
     WHERE src.file_id = p_file_id
       AND lf.drive_id = src.drive_id
       AND (lf.file_id = src.file_id OR
            (p_same_name
             AND lf.parsed_title IS NOT DISTINCT FROM src.parsed_title
             AND lf.parsed_year  IS NOT DISTINCT FROM src.parsed_year
             AND lf.parsed_kind  IS NOT DISTINCT FROM src.parsed_kind));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM apply_local_files(NULL);
    RETURN v_n;
END;
$$;

-- Only the sync job (service role) may call these.
REVOKE ALL ON FUNCTION check_local_scan_secret(TEXT)                                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION local_scan_sync(TEXT, TEXT, UUID, JSONB, BOOLEAN, BOOLEAN)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION apply_local_files(SMALLINT)                                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION resolve_local_file(BIGINT, INTEGER, title_type)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ignore_local_file(BIGINT, BOOLEAN)                           FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION check_local_scan_secret(TEXT)                              TO service_role;
GRANT EXECUTE ON FUNCTION local_scan_sync(TEXT, TEXT, UUID, JSONB, BOOLEAN, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION apply_local_files(SMALLINT)                                TO service_role;
GRANT EXECUTE ON FUNCTION resolve_local_file(BIGINT, INTEGER, title_type)            TO service_role;
GRANT EXECUTE ON FUNCTION ignore_local_file(BIGINT, BOOLEAN)                         TO service_role;
