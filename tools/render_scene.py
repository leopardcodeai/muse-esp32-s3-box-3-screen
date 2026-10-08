#!/usr/bin/env python3
"""Render a Muse scene (the scene language of ``muse_draw``) to PNG or GIF on the Mac.

What: a host-side renderer for the scene language of the ESP32-S3-BOX-3 firmware
(``muse_scene.h`` parses it, ``draw_scene`` in ``muse.h`` draws it ten times a second).
It parses a scene with the same rules, defaults, limits and messages as the box
("line N: ...") and draws the 320 x 240 picture at a time t, or an animated GIF over a
few seconds, so the README and the blog can show what the display draws without a photo.

Why: the box answers only with its parse errors; what the picture looks like was only
visible on the device. A preview on the Mac makes a scene reviewable before it is sent
and lets the scene files be documented with pictures.

Pitfalls:
  * Fonts: the box draws Inter (weights 500/600/700) and Material Design Icons 7.4.47. The
    TTFs are not in the repo: `esphome compile firmware/muse-esp32boxs3-screen.yaml` downloads them into
    firmware/.esphome/font/, where this tool looks first (override with MUSE_FONT_DIR and
    MUSE_ICON_FONT, or --font-dir and --icon-font).
  * The figure (``muse``, ``avatar``) is drawn from the frames the box embeds by default,
    firmware/figure/idle.png, wave.png, working.png, making.png and avatar.png (the
    project's own character, tools/make_figure.py), decoded with Pillow and stepped like
    the box: one frame per 160 ms, forwards and back. Meta's Muse frames
    (firmware/figure/muse_*.png, figure_prefix "muse_") are never read. Without the files
    a stand-in drawn in code takes their place (draw_coded_figure).
  * Shapes are drawn 3x oversampled and reduced, which gives them the soft edges of the
    box. Text and icons are drawn 1:1 with the same Pillow rasteriser the ESPHome font
    generator uses, so glyphs land where they land on the device.
  * Translucency follows the box, not an image editor: a translucent element is drawn in
    its colour mixed with what ``under()`` finds below it, and ``under()`` knows only the
    background, filled rectangles and circles and bars. So a half-transparent rectangle
    shows the background through but hides a star, a text or Muse drawn before it, Muse's
    figure ignores ``opacity`` and ``fade`` (it appears in full), and a button's label is
    always printed in full. The picture here does what the display does (see lay()).
  * Particles use the firmware's hash (``rnd``), so a frame here shows the particles of
    the same frame on the box, up to rounding.
  * ``{time}``, ``{date}`` and ``{weekday}`` are filled from --clock (default: now), so a
    preview with the clock in it changes between runs unless --clock is given.

Usage (from the project folder):
  uv run --python 3.14 --with pillow --with fonttools tools/render_scene.py scenes/night.txt --png out.png [--t 2000]
  uv run --python 3.14 --with pillow --with fonttools tools/render_scene.py scenes/night.txt --gif out.gif --seconds 4 --fps 10
  uv run --python 3.14 --with pillow --with fonttools tools/render_scene.py --all scenes docs/previews [--dry-run]
  uv run --python 3.14 --with pillow --with fonttools tools/render_scene.py scenes/night.txt --check
  Add --scale 2 for 640 x 480 (nearest neighbour), --clock "2026-10-07 21:30" for a fixed clock.
"""

from __future__ import annotations

import argparse
import datetime as dt
import logging
import math
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

W, H = 320, 240
SS = 3  # shapes are drawn SS times larger and reduced, which gives them soft edges
PAGE = (243, 243, 243)  # the page colour of the Muse screens
INK = (28, 28, 30)
MAX_SOURCE, MAX_ITEMS, MAX_FRAMES, MAX_TEXT, MAX_PARTICLES, MAX_ERRORS = 16384, 250, 24, 500, 150, 12
TEXT_PX = [13, 16, 20, 24, 36, 54]  # xs s m l xl xxl
TEXT_WEIGHT = [500, 500, 700, 600, 700, 700]  # the Inter weights behind them (stackchan-box3.yaml)
ICON_PX = [24, 46]  # s l

HERE = Path(__file__).resolve().parent
FIGURE_DIR = HERE.parent / "firmware" / "figure"  # the project's figure; never the muse_*.png beside it
STEP_MS = 160  # a step of the figure in a scene (muse.h: t / 160)
ESPHOME_FONTS = HERE.parent / "firmware" / ".esphome" / "font"  # where esphome compile caches the fonts
FONT_HINT = ("run `esphome compile firmware/muse-esp32boxs3-screen.yaml` once (it downloads Inter and the icon font into "
             "firmware/.esphome/font/), or point MUSE_FONT_DIR and MUSE_ICON_FONT (or --font-dir and "
             "--icon-font) at them")

NAMED_COLORS = {
    "white": (255, 255, 255), "black": (0, 0, 0), "ink": INK, "page": PAGE,
    "gray": (142, 142, 147), "grey": (142, 142, 147), "lightgray": (209, 209, 214),
    "lightgrey": (209, 209, 214), "darkgray": (72, 72, 74), "darkgrey": (72, 72, 74),
    "red": (255, 59, 48), "orange": (255, 149, 0), "yellow": (255, 204, 0), "gold": (255, 214, 10),
    "green": (52, 199, 89), "mint": (0, 199, 190), "teal": (48, 176, 199), "cyan": (50, 173, 230),
    "blue": (0, 122, 255), "navy": (16, 30, 72), "indigo": (88, 86, 214), "purple": (175, 82, 222),
    "pink": (255, 45, 85), "brown": (162, 132, 94),
}
COLOR_HINT = ("use #rrggbb or a name (white, black, gray, red, orange, yellow, green, mint, teal, cyan, "
              "blue, navy, indigo, purple, pink, brown, gold, page, ink)")

# What the two largest fonts on the box hold (stackchan-box3.yaml, m_head and m_value). The
# four smaller ones hold GF_Latin_Core, approximated here by the Latin blocks of Inter.
GLYPHS_XL = (" !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz"
             "{|}~äöüÄÖÜß€°„“”‘’–—…•·àáâéèêëíìîïóòôúùûçñÀÁÉÈÓÚÇÑ")
GLYPHS_XXL = "0123456789,.:-+%°/ abcdefghijklmnopqrstuvwxyzäöüßABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ€!?'&()"

# Material Design Icons 7.4.47 by name, from muse_icons.h: "name:xxxx" means U+Fxxxx.
ICON_TABLE = """
account:0004 account-group:0849 airplane:001D alarm:0020 alert:0026 alert-circle:0028
alien:089A arrow-down:0045 arrow-left:004D arrow-right:0054 arrow-up:005D auto-fix:0068
baby-face-outline:0E7D baguette:0F3E balloon:0A26 basketball:0806 battery:0079
battery-charging:0084 beach:0092 bed:02E3 bee:0FA1 beer:0098 bell:009A bell-ring:009E
bike:00A3 bird:15C6 book-open-variant:14F7 bread-slice:0CEE briefcase:00D6 brush:00E3
bullhorn:00E6 bus:00E7 butterfly:1589 cactus:0DB5 cake:00E9 cake-variant:00EB calendar:00ED
calendar-check:00EF calendar-clock:00F0 calendar-heart:09D2 camera:0100 candle:05E2 candy:1970
car:010B cards-playing:18A1 carrot:010F cart:0110 cash:0114 cat:011B cellphone:011C
chart-line:012A chat:0B79 check-circle:05E0 checkbox-blank-circle-outline:0130
checkbox-marked-circle:0133 chef-hat:0B7C chess-knight:0858 chevron-down:0140
chevron-left:0141 chevron-right:0142 chevron-up:0143 chip:061A clock-outline:0150
close-circle:0159 cloud:015F clover:0816 coffee:0176 cog:0493 compass:018B cookie:0198
cow:019A creation:0674 crown:01A5 cupcake:095A dice-5:01CE dog:0A43 door:081A door-open:081C
duck:01E5 dumbbell:01E6 earth:01E7 email:01EE email-open:01EF emoticon-angry-outline:0C6A
emoticon-cool-outline:01F3 emoticon-cry-outline:0C6D emoticon-excited-outline:069C
emoticon-happy-outline:01F5 emoticon-kiss-outline:0C73 emoticon-lol-outline:1215
emoticon-neutral-outline:01F6 emoticon-outline:01F2 emoticon-sad-outline:01F8
emoticon-sick-outline:157D emoticon-tongue-outline:0C77 emoticon-wink-outline:0C79 eye:0208
fan:0210 ferry:0213 fire:0238 fireplace:0E2E firework:0E30 fish:023A flag:023B flower:024A
flower-tulip:09F1 food:025A food-apple:025B format-list-checks:0756 fridge:0290
fruit-cherries:1042 fruit-watermelon:1047 gamepad-variant:0297 garage:06D9 garage-open:06DA
garage-open-variant:12D4 garage-variant:12D3 gesture-tap:0741 ghost:02A0 gift:0E44
glass-cocktail:0356 glass-flute:02A5 glass-wine:0876 guitar-acoustic:0771 hamburger:0685
hand-wave:1821 hands-pray:0579 headphones:02CB heart:02D1 heart-broken:02D4 heart-outline:02D5
heart-pulse:05F6 help-circle:02D7 hiking:0D7F home:02DC home-account:0826 home-heart:0827
horse:15BF human-greeting:17C4 human-male-female-child:1823 ice-cream:082A
image-filter-hdr:02F5 information:02FC information-outline:02FD jellyfish:0F01 key:0306
ladybug:082D lamp:06B5 laptop:0322 leaf:032A lightbulb:0335 lightbulb-on:06E8
lightbulb-on-outline:06E9 lightning-bolt:140B lock:033E lock-open:033F magic-staff:1844
magnify:0349 mailbox:06EE mailbox-up:0D8D map:034D map-marker:034E medal:0987 medical-bag:06EF
meditation:117B message-text:0369 microphone:036C minus:0374 moon-full:0F62
moon-waning-crescent:0F65 movie-open:0FCE mushroom:07DF music:075A music-note:0387
newspaper-variant:1001 noodles:117E owl:03D2 package-variant:03D6 palette:03D8 palm-tree:1055
party-popper:1056 paw:03E9 penguin:0EC0 phone:03F2 piano:067D piggy-bank:1007 pill:0402
pin:0403 pine-tree:0405 pizza:0409 plus:0415 power:0425 power-sleep:0904 puzzle:0431
rabbit:0907 radiator:0438 recycle:044C refresh:0450 robot:06A9 robot-happy:1719
robot-vacuum:070D rocket:0463 rocket-launch:14DE run:070E school:0474 send:048A shimmer:1545
shopping:049A shower:09A0 silverware-fork-knife:0A70 snail:1677 snowflake:0717 soccer:04B8
sofa:04B9 solar-power:0A72 speaker:04C3 spider:11EA sprout:0E66 star:04CE
star-four-points:0AE2 star-outline:04D2 star-shooting:1741 stove:04DE sun-thermometer:18D6
swim:04E3 target:04FE tea:0D9E television:0502 television-off:083B tennis:0DA0 tent:0508
thermometer:050F thumb-down:0511 thumb-up:0513 timer-outline:051B timer-sand:051F toilet:09AB
tools:1064 tooth:08C3 train:052C trash-can:0A79 tree:0531 trending-down:0533 trending-up:0535
trophy:0538 truck-delivery:053E turtle:0CD7 umbrella:054A unicorn:15C2 walk:0583
washing-machine:072A water:058C waves:078D weather-cloudy:0590 weather-fog:0591
weather-hail:0592 weather-lightning:0593 weather-lightning-rainy:067E weather-night:0594
weather-partly-cloudy:0595 weather-pouring:0596 weather-rainy:0597 weather-snowy:0598
weather-snowy-rainy:067F weather-sunny:0599 weather-sunset:059A weather-sunset-down:059B
weather-sunset-up:059C weather-windy:059D wifi:05A9 window-shutter:111C
window-shutter-open:111E yoga:117C
"""
# Other words for an icon (event names, German words), from muse_icons.h.
ICON_ALIAS_TABLE = """
achtung:0026 apfel:025B auto:010B ballon:0A26 baum:0531 bett:02E3 biene:0FA1 bier:0098
blatt:032A blitz:140B blume:024A briefkasten:0D8D buch:14F7 daumen-hoch:0513 done:05E0
doorbell:009E einhorn:15C2 einkaufen:0110 eis:082A erledigt:05E0 essen:0A70 eule:03D2
fahrrad:00A3 feuer:0238 feuerwerk:0E30 fisch:023A flugzeug:001D frage:02D7 froh:01F5
garage-zu:12D3 geist:02A0 geld:0114 geschenk:0E44 glocke:009A handy:011C happy:01F5 hase:0907
haus:02DC herz:02D1 hund:0A43 idea:06E9 idee:06E9 info:02FC kaffee:0176 kalender:00F0
kamera:0100 katze:011B klingel:009E kopfhoerer:02CB krone:01A5 kuchen:00EB lachen:1215
lampe:06B5 licht:06E8 light:06E8 love:02D1 mail:01EE mond:0F65 moon:0F65 muell:0A79 musik:075A
nachrichten:1001 news:1001 ok:05E0 party:1056 pfote:03E9 pille:0402 pokal:0538 rain:0597
rakete:0463 regen:0597 roboter:1719 rolladen-hoch:111E rolladen-runter:111C
rollladen-hoch:111E rollladen-runter:111C sad:01F8 schlafen:0904 schloss:033E schluessel:0306
schmetterling:1589 schnee:0717 sleep:0904 smile:01F5 snow:0717 solar:0A72 sonne:0599
sparkles:0674 sport:070E stern:04CE strand:0092 sun:0599 tee:0D9E telefon:03F2 timer:051B
trash:0A79 traurig:01F8 tuer:081C tv:0502 tv-an:0502 tv-aus:083B uhr:0150 vogel:15C6
wecker:0020 wein:0876 winken:1821 wolke:015F zahn:08C3 zug:052C zuhause:0826
"""


def _icon_table(text):
    return {name: 0xF0000 + int(cp, 16) for name, cp in (word.split(":") for word in text.split())}


ICON_NAMES = _icon_table(ICON_TABLE)
ICON_ALIASES = _icon_table(ICON_ALIAS_TABLE)
ICON_WORDS = list(ICON_NAMES) + list(ICON_ALIASES)  # the order closest() searches in

FIGURES = ["idle", "wave", "working", "making", "avatar"]
PARTICLE_KINDS = ["confetti", "snow", "rain", "sparkle", "bubbles"]
COMMON_KEYS = "opacity delay dur blink fade move period"  # keys every drawn element takes
# command: (kind, drawn element or a setting of the scene, positional values, keys besides the common ones)
COMMANDS = {
    "bg": ("bg", True, ["color", "to"], "color to dir"),
    "rect": ("rect", True, ["x", "y", "w", "h", "color"], "x y w h color r line"),
    "circle": ("circle", True, ["x", "y", "r", "color"], "x y r color line pulse"),
    "line": ("line", True, ["x", "y", "x2", "y2", "color"], "x y x2 y2 color w"),
    "tri": ("tri", True, ["x", "y", "x2", "y2", "x3", "y3", "color"], "x y x2 y2 x3 y3 color line"),
    "star": ("star", True, ["x", "y", "r", "color"], "x y r color points inner rot spin pulse line"),
    "poly": ("poly", True, ["x", "y", "r", "sides", "color"], "x y r sides color rot spin pulse line"),
    "text": ("text", True, ["x", "y", "text"], "x y text size color align valign w lines lh type"),
    "icon": ("icon", True, ["x", "y", "name", "color"], "x y name color size"),
    "muse": ("muse", True, ["x", "y", "anim"], "x y anim r"),
    "bar": ("bar", True, ["x", "y", "w", "h", "value", "color"], "x y w h value color bg r"),
    "particles": ("particles", True, ["kind", "count", "color"], "kind count color icon size x y w h speed"),
    "button": ("button", True, ["x", "y", "w", "h", "text", "color"], "x y w h text color size r"),
    "seconds": ("bg", False, ["n"], "n"),
    "frame": ("bg", False, ["ms"], "ms"),
    "once": ("bg", False, [], ""),
}
# English synonyms, and the German words Muse may slip into.
COMMAND_ALIASES = {
    "background": "bg", "rectangle": "rect", "box": "rect", "triangle": "tri", "polygon": "poly",
    "figure": "muse", "avatar": "muse", "progress": "bar", "particle": "particles", "duration": "seconds",
    "hintergrund": "bg", "rechteck": "rect", "kreis": "circle", "linie": "line", "dreieck": "tri",
    "stern": "star", "vieleck": "poly", "symbol": "icon", "figur": "muse", "balken": "bar",
    "partikel": "particles", "sekunden": "seconds", "dauer": "seconds", "einmal": "once",
    "taste": "button", "knopf": "button", "schaltflaeche": "button",
}
MS_KEYS = {"delay": "delay", "dur": "dur", "blink": "blink", "fade": "fade", "type": "type_ms",
           "spin": "spin", "pulse": "pulse"}


@dataclass
class Item:
    """One element of a scene, with the defaults of muse_scene.h (NaN: not given)."""
    kind: str
    line: int = 0
    frame: int = -1  # -1: every frame
    x: float = math.nan
    y: float = math.nan
    w: float = math.nan
    h: float = math.nan
    r: float = math.nan
    x2: float = math.nan
    y2: float = math.nan
    x3: float = math.nan
    y3: float = math.nan
    color: tuple = INK
    color2: tuple = PAGE  # bg: second colour of the gradient; bar: the track
    gradient: bool = False
    horizontal: bool = False
    has_color: bool = False
    has_color2: bool = False
    has_size: bool = False
    opacity: float = 1.0
    stroke: int = 0  # outline width in px; 0 fills
    radius: int = 0  # rect corners; -1 makes a pill
    points: int = 5  # star points, polygon sides
    inner: float = 0.45  # star: inner radius as a share of r
    rot: float = 0.0  # degrees, clockwise
    value: float = 0.0  # bar: 0 .. 100
    size: int = 1  # text: index into TEXT_PX; icon: index into ICON_PX
    align: int = 0  # 0 left, 1 centre, 2 right
    valign: int = 0  # 0 top, 1 middle, 2 bottom
    wrap: int = 0  # text: wrap width in px, 0 keeps one line
    max_lines: int = 0
    line_h: int = 0
    count: int = 40  # particles
    speed: float = 1.0
    sub: str = ""  # particles: PARTICLE_KINDS; muse: FIGURES
    glyph: int = 0  # icon, or particles drawn as an icon
    text: str = ""
    delay: int = 0
    dur: int = 0
    blink: int = 0
    fade: int = 0
    type_ms: int = 0
    move_x: float = 0.0
    move_y: float = 0.0
    period: int = 3000
    spin: int = 0
    pulse: int = 0


@dataclass
class Scene:
    items: list = field(default_factory=list)
    frames: list = field(default_factory=list)  # length of each frame in ms; empty: no frames
    once: bool = False
    seconds: int = 20
    errors: list = field(default_factory=list)
    skipped: int = 0  # elements left out because of an error

    def cycle(self):
        return sum(self.frames)

    def frame_at(self, t):
        """The frame shown t ms after the start; -1 when the scene has no frames."""
        if not self.frames:
            return -1
        c = self.cycle()
        if c == 0:
            return 0
        if self.once and t >= c:
            return len(self.frames) - 1
        t %= c
        for i, f in enumerate(self.frames):
            if t < f:
                return i
            t -= f
        return len(self.frames) - 1


# ----------------------------------------------------------------------------- time --

def _local(it, t):
    return t - it.delay if t > it.delay else 0


def visible(it, t, frame):
    """Whether an element is on screen t ms after the scene started, in frame `frame`."""
    if it.frame >= 0 and it.frame != frame:
        return False
    if t < it.delay:
        return False
    local = t - it.delay
    if it.dur > 0 and local >= it.dur:
        return False
    if it.blink > 0 and (local // it.blink) % 2 == 1:
        return False
    return True


def alpha(it, t):
    """Opacity at t: fades in over `fade` ms after the delay, and out over the last `fade` ms of `dur`."""
    a = it.opacity
    if it.fade > 0:
        local = _local(it, t)
        if local < it.fade:
            a *= local / it.fade
        if it.dur > 0 and local < it.dur and it.dur - local < it.fade:
            a *= (it.dur - local) / it.fade
    return min(1.0, max(0.0, a))


def offset(it, t):
    """Offset of a moving element: there and back once per period, eased."""
    if (it.move_x == 0 and it.move_y == 0) or it.period == 0:
        return 0.0, 0.0
    phase = (_local(it, t) % it.period) / it.period
    ease = (1 - math.cos(2 * math.pi * phase)) / 2
    return it.move_x * ease, it.move_y * ease


def angle(it, t):
    """Rotation in degrees at t (star, polygon)."""
    if it.spin == 0:
        return it.rot
    return it.rot + 360 * (_local(it, t) % it.spin) / it.spin


def pulse_scale(it, t):
    """Size factor of a pulsing circle, star or polygon: 0.88 .. 1.12 (scale() on the box)."""
    if it.pulse == 0:
        return 1.0
    return 1 + 0.12 * math.sin(2 * math.pi * (_local(it, t) % it.pulse) / it.pulse)


def typed(it, t):
    """How many characters of a typed text are out at t; None when it is not typed."""
    if it.type_ms == 0:
        return None
    return _local(it, t) // it.type_ms + 1


def mix(fg, bg, a):
    if a >= 1:
        return fg
    if a <= 0:
        return bg
    return tuple(round(b + (f - b) * a) for f, b in zip(fg, bg))


def bg_at(bg, px, py):
    if not bg.gradient:
        return bg.color
    f = px / 319 if bg.horizontal else py / 239
    return mix(bg.color2, bg.color, min(1.0, max(0.0, f)))


# -------------------------------------------------------------------------- parsing --

def number(raw):
    """"12", "-3.5", "12px", "500ms", "65%" -> float, or None."""
    s = raw.lower()
    for unit in ("px", "ms", "%"):
        if len(s) > len(unit) and s.endswith(unit):
            s = s[: -len(unit)]
            break
    if not s or s != s.strip() or "_" in s:
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return v if math.isfinite(v) else None


def parse_color(raw):
    """"#rgb", "#rrggbb", with alpha "#rgba" or "#rrggbbaa", or a name -> ((r, g, b), alpha) or None."""
    s = raw.strip(" \t\r\n").lower()
    if s in NAMED_COLORS:
        return NAMED_COLORS[s], 1.0
    h = s[1:] if s.startswith("#") else s
    if len(h) not in (3, 4, 6, 8) or any(ch not in "0123456789abcdef" for ch in h):
        return None
    v = [int(ch, 16) for ch in h]
    if len(h) <= 4:
        return (v[0] * 17, v[1] * 17, v[2] * 17), (v[3] * 17 / 255 if len(h) == 4 else 1.0)
    return (v[0] * 16 + v[1], v[2] * 16 + v[3], v[4] * 16 + v[5]), ((v[6] * 16 + v[7]) / 255 if len(h) == 8 else 1.0)


def icon_key(raw):
    """Icon names the way the table holds them: lower case, "mdi:" gone, words joined by "-", umlauts spelt out."""
    low = raw.strip(" \t\r\n").lower()
    if low.startswith("mdi:"):
        low = low[4:]
    out = []
    for ch in low:
        if ch in "äöüß":
            out.append({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"}[ch])
        elif "À" <= ch <= "ÿ":
            continue  # the box drops the other Latin-1 letters
        else:
            out.append("-" if ch in " _" else ch)
    return "".join(out)


def icon_codepoint(raw):
    """The codepoint of an icon by its MDI name or one of its other names; 0 when there is none."""
    k = icon_key(raw)
    return ICON_NAMES.get(k) or ICON_ALIASES.get(k, 0)


def distance(a, b):
    row = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        diag, row[0] = row[0], i
        for j in range(1, len(b) + 1):
            up = row[j]
            row[j] = min(row[j] + 1, row[j - 1] + 1, diag + (0 if a[i - 1] == b[j - 1] else 1))
            diag = up
    return row[len(b)]


def closest(word, names):
    """The closest of `names` to `word`: one that has the word as a part ("sunny" -> "weather-sunny") first,
    else the nearest by edit distance, if near enough."""
    best, best_d = "", math.inf
    for n in names:
        at = n.find(word)
        if word and at >= 0 and (at == 0 or n[at - 1] == "-") and (at + len(word) == len(n) or n[at + len(word)] == "-"):
            if best_d > 0 or len(n) < len(best):
                best = n
            best_d = 0
            continue
        d = distance(word, n)
        if d < best_d:
            best_d, best = d, n
    limit = 2 if len(word) < 6 else len(word) // 3
    return best if best_d <= limit else ""


def tokenize(s):
    """One command into (key, value) tokens: words, "quoted" or 'quoted' strings (\\" \\\\ \\n inside),
    key=value and key="quoted value". Returns the tokens and whether a quote stayed open."""
    out, open_quote, i, n = [], False, 0, len(s)
    while True:
        while i < n and s[i] in " \t\r":
            i += 1
        if i >= n:
            break
        key, j = "", i
        while j < n and s[j] not in " \t\r=\"'":
            j += 1
        if j < n and s[j] == "=" and j > i:
            key, i = s[i:j].lower(), j + 1
        if i < n and s[i] in "\"'":
            q, i, closed, buf = s[i], i + 1, False, []
            while i < n:
                c, i = s[i], i + 1
                if c == "\\" and i < n:
                    buf.append("\n" if s[i] == "n" else s[i])
                    i += 1
                    continue
                if c == q:
                    closed = True
                    break
                buf.append(c)
            value = "".join(buf)
            if not closed:
                open_quote = True
        else:
            k = i
            while k < n and s[k] not in " \t\r":
                k += 1
            value, i = s[i:k], k
        out.append((key, value))
    return out, open_quote


def statements(src):
    """Cuts the source into (line, command) at line ends and at ";" outside quotes and comments. A comment
    runs to the end of its line: "#" or "//" where a command starts, or after a command "# " or "//"."""
    out, cur, line, start_line = [], [], 1, 1
    quote, token_start, comment, blank = "", True, False, True
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else "\n"
        if c == "\n":
            out.append((start_line, "".join(cur)))
            cur, quote, comment, token_start, blank = [], "", False, True, True
            line += 1
            start_line = line
            i += 1
            continue
        if comment:
            i += 1
            continue
        if not quote:
            hash_ = c == "#" and (blank or (token_start and nxt in " \t\r\n"))
            slashes = c == "/" and nxt == "/" and (blank or token_start)
            if hash_ or slashes:
                comment = True
                i += 1
                continue
        if quote:
            if c == "\\" and i + 1 < n and nxt != "\n":
                cur += [c, nxt]
                i += 2
                continue
            if c == quote:
                quote = ""
            cur.append(c)
            token_start, blank = False, False
            i += 1
            continue
        if c == ";":
            out.append((start_line, "".join(cur)))
            cur, token_start, blank = [], True, True
            i += 1
            continue
        if c in "\"'" and token_start:
            quote = c
        cur.append(c)
        if c not in " \t\r":
            blank = False
        token_start = c in " \t\r="
        i += 1
    out.append((start_line, "".join(cur)))
    return out


def has_word(words, w):
    return f" {w} " in f" {words} "


class Parser:
    """Turns statements into items the way muse_scene.h does, with its messages."""

    def __init__(self, scene):
        self.s, self.frame, self.full, self.extra = scene, -1, False, 0

    def error(self, line, msg):
        if len(self.s.errors) < MAX_ERRORS:
            self.s.errors.append(f"line {line}: {msg}")
        else:
            self.extra += 1

    def finish(self):
        if self.extra:
            self.s.errors[-1] += f" (and {self.extra} more)"

    def statement(self, line, raw):
        text = raw.strip(" \t\r\n")
        if not text or text[0] == "#" or text.startswith("//"):
            return
        tokens, open_quote = tokenize(text)
        if not tokens:
            return
        if open_quote:
            self.error(line, "a quote is not closed; it ends at the end of the line")
        if tokens[0][0]:  # "seconds=30" reads as "seconds 30"
            tokens = [("", tokens[0][0]), ("", tokens[0][1])] + tokens[1:]
        name = tokens[0][1].lower()
        cname = COMMAND_ALIASES.get(name, name)
        if cname not in COMMANDS:
            near = closest(name, list(COMMANDS))
            self.error(line, f"unknown command '{name}'" + (f"; did you mean '{near}'?" if near else ""))
            self.s.skipped += 1
            return
        kind, is_item, pos, keys = COMMANDS[cname]
        tokens = tokens[1:]
        if not is_item:
            self.setting(line, cname, tokens)
            return
        if len(self.s.items) >= MAX_ITEMS:
            if not self.full:
                self.error(line, f"more than {MAX_ITEMS} elements; the rest is left out")
            self.full = True
            self.s.skipped += 1
            return
        it = Item(kind=kind, line=line, frame=self.frame)
        it.sub = "avatar" if name == "avatar" else "idle" if kind == "muse" else "confetti"
        ok, p, rest, opacity_set = True, 0, [], False
        for key, value in tokens:
            if not key:
                if p < len(pos):
                    key, p = pos[p], p + 1
                elif kind in ("text", "button"):
                    rest.append(value)
                    continue
                else:
                    self.error(line, f"{cname}: one value too many: '{value}'")
                    continue
            key = {"x1": "x", "y1": "y", "colour": "color"}.get(key, key)
            if not has_word(keys, key) and not has_word(COMMON_KEYS, key):
                self.error(line, f"{cname}: unknown key '{key}'; keys: {keys} {COMMON_KEYS}")
                continue
            if key == "opacity":
                opacity_set = True
            if not self.set(line, it, key, value, opacity_set):
                ok = False
        if kind in ("text", "button") and rest:
            it.text = " ".join(rest) if not it.text else it.text + " " + " ".join(rest)
        if ok:
            ok = self.complete(line, it)
        if not ok:
            self.s.skipped += 1
            return
        self.s.items.append(it)

    def setting(self, line, name, tokens):
        if name == "once":
            self.s.once = True
            return
        v = tokens[0][1] if tokens else ""
        if name == "seconds":
            factor, low = 1, v.lower()
            if len(low) > 3 and low.endswith("min"):
                low, factor = low[:-3], 60
            elif len(low) > 1 and low[-1] == "s" and not low.endswith("ms"):
                low = low[:-1]
            n = number(low)
            if n is None:
                self.error(line, f"seconds: '{v}' is not a number")
                return
            n *= factor
            self.s.seconds = int(3 if n < 3 else 3600 if n > 3600 else n)
            return
        if v.lower() in ("end", "all"):  # "frame end" goes back to elements shown in every frame
            self.frame = -1
            return
        ms = 500
        if v:
            n = number(v)
            if n is None:
                self.error(line, f"frame: '{v}' is not a number of ms; 500 ms instead")
            else:
                ms = int(50 if n < 50 else 10000 if n > 10000 else n)
        if len(self.s.frames) >= MAX_FRAMES:
            self.error(line, f"more than {MAX_FRAMES} frames; the rest goes into the last one")
            return
        self.s.frames.append(ms)
        self.frame = len(self.s.frames) - 1

    def num(self, line, it, key, v, lo, hi):
        n = number(v)
        if n is None:
            self.error(line, f"{it.kind}: {key}='{v}' is not a number")
            return None
        return lo if n < lo else hi if n > hi else n

    def choice(self, line, it, key, v, names, fallback):
        low = v.strip(" \t\r\n").lower()
        if low in names:
            return names.index(low)
        self.error(line, f"{it.kind}: {key}='{v}' is none of {', '.join(names)}")
        return fallback

    def set(self, line, it, key, v, opacity_set):
        """One key of an element. False when the element cannot be drawn without this value."""
        big = 2000.0

        def put(attr, lo, hi, cast=float):
            n = self.num(line, it, key, v, lo, hi)
            if n is not None:
                setattr(it, attr, cast(n))

        if key in ("x", "y", "x2", "y2", "x3", "y3"):
            put(key, -big, big)
        elif key == "h":
            put("h", 0, big)
        elif key == "w":
            if it.kind == "line":
                put("stroke", 1, 40, int)
            elif it.kind == "text":
                put("wrap", 0, big, int)
            else:
                put("w", 0, big)
        elif key == "r":
            if it.kind in ("rect", "bar", "button"):
                if v.lower() in ("pill", "full"):
                    it.radius = -1
                else:
                    put("radius", 0, 500, int)
            else:
                put("r", 0, 1000)
        elif key in ("color", "to") or (key == "bg" and it.kind == "bar"):
            c = parse_color(v)
            if c is None:
                self.error(line, f"{it.kind}: {key}='{v}' is no colour; {COLOR_HINT}")
                return not (it.kind == "bg" and key == "color")
            if key == "color":
                it.color, it.has_color = c[0], True
                if c[1] < 1 and not opacity_set:
                    it.opacity = c[1]
            else:
                it.color2, it.has_color2 = c[0], True
                if key == "to":
                    it.gradient = True
        elif key == "dir":
            it.horizontal = self.choice(line, it, key, v, ["down", "right"], 0) == 1
        elif key == "line":
            put("stroke", 0, 50, int)
        elif key == "opacity":
            n = self.num(line, it, key, v, 0, 100)
            if n is not None:
                it.opacity = n / 100 if n > 1 else n
        elif key in ("points", "sides"):
            put("points", 3, 24, int)
        elif key == "inner":
            put("inner", 0.1, 1.0)
        elif key == "rot":
            put("rot", -3600, 3600)
        elif key == "value":
            put("value", 0, 100)
        elif key == "text":
            it.text = v[:MAX_TEXT]
        elif key == "size":
            self.size(line, it, v)
        elif key == "align":
            i = self.choice(line, it, key, v, ["left", "center", "right", "centre", "middle"], 0)
            it.align = 1 if i >= 3 else i
        elif key == "valign":
            i = self.choice(line, it, key, v, ["top", "middle", "bottom", "center", "centre"], 0)
            it.valign = 1 if i >= 3 else i
        elif key == "lines":
            put("max_lines", 0, 20, int)
        elif key == "lh":
            put("line_h", 0, 200, int)
        elif key in ("name", "icon"):
            cp = icon_codepoint(v)
            if cp == 0:
                near = closest(icon_key(v), ICON_WORDS)
                self.error(line, f"{it.kind}: no icon '{v}'" + (f"; did you mean '{near}'?" if near else ""))
                return it.kind != "icon"
            it.glyph = cp
        elif key == "anim":
            it.sub = FIGURES[self.choice(line, it, key, v, FIGURES, 0)]
        elif key == "kind":
            it.sub = PARTICLE_KINDS[self.choice(line, it, key, v, PARTICLE_KINDS, 0)]
        elif key == "count":
            put("count", 1, MAX_PARTICLES, int)
        elif key == "speed":
            put("speed", 0.1, 5.0)
        elif key in MS_KEYS:
            put(MS_KEYS[key], 0, 3600000, int)
        elif key == "period":
            n = self.num(line, it, key, v, 0, 3600000)
            if n is not None:
                it.period = max(100, int(n))
        elif key == "move":  # move=dx,dy
            parts = v.split(",", 1)
            dx = number(parts[0].strip(" \t\r\n")) if len(parts) == 2 else None
            dy = number(parts[1].strip(" \t\r\n")) if len(parts) == 2 else None
            if dx is None or dy is None:
                self.error(line, f"{it.kind}: move='{v}' should be dx,dy such as move=0,-12")
            else:
                it.move_x, it.move_y = min(big, max(-big, dx)), min(big, max(-big, dy))
        return True

    def size(self, line, it, v):
        low = v.strip(" \t\r\n").lower()
        it.has_size = True
        if it.kind in ("icon", "particles"):
            if low in ("s", "small", "m"):
                it.size = 0
            elif low in ("l", "large", "xl"):
                it.size = 1
            else:
                n = number(low)
                if n is not None:
                    it.size = 0 if n < 35 else 1
                else:
                    self.error(line, f"{it.kind}: size='{v}' is none of s, l (24, 46 px)")
            return
        names = ["xs", "s", "m", "l", "xl", "xxl"]
        if low in names:
            it.size = names.index(low)
            return
        n = number(low)
        if n is None:
            self.error(line, f"text: size='{v}' is none of xs, s, m, l, xl, xxl (13, 16, 20, 24, 36, 54 px)")
            return
        it.size = min(range(6), key=lambda i: abs(TEXT_PX[i] - n))

    def complete(self, line, it):
        """Checks what an element needs to be drawn at all, and fills in sensible defaults."""

        def need(have, what):
            if not have:
                self.error(line, f"{it.kind}: needs {what}")
            return have

        def default(attr, value):
            if math.isnan(getattr(it, attr)):
                setattr(it, attr, value)

        k = it.kind
        if k == "bg":
            if not it.has_color:
                it.color = PAGE
            return True
        if k in ("rect", "bar"):
            default("x", 0)
            default("y", 0)
            if k == "bar":
                if not it.has_color:
                    it.color = (52, 199, 89)
                if not it.has_color2:
                    it.color2 = (209, 209, 214)
            return need(it.w > 0 and it.h > 0, "w and h above 0")
        if k in ("circle", "star", "poly"):
            default("x", 160)
            default("y", 120)
            return need(it.r > 0, "r above 0")
        if k == "line":
            default("x", 0)
            default("y", 0)
            if it.stroke == 0:
                it.stroke = 1
            return need(not math.isnan(it.x2) and not math.isnan(it.y2), "x2 and y2")
        if k == "tri":
            return need(not any(math.isnan(v) for v in (it.x, it.y, it.x2, it.y2, it.x3, it.y3)),
                        "three points: x y x2 y2 x3 y3")
        if k == "text":
            default("x", 0)
            default("y", 0)
            return need(bool(it.text.strip(" \t\r\n")), "a text")
        if k == "icon":
            default("x", 160)
            default("y", 120)
            it.size = min(it.size, 1)
            return need(it.glyph != 0, "an icon name")
        if k == "muse":
            default("x", 160)
            default("y", 110)
            if math.isnan(it.r) or it.r > 80:
                it.r = 80
            it.r = max(it.r, 20)
            return True
        if k == "particles":
            default("x", 0)
            default("y", 0)
            default("w", 320)
            default("h", 240)
            if not it.has_size or it.size > 1:
                it.size = 0
            return True
        default("x", 0)  # button
        default("y", 0)
        if not it.has_color:
            it.color = (0, 122, 255)
        if not it.has_size:
            it.size = 2  # text size m
        if it.radius == 0:
            it.radius = -1  # a pill unless r was given
        return need(it.w > 0 and it.h > 0, "w and h above 0") and need(bool(it.text.strip(" \t\r\n")), "a text")


def parse(src):
    """A scene from its source, with every message the box would give."""
    s = Scene()
    p = Parser(s)
    raw = src.encode("utf-8")
    if len(raw) > MAX_SOURCE:
        p.error(1, f"the scene has {len(raw)} bytes; only the first {MAX_SOURCE} are read")
        src = raw[:MAX_SOURCE].decode("utf-8", "ignore")
    for line, text in statements(src):
        p.statement(line, text)
    p.finish()
    return s


# ---------------------------------------------------------------------------- fonts --

def inter_path(font_dir, weight):
    return Path(font_dir) / f"Inter@{weight}@False@v1.ttf"


def find_font_dir(font_dir=None):
    """The folder with the three Inter TTFs: the one given, MUSE_FONT_DIR, or ESPHome's cache; else None."""
    for cand in (font_dir, os.environ.get("MUSE_FONT_DIR"), ESPHOME_FONTS):
        if cand and all(inter_path(cand, w).is_file() for w in sorted(set(TEXT_WEIGHT))):
            return Path(cand)
    return None


def find_icon_font(icon_font=None, font_dir=None):
    """The Material Design Icons TTF: the one given, MUSE_ICON_FONT, or a web font in ESPHome's cache
    (font_dir/<hash>/font.ttf) that holds the icons; else None."""
    logging.getLogger("fontTools").setLevel(logging.ERROR)
    cands = [Path(c) for c in (icon_font, os.environ.get("MUSE_ICON_FONT")) if c]
    if font_dir:
        cands += sorted(Path(font_dir).glob("*/font.ttf"))
    for cand in cands:
        if cand.is_file() and ICON_NAMES["coffee"] in TTFont(cand).getBestCmap():
            return cand
    return None


class Fonts:
    """The box's fonts: Inter by weight for the six text sizes, Material Design Icons for the two icon sizes."""

    def __init__(self, font_dir=None, icon_font=None):
        self.font_dir = find_font_dir(font_dir)
        if self.font_dir is None:
            sys.exit(f"the Inter fonts are missing: {FONT_HINT}")
        self.icon_font = find_icon_font(icon_font, self.font_dir)
        if self.icon_font is None:
            sys.exit(f"the icon font is missing: {FONT_HINT}")
        self.cache = {}
        self.latin = set(TTFont(self.inter(500)).getBestCmap())

    def inter(self, weight):
        return inter_path(self.font_dir, weight)

    def text(self, size):
        if ("text", size) not in self.cache:
            self.cache[("text", size)] = ImageFont.truetype(str(self.inter(TEXT_WEIGHT[size])), TEXT_PX[size])
        return self.cache[("text", size)]

    def icon(self, size):
        if ("icon", size) not in self.cache:
            self.cache[("icon", size)] = ImageFont.truetype(str(self.icon_font), ICON_PX[size])
        return self.cache[("icon", size)]

    def can_draw(self, size, ch):
        """Whether the box's font of this text size holds the character."""
        if size == 4:
            return ch in GLYPHS_XL
        if size == 5:
            return ch in GLYPHS_XXL
        cp = ord(ch)
        return cp in self.latin and (cp < 0x250 or 0x2000 <= cp < 0x20D0 or cp in (0x2122, 0x2212))


def drawable(text, fonts, size):
    """What the box's font draws of a text: characters it lacks are left out, emojis included."""
    out = []
    for ch in text:
        if ch == "\r":
            continue
        if ch in "\t   ":
            ch = " "
        if ch == "−":
            ch = "-"
        if ch in " \n" or fonts.can_draw(size, ch):
            out.append(ch)
    return "".join(out)


def wrap(text, width_of, max_width):
    """Lines no wider than max_width; '\\n' starts a new line, a word wider than a line is cut between characters."""
    lines = []
    for para in text.split("\n"):
        line = ""
        for word in para.split(" "):
            if not word:
                continue
            test = word if not line else line + " " + word
            if width_of(test) <= max_width:
                line = test
                continue
            if line:
                lines.append(line)
            line = ""
            while width_of(word) > max_width:
                fit = 0
                for k in range(1, len(word) + 1):
                    if width_of(word[:k]) > max_width:
                        break
                    fit = k
                fit = max(fit, 1)
                lines.append(word[:fit])
                word = word[fit:]
            line = word
        lines.append(line)
    while lines and not lines[-1]:
        lines.pop()
    return lines


def fit_line(text, max_width, width_of, ellipsis):
    """`text` when it fits, else its longest beginning that fits together with the ellipsis (muse_fit.h)."""
    if not text or width_of(text) <= max_width:
        return text

    def candidate(k):
        return text[:k].rstrip(" ") + ellipsis

    if width_of(candidate(0)) > max_width:
        return ellipsis
    lo, hi = 0, len(text) - 1
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if width_of(candidate(mid)) <= max_width:
            lo = mid
        else:
            hi = mid - 1
    return candidate(lo)


def scene_lines(item, text, fonts):
    """Lines of a scene text: wrapped to `w`, cut to `lines` with an ellipsis."""
    font = fonts.text(item.size)
    clean = drawable(text, fonts, item.size)
    lines = wrap(clean, font.getlength, item.wrap) if item.wrap > 0 else clean.split("\n")
    if item.max_lines > 0 and len(lines) > item.max_lines:
        lines = lines[: item.max_lines]
        ell = "…" if fonts.can_draw(item.size, "…") else "..."
        lines[-1] = fit_line(lines[-1] + ell, item.wrap if item.wrap > 0 else 100000, font.getlength, ell)
    return lines


def fill_placeholders(text, clock):
    """{time}, {date} and {weekday} in a scene text, in German."""
    if "{" not in text:
        return text
    days = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]
    months = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober",
              "November", "Dezember"]
    return (text.replace("{time}", clock.strftime("%H:%M")).replace("{date}", f"{clock.day}. {months[clock.month - 1]}")
            .replace("{weekday}", days[clock.weekday()]))


# -------------------------------------------------------------------------- drawing --
# Shape helpers take screen coordinates (1 px = 1 px of the box) and draw SS times larger.

def s(v):
    return v * SS


def disc_box(cx, cy, r):
    x0, y0, x1, y1 = round(s(cx - r)), round(s(cy - r)), round(s(cx + r)) - 1, round(s(cy + r)) - 1
    return [x0, y0, max(x1, x0), max(y1, y0)]


def fill_disc(d, cx, cy, r, c):
    if r > 0:
        d.ellipse(disc_box(cx, cy, r), fill=c)


def draw_circle(d, cx, cy, r, stroke, c):
    """A filled circle, or a ring of `stroke` px when the stroke is thinner than r (scene_circle on the box)."""
    if r <= 0:
        return
    if 0 < stroke < r:
        d.ellipse(disc_box(cx, cy, r), outline=c, width=max(1, round(s(stroke))))
    else:
        d.ellipse(disc_box(cx, cy, r), fill=c)


def thick_line(d, x1, y1, x2, y2, w, c):
    """A line w px wide with round ends; w <= 1 is a plain one-pixel line, like on the box."""
    xy = [round(s(x1)), round(s(y1)), round(s(x2)), round(s(y2))]
    if w <= 1:
        d.line(xy, fill=c, width=SS)
        return
    d.line(xy, fill=c, width=max(1, round(s(w))))
    fill_disc(d, x1, y1, w / 2, c)
    fill_disc(d, x2, y2, w / 2, c)


def round_rect(d, x, y, w, h, r, stroke, c):
    """A rectangle with round corners, filled or as an outline of `stroke` px (scene_rect on the box)."""
    x, y, w, h = round(x), round(y), round(w), round(h)
    if w <= 0 or h <= 0:
        return
    if r < 0 or 2 * r > min(w, h):
        r = min(w, h) // 2
    box = [s(x), s(y), s(x + w) - 1, s(y + h) - 1]
    if stroke > 0:
        d.rounded_rectangle(box, radius=s(r), outline=c, width=s(min(stroke, min(w, h) // 2)))
    else:
        d.rounded_rectangle(box, radius=s(r), fill=c)


def outline_points(cx, cy, r, points, inner, deg, star):
    """The corners of a star (2 * points) or of a regular polygon around (cx, cy), the first one straight up."""
    n = points * 2 if star else points
    start = math.radians(deg - 90)
    out = []
    for i in range(n):
        a = start + 2 * math.pi * i / n
        rr = r * inner if star and i % 2 == 1 else r
        out.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    return out


def draw_outline(d, pts, stroke, c):
    """A closed shape through `pts`: filled, or `stroke` px lines with round joints."""
    if stroke > 0:
        for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
            thick_line(d, x1, y1, x2, y2, stroke, c)
    else:
        d.polygon([(round(s(px)), round(s(py))) for px, py in pts], fill=c)


def print_centered(d, font, text, x, y, c):
    """Text at 1:1 the way it.print(x, y, font, c, TextAlign::CENTER, text) places it: the font's line box
    (ascent + descent) centred on x, y."""
    ascent, descent = font.getmetrics()
    d.text((round(x - font.getlength(text) / 2), round(y) - (ascent + descent) // 2), text, font=font, fill=c,
           anchor="la")


def composite_at(dst, src, x0, y0):
    """dst.alpha_composite(src) with src's top left at (x0, y0), which may lie partly off the canvas."""
    x0, y0 = round(x0), round(y0)
    cx0, cy0 = max(0, -x0), max(0, -y0)
    cx1, cy1 = min(src.width, dst.width - x0), min(src.height, dst.height - y0)
    if cx1 <= cx0 or cy1 <= cy0:
        return
    if (cx0, cy0, cx1, cy1) != (0, 0, src.width, src.height):
        src = src.crop((cx0, cy0, cx1, cy1))
    dst.alpha_composite(src, dest=(x0 + cx0, y0 + cy0))


def new_layer(res):
    return Image.new("RGBA", (W * res, H * res), (0, 0, 0, 0))


def lay(canvas, backdrop, layer, res, a, seen):
    """Puts a layer drawn at resolution `res` (1 or SS) onto the canvas the way the box draws: inside the element
    every pixel becomes the element's colour mixed by its opacity with what under() finds below it, the
    `backdrop`. The backdrop holds only what under() knows (the background, filled rectangles and circles,
    bars), so a translucent element shows the background through, but not a star, a text or Muse drawn
    earlier. Returns the new backdrop: the mixed picture when under() sees this element (`seen`)."""
    if res != SS:
        layer = layer.resize((W * SS, H * SS), Image.NEAREST)
    if a < 1:
        layer.putalpha(layer.getchannel("A").point(lambda v: round(v * a)))
    mixed = Image.alpha_composite(backdrop, layer)
    canvas.paste(mixed, mask=layer.getchannel("A").point(lambda v: 255 if v else 0))
    return mixed if seen else backdrop


def rnd(a, b):
    """0 .. 1, the same for the same a and b: the firmware's hash, so the particles agree with the box."""
    m = 0xFFFFFFFF
    h = ((a * 2654435761) & m) ^ ((b * 2246822519 + 0x9E3779B9) & m)
    h ^= h >> 15
    h = (h * 2246822519) & m
    h ^= h >> 13
    h = (h * 3266489917) & m
    h ^= h >> 16
    return (h & 0xFFFFFF) / 16777216.0


def bg_layer(item):
    """The background as a layer: one colour, or the gradient row by row (column by column with dir=right)."""
    if not item.gradient:
        return Image.new("RGBA", (W * SS, H * SS), item.color + (255,))
    n = W if item.horizontal else H
    strip = Image.new("RGB", (n, 1) if item.horizontal else (1, n))
    strip.putdata([bg_at(item, i + 0.5, 0) if item.horizontal else bg_at(item, 0, i + 0.5) for i in range(n)])
    return strip.resize((W * SS, H * SS), Image.NEAREST).convert("RGBA")


def draw_text(d, item, x, y, t, clock, fonts, c):
    font = fonts.text(item.size)
    lines = scene_lines(item, fill_placeholders(item.text, clock), fonts)
    lh = item.line_h if item.line_h > 0 else round(TEXT_PX[item.size] * 1.3)
    block = len(lines) * lh
    top = y - block / 2 if item.valign == 1 else y - block if item.valign == 2 else y
    budget = typed(item, t)
    for i, line in enumerate(lines):
        if budget is not None:
            if budget <= 0:
                break
            shown = line[:budget]
            budget = 0 if len(line) >= budget else budget - len(line)
            line = shown
        if not line:
            continue
        width = font.getlength(line)
        xs = x - width / 2 if item.align == 1 else x - width if item.align == 2 else x
        d.text((round(xs), round(top + i * lh)), line, font=font, fill=c, anchor="la")


_FIGURE_CACHE: dict = {}


def figure_frames(sub, folder=None):
    """The frames of firmware/figure/<sub>.png as RGB pictures, or None when the file is missing or broken.
    Pillow composes every APNG frame from the changed rectangle the file stores, as ESPHome does when it
    embeds the file."""
    path = Path(folder or FIGURE_DIR) / f"{sub}.png"
    key = str(path)
    if key not in _FIGURE_CACHE:
        frames = None
        try:
            with Image.open(path) as im:
                frames = []
                for i in range(getattr(im, "n_frames", 1)):
                    im.seek(i)
                    frames.append(im.convert("RGB"))
        except (OSError, ValueError):
            frames = None
        _FIGURE_CACHE[key] = frames or None
    return _FIGURE_CACHE[key]


def lround(v):
    """C's lroundf: halves away from zero (Python's round() goes to the even neighbour)."""
    return int(math.copysign(math.floor(abs(v) + 0.5), v))


def figure_index(sub, t, count):
    """Which of `count` frames the box shows t ms into a scene: the avatar is a still, confetti plays once and
    holds its last frame, the rest go 0 .. count - 1 and back, one step per 160 ms (muse.h, FIGURE)."""
    if count <= 1 or sub == "avatar":
        return 0
    if sub == "confetti":
        return min(count - 1, t // STEP_MS)
    cycle = 2 * (count - 1)
    step = (t // STEP_MS) % cycle
    return step if step < count else cycle - step


def draw_figure(layer, x, y, r, sub, t, folder=None):
    """The figure as the box draws it in a scene: the picture of the animation (160 x 160) or the avatar
    (72 x 72) centred on x, y, cut to a disc of radius r; outside the disc the box shows what lies below.
    The pictures are the files the firmware embeds (figure_frames); the coded stand-in only when they are
    missing."""
    frames = figure_frames(sub, folder)
    if not frames:
        draw_coded_figure(layer, x, y, r, sub, t)
        return
    frame = frames[figure_index(sub, t, len(frames))]
    w, h = frame.size
    pic = frame.resize((s(w), s(h)), Image.NEAREST).convert("RGBA")  # NEAREST, so reduce(SS) gives the pixels back
    rr = min(r, min(w, h) / 2)
    mask = Image.new("L", pic.size, 0)
    ImageDraw.Draw(mask).ellipse(disc_box(w / 2, h / 2, rr), fill=255)
    pic.putalpha(mask)
    composite_at(layer, pic, s(lround(x - w / 2)), s(lround(y - h / 2)))


FIGURE_BODY, FIGURE_DARK, FIGURE_CHEEK, FIGURE_SPARK = (76, 150, 214), (54, 112, 168), (255, 158, 158), (255, 204, 0)


def draw_coded_figure(layer, x, y, r, sub, t):
    """The stand-in when firmware/figure/ has no pictures: the flat round character the project shipped before
    its generated figure (a blue disc with a face), same place, same sizes, same round frame, and 16 frames
    played forwards and back at 160 ms a step."""
    size = 72 if sub == "avatar" else 160
    pic = Image.new("RGBA", (s(size), s(size)), PAGE + (255,))
    d = ImageDraw.Draw(pic)
    ink, body, dark = INK + (255,), FIGURE_BODY + (255,), FIGURE_DARK + (255,)
    step = (t // 160) % 30
    phase = (step if step < 16 else 30 - step) / 16
    cx = size / 2
    cy, br = (size * 0.5, size * 0.4) if sub == "avatar" else (size * 0.56, size * 0.28) if sub in ("working", "making") \
        else (size * 0.54, size * 0.3)
    if sub == "wave":  # the waving hand: a small disc on an arm that swings
        ang = math.radians(-60 + 35 * math.sin(4 * math.pi * phase))
        ax, ay = cx + br * 0.95, cy - br * 0.1
        hx, hy = ax + math.cos(ang) * br * 0.55, ay + math.sin(ang) * br * 0.55
        thick_line(d, ax, ay, hx, hy, br * 0.16, dark)
        fill_disc(d, hx, hy, br * 0.14, body)
    squash = 1 + 0.03 * math.sin(2 * math.pi * phase) if sub == "idle" else 1.0  # breathing
    box = [round(s(cx - br)), round(s(cy - br * squash)), round(s(cx + br)), round(s(cy + br * squash))]
    d.ellipse(box, fill=body)
    d.chord(box, 20, 160, fill=dark)
    d.ellipse(box, outline=dark, width=s(3))
    look = math.sin(2 * math.pi * phase) if sub == "working" else 0.0
    ey, er = cy - br * 0.12, br * 0.11
    for side in (-1, 1):
        ex = cx + side * br * 0.34 + look * br * 0.1
        if sub == "idle" and step in (11, 19):  # the blink frame
            thick_line(d, ex - er, ey, ex + er, ey, 3, ink)
        else:
            fill_disc(d, ex, ey, er, (255, 255, 255, 255))
            fill_disc(d, ex + look * er * 0.4, ey, er * 0.55, ink)
        kx = cx + side * br * 0.52
        d.ellipse([round(s(kx - br * 0.1)), round(s(cy + br * 0.06)), round(s(kx + br * 0.1)), round(s(cy + br * 0.18))],
                  fill=FIGURE_CHEEK + (255,))
    smile = {"wave": 1.2, "working": 0.4, "making": 0.9}.get(sub, 1.0)
    my, mw = cy + br * 0.3, br * 0.26
    d.arc([round(s(cx - mw)), round(s(my - mw * smile)), round(s(cx + mw)), round(s(my + mw * smile))], 10, 170,
          fill=ink, width=s(3))
    if sub == "working":  # three thought dots above, swelling one after another
        for k in range(3):
            p = (math.sin(2 * math.pi * (phase - k * 0.18)) + 1) / 2
            fill_disc(d, cx + (k - 1) * br * 0.32, cy - br * 1.25 - k * br * 0.05, br * (0.06 + 0.05 * p), dark)
    if sub == "making":  # a spark that orbits the head
        ang = 2 * math.pi * phase
        pts = outline_points(cx + math.cos(ang) * br * 1.25, cy - br * 0.4 + math.sin(ang) * br * 0.5, br * 0.16,
                             5, 0.45, 0, True)
        d.polygon([(round(s(px)), round(s(py))) for px, py in pts], fill=FIGURE_SPARK + (255,))
    rr = min(r, size / 2)  # the round frame: outside it the box shows what lies below
    mask = Image.new("L", pic.size, 0)
    ImageDraw.Draw(mask).ellipse(disc_box(size / 2, size / 2, rr), fill=255)
    pic.putalpha(mask)
    composite_at(layer, pic, s(x - size / 2), s(y - size / 2))


def draw_bar(d, item, x, y, c):
    bx, by, bw, bh = round(x), round(y), round(item.w), round(item.h)
    r = bh // 2 if item.radius < 0 or item.radius * 2 > bh else item.radius
    round_rect(d, bx, by, bw, bh, r, 0, item.color2 + (255,))
    fw = round(bw * item.value / 100)
    if fw > 0:
        round_rect(d, bx, by, max(fw, min(2 * r, bw)), bh, r, 0, c)


PALETTE = [(255, 59, 48), (255, 149, 0), (255, 204, 0), (52, 199, 89), (48, 176, 199), (0, 122, 255),
           (175, 82, 222), (255, 45, 85)]
FALLBACK = {"confetti": (255, 59, 48), "snow": (255, 255, 255), "rain": (120, 170, 255), "sparkle": (255, 214, 10),
            "bubbles": (200, 230, 255)}


def draw_particles(d, p, index, t, dx, dy, a, fonts):
    """Confetti and snow fall, rain falls fast, bubbles rise, sparkles twinkle in place (scene_particles)."""
    ax, ay, aw, ah = p.x + dx, p.y + dy, p.w, p.h
    secs = t / 1000 * p.speed
    for i in range(p.count):
        seed = (index * 977 + i) & 0xFFFFFFFF
        r1, r2, r3, r4 = (rnd(seed, j) for j in (1, 2, 3, 4))
        c = p.color if p.has_color else PALETTE[i % 8] if p.sub == "confetti" else FALLBACK[p.sub]
        size = 1.0
        if p.sub == "sparkle":
            x, y = ax + r1 * aw, ay + r2 * ah
            tw = math.sin(secs * 2.6 + r3 * 2 * math.pi)
            size = tw * tw if tw > 0 else 0.0
            if size < 0.05:
                continue
        else:
            span = ah + 24
            v = (140 + r2 * 80 if p.sub == "rain" else 12 + r2 * 18 if p.sub == "snow"
                 else 15 + r2 * 20 if p.sub == "bubbles" else 30 + r2 * 40)
            travel = math.fmod(r3 * span + v * secs, span)
            y = ay + ah + 12 - travel if p.sub == "bubbles" else ay - 12 + travel
            sway = -0.25 * travel if p.sub == "rain" else 7 * math.sin(secs * 1.3 + r4 * 2 * math.pi)
            x = ax + r1 * aw + sway
        rgba = c + (round(255 * min(1.0, a * size)),)
        if p.glyph:
            print_centered(d, fonts.icon(p.size), chr(p.glyph), int(x), int(y), rgba)
        elif p.sub == "confetti":
            w = 2 + int(4 * abs(math.sin(secs * 4 + r4 * 2 * math.pi)))
            d.rectangle([s(int(x)), s(int(y)), s(int(x) + w) - 1, s(int(y) + 6) - 1], fill=rgba)
        elif p.sub == "snow":
            fill_disc(d, x, y, 1.2 + r4 * 2, rgba)
        elif p.sub == "rain":
            thick_line(d, x, y, x - 2, y + 9, 1, rgba)
        elif p.sub == "sparkle":
            arm = 2 + 5 * size
            thick_line(d, x - arm, y, x + arm, y, 1, rgba)
            thick_line(d, x, y - arm, x, y + arm, 1, rgba)
            fill_disc(d, x, y, 1.3, rgba)
        else:  # bubbles
            draw_circle(d, x, y, 3 + r4 * 5, 1, rgba)


def draw_button(canvas, backdrop, item, x, y, fonts, c, a):
    """A pill with its text centred; white text on a dark colour, ink on a light one. The box prints the
    label onto the pill itself, in full, whatever the button's opacity."""
    bx, by, bw, bh = round(x), round(y), round(item.w), round(item.h)
    pill = new_layer(SS)
    round_rect(ImageDraw.Draw(pill), bx, by, bw, bh, item.radius, 0, c)
    lay(canvas, backdrop, pill, SS, a, False)
    font = fonts.text(item.size)
    ell = "…" if fonts.can_draw(item.size, "…") else "..."
    label = fit_line(drawable(item.text, fonts, item.size), bw - 16, font.getlength, ell)
    dark = (c[0] * 299 + c[1] * 587 + c[2] * 114) // 1000 < 150
    text = new_layer(1)
    print_centered(ImageDraw.Draw(text), font, label, bx + bw // 2, by + bh // 2,
                   (255, 255, 255, 255) if dark else INK + (255,))
    canvas.alpha_composite(text.resize((W * SS, H * SS), Image.NEAREST))


def draw_scene(scene, t, clock, fonts):
    """The scene t ms after its start, as an RGB image of W x H (draw_scene on the box)."""
    canvas = Image.new("RGBA", (W * SS, H * SS), PAGE + (255,))
    backdrop = canvas.copy()  # what under() sees on the box, see lay()
    frame = scene.frame_at(t)
    for k, item in enumerate(scene.items):
        if not visible(item, t, frame):
            continue
        a = alpha(item, t)
        if a <= 0:
            continue
        dx, dy = offset(item, t)
        x, y = item.x + dx, item.y + dy
        c = item.color + (255,)
        seen = item.kind in ("bg", "bar") or (item.kind in ("rect", "circle") and item.stroke == 0)
        if item.kind == "bg":
            backdrop = lay(canvas, backdrop, bg_layer(item), SS, a, seen)
            continue
        if item.kind == "button":
            draw_button(canvas, backdrop, item, x, y, fonts, c, a)
            continue
        res = 1 if item.kind in ("text", "icon") or (item.kind == "particles" and item.glyph) else SS
        layer = new_layer(res)
        d = ImageDraw.Draw(layer)
        if item.kind == "rect":
            round_rect(d, x, y, item.w, item.h, item.radius, item.stroke, c)
        elif item.kind == "circle":
            draw_circle(d, x, y, item.r * pulse_scale(item, t), item.stroke, c)
        elif item.kind == "line":
            thick_line(d, x, y, item.x2 + dx, item.y2 + dy, item.stroke, c)
        elif item.kind == "tri":
            draw_outline(d, [(x, y), (item.x2 + dx, item.y2 + dy), (item.x3 + dx, item.y3 + dy)], item.stroke, c)
        elif item.kind in ("star", "poly"):
            pts = outline_points(x, y, item.r * pulse_scale(item, t), item.points, item.inner, angle(item, t),
                                 item.kind == "star")
            draw_outline(d, pts, item.stroke, c)
        elif item.kind == "text":
            draw_text(d, item, x, y, t, clock, fonts, c)
        elif item.kind == "icon":
            print_centered(d, fonts.icon(item.size), chr(item.glyph), round(x), round(y), c)
        elif item.kind == "muse":
            draw_figure(layer, x, y, item.r, item.sub, t)
            a = 1.0  # the box copies the picture as it is: opacity and fade do not thin it, it just appears
        elif item.kind == "bar":
            draw_bar(d, item, x, y, c)
        elif item.kind == "particles":
            draw_particles(d, item, k, t, dx, dy, a, fonts)
            a = 1.0  # the particles carry their opacity themselves
        backdrop = lay(canvas, backdrop, layer, res, a, seen)
    return canvas.convert("RGB").reduce(SS)


def render_frame(scene, t, clock, fonts, scale=1):
    im = draw_scene(scene, t, clock, fonts)
    return im if scale == 1 else im.resize((W * scale, H * scale), Image.NEAREST)


def render_png(scene, path, t, clock, fonts, scale=1):
    render_frame(scene, t, clock, fonts, scale).save(path)


def render_gif(scene, path, seconds, fps, clock, fonts, scale=1):
    """Frames at `fps` over `seconds`, each with its own 256-colour palette; returns the number of frames
    rendered. Pillow merges a frame that equals the one before into it (the duration adds up), so a scene
    that holds still for a while has fewer frames in the file than were rendered."""
    n = max(1, round(seconds * fps))
    frames = [render_frame(scene, round(i * 1000 / fps), clock, fonts, scale).quantize(256, dither=Image.Dither.NONE)
              for i in range(n)]
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=round(1000 / fps), loop=0, optimize=False)
    return n


# ------------------------------------------------------------------------------ cli --

def report(name, scene):
    """The scene's messages and a summary like the box's response."""
    for e in scene.errors:
        print(f"{name}: {e}")
    print(f"{name}: ok={'true' if not scene.errors else 'false'} elements={len(scene.items)} "
          f"frames={len(scene.frames)} seconds={scene.seconds} skipped={scene.skipped}")


def wrote(path):
    kb = os.path.getsize(path) / 1024
    with Image.open(path) as im:
        print(f"wrote {path} ({im.width} x {im.height}, {kb:.0f} KB)")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Render a Muse scene to PNG or GIF the way the box draws it.")
    ap.add_argument("scene", nargs="?", help="a scene file (.txt)")
    ap.add_argument("--png", metavar="OUT", help="write the picture at --t ms")
    ap.add_argument("--gif", metavar="OUT", help="write an animation over --seconds at --fps")
    ap.add_argument("--t", type=int, default=2000, help="ms after the start for --png (default 2000)")
    ap.add_argument("--seconds", type=float, default=4.0, help="length of the GIF (default 4)")
    ap.add_argument("--fps", type=float, default=10.0, help="frames per second of the GIF (default 10)")
    ap.add_argument("--all", nargs=2, metavar=("SCENES_DIR", "OUT_DIR"), help="PNG and GIF for every *.txt")
    ap.add_argument("--scale", type=int, default=1, help="2 gives 640 x 480, nearest neighbour (default 1)")
    ap.add_argument("--check", action="store_true", help="only parse and print the messages")
    ap.add_argument("--dry-run", action="store_true", help="with --all: say what would be written")
    ap.add_argument("--clock", help='"YYYY-MM-DD HH:MM" for {time}, {date} and {weekday} (default: now)')
    ap.add_argument("--font-dir", type=Path, help="folder with the Inter TTFs (default: firmware/.esphome/font)")
    ap.add_argument("--icon-font", type=Path, help="the Material Design Icons TTF (default: found in --font-dir)")
    args = ap.parse_args(argv)
    clock = dt.datetime.strptime(args.clock, "%Y-%m-%d %H:%M") if args.clock else dt.datetime.now()
    if args.all:
        scenes_dir, out_dir = Path(args.all[0]), Path(args.all[1])
        files = sorted(scenes_dir.glob("*.txt"))
        if not files:
            sys.exit(f"no *.txt in {scenes_dir}")
        if args.dry_run:
            for f in files:
                print(f"would write {out_dir / (f.stem + '.png')} and {out_dir / (f.stem + '.gif')}")
            return 0
        fonts = Fonts(args.font_dir, args.icon_font)
        out_dir.mkdir(parents=True, exist_ok=True)
        for f in files:
            scene = parse(f.read_text(encoding="utf-8"))
            report(f.name, scene)
            render_png(scene, out_dir / (f.stem + ".png"), args.t, clock, fonts, args.scale)
            wrote(out_dir / (f.stem + ".png"))
            render_gif(scene, out_dir / (f.stem + ".gif"), args.seconds, args.fps, clock, fonts, args.scale)
            wrote(out_dir / (f.stem + ".gif"))
        return 0
    if not args.scene:
        ap.error("a scene file or --all is needed")
    scene = parse(Path(args.scene).read_text(encoding="utf-8"))
    report(Path(args.scene).name, scene)
    if args.check:
        return 1 if scene.errors else 0
    if not args.png and not args.gif:
        ap.error("--png OUT, --gif OUT or --check is needed")
    fonts = Fonts(args.font_dir, args.icon_font)
    if args.png:
        render_png(scene, args.png, args.t, clock, fonts, args.scale)
        wrote(args.png)
    if args.gif:
        render_gif(scene, args.gif, args.seconds, args.fps, clock, fonts, args.scale)
        wrote(args.gif)
    return 0


if __name__ == "__main__":
    sys.exit(main())
