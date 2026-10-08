"""Tests for render_scene.py: the parser answers like the box, a PNG has the screen size, a GIF its frames.

Run from the project folder:
  uv run --python 3.14 --with pillow --with fonttools --with pytest -m pytest tools/ -q

The parser tests mirror cases of the firmware's test_muse_scene.cpp (their numbers are noted). The
rendering tests need the box's fonts (see render_scene.py) and are skipped without them.
"""

import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import render_scene as rs  # noqa: E402

SCENES = Path(__file__).resolve().parent.parent / "scenes"
HAVE_FONTS = rs.find_font_dir() is not None and rs.find_icon_font(font_dir=rs.find_font_dir()) is not None
needs_fonts = pytest.mark.skipif(not HAVE_FONTS, reason="the box's fonts are not here: " + rs.FONT_HINT)


def test_unknown_command_names_the_closest_one():  # test_muse_scene.cpp, case 6
    s = rs.parse("circel 10 10 5 red")
    assert s.errors == ["line 1: unknown command 'circel'; did you mean 'circle'?"]
    assert s.items == [] and s.skipped == 1


def test_bad_colour_keeps_the_default_and_the_rest_draws():  # case 4 and 6
    s = rs.parse("rect 0 0 10 10 #abc\nrect 0 0 10 10 rosa\nrect 0 0 10 10 red radius=4\nstar 160 120 30 gold")
    assert s.errors[0].startswith("line 2: rect: color='rosa' is no colour; use #rrggbb or a name (white, black, gray")
    assert s.errors[1].startswith("line 3: rect: unknown key 'radius'; keys: x y w h color r line opacity delay dur")
    assert len(s.errors) == 2
    assert s.items[0].color == (0xAA, 0xBB, 0xCC) and s.items[1].color == rs.INK
    assert [it.kind for it in s.items] == ["rect", "rect", "rect", "star"]


def test_missing_values_and_a_typo_in_an_icon():  # cases 5 and 6
    s = rs.parse("icon 10 10 kafee\nrect 0 0 0 10 red\ncircle 50 50 abc\ntext 10 10\nrect 1 2 3 4 5 6 7")
    assert s.errors[0] in ("line 1: icon: no icon 'kafee'; did you mean 'coffee'?",
                           "line 1: icon: no icon 'kafee'; did you mean 'kaffee'?")
    assert "line 2: rect: needs w and h above 0" in s.errors
    assert "line 3: circle: r='abc' is not a number" in s.errors
    assert "line 4: text: needs a text" in s.errors
    assert "line 5: rect: one value too many: '6'" in s.errors
    assert [it.kind for it in s.items] == ["rect"] and s.skipped == 4


def test_positional_and_named_values_mean_the_same():  # case 2
    a = rs.parse("rect 10 20 100 50 #ff0000 r=8").items[0]
    b = rs.parse("rect color=#f00 h=50 w=100 y=20 x=10 r=8").items[0]
    assert (a.x, a.y, a.w, a.h, a.color, a.radius) == (b.x, b.y, b.w, b.h, b.color, b.radius) == (10, 20, 100, 50, (255, 0, 0), 8)
    c = rs.parse("bg black; rect 0 0 10 10 red ; circle 5 5 3 blue;;")
    assert not c.errors and len(c.items) == 3


def test_frames_timing_and_seconds():  # cases 7, 8 and 9
    s = rs.parse("bg navy\nframe 300\ncircle 10 10 5 red\nframe\ncircle 20 20 5 blue\nframe end\ntext 0 0 \"immer\"")
    assert s.frames == [300, 500] and [it.frame for it in s.items] == [-1, 0, 1, -1]
    assert [s.frame_at(t) for t in (0, 299, 300, 799, 800)] == [0, 0, 1, 1, 0]
    assert rs.parse("seconds 2min").seconds == 120 and rs.parse("seconds 1").seconds == 3
    t = rs.parse("rect 0 0 10 10 red delay=1000 dur=2000 fade=500").items[0]
    assert not rs.visible(t, 999, -1) and rs.visible(t, 1000, -1) and not rs.visible(t, 3000, -1)
    assert rs.alpha(t, 1000) == 0 and abs(rs.alpha(t, 1250) - 0.5) < 0.01 and abs(rs.alpha(t, 2750) - 0.5) < 0.01
    typed = rs.parse('text 0 0 "abc" type=100').items[0]
    assert rs.typed(typed, 0) == 1 and rs.typed(typed, 250) == 3


def test_the_example_scenes_parse_without_a_message():
    files = sorted(SCENES.glob("*.txt"))
    assert files, "no scenes found"
    for f in files:
        assert rs.parse(f.read_text(encoding="utf-8")).errors == [], f.name


@needs_fonts
def test_png_has_the_size_of_the_screen(tmp_path):
    fonts = rs.Fonts()
    scene = rs.parse((SCENES / "welcome.txt").read_text(encoding="utf-8"))
    clock = rs.dt.datetime(2026, 10, 7, 21, 30)
    rs.render_png(scene, tmp_path / "a.png", 2000, clock, fonts)
    rs.render_png(scene, tmp_path / "b.png", 2000, clock, fonts, scale=2)
    with Image.open(tmp_path / "a.png") as a, Image.open(tmp_path / "b.png") as b:
        assert a.size == (320, 240) and b.size == (640, 480)
        assert a.getpixel((2, 2)) == (0xFD, 0xE2, 0xE4), "the top row shows the first gradient colour"


@needs_fonts
def test_gif_has_one_frame_per_tick(tmp_path):
    # party.txt changes every tick (confetti), so no frame is merged into the one before it
    fonts = rs.Fonts()
    scene = rs.parse((SCENES / "party.txt").read_text(encoding="utf-8"))
    n = rs.render_gif(scene, tmp_path / "a.gif", 2, 5, rs.dt.datetime(2026, 10, 7, 21, 30), fonts)
    with Image.open(tmp_path / "a.gif") as im:
        assert n == 10 and im.n_frames == 10 and im.size == (320, 240)
        total = 0
        for i in range(im.n_frames):
            im.seek(i)
            total += im.info["duration"]
        assert total == 2000, "the frames add up to the length asked for"


@needs_fonts
def test_gif_merges_frames_that_hold_still(tmp_path):
    # wink.txt holds still between its two faces, so the file has fewer frames, with the time added up
    fonts = rs.Fonts()
    scene = rs.parse((SCENES / "wink.txt").read_text(encoding="utf-8"))
    rs.render_gif(scene, tmp_path / "a.gif", 2, 5, rs.dt.datetime(2026, 10, 7, 21, 30), fonts)
    with Image.open(tmp_path / "a.gif") as im:
        assert 1 < im.n_frames < 10
        total = 0
        for i in range(im.n_frames):
            im.seek(i)
            total += im.info["duration"]
        assert total == 2000
