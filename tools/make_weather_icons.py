#!/usr/bin/env python3
"""Builds the weather icons for the Muse display from Meteocons (MIT licence).

What: downloads the static "fill" icons of Meteocons 2.0.0 (Bas Milius, MIT)
from the npm CDN, renders them with cairosvg and writes RGB PNGs into icons/:
72 px for the header of a text card (the size of the avatar it replaces) and
104 px for the weather card. stackchan-box3.yaml reads them; muse.h holds the
same order as ICONS below.

Why: the box font has no emoji glyphs, so Muse's weather emojis came out as
nothing (06.10.2026). The firmware now maps weather emojis and Home Assistant's
weather conditions to these icons and drops every other emoji.

Pitfalls:
  * Every icon is composited onto the page background (243, 243, 243) and
    stored without alpha, which halves the flash compared with RGB565 plus
    alpha. Change BACKGROUND together with MUSE_BG in stackchan-box3.yaml.
  * All icons are cropped to one common square (the union of their drawn
    areas), so a sun and a cloud keep their relative size. Cropping each icon
    to its own bounds would blow small icons up.
  * The order of ICONS is the icon number in muse.h. Append new icons at the
    end; reordering breaks the mapping on the box.
  * cairosvg needs libcairo from Homebrew (brew install cairo). macOS does not
    search /opt/homebrew/lib, so the script restarts itself once with
    DYLD_FALLBACK_LIBRARY_PATH set.
  * The PNGs are committed (the MIT licence allows it and sits beside them),
    so a firmware build needs no network for icons. Re-run only to change the set.

  * Ordered dithering to RGB565 (see dither_rgb565): without it the soft
    gradients band on the display.

Usage:
  uv run --python 3.14 --with cairosvg --with pillow --with numpy make_muse_icons.py --dry-run
  uv run --python 3.14 --with cairosvg --with pillow --with numpy make_muse_icons.py
  uv run --python 3.14 --with cairosvg --with pillow --with numpy make_muse_icons.py --force
"""
import argparse
import io
import os
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "icons"
VERSION = "2.0.0"
CDN = f"https://cdn.jsdelivr.net/npm/@bybas/weather-icons@{VERSION}/design/fill/export/"
BACKGROUND = (243, 243, 243)  # must match MUSE_BG in stackchan-box3.yaml
SMALL, LARGE = 72, 104
RENDER = 512                  # the icons' own viewBox

# (key, Meteocons file, also as large weather-card icon). Order = number in muse.h.
ICONS = [
    ("clear_day", "wi_clear-day", True),
    ("clear_night", "wi_clear-night", True),
    ("partly_day", "wi_partly-cloudy-day", True),
    ("partly_night", "wi_partly-cloudy-night", True),
    ("cloudy", "wi_cloudy", True),
    ("overcast", "wi_overcast", True),
    ("fog", "wi_fog", True),
    ("drizzle", "wi_drizzle", True),
    ("rain", "wi_rain", True),
    ("extreme_rain", "wi_raindrops", True),  # 2.0.0 has no extreme-rain
    ("showers", "wi_partly-cloudy-day-rain", True),
    ("thunder", "wi_thunderstorms", True),
    ("thunder_rain", "wi_thunderstorms-rain", True),
    ("snow", "wi_snow", True),
    ("sleet", "wi_sleet", True),
    ("hail", "wi_hail", True),
    ("wind", "wi_wind", True),
    ("tornado", "wi_tornado", True),
    ("umbrella", "wi_umbrella", False),
    ("thermometer", "wi_thermometer", False),
    ("raindrop", "wi_raindrop", False),
    ("sunrise", "wi_sunrise", False),
    ("sunset", "wi_sunset", False),
]

LICENSE = """Weather icons: Meteocons 2.0.0 by Bas Milius (https://github.com/basmilius/weather-icons)

MIT License

Copyright (c) 2020-2024 Bas Milius

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""


def ensure_cairo():
    """Restarts once with Homebrew's library folder on the dyld fallback path."""
    lib = "/opt/homebrew/lib"
    if os.path.isdir(lib) and lib not in os.environ.get("DYLD_FALLBACK_LIBRARY_PATH", ""):
        env = dict(os.environ, DYLD_FALLBACK_LIBRARY_PATH=lib)
        os.execve(sys.executable, [sys.executable, *sys.argv], env)


def targets():
    for i, (key, name, large) in enumerate(ICONS):
        yield i, key, name, SMALL, OUT / f"wx{SMALL}_{key}.png"
        if large:
            yield i, key, name, LARGE, OUT / f"wx{LARGE}_{key}.png"


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--force", action="store_true", help="alles neu erzeugen")
    ap.add_argument("--dry-run", action="store_true", help="nur zeigen, nichts schreiben")
    args = ap.parse_args()

    todo = [t for t in targets() if args.force or not t[4].exists()]
    flash = sum(size * size * 2 for _, _, _, size, _ in targets())
    print(f"{len(ICONS)} Icons, {len(list(targets()))} Dateien, im Flash (RGB565) {flash / 1e3:.0f} kB")
    print(f"zu erzeugen: {len(todo)}")
    if args.dry_run or not todo:
        for _, key, name, size, path in todo:
            print(f"  {path.name}  <-  {name}.svg")
        return

    ensure_cairo()
    import cairosvg
    from PIL import Image

    renders = {}
    for key, name, _ in ICONS:
        with urllib.request.urlopen(CDN + name + ".svg", timeout=30) as r:
            svg = r.read()
        png = cairosvg.svg2png(bytestring=svg, output_width=RENDER, output_height=RENDER)
        renders[key] = Image.open(io.BytesIO(png)).convert("RGBA")
        print(f"  geladen  {name}")

    # One common square around the union of all drawn areas.
    boxes = [im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox() for im in renders.values()]
    left = min(b[0] for b in boxes)
    top = min(b[1] for b in boxes)
    right = max(b[2] for b in boxes)
    bottom = max(b[3] for b in boxes)
    side = max(right - left, bottom - top) + 8
    cx, cy = (left + right) / 2, (top + bottom) / 2
    crop = (round(cx - side / 2), round(cy - side / 2), round(cx + side / 2), round(cy + side / 2))
    print(f"gemeinsamer Ausschnitt {crop} ({side} px von {RENDER})")

    from PIL import ImageFilter

    OUT.mkdir(exist_ok=True)
    for _, key, name, size, path in todo:
        icon = renders[key].crop(crop).resize((size, size), Image.LANCZOS)
        canvas = Image.new("RGBA", (size, size), BACKGROUND + (255,))
        # Soft drop shadow: the white clouds would otherwise vanish on the light page.
        alpha = icon.getchannel("A").filter(ImageFilter.GaussianBlur(size * 0.035))
        shadow = Image.new("RGBA", (size, size), (60, 60, 70, 0))
        shadow.putalpha(alpha.point(lambda a: int(a * 0.30)))
        canvas.alpha_composite(shadow, (0, max(1, round(size * 0.03))))
        canvas.alpha_composite(icon)
        Image.fromarray(dither_rgb565(canvas.convert("RGB"))).save(path, optimize=True)
        print(f"  {path.name}")
    (OUT / "LICENSE-meteocons.txt").write_text(LICENSE, encoding="utf-8")


def dither_rgb565(image):
    """Ordered (Bayer 4x4) dither to the display's 5-6-5 bit colours.

    ESPHome stores images as RGB565 by cutting off the low bits, which bands soft
    gradients and tints them. Rounding with a fixed pattern keeps the colours
    true and stays still from frame to frame. Mirrors make_muse_assets.py.
    """
    import numpy as np
    rgb = np.asarray(image, dtype=np.float32)
    h, w, _ = rgb.shape
    bayer = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], np.float32)
    t = np.tile((bayer + 0.5) / 16 - 0.5, (h // 4 + 1, w // 4 + 1))[:h, :w]
    out = np.empty(rgb.shape, np.uint8)
    for c, bits in ((0, 5), (1, 6), (2, 5)):
        top = (1 << bits) - 1
        q = np.clip(np.floor(rgb[..., c] / 255 * top + 0.5 + t), 0, top)
        out[..., c] = np.round(q * 255 / top).astype(np.uint8)
    return out


if __name__ == "__main__":
    main()
