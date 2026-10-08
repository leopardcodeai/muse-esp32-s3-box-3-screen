#!/usr/bin/env python3
"""Draws the app icons of the web display from the project's figure.

What: writes web/icons/icon-192.png, icon-512.png, icon-maskable-512.png (the figure
  inside the safe zone of a maskable icon) and apple-touch-icon.png (180 px), the files
  manifest.webmanifest and index.html name, and docs/screens/mac-app-icon.png (256 px,
  the figure on a black macOS icon, built by set_mac_app_icon.py's build(); no icon is
  set on any app). The figure is the neutral pose of the project's character
  (tools/figure_source/neutral.png, the picture tools/make_figure.py animates for the
  box), on the page colour of the box, with round corners for the plain icons and a full
  square for the maskable and the Apple one.
Why: an installed web app (Chrome "Install", Safari "Add to Dock") needs icons; the
  figure that greets on the display is the obvious one.
Pitfalls:
  * Needs Pillow and numpy:
      uv run --python 3.14 --with pillow --with numpy web/tools/make_app_icons.py
  * No shadow under the figure: set_mac_app_icon.py cuts the page colour away from the
    border inwards, and a shadow would stay behind as a grey smudge on the black icon.
  * A maskable icon is cut to any shape inside its middle circle (radius 40 % of the
    side); the figure is scaled until every visible pixel lies inside that circle.
  * Re-run after the figure changes; the files are committed.
Usage:
  uv run --python 3.14 --with pillow --with numpy web/tools/make_app_icons.py --dry-run
  uv run --python 3.14 --with pillow --with numpy web/tools/make_app_icons.py
"""
import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = HERE.parent / "icons"
MAC = ROOT / "docs" / "screens" / "mac-app-icon.png"
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(HERE))

import numpy as np  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

import make_figure as fig  # noqa: E402

PAGE = fig.PAGE


def figure_cut() -> Image.Image:
    """The neutral pose cut to its visible pixels, RGBA."""
    im = fig.pose("neutral")
    return im.crop(im.getchannel("A").getbbox())


def fits_circle(alpha: np.ndarray, cx: float, cy: float, radius: float) -> bool:
    ys, xs = np.nonzero(alpha > 8)
    return bool(((xs + 0.5 - cx) ** 2 + (ys + 0.5 - cy) ** 2 <= radius ** 2).all())


def draw_icon(size: int, kind: str) -> Image.Image:
    """The figure on the page colour: "rounded" with round corners, "maskable" a full square with the
    figure inside the safe zone, "square" a full square for Apple, which rounds the corners itself."""
    maskable = kind == "maskable"
    cut = figure_cut()
    canvas = Image.new("RGBA", (size, size), PAGE + (255,))
    share = 0.70 if maskable else 0.74
    while True:
        k = share * size / max(cut.size)
        w, h = round(cut.width * k), round(cut.height * k)
        small = cut.convert("RGBa").resize((w, h), Image.LANCZOS).convert("RGBA")
        x, y = (size - w) // 2, (size - h) // 2 + round(size * 0.01)
        layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        layer.paste(small, (x, y))
        if not maskable or fits_circle(np.asarray(layer.getchannel("A")), size / 2, size / 2, size * 0.4):
            break
        share -= 0.01
    canvas.alpha_composite(layer)
    if kind != "rounded":
        return canvas.convert("RGB")
    # Round corners like a macOS app icon (about 22 % of the side), drawn 4x and reduced.
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=int(size * 4 * 0.22), fill=255)
    canvas.putalpha(mask.resize((size, size), Image.LANCZOS))
    return canvas


TARGETS = [
    ("icon-192.png", 192, "rounded"),
    ("icon-512.png", 512, "rounded"),
    ("icon-maskable-512.png", 512, "maskable"),
    ("apple-touch-icon.png", 180, "square"),  # Apple composes its own corners; a full square is expected
]
NOTES = {"rounded": "round corners", "maskable": "full square, figure in the safe zone",
         "square": "full square, Apple rounds it"}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="say what would be written, write nothing")
    args = ap.parse_args()
    for name, size, kind in TARGETS:
        print(f"  {name}: {size} x {size} ({NOTES[kind]})")
        if args.dry_run:
            continue
        OUT.mkdir(parents=True, exist_ok=True)
        draw_icon(size, kind).save(OUT / name, optimize=True)
    print(f"  {MAC.relative_to(ROOT)}: 256 x 256, set_mac_app_icon.build() from icon-512.png")
    if not args.dry_run:
        import set_mac_app_icon
        set_mac_app_icon.build(OUT / "icon-512.png", 0.0).resize((256, 256), Image.LANCZOS).save(MAC, optimize=True)
    if args.dry_run:
        print("(dry run, nothing written)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
