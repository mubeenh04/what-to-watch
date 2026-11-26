-- What to Watch: draft database schema (v2, for review)
-- Dialect: PostgreSQL on Supabase. Not run yet. Confirm the design before creating the database.
-- v2: users come from Supabase Auth (UUID), row-level security on personal tables,
--     streaming availability is per country (region_code, default 'ZA').
--
-- Assumptions
--   * One household today, but every list state is stored per user (app_user)
--     so separate profiles can be added later without a redesign.
--   * A series is one title. No seasons or episodes in v1.
--   * A title can be available in several places (e.g. Netflix and a local drive).
--   * A title is in exactly one state per user: enforced by the primary key
--     on user_title (user_id, title_id) plus a single status column.

-- ---------- Enumerations ----------
CREATE TYPE title_type   AS ENUM ('movie', 'series');
CREATE TYPE title_status AS ENUM ('home', 'explore', 'watchlist', 'history', 'hidden', 'removed');
CREATE TYPE source_type  AS ENUM ('streaming', 'local');

-- ---------- Catalogue ----------
CREATE TABLE title (
    title_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title_type        title_type    NOT NULL,
    name              VARCHAR(300)  NOT NULL,
    release_year      SMALLINT      NOT NULL CHECK (release_year BETWEEN 1880 AND 2100),
    end_year          SMALLINT      NULL     CHECK (end_year IS NULL OR end_year >= release_year), -- series only
    synopsis          VARCHAR(400)  NOT NULL
                      CHECK (array_length(regexp_split_to_array(btrim(synopsis), '\s+'), 1) <= 50),
    poster_url        VARCHAR(1000) NULL,
    imdb_id           VARCHAR(12)   NULL UNIQUE,   -- e.g. tt15239678
    tmdb_id           INTEGER       NULL,
    imdb_rating       NUMERIC(3,1)  NULL CHECK (imdb_rating BETWEEN 0 AND 10),
    rt_score          SMALLINT      NULL CHECK (rt_score BETWEEN 0 AND 100),
    letterboxd_url    VARCHAR(500)  NULL,          -- falls back to a Letterboxd search link when empty
    scores_updated_at TIMESTAMPTZ   NULL,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    UNIQUE (tmdb_id, title_type)
);
CREATE INDEX ix_title_type_year ON title (title_type, release_year);
CREATE INDEX ix_title_imdb      ON title (imdb_rating);
CREATE INDEX ix_title_rt        ON title (rt_score);

CREATE TABLE genre (
    genre_id  SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name      VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE title_genre (
    title_id  BIGINT   NOT NULL REFERENCES title (title_id) ON DELETE CASCADE,
    genre_id  SMALLINT NOT NULL REFERENCES genre (genre_id),
    rank      SMALLINT NOT NULL CHECK (rank >= 1),   -- 1 and 2 are shown on the card
    PRIMARY KEY (title_id, genre_id),
    UNIQUE (title_id, rank)
);
CREATE INDEX ix_title_genre_genre ON title_genre (genre_id);

CREATE TABLE person (
    person_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       VARCHAR(200) NOT NULL,
    tmdb_id    INTEGER      NULL UNIQUE
);

CREATE TABLE title_cast (
    title_id        BIGINT   NOT NULL REFERENCES title (title_id) ON DELETE CASCADE,
    person_id       BIGINT   NOT NULL REFERENCES person (person_id),
    billing_order   SMALLINT NOT NULL CHECK (billing_order >= 1),   -- 1 and 2 are shown on the card
    character_name  VARCHAR(200) NULL,
    PRIMARY KEY (title_id, person_id),
    UNIQUE (title_id, billing_order)
);
CREATE INDEX ix_title_cast_person ON title_cast (person_id);

-- ---------- Where to watch ----------
CREATE TABLE streaming_service (
    service_id     SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name           VARCHAR(100)  NOT NULL UNIQUE,
    logo_url       VARCHAR(1000) NULL,
    is_subscribed  BOOLEAN       NOT NULL DEFAULT TRUE,
    display_order  SMALLINT      NOT NULL DEFAULT 100   -- which logo wins when a title is in several places
);

CREATE TABLE local_drive (
    drive_id         SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name             VARCHAR(100) NOT NULL UNIQUE,   -- e.g. "Media HDD"
    volume_label     VARCHAR(100) NULL,
    last_scanned_at  TIMESTAMPTZ  NULL
);

CREATE TABLE title_availability (
    availability_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title_id         BIGINT      NOT NULL REFERENCES title (title_id) ON DELETE CASCADE,
    source_type      source_type NOT NULL,
    service_id       SMALLINT    NULL REFERENCES streaming_service (service_id),
    drive_id         SMALLINT    NULL REFERENCES local_drive (drive_id),
    file_path        VARCHAR(1000) NULL,   -- local only
    watch_url        VARCHAR(1000) NULL,   -- streaming deep link
    region_code      CHAR(2)     NULL,     -- ISO country, e.g. 'ZA'. Required for streaming, empty for local.
    last_checked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (source_type = 'streaming' AND service_id IS NOT NULL AND drive_id IS NULL AND region_code IS NOT NULL) OR
        (source_type = 'local'     AND drive_id   IS NOT NULL AND service_id IS NULL)
    )
);
-- Streaming rows come from TMDB's per-country watch providers (JustWatch data), so
-- "on Netflix in South Africa" is a row with service = Netflix and region_code = 'ZA'.
CREATE UNIQUE INDEX ux_avail_service ON title_availability (title_id, service_id, region_code) WHERE service_id IS NOT NULL;
CREATE UNIQUE INDEX ux_avail_drive   ON title_availability (title_id, drive_id, file_path) WHERE drive_id IS NOT NULL;
CREATE INDEX ix_avail_source         ON title_availability (source_type, title_id);

-- ---------- People and list state ----------
CREATE TABLE app_user (
    user_id              UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,  -- Supabase Auth
    display_name         VARCHAR(100) NOT NULL,
    region_code          CHAR(2)      NOT NULL DEFAULT 'ZA',  -- only streaming rows for this country count
    letterboxd_username  VARCHAR(100) NULL,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- One row per user per title = the single section the title lives in.
CREATE TABLE user_title (
    user_id               UUID         NOT NULL REFERENCES app_user (user_id) ON DELETE CASCADE,
    title_id              BIGINT       NOT NULL REFERENCES title (title_id),
    status                title_status NOT NULL,
    status_changed_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    added_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    watched_at            TIMESTAMPTZ  NULL,       -- set when status becomes 'history'
    recommended_at        TIMESTAMPTZ  NULL,       -- set when the title first appears in Explore
    recommendation_reason VARCHAR(300) NULL,
    PRIMARY KEY (user_id, title_id),
    CHECK (status <> 'history' OR watched_at IS NOT NULL)
);
CREATE INDEX ix_user_title_status ON user_title (user_id, status, status_changed_at DESC);

-- Every move between sections. Powers Undo and a full audit trail.
CREATE TABLE title_status_event (
    event_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      UUID         NOT NULL,
    title_id     BIGINT       NOT NULL,
    from_status  title_status NULL,      -- NULL when the title first enters the app
    to_status    title_status NOT NULL,
    action       VARCHAR(20)  NOT NULL,  -- watched, hide, unhide, watchlist, remove, downloaded, sync, undo
    changed_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    FOREIGN KEY (user_id, title_id) REFERENCES user_title (user_id, title_id) ON DELETE CASCADE
);
CREATE INDEX ix_status_event_title ON title_status_event (user_id, title_id, changed_at DESC);

-- Rules kept in the app (or a trigger):
--  * A title can only be 'home' while it has a local row, or a streaming row on a subscribed
--    service whose region_code matches app_user.region_code.
--  * The availability sync moves a 'watchlist' or 'explore' title to 'home' automatically
--    (action = 'sync') only when such a matching-region streaming row appears. Rows for other
--    countries are stored but ignored, so Netflix US titles never move to Home.
--  * Explore skips any title the user already has a user_title row for
--    (that includes 'removed', which is the block list).

-- ---------- Supabase row-level security ----------
-- Catalogue tables are readable by any signed-in user; writes come from the sync job (service role).
ALTER TABLE title              ENABLE ROW LEVEL SECURITY;
ALTER TABLE genre              ENABLE ROW LEVEL SECURITY;
ALTER TABLE title_genre        ENABLE ROW LEVEL SECURITY;
ALTER TABLE person             ENABLE ROW LEVEL SECURITY;
ALTER TABLE title_cast         ENABLE ROW LEVEL SECURITY;
ALTER TABLE streaming_service  ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_drive        ENABLE ROW LEVEL SECURITY;
ALTER TABLE title_availability ENABLE ROW LEVEL SECURITY;
CREATE POLICY read_title        ON title              FOR SELECT TO authenticated USING (true);
CREATE POLICY read_genre        ON genre              FOR SELECT TO authenticated USING (true);
CREATE POLICY read_title_genre  ON title_genre        FOR SELECT TO authenticated USING (true);
CREATE POLICY read_person       ON person             FOR SELECT TO authenticated USING (true);
CREATE POLICY read_title_cast   ON title_cast         FOR SELECT TO authenticated USING (true);
CREATE POLICY read_service      ON streaming_service  FOR SELECT TO authenticated USING (true);
CREATE POLICY read_drive        ON local_drive        FOR SELECT TO authenticated USING (true);
CREATE POLICY read_availability ON title_availability FOR SELECT TO authenticated USING (true);

-- Personal tables: each user sees and changes only their own rows.
ALTER TABLE app_user           ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_title         ENABLE ROW LEVEL SECURITY;
ALTER TABLE title_status_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_profile ON app_user           FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY own_titles  ON user_title         FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY own_events  ON title_status_event FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
