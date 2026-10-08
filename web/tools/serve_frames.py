#!/usr/bin/env python3
"""Serves the figure's frames to the web display, on this machine only.

What: a tiny HTTP server on 127.0.0.1 that hands out muse_idle.png, muse_wave.png,
  muse_working.png, muse_making.png, muse_confetti.png and muse_avatar.png from one
  folder (by default firmware/figure/, where tools/make_muse_assets.py writes them), with
  `Access-Control-Allow-Origin: *`, so the web display (local or the hosted page) can
  fetch and play them. In the display: Einstellungen, Figur-Quelle "Eigene Bilder aus
  einem Ordner", Ordner-URL http://127.0.0.1:8322.
Why: the figure the owner made from the Muse app is Meta's artwork and may never be
  deployed or committed. This way it stays on his Mac: the page loads it at run time from
  this server, and nothing of the folder reaches the page's own server.
Pitfalls:
  * Bound to 127.0.0.1 on purpose: the frames are for this machine's browser, not for the
    network. A page in another device's browser cannot reach them.
  * Only the six figure names are served, nothing else of the folder (404 for the rest).
  * From the hosted HTTPS page, Chrome and Edge ask once whether the page may reach apps
    on this device (Local Network Access); allow it, or nothing loads. http://127.0.0.1 is
    not mixed content, browsers count this machine as secure.
  * --placeholder serves the project's own figure frames (idle.png and so on) under the
    muse_ names, to try the figure source without Meta's artwork.
  * Read only: it writes nothing, so it has no --dry-run.

Usage:
  python3 web/tools/serve_frames.py                      # firmware/figure on port 8322
  python3 web/tools/serve_frames.py --dir some/folder --port 8323
  python3 web/tools/serve_frames.py --placeholder        # the project's figure, for a test
"""
import argparse
import http.server
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_DIR = HERE.parent.parent / "firmware" / "figure"
NAMES = ["idle", "wave", "working", "making", "confetti", "avatar"]


def make_handler(folder: Path, placeholder: bool):
    files = {f"/muse_{n}.png": folder / (f"{n}.png" if placeholder else f"muse_{n}.png") for n in NAMES}

    class Handler(http.server.BaseHTTPRequestHandler):
        server_version = "MuseFrames/1.0"

        def cors(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
            self.send_header("Cache-Control", "no-cache")

        def do_OPTIONS(self):  # a preflight, should a browser send one
            self.send_response(204)
            self.cors()
            self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "*")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.end_headers()

        def do_HEAD(self):
            self.do_GET(body=False)

        def do_GET(self, body=True):
            path = self.path.split("?", 1)[0]
            target = files.get(path)
            if target is None or not target.is_file():
                self.send_response(404)
                self.cors()
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            data = target.read_bytes()
            self.send_response(200)
            self.cors()
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if body:
                self.wfile.write(data)

    return Handler


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dir", type=Path, default=DEFAULT_DIR, help="folder with muse_<name>.png (default: firmware/figure)")
    ap.add_argument("--port", type=int, default=8322, help="port on 127.0.0.1 (default 8322)")
    ap.add_argument("--placeholder", action="store_true", help="serve the project's figure frames <name>.png as muse_<name>.png")
    args = ap.parse_args()
    sys.stdout.reconfigure(line_buffering=True)  # the lines show at once, also in a log
    folder = args.dir.resolve()
    if not folder.is_dir():
        sys.exit(f"Ordner nicht gefunden: {folder}")
    found = [n for n in NAMES if (folder / (f"{n}.png" if args.placeholder else f"muse_{n}.png")).is_file()]
    missing = [n for n in NAMES if n not in found]
    print(f"Ordner: {folder}")
    print(f"Bilder: {len(found)} von {len(NAMES)}" + (f", fehlt: {', '.join(missing)}" if missing else ""))
    if not found:
        sys.exit("Keine Bilder der Figur im Ordner (tools/make_muse_assets.py schreibt sie).")
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(folder, args.placeholder))
    print(f"Ordner-URL für die Anzeige: http://127.0.0.1:{args.port}  (Strg+C beendet)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
