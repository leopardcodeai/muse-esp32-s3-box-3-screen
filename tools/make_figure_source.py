#!/usr/bin/env python3
"""Generates the source pictures of the project's figure with an image model, the prompt kept beside each.

What: asks OpenAI's image API (/v1/images/edits) for the project's own character and five
  poses of it, each a 1024 x 1024 PNG with a transparent background, and writes them to
  tools/figure_source/<pose>.png with a <pose>.txt that records the provider, the model,
  the date, the size, the reference picture and the full prompt:
    base       the character itself, made from the README's hero picture
               (docs/hero/hero.jpg, cropped to the figure on the screen) as reference
    neutral    eyes open, hands at its sides          (reference: base.png)
    blink      eyes closed, smiling                   (reference: base.png)
    wave       one small hand raised, waving          (reference: base.png)
    working    thinking, looking up a little          (reference: base.png)
    celebrate  both hands up, a small party hat       (reference: base.png)
  tools/make_figure.py builds the box's animation frames from these pictures.
Why: the figure the repository used to ship was a flat circle with a face drawn in code.
  The hero picture shows what the figure should look like; an image model can draw that
  character in a few poses, and the poses become the animations. The committed PNGs are
  the source of truth: this script does not run on every build, only when a pose is
  made again on purpose (every run gives a different picture).
Pitfalls:
  * The key comes from the environment only (OPENAI_API_KEY; in a login shell the
    keychain exports it). It goes into the Authorization header and nowhere else: never
    on the command line, never into a file or a log.
  * Every pose is an edit of base.png, not a fresh picture, so the character stays the
    same. Even so the model moves and scales it a little between calls; make_figure.py
    registers every pose on the body before it animates anything. Look at every result
    and run a pose again (--pose NAME --force) when it does not match the base.
  * The poses ask for no confetti, no spark and no shadow: make_figure.py draws those in
    code, so they move.
  * `input_fidelity: high` keeps the reference's details, but gpt-image-2.5-flare refused
    the field on 8 October 2026 (HTTP 400). The script then asks again without it for the
    rest of the run; --no-fidelity skips the first try. The .txt lists the parameters sent.
  * The wave pose took two tries: the first raised the hand only to the cheek and drew
    motion lines beside it, hence "high, above the height of its eyes" and "no motion
    lines" in its prompt now.
  * Nothing from Meta's Muse app is used or asked for: the reference is this project's
    own hero picture, which an image model made from a text prompt (docs/hero/).
Usage (Pillow comes in through uv; the key from a login shell):
  /bin/zsh -lc 'uv run --python 3.14 --with pillow tools/make_figure_source.py --dry-run'
  /bin/zsh -lc 'uv run --python 3.14 --with pillow tools/make_figure_source.py'                  # what is missing
  /bin/zsh -lc 'uv run --python 3.14 --with pillow tools/make_figure_source.py --pose wave --force'
  /bin/zsh -lc 'uv run --python 3.14 --with pillow tools/make_figure_source.py --pose wave --out /tmp/try'
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = HERE / "figure_source"
HERO = ROOT / "docs" / "hero" / "hero.jpg"
HERO_CROP = (516, 400, 660, 590)  # the figure on the screen of hero.jpg (1536 x 1024), left, top, right, bottom
MODEL = "gpt-image-2.5-flare"
SIZE = "1024x1024"
ENDPOINT = "https://api.openai.com/v1/images/edits"

LOOK = (
    "a glossy, soft 3D, round blue cartoon creature: head and body are one smooth ball in the "
    "same blue as the reference, big dark eyes with white highlights, a small smile, a little "
    "tuft on top, faintly rosy cheeks, two tiny rounded stubby hands at its sides, no legs, no "
    "outline, soft studio light from the upper left with gentle glossy highlights"
)
KEEP = (
    "Keep the character exactly as in the reference picture: the same shape, the same blue, the "
    "same eyes, the same tuft, the same tiny hands, the same size and the same place in the "
    "picture. Front view, centred, the whole body visible with a margin all around. Transparent "
    "background, no shadow on the ground, no other objects, no text, no letters, no logos."
)
PROMPTS = {
    "base": (
        "The friendly character on the little screen in this picture, alone, as a clean character "
        f"render: {LOOK}. Front view, facing the viewer, centred, the whole body visible with a "
        "margin all around, about two thirds of the picture high. Transparent background, no "
        "screen, no frame, no shadow on the ground, no other objects, no text, no letters, no logos."
    ),
    "neutral": (
        "The same character, in its calm neutral pose: eyes open and looking at the viewer, a small "
        f"friendly smile, both tiny hands resting at its sides. {KEEP}"
    ),
    "blink": (
        "The same character, blinking: both eyes closed as soft happy curved lines, smiling, both "
        f"tiny hands resting at its sides. Nothing else changes. {KEEP}"
    ),
    "wave": (
        "The same character, waving hello: one tiny hand raised high, above the height of its eyes "
        "and away from its body, open and waving, the other hand resting at its side, eyes open, a "
        f"happy smile. No motion lines, no marks around the hand. {KEEP}"
    ),
    "working": (
        "The same character, thinking hard about something: looking up a little to one side, one "
        "tiny hand touching its cheek, a small curious smile. No spark, no light bulb, no symbols "
        f"(those are added later). {KEEP}"
    ),
    "celebrate": (
        "The same character, celebrating: both tiny hands raised high up in joy, eyes happy, mouth "
        "open in a big smile, a small striped party hat sitting on its head beside the tuft. No "
        f"confetti, no streamers (those are added later). {KEEP}"
    ),
}
ORDER = list(PROMPTS)


def hero_reference() -> bytes:
    """docs/hero/hero.jpg cut to the figure on the screen, squared on its own grey, 1024 x 1024."""
    from PIL import Image
    im = Image.open(HERO).convert("RGB").crop(HERO_CROP)
    side = max(im.size)
    grey = im.getpixel((im.width - 4, 4))
    square = Image.new("RGB", (side, side), grey)
    square.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    buf = io.BytesIO()
    square.resize((1024, 1024), Image.LANCZOS).save(buf, "PNG")
    return buf.getvalue()


def multipart(fields: dict, files: list) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    out = io.BytesIO()
    for name, value in fields.items():
        out.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())
    for name, filename, data in files:
        out.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\n"
                  "Content-Type: image/png\r\n\r\n".encode())
        out.write(data)
        out.write(b"\r\n")
    out.write(f"--{boundary}--\r\n".encode())
    return out.getvalue(), f"multipart/form-data; boundary={boundary}"


def edit(key: str, model: str, prompt: str, reference: bytes, fidelity: bool) -> tuple[bytes, dict]:
    fields = {"model": model, "prompt": prompt, "n": "1", "size": SIZE, "quality": "high",
              "background": "transparent", "output_format": "png"}
    if fidelity:
        fields["input_fidelity"] = "high"
    body, ctype = multipart(fields, [("image", "reference.png", reference)])
    req = urllib.request.Request(ENDPOINT, data=body, method="POST",
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": ctype})
    with urllib.request.urlopen(req, timeout=600) as r:
        answer = json.load(r)
    item = answer["data"][0]
    if "b64_json" in item:
        png = base64.b64decode(item["b64_json"])
    else:
        with urllib.request.urlopen(item["url"], timeout=120) as r:
            png = r.read()
    used = {k: v for k, v in fields.items() if k not in ("prompt",)}
    return png, used


FIDELITY = {"ask": True}  # set to False once the model refused input_fidelity, for the rest of the run


def generate(pose: str, key: str, model: str, out: Path) -> Path:
    if pose == "base":
        reference, ref_name = hero_reference(), f"docs/hero/hero.jpg cropped to {HERO_CROP}, squared, 1024 x 1024"
    else:
        base = OUT / "base.png"
        if not base.exists():
            raise SystemExit(f"{base.relative_to(ROOT)} is missing: make the base first (--pose base)")
        reference, ref_name = base.read_bytes(), "tools/figure_source/base.png"
    prompt = PROMPTS[pose]
    started = time.time()
    try:
        try:
            png, used = edit(key, model, prompt, reference, fidelity=FIDELITY["ask"])
        except urllib.error.HTTPError as e:
            text = e.read()[:600].decode(errors="replace")
            if e.code != 400 or "input_fidelity" not in text or not FIDELITY["ask"]:
                raise SystemExit(f"{pose}: HTTP {e.code}: {text}")
            print("  the model does not take input_fidelity; asking again without it")
            FIDELITY["ask"] = False
            png, used = edit(key, model, prompt, reference, fidelity=False)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{pose}: HTTP {e.code}: {e.read()[:600].decode(errors='replace')}")
    from PIL import Image
    im = Image.open(io.BytesIO(png))
    out.mkdir(parents=True, exist_ok=True)
    target = out / f"{pose}.png"
    target.write_bytes(png)
    params = ", ".join(f"{k}={v}" for k, v in used.items())
    target.with_suffix(".txt").write_text(
        f"provider: openai\nmodel: {model}\ndate: {dt.date.today().isoformat()}\n"
        f"endpoint: {ENDPOINT}\nparameters: {params}\nreference: {ref_name}\n"
        f"size: {im.width} x {im.height}, {im.mode}, {len(png)} bytes\nprompt:\n{prompt}\n",
        encoding="utf-8")
    print(f"  wrote {target} ({im.width} x {im.height} {im.mode}, {len(png) // 1024} KB, {time.time() - started:.0f} s)")
    return target


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--pose", action="append", choices=ORDER, help="the pose to make (repeatable; default: every missing one)")
    ap.add_argument("--force", action="store_true", help="make the pose again although its file exists")
    ap.add_argument("--out", type=Path, default=OUT, help="folder for the results (default tools/figure_source; the poses always take base.png from there)")
    ap.add_argument("--model", default=MODEL, help=f"default {MODEL}")
    ap.add_argument("--no-fidelity", action="store_true",
                    help="do not send input_fidelity (gpt-image-2.5-flare refused it on 8 October 2026)")
    ap.add_argument("--dry-run", action="store_true", help="show what would be asked, ask nothing")
    args = ap.parse_args()
    FIDELITY["ask"] = not args.no_fidelity
    poses = args.pose or ORDER
    todo = [p for p in poses if args.force or not (args.out / f"{p}.png").exists()]
    for p in poses:
        state = "make" if p in todo else "exists, kept (use --force)"
        print(f"{p}: {state}")
        if p in todo and args.dry_run:
            print(f"  {args.model} {SIZE} transparent, reference "
                  f"{'docs/hero/hero.jpg' if p == 'base' else 'tools/figure_source/base.png'}")
            print("  " + PROMPTS[p])
    if args.dry_run:
        print("(dry run, nothing asked)")
        return 0
    if not todo:
        return 0
    key = os.environ.get("OPENAI_API_KEY", "")
    if not key:
        print("OPENAI_API_KEY is not set in the environment (run through /bin/zsh -lc)", file=sys.stderr)
        return 2
    for p in todo:
        print(f"{p}: asking {args.model} ...")
        generate(p, key, args.model, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
