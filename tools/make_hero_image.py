#!/usr/bin/env python3
"""Makes a hero picture for the README with an image model, the prompt kept beside it.

What: asks OpenAI's or Google's image API for one picture of the box in a room and writes
it to docs/hero/<name>.<provider>.jpg (PNG without Pillow) with a <name>.<provider>.txt that records the
provider, the model, the date, the size and the full prompt. The picture that ends up in
the README is chosen by a person and committed together with its .txt as the record.

Why a script and not a chat window: a picture made in a browser cannot be repeated,
checked or attributed. Here the prompt is in the code, the key in the environment, and
every picture carries its order in a text file next to it.

Pitfalls:
  * Keys come from the environment only (OPENAI_API_KEY, GEMINI_API_KEY), never from a
    file in this repository and never on the command line.
  * Every run gives a different picture. Keep the one you chose; do not regenerate it
    on a whim, or the README changes with every build.
  * Image models write text badly. The prompt forbids text and logos; the card on the
    screen shows an icon only.
  * No third-party character is asked for. The figure on the screen is this project's
    own placeholder: a round blue character with big eyes.

Usage:
  python3 tools/make_hero_image.py --dry-run
  python3 tools/make_hero_image.py --provider openai
  python3 tools/make_hero_image.py --provider gemini --model gemini-nano-banana-2.1
  python3 tools/make_hero_image.py --provider openai --name hero-night --prompt-file my.txt
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "docs" / "hero"

DEFAULT_MODEL = {"openai": "gpt-image-2.5-flare", "gemini": "gemini-nano-banana-2.1"}

PROMPT = (
    "A photorealistic product photograph of a small matte black smart display, the size of a "
    "coffee cup, with a 2.4 inch colour touch screen in a rounded housing, standing on a small "
    "dock on a light oak desk in a cosy living room at dusk. The screen shows a friendly round "
    "blue cartoon character with big dark eyes and a smile on a light grey background, and a "
    "small white rounded card with a yellow sun icon beside it. Slightly out of focus behind "
    "the display: a smartphone lying on the desk and the corner of an open laptop. Warm lamp "
    "light from the left, soft shadows, shallow depth of field, 3:2 landscape. No text, no "
    "letters, no numbers, no logos anywhere in the picture."
)


def openai_image(prompt: str, model: str, key: str) -> bytes:
    body = {"model": model, "prompt": prompt, "n": 1, "size": "1536x1024", "quality": "high"}
    req = urllib.request.Request(
        "https://api.openai.com/v1/images/generations",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        answer = json.load(r)
    item = answer["data"][0]
    if "b64_json" in item:
        return base64.b64decode(item["b64_json"])
    with urllib.request.urlopen(item["url"], timeout=120) as r:
        return r.read()


def gemini_image(prompt: str, model: str, key: str) -> bytes:
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "3:2"}},
    }
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        data=json.dumps(body).encode(),
        headers={"x-goog-api-key": key, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        answer = json.load(r)
    for part in answer["candidates"][0]["content"]["parts"]:
        data = part.get("inlineData") or part.get("inline_data")
        if data:
            return base64.b64decode(data["data"])
    raise RuntimeError("the answer holds no picture: " + json.dumps(answer)[:300])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--provider", choices=["openai", "gemini"], default="openai")
    ap.add_argument("--model", help=f"default per provider: {DEFAULT_MODEL}")
    ap.add_argument("--name", default="hero", help="file name without extension")
    ap.add_argument("--prompt-file", type=Path, help="a text file with the prompt instead of the built-in one")
    ap.add_argument("--dry-run", action="store_true", help="show what would be asked, ask nothing")
    args = ap.parse_args()

    model = args.model or DEFAULT_MODEL[args.provider]
    prompt = args.prompt_file.read_text().strip() if args.prompt_file else PROMPT
    target = OUT / f"{args.name}.{args.provider}.png"
    record = target.with_suffix(".txt")
    print(f"{args.provider} {model} -> {target.relative_to(HERE.parent)}")
    print(prompt)
    if args.dry_run:
        return 0
    var = "OPENAI_API_KEY" if args.provider == "openai" else "GEMINI_API_KEY"
    key = os.environ.get(var, "")
    if not key:
        print(f"{var} is not set in the environment", file=sys.stderr)
        return 2
    try:
        png = openai_image(prompt, model, key) if args.provider == "openai" else gemini_image(prompt, model, key)
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read()[:400].decode(errors='replace')}", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    try:  # the README links a JPEG of about 300 KB, not the model's 1.7 MB PNG
        import io
        from PIL import Image
        target = target.with_suffix(".jpg")
        Image.open(io.BytesIO(png)).convert("RGB").save(target, quality=88, optimize=True, progressive=True)
    except ImportError:
        target.write_bytes(png)
    record.write_text(
        f"provider: {args.provider}\nmodel: {model}\ndate: {dt.date.today().isoformat()}\n"
        f"size: {len(png)} bytes\nprompt:\n{prompt}\n",
        encoding="utf-8",
    )
    print(f"wrote {target} ({target.stat().st_size // 1024} KB) and {record.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
