#!/usr/bin/env python3
"""Builds the Muse figure for the box from the installed Muse app (private use only).

What: cuts the Muse character animations that ship inside the Muse app
(/Applications/Muse.app/Contents/Resources/Hatch*.mp4) into short animated PNGs
sized for the box's 320x240 display, takes a still for the small avatar, and
writes a wake word manifest that shows "Muse" for the unchanged hey_jarvis model.
The frames go to firmware/figure/ as muse_<name>.png and the wake word files to
firmware/wakewords/; set `figure_prefix: "muse_"` in the substitutions to use them.

Why: the owner wants the box to show Muse instead of the StackChan face, in the
look of the Muse app. The videos are the app's own graphics, so nothing has to
be drawn or downloaded from elsewhere (except the open hey_jarvis model).

Pitfalls:
  * The animations are Meta's artwork, for private use on your own box only:
    firmware/figure/muse_*.png is in .gitignore and must never be committed or
    published (tools/check_private.py refuses a changed figure/). Run this script
    on a machine with the Muse app installed instead.
  * APNG, not GIF: GIF would cut the soft 3D renders to 256 colours. ESPHome reads
    every frame through Pillow and stores it as raw RGB565 in flash.
  * Flash budget: every frame costs SIZE*SIZE*2 bytes (160x160 = 50 KB). The
    script prints the total; keep it well below the free app partition.
  * The videos do not share one background colour, and most of them are
    close-ups whose body runs out of the frame. Every frame is therefore scaled
    to INNER pixels, centred on the SIZE canvas and faded into BACKGROUND with a
    rounded (squircle) vignette of FADE pixels. A square fade left a warm smudge
    where the fur ran into the edge (owner, 06.10.2026: "pink rechts als
    Schatten", "mehr rausgezoomt"). Only HatchMaking shows the whole figure.
  * The display stores RGB565. ESPHome cuts the low bits off, which bands the
    soft fur gradients and tints them. Every frame is therefore rounded to
    RGB565 with a fixed Bayer pattern first (dither_rgb565); a fixed pattern
    does not shimmer from frame to frame the way error diffusion would.
  * The box plays idle/working/wave/making forwards and backwards (ping-pong),
    so a short segment loops without a visible jump; confetti plays once.
  * The wake word stays "Hey Jarvis" when spoken (an open, tested model); only the
    name shown in Home Assistant changes to "Muse". A model of your own goes into
    firmware/wakewords/ the same way (docs/BOX3_SETUP.md).

Usage (Pillow and numpy come in through uv):
  uv run --python 3.14 --with pillow --with numpy make_muse_assets.py            # build what is missing
  uv run --python 3.14 --with pillow --with numpy make_muse_assets.py --force    # rebuild everything
  uv run --python 3.14 --with pillow --with numpy make_muse_assets.py --dry-run  # show the plan
"""
import argparse
import json
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "firmware" / "figure"   # written as muse_<name>.png, ignored by git
WAKE = HERE.parent / "firmware" / "wakewords"
SOURCE = Path("/Applications/Muse.app/Contents/Resources")
SIZE = 160          # canvas, square; the display is 320x240
INNER = 140         # the video inside the canvas (zoomed out, 06.10.2026)
AVATAR = 72         # pixels for the small avatar on text and value pages
BACKGROUND = "0xF3F3F3"  # must match MUSE_BG in muse-esp32boxs3-screen.yaml
FADE = 16           # pixels of the vignette that fades into the background

# name: (video, start second, length in seconds, frames per second)
ANIMATIONS = {
    "idle": ("HatchIdle.mp4", 0.0, 2.67, 6),
    "working": ("HatchWorking.mp4", 0.0, 2.67, 6),
    "wave": ("HatchWave.mp4", 0.4, 2.67, 6),
    "making": ("HatchMaking.mp4", 1.5, 2.67, 6),
    "confetti": ("HatchMilestoneConfetti.mp4", 1.0, 3.0, 6),
}

MODEL_BASE = "https://raw.githubusercontent.com/esphome/micro-wake-word-models/main/models/v2/"


def run(cmd, dry):
    print("  $", " ".join(str(c) for c in cmd))
    if not dry:
        subprocess.run(cmd, check=True)


def frame_count(path: Path) -> int:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
         "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True).stdout.strip()
    return int(out or 0)


def dither_rgb565(image):
    """Ordered (Bayer 4x4) dither to the display's 5-6-5 bit colours.

    The values that come out survive ESPHome's bit cutting unchanged, so the
    display shows the rounded colours instead of truncated ones. Mirrors
    make_muse_icons.py.
    """
    import numpy as np
    from PIL import Image
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    h, w, _ = rgb.shape
    bayer = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], np.float32)
    t = np.tile((bayer + 0.5) / 16 - 0.5, (h // 4 + 1, w // 4 + 1))[:h, :w]
    out = np.empty(rgb.shape, np.uint8)
    for c, bits in ((0, 5), (1, 6), (2, 5)):
        top = (1 << bits) - 1
        q = np.clip(np.floor(rgb[..., c] / 255 * top + 0.5 + t), 0, top)
        out[..., c] = np.round(q * 255 / top).astype(np.uint8)
    return Image.fromarray(out)


def dither_file(path: Path, fps: int):
    """Dithers every frame of an (animated) PNG in place."""
    from PIL import Image
    with Image.open(path) as im:
        frames = []
        for i in range(getattr(im, "n_frames", 1)):
            im.seek(i)
            frames.append(dither_rgb565(im))
    if len(frames) == 1:
        frames[0].save(path)
    else:
        frames[0].save(path, save_all=True, append_images=frames[1:],
                       duration=round(1000 / fps), loop=0)


def build_animations(force, dry):
    total = 0
    margin = (SIZE - INNER) // 2
    # Squircle: |x|^4 + |y|^4, 1 at the middle of each edge, softer than a circle.
    dist = "pow(pow(abs(X-W/2+0.5)/(W/2),4)+pow(abs(Y-H/2+0.5)/(H/2),4),0.25)"
    vignette = f"255*clip((1-{dist})*(W/2)/{FADE},0,1)"
    for name, (video, start, length, fps) in ANIMATIONS.items():
        target = OUT / f"muse_{name}.png"
        if target.exists() and not force:
            print(f"{name}: vorhanden")
        else:
            print(f"{name}: aus {video}, ab {start} s, {length} s, {fps} fps")
            graph = (f"[1:v]setpts=PTS-STARTPTS,fps={fps},scale={INNER}:{INNER}:flags=lanczos,format=rgba,"
                     f"geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='{vignette}'[fg];"
                     f"[0:v][fg]overlay=x={margin}:y={margin}:shortest=1,format=rgb24")
            run(["ffmpeg", "-v", "error", "-y",
                 "-f", "lavfi", "-i", f"color=c={BACKGROUND}:s={SIZE}x{SIZE}:r={fps}",
                 "-ss", str(start), "-t", str(length), "-i", str(SOURCE / video),
                 "-filter_complex", graph,
                 "-f", "apng", "-plays", "0", str(target)], dry)
            if not dry:
                dither_file(target, fps)
        if target.exists():
            n = frame_count(target)
            total += n * SIZE * SIZE * 2
            print(f"    {n} Bilder")
    print(f"Animationen im Flash (RGB565): {total / 1e6:.2f} MB")


def build_avatar(force, dry):
    target = OUT / "muse_avatar.png"
    if target.exists() and not force:
        print("avatar: vorhanden")
        return
    print("avatar: Standbild aus HatchIdle.mp4, rund")
    r = AVATAR / 2
    circle = f"255*min(1,max(0,{r}-hypot(X-{r}+0.5,Y-{r}+0.5)))"
    graph = (f"[1:v]setpts=PTS-STARTPTS,crop=300:300:106:40,scale={AVATAR}:{AVATAR}:flags=lanczos,format=rgba,"
             f"geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='{circle}'[fg];"
             f"[0:v][fg]overlay=shortest=1,format=rgb24")
    run(["ffmpeg", "-v", "error", "-y",
         "-f", "lavfi", "-i", f"color=c={BACKGROUND}:s={AVATAR}x{AVATAR}",
         "-ss", "0.2", "-i", str(SOURCE / "HatchIdle.mp4"),
         "-filter_complex", graph, "-frames:v", "1", str(target)], dry)
    if not dry:
        dither_file(target, 1)


def build_wake_word(force, dry):
    manifest = WAKE / "muse_hey_jarvis.json"
    model = WAKE / "hey_jarvis.tflite"
    if manifest.exists() and model.exists() and not force:
        print("Weckwort: vorhanden")
        return
    print("Weckwort: hey_jarvis laden, Anzeigename 'Muse'")
    if dry:
        return
    with urllib.request.urlopen(MODEL_BASE + "hey_jarvis.json", timeout=30) as r:
        data = json.load(r)
    with urllib.request.urlopen(MODEL_BASE + data["model"], timeout=60) as r:
        model.write_bytes(r.read())
    data["wake_word"] = "Muse"
    data["model"] = model.name
    manifest.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--force", action="store_true", help="alles neu erzeugen")
    ap.add_argument("--dry-run", action="store_true", help="nur zeigen, nichts schreiben")
    args = ap.parse_args()

    if not SOURCE.is_dir():
        sys.exit(f"Muse-App nicht gefunden: {SOURCE}")
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            sys.exit(f"{tool} fehlt (brew install ffmpeg)")
    if not args.dry_run:
        OUT.mkdir(exist_ok=True)
        WAKE.mkdir(exist_ok=True)
    build_animations(args.force, args.dry_run)
    build_avatar(args.force, args.dry_run)
    build_wake_word(args.force, args.dry_run)


if __name__ == "__main__":
    main()
