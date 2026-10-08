#!/usr/bin/env python3
"""Draws the app icons of the web display from the placeholder figure.

What: writes web/icons/icon-192.png, icon-512.png, icon-maskable-512.png (the figure
  inside the safe zone of a maskable icon) and apple-touch-icon.png (180 px), the files
  manifest.webmanifest and index.html name. The character is the one of
  tools/make_placeholder_figure.py (its body() and face() are imported), on the page
  colour of the box, with round corners for the plain icons and a full square for the
  maskable one.
Why: an installed web app (Chrome "Install", Safari "Add to Dock") needs icons; the
  figure that greets on the display is the obvious one, and generating them keeps the
  repository free of binary artwork of unknown origin.
Pitfalls:
  * Needs Pillow. Run with the project's Python or with uv:
      uv run --python 3.14 --with pillow web/tools/make_app_icons.py
  * Re-run after a change to the placeholder figure; the files are committed.
Usage:
  python3 web/tools/make_app_icons.py --dry-run
  python3 web/tools/make_app_icons.py
"""
import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = HERE.parent / "icons"
sys.path.insert(0, str(ROOT / "tools"))

from PIL import Image, ImageDraw  # noqa: E402

import make_placeholder_figure as fig  # noqa: E402

SUPER = 4
PAGE = fig.PAGE


def draw_icon(size, maskable):
    """The figure on the page colour; the maskable variant keeps it inside the inner 80 %."""
    px = size * SUPER
    img = Image.new("RGB", (px, px), PAGE)
    d = ImageDraw.Draw(img)
    scale = 0.8 if maskable else 1.0
    cx, cy, r = px / 2, px * 0.52, px * 0.36 * scale
    fig.body(d, cx, cy, r)
    fig.face(d, cx, cy, r)
    if not maskable:
        # Round corners like a macOS app icon (about 22 % of the side).
        mask = Image.new("L", (px, px), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, px - 1, px - 1), radius=int(px * 0.22), fill=255)
        rgba = img.convert("RGBA")
        rgba.putalpha(mask)
        return rgba.resize((size, size), Image.LANCZOS)
    return img.resize((size, size), Image.LANCZOS)


TARGETS = [
    ("icon-192.png", 192, False),
    ("icon-512.png", 512, False),
    ("icon-maskable-512.png", 512, True),
    ("apple-touch-icon.png", 180, True),  # Apple composes its own corners; a full square is expected
]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="say what would be written, write nothing")
    args = ap.parse_args()
    for name, size, maskable in TARGETS:
        path = OUT / name
        print(f"  {name}: {size} x {size}" + (" (maskable, full square)" if maskable else " (round corners)"))
        if args.dry_run:
            continue
        OUT.mkdir(parents=True, exist_ok=True)
        draw_icon(size, maskable).save(path, optimize=True)
    if args.dry_run:
        print("(dry run, nothing written)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
