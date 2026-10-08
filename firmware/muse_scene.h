// muse_scene.h: the scene language of muse_draw, parsed into elements.
//
// Muse describes a picture in lines of text; the box parses it once and draws it on
// every refresh (draw_scene in muse.h). For example:
//
//   bg #0b1d3a #3a1c5c
//   circle 252 58 26 #ffd166 pulse=3000
//   text 20 70 "Gute Nacht, Sam" size=xl color=white
//   icon 40 190 weather-night color=#c9d6ff
//   particles sparkle 30
//   seconds 60
//
// One command per line (or separated by ";"), then its values: in the order of the
// command (positional) or as key=value, "quoted" when they hold spaces. The README
// lists every command and key. No ESPHome includes on purpose: test_muse_scene.cpp
// compiles this file on the Mac and tests it without a box.
//
// Pitfalls:
//  * Muse is forgiven wherever possible: an unknown key, colour or icon becomes a
//    message in Scene::errors and the rest still draws. The messages go back to Muse
//    as the response of the action, so it can correct its next scene by itself.
//  * A quote that is not closed ends at the end of its line, never later: otherwise one
//    missing quote would swallow the rest of the scene.
//  * Limits keep a scene inside the box's memory and inside the 100 ms refresh:
//    16 KB of source, 250 elements, 24 frames, 150 particles per particles element.
#pragma once

#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "muse_icons.h"

namespace muse {
namespace scene {

constexpr size_t MAX_SOURCE = 16384;
constexpr size_t MAX_ITEMS = 250;
constexpr size_t MAX_FRAMES = 24;
constexpr size_t MAX_TEXT = 500;
constexpr int MAX_PARTICLES = 150;
constexpr size_t MAX_ERRORS = 12;

struct Rgb {
  uint8_t r = 0, g = 0, b = 0;
  bool operator==(const Rgb &o) const { return r == o.r && g == o.g && b == o.b; }
  bool operator!=(const Rgb &o) const { return !(*this == o); }
};

constexpr Rgb PAGE{243, 243, 243};  // the page colour of the Muse screens
constexpr Rgb INK{28, 28, 30};

inline Rgb mix(Rgb fg, Rgb bg, float a) {
  if (a >= 1.0f) return fg;
  if (a <= 0.0f) return bg;
  return Rgb{(uint8_t) lroundf(bg.r + (fg.r - bg.r) * a), (uint8_t) lroundf(bg.g + (fg.g - bg.g) * a),
             (uint8_t) lroundf(bg.b + (fg.b - bg.b) * a)};
}

enum Kind : uint8_t { BG, RECT, CIRCLE, LINE, TRI, STAR, POLY, TEXT, ICON, FIGURE, BAR, PARTICLES, BUTTON };

// Pixel sizes of the six text fonts (xs .. xxl) and the two icon fonts (s, l).
constexpr int TEXT_PX[] = {13, 16, 20, 24, 36, 54};
constexpr int ICON_PX[] = {24, 46};

enum ParticleKind : uint8_t { P_CONFETTI, P_SNOW, P_RAIN, P_SPARKLE, P_BUBBLES };
enum FigureKind : uint8_t { F_IDLE, F_WAVE, F_WORKING, F_MAKING, F_AVATAR };

struct Item {
  Kind kind = RECT;
  int line = 0;    // line of the source, for messages
  int frame = -1;  // -1: every frame
  float x = NAN, y = NAN, w = NAN, h = NAN, r = NAN;
  float x2 = NAN, y2 = NAN, x3 = NAN, y3 = NAN;
  Rgb color = INK;
  Rgb color2 = PAGE;        // bg: second colour of the gradient; bar: the track
  bool gradient = false;    // bg: a second colour was given
  bool horizontal = false;  // bg: the gradient runs left to right
  bool has_color = false;   // a colour was given (particles: one colour instead of the palette)
  bool has_color2 = false;  // bar: a track colour was given
  bool has_size = false;
  float opacity = 1.0f;
  int stroke = 0;       // outline width in px; 0 fills
  int radius = 0;       // rect corners; -1 makes a pill
  int points = 5;       // star points, polygon sides
  float inner = 0.45f;  // star: inner radius as a share of r
  float rot = 0;        // degrees, clockwise
  float value = 0;      // bar: 0 .. 100
  int size = 1;         // text: index into TEXT_PX; icon: index into ICON_PX
  int align = 0;        // 0 left, 1 centre, 2 right
  int valign = 0;       // 0 top, 1 middle, 2 bottom
  int wrap = 0;         // text: wrap width in px, 0 keeps one line
  int max_lines = 0;    // text: 0 = as many as needed
  int line_h = 0;       // text: 0 = from the font
  int count = 40;       // particles
  float speed = 1.0f;   // particles
  int sub = 0;          // particles: ParticleKind; figure: FigureKind
  uint32_t glyph = 0;   // icon, or particles drawn as an icon
  std::string text;     // text
  uint32_t delay = 0, dur = 0, blink = 0, fade = 0, type = 0;
  float move_x = 0, move_y = 0;
  uint32_t period = 3000, spin = 0, pulse = 0;
};

struct Scene {
  std::vector<Item> items;
  std::vector<uint32_t> frames;  // length of each frame in ms; empty: no frames
  bool once = false;             // frames play once and hold the last one
  uint32_t seconds = 20;
  std::vector<std::string> errors;
  size_t skipped = 0;  // elements left out because of an error

  uint32_t cycle() const {
    uint32_t t = 0;
    for (uint32_t f : frames) t += f;
    return t;
  }
  // The frame shown t ms after the start; -1 when the scene has no frames.
  int frame_at(uint32_t t) const {
    if (frames.empty()) return -1;
    const uint32_t c = cycle();
    if (c == 0) return 0;
    if (once && t >= c) return (int) frames.size() - 1;
    t %= c;
    for (size_t i = 0; i < frames.size(); i++) {
      if (t < frames[i]) return (int) i;
      t -= frames[i];
    }
    return (int) frames.size() - 1;
  }
};

// ------------------------------------------------------------------ time --

// Whether an element is on screen t ms after the scene started, in frame `frame`.
inline bool visible(const Item &it, uint32_t t, int frame) {
  if (it.frame >= 0 && it.frame != frame) return false;
  if (t < it.delay) return false;
  const uint32_t local = t - it.delay;
  if (it.dur > 0 && local >= it.dur) return false;
  if (it.blink > 0 && (local / it.blink) % 2 == 1) return false;
  return true;
}

// Opacity at t: fades in over `fade` ms after its delay, and out again over the last
// `fade` ms of its duration.
inline float alpha(const Item &it, uint32_t t) {
  float a = it.opacity;
  if (it.fade > 0) {
    const uint32_t local = t > it.delay ? t - it.delay : 0;
    if (local < it.fade) a *= (float) local / (float) it.fade;
    if (it.dur > 0 && local < it.dur && it.dur - local < it.fade) a *= (float) (it.dur - local) / (float) it.fade;
  }
  return a < 0.0f ? 0.0f : a > 1.0f ? 1.0f : a;
}

// Offset of a moving element: there and back once per period, eased.
inline void offset(const Item &it, uint32_t t, float *dx, float *dy) {
  *dx = 0;
  *dy = 0;
  if ((it.move_x == 0 && it.move_y == 0) || it.period == 0) return;
  const uint32_t local = t > it.delay ? t - it.delay : 0;
  const float phase = (float) (local % it.period) / (float) it.period;
  const float s = (1.0f - cosf(6.2831853f * phase)) * 0.5f;
  *dx = it.move_x * s;
  *dy = it.move_y * s;
}

// Rotation in degrees at t (star, polygon).
inline float angle(const Item &it, uint32_t t) {
  if (it.spin == 0) return it.rot;
  const uint32_t local = t > it.delay ? t - it.delay : 0;
  return it.rot + 360.0f * (float) (local % it.spin) / (float) it.spin;
}

// Size factor of a pulsing circle, star or polygon: 0.88 .. 1.12.
inline float scale(const Item &it, uint32_t t) {
  if (it.pulse == 0) return 1.0f;
  const uint32_t local = t > it.delay ? t - it.delay : 0;
  return 1.0f + 0.12f * sinf(6.2831853f * (float) (local % it.pulse) / (float) it.pulse);
}

// How many characters of a typed text are out at t; SIZE_MAX when it is not typed.
inline size_t typed(const Item &it, uint32_t t) {
  if (it.type == 0) return SIZE_MAX;
  const uint32_t local = t > it.delay ? t - it.delay : 0;
  return (size_t) (local / it.type) + 1;
}

inline Rgb bg_at(const Item &bg, float px, float py) {
  if (!bg.gradient) return bg.color;
  float f = bg.horizontal ? px / 319.0f : py / 239.0f;
  return mix(bg.color2, bg.color, f < 0.0f ? 0.0f : f > 1.0f ? 1.0f : f);
}

// The colour of the scene at (px, py) below element `before` at t: the topmost filled
// rectangle, circle or bar that covers the point, else the background. The renderer
// blends soft edges and translucent elements against it. Translucent layers are
// collected on the way down and laid on top again on the way up; a loop, not a
// recursion, because 250 stacked layers would overflow the box's loop stack.
inline Rgb under(const Scene &s, size_t before, float px, float py, uint32_t t, int frame) {
  constexpr int LAYERS = 16;
  Rgb layer_c[LAYERS];
  float layer_a[LAYERS];
  int n = 0;
  Rgb base = PAGE;
  for (size_t k = before; k-- > 0;) {
    const Item &it = s.items[k];
    if (!visible(it, t, frame)) continue;
    if (it.kind == BG) {
      base = bg_at(it, px, py);
      break;
    }
    const float a = alpha(it, t);
    if (a <= 0.0f) continue;
    float dx, dy;
    offset(it, t, &dx, &dy);
    const float x = it.x + dx, y = it.y + dy;
    Rgb c;
    bool hit = false;
    if (it.kind == RECT && it.stroke == 0) {
      hit = px >= x && px < x + it.w && py >= y && py < y + it.h;
      c = it.color;
    } else if (it.kind == CIRCLE && it.stroke == 0) {
      const float r = it.r * scale(it, t);
      hit = (px - x) * (px - x) + (py - y) * (py - y) <= r * r;
      c = it.color;
    } else if (it.kind == BAR) {
      hit = px >= x && px < x + it.w && py >= y && py < y + it.h;
      c = px < x + it.w * it.value / 100.0f ? it.color : it.color2;
    }
    if (!hit) continue;
    if (a >= 1.0f || n == LAYERS) {
      base = c;
      break;
    }
    layer_c[n] = c;
    layer_a[n] = a;
    n++;
  }
  for (int i = n - 1; i >= 0; i--) base = mix(layer_c[i], base, layer_a[i]);
  return base;
}

inline uint32_t icon_codepoint(const std::string &raw);

// ----------------------------------------------------------------- parsing --

namespace detail {

inline std::string lower(std::string s) {
  for (auto &c : s)
    if (c >= 'A' && c <= 'Z') c = (char) (c - 'A' + 'a');
  return s;
}

inline std::string trim(const std::string &s) {
  const size_t a = s.find_first_not_of(" \t\r\n");
  if (a == std::string::npos) return "";
  return s.substr(a, s.find_last_not_of(" \t\r\n") - a + 1);
}

// "12", "-3.5", "12px", "500ms", "65%" -> number.
inline bool number(const std::string &raw, float *out) {
  std::string s = lower(raw);
  for (const char *unit : {"px", "ms", "%"}) {
    const size_t n = strlen(unit);
    if (s.size() > n && s.compare(s.size() - n, n, unit) == 0) {
      s.resize(s.size() - n);
      break;
    }
  }
  if (s.empty()) return false;
  char *end = nullptr;
  const float v = strtof(s.c_str(), &end);
  if (end == s.c_str() || *end != '\0' || !std::isfinite(v)) return false;
  *out = v;
  return true;
}

inline int hexval(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  return -1;
}

// "#rgb", "#rrggbb", with alpha "#rgba" or "#rrggbbaa", or a name. *a is the alpha (0..1).
inline bool color(const std::string &raw, Rgb *out, float *a) {
  struct Named {
    const char *name;
    Rgb c;
  };
  static const Named NAMES[] = {
      {"white", {255, 255, 255}}, {"black", {0, 0, 0}},         {"ink", {28, 28, 30}},
      {"page", {243, 243, 243}},  {"gray", {142, 142, 147}},    {"grey", {142, 142, 147}},
      {"lightgray", {209, 209, 214}}, {"lightgrey", {209, 209, 214}}, {"darkgray", {72, 72, 74}},
      {"darkgrey", {72, 72, 74}}, {"red", {255, 59, 48}},       {"orange", {255, 149, 0}},
      {"yellow", {255, 204, 0}},  {"gold", {255, 214, 10}},     {"green", {52, 199, 89}},
      {"mint", {0, 199, 190}},    {"teal", {48, 176, 199}},     {"cyan", {50, 173, 230}},
      {"blue", {0, 122, 255}},    {"navy", {16, 30, 72}},       {"indigo", {88, 86, 214}},
      {"purple", {175, 82, 222}}, {"pink", {255, 45, 85}},      {"brown", {162, 132, 94}},
  };
  const std::string s = lower(trim(raw));
  *a = 1.0f;
  for (const auto &n : NAMES)
    if (s == n.name) {
      *out = n.c;
      return true;
    }
  const size_t i = !s.empty() && s[0] == '#' ? 1 : 0;
  const size_t n = s.size() - i;
  if (n != 3 && n != 4 && n != 6 && n != 8) return false;
  for (size_t k = i; k < s.size(); k++)
    if (hexval(s[k]) < 0) return false;
  auto at = [&](size_t k) { return hexval(s[i + k]); };
  if (n <= 4) {
    *out = Rgb{(uint8_t) (at(0) * 17), (uint8_t) (at(1) * 17), (uint8_t) (at(2) * 17)};
    if (n == 4) *a = at(3) * 17 / 255.0f;
  } else {
    *out = Rgb{(uint8_t) (at(0) * 16 + at(1)), (uint8_t) (at(2) * 16 + at(3)), (uint8_t) (at(4) * 16 + at(5))};
    if (n == 8) *a = (at(6) * 16 + at(7)) / 255.0f;
  }
  return true;
}

// Icon names the way the table holds them: lower case, "mdi:" gone, words joined by
// "-", umlauts spelt out.
inline std::string icon_key(const std::string &raw) {
  std::string l = lower(trim(raw));
  if (l.compare(0, 4, "mdi:") == 0) l = l.substr(4);
  std::string k;
  for (size_t i = 0; i < l.size(); i++) {
    const uint8_t c = (uint8_t) l[i];
    if (c == 0xC3 && i + 1 < l.size()) {
      const uint8_t d = (uint8_t) l[++i];
      k += (d == 0xA4 || d == 0x84) ? "ae" : (d == 0xB6 || d == 0x96) ? "oe" : (d == 0xBC || d == 0x9C) ? "ue"
           : d == 0x9F ? "ss" : "";
      continue;
    }
    k += (c == ' ' || c == '_') ? '-' : (char) c;
  }
  return k;
}

inline size_t distance(const std::string &a, const std::string &b) {
  std::vector<size_t> row(b.size() + 1);
  for (size_t j = 0; j <= b.size(); j++) row[j] = j;
  for (size_t i = 1; i <= a.size(); i++) {
    size_t diag = row[0];
    row[0] = i;
    for (size_t j = 1; j <= b.size(); j++) {
      const size_t up = row[j];
      row[j] = std::min(std::min(row[j] + 1, row[j - 1] + 1), diag + (a[i - 1] == b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return row[b.size()];
}

// The closest of `names` to `word`: a name that has the word as one of its parts first
// ("sunny" -> "weather-sunny"), else the nearest by edit distance, if near enough.
template <typename Names>
inline std::string closest(const std::string &word, const Names &names) {
  std::string best;
  size_t best_d = SIZE_MAX;
  for (const std::string n : names) {
    const size_t at = n.find(word);
    if (!word.empty() && at != std::string::npos && (at == 0 || n[at - 1] == '-') &&
        (at + word.size() == n.size() || n[at + word.size()] == '-')) {
      if (best_d > 0 || n.size() < best.size()) best = n;
      best_d = 0;
      continue;
    }
    const size_t d = distance(word, n);
    if (d < best_d) {
      best_d = d;
      best = n;
    }
  }
  const size_t limit = word.size() < 6 ? 2 : word.size() / 3;
  return best_d <= limit ? best : "";
}

struct IconNames {  // every icon name and alias, for closest()
  struct It {
    size_t i;
    std::string operator*() const {
      return i < ICON_COUNT ? ICON_NAMES[i].name : ICON_ALIASES[i - ICON_COUNT].name;
    }
    It &operator++() {
      i++;
      return *this;
    }
    bool operator!=(const It &o) const { return i != o.i; }
  };
  It begin() const { return {0}; }
  It end() const { return {ICON_COUNT + ICON_ALIAS_COUNT}; }
};

struct Token {
  std::string key;  // empty: positional
  std::string value;
};

inline bool is_space(char c) { return c == ' ' || c == '\t' || c == '\r'; }

// Splits one command into tokens: words, "quoted" or 'quoted' strings (\" \\ \n inside),
// key=value and key="quoted value". A quote only opens at the start of a value.
inline std::vector<Token> tokenize(const std::string &s, bool *open_quote) {
  std::vector<Token> out;
  *open_quote = false;
  size_t i = 0;
  while (true) {
    while (i < s.size() && is_space(s[i])) i++;
    if (i >= s.size()) break;
    Token t;
    size_t j = i;
    while (j < s.size() && !is_space(s[j]) && s[j] != '=' && s[j] != '"' && s[j] != '\'') j++;
    if (j < s.size() && s[j] == '=' && j > i) {
      t.key = lower(s.substr(i, j - i));
      i = j + 1;
    }
    if (i < s.size() && (s[i] == '"' || s[i] == '\'')) {
      const char q = s[i++];
      bool closed = false;
      while (i < s.size()) {
        const char c = s[i++];
        if (c == '\\' && i < s.size()) {
          const char d = s[i++];
          t.value += d == 'n' ? '\n' : d;
          continue;
        }
        if (c == q) {
          closed = true;
          break;
        }
        t.value += c;
      }
      if (!closed) *open_quote = true;
    } else {
      size_t k = i;
      while (k < s.size() && !is_space(s[k])) k++;
      t.value = s.substr(i, k - i);
      i = k;
    }
    out.push_back(t);
  }
  return out;
}

struct Statement {
  int line;
  std::string text;
};

// Cuts the source into commands at line ends, and at ";" outside quotes and comments.
// A comment runs to the end of its line, ";" included: "#" or "//" where a command
// starts, or after a command as "# " (with a space, so "#fff" stays a colour) or "//".
inline std::vector<Statement> statements(const std::string &src) {
  std::vector<Statement> out;
  std::string cur;
  int line = 1, start_line = 1;
  char quote = 0;
  bool token_start = true, comment = false;
  for (size_t i = 0; i < src.size(); i++) {
    const char c = src[i];
    if (c == '\n') {
      out.push_back({start_line, cur});
      cur.clear();
      quote = 0;
      comment = false;
      token_start = true;
      start_line = ++line;
      continue;
    }
    if (comment) continue;
    if (!quote) {
      const char next = i + 1 < src.size() ? src[i + 1] : '\n';
      const bool start = cur.find_first_not_of(" \t\r") == std::string::npos;
      const bool hash = c == '#' && (start || (token_start && (next == ' ' || next == '\t' || next == '\r' ||
                                                               next == '\n')));
      const bool slashes = c == '/' && next == '/' && (start || token_start);
      if (hash || slashes) {
        comment = true;
        continue;
      }
    }
    if (quote) {
      if (c == '\\' && i + 1 < src.size() && src[i + 1] != '\n') {
        cur += c;
        cur += src[++i];
        continue;
      }
      if (c == quote) quote = 0;
      cur += c;
      token_start = false;
      continue;
    }
    if (c == ';') {
      out.push_back({start_line, cur});
      cur.clear();
      token_start = true;
      continue;
    }
    if ((c == '"' || c == '\'') && token_start) quote = c;
    cur += c;
    token_start = is_space(c) || c == '=';
  }
  out.push_back({start_line, cur});
  return out;
}

struct Command {
  const char *name;
  Kind kind;
  bool item;              // false: a setting of the scene (seconds, frame, once)
  const char *pos[8];     // positional values, in order
  const char *keys;       // keys of this command, besides the common ones
};

// Keys every drawn element takes.
constexpr const char *COMMON = "opacity delay dur blink fade move period";

inline const Command *command(const std::string &name) {
  static const Command TABLE[] = {
      {"bg", BG, true, {"color", "to"}, "color to dir"},
      {"rect", RECT, true, {"x", "y", "w", "h", "color"}, "x y w h color r line"},
      {"circle", CIRCLE, true, {"x", "y", "r", "color"}, "x y r color line pulse"},
      {"line", LINE, true, {"x", "y", "x2", "y2", "color"}, "x y x2 y2 color w"},
      {"tri", TRI, true, {"x", "y", "x2", "y2", "x3", "y3", "color"}, "x y x2 y2 x3 y3 color line"},
      {"star", STAR, true, {"x", "y", "r", "color"}, "x y r color points inner rot spin pulse line"},
      {"poly", POLY, true, {"x", "y", "r", "sides", "color"}, "x y r sides color rot spin pulse line"},
      {"text", TEXT, true, {"x", "y", "text"}, "x y text size color align valign w lines lh type"},
      {"icon", ICON, true, {"x", "y", "name", "color"}, "x y name color size"},
      {"muse", FIGURE, true, {"x", "y", "anim"}, "x y anim r"},
      {"bar", BAR, true, {"x", "y", "w", "h", "value", "color"}, "x y w h value color bg r"},
      {"particles", PARTICLES, true, {"kind", "count", "color"}, "kind count color icon size x y w h speed"},
      // A button answers a touch with its text (muse_wait_answer, the sensor "Antwort").
      {"button", BUTTON, true, {"x", "y", "w", "h", "text", "color"}, "x y w h text color size r"},
      {"seconds", BG, false, {"n"}, "n"},
      {"frame", BG, false, {"ms"}, "ms"},
      {"once", BG, false, {}, ""},
  };
  struct Alias {
    const char *from, *to;
  };
  // English synonyms, and the German words Muse may slip into.
  static const Alias ALIASES[] = {
      {"background", "bg"}, {"rectangle", "rect"}, {"box", "rect"}, {"triangle", "tri"},
      {"polygon", "poly"}, {"figure", "muse"}, {"avatar", "muse"}, {"progress", "bar"},
      {"particle", "particles"}, {"duration", "seconds"}, {"hintergrund", "bg"}, {"rechteck", "rect"},
      {"kreis", "circle"}, {"linie", "line"}, {"dreieck", "tri"}, {"stern", "star"}, {"vieleck", "poly"},
      {"symbol", "icon"}, {"figur", "muse"}, {"balken", "bar"}, {"partikel", "particles"},
      {"sekunden", "seconds"}, {"dauer", "seconds"}, {"einmal", "once"}, {"taste", "button"},
      {"knopf", "button"}, {"schaltflaeche", "button"},
  };
  std::string n = name;
  for (const auto &a : ALIASES)
    if (n == a.from) n = a.to;
  for (const auto &c : TABLE)
    if (n == c.name) return &c;
  return nullptr;
}

inline bool has_word(const char *list, const std::string &w) {
  const std::string l = std::string(" ") + list + " ";
  return l.find(" " + w + " ") != std::string::npos;
}

class Parser {
 public:
  explicit Parser(Scene *s) : s_(s) {}

  void error(int line, const std::string &msg) {
    if (s_->errors.size() < MAX_ERRORS) s_->errors.push_back("line " + std::to_string(line) + ": " + msg);
    else extra_errors_++;
  }
  void finish() {
    if (extra_errors_ > 0) s_->errors.back() += " (and " + std::to_string(extra_errors_) + " more)";
  }

  void statement(int line, const std::string &raw) {
    const std::string text = trim(raw);
    if (text.empty() || text[0] == '#' || text.compare(0, 2, "//") == 0) return;
    bool open_quote = false;
    std::vector<Token> tokens = tokenize(text, &open_quote);
    if (tokens.empty()) return;
    if (open_quote) error(line, "a quote is not closed; it ends at the end of the line");
    if (!tokens[0].key.empty()) {
      // "seconds=30" reads as "seconds 30"
      tokens.insert(tokens.begin() + 1, Token{"", tokens[0].value});
      tokens[0].value = tokens[0].key;
      tokens[0].key.clear();
    }
    const std::string name = lower(tokens[0].value);
    const Command *cmd = command(name);
    if (cmd == nullptr) {
      static const char *const NAMES[] = {"bg", "rect", "circle", "line", "tri", "star", "poly", "text",
                                          "icon", "muse", "bar", "particles", "button", "seconds", "frame", "once"};
      const std::string near = closest(name, NAMES);
      error(line, "unknown command '" + name + "'" + (near.empty() ? "" : "; did you mean '" + near + "'?"));
      s_->skipped++;
      return;
    }
    tokens.erase(tokens.begin());
    if (!cmd->item) {
      setting(line, *cmd, tokens);
      return;
    }
    if (s_->items.size() >= MAX_ITEMS) {
      if (!full_) error(line, "more than " + std::to_string(MAX_ITEMS) + " elements; the rest is left out");
      full_ = true;
      s_->skipped++;
      return;
    }
    Item it;
    it.kind = cmd->kind;
    it.line = line;
    it.frame = frame_;
    if (name == "avatar") it.sub = F_AVATAR;
    bool opacity_set = false;
    bool ok = true;
    size_t p = 0;
    std::string rest;  // text: words after the positional ones
    for (const Token &t : tokens) {
      std::string key = t.key;
      if (key.empty()) {
        if (p < 8 && cmd->pos[p] != nullptr) {
          key = cmd->pos[p++];
        } else if (it.kind == TEXT || it.kind == BUTTON) {
          rest += (rest.empty() ? "" : " ") + t.value;
          continue;
        } else {
          error(line, std::string(cmd->name) + ": one value too many: '" + t.value + "'");
          continue;
        }
      }
      if (key == "x1") key = "x";
      if (key == "y1") key = "y";
      if (key == "colour") key = "color";
      if (!has_word(cmd->keys, key) && !has_word(COMMON, key)) {
        error(line, std::string(cmd->name) + ": unknown key '" + key + "'; keys: " + cmd->keys + " " + COMMON);
        continue;
      }
      if (key == "opacity") opacity_set = true;
      set(line, it, key, t.value, &opacity_set, &ok);
    }
    if ((it.kind == TEXT || it.kind == BUTTON) && !rest.empty()) it.text = it.text.empty() ? rest : it.text + " " + rest;
    if (ok) ok = complete(line, it);
    if (!ok) {
      s_->skipped++;
      return;
    }
    s_->items.push_back(it);
  }

 private:
  Scene *s_;
  int frame_ = -1;
  bool full_ = false;
  size_t extra_errors_ = 0;

  void setting(int line, const Command &cmd, const std::vector<Token> &tokens) {
    const std::string name = cmd.name;
    if (name == "once") {
      s_->once = true;
      return;
    }
    std::string v = tokens.empty() ? "" : tokens[0].value;
    float n = 0;
    if (name == "seconds") {
      float factor = 1;
      std::string l = lower(v);
      if (l.size() > 3 && l.compare(l.size() - 3, 3, "min") == 0) {
        l.resize(l.size() - 3);
        factor = 60;
      } else if (l.size() > 1 && l.back() == 's' && l.compare(l.size() - 2, 2, "ms") != 0) {
        l.pop_back();
      }
      if (!number(l, &n)) {
        error(line, "seconds: '" + v + "' is not a number");
        return;
      }
      n *= factor;
      s_->seconds = (uint32_t) (n < 3 ? 3 : n > 3600 ? 3600 : n);
      return;
    }
    // frame [ms]; "frame end" goes back to elements shown in every frame
    if (lower(v) == "end" || lower(v) == "all") {
      frame_ = -1;
      return;
    }
    uint32_t ms = 500;
    if (!v.empty()) {
      if (!number(v, &n)) error(line, "frame: '" + v + "' is not a number of ms; 500 ms instead");
      else ms = (uint32_t) (n < 50 ? 50 : n > 10000 ? 10000 : n);
    }
    if (s_->frames.size() >= MAX_FRAMES) {
      error(line, "more than " + std::to_string(MAX_FRAMES) + " frames; the rest goes into the last one");
      return;
    }
    s_->frames.push_back(ms);
    frame_ = (int) s_->frames.size() - 1;
  }

  bool num(int line, const Item &it, const std::string &key, const std::string &v, float *out, float lo, float hi) {
    float n;
    if (!number(v, &n)) {
      error(line, std::string(kind_name(it.kind)) + ": " + key + "='" + v + "' is not a number");
      return false;
    }
    *out = n < lo ? lo : n > hi ? hi : n;
    return true;
  }
  bool ms(int line, const Item &it, const std::string &key, const std::string &v, uint32_t *out) {
    float n;
    if (!num(line, it, key, v, &n, 0, 3600000)) return false;
    *out = (uint32_t) n;
    return true;
  }
  bool col(int line, const Item &it, const std::string &key, const std::string &v, Rgb *out, float *a) {
    if (color(v, out, a)) return true;
    error(line, std::string(kind_name(it.kind)) + ": " + key + "='" + v +
                    "' is no colour; use #rrggbb or a name (white, black, gray, red, orange, yellow, green, "
                    "mint, teal, cyan, blue, navy, indigo, purple, pink, brown, gold, page, ink)");
    return false;
  }
  static const char *kind_name(Kind k) {
    static const char *const N[] = {"bg", "rect", "circle", "line", "tri", "star", "poly",
                                    "text", "icon", "muse", "bar", "particles", "button"};
    return N[k];
  }
  int choice(int line, const Item &it, const std::string &key, const std::string &v, const char *const *names,
             size_t n, int fallback) {
    const std::string l = lower(trim(v));
    for (size_t i = 0; i < n; i++)
      if (l == names[i]) return (int) i;
    std::string all;
    for (size_t i = 0; i < n; i++) all += (i ? ", " : "") + std::string(names[i]);
    error(line, std::string(kind_name(it.kind)) + ": " + key + "='" + v + "' is none of " + all);
    return fallback;
  }

  void set(int line, Item &it, const std::string &key, const std::string &v, bool *opacity_set, bool *ok) {
    const float BIG = 2000;
    float a = 1;
    float n = 0;
    if (key == "x") num(line, it, key, v, &it.x, -BIG, BIG);
    else if (key == "y") num(line, it, key, v, &it.y, -BIG, BIG);
    else if (key == "x2") num(line, it, key, v, &it.x2, -BIG, BIG);
    else if (key == "y2") num(line, it, key, v, &it.y2, -BIG, BIG);
    else if (key == "x3") num(line, it, key, v, &it.x3, -BIG, BIG);
    else if (key == "y3") num(line, it, key, v, &it.y3, -BIG, BIG);
    else if (key == "h") num(line, it, key, v, &it.h, 0, BIG);
    else if (key == "w") {
      if (it.kind == LINE) {
        if (num(line, it, key, v, &n, 1, 40)) it.stroke = (int) n;
      } else if (it.kind == TEXT) {
        if (num(line, it, key, v, &n, 0, BIG)) it.wrap = (int) n;
      } else {
        num(line, it, key, v, &it.w, 0, BIG);
      }
    } else if (key == "r") {
      if (it.kind == RECT || it.kind == BAR || it.kind == BUTTON) {
        if (lower(v) == "pill" || lower(v) == "full") it.radius = -1;
        else if (num(line, it, key, v, &n, 0, 500)) it.radius = (int) n;
      } else {
        num(line, it, key, v, &it.r, 0, 1000);
      }
    } else if (key == "color" || key == "to" || (key == "bg" && it.kind == BAR)) {
      Rgb c;
      if (!col(line, it, key, v, &c, &a)) {
        if (it.kind == BG && key == "color") *ok = false;
        return;
      }
      if (key == "color") {
        it.color = c;
        it.has_color = true;
        if (a < 1.0f && !*opacity_set) it.opacity = a;
      } else {
        it.color2 = c;
        it.has_color2 = true;
        if (key == "to") it.gradient = true;
      }
    } else if (key == "dir") {
      static const char *const D[] = {"down", "right"};
      it.horizontal = choice(line, it, key, v, D, 2, 0) == 1;
    } else if (key == "line") {
      if (num(line, it, key, v, &n, 0, 50)) it.stroke = (int) n;
    } else if (key == "opacity") {
      if (num(line, it, key, v, &n, 0, 100)) it.opacity = n > 1.0f ? n / 100.0f : n;
    } else if (key == "points" || key == "sides") {
      if (num(line, it, key, v, &n, 3, 24)) it.points = (int) n;
    } else if (key == "inner") {
      num(line, it, key, v, &it.inner, 0.1f, 1.0f);
    } else if (key == "rot") {
      num(line, it, key, v, &it.rot, -3600, 3600);
    } else if (key == "value") {
      num(line, it, key, v, &it.value, 0, 100);
    } else if (key == "text") {
      it.text = v.size() > MAX_TEXT ? v.substr(0, MAX_TEXT) : v;
    } else if (key == "size") {
      size(line, it, v);
    } else if (key == "align") {
      static const char *const A[] = {"left", "center", "right", "centre", "middle"};
      const int i = choice(line, it, key, v, A, 5, 0);
      it.align = i >= 3 ? 1 : i;
    } else if (key == "valign") {
      static const char *const A[] = {"top", "middle", "bottom", "center", "centre"};
      const int i = choice(line, it, key, v, A, 5, 0);
      it.valign = i >= 3 ? 1 : i;
    } else if (key == "lines") {
      if (num(line, it, key, v, &n, 0, 20)) it.max_lines = (int) n;
    } else if (key == "lh") {
      if (num(line, it, key, v, &n, 0, 200)) it.line_h = (int) n;
    } else if (key == "name" || key == "icon") {
      const uint32_t cp = icon_codepoint(v);
      if (cp == 0) {
        const std::string near = closest(icon_key(v), IconNames{});
        error(line, std::string(kind_name(it.kind)) + ": no icon '" + v + "'" +
                        (near.empty() ? "" : "; did you mean '" + near + "'?"));
        if (it.kind == ICON) *ok = false;
      } else {
        it.glyph = cp;
      }
    } else if (key == "anim") {
      static const char *const A[] = {"idle", "wave", "working", "making", "avatar"};
      it.sub = choice(line, it, key, v, A, 5, F_IDLE);
    } else if (key == "kind") {
      static const char *const K[] = {"confetti", "snow", "rain", "sparkle", "bubbles"};
      it.sub = choice(line, it, key, v, K, 5, P_CONFETTI);
    } else if (key == "count") {
      if (num(line, it, key, v, &n, 1, MAX_PARTICLES)) it.count = (int) n;
    } else if (key == "speed") {
      num(line, it, key, v, &it.speed, 0.1f, 5.0f);
    } else if (key == "delay") {
      ms(line, it, key, v, &it.delay);
    } else if (key == "dur") {
      ms(line, it, key, v, &it.dur);
    } else if (key == "blink") {
      ms(line, it, key, v, &it.blink);
    } else if (key == "fade") {
      ms(line, it, key, v, &it.fade);
    } else if (key == "type") {
      ms(line, it, key, v, &it.type);
    } else if (key == "period") {
      if (ms(line, it, key, v, &it.period) && it.period < 100) it.period = 100;
    } else if (key == "spin") {
      ms(line, it, key, v, &it.spin);
    } else if (key == "pulse") {
      ms(line, it, key, v, &it.pulse);
    } else if (key == "move") {
      // move=dx,dy
      const size_t comma = v.find(',');
      float dx = 0, dy = 0;
      if (comma == std::string::npos || !number(trim(v.substr(0, comma)), &dx) ||
          !number(trim(v.substr(comma + 1)), &dy)) {
        error(line, std::string(kind_name(it.kind)) + ": move='" + v + "' should be dx,dy such as move=0,-12");
      } else {
        it.move_x = dx < -BIG ? -BIG : dx > BIG ? BIG : dx;
        it.move_y = dy < -BIG ? -BIG : dy > BIG ? BIG : dy;
      }
    }
  }

  void size(int line, Item &it, const std::string &v) {
    const std::string l = lower(trim(v));
    it.has_size = true;
    if (it.kind == ICON || it.kind == PARTICLES) {
      if (l == "s" || l == "small" || l == "m") it.size = 0;
      else if (l == "l" || l == "large" || l == "xl") it.size = 1;
      else {
        float n;
        if (number(l, &n)) it.size = n < 35 ? 0 : 1;
        else error(line, std::string(kind_name(it.kind)) + ": size='" + v + "' is none of s, l (24, 46 px)");
      }
      return;
    }
    static const char *const NAMES[] = {"xs", "s", "m", "l", "xl", "xxl"};
    for (int i = 0; i < 6; i++)
      if (l == NAMES[i]) {
        it.size = i;
        return;
      }
    float n;
    if (!number(l, &n)) {
      error(line, "text: size='" + v + "' is none of xs, s, m, l, xl, xxl (13, 16, 20, 24, 36, 54 px)");
      return;
    }
    int best = 0;
    for (int i = 1; i < 6; i++)
      if (fabsf(TEXT_PX[i] - n) < fabsf(TEXT_PX[best] - n)) best = i;
    it.size = best;
  }

  // Checks what an element needs to be drawn at all, and fills in sensible defaults.
  bool complete(int line, Item &it) {
    auto need = [&](bool have, const char *what) {
      if (!have) error(line, std::string(kind_name(it.kind)) + ": needs " + what);
      return have;
    };
    auto def = [](float &v, float d) {
      if (std::isnan(v)) v = d;
    };
    switch (it.kind) {
      case BG:
        if (!it.has_color) it.color = PAGE;
        return true;
      case RECT:
        def(it.x, 0);
        def(it.y, 0);
        return need(!std::isnan(it.w) && !std::isnan(it.h) && it.w > 0 && it.h > 0, "w and h above 0");
      case CIRCLE:
      case STAR:
      case POLY:
        def(it.x, 160);
        def(it.y, 120);
        return need(!std::isnan(it.r) && it.r > 0, "r above 0");
      case LINE:
        def(it.x, 0);
        def(it.y, 0);
        if (it.stroke == 0) it.stroke = 1;
        return need(!std::isnan(it.x2) && !std::isnan(it.y2), "x2 and y2");
      case TRI:
        return need(!std::isnan(it.x) && !std::isnan(it.y) && !std::isnan(it.x2) && !std::isnan(it.y2) &&
                        !std::isnan(it.x3) && !std::isnan(it.y3),
                    "three points: x y x2 y2 x3 y3");
      case TEXT:
        def(it.x, 0);
        def(it.y, 0);
        return need(!trim(it.text).empty(), "a text");
      case ICON:
        def(it.x, 160);
        def(it.y, 120);
        if (it.size > 1) it.size = 1;
        return need(it.glyph != 0, "an icon name");
      case FIGURE:
        def(it.x, 160);
        def(it.y, 110);
        if (std::isnan(it.r) || it.r > 80) it.r = 80;
        if (it.r < 20) it.r = 20;
        return true;
      case BAR:
        def(it.x, 0);
        def(it.y, 0);
        if (!it.has_color) it.color = Rgb{52, 199, 89};
        if (!it.has_color2) it.color2 = Rgb{209, 209, 214};
        return need(!std::isnan(it.w) && !std::isnan(it.h) && it.w > 0 && it.h > 0, "w and h above 0");
      case PARTICLES:
        def(it.x, 0);
        def(it.y, 0);
        def(it.w, 320);
        def(it.h, 240);
        if (!it.has_size || it.size > 1) it.size = 0;
        return true;
      case BUTTON:
        def(it.x, 0);
        def(it.y, 0);
        if (!it.has_color) it.color = Rgb{0, 122, 255};
        if (!it.has_size) it.size = 2;  // text size m
        if (it.radius == 0) it.radius = -1;  // a pill unless r was given
        return need(!std::isnan(it.w) && !std::isnan(it.h) && it.w > 0 && it.h > 0, "w and h above 0") &&
               need(!trim(it.text).empty(), "a text");
    }
    return true;
  }
};

}  // namespace detail

// The codepoint of an icon by its MDI name ("coffee", "mdi:coffee") or one of its
// other names ("kaffee", "klingel"); 0 when there is none.
inline uint32_t icon_codepoint(const std::string &raw) {
  const std::string k = detail::icon_key(raw);
  size_t lo = 0, hi = ICON_COUNT;
  while (lo < hi) {
    const size_t mid = (lo + hi) / 2;
    const int c = strcmp(ICON_NAMES[mid].name, k.c_str());
    if (c == 0) return ICON_NAMES[mid].cp;
    if (c < 0) lo = mid + 1;
    else hi = mid;
  }
  for (size_t i = 0; i < ICON_ALIAS_COUNT; i++)
    if (k == ICON_ALIASES[i].name) return ICON_ALIASES[i].cp;
  return 0;
}

inline Scene parse(const std::string &src) {
  Scene s;
  detail::Parser p(&s);
  if (src.size() > MAX_SOURCE) {
    p.error(1, "the scene has " + std::to_string(src.size()) + " bytes; only the first " +
                   std::to_string(MAX_SOURCE) + " are read");
  }
  const std::string body = src.size() > MAX_SOURCE ? src.substr(0, MAX_SOURCE) : src;
  for (const auto &st : detail::statements(body)) p.statement(st.line, st.text);
  p.finish();
  return s;
}

// The button under (px, py) at time t in frame `frame`, or -1. The touch has to land
// inside the button; no margin, so two buttons may touch each other.
inline int button_at(const Scene &s, float px, float py, uint32_t t, int frame) {
  for (size_t k = s.items.size(); k-- > 0;) {
    const Item &it = s.items[k];
    if (it.kind != BUTTON || !visible(it, t, frame)) continue;
    float dx, dy;
    offset(it, t, &dx, &dy);
    if (px >= it.x + dx && px < it.x + dx + it.w && py >= it.y + dy && py < it.y + dy + it.h) return (int) k;
  }
  return -1;
}

// The scene on screen; muse_draw replaces it, the display lambda draws it.
inline Scene &current() {
  static Scene s;
  return s;
}

}  // namespace scene
}  // namespace muse
