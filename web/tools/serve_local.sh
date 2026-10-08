#!/bin/sh
# serve_local.sh: Muse Web Screen from this Mac at http://localhost:8321, started at login.
#
# What: installs a macOS LaunchAgent that serves the web/ folder with Python's static file
# server, bound to 127.0.0.1 only, so the page is never reachable from the network.
#
# Why: a page served over https (muse-web-screen.vercel.app) may not open ws:// to a Home
# Assistant on the LAN; Safari and Firefox refuse it as mixed content, Chrome asks first.
# Served from http://localhost, the page reaches ws://<home-assistant>:8123 like any local
# app. Open http://localhost:8321/ in Safari and use File > Add to Dock for an app window.
#
# Pitfalls:
#   * launchd has no PATH: python3 is resolved when installing. After a Python upgrade or
#     after moving this folder, run --install again.
#   * The port must be free; MUSE_WEB_PORT changes it.
#   * The browser keeps the settings (and the Home Assistant token you paste) in its own
#     storage for http://localhost:8321; another port is another origin with empty settings.
#
# Usage:
#   web/tools/serve_local.sh --dry-run     show what would be written, change nothing
#   web/tools/serve_local.sh --install     write and start the LaunchAgent (idempotent)
#   web/tools/serve_local.sh --status      is it loaded, does the page answer
#   web/tools/serve_local.sh --uninstall   stop and remove it
set -eu

LABEL="ai.leopardcode.muse-web-screen"
PORT="${MUSE_WEB_PORT:-8321}"
WEB="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/$LABEL.log"
PY="$(command -v python3 || true)"
DOMAIN="gui/$(id -u)"

plist() {
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PY</string><string>-m</string><string>http.server</string><string>$PORT</string>
    <string>--bind</string><string>127.0.0.1</string><string>--directory</string><string>$WEB</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
}

case "${1:---status}" in
  --dry-run)
    echo "would write $PLIST (python3: ${PY:-not found}, folder: $WEB, port $PORT):"
    plist
    ;;
  --install)
    [ -n "$PY" ] || { echo "python3 not found" >&2; exit 1; }
    mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    plist > "$PLIST"
    launchctl bootstrap "$DOMAIN" "$PLIST"
    sleep 1
    "$0" --status
    ;;
  --uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "removed $LABEL"
    ;;
  --status)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then echo "loaded: $LABEL"; else echo "not loaded: $LABEL"; fi
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/index.html" || true)
    echo "http://localhost:$PORT/index.html answers $code"
    ;;
  *)
    sed -n '2,23p' "$0"; exit 2
    ;;
esac
