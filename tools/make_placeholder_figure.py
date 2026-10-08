#!/usr/bin/env python3
"""Draws the placeholder figure: a neutral round character for the box's display.

What: writes firmware/figure/idle.png, wave.png, working.png, making.png (160 x 160
  animated PNG, 16 frames, 6 fps), confetti.png (18 frames, plays once) and avatar.png
  (72 x 72 still), the same files, sizes and frame counts the firmware expects.
Why: the firmware was written for the character of the Muse app, whose animations are
  Meta's artwork and cannot be shipped. This placeholder builds out of the box; with the
  Muse app installed, tools/make_muse_assets.py replaces the files with Muse's own
  (never commit those, tools/check_private.py refuses them).
Pitfalls:
  * Frame counts and sizes matter for flash: every 160 x 160 frame costs 51 KB of flash
    as RGB565; 82 frames are about 4.2 MB. Keep the counts.
  * The page colour (243, 243, 243) must match MUSE_BG in muse-box.yaml; every frame fades
    into it at the edges so the figure sits on the page without a visible square.
  * idle, wave, working and making loop forwards and backwards on the box (ping-pong);
    confetti plays once and holds its last frame.
Usage:
  uv run --python 3.14 --with pillow tools/make_placeholder_figure.py --dry-run
  uv run --python 3.14 --with pillow tools/make_placeholder_figure.py
"""
import argparse
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "firmware" / "figure"
SIZE = 160
AVATAR = 72
FPS = 6
PAGE = (243, 243, 243)
BODY = (76, 150, 214)      # a friendly blue
BODY_DARK = (54, 112, 168)
EYE = (28, 28, 30)
CHEEK = (255, 158, 158)
SPARK = (255, 204, 0)
CONFETTI = [(255, 59, 48), (255, 149, 0), (255, 204, 0), (52, 199, 89), (48, 176, 199), (0, 122, 255), (175, 82, 222), (255, 45, 85)]
SUPER = 4  # draw at 4x and shrink: smooth edges without a vector library


def canvas():
    return Image.new("RGB", (SIZE * SUPER, SIZE * SUPER), PAGE)


def body(draw, cx, cy, r, squash=1.0):
    """A round body with a darker lower half, slightly squashed for breathing."""
    rx, ry = r, r * squash
    draw.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=BODY)
    draw.chord((cx - rx, cy - ry, cx + rx, cy + ry), 20, 160, fill=BODY_DARK)
    draw.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), outline=BODY_DARK, width=3 * SUPER)


def face(draw, cx, cy, r, look=0.0, blink=False, smile=1.0):
    ex = r * 0.34
    ey = cy - r * 0.12
    er = r * 0.11
    for sx in (-1, 1):
        x = cx + sx * ex + look * r * 0.1
        if blink:
            draw.line((x - er, ey, x + er, ey), fill=EYE, width=3 * SUPER)
        else:
            draw.ellipse((x - er, ey - er, x + er, ey + er), fill=(255, 255, 255))
            draw.ellipse((x - er * 0.55 + look * er * 0.4, ey - er * 0.55, x + er * 0.55 + look * er * 0.4, ey + er * 0.55), fill=EYE)
    for sx in (-1, 1):
        x = cx + sx * r * 0.52
        draw.ellipse((x - r * 0.1, cy + r * 0.12 - r * 0.06, x + r * 0.1, cy + r * 0.12 + r * 0.06), fill=CHEEK)
    my = cy + r * 0.3
    mw = r * 0.26
    if smile >= 0:
        draw.arc((cx - mw, my - mw * smile, cx + mw, my + mw * smile), 10, 170, fill=EYE, width=3 * SUPER)
    else:
        draw.ellipse((cx - mw * 0.4, my - mw * 0.3, cx + mw * 0.4, my + mw * 0.3), fill=EYE)


def vignette(img):
    """Fades the frame's edges into the page colour, like the firmware's own assets."""
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    m = int(w * 0.06)
    d.rounded_rectangle((m, m, w - m, h - m), radius=int(w * 0.22), fill=255)
    from PIL import ImageFilter
    mask = mask.filter(ImageFilter.GaussianBlur(w * 0.05))
    page = Image.new("RGB", (w, h), PAGE)
    return Image.composite(img, page, mask)


def finish(img):
    return vignette(img).resize((SIZE, SIZE), Image.LANCZOS)


def frame_idle(i, n):
    img = canvas()
    d = ImageDraw.Draw(img)
    t = i / n
    cx, cy, r = SIZE * SUPER / 2, SIZE * SUPER * 0.54, SIZE * SUPER * 0.3
    body(d, cx, cy, r, squash=1.0 + 0.03 * math.sin(2 * math.pi * t))
    face(d, cx, cy, r, blink=(i == 11))
    return finish(img)


def frame_wave(i, n):
    img = canvas()
    d = ImageDraw.Draw(img)
    t = i / n
    cx, cy, r = SIZE * SUPER / 2, SIZE * SUPER * 0.54, SIZE * SUPER * 0.3
    body(d, cx, cy, r)
    face(d, cx, cy, r, smile=1.2)
    # the waving hand: a small disc on an arm that swings
    ang = math.radians(-60 + 35 * math.sin(2 * math.pi * t * 2))
    ax, ay = cx + r * 0.95, cy - r * 0.1
    hx, hy = ax + math.cos(ang) * r * 0.55, ay + math.sin(ang) * r * 0.55
    d.line((ax, ay, hx, hy), fill=BODY_DARK, width=int(r * 0.16))
    d.ellipse((hx - r * 0.14, hy - r * 0.14, hx + r * 0.14, hy + r * 0.14), fill=BODY)
    return finish(img)


def frame_working(i, n):
    img = canvas()
    d = ImageDraw.Draw(img)
    t = i / n
    cx, cy, r = SIZE * SUPER / 2, SIZE * SUPER * 0.56, SIZE * SUPER * 0.28
    body(d, cx, cy, r)
    face(d, cx, cy, r, look=math.sin(2 * math.pi * t), smile=0.4)
    # three thought dots above, swelling one after another
    for k in range(3):
        p = (math.sin(2 * math.pi * (t - k * 0.18)) + 1) / 2
        rr = r * (0.06 + 0.05 * p)
        x = cx + (k - 1) * r * 0.32
        y = cy - r * 1.25 - k * r * 0.05
        d.ellipse((x - rr, y - rr, x + rr, y + rr), fill=BODY_DARK)
    return finish(img)


def frame_making(i, n):
    img = canvas()
    d = ImageDraw.Draw(img)
    t = i / n
    cx, cy, r = SIZE * SUPER / 2, SIZE * SUPER * 0.56, SIZE * SUPER * 0.28
    body(d, cx, cy, r)
    face(d, cx, cy, r, smile=0.9)
    # a spark that orbits the head
    ang = 2 * math.pi * t
    sx, sy = cx + math.cos(ang) * r * 1.25, cy - r * 0.4 + math.sin(ang) * r * 0.5
    s = r * 0.16
    pts = []
    for k in range(10):
        a = math.pi / 5 * k - math.pi / 2
        rr = s if k % 2 == 0 else s * 0.45
        pts.append((sx + math.cos(a) * rr, sy + math.sin(a) * rr))
    d.polygon(pts, fill=SPARK)
    return finish(img)


def frame_confetti(i, n):
    img = canvas()
    d = ImageDraw.Draw(img)
    t = i / (n - 1)
    cx, cy, r = SIZE * SUPER / 2, SIZE * SUPER * 0.58, SIZE * SUPER * 0.26
    bounce = abs(math.sin(math.pi * t * 2)) * r * 0.15
    body(d, cx, cy - bounce, r)
    face(d, cx, cy - bounce, r, smile=1.3)
    # confetti falls from the top; deterministic positions
    for k in range(26):
        seed = (k * 7919) % 1000 / 1000
        x = (k * 61) % SIZE * SUPER
        y = ((seed * SIZE + t * SIZE * 1.4) % (SIZE * 1.2) - SIZE * 0.1) * SUPER
        w, h = r * 0.09, r * 0.05 * (0.5 + abs(math.sin(2 * math.pi * (t + seed))))
        d.rectangle((x - w, y - h, x + w, y + h), fill=CONFETTI[k % 8])
    return finish(img)


def avatar():
    img = canvas()
    d = ImageDraw.Draw(img)
    cx, cy, r = SIZE * SUPER / 2, SIZE * SUPER * 0.5, SIZE * SUPER * 0.4
    body(d, cx, cy, r)
    face(d, cx, cy, r)
    return vignette(img).resize((AVATAR, AVATAR), Image.LANCZOS)


ANIMATIONS = {"idle": (frame_idle, 16, 0), "wave": (frame_wave, 16, 0), "working": (frame_working, 16, 0),
              "making": (frame_making, 16, 0), "confetti": (frame_confetti, 18, 1)}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="list what would be written")
    ap.add_argument("--force", action="store_true", help="overwrite files that exist")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for name, (fn, n, loop) in ANIMATIONS.items():
        path = OUT / f"{name}.png"
        total += n * SIZE * SIZE * 2
        if path.exists() and not args.force:
            print(f"  {name}.png exists, kept (use --force)")
            continue
        print(f"  {name}.png: {n} frames at {FPS} fps" + (" (once)" if loop else " (loop)"))
        if args.dry_run:
            continue
        frames = [fn(i, n) for i in range(n)]
        frames[0].save(path, save_all=True, append_images=frames[1:], duration=round(1000 / FPS), loop=loop)
    av = OUT / "avatar.png"
    if not av.exists() or args.force:
        print(f"  avatar.png: {AVATAR} x {AVATAR}")
        if not args.dry_run:
            avatar().save(av)
    print(f"flash for the frames: about {total / 1024 / 1024:.1f} MB as RGB565")
    if args.dry_run:
        print("(dry run, nothing written)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
