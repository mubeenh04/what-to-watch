#!/bin/bash
# Installs the What to Watch hard drive scanner on this Mac.
#   bash setup.sh            install or update (keeps your settings)
#   bash setup.sh --settings change the drive, folders or key
#   bash setup.sh --uninstall
# Everything goes in ~/.what-to-watch. Your settings, including the scanner key, stay in
# ~/.what-to-watch/scanner.env on this Mac only.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="$HOME/.what-to-watch"
ENV_FILE="$DIR/scanner.env"
LABEL="com.whattowatch.scanner"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
FUNCTION_URL="https://ezedrdpzhgtwrfjmupvf.supabase.co/functions/v1/tmdb-sync"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  say "Nightly scan turned off. Your settings are still in $DIR (delete that folder to remove everything)."
  exit 0
fi

mkdir -p "$DIR"
chmod 700 "$DIR"

# ---------- Python + guessit ----------
PY=""
for p in /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do
  if [[ -x "$p" ]] && "$p" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then
    PY="$p"; break
  fi
done
if [[ -z "$PY" ]]; then
  say "Python 3.9 or newer is needed. Install it with:  brew install python   then run this again."
  exit 1
fi
say "Installing the scanner (Python: $PY)"
if [[ ! -x "$DIR/venv/bin/python" ]]; then
  "$PY" -m venv "$DIR/venv"
fi
"$DIR/venv/bin/python" -m pip install --quiet --upgrade pip >/dev/null 2>&1 || true
"$DIR/venv/bin/python" -m pip install --quiet -r "$HERE/requirements.txt"
cp "$HERE/scan.py" "$DIR/scan.py"

cat > "$DIR/scan" <<EOF
#!/bin/bash
exec "$DIR/venv/bin/python" "$DIR/scan.py" "\$@"
EOF
chmod 755 "$DIR/scan"

# ---------- Settings ----------
clean_path() {  # a folder dragged into Terminal arrives as /Volumes/My\ Passport/Movies or in quotes
  local p="$1"
  p="${p#"${p%%[![:space:]]*}"}"; p="${p%"${p##*[![:space:]]}"}"
  p="${p#\'}"; p="${p%\'}"; p="${p#\"}"; p="${p%\"}"
  p="${p//\\ / }"
  printf '%s' "${p%/}"
}

if [[ ! -f "$ENV_FILE" || "${1:-}" == "--settings" ]]; then
  say "Settings"
  read -r -p "A name for the drive (for example Media HDD): " DRIVE_NAME
  DRIVE_NAME="${DRIVE_NAME:-Media HDD}"

  FOLDERS=""
  echo "Drag the movies folder from Finder into this window, then press Return."
  echo "Add more folders the same way (for example a TV folder). Press Return on an empty line when done."
  while true; do
    read -r -p "Folder: " F
    [[ -z "$F" ]] && break
    F="$(clean_path "$F")"
    if [[ ! -d "$F" ]]; then echo "  Can't find that folder: $F"; continue; fi
    FOLDERS="${FOLDERS:+$FOLDERS;}$F"
  done
  if [[ -z "$FOLDERS" ]]; then echo "No folder given."; exit 1; fi

  echo
  echo "Paste the scanner key (from the Supabase SQL editor). It won't show as you paste."
  read -r -s -p "Key: " SECRET; echo
  if [[ ! "$SECRET" =~ ^[0-9a-f]{64}$ ]]; then echo "That doesn't look like the key (64 letters and digits)."; exit 1; fi

  umask 077
  cat > "$ENV_FILE" <<EOF
# What to Watch hard drive scanner. Private: holds the scanner key. Never share or commit.
WTW_FUNCTION_URL=$FUNCTION_URL
WTW_SCAN_SECRET=$SECRET
WTW_DRIVE_NAME=$DRIVE_NAME
WTW_SCAN_FOLDERS=$FOLDERS
WTW_MIN_SIZE_MB=50
EOF
  chmod 600 "$ENV_FILE"
  echo "Saved to $ENV_FILE"
fi

# ---------- Nightly at 02:30, and whenever a drive is plugged in ----------
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$DIR/venv/bin/python</string>
    <string>$DIR/scan.py</string>
    <string>--hourly</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>30</integer></dict>
  <key>StartOnMount</key><true/>
  <key>StandardOutPath</key><string>$DIR/scan.log</string>
  <key>StandardErrorPath</key><string>$DIR/scan.log</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

REAL_PY="$("$DIR/venv/bin/python" -c 'import os, sys; print(os.path.realpath(getattr(sys, "_base_executable", sys.executable)))')"
echo "$REAL_PY" > "$DIR/python-path.txt"

say "Done."
echo "The scan runs every night at 02:30 (or when the Mac next wakes) and whenever a drive is plugged in."
echo
echo "Next: try it now with   ~/.what-to-watch/scan --dry-run"
echo "Log of nightly runs:     ~/.what-to-watch/scan.log"
echo
echo "If the log says 'Operation not permitted', give Python access to the drive:"
echo "System Settings > Privacy & Security > Full Disk Access > + , press Cmd+Shift+G and paste:"
echo "  $REAL_PY"
