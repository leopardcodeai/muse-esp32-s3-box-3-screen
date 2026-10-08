#!/usr/bin/env python3
"""make_muse_icon_table.py: the icon names a Muse scene can use, and their glyphs.

What: reads the Material Design Icons font (fonts/materialdesignicons-webfont.ttf,
  version 7.4.47, byte for byte the file the firmware build downloads) and writes
    muse_icons.h            icon name -> codepoint, sorted, plus German and English aliases
    muse_icon_glyphs.yaml   the glyph list that both icon fonts in stackchan-box3.yaml include
Why: muse_draw (the scene language, the project history) takes icon names such as
  "coffee" or "mdi:coffee", but the box can only draw glyphs compiled into its fonts.
  One list here keeps the table and the fonts in step: a name in the table without
  its glyph in the font would draw an empty box and log a warning ten times a second.
Pitfalls:
  * Every icon costs flash twice, at 24 px and at 46 px. The app partition was 88 %
    full before the scene language (07.10.2026); read the build's Flash line after
    adding icons.
  * Several codepoints can share one glyph name (MDI keeps old codepoints as aliases).
    The lowest one is used, so the output does not change from run to run.
  * muse_show_event draws its icons from the same 46 px font. Their glyphs are in the
    list under their MDI names (EVENT_ICONS); the script stops if one is missing.
  * Aliases are written normalised (lower case, ASCII, words joined by "-"), the way
    muse_scene.h normalises what Muse sends.
Usage:
  uv run --python 3.14 --with fonttools make_muse_icon_table.py --dry-run
  uv run --python 3.14 --with fonttools make_muse_icon_table.py
"""
import argparse
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent
FW = HERE.parent / "firmware"
CACHE = HERE.parent / ".cache"
FONT = CACHE / "materialdesignicons-webfont.ttf"
FONT_URL = "https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/fonts/materialdesignicons-webfont.ttf"
HEADER = FW / "muse_icons.h"
GLYPHS = FW / "muse_icon_glyphs.yaml"

# The icons of muse_show_event (muse::event in muse.h), by MDI name.
EVENT_ICONS = """bell-ring garage-open-variant garage-variant window-shutter window-shutter-open email
calendar-clock trash-can television television-off home-account mailbox-up door-open newspaper-variant
lightbulb-on solar-power timer-outline check-circle information""".split()

ICONS = EVENT_ICONS + """
weather-sunny weather-night weather-partly-cloudy weather-cloudy weather-rainy weather-pouring weather-snowy
weather-snowy-rainy weather-hail weather-lightning weather-lightning-rainy weather-fog weather-windy weather-sunset
weather-sunset-up weather-sunset-down sun-thermometer snowflake umbrella thermometer water cloud moon-waning-crescent
moon-full star star-outline star-four-points star-shooting creation shimmer lightning-bolt fire

leaf flower flower-tulip tree pine-tree palm-tree sprout mushroom cactus clover earth waves image-filter-hdr

cat dog paw bird fish butterfly rabbit turtle bee ladybug owl unicorn duck horse cow penguin snail jellyfish spider

home home-heart sofa bed lamp lightbulb lightbulb-on-outline door key lock lock-open garage garage-open speaker fan
radiator washing-machine fridge stove robot-vacuum shower toilet candle fireplace

coffee tea food food-apple pizza hamburger cake cake-variant cupcake ice-cream glass-wine beer glass-cocktail
glass-flute silverware-fork-knife bread-slice carrot chef-hat baguette noodles fruit-cherries fruit-watermelon
cookie candy

music music-note headphones microphone movie-open gamepad-variant book-open-variant palette brush camera run bike walk
swim yoga dumbbell soccer basketball tennis beach airplane car train bus ferry map-marker map compass tent hiking
guitar-acoustic piano meditation puzzle dice-5 chess-knight cards-playing

heart heart-outline heart-broken emoticon-outline emoticon-happy-outline emoticon-excited-outline emoticon-sad-outline
emoticon-cool-outline emoticon-wink-outline emoticon-kiss-outline emoticon-neutral-outline emoticon-cry-outline
emoticon-angry-outline emoticon-lol-outline emoticon-sick-outline emoticon-tongue-outline hand-wave thumb-up
thumb-down hands-pray account account-group baby-face-outline human-greeting human-male-female-child ghost
robot-happy alien

party-popper gift balloon firework trophy medal crown rocket-launch rocket magic-staff auto-fix

bell alarm clock-outline calendar calendar-check calendar-heart email-open message-text chat phone cellphone mailbox
send bullhorn

wifi battery battery-charging power cog tools robot laptop close-circle alert alert-circle help-circle plus minus
arrow-up arrow-down arrow-left arrow-right chevron-up chevron-down refresh magnify school briefcase cash cart shopping
piggy-bank chart-line trending-up trending-down flag pin target eye power-sleep pill medical-bag heart-pulse tooth
recycle package-variant truck-delivery

format-list-checks timer-sand checkbox-marked-circle checkbox-blank-circle-outline chip information-outline
chevron-left chevron-right gesture-tap
""".split()

# Other words for an icon -> its MDI name. German first (Muse talks German with the
# house), then the event names of muse_show_event and a few English words.
ALIASES = {
    # muse_show_event
    "klingel": "bell-ring", "garage-zu": "garage-variant", "rollladen-runter": "window-shutter",
    "rollladen-hoch": "window-shutter-open", "rolladen-runter": "window-shutter",
    "rolladen-hoch": "window-shutter-open", "mail": "email", "kalender": "calendar-clock",
    "muell": "trash-can", "tv-an": "television", "tv-aus": "television-off", "zuhause": "home-account",
    "briefkasten": "mailbox-up", "tuer": "door-open", "nachrichten": "newspaper-variant",
    "licht": "lightbulb-on", "solar": "solar-power", "timer": "timer-outline", "erledigt": "check-circle",
    "info": "information",
    # German words
    "herz": "heart", "stern": "star", "sonne": "weather-sunny", "mond": "moon-waning-crescent",
    "wolke": "cloud", "regen": "weather-rainy", "schnee": "snowflake", "blitz": "lightning-bolt",
    "feuer": "fire", "blume": "flower", "baum": "tree", "blatt": "leaf", "katze": "cat", "hund": "dog",
    "pfote": "paw", "vogel": "bird", "fisch": "fish", "schmetterling": "butterfly", "hase": "rabbit",
    "biene": "bee", "eule": "owl", "einhorn": "unicorn", "haus": "home", "bett": "bed", "lampe": "lamp",
    "schluessel": "key", "schloss": "lock", "kaffee": "coffee", "tee": "tea",
    "essen": "silverware-fork-knife", "apfel": "food-apple", "kuchen": "cake-variant", "eis": "ice-cream",
    "wein": "glass-wine", "bier": "beer", "musik": "music", "kopfhoerer": "headphones",
    "buch": "book-open-variant", "kamera": "camera", "fahrrad": "bike", "auto": "car", "zug": "train",
    "flugzeug": "airplane", "strand": "beach", "geschenk": "gift", "ballon": "balloon",
    "feuerwerk": "firework", "pokal": "trophy", "krone": "crown", "rakete": "rocket", "glocke": "bell",
    "wecker": "alarm", "uhr": "clock-outline", "telefon": "phone", "handy": "cellphone",
    "daumen-hoch": "thumb-up", "winken": "hand-wave", "lachen": "emoticon-lol-outline",
    "froh": "emoticon-happy-outline", "traurig": "emoticon-sad-outline", "geist": "ghost",
    "roboter": "robot-happy", "pille": "pill", "zahn": "tooth", "geld": "cash", "einkaufen": "cart",
    "sport": "run", "schlafen": "power-sleep", "idee": "lightbulb-on-outline", "achtung": "alert",
    "frage": "help-circle", "party": "party-popper",
    # English words
    "doorbell": "bell-ring", "sun": "weather-sunny", "moon": "moon-waning-crescent", "rain": "weather-rainy",
    "snow": "snowflake", "sparkles": "creation", "smile": "emoticon-happy-outline",
    "happy": "emoticon-happy-outline", "sad": "emoticon-sad-outline", "love": "heart", "trash": "trash-can",
    "tv": "television", "news": "newspaper-variant", "light": "lightbulb-on", "done": "check-circle",
    "ok": "check-circle", "idea": "lightbulb-on-outline", "sleep": "power-sleep",
}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="check and report, write nothing")
    args = ap.parse_args()

    if not FONT.exists():
        import urllib.request
        CACHE.mkdir(exist_ok=True)
        print(f"  fetching {FONT_URL}")
        urllib.request.urlretrieve(FONT_URL, FONT)
    cmap = TTFont(str(FONT)).getBestCmap()
    lowest: dict[str, int] = {}
    for cp, name in cmap.items():
        if name not in lowest or cp < lowest[name]:
            lowest[name] = cp

    names = sorted(set(ICONS))
    missing = [n for n in names if n not in lowest]
    bad_alias = {a: t for a, t in ALIASES.items() if t not in names}
    clash = [a for a in ALIASES if a in names]
    if missing or bad_alias or clash:
        if missing:
            print("Nicht im Font:", ", ".join(missing))
        if bad_alias:
            print("Alias zeigt auf kein Icon der Liste:", bad_alias)
        if clash:
            print("Alias heisst wie ein Icon:", clash)
        return 1
    table = [(n, lowest[n]) for n in names]
    codepoints = sorted({cp for _, cp in table})

    header = ["// muse_icons.h: generated by make_muse_icon_table.py, do not edit.",
              "// Material Design Icons 7.4.47 (Apache 2.0): the icons a Muse scene can use.",
              "// The same glyphs are compiled into m_icons and m_icons_s (muse_icon_glyphs.yaml).",
              "#pragma once", "", "#include <cstddef>", "#include <cstdint>", "", "namespace muse {", "",
              "struct IconName {", "  const char *name;", "  uint32_t cp;", "};", "",
              "// Sorted by name (strcmp) for a binary search.",
              "inline constexpr IconName ICON_NAMES[] = {"]
    header += [f'    {{"{n}", 0x{cp:X}}},' for n, cp in table]
    header += ["};", f"inline constexpr size_t ICON_COUNT = {len(table)};", "",
               "// Other words for an icon, normalised like muse_scene.h normalises input.",
               "inline constexpr IconName ICON_ALIASES[] = {"]
    header += [f'    {{"{a}", 0x{lowest[t]:X}}},' for a, t in sorted(ALIASES.items())]
    header += ["};", f"inline constexpr size_t ICON_ALIAS_COUNT = {len(ALIASES)};", "", "}  // namespace muse", ""]

    glyphs = ["# Generated by make_muse_icon_table.py, do not edit: the glyphs of muse_icons.h,",
              "# included by the fonts m_icons (46 px) and m_icons_s (24 px) in stackchan-box3.yaml."]
    glyphs += [f'- "\\U{cp:08X}"' for cp in codepoints]
    glyphs.append("")

    print(f"{len(table)} Icons, {len(codepoints)} Glyphen, {len(ALIASES)} Aliase")
    for path, text in ((HEADER, "\n".join(header)), (GLYPHS, "\n".join(glyphs))):
        old = path.read_text() if path.exists() else None
        state = "unveraendert" if old == text else ("neu" if old is None else "geaendert")
        print(f"  {path.name}: {state}")
        if not args.dry_run and old != text:
            path.write_text(text)
    if args.dry_run:
        print("(Probelauf, nichts geschrieben)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
