# Letterboxd import

Moves the films in a Letterboxd export to History in What to Watch.

1. Apply `supabase/migrations/20261126200000_letterboxd_import.sql` (once) and deploy the
   `tmdb-sync` Edge Function (it has the `letterboxd` mode).
2. Build the SQL for an export (Letterboxd: Settings > Data > Export your data):

   ```sh
   python3 scripts/letterboxd/build_import_sql.py letterboxd-export.zip --user-id <app_user uuid> > import.sql
   ```

   `--user-id` links the profile to the export's Letterboxd username. Leave it out if the
   profile doesn't exist yet: the import then waits and applies when a profile's
   `letterboxd_username` is set.
3. Run `import.sql` in the Supabase SQL editor. Its last line starts the matcher
   (`run_tmdb_sync('{"mode":"letterboxd"}')`), which runs in the background for about a minute.

The export and the generated SQL hold personal data. Don't commit them (they are git-ignored here).

## What it does

- One row per film. `watched_at` = latest diary "Watched Date", else the watched.csv date.
  Ratings (0.5 to 5 stars) go to `user_title.user_rating`.
- Matching: the TMDB id on the film's Letterboxd page, else a strict TMDB search (same year,
  same title, movie or series). Anything unclear goes on the review list, never a guess.
- Titles missing from the catalogue are added. The film's Letterboxd URL is stored on `title.letterboxd_url`.
- History rows are left alone. Home, Explore and Watchlist rows move to History.
  Hidden and Removed rows are left alone and reported.

## Review list

```sql
SELECT import_row_id, film_name, film_year, review_reason, candidates
  FROM letterboxd_import WHERE match_status = 'review' ORDER BY film_name;

-- Fix one by hand, then run the matcher again:
SELECT resolve_letterboxd_review(<import_row_id>, <tmdb_id>, 'movie');   -- or 'series'
SELECT run_tmdb_sync('{"mode":"letterboxd"}');
```

Results: `SELECT applied_result, count(*) FROM letterboxd_import GROUP BY 1;`
and the matcher's response in `net._http_response`.
