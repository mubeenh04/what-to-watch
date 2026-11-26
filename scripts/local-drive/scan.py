#!/usr/bin/env python3
"""Hard drive scanner for What to Watch.

Walks a drive for video files, reads each file name with guessit (title, year, season,
episode) and sends the list to the tmdb-sync Edge Function, which matches the files to TMDB
and puts the titles in Home. It only reads folder listings: it never renames, moves, opens
or changes a file.

Usage (setup.sh installs it as ~/.what-to-watch/scan):
    scan                  scan the drive in the env file, then match new files to TMDB
    scan --dry-run        show what would be sent, send nothing
    scan --review         list the files that need a hand-picked match
    scan --allow-shrink   allow a scan that finds less than half of last time's files
    scan --hourly         skip if the last successful scan was under an hour ago (launchd uses this)

Settings come from ~/.what-to-watch/scanner.env (or --env FILE):
    WTW_FUNCTION_URL   https://<project>.supabase.co/functions/v1/tmdb-sync
    WTW_SCAN_SECRET    the Vault secret local_scan_secret (never commit it)
    WTW_DRIVE_NAME     a name for the drive, e.g. "Media HDD"
    WTW_SCAN_FOLDERS   folders to scan, separated by ";", e.g. /Volumes/My Passport/Movies
    WTW_MIN_SIZE_MB    optional, files smaller than this are skipped (default 50)

Works on the Python 3.9 that comes with macOS.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import sys
import time
import unicodedata
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

HOME_DIR = Path.home() / ".what-to-watch"
DEFAULT_ENV = HOME_DIR / "scanner.env"
STATE_FILE = HOME_DIR / "state.json"

VIDEO_EXT = {".mkv", ".mp4", ".m4v", ".avi", ".mov", ".wmv", ".mpg", ".mpeg", ".ts", ".m2ts",
             ".webm", ".flv", ".divx", ".vob", ".ogm", ".3gp"}

# Folders that hold bonus material, not the film or episode itself.
SKIP_DIRS = {"sample", "samples", "extras", "extra", "featurettes", "featurette", "behind the scenes",
             "deleted scenes", "interviews", "interview", "trailers", "trailer", "shorts", "scenes",
             "other", "bonus", "bonus features", "special features", "making of",
             # system folders on Mac and Windows drives
             ".trashes", ".spotlight-v100", ".fseventsd", ".temporaryitems", "$recycle.bin",
             "system volume information", ".documentrevisions-v100", "@eadir", "#recycle"}

# File names that mark bonus material (Plex/Jellyfin suffixes and release-group habits).
SKIP_NAME = re.compile(
    r"(^|[\s._\-\[(])(sample|trailer|teaser|featurette|behindthescenes|deleted[\s._-]?scenes?|"
    r"interview|making[\s._-]?of|extras?|bonus|short)([\s._\-\])]|$)", re.I)

TMDB_HINT = re.compile(r"[\[{(]tmdb(?:id)?[-=\s:]?(\d+)[\]})]", re.I)
IMDB_HINT = re.compile(r"\b(tt\d{7,10})\b")

CHUNK = 1000


def log(msg: str) -> None:
    print(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  {msg}", flush=True)


def read_env(path: Path) -> dict:
    env = {}
    if not path.exists():
        sys.exit(f"Settings file not found: {path}\nRun setup.sh first.")
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        env[k.strip()] = v
    for k, v in os.environ.items():
        if k.startswith("WTW_"):
            env[k] = v
    return env


def volume_root(folder: Path) -> Path:
    """/Volumes/My Passport/Movies -> /Volumes/My Passport. Anything else: / (full paths are stored)."""
    parts = folder.resolve().parts
    if len(parts) >= 3 and parts[1] == "Volumes":
        return Path(*parts[:3])
    return Path("/")


def is_skipped_dir(name: str) -> bool:
    n = name.lower()
    return n.startswith(".") or n in SKIP_DIRS


def walk(folder: Path, min_size: int, skipped: dict):
    for dirpath, dirnames, filenames in os.walk(folder, onerror=lambda e: skipped.setdefault("errors", []).append(str(e))):
        dirnames[:] = sorted(d for d in dirnames if not is_skipped_dir(d))
        for name in sorted(filenames):
            if name.startswith("."):  # includes ._ files macOS leaves on exFAT/NTFS drives
                continue
            p = Path(dirpath) / name
            if p.suffix.lower() not in VIDEO_EXT:
                continue
            if SKIP_NAME.search(p.stem):
                skipped["extras"] = skipped.get("extras", 0) + 1
                continue
            try:
                st = p.stat()
            except OSError as e:
                skipped.setdefault("errors", []).append(f"{p}: {e}")
                continue
            if st.st_size < min_size:
                skipped["small"] = skipped.get("small", 0) + 1
                continue
            yield p, st


def first(v):
    if isinstance(v, list):
        return v[0] if v else None
    return v


def parse(rel_path: str) -> dict:
    """Read title / year / season / episode from the path (folders help: 'Show/Season 1/01.mkv')."""
    from guessit import guessit  # imported here so --help works without it

    out = {"title": None, "year": None, "kind": None, "season": None, "episode": None,
           "tmdb_hint": None, "imdb_hint": None}
    m = TMDB_HINT.search(rel_path)
    if m:
        out["tmdb_hint"] = int(m.group(1))
    m = IMDB_HINT.search(rel_path)
    if m:
        out["imdb_hint"] = m.group(1)

    clean = TMDB_HINT.sub(" ", rel_path)
    try:
        g = guessit(clean)
    except Exception:  # guessit can choke on very odd names; the file goes on the review list
        return out
    kind = g.get("type")
    out["kind"] = "episode" if kind == "episode" else "movie"
    title = first(g.get("title"))
    if out["kind"] == "episode" and not title:
        title = first(g.get("series"))
    if title:
        title = unicodedata.normalize("NFC", str(title)).strip()
        # guessit reads "Spider-Man.No.Way.Home" as release group "Spider" + title "Man No Way Home"
        group = first(g.get("release_group"))
        if group:
            for part in Path(clean).parts[::-1]:
                if re.match(re.escape(str(group)) + r"[-\u2010\u2011]" + re.escape(title.split(" ")[0]), part, re.I):
                    title = f"{group}-{title}"
                    break
        out["title"] = title
    y = first(g.get("year"))
    if isinstance(y, int) and 1880 <= y <= 2100:
        out["year"] = y
    s, e = first(g.get("season")), first(g.get("episode"))
    out["season"] = s if isinstance(s, int) else None
    out["episode"] = e if isinstance(e, int) else None
    return out


def ssl_context():
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def call(env: dict, body: dict, timeout: int = 160) -> dict:
    req = urllib.request.Request(
        env["WTW_FUNCTION_URL"], data=json.dumps(body).encode("utf-8"), method="POST",
        headers={"content-type": "application/json", "x-scan-secret": env["WTW_SCAN_SECRET"]})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=ssl_context()) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            text = e.read().decode("utf-8", "replace")[:500]
            if e.code == 401:
                sys.exit("The server refused the scanner key (401). Check WTW_SCAN_SECRET in scanner.env.")
            if e.code < 500 or attempt == 3:
                sys.exit(f"Server error {e.code}: {text}")
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if attempt == 3:
                sys.exit(f"Couldn't reach the server: {e}")
        time.sleep(5 * (attempt + 1))
    return {}


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except (OSError, ValueError):
        return {}


def save_state(state: dict) -> None:
    try:
        STATE_FILE.write_text(json.dumps(state, indent=2))
    except OSError:
        pass


def show_review(env: dict) -> None:
    files = call(env, {"mode": "local_review"}).get("files") or []
    if not files:
        print("The review list is empty.")
        return
    print(f"{len(files)} file(s) need a hand-picked match:\n")
    for f in files:
        print(f"[{f['file_id']}] {f['file_path']}")
        print(f"     read as: {f.get('parsed_title')!r} ({f.get('parsed_year') or 'no year'}, {f.get('parsed_kind')})")
        print(f"     why:     {f.get('review_reason')}")
        for c in (f.get("candidates") or [])[:5]:
            print(f"       - {c.get('name')} ({c.get('year')}) {c.get('type')}, TMDB {c.get('tmdb_id')}, {c.get('votes')} votes")
        print()
    print("Fix one in the Supabase SQL editor (episodes of the same show are fixed together):")
    print("  SELECT resolve_local_file(<file id>, <TMDB id>, 'movie');   -- or 'series'")
    print("  SELECT ignore_local_file(<file id>);                        -- not a film or show")
    print("Then run the scanner again.")


def main() -> None:
    ap = argparse.ArgumentParser(description="Scan a drive for films and shows for What to Watch.")
    ap.add_argument("--env", type=Path, default=DEFAULT_ENV)
    ap.add_argument("--dry-run", action="store_true", help="show what would be sent, send nothing")
    ap.add_argument("--review", action="store_true", help="list files that need a hand-picked match")
    ap.add_argument("--allow-shrink", action="store_true", help="accept a scan with far fewer files than last time")
    ap.add_argument("--hourly", action="store_true", help="skip if scanned successfully in the last hour")
    a = ap.parse_args()

    env = read_env(a.env)
    for k in ("WTW_FUNCTION_URL", "WTW_SCAN_SECRET", "WTW_DRIVE_NAME", "WTW_SCAN_FOLDERS"):
        if not env.get(k) and not (a.dry_run and k in ("WTW_FUNCTION_URL", "WTW_SCAN_SECRET")):
            sys.exit(f"{k} is missing from {a.env}")

    if a.review:
        show_review(env)
        return

    folders = [Path(f.strip()).expanduser() for f in env["WTW_SCAN_FOLDERS"].split(";") if f.strip()]
    missing = [str(f) for f in folders if not f.is_dir()]
    if missing:
        # Drive not plugged in (or asleep): skip quietly, change nothing on the server.
        log(f"Not connected, skipping: {', '.join(missing)}")
        return

    state = load_state()
    if a.hourly and time.time() - state.get("last_ok", 0) < 3600:
        log("Scanned less than an hour ago, skipping.")
        return

    min_size = int(float(env.get("WTW_MIN_SIZE_MB", "50")) * 1024 * 1024)
    skipped: dict = {}
    files = []
    seen = set()
    volume = None
    for folder in folders:
        root = volume_root(folder)
        volume = volume or (root.name if str(root).startswith("/Volumes/") else None)
        for p, st in walk(folder, min_size, skipped):
            try:
                rel = str(p.resolve().relative_to(root))
            except ValueError:
                rel = str(p.resolve())
            rel = unicodedata.normalize("NFC", rel)
            if rel in seen:
                continue
            seen.add(rel)
            # Parse the path below the scanned folder: "The Matrix (1999)/matrix.mkv"
            info = parse(unicodedata.normalize("NFC", str(p.relative_to(folder))))
            files.append({"path": rel, "size": st.st_size,
                          "mtime": datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat(), **info})

    errors = skipped.get("errors", [])
    log(f"Found {len(files)} video files in {', '.join(map(str, folders))} "
        f"(skipped {skipped.get('extras', 0)} extras/samples, {skipped.get('small', 0)} small files"
        f"{', ' + str(len(errors)) + ' unreadable' if errors else ''}).")
    for e in errors[:5]:
        log(f"  couldn't read: {e}")
    if errors and any("Operation not permitted" in e for e in errors):
        log("  macOS blocked access. See 'Permissions' in the README.")
    if not files and errors:
        sys.exit("Nothing readable; not sending an empty scan.")

    if a.dry_run:
        for f in files:
            what = f"{f['title']!r} ({f['year'] or 'no year'})"
            if f["kind"] == "episode":
                what += f" S{f['season'] or 0:02d}E{f['episode'] or 0:02d}"
            hint = f"  tmdb {f['tmdb_hint']}" if f["tmdb_hint"] else (f"  {f['imdb_hint']}" if f["imdb_hint"] else "")
            print(f"{f['kind']:8} {what:60} {f['path']}{hint}")
        titles = {(f["kind"], (f["title"] or "").lower(), f["year"]) for f in files}
        print(f"\n{len(files)} files, about {len(titles)} distinct titles. Nothing was sent (--dry-run).")
        return

    scan_id = str(uuid.uuid4())
    chunks = [files[i:i + CHUNK] for i in range(0, len(files), CHUNK)] or [[]]
    result = {}
    for i, chunk in enumerate(chunks):
        result = call(env, {"mode": "local_scan", "drive": env["WTW_DRIVE_NAME"], "volume": volume,
                            "scan_id": scan_id, "files": chunk, "final": i == len(chunks) - 1,
                            "allow_shrink": a.allow_shrink})
    log(f"Sent. New files: {result.get('new_files', '?')} in last chunk, removed: {result.get('removed_files', 0)}, "
        f"on drive: {result.get('files_on_drive')}.")
    if result.get("warning"):
        log("WARNING: " + result["warning"])

    # Match new files to TMDB. Each call works for up to ~100 s; keep going while it makes progress.
    total_matched = 0
    for _ in range(40):
        r = call(env, {"mode": "local_match", "limit": 300})
        if r.get("error"):
            sys.exit(f"Matching failed: {r['error']}")
        total_matched += r.get("matched_files", 0)
        for e in r.get("errors") or []:
            log(f"  {e}")
        pending = r.get("still_pending") or 0
        log(f"Matching: {r.get('matched_files', 0)} files matched, {r.get('review_files', 0)} to review, "
            f"{pending} still to do.")
        if pending == 0 or (r.get("groups", 0) == 0):
            break
        if r.get("matched_files", 0) == 0 and r.get("review_files", 0) == 0 and not r.get("stopped_early"):
            log("No progress (TMDB errors?). Will try again next run.")
            break
    final = r.get("applied") or {}
    log(f"Done. {final.get('titles_on_drives', '?')} titles on your drives. "
        f"Review list: {r.get('review_total', 0)} files (see: scan --review).")

    state["last_ok"] = time.time()
    state["last_files"] = len(files)
    save_state(state)


if __name__ == "__main__":
    main()
