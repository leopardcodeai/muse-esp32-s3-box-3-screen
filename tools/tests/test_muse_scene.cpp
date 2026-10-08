// test_muse_scene.cpp: host test for muse_scene.h, the scene language of muse_draw.
//
// Build and run on the Mac (the sanitizers catch memory errors before the box does):
//   c++ -std=c++17 -Wall -Wextra -g -fsanitize=address,undefined test_muse_scene.cpp \
//       -o /tmp/test_muse_scene && /tmp/test_muse_scene
//
// What it checks: every command and key parses, positional and named values mean the
// same, mistakes become messages instead of crashes (with a suggestion where one is
// close), frames and timing behave, under() finds the colour below a point, and
// thousands of random scenes neither crash nor exceed the limits.
#include <cstdio>
#include <cstdlib>
#include <string>

#include "../../firmware/muse_scene.h"

using namespace muse::scene;

static int failures = 0;
#define CHECK(cond, ...)                                  \
  do {                                                    \
    if (!(cond)) {                                        \
      failures++;                                         \
      std::printf("FAIL line %d: %s | ", __LINE__, #cond); \
      std::printf(__VA_ARGS__);                           \
      std::printf("\n");                                  \
    }                                                     \
  } while (0)

static std::string errs(const Scene &s) {
  std::string out;
  for (const auto &e : s.errors) out += "[" + e + "] ";
  return out;
}

static bool has_error(const Scene &s, const std::string &part) {
  for (const auto &e : s.errors)
    if (e.find(part) != std::string::npos) return true;
  return false;
}

static bool same(Rgb a, Rgb b) { return a == b; }

int main() {
  // 1. The example from the header parses without a message.
  {
    Scene s = parse(
        "bg #0b1d3a #3a1c5c\n"
        "circle 252 58 26 #ffd166 pulse=3000\n"
        "text 20 70 \"Gute Nacht, Sam\" size=xl color=white\n"
        "icon 40 190 weather-night color=#c9d6ff\n"
        "particles sparkle 30\n"
        "seconds 60\n");
    CHECK(s.errors.empty(), "%s", errs(s).c_str());
    CHECK(s.items.size() == 5, "items %zu", s.items.size());
    CHECK(s.seconds == 60, "seconds %u", s.seconds);
    CHECK(s.items[0].kind == BG && s.items[0].gradient, "bg gradient");
    CHECK(same(s.items[0].color, Rgb{0x0b, 0x1d, 0x3a}) && same(s.items[0].color2, Rgb{0x3a, 0x1c, 0x5c}), "bg colours");
    CHECK(s.items[1].kind == CIRCLE && s.items[1].x == 252 && s.items[1].r == 26 && s.items[1].pulse == 3000, "circle");
    CHECK(s.items[2].kind == TEXT && s.items[2].text == "Gute Nacht, Sam" && s.items[2].size == 4, "text");
    CHECK(same(s.items[2].color, Rgb{255, 255, 255}), "white");
    CHECK(s.items[3].kind == ICON && s.items[3].glyph == 0xF0594, "icon weather-night %X", s.items[3].glyph);
    CHECK(s.items[4].kind == PARTICLES && s.items[4].sub == P_SPARKLE && s.items[4].count == 30, "particles");
    CHECK(s.items[4].w == 320 && s.items[4].h == 240 && s.items[4].size == 0, "particle area and size");
  }

  // 2. Positional and named values mean the same; ";" separates commands.
  {
    Scene a = parse("rect 10 20 100 50 #ff0000 r=8");
    Scene b = parse("rect color=#f00 h=50 w=100 y=20 x=10 r=8");
    CHECK(a.errors.empty() && b.errors.empty(), "%s %s", errs(a).c_str(), errs(b).c_str());
    CHECK(a.items.size() == 1 && b.items.size() == 1, "one each");
    const Item &x = a.items[0], &y = b.items[0];
    CHECK(x.x == y.x && x.y == y.y && x.w == y.w && x.h == y.h && same(x.color, y.color) && x.radius == y.radius,
          "rect same");
    Scene c = parse("bg black; rect 0 0 10 10 red ; circle 5 5 3 blue;;");
    CHECK(c.errors.empty() && c.items.size() == 3, "%zu %s", c.items.size(), errs(c).c_str());
  }

  // 3. Quotes, escapes, comments, ";" inside quotes, unquoted text.
  {
    Scene s = parse(
        "# a comment\n"
        "// another one\n"
        "text 10 10 \"Eins; zwei\" size=m\n"
        "text 10 40 'Geht\\'s gut?' color=red\n"
        "text 10 70 Hallo Welt, wie geht's? size=l\n"
        "text x=10 y=100 text=\"Zeile 1\\nZeile 2\"\n");
    CHECK(s.errors.empty(), "%s", errs(s).c_str());
    CHECK(s.items.size() == 4, "items %zu", s.items.size());
    if (s.items.size() == 4) {
      CHECK(s.items[0].text == "Eins; zwei" && s.items[0].size == 2, "semicolon in quotes: '%s'", s.items[0].text.c_str());
      CHECK(s.items[1].text == "Geht's gut?", "escaped quote: '%s'", s.items[1].text.c_str());
      CHECK(s.items[2].text == "Hallo Welt, wie geht's?" && s.items[2].size == 3, "joined: '%s'", s.items[2].text.c_str());
      CHECK(s.items[3].text == "Zeile 1\nZeile 2", "newline escape");
    }
    // A comment runs to the end of its line, ";" included (found with the example scenes),
    // also after a command; "#f00" stays a colour and "#" inside quotes stays text.
    Scene comments = parse("# a; b\nrect 0 0 5 5 #f00; // c; d\n  # e;f\ncircle 1 1 1 red # the sun; really\n"
                           "text 0 0 \"# not a comment\" // but this is\n#fff");
    CHECK(comments.errors.empty() && comments.items.size() == 3, "comments: %zu %s", comments.items.size(),
          errs(comments).c_str());
    if (comments.items.size() == 3) {
      CHECK(same(comments.items[0].color, Rgb{255, 0, 0}), "colour after a comment rule");
      CHECK(comments.items[2].text == "# not a comment", "hash in quotes: '%s'", comments.items[2].text.c_str());
    }
    Scene open = parse("text 10 10 \"nicht zu\ncircle 50 50 10 red");
    CHECK(open.items.size() == 2 && has_error(open, "quote is not closed"), "open quote ends at line end: %zu %s",
          open.items.size(), errs(open).c_str());
  }

  // 4. Colours: #rgb, #rrggbb, alpha, names, mistakes.
  {
    Scene s = parse("rect 0 0 10 10 #abc\nrect 0 0 10 10 #11223380\nrect 0 0 10 10 teal opacity=0.25\n"
                    "rect 0 0 10 10 #ffffff80 opacity=90\nrect 0 0 10 10 rosa");
    CHECK(s.items.size() == 5, "items %zu", s.items.size());
    CHECK(same(s.items[0].color, Rgb{0xaa, 0xbb, 0xcc}), "#abc");
    CHECK(same(s.items[1].color, Rgb{0x11, 0x22, 0x33}) && fabsf(s.items[1].opacity - 128 / 255.0f) < 0.01f, "alpha");
    CHECK(same(s.items[2].color, Rgb{48, 176, 199}) && s.items[2].opacity == 0.25f, "named + opacity");
    CHECK(fabsf(s.items[3].opacity - 0.9f) < 0.001f, "opacity percent wins over alpha: %f", s.items[3].opacity);
    CHECK(has_error(s, "'rosa' is no colour"), "%s", errs(s).c_str());
    CHECK(same(s.items[4].color, INK), "bad colour keeps the default");
  }

  // 5. Icons: MDI names, prefixes, case, aliases, umlauts, suggestions.
  {
    CHECK(icon_codepoint("coffee") == 0xF0176, "coffee");
    CHECK(icon_codepoint("mdi:coffee") == 0xF0176, "mdi:coffee");
    CHECK(icon_codepoint(" Coffee ") == 0xF0176, "case");
    CHECK(icon_codepoint("kaffee") == 0xF0176, "alias");
    CHECK(icon_codepoint("Schlüssel") == icon_codepoint("key") && icon_codepoint("key") != 0, "umlaut alias");
    CHECK(icon_codepoint("rollladen_runter") == 0xF111C, "event alias with underscore");
    CHECK(icon_codepoint("klingel") == 0xF009E, "klingel");
    CHECK(icon_codepoint("weather_sunny") == icon_codepoint("weather-sunny"), "underscore");
    CHECK(icon_codepoint("kafee") == 0, "typo is no icon");
    for (size_t i = 1; i < muse::ICON_COUNT; i++)
      CHECK(strcmp(muse::ICON_NAMES[i - 1].name, muse::ICON_NAMES[i].name) < 0, "sorted at %zu", i);
    for (size_t i = 0; i < muse::ICON_COUNT; i++)
      CHECK(icon_codepoint(muse::ICON_NAMES[i].name) == muse::ICON_NAMES[i].cp, "find %s", muse::ICON_NAMES[i].name);
    Scene s = parse("icon 10 10 kafee\nicon 10 10 sunny\nicon 10 10 zzzzzzzz");
    CHECK(s.items.empty() && s.skipped == 3, "unknown icons are skipped: %zu", s.items.size());
    CHECK(has_error(s, "did you mean 'coffee'") || has_error(s, "did you mean 'kaffee'"), "typo suggestion: %s",
          errs(s).c_str());
    CHECK(has_error(s, "did you mean 'weather-sunny'"), "part suggestion: %s", errs(s).c_str());
    CHECK(has_error(s, "no icon 'zzzzzzzz'") && !has_error(s, "'zzzzzzzz'; did"), "no wild guess");
  }

  // 6. Mistakes become messages; the rest still draws.
  {
    Scene s = parse("circel 10 10 5 red\nrect 0 0 10 10 red radius=4\nrect 0 0 0 10 red\ncircle 10 10\n"
                    "line 0 0 10\ntri 0 0 10 10\ntext 10 10\nrect 1 2 3 4 5 6 7\ncircle 50 50 abc\n"
                    "text 10 10 \"ok\" size=riesig align=mitte\nstar 160 120 30 gold");
    CHECK(has_error(s, "unknown command 'circel'; did you mean 'circle'"), "%s", errs(s).c_str());
    Scene german = parse("hintergrund navy\nkreis 10 10 5 red\nsymbol 20 20 herz\nsekunden 40");
    CHECK(german.errors.empty() && german.items.size() == 3 && german.seconds == 40, "German words: %s",
          errs(german).c_str());
    CHECK(has_error(s, "unknown key 'radius'"), "unknown key");
    CHECK(has_error(s, "rect: needs w and h above 0"), "rect size");
    CHECK(has_error(s, "circle: needs r above 0"), "circle r");
    CHECK(has_error(s, "line: needs x2 and y2"), "line");
    CHECK(has_error(s, "tri: needs three points"), "tri");
    CHECK(has_error(s, "text: needs a text"), "text");
    CHECK(has_error(s, "one value too many"), "too many");
    CHECK(has_error(s, "r='abc' is not a number"), "number");
    CHECK(s.errors.size() == MAX_ERRORS && has_error(s, "more)"), "errors capped at %zu: %zu", MAX_ERRORS,
          s.errors.size());
    bool star = false;
    for (const auto &it : s.items) star |= it.kind == STAR;
    CHECK(star, "the good line still draws");
  }

  // 7. Frames, "once", "frame end", timing of frames.
  {
    Scene s = parse("bg navy\nframe 300\ncircle 10 10 5 red\nframe\ncircle 20 20 5 blue\nframe end\ntext 0 0 \"immer\"");
    CHECK(s.errors.empty(), "%s", errs(s).c_str());
    CHECK(s.frames.size() == 2 && s.frames[0] == 300 && s.frames[1] == 500, "frames");
    CHECK(s.items[0].frame == -1 && s.items[1].frame == 0 && s.items[2].frame == 1 && s.items[3].frame == -1,
          "frame of items");
    CHECK(s.frame_at(0) == 0 && s.frame_at(299) == 0 && s.frame_at(300) == 1 && s.frame_at(799) == 1 &&
              s.frame_at(800) == 0,
          "loop");
    CHECK(visible(s.items[1], 100, 0) && !visible(s.items[1], 100, 1) && visible(s.items[3], 100, 1), "visible");
    Scene once = parse("once\nframe 100\nframe 100");
    CHECK(once.once && once.frame_at(150) == 1 && once.frame_at(5000) == 1, "once holds the last frame");
    Scene none = parse("rect 0 0 5 5 red");
    CHECK(none.frame_at(1234) == -1 && visible(none.items[0], 1234, -1), "no frames");
    std::string many;
    for (int i = 0; i < 30; i++) many += "frame 100\n";
    Scene capped = parse(many);
    CHECK(capped.frames.size() == MAX_FRAMES && has_error(capped, "more than 24 frames"), "frames capped");
  }

  // 8. Seconds: plain, with unit, minutes, clamped, "seconds=30".
  {
    CHECK(parse("seconds 45").seconds == 45, "45");
    CHECK(parse("seconds 30s").seconds == 30, "30s");
    CHECK(parse("seconds 2min").seconds == 120, "2min");
    CHECK(parse("seconds 1").seconds == 3, "min 3");
    CHECK(parse("seconds 99999").seconds == 3600, "max 3600");
    CHECK(parse("seconds=30").seconds == 30, "seconds=30");
    CHECK(parse("").seconds == 20, "default 20");
    Scene bad = parse("seconds lange");
    CHECK(bad.seconds == 20 && has_error(bad, "is not a number"), "bad seconds");
  }

  // 9. Element timing: delay, dur, blink, fade, move, spin, pulse, type.
  {
    Scene s = parse("rect 0 0 10 10 red delay=1000 dur=2000 fade=500\nrect 0 0 10 10 red blink=250\n"
                    "circle 50 50 10 red move=20,-10 period=1000 pulse=400\nstar 1 1 5 red spin=2000 rot=10\n"
                    "text 0 0 \"abc\" type=100");
    CHECK(s.errors.empty(), "%s", errs(s).c_str());
    const Item &a = s.items[0];
    CHECK(!visible(a, 999, -1) && visible(a, 1000, -1) && visible(a, 2999, -1) && !visible(a, 3000, -1), "delay dur");
    CHECK(alpha(a, 1000) == 0.0f && fabsf(alpha(a, 1250) - 0.5f) < 0.01f && alpha(a, 2000) == 1.0f, "fade in");
    CHECK(fabsf(alpha(a, 2750) - 0.5f) < 0.01f, "fade out: %f", alpha(a, 2750));
    const Item &b = s.items[1];
    CHECK(visible(b, 0, -1) && !visible(b, 250, -1) && visible(b, 500, -1), "blink");
    float dx, dy;
    offset(s.items[2], 0, &dx, &dy);
    CHECK(dx == 0 && dy == 0, "move start");
    offset(s.items[2], 500, &dx, &dy);
    CHECK(fabsf(dx - 20) < 0.01f && fabsf(dy + 10) < 0.01f, "move half way: %f %f", dx, dy);
    CHECK(fabsf(scale(s.items[2], 100) - 1.12f) < 0.001f, "pulse peak");
    CHECK(fabsf(angle(s.items[3], 500) - 100) < 0.01f, "spin: %f", angle(s.items[3], 500));
    CHECK(typed(s.items[4], 0) == 1 && typed(s.items[4], 250) == 3, "type");
    CHECK(typed(s.items[0], 0) == SIZE_MAX, "not typed");
  }

  // 10. under(): background gradient, shapes, translucency, frames and time.
  {
    Scene s = parse("bg #000000 #ffffff\nrect 100 100 50 50 red\nrect 100 100 50 50 #0000ff opacity=0.5\n"
                    "circle 20 20 10 green\nframe 100\nrect 0 0 320 240 yellow\nframe end\n"
                    "rect 200 0 10 10 white delay=1000");
    CHECK(s.errors.empty(), "%s", errs(s).c_str());
    const size_t n = 4;  // below the framed rect
    CHECK(same(under(s, n, 5, 0, 0, 0), Rgb{0, 0, 0}), "gradient top");
    CHECK(same(under(s, n, 5, 239, 0, 0), Rgb{255, 255, 255}), "gradient bottom");
    const Rgb half = under(s, n, 5, 119.5f, 0, 0);
    CHECK(half.r > 120 && half.r < 135, "gradient middle %d", half.r);
    CHECK(same(under(s, 2, 120, 120, 0, 0), Rgb{255, 59, 48}), "red rect");
    const Rgb purple = under(s, 3, 120, 120, 0, 0);
    // red (255, 59, 48) half covered by blue (0, 0, 255): 127.5, 29.5, 151.5, rounded
    CHECK(purple.r == 128 && purple.g == 30 && purple.b == 152, "half blue over red: %d %d %d", purple.r, purple.g,
          purple.b);
    CHECK(same(under(s, n, 20, 20, 0, 0), Rgb{52, 199, 89}), "circle");
    CHECK(same(under(s, s.items.size(), 20, 20, 0, 0), Rgb{255, 204, 0}), "frame 0 rect covers all");
    CHECK(same(under(s, s.items.size(), 20, 20, 0, -1), Rgb{52, 199, 89}), "other frame ignored");
    CHECK(!same(under(s, s.items.size(), 205, 5, 0, -1), Rgb{255, 255, 255}), "before its delay");
    CHECK(same(under(s, s.items.size(), 205, 5, 1000, -1), Rgb{255, 255, 255}), "after its delay");
    // Two different translucent layers: the order matters. Red over black, then blue on top:
    // (128, 30, 24) after the first, (64, 15, 140) after the second; the other way round
    // it would be (128, 30, 88).
    Scene two = parse("bg black\nrect 0 0 50 50 red opacity=0.5\nrect 0 0 50 50 #0000ff opacity=0.5");
    const Rgb o = under(two, two.items.size(), 10, 10, 0, -1);
    CHECK(o.r == 64 && o.g == 15 && o.b == 140, "layer order: %d %d %d", o.r, o.g, o.b);
    Scene empty = parse("");
    CHECK(same(under(empty, 0, 10, 10, 0, -1), PAGE), "page by default");
    std::string stack = "bg black\n";
    for (int i = 0; i < 240; i++) stack += "rect 0 0 320 240 white opacity=0.1\n";
    Scene deep = parse(stack);
    const Rgb top = under(deep, deep.items.size(), 10, 10, 0, -1);
    CHECK(top.r > 200, "240 translucent layers, no deep recursion: %d", top.r);
  }

  // 11. Limits: elements, source size.
  {
    std::string big;
    for (int i = 0; i < 300; i++) big += "rect 0 0 5 5 red\n";
    Scene s = parse(big);
    CHECK(s.items.size() == MAX_ITEMS && has_error(s, "more than 250 elements"), "items capped: %zu", s.items.size());
    std::string huge(MAX_SOURCE + 500, 'x');
    Scene h = parse(huge);
    CHECK(has_error(h, "only the first 16384 are read"), "%s", errs(h).c_str());
    std::string longtext = "text 0 0 \"" + std::string(2000, 'a') + "\"";
    Scene t = parse(longtext);
    CHECK(t.items.size() == 1 && t.items[0].text.size() == MAX_TEXT, "text capped");
  }

  // 12. Defaults and the other commands.
  {
    Scene s = parse("bg\nmuse\navatar 40 40\nmuse 100 120 wave r=60\nbar 20 200 280 12 65%\n"
                    "bar 20 220 280 12 30 #ff9500 bg=#333333 r=pill\npoly 160 120 40 6 purple rot=30\n"
                    "line 0 0 320 240 white w=3\ntri 0 0 10 0 5 8 pink line=2\nparticles snow count=80 color=white\n"
                    "particles confetti icon=heart size=l speed=2\ntext 160 120 Mitte align=center valign=middle w=200 "
                    "lines=2 lh=30\nicon 50 50 heart size=s\nicon 50 50 heart size=40");
    CHECK(s.errors.empty(), "%s", errs(s).c_str());
    CHECK(s.items.size() == 14, "items %zu", s.items.size());
    if (s.items.size() == 14) {
      CHECK(same(s.items[0].color, PAGE), "bg default");
      CHECK(s.items[1].x == 160 && s.items[1].y == 110 && s.items[1].r == 80 && s.items[1].sub == F_IDLE, "muse");
      CHECK(s.items[2].sub == F_AVATAR, "avatar");
      CHECK(s.items[3].sub == F_WAVE && s.items[3].r == 60, "wave");
      CHECK(s.items[4].value == 65 && same(s.items[4].color, Rgb{52, 199, 89}) &&
                same(s.items[4].color2, Rgb{209, 209, 214}),
            "bar defaults");
      CHECK(s.items[5].radius == -1 && same(s.items[5].color2, Rgb{0x33, 0x33, 0x33}), "bar pill track");
      CHECK(s.items[6].points == 6 && s.items[6].rot == 30, "poly");
      CHECK(s.items[7].stroke == 3, "line width");
      CHECK(s.items[8].stroke == 2, "tri outline");
      CHECK(s.items[9].sub == P_SNOW && s.items[9].count == 80 && s.items[9].has_color, "snow");
      CHECK(s.items[10].glyph == icon_codepoint("heart") && s.items[10].size == 1 && s.items[10].speed == 2, "icons");
      CHECK(s.items[11].align == 1 && s.items[11].valign == 1 && s.items[11].wrap == 200 && s.items[11].max_lines == 2 &&
                s.items[11].line_h == 30,
            "text layout");
      CHECK(s.items[12].size == 0 && s.items[13].size == 1, "icon sizes");
    }
    Scene sizes = parse("text 0 0 a size=xs\ntext 0 0 a size=xxl\ntext 0 0 a size=30\ntext 0 0 a size=19");
    CHECK(sizes.items[0].size == 0 && sizes.items[1].size == 5 && sizes.items[2].size == 3 && sizes.items[3].size == 2,
          "text sizes");
  }

  // 13. Buttons: positional and named, defaults, hit test, mistakes.
  {
    Scene s = parse("bg page\nbutton 20 160 130 50 \"Ja, gern\" green\nbutton x=170 y=160 w=130 h=50 text=Nein\n"
                    "button 10 10 0 10 Leer\nbutton 10 10 50 20\nknopf 10 100 100 30 Deutsch size=s r=6 delay=5000");
    CHECK(s.items.size() == 4, "items %zu %s", s.items.size(), errs(s).c_str());
    CHECK(has_error(s, "button: needs w and h above 0") && has_error(s, "button: needs a text"), "%s", errs(s).c_str());
    if (s.items.size() == 4) {
      CHECK(s.items[1].kind == BUTTON && s.items[1].text == "Ja, gern" && same(s.items[1].color, Rgb{52, 199, 89}) &&
                s.items[1].radius == -1 && s.items[1].size == 2,
            "button 1");
      CHECK(s.items[2].text == "Nein" && same(s.items[2].color, Rgb{0, 122, 255}), "button defaults");
      CHECK(s.items[3].text == "Deutsch" && s.items[3].size == 1 && s.items[3].radius == 6, "German word, size, r");
    }
    CHECK(button_at(s, 25, 165, 0, -1) == 1, "hit the first: %d", button_at(s, 25, 165, 0, -1));
    CHECK(button_at(s, 299, 209, 0, -1) == 2, "hit the second at its far corner");
    CHECK(button_at(s, 300, 160, 0, -1) == -1, "just outside");
    CHECK(button_at(s, 50, 110, 1000, -1) == -1 && button_at(s, 50, 110, 6000, -1) == 3, "delay counts");
  }

  // 14. Random scenes: no crash, limits hold. Built from pieces of real commands.
  {
    std::srand(11);
    const char *pieces[] = {"bg", "rect", "circle", "text", "icon", "star", "frame", "once", "seconds", "particles",
                            "muse", "bar", "line", "tri", "poly", "10", "-5", "300", "1e9", "nan", "#fff", "#12",
                            "red", "\"", "'", "\\", ";", "\n", " ", "=", "x=", "color=", "move=1,2", "move=,",
                            "size=xl", "heart", "mdi:", "button", "knopf", "ä", "\xC3", "\xF0\x9F\x98\x80", "opacity=2", "delay=-1",
                            "r=pill", "frame end", "#", "//", "type=0", "period=0", "spin=1"};
    const int n_pieces = sizeof(pieces) / sizeof(pieces[0]);
    for (int round = 0; round < 3000; round++) {
      std::string src;
      const int len = std::rand() % 120;
      for (int k = 0; k < len; k++) {
        src += pieces[std::rand() % n_pieces];
        if (std::rand() % 3) src += ' ';
      }
      Scene s = parse(src);
      CHECK(s.items.size() <= MAX_ITEMS && s.frames.size() <= MAX_FRAMES && s.errors.size() <= MAX_ERRORS,
            "round %d limits", round);
      for (const auto &it : s.items) {
        CHECK(it.opacity >= 0.0f && it.opacity <= 1.0f, "round %d opacity %f", round, it.opacity);
        CHECK(it.count >= 1 && it.count <= MAX_PARTICLES, "round %d count", round);
        CHECK(it.period >= 100, "round %d period %u", round, it.period);
        (void) under(s, s.items.size(), it.x, it.y, 1234, s.frame_at(1234));
        (void) alpha(it, 777);
      }
      CHECK(s.seconds >= 3 && s.seconds <= 3600, "round %d seconds", round);
    }
  }

  if (failures == 0) std::printf("OK: all checks passed\n");
  else std::printf("%d check(s) failed\n", failures);
  return failures == 0 ? 0 : 1;
}
