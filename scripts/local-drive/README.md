# Hard drive scanner

Finds the films and shows on a hard drive and puts them in What to Watch's Home.
It runs on the Mac every night at 02:30 (or when the Mac next wakes) and whenever a drive is
plugged in. It only reads folder listings. It never renames, moves, opens or changes a file.

## How it works

1. `scan.py` walks the folders in the settings for video files (`.mkv .mp4 .m4v .avi .mov` and
   similar). It skips samples, trailers, extras/featurette folders, hidden `._` files and files
   under 50 MB. If the drive isn't plugged in, it does nothing.
2. It reads each path with [guessit](https://github.com/guessit-io/guessit): title, year, season,
   episode. A TMDB id in the name (`{tmdb-603}`, `[tmdbid-603]`) or an IMDb id (`tt0133093`)
   is used directly.
3. It sends the list to the `tmdb-sync` Edge Function (`local_scan`), then asks it to match
   new files (`local_match`). The TMDB key stays in Supabase; the Mac only holds the scanner key,
   which opens nothing but these modes.
4. Matching is grouped by title, so 40 episodes of a show or two copies of a film are one TMDB
   lookup and one title. Episodes search TV, films search movies; the name must match exactly
   after tidying (case, punctuation, accents), and the year must match (one year off is accepted
   only when a single title fits). Without a year, one title must clearly be the famous one.
   Anything else goes on the review list. Nothing is guessed.
5. Each matched file gets a `title_availability` row (`source_type = 'local'`). Those titles
   move to Home, unless they're in History, Hidden or Removed.
6. A file that's gone from the drive loses its row. If a scan finds less than half of last
   time's files (wrong folder, drive half-mounted), nothing is removed and the log says so.
   The title itself stays where it is in the app.

## Install (once)

1. Run `supabase/migrations/20261126210000_local_drive_scan.sql` in the Supabase SQL editor
   and deploy `tmdb-sync`.
2. Copy the scanner key from the SQL editor:
   `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'local_scan_secret';`
3. In Terminal, from this folder: `bash setup.sh`. It asks for a drive name, the folders
   (drag them in from Finder) and the key, then installs everything in `~/.what-to-watch`.

Settings live in `~/.what-to-watch/scanner.env` on the Mac only. Change them with
`bash setup.sh --settings`. Turn the schedule off with `bash setup.sh --uninstall`.

## Everyday commands

```sh
~/.what-to-watch/scan --dry-run      # what it would send, nothing sent
~/.what-to-watch/scan                # scan now
~/.what-to-watch/scan --review       # files that need a hand-picked match
tail -50 ~/.what-to-watch/scan.log   # last nightly runs
```

## Review list

`scan --review` lists each file with TMDB candidates. Fix one in the SQL editor; every file
read the same way (all episodes of that show) is fixed with it:

```sql
SELECT resolve_local_file(<file id>, <TMDB id>, 'movie');   -- or 'series'
SELECT ignore_local_file(<file id>);                        -- not a film or show
```

Then run `~/.what-to-watch/scan` again. Results: `SELECT match_status, count(*) FROM local_file GROUP BY 1;`

Tip: naming a folder `Title (Year)` (or adding `{tmdb-123}`) makes matching exact. The scanner
itself never renames anything.

## Permissions

macOS may block background access to external drives. If `scan.log` says
"Operation not permitted": System Settings > Privacy & Security > Full Disk Access > +,
press Cmd+Shift+G, paste the path in `~/.what-to-watch/python-path.txt`, and switch it on.
