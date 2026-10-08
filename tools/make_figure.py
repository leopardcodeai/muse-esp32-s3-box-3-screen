#!/usr/bin/env python3
"""Builds the box's figure frames from the generated poses in tools/figure_source/.

What: writes firmware/figure/idle.png, wave.png, working.png, making.png (160 x 160
  animated PNGs, 16 frames each, played forwards and backwards at 160 ms a step on the
  box), confetti.png (18 frames, played once, the last one held) and avatar.png (72 x 72,
  a still of the face), the files, sizes and frame counts the firmware embeds. The
  motion is made from the five poses with simple transforms:
    idle      the neutral pose, a gentle bob and breath, one blink frame (the blink pose)
    wave      the wave pose swaying from side to side, a small bob
    working   the thinking pose, a slow bob, a small spark orbiting the head (drawn here)
    making    the neutral pose rocking a little, sparkles twinkling around it (drawn here)
    confetti  the celebrating pose hopping twice, confetti falling (drawn here)
    avatar    the neutral pose, larger, as a still
  Every frame is drawn four times larger on the page colour with a soft shadow, faded
  into the page at its edges by the same vignette the placeholder had, reduced to its
  size and dithered to RGB565 with the Bayer pattern of make_muse_assets.py.
Why: the figure was a flat circle with a face drawn in code (make_placeholder_figure.py, removed).
  The poses are the project's own character, generated once with an image model from the
  README's hero picture (tools/make_figure_source.py, the prompts beside each PNG); this
  script turns them into the box's animations whenever the motion changes, without
  asking the model again.
Pitfalls:
  * Flash: every 160 x 160 frame is 51,200 bytes of RGB565, the 82 frames 4.2 MB. Keep the
    sizes and counts (FRAMES, CONFETTI_FRAMES); the firmware plays whatever count a file
    has, but the app partition is not unlimited.
  * The page colour (243, 243, 243) must match MUSE_BG in muse-esp32boxs3-screen.yaml and
    PAGE in render_scene.py and the web app; every frame fades into it at the edges.
  * Ping-pong: the box plays 0..15 and back, so every motion here is a function that is
    at rest (an extremum) at frame 0 and frame 15, otherwise the turn shows as a jolt.
    The blink sits on frame 15, the one frame shown only once per cycle.
  * Two equal frames in a row are merged by Pillow's APNG writer, and the file then holds
    fewer frames than the box and the tests expect. A motion symmetric around the middle
    (cos(4 pi i / 15)) does exactly that at frames 7 and 8; the script refuses such a file.
  * The model moves and scales the character a little from pose to pose. Every pose is
    registered on the neutral pose by its silhouette (scale and shift with the best
    overlap) before anything moves, so the blink frame does not jump.
  * The page itself is not dithered: 243 lies between two RGB565 steps, and the Bayer
    pattern would turn the plain page around the figure into a fine checker of both,
    which shows on the box as a faint square (the box's own background is 243 cut to
    RGB565, a single colour) and in the web app and the previews as a grid. Pixels within
    1 of the page colour are written as the page colour; ESPHome cuts them to exactly the
    box's background, and everything else is dithered.
  * The generated PNGs carry a faint alpha haze around the figure; alpha below 10 is
    cleared. Everything is scaled in premultiplied alpha (Pillow's "RGBa"), or the
    transparent pixels bleed a dark fringe into the edges.
  * Changing a frame changes its checksum: run `python3 tools/check_private.py
    --record-figure` afterwards, then the web copies (web/figure-default/) and the
    previews follow (README "Make it yours").
Usage (Pillow and numpy come in through uv):
  uv run --python 3.14 --with pillow --with numpy tools/make_figure.py --dry-run
  uv run --python 3.14 --with pillow --with numpy tools/make_figure.py
  uv run --python 3.14 --with pillow --with numpy tools/make_figure.py --only wave --sheet /tmp/wave.png
"""
from __future__ import annotations

import argparse
import math
import random
import sys
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SRC = HERE / "figure_source"
OUT = ROOT / "firmware" / "figure"
sys.path.insert(0, str(HERE))
from make_muse_assets import dither_rgb565  # noqa: E402  (numpy and Pillow only, nothing of the Muse app)

SIZE = 160              # a frame, square
AVATAR = 72             # the still on text, value and question pages
FRAMES = 16             # idle, wave, working, making
CONFETTI_FRAMES = 18    # played once
FPS = 6                 # the delay written into the files (167 ms); the box steps at its own pace
PAGE = (243, 243, 243)
SUPER = 4               # drawn at 4x and reduced
FIGURE_H = 110          # the neutral pose's height with the tuft, in frame pixels
CENTRE = (80.0, 82.0)   # the neutral pose's box centre in a frame
SPARK = (255, 204, 0)
SPARK_CORE = (255, 247, 214)
SPARKLES = [(255, 196, 0), (90, 176, 255), (255, 214, 64), (255, 130, 180), (255, 196, 0)]
CONFETTI = [(255, 59, 48), (255, 149, 0), (255, 204, 0), (52, 199, 89), (48, 176, 199), (0, 122, 255),
            (175, 82, 222), (255, 45, 85)]
POSES = ["neutral", "blink", "wave", "working", "celebrate"]


# ------------------------------------------------------------------ the poses --

@lru_cache(maxsize=None)
def pose(name: str) -> Image.Image:
    """A pose as RGBA with the faint alpha haze of the generator cleared."""
    path = SRC / f"{name}.png"
    if not path.exists():
        raise SystemExit(f"{path.relative_to(ROOT)} is missing: run tools/make_figure_source.py first")
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im.getchannel("A")).astype(np.float32)
    a = np.clip((a - 10) * 255 / 245, 0, 255).astype(np.uint8)
    im.putalpha(Image.fromarray(a))
    return im


def silhouette(im: Image.Image, n: int) -> np.ndarray:
    a = im.getchannel("A").resize((n, n), Image.BOX)
    return (np.asarray(a) > 127).astype(np.float32)


def bbox(im: Image.Image) -> tuple[float, float, float, float]:
    m = np.asarray(im.getchannel("A")) > 127
    ys, xs = np.nonzero(m)
    return float(xs.min()), float(ys.min()), float(xs.max() + 1), float(ys.max() + 1)


@lru_cache(maxsize=None)
def register(name: str, n: int = 512, reach: int = 40) -> tuple[float, float, float]:
    """(s, dx, dy) that put pose `name` onto the neutral pose: p_neutral = C + s * (p - C) + (dx, dy),
    in source pixels around the picture centre C. Found as the scale and shift whose silhouettes
    overlap best (intersection over union), the shift by FFT cross-correlation for every scale."""
    if name == "neutral":
        return 1.0, 0.0, 0.0
    fixed = silhouette(pose("neutral"), n)
    moving = Image.fromarray((silhouette(pose(name), n) * 255).astype(np.uint8))
    pad = 2 * n
    ff = np.fft.rfft2(fixed, (pad, pad))
    af = fixed.sum()
    c = n / 2
    best = (-1.0, 1.0, 0, 0)
    for s in np.arange(0.86, 1.1401, 0.004):
        m = moving.transform((n, n), Image.AFFINE, (1 / s, 0, c - c / s, 0, 1 / s, c - c / s), resample=Image.BILINEAR)
        mm = (np.asarray(m) > 127).astype(np.float32)
        corr = np.fft.irfft2(ff * np.conj(np.fft.rfft2(mm, (pad, pad))), (pad, pad))
        corr = np.roll(np.roll(corr, reach, 0), reach, 1)[: 2 * reach + 1, : 2 * reach + 1]
        iy, ix = np.unravel_index(np.argmax(corr), corr.shape)
        inter = corr[iy, ix]
        iou = inter / (af + mm.sum() - inter)
        if iou > best[0]:
            best = (iou, float(s), ix - reach, iy - reach)
    iou, s, dx, dy = best
    k = pose(name).width / n
    return s, dx * k, dy * k


@lru_cache(maxsize=None)
def base_transform() -> tuple[float, float, float]:
    """Neutral source pixels to frame pixels at 4x: (scale, offset x, offset y)."""
    x0, y0, x1, y1 = bbox(pose("neutral"))
    s = FIGURE_H * SUPER / (y1 - y0)
    return s, CENTRE[0] * SUPER - s * (x0 + x1) / 2, CENTRE[1] * SUPER - s * (y0 + y1) / 2


@lru_cache(maxsize=None)
def prepared(name: str, k: float = 1.0) -> tuple[Image.Image, float, float]:
    """Pose `name` scaled once (Lanczos, premultiplied) for a 4x frame, times k around the frame's
    centre, with the offset that places it where the neutral pose stands: frame = q + (bx, by)."""
    s_r, dx, dy = register(name)
    s0, ox, oy = base_transform()
    src = pose(name)
    cx, cy = src.width / 2, src.height / 2
    scale = s0 * s_r * k
    # p -> neutral: C + s_r (p - C) + d -> frame: s0 * that + o -> around the centre times k
    fx = s0 * (cx - s_r * cx + dx) + ox
    fy = s0 * (cy - s_r * cy + dy) + oy
    mx, my = CENTRE[0] * SUPER, CENTRE[1] * SUPER
    fx, fy = mx + k * (fx - mx), my + k * (fy - my)
    w, h = round(src.width * scale), round(src.height * scale)
    q = src.convert("RGBa").resize((w, h), Image.LANCZOS)
    # the resize maps p to p * w / width, which is the scale up to rounding
    return q, fx, fy


def place(canvas: Image.Image, name: str, k: float = 1.0, *, dx=0.0, dy=0.0, sx=1.0, sy=1.0, rot=0.0,
          pivot=None):
    """Draws pose `name` onto the 4x canvas: scaled by sx, sy and turned by rot degrees around `pivot`
    (frame pixels at 1x, default: the bottom centre of the neutral pose), then shifted by dx, dy."""
    q, bx, by = prepared(name, k)
    px, py = pivot if pivot is not None else (CENTRE[0], CENTRE[1] + FIGURE_H / 2)
    px, py = px * SUPER, py * SUPER
    t = math.radians(rot)
    cos, sin = math.cos(t), math.sin(t)
    # forward: x = P + R S (q + b - P) + d ; inverse for Image.transform
    a, b, c, d = cos * sx, -sin * sy, sin * sx, cos * sy
    det = a * d - b * c
    ia, ib, ic, id_ = d / det, -b / det, -c / det, a / det
    ex, ey = px + dx * SUPER, py + dy * SUPER
    inv = (ia, ib, -ia * ex - ib * ey + px - bx, ic, id_, -ic * ex - id_ * ey + py - by)
    layer = q.transform(canvas.size, Image.AFFINE, inv, resample=Image.BICUBIC).convert("RGBA")
    canvas.alpha_composite(layer)


# ------------------------------------------------------------------ drawing --

def ease(i: int, n: int = FRAMES) -> float:
    """0 at the first frame, 1 at the last, at rest at both ends: smooth under ping-pong."""
    return (1 - math.cos(math.pi * i / (n - 1))) / 2


def canvas(size: int = SIZE) -> Image.Image:
    return Image.new("RGBA", (size * SUPER, size * SUPER), PAGE + (255,))


def shadow(img: Image.Image, lift: float = 0.0, k: float = 1.0):
    """A soft shadow on the ground under the figure; it shrinks and pales as the figure rises."""
    x0, _, x1, y1 = bbox(pose("neutral"))
    s0, ox, oy = base_transform()
    w = (x1 - x0) * s0 * 0.36 * k * (1 - 0.15 * lift)
    h = 3.4 * SUPER * k * (1 - 0.15 * lift)
    cx = CENTRE[0] * SUPER
    cy = (CENTRE[1] + k * FIGURE_H / 2) * SUPER + 1.5 * SUPER
    m = Image.new("L", img.size, 0)
    ImageDraw.Draw(m).ellipse((cx - w, cy - h, cx + w, cy + h), fill=round(255 * 0.2 * (1 - 0.45 * lift)))
    m = m.filter(ImageFilter.GaussianBlur(2.2 * SUPER))
    dark = Image.new("RGBA", img.size, (40, 52, 80, 255))
    img.paste(Image.composite(dark, img, m), (0, 0))


def twinkle(img: Image.Image, x: float, y: float, r: float, color, glow: float = 0.5):
    """A four-pointed twinkle at (x, y) frame pixels with outer radius r and a soft glow."""
    if r <= 0.15:
        return
    X, Y, R = x * SUPER, y * SUPER, r * SUPER
    if glow > 0:
        g = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(g).ellipse((X - R * 0.9, Y - R * 0.9, X + R * 0.9, Y + R * 0.9), fill=color + (round(255 * glow),))
        img.alpha_composite(g.filter(ImageFilter.GaussianBlur(R * 0.45)))
    pts = []
    for j in range(8):
        a = math.pi / 4 * j - math.pi / 2
        rr = R if j % 2 == 0 else R * 0.3
        pts.append((X + math.cos(a) * rr, Y + math.sin(a) * rr))
    d = ImageDraw.Draw(img)
    d.polygon(pts, fill=color + (255,))
    c = R * 0.22
    d.ellipse((X - c, Y - c, X + c, Y + c), fill=SPARK_CORE + (255,))


def vignette(img: Image.Image) -> Image.Image:
    """Fades the frame's edges into the page colour (the placeholder's vignette, unchanged)."""
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    m = int(w * 0.06)
    ImageDraw.Draw(mask).rounded_rectangle((m, m, w - m, h - m), radius=int(w * 0.22), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(w * 0.05))
    page = Image.new("RGB", (w, h), PAGE)
    return Image.composite(img.convert("RGB"), page, mask)


def finish(img: Image.Image, size: int = SIZE) -> Image.Image:
    """Vignette, reduce, dither to RGB565; the plain page stays exactly the page colour (see the pitfalls)."""
    small = vignette(img).resize((size, size), Image.LANCZOS)
    rgb = np.asarray(small, dtype=np.int16)
    page = (np.abs(rgb - np.array(PAGE, dtype=np.int16)) <= 1).all(axis=2)
    out = np.asarray(dither_rgb565(small)).copy()
    out[page] = PAGE
    return Image.fromarray(out)


# ------------------------------------------------------------------ animations --

def frame_idle(i: int) -> Image.Image:
    e = ease(i)
    img = canvas()
    shadow(img, lift=e)
    place(img, "blink" if i == FRAMES - 1 else "neutral", dy=-2.2 * e, sx=1 - 0.012 * e, sy=1 + 0.024 * e)
    return finish(img)


def frame_wave(i: int) -> Image.Image:
    # Two and a half swings forward and back again; an odd count, because an even one is the
    # same at frames 7 and 8, and Pillow merges equal frames (15 frames instead of 16).
    sway = math.cos(5 * math.pi * i / (FRAMES - 1))
    bob = (1 - math.cos(10 * math.pi * i / (FRAMES - 1))) / 2  # a little dip on every swing
    img = canvas()
    shadow(img, lift=0.3 * bob, k=0.94)
    place(img, "wave", 0.94, dx=4 + 1.5 * sway, dy=-1.4 * bob, rot=6 * sway)
    return finish(img)


def frame_working(i: int) -> Image.Image:
    e = ease(i)
    phi = math.pi * 2 * e + math.pi * 0.15                   # once round the head and back
    x0, y0, x1, y1 = bbox(pose("neutral"))
    s0, _, _ = base_transform()
    rx = (x1 - x0) * s0 / SUPER * 0.56
    ry = rx * 0.26
    head_y = CENTRE[1] - FIGURE_H * 0.37 - 1.8 * e
    sx_, sy_ = CENTRE[0] + rx * math.cos(phi), head_y + ry * math.sin(phi)
    front = math.sin(phi) > 0
    size = 5.8 + 1.0 * math.sin(phi * 3) + (0.6 if front else -0.8)
    img = canvas()
    shadow(img, lift=e)
    if not front:
        twinkle(img, sx_, sy_, size, SPARK, glow=0.35)
    place(img, "working", dy=-1.8 * e, rot=-1.5 + 3 * e)
    if front:
        twinkle(img, sx_, sy_, size, SPARK, glow=0.55)
    return finish(img)


# Sparkles around the figure: frame x, y, largest radius, phase, colour index.
SPARKLE_SPOTS = [(29, 48, 8.5, 0.0, 0), (132, 56, 8.0, 0.37, 1), (135, 104, 6.2, 0.71, 2), (25, 102, 6.4, 0.21, 3),
                 (112, 26, 5.6, 0.55, 4), (50, 25, 5.0, 0.86, 1)]


def frame_making(i: int) -> Image.Image:
    rock = math.cos(2 * math.pi * i / (FRAMES - 1))          # one rock forward, one back
    e = ease(i)
    img = canvas()
    shadow(img, lift=0.5 * e)
    place(img, "neutral", dy=-1.2 * e, rot=3.5 * rock)
    for x, y, r, p, c in SPARKLE_SPOTS:
        tw = math.sin(math.pi * (e * 2 + p * 2))
        twinkle(img, x, y, r * tw * tw, SPARKLES[c], glow=0.5)
    return finish(img)


def confetti_pieces(n: int = 46):
    """Fixed confetti: where each piece is at the last frame, how fast it fell, how it turns."""
    rnd = random.Random(1007)
    pieces = []
    for k in range(n):
        speed = rnd.uniform(4.6, 8.4)                      # frame pixels per frame
        x, end_y = rnd.uniform(8, 152), rnd.uniform(6, 150)
        # The last frame stays on the screen: a piece that ends over the face goes behind the figure.
        over_face = ((x - CENTRE[0]) / 44) ** 2 + ((end_y - CENTRE[1] - 4) / 50) ** 2 < 1
        pieces.append(dict(x=x, y=end_y - speed * (CONFETTI_FRAMES - 1), v=speed,
                           sway=rnd.uniform(1.0, 3.2), ph=rnd.uniform(0, 2 * math.pi), spin=rnd.uniform(0.5, 1.1),
                           rot=rnd.uniform(0, 180), color=CONFETTI[k % len(CONFETTI)],
                           front=k % 3 != 0 and not over_face))
    return pieces


PIECES = confetti_pieces()


def draw_confetti(img: Image.Image, i: int, front: bool):
    d = ImageDraw.Draw(img)
    for p in PIECES:
        if p["front"] != front:
            continue
        y = p["y"] + p["v"] * i
        if y < -6 or y > SIZE + 6:
            continue
        x = p["x"] + p["sway"] * math.sin(p["ph"] + i * 0.55)
        flip = abs(math.cos(p["ph"] + i * p["spin"]))       # the piece turns over as it falls
        w, h = 1.6 * SUPER, (0.8 + 2.4 * flip) * SUPER
        a = math.radians(p["rot"] + i * 23 * p["spin"])
        cos, sin = math.cos(a), math.sin(a)
        X, Y = x * SUPER, y * SUPER
        pts = [(X + cos * u - sin * v, Y + sin * u + cos * v) for u, v in ((-w, -h), (w, -h), (w, h), (-w, h))]
        d.polygon(pts, fill=p["color"] + (255,))


def frame_confetti(i: int) -> Image.Image:
    hop = abs(math.sin(math.pi * i / 6)) if i <= 12 else 0.0  # two hops, then it stands
    land = 1.0 if i in (6, 12) else 0.0
    k = 0.86
    img = canvas()
    shadow(img, lift=hop, k=k)
    draw_confetti(img, i, front=False)
    place(img, "celebrate", k, dy=2.5 - 7.0 * hop, sx=1 + 0.035 * land, sy=1 - 0.045 * land,
          pivot=(CENTRE[0], CENTRE[1] + k * FIGURE_H / 2))
    draw_confetti(img, i, front=True)
    return finish(img)


def avatar() -> Image.Image:
    """The neutral pose filling the 72 px square, a still."""
    img = Image.new("RGBA", (AVATAR * SUPER, AVATAR * SUPER), PAGE + (255,))
    big = Image.new("RGBA", (SIZE * SUPER, SIZE * SUPER), (0, 0, 0, 0))
    place(big, "neutral", 1.0)
    # the neutral pose stands FIGURE_H high around CENTRE; the avatar shows it 58 px high, centred
    k = 58 / FIGURE_H
    w = round(SIZE * SUPER * k)
    small = big.convert("RGBa").resize((w, w), Image.LANCZOS).convert("RGBA")
    cx, cy = CENTRE[0] * SUPER * k, CENTRE[1] * SUPER * k
    img.alpha_composite(small, (round(AVATAR * SUPER / 2 - cx), round(AVATAR * SUPER / 2 + 1 * SUPER - cy)))
    return finish(img, AVATAR)


ANIMATIONS = {"idle": (frame_idle, FRAMES, 0), "wave": (frame_wave, FRAMES, 0), "working": (frame_working, FRAMES, 0),
              "making": (frame_making, FRAMES, 0), "confetti": (frame_confetti, CONFETTI_FRAMES, 1)}


def sheet(images: dict[str, list[Image.Image]], path: Path, scale: int = 2):
    """Every frame of every animation in a row each, for a look at the motion."""
    cols = max(len(v) for v in images.values())
    out = Image.new("RGB", (cols * SIZE * scale, len(images) * SIZE * scale), (255, 255, 255))
    for r, frames in enumerate(images.values()):
        for c, f in enumerate(frames):
            out.paste(f.resize((f.width * scale, f.height * scale), Image.NEAREST), (c * SIZE * scale, r * SIZE * scale))
    out.save(path)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dry-run", action="store_true", help="list what would be written, write nothing")
    ap.add_argument("--only", choices=list(ANIMATIONS) + ["avatar"], action="append", help="only this file (repeatable)")
    ap.add_argument("--sheet", type=Path, help="also write every frame side by side to this PNG")
    args = ap.parse_args()
    names = args.only or list(ANIMATIONS) + ["avatar"]
    for p in POSES:
        if not (SRC / f"{p}.png").exists():
            print(f"tools/figure_source/{p}.png is missing: run tools/make_figure_source.py", file=sys.stderr)
            return 2
    total, drawn = 0, {}
    for name in names:
        if name == "avatar":
            print(f"  avatar.png: {AVATAR} x {AVATAR}, a still")
            total += AVATAR * AVATAR * 2
            if not args.dry_run:
                im = avatar()
                im.save(OUT / "avatar.png", optimize=True)
                drawn["avatar"] = [im]
            continue
        fn, n, loop = ANIMATIONS[name]
        total += n * SIZE * SIZE * 2
        print(f"  {name}.png: {n} frames of {SIZE} x {SIZE}" + (", played once" if loop else ", ping-pong"))
        if args.dry_run:
            continue
        frames = [fn(i) for i in range(n)]
        same = [i for i in range(1, n) if frames[i].tobytes() == frames[i - 1].tobytes()]
        if same:  # Pillow would merge them and the file would hold fewer frames than the box expects
            print(f"{name}: frame {same[0]} equals the one before it; change the motion", file=sys.stderr)
            return 1
        OUT.mkdir(parents=True, exist_ok=True)
        frames[0].save(OUT / f"{name}.png", save_all=True, append_images=frames[1:], duration=round(1000 / FPS),
                       loop=loop)
        drawn[name] = frames
    if not args.dry_run:
        for p in POSES:
            s, dx, dy = register(p)
            print(f"  registered {p} on neutral: scale {s:.3f}, shift {dx:+.1f} {dy:+.1f} px")
    print(f"flash for these files as RGB565: {total:,} bytes")
    if args.sheet and drawn:
        sheet(drawn, args.sheet)
        print(f"  sheet: {args.sheet}")
    if args.dry_run:
        print("(dry run, nothing written)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
