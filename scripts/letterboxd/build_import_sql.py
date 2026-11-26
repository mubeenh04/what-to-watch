#!/usr/bin/env python3
"""Turn a Letterboxd export zip into SQL that loads it into letterboxd_import.

Usage:
    python3 scripts/letterboxd/build_import_sql.py letterboxd-export.zip > import.sql
    python3 scripts/letterboxd/build_import_sql.py export.zip --user-id <app_user uuid> > import.sql

One row per film (watched.csv, plus any diary/ratings film not in it):
  * watched_on = latest "Watched Date" in diary.csv, else the date in watched.csv
  * rating     = ratings.csv (else the latest rated diary entry)
  * letterboxd_uri = the film's boxd.it link (diary links point at log entries, not films)

The output ends with run_tmdb_sync('{"mode":"letterboxd"}'), which matches the rows to TMDB
and moves them to History. With --user-id, the profile's letterboxd_username is set first, so
the import applies to that profile; without it, it applies when a profile gets that username.

The output holds personal data. Don't commit it.
"""
import argparse
import csv
import io
import sys
import zipfile


def read_csv(z: zipfile.ZipFile, name: str) -> list[dict]:
    if name not in z.namelist():
        return []
    with z.open(name) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")))


def q(v) -> str:
    if v is None or v == "":
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def year(v: str):
    v = (v or "").strip()
    return int(v) if v.isdigit() else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("zip")
    ap.add_argument("--user-id", help="app_user.user_id to link this Letterboxd account to")
    ap.add_argument("--username", help="override the Letterboxd username from profile.csv")
    ap.add_argument("--no-run", action="store_true", help="leave out the run_tmdb_sync call")
    a = ap.parse_args()

    with zipfile.ZipFile(a.zip) as z:
        profile = read_csv(z, "profile.csv")
        watched = read_csv(z, "watched.csv")
        diary = read_csv(z, "diary.csv")
        ratings = read_csv(z, "ratings.csv")

    username = a.username or (profile[0].get("Username") if profile else None)
    if not username:
        sys.exit("No Letterboxd username: pass --username")

    films: dict[tuple, dict] = {}

    def film(name, yr):
        key = (name.strip(), yr)
        return films.setdefault(key, {"name": key[0], "year": yr, "uri": None,
                                      "logged": None, "diary": None, "rating": None, "diary_rating": None})

    for r in watched:
        f = film(r["Name"], year(r["Year"]))
        f["uri"] = f["uri"] or r.get("Letterboxd URI")
        f["logged"] = max(filter(None, [f["logged"], r.get("Date")]), default=None)
    for r in ratings:
        f = film(r["Name"], year(r["Year"]))
        f["uri"] = f["uri"] or r.get("Letterboxd URI")
        f["rating"] = r.get("Rating") or f["rating"]
        f["logged"] = f["logged"] or r.get("Date")
    for r in diary:
        f = film(r["Name"], year(r["Year"]))
        d = r.get("Watched Date") or r.get("Date")
        if d and (f["diary"] is None or d > f["diary"]):
            f["diary"] = d
            if r.get("Rating"):
                f["diary_rating"] = r["Rating"]
        f["logged"] = f["logged"] or r.get("Date")

    out = ["-- Letterboxd import for " + username + " (" + str(len(films)) + " films). Personal data: don't commit.",
           "BEGIN;"]
    if a.user_id:
        out.append(f"UPDATE app_user SET letterboxd_username = {q(username)} WHERE user_id = {q(a.user_id)};")
    out.append("INSERT INTO letterboxd_import (letterboxd_username, film_name, film_year, letterboxd_uri, watched_on, rating) VALUES")
    vals = []
    for f in sorted(films.values(), key=lambda x: (x["name"].lower(), x["year"] or 0)):
        watched_on = f["diary"] or f["logged"]
        if not watched_on:
            continue
        rating = f["rating"] or f["diary_rating"]
        vals.append(f"  ({q(username)}, {q(f['name'])}, {f['year'] if f['year'] else 'NULL'}, {q(f['uri'])}, "
                    f"{q(watched_on)}, {rating if rating else 'NULL'})")
    out.append(",\n".join(vals))
    # Re-running the same export refreshes dates and ratings; matching is kept.
    out.append("ON CONFLICT (letterboxd_username, film_name, film_year) DO UPDATE\n"
               "   SET watched_on = GREATEST(letterboxd_import.watched_on, EXCLUDED.watched_on),\n"
               "       rating = COALESCE(EXCLUDED.rating, letterboxd_import.rating),\n"
               "       letterboxd_uri = COALESCE(letterboxd_import.letterboxd_uri, EXCLUDED.letterboxd_uri);")
    out.append("COMMIT;")
    if not a.no_run:
        out.append("")
        out.append("-- Match to TMDB and move to History (runs in the background, about a minute).")
        out.append("SELECT run_tmdb_sync('{\"mode\":\"letterboxd\",\"limit\":150}');")
    print("\n".join(out))


if __name__ == "__main__":
    main()
