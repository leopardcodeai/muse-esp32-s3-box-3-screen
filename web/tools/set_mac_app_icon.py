#!/usr/bin/env python3
"""Gives the installed Muse Web Screen app on a Mac its own icon: a figure on black.

What: takes a picture of a figure (default: the project's placeholder, web/icons/icon-512.png),
removes the plain background around it, sets it on a black macOS icon shape, writes the PNG
to web/local/mac_app_icon.png and puts it on the installed app as its custom Finder and Dock
icon (NSWorkspace setIcon).

Why: Chrome gives an installed web app the icon of its manifest; on a Mac you may want your
own, for example your assistant's figure, without changing what the public app ships.

Pitfalls:
  * The background is the commonest opaque colour of the picture's border, removed only where
    it touches the border, so light parts inside the figure stay. It works for a figure on a plain
    background; a photo with a busy background needs cutting out elsewhere first.
  * A picture that cuts the figure off at its lower edge shows a straight edge; --fade 0.5
    lets the lower half run softly into the black.
  * Somebody else's artwork (an assistant's mascot) is for your own Mac only: the output goes
    to web/local/, which git and Vercel ignore. Never commit it.
  * Chrome rewrites its app shims now and then (an update, a reinstall); run this again when
    the Dock shows the manifest icon. The Dock shows the new icon after the app is quit and
    opened again.

Usage (macOS):
  uv run --python 3.14 --with pillow --with numpy --with pyobjc-framework-Cocoa web/tools/set_mac_app_icon.py --dry-run
  uv run --python 3.14 --with pillow --with numpy --with pyobjc-framework-Cocoa web/tools/set_mac_app_icon.py
  uv run --python 3.14 --with pillow --with numpy --with pyobjc-framework-Cocoa web/tools/set_mac_app_icon.py --image my_figure.png --fade 0.5
"""
import argparse
from collections import deque
from pathlib import Path

HERE = Path(__file__).resolve().parent
WEB = HERE.parent
DEFAULT_IMAGE = WEB / "icons" / "icon-512.png"
OUT = WEB / "local" / "mac_app_icon.png"
DEFAULT_APP = Path.home() / "Applications" / "Chrome Apps.localized" / "Muse Web Screen.app"
SIZE, BODY, RADIUS = 1024, 824, 185     # the macOS icon grid: shape 824 of 1024, radius 185


def cut_out(img, tolerance=14):
    """The figure with the background colour that touches the border made transparent."""
    import numpy as np
    from PIL import Image, ImageFilter
    rgba = img.convert("RGBA")
    a = np.asarray(rgba).astype(int)
    h, w, _ = a.shape
    # The background is the commonest opaque colour along the border; transparent corners
    # (an icon with round corners) count as removable too and lead the fill inwards.
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    opaque = border[border[:, 3] > 200][:, :3]
    background = np.median(opaque, axis=0) if len(opaque) else a[2, 2, :3]
    removable = (np.abs(a[:, :, :3] - background).max(axis=2) < tolerance) | (a[:, :, 3] < 8)
    seen = np.zeros((h, w), bool)
    queue = deque([(y, x) for y in (0, h - 1) for x in range(w)] + [(y, x) for x in (0, w - 1) for y in range(h)])
    while queue:
        y, x = queue.popleft()
        if seen[y, x] or not removable[y, x]:
            continue
        seen[y, x] = True
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx]:
                queue.append((ny, nx))
    keep = np.where(seen, 0, 255).astype("uint8")
    alpha = np.minimum(np.asarray(Image.fromarray(keep).filter(ImageFilter.GaussianBlur(1.6))), a[:, :, 3])
    rgba.putalpha(Image.fromarray(alpha.astype("uint8")))
    return rgba


def build(image: Path, fade: float):
    import numpy as np
    from PIL import Image, ImageDraw
    shape = Image.new("L", (SIZE, SIZE), 0)
    off = (SIZE - BODY) // 2
    ImageDraw.Draw(shape).rounded_rectangle((off, off, off + BODY, off + BODY), RADIUS, fill=255)
    icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    icon.paste(Image.new("RGBA", (SIZE, SIZE), (8, 8, 10, 255)), (0, 0), shape)
    figure = cut_out(Image.open(image))
    figure = figure.crop(figure.getbbox())
    scale = (660 if fade else 600) / max(figure.size)
    figure = figure.resize((round(figure.width * scale), round(figure.height * scale)), Image.LANCZOS)
    if fade:
        a = np.asarray(figure.getchannel("A")).astype(float)
        h = a.shape[0]
        start = int(h * (1 - fade))
        ramp = np.ones(h)
        s = np.linspace(0.0, 1.0, h - start)
        ramp[start:] = 1.0 - (3 * s ** 2 - 2 * s ** 3)   # smoothstep, no visible edge
        figure.putalpha(Image.fromarray((a * ramp[:, None]).astype("uint8")))
        x, y = (SIZE - figure.width) // 2, off + BODY - figure.height + 20
    else:
        x, y = (SIZE - figure.width) // 2, (SIZE - figure.height) // 2
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    layer.paste(figure, (x, y), figure)
    clipped = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    clipped.paste(layer, (0, 0), Image.composite(layer.getchannel("A"), Image.new("L", (SIZE, SIZE), 0), shape))
    return Image.alpha_composite(icon, clipped)


def set_icon(png: Path, app: Path) -> bool:
    from AppKit import NSImage, NSWorkspace
    image = NSImage.alloc().initWithContentsOfFile_(str(png))
    return bool(NSWorkspace.sharedWorkspace().setIcon_forFile_options_(image, str(app), 0))


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--image", type=Path, default=DEFAULT_IMAGE, help="a figure on a plain background")
    ap.add_argument("--app", type=Path, default=DEFAULT_APP, help="the installed app bundle")
    ap.add_argument("--fade", type=float, default=0.0, help="share of the figure that fades into the black at the bottom (0 to 0.8)")
    ap.add_argument("--dry-run", action="store_true", help="say what would happen, write nothing")
    a = ap.parse_args()
    if not a.image.exists():
        raise SystemExit(f"{a.image} not found")
    if not a.app.exists():
        raise SystemExit(f"{a.app} not found: install the app from Chrome first (docs/MAC_APP.md)")
    if a.dry_run:
        print(f"would cut {a.image} out, write {OUT} and set it on {a.app}")
        return
    OUT.parent.mkdir(exist_ok=True)
    build(a.image, max(0.0, min(0.8, a.fade))).save(OUT)
    print(f"wrote {OUT}")
    print("icon set; quit the app and open it again" if set_icon(OUT, a.app) else "setting the icon failed")


if __name__ == "__main__":
    main()
