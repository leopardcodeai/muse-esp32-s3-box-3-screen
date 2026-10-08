// muse.h: helpers for Muse's face on the ESP32-S3-Box3 (stackchan-box3.yaml).
//
// Text cleaning, weather and event icons, paging of long texts, anti-aliased
// shapes and the backlight schedule. Plain functions only: ESPHome includes
// this file before it declares the globals, so nothing here may use id().
//
// Pitfalls:
//  * The fonts hold no emoji. ESPHome draws an empty rectangle for every
//    character a font lacks and logs a warning on each redraw (ten times a
//    second). clean() therefore keeps only what the font can draw.
//  * ESPHome blends the soft edge of every glyph against the background colour
//    passed to print(); without one it blends against black, which put a dark
//    fringe around all text on the light page (06.10.2026). Always pass it.
//  * filled_circle() has hard, stepped edges. circle() and round_rect() here
//    blend the edge pixels instead, against the colour behind them.
#pragma once

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <deque>
#include <map>
#include <string>
#include <vector>

#include "esphome/components/animation/animation.h"
#include "esphome/components/display/display.h"
#include "esphome/components/font/font.h"
#include "esphome/components/ili9xxx/ili9xxx_display.h"
#include "esphome/components/image/image.h"
#include "esphome/core/hal.h"
#include "esphome/core/log.h"

#include "driver/gpio.h"
#include "esphome/core/time.h"

#include "muse_fit.h"
#include "muse_scene.h"

namespace muse {

using esphome::Color;
using esphome::display::BaseFont;
using esphome::display::Display;
using esphome::display::TextAlign;

// ------------------------------------------------------------------ icons --

// Weather icons in the order of ICONS in make_muse_icons.py. The first
// LARGE_COUNT also exist at 104 px for the weather card.
enum Weather : int {
  W_NONE = -1,
  W_CLEAR_DAY,
  W_CLEAR_NIGHT,
  W_PARTLY_DAY,
  W_PARTLY_NIGHT,
  W_CLOUDY,
  W_OVERCAST,
  W_FOG,
  W_DRIZZLE,
  W_RAIN,
  W_EXTREME_RAIN,
  W_SHOWERS,
  W_THUNDER,
  W_THUNDER_RAIN,
  W_SNOW,
  W_SLEET,
  W_HAIL,
  W_WIND,
  W_TORNADO,
  W_UMBRELLA,
  W_THERMOMETER,
  W_RAINDROP,
  W_SUNRISE,
  W_SUNSET,
  W_COUNT
};
constexpr int LARGE_COUNT = W_UMBRELLA;

// A weather emoji becomes its icon; every other emoji is dropped by clean().
inline int emoji_weather(uint32_t cp) {
  switch (cp) {
    case 0x2600: case 0x1F31E: return W_CLEAR_DAY;                 // sun
    case 0x1F319: case 0x1F31B: case 0x1F31C: return W_CLEAR_NIGHT; // moon
    case 0x1F324: case 0x26C5: return W_PARTLY_DAY;
    case 0x1F325: return W_OVERCAST;
    case 0x2601: return W_CLOUDY;
    case 0x1F326: return W_SHOWERS;
    case 0x1F327: return W_RAIN;
    case 0x26C8: return W_THUNDER_RAIN;
    case 0x1F329: return W_THUNDER;
    case 0x1F328: case 0x2744: case 0x2603: case 0x26C4: return W_SNOW;
    case 0x1F32B: return W_FOG;
    case 0x1F4A8: case 0x1F32C: return W_WIND;
    case 0x1F32A: return W_TORNADO;
    case 0x2614: case 0x2602: return W_UMBRELLA;
    case 0x1F321: return W_THERMOMETER;
    case 0x1F4A7: return W_RAINDROP;
    case 0x1F305: case 0x1F304: return W_SUNRISE;
    case 0x1F307: case 0x1F306: return W_SUNSET;
    default: return W_NONE;
  }
}

inline std::string lower(const std::string &s) {
  std::string out = s;
  for (auto &c : out)
    if (c >= 'A' && c <= 'Z') c = c - 'A' + 'a';
  // German capitals that start a word: Ä Ö Ü (UTF-8 C3 84/96/9C).
  for (size_t i = 0; i + 1 < out.size(); i++)
    if ((uint8_t) out[i] == 0xC3 && ((uint8_t) out[i + 1] == 0x84 || (uint8_t) out[i + 1] == 0x96 ||
                                     (uint8_t) out[i + 1] == 0x9C))
      out[i + 1] = (char) ((uint8_t) out[i + 1] + 0x20);
  return out;
}

inline std::string trim(const std::string &s) {
  size_t a = s.find_first_not_of(" \t\r\n");
  if (a == std::string::npos) return "";
  size_t b = s.find_last_not_of(" \t\r\n");
  return s.substr(a, b - a + 1);
}

// Status words to the status number: English, plus the German ones Muse proposed first.
// 0 ready, 1 listening, 2 thinking, 3 speaking, 4 error, 5 quiet; anything else is 0.
inline int parse_status(const std::string &raw) {
  static const std::map<std::string, int> STATES = {
      {"ready", 0}, {"bereit", 0},
      {"listening", 1}, {"hoert", 1}, {"h\u00F6rt", 1},
      {"thinking", 2}, {"working", 2}, {"denkt", 2}, {"arbeitet", 2},
      {"speaking", 3}, {"spricht", 3},
      {"error", 4}, {"fehler", 4},
      {"off", 5}, {"aus", 5}, {"ruhe", 5}};
  const auto found = STATES.find(lower(trim(raw)));
  return found == STATES.end() ? 0 : found->second;
}

// Home Assistant's weather conditions, plus the words Muse may use instead.
struct Condition {
  const char *key;
  int icon;
  const char *label;
};

inline const Condition *condition(const std::string &raw) {
  static const Condition TABLE[] = {
      {"sunny", W_CLEAR_DAY, "Sonnig"},
      {"clear-night", W_CLEAR_NIGHT, "Klar"},
      {"partlycloudy", W_PARTLY_DAY, "Teils bewölkt"},
      {"partlycloudy-night", W_PARTLY_NIGHT, "Teils bewölkt"},
      {"cloudy", W_CLOUDY, "Bewölkt"},
      {"fog", W_FOG, "Nebel"},
      {"rainy", W_RAIN, "Regen"},
      {"pouring", W_EXTREME_RAIN, "Starkregen"},
      {"lightning", W_THUNDER, "Gewitter"},
      {"lightning-rainy", W_THUNDER_RAIN, "Gewitter mit Regen"},
      {"snowy", W_SNOW, "Schnee"},
      {"snowy-rainy", W_SLEET, "Schneeregen"},
      {"hail", W_HAIL, "Hagel"},
      {"windy", W_WIND, "Windig"},
      {"windy-variant", W_WIND, "Windig und bewölkt"},
      {"exceptional", W_TORNADO, "Unwetter"},
      // Words, German and English. Longer keys win in the search below.
      {"sonnig", W_CLEAR_DAY, "Sonnig"},
      {"sonne", W_CLEAR_DAY, "Sonnig"},
      {"heiter", W_PARTLY_DAY, "Heiter"},
      {"klar", W_CLEAR_NIGHT, "Klar"},
      {"teils bewölkt", W_PARTLY_DAY, "Teils bewölkt"},
      {"teilweise bewölkt", W_PARTLY_DAY, "Teils bewölkt"},
      {"bewölkt", W_CLOUDY, "Bewölkt"},
      {"wolkig", W_CLOUDY, "Wolkig"},
      {"bedeckt", W_OVERCAST, "Bedeckt"},
      {"nebel", W_FOG, "Nebel"},
      {"niesel", W_DRIZZLE, "Nieselregen"},
      {"regen", W_RAIN, "Regen"},
      {"starkregen", W_EXTREME_RAIN, "Starkregen"},
      {"schauer", W_SHOWERS, "Schauer"},
      {"gewitter", W_THUNDER_RAIN, "Gewitter"},
      {"schnee", W_SNOW, "Schnee"},
      {"schneeregen", W_SLEET, "Schneeregen"},
      {"hagel", W_HAIL, "Hagel"},
      {"wind", W_WIND, "Windig"},
      {"sturm", W_WIND, "Sturm"},
      {"unwetter", W_TORNADO, "Unwetter"},
      {"sun", W_CLEAR_DAY, "Sonnig"},
      {"clear", W_CLEAR_DAY, "Klar"},
      {"partly cloudy", W_PARTLY_DAY, "Teils bewölkt"},
      {"overcast", W_OVERCAST, "Bedeckt"},
      {"drizzle", W_DRIZZLE, "Nieselregen"},
      {"rain", W_RAIN, "Regen"},
      {"shower", W_SHOWERS, "Schauer"},
      {"thunder", W_THUNDER_RAIN, "Gewitter"},
      {"snow", W_SNOW, "Schnee"},
      {"sleet", W_SLEET, "Schneeregen"},
  };
  const std::string k = lower(trim(raw));
  for (const auto &c : TABLE)
    if (k == c.key) return &c;
  const Condition *best = nullptr;
  size_t best_len = 0;
  for (const auto &c : TABLE) {
    size_t n = strlen(c.key);
    if (n > best_len && k.find(c.key) != std::string::npos) {
      best = &c;
      best_len = n;
    }
  }
  return best;
}

// Event icons: a glyph of the Material Design Icons font on a coloured disc.
struct Event {
  const char *key;
  const char *glyph;
  Color color;
};

inline const Event &event(const std::string &raw) {
  static const Event TABLE[] = {
      {"klingel", "\U000F009E", Color(255, 149, 0)},
      {"garage", "\U000F12D4", Color(0, 122, 255)},
      {"garage_zu", "\U000F12D3", Color(0, 122, 255)},
      {"rollladen_runter", "\U000F111C", Color(88, 86, 214)},
      {"rollladen_hoch", "\U000F111E", Color(88, 86, 214)},
      {"mail", "\U000F01EE", Color(0, 122, 255)},
      {"kalender", "\U000F00F0", Color(255, 45, 85)},
      {"muell", "\U000F0A79", Color(52, 199, 89)},
      {"tv_an", "\U000F0502", Color(175, 82, 222)},
      {"tv_aus", "\U000F083B", Color(142, 142, 147)},
      {"zuhause", "\U000F0826", Color(48, 176, 199)},
      {"briefkasten", "\U000F0D8D", Color(255, 149, 0)},
      {"tuer", "\U000F081C", Color(162, 132, 94)},
      {"nachrichten", "\U000F1001", Color(255, 59, 48)},
      {"licht", "\U000F06E8", Color(255, 159, 10)},
      {"solar", "\U000F0A72", Color(255, 159, 10)},
      {"timer", "\U000F051B", Color(255, 149, 0)},
      {"erledigt", "\U000F05E0", Color(52, 199, 89)},
      {"info", "\U000F02FC", Color(142, 142, 147)},
  };
  struct Alias {
    const char *from, *to;
  };
  static const Alias ALIASES[] = {
      {"doorbell", "klingel"}, {"bell", "klingel"}, {"garage_open", "garage"},
      {"garage_closed", "garage_zu"}, {"rolladen_runter", "rollladen_runter"},
      {"rolladen_hoch", "rollladen_hoch"}, {"shutter_down", "rollladen_runter"},
      {"shutter_up", "rollladen_hoch"}, {"email", "mail"}, {"e_mail", "mail"},
      {"calendar", "kalender"}, {"termin", "kalender"}, {"trash", "muell"},
      {"abfall", "muell"}, {"tv_on", "tv_an"}, {"fernseher_an", "tv_an"},
      {"tv_off", "tv_aus"}, {"fernseher_aus", "tv_aus"}, {"home", "zuhause"},
      {"heimkommen", "zuhause"}, {"mailbox", "briefkasten"}, {"post", "briefkasten"},
      {"door", "tuer"}, {"news", "nachrichten"}, {"light", "licht"}, {"pv", "solar"},
      {"done", "erledigt"}, {"ok", "erledigt"},
  };
  // Normalise: lower case, spaces and dashes to underscores, umlauts spelt out.
  std::string k;
  const std::string l = lower(trim(raw));
  for (size_t i = 0; i < l.size(); i++) {
    uint8_t c = l[i];
    if (c == 0xC3 && i + 1 < l.size()) {
      uint8_t d = l[++i];
      k += d == 0xA4 ? "ae" : d == 0xB6 ? "oe" : d == 0xBC ? "ue" : d == 0x9F ? "ss" : "";
    } else {
      k += (c == ' ' || c == '-') ? '_' : (char) c;
    }
  }
  for (const auto &a : ALIASES)
    if (k == a.from) k = a.to;
  for (const auto &e : TABLE)
    if (k == e.key) return e;
  return TABLE[sizeof(TABLE) / sizeof(TABLE[0]) - 1];
}

// ------------------------------------------------------------------- text --

inline size_t utf8_next(const std::string &s, size_t i, uint32_t *cp) {
  if (i >= s.size()) return 0;
  const uint8_t c = s[i];
  size_t n = c < 0x80 ? 1 : (c >> 5) == 0x6 ? 2 : (c >> 4) == 0xE ? 3 : (c >> 3) == 0x1E ? 4 : 1;
  if (i + n > s.size()) n = 1;
  uint32_t v = n == 1 ? c : n == 2 ? (c & 0x1F) : n == 3 ? (c & 0x0F) : (c & 0x07);
  for (size_t k = 1; k < n; k++) v = (v << 6) | ((uint8_t) s[i + k] & 0x3F);
  *cp = v;
  return n;
}

struct Clean {
  std::string text;
  int icon = W_NONE;  // first weather emoji found, if any
};

// Keeps only what `font` can draw: weather emojis become an icon number, other
// emojis and symbols go, Markdown marks from language models go, line breaks stay.
inline Clean clean(const std::string &in, const esphome::font::Font *font) {
  Clean r;
  std::string out;
  bool space = true;  // no leading space, no double spaces
  size_t i = 0;
  uint32_t cp;
  while (size_t n = utf8_next(in, i, &cp)) {
    const size_t at = i;
    i += n;
    if (cp == '\r') continue;
    if (cp == '\n') {
      while (!out.empty() && out.back() == ' ') out.pop_back();
      out += '\n';
      space = true;
      continue;
    }
    if (cp == '\t' || cp == 0xA0 || cp == 0x2002 || cp == 0x2003 || cp == 0x2009 || cp == 0x202F) cp = ' ';
    if (cp == ' ') {
      if (!space) out += ' ';
      space = true;
      continue;
    }
    const int w = emoji_weather(cp);
    if (w != W_NONE) {
      if (r.icon == W_NONE) r.icon = w;
      continue;
    }
    if (cp == 0x2192) {  // an arrow the font lacks
      out += "->";
      space = false;
      continue;
    }
    if (cp == 0x2212) cp = '-';
    if (font != nullptr && font->find_glyph(cp) == nullptr) continue;
    if (cp == '-') out += '-';
    else out.append(in, at, n);
    space = false;
  }
  // Markdown, line by line: headings, bullets, bold and code marks.
  const bool bullet = font == nullptr || font->find_glyph(0x2022) != nullptr;
  std::string md;
  size_t start = 0;
  while (start <= out.size()) {
    size_t nl = out.find('\n', start);
    if (nl == std::string::npos) nl = out.size();
    std::string line = out.substr(start, nl - start);
    size_t h = 0;
    while (h < line.size() && line[h] == '#') h++;
    if (h > 0 && h < line.size() && line[h] == ' ') line = line.substr(h + 1);
    if (line.size() > 1 && (line[0] == '*' || line[0] == '-' || line[0] == '+') && line[1] == ' ')
      line = (bullet ? "• " : "- ") + line.substr(2);
    std::string kept;
    for (size_t k = 0; k < line.size(); k++) {
      if (line[k] == '*' || line[k] == '`') continue;
      if (line[k] == '_' && k + 1 < line.size() && line[k + 1] == '_') {
        k++;
        continue;
      }
      kept += line[k];
    }
    md += kept;
    if (nl < out.size()) md += '\n';
    start = nl + 1;
  }
  // No more than one empty line in a row, nothing around the text.
  std::string tidy;
  int newlines = 0;
  for (char c : md) {
    if (c == '\n') {
      if (++newlines > 2) continue;
    } else {
      newlines = 0;
    }
    tidy += c;
  }
  r.text = trim(tidy);
  return r;
}

// "21.5", "21,5 °C", "21 Grad" -> "21,5°" (German decimal comma).
inline std::string temperature(const std::string &raw) {
  std::string t;
  for (char c : raw) {
    if ((c >= '0' && c <= '9') || c == '-' || c == '+') t += c;
    else if (c == '.' || c == ',') t += ',';
  }
  if (t.empty()) return "";
  return t + "°";
}

inline int text_width(Display &it, const std::string &s, BaseFont *f) {
  int x1, y1, w, h;
  it.get_text_bounds(0, 0, s.c_str(), f, TextAlign::TOP_LEFT, &x1, &y1, &w, &h);
  return w;
}

// Breaks text into lines no wider than max_width; '\n' starts a new line and a
// word wider than a whole line (a link, say) is cut between characters.
inline std::vector<std::string> wrap(Display &it, const std::string &text, BaseFont *f, int max_width) {
  std::vector<std::string> lines;
  size_t start = 0;
  while (start <= text.size()) {
    size_t nl = text.find('\n', start);
    if (nl == std::string::npos) nl = text.size();
    const std::string para = text.substr(start, nl - start);
    std::string line;
    size_t i = 0;
    while (i <= para.size()) {
      size_t j = para.find(' ', i);
      if (j == std::string::npos) j = para.size();
      std::string word = para.substr(i, j - i);
      i = j + 1;
      if (word.empty()) continue;
      const std::string test = line.empty() ? word : line + " " + word;
      if (text_width(it, test, f) <= max_width) {
        line = test;
        continue;
      }
      if (!line.empty()) lines.push_back(line);
      line.clear();
      while (text_width(it, word, f) > max_width) {
        size_t k = 0, fit = 0;
        uint32_t cp;
        while (size_t n = utf8_next(word, k, &cp)) {
          if (text_width(it, word.substr(0, k + n), f) > max_width) break;
          k += n;
          fit = k;
        }
        if (fit == 0) fit = utf8_next(word, 0, &cp);
        lines.push_back(word.substr(0, fit));
        word = word.substr(fit);
      }
      line = word;
    }
    lines.push_back(line);
    start = nl + 1;
  }
  while (!lines.empty() && lines.back().empty()) lines.pop_back();
  return lines;
}

// A long text in pages that change by themselves, slow enough to read along.
struct Paged {
  uint32_t version = UINT32_MAX;
  int per_page = 5;
  std::vector<std::string> lines;
  std::vector<uint32_t> ends;  // when each page ends, in ms after the start

  void build(Display &it, uint32_t ver, const std::string &text, BaseFont *f, int width, int per) {
    version = ver;
    per_page = per;
    lines = wrap(it, text, f, width);
    ends.clear();
    uint32_t t = 0;
    for (size_t p = 0; p < lines.size(); p += per) {
      size_t chars = 0;
      for (size_t k = p; k < lines.size() && k < p + per; k++) chars += lines[k].size();
      uint32_t ms = (uint32_t) chars * 65;  // about 15 characters a second
      ms = ms < 5000 ? 5000 : ms > 16000 ? 16000 : ms;
      t += ms;
      ends.push_back(t);
    }
  }
  int pages() const { return (int) ends.size(); }
  uint32_t cycle() const { return ends.empty() ? 0 : ends.back(); }
  int page_at(uint32_t elapsed) const {
    if (ends.size() <= 1) return 0;
    const uint32_t t = elapsed % ends.back();
    for (size_t p = 0; p < ends.size(); p++)
      if (t < ends[p]) return (int) p;
    return 0;
  }
  void draw(Display &it, int page, int x, int y, int line_h, BaseFont *f, Color c, Color bg,
            TextAlign align = TextAlign::TOP_LEFT) const {
    const size_t first = (size_t) page * per_page;
    for (size_t k = first; k < lines.size() && k < first + per_page; k++)
      it.print(x, y + line_h * (int) (k - first), f, c, align, lines[k].c_str(), bg);
  }
};

// ----------------------------------------------------------------- shapes --

inline Color mix(Color fg, Color bg, float a) {
  if (a >= 1.0f) return fg;
  if (a <= 0.0f) return bg;
  return Color((uint8_t) (bg.r + (fg.r - bg.r) * a), (uint8_t) (bg.g + (fg.g - bg.g) * a),
               (uint8_t) (bg.b + (fg.b - bg.b) * a));
}

// How much of the pixel centred at (px, py) lies inside the circle.
inline float cover(float px, float py, float cx, float cy, float r) {
  const float d = sqrtf((px - cx) * (px - cx) + (py - cy) * (py - cy));
  const float a = r - d + 0.5f;
  return a < 0.0f ? 0.0f : a > 1.0f ? 1.0f : a;
}

// A filled circle with soft edges, blended against `bg`.
inline void circle(Display &it, float cx, float cy, float r, Color fill, Color bg) {
  const int y0 = (int) floorf(cy - r - 1), y1 = (int) ceilf(cy + r + 1);
  const int x0 = (int) floorf(cx - r - 1), x1 = (int) ceilf(cx + r + 1);
  for (int y = y0; y <= y1; y++) {
    int run = -1;
    for (int x = x0; x <= x1 + 1; x++) {
      const float a = x <= x1 ? cover(x + 0.5f, y + 0.5f, cx, cy, r) : 0.0f;
      if (a >= 1.0f) {
        if (run < 0) run = x;
        continue;
      }
      if (run >= 0) {
        it.horizontal_line(run, y, x - run, fill);
        run = -1;
      }
      if (a > 0.0f) it.draw_pixel_at(x, y, mix(fill, bg, a));
    }
  }
}

// A filled rectangle with round, soft corners; r = h / 2 gives a pill.
inline void round_rect(Display &it, int x, int y, int w, int h, int r, Color fill, Color bg) {
  if (2 * r > h) r = h / 2;
  if (2 * r > w) r = w / 2;
  it.filled_rectangle(x + r, y, w - 2 * r, h, fill);
  it.filled_rectangle(x, y + r, r, h - 2 * r, fill);
  it.filled_rectangle(x + w - r, y + r, r, h - 2 * r, fill);
  for (int dy = 0; dy < r; dy++)
    for (int dx = 0; dx < r; dx++) {
      const float a = cover(dx + 0.5f, dy + 0.5f, (float) r, (float) r, (float) r);
      if (a <= 0.0f) continue;
      const Color c = mix(fill, bg, a);
      it.draw_pixel_at(x + dx, y + dy, c);
      it.draw_pixel_at(x + w - 1 - dx, y + dy, c);
      it.draw_pixel_at(x + dx, y + h - 1 - dy, c);
      it.draw_pixel_at(x + w - 1 - dx, y + h - 1 - dy, c);
    }
}

// Paints the corners outside a rounded rectangle in `bg` (for photos).
inline void round_corners(Display &it, int x, int y, int w, int h, int r, Color bg) {
  for (int dy = 0; dy < r; dy++)
    for (int dx = 0; dx < r; dx++) {
      if (cover(dx + 0.5f, dy + 0.5f, (float) r, (float) r, (float) r) >= 0.5f) continue;
      it.draw_pixel_at(x + dx, y + dy, bg);
      it.draw_pixel_at(x + w - 1 - dx, y + dy, bg);
      it.draw_pixel_at(x + dx, y + h - 1 - dy, bg);
      it.draw_pixel_at(x + w - 1 - dx, y + h - 1 - dy, bg);
    }
}

// Small dots that show which page of a long text is up.
inline void page_dots(Display &it, int right, int y, int pages, int current, Color on, Color off, Color bg) {
  if (pages <= 1) return;
  if (pages > 8) pages = 8;
  const int x = right - (pages - 1) * 10;
  for (int p = 0; p < pages; p++) circle(it, (float) (x + p * 10), (float) y, 2.6f, p == current ? on : off, bg);
}

// ----------------------------------------------------------------- scenes --
//
// draw_scene() draws what muse_draw parsed (muse_scene.h). Everything here clips to
// the screen itself: ESPHome checks every single pixel, so a shape of 2000 px that is
// mostly off screen would otherwise cost its whole area on every refresh. Soft edges
// and translucent shapes blend against scene::under(), the colour below them, sampled
// once per row.

struct SceneAssets {
  esphome::font::Font *text[6];   // xs, s, m, l, xl, xxl (scene::TEXT_PX)
  esphome::font::Font *icons[2];  // s, l (scene::ICON_PX)
  esphome::animation::Animation *figure[4];  // idle, wave, working, making
  esphome::image::Image *avatar;
};

inline Color rgb(scene::Rgb c) { return Color(c.r, c.g, c.b); }

// Direct writes into the frame buffer of the box's display. ESPHome sets every pixel
// through a virtual call with clipping, colour conversion and a compare: a gradient
// over the whole screen took about 100 ms per picture that way, and a scene ran at 6.7
// instead of 10 pictures a second (07.10.2026). Spans written here go straight into
// the driver's 16-bit buffer (big endian, as the driver writes it) and widen its dirty
// rectangle, so the driver sends them like its own. The members are protected; a
// class derived from the driver may name them, and the member pointers it hands out
// work on the real display object. Without a 16-bit buffer, or rotated, everything
// falls back to the driver.
struct Lcd : esphome::ili9xxx::ILI9XXXDisplay {
  static auto buffer() { return &Lcd::buffer_; }
  static auto mode() { return &Lcd::buffer_color_mode_; }
  static auto width() { return &Lcd::width_; }
  static auto height() { return &Lcd::height_; }
  static auto x_low() { return &Lcd::x_low_; }
  static auto y_low() { return &Lcd::y_low_; }
  static auto x_high() { return &Lcd::x_high_; }
  static auto y_high() { return &Lcd::y_high_; }
};

struct Fast {
  esphome::ili9xxx::ILI9XXXDisplay *lcd = nullptr;
  uint8_t *buf = nullptr;  // nullptr: no direct writes, use the driver
  int w = 0, h = 0;
  void dirty(int x0, int y0, int x1, int y1) {  // inclusive
    auto &xl = lcd->*Lcd::x_low();
    auto &yl = lcd->*Lcd::y_low();
    auto &xh = lcd->*Lcd::x_high();
    auto &yh = lcd->*Lcd::y_high();
    if (x0 < xl) xl = x0;
    if (y0 < yl) yl = y0;
    if (x1 > xh) xh = x1;
    if (y1 > yh) yh = y1;
  }
};

inline Fast &fast() {
  static Fast f;
  return f;
}

// Pixels x0 .. x1 - 1 of row y in one colour, clipped.
inline void span(Display &it, int x0, int x1, int y, Color c) {
  Fast &f = fast();
  if (f.buf == nullptr) {
    x0 = std::max(x0, 0);
    x1 = std::min(x1, it.get_width());
    if (x1 > x0 && y >= 0 && y < it.get_height()) it.horizontal_line(x0, y, x1 - x0, c);
    return;
  }
  if (y < 0 || y >= f.h) return;
  x0 = std::max(x0, 0);
  x1 = std::min(x1, f.w);
  if (x1 <= x0) return;
  const uint16_t v = esphome::display::ColorUtil::color_to_565(c);
  const uint8_t hi = v >> 8, lo = v & 0xFF;
  uint8_t *p = f.buf + ((size_t) y * f.w + x0) * 2;
  for (int x = x0; x < x1; x++) {
    *p++ = hi;
    *p++ = lo;
  }
  f.dirty(x0, y, x1 - 1, y);
}

// Pixels y0 .. y1 - 1 of column x in one colour, clipped.
inline void vspan(Display &it, int x, int y0, int y1, Color c) {
  Fast &f = fast();
  if (f.buf == nullptr) {
    y0 = std::max(y0, 0);
    y1 = std::min(y1, it.get_height());
    if (y1 > y0 && x >= 0 && x < it.get_width()) it.vertical_line(x, y0, y1 - y0, c);
    return;
  }
  if (x < 0 || x >= f.w) return;
  y0 = std::max(y0, 0);
  y1 = std::min(y1, f.h);
  if (y1 <= y0) return;
  const uint16_t v = esphome::display::ColorUtil::color_to_565(c);
  for (int y = y0; y < y1; y++) {
    uint8_t *p = f.buf + ((size_t) y * f.w + x) * 2;
    p[0] = v >> 8;
    p[1] = v & 0xFF;
  }
  f.dirty(x, y0, x, y1 - 1);
}

inline void fast_fill(Display &it, Color c) {
  if (fast().buf == nullptr) {
    it.fill(c);
    return;
  }
  for (int y = 0; y < fast().h; y++) span(it, 0, fast().w, y, c);
}

// Switches the direct writes on for whatever draws next (scenes, photos, route maps)
// and off again; without a 16-bit buffer, or rotated, everything goes through the driver.
inline void fast_begin(Display &it, esphome::ili9xxx::ILI9XXXDisplay *lcd) {
  Fast &f = fast();
  f.lcd = lcd;
  f.buf = nullptr;
  if (lcd != nullptr && it.get_rotation() == esphome::display::DISPLAY_ROTATION_0_DEGREES &&
      lcd->*Lcd::mode() == esphome::ili9xxx::BITS_16) {
    f.buf = lcd->*Lcd::buffer();
    f.w = lcd->*Lcd::width();
    f.h = lcd->*Lcd::height();
  }
}

inline void fast_end() { fast().buf = nullptr; }

// A picture in RGB565 big endian (muse_media.h), copied row by row at (x0, y0), clipped.
inline void blit(Display &it, const uint8_t *px, int w, int h, int x0, int y0) {
  Fast &f = fast();
  if (px == nullptr || w <= 0 || h <= 0) return;
  if (f.buf == nullptr) {
    for (int y = 0; y < h; y++)
      for (int x = 0; x < w; x++) {
        const uint8_t *p = px + ((size_t) y * w + x) * 2;
        const uint16_t c = (p[0] << 8) | p[1];
        it.draw_pixel_at(x0 + x, y0 + y, Color((c >> 8) & 0xF8, (c >> 3) & 0xFC, (c << 3) & 0xF8));
      }
    return;
  }
  const int xa = std::max(x0, 0), xb = std::min(x0 + w, f.w), ya = std::max(y0, 0), yb = std::min(y0 + h, f.h);
  if (xa >= xb || ya >= yb) return;
  for (int y = ya; y < yb; y++)
    memcpy(f.buf + ((size_t) y * f.w + xa) * 2, px + ((size_t) (y - y0) * w + (xa - x0)) * 2, (size_t) (xb - xa) * 2);
  f.dirty(xa, ya, xb - 1, yb - 1);
}

// An opaque RGB565 picture (Muse's figure) copied row by row. The picture stores each
// pixel little endian, the buffer big endian, hence the swap.
inline void fast_image(Display &it, esphome::image::Image *img, int x0, int y0) {
  Fast &f = fast();
  if (f.buf == nullptr || img->get_type() != esphome::image::IMAGE_TYPE_RGB565 || img->has_transparency() ||
      img->get_bpp() != 16) {
    it.image(x0, y0, img);
    return;
  }
  const int w = img->get_width(), h = img->get_height();
  const int xa = std::max(x0, 0), xb = std::min(x0 + w, f.w), ya = std::max(y0, 0), yb = std::min(y0 + h, f.h);
  if (xa >= xb || ya >= yb) return;
  const uint8_t *data = img->get_data_start();
  for (int y = ya; y < yb; y++) {
    const uint8_t *src = data + ((size_t) (y - y0) * w + (xa - x0)) * 2;
    uint8_t *dst = f.buf + ((size_t) y * f.w + xa) * 2;
    for (int x = xa; x < xb; x++, src += 2, dst += 2) {
      dst[0] = src[1];
      dst[1] = src[0];
    }
  }
  f.dirty(xa, ya, xb - 1, yb - 1);
}

inline std::string utf8(uint32_t cp) {
  std::string s;
  if (cp < 0x80) {
    s += (char) cp;
  } else if (cp < 0x800) {
    s += (char) (0xC0 | (cp >> 6));
    s += (char) (0x80 | (cp & 0x3F));
  } else if (cp < 0x10000) {
    s += (char) (0xE0 | (cp >> 12));
    s += (char) (0x80 | ((cp >> 6) & 0x3F));
    s += (char) (0x80 | (cp & 0x3F));
  } else {
    s += (char) (0xF0 | (cp >> 18));
    s += (char) (0x80 | ((cp >> 12) & 0x3F));
    s += (char) (0x80 | ((cp >> 6) & 0x3F));
    s += (char) (0x80 | (cp & 0x3F));
  }
  return s;
}

// What `font` can draw of a scene text, line breaks included. Unlike clean() it keeps
// stars and hashes: in a scene they are meant, not Markdown.
inline std::string drawable(const std::string &in, const esphome::font::Font *font) {
  std::string out;
  size_t i = 0;
  uint32_t cp;
  while (size_t n = utf8_next(in, i, &cp)) {
    const size_t at = i;
    i += n;
    if (cp == '\r') continue;
    if (cp == '\n') {
      out += '\n';
      continue;
    }
    if (cp == '\t' || cp == 0xA0 || cp == 0x2009 || cp == 0x202F) cp = ' ';
    if (cp == 0x2212) cp = '-';
    if (cp != ' ' && font->find_glyph(cp) == nullptr) continue;
    if (cp == ' ' || cp == '-') out += (char) cp;
    else out.append(in, at, n);
  }
  return out;
}

// {time}, {date} and {weekday} in a scene text, in German.
inline std::string fill_placeholders(const std::string &in, const esphome::ESPTime &now) {
  if (in.find('{') == std::string::npos) return in;
  static const char *const DAYS[] = {"Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"};
  static const char *const MONTHS[] = {"Januar", "Februar", "März", "April", "Mai", "Juni",
                                       "Juli", "August", "September", "Oktober", "November", "Dezember"};
  const bool ok = now.is_valid();
  char time_s[8] = "--:--";
  if (ok) snprintf(time_s, sizeof(time_s), "%02d:%02d", now.hour, now.minute);
  const std::string date = ok ? std::to_string(now.day_of_month) + ". " + MONTHS[(now.month + 11) % 12] : "";
  const std::string day = ok ? DAYS[(now.day_of_week + 6) % 7] : "";
  std::string out = in;
  struct Rep {
    const char *key;
    std::string value;
  };
  const Rep reps[] = {{"{time}", time_s}, {"{date}", date}, {"{weekday}", day}};
  for (const auto &r : reps)
    for (size_t at = out.find(r.key); at != std::string::npos; at = out.find(r.key, at + r.value.size()))
      out.replace(at, strlen(r.key), r.value);
  return out;
}

// A filled triangle, clipped to the screen: one span per row through its three edges.
inline void fill_tri(Display &it, float x1, float y1, float x2, float y2, float x3, float y3, Color c) {
  const int W = it.get_width(), H = it.get_height();
  const float ymin = std::min({y1, y2, y3}), ymax = std::max({y1, y2, y3});
  const int ya = std::max(0, (int) ceilf(ymin - 0.5f)), yb = std::min(H - 1, (int) floorf(ymax - 0.5f));
  for (int y = ya; y <= yb; y++) {
    const float yc = y + 0.5f;
    float xs[3];
    int n = 0;
    auto edge = [&](float ax, float ay, float bx, float by) {
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs[n++] = ax + (yc - ay) * (bx - ax) / (by - ay);
    };
    edge(x1, y1, x2, y2);
    edge(x2, y2, x3, y3);
    edge(x3, y3, x1, y1);
    if (n < 2) continue;
    const float l = std::min(xs[0], xs[1]), r = std::max(xs[0], xs[1]);
    const int xa = std::max(0, (int) ceilf(l - 0.5f)), xb = std::min(W - 1, (int) floorf(r - 0.5f));
    if (xb >= xa) span(it, xa, xb + 1, y, c);
  }
}

// A filled disc without soft edges, clipped (round line caps, small particles).
inline void fill_disc(Display &it, float cx, float cy, float r, Color c) {
  const int W = it.get_width(), H = it.get_height();
  const int ya = std::max(0, (int) floorf(cy - r)), yb = std::min(H - 1, (int) ceilf(cy + r));
  for (int y = ya; y <= yb; y++) {
    const float dy = y + 0.5f - cy;
    if (fabsf(dy) > r) continue;
    const float h = sqrtf(r * r - dy * dy);
    const int xa = std::max(0, (int) ceilf(cx - h - 0.5f)), xb = std::min(W - 1, (int) floorf(cx + h - 0.5f));
    if (xb >= xa) span(it, xa, xb + 1, y, c);
  }
}

// A line `w` px wide: a quad of two triangles with round caps.
inline void thick_line(Display &it, float x1, float y1, float x2, float y2, float w, Color c) {
  const float dx = x2 - x1, dy = y2 - y1, len = sqrtf(dx * dx + dy * dy);
  if (w <= 1.0f || len < 0.01f) {
    if (len < 0.01f) fill_disc(it, x1, y1, std::max(0.5f, w / 2), c);
    else it.line((int) lroundf(x1), (int) lroundf(y1), (int) lroundf(x2), (int) lroundf(y2), c);
    return;
  }
  const float nx = -dy / len * w / 2, ny = dx / len * w / 2;
  fill_tri(it, x1 + nx, y1 + ny, x2 + nx, y2 + ny, x2 - nx, y2 - ny, c);
  fill_tri(it, x1 + nx, y1 + ny, x2 - nx, y2 - ny, x1 - nx, y1 - ny, c);
  fill_disc(it, x1, y1, w / 2, c);
  fill_disc(it, x2, y2, w / 2, c);
}

// A rectangle with round, soft corners, filled or as an outline of `stroke` px, clipped.
// `under(x, y)` gives the colour below a point; translucent rows blend against it.
template <typename Under>
inline void scene_rect(Display &it, int x, int y, int w, int h, int r, int stroke, Color fill, float a, Under under) {
  const int W = it.get_width(), H = it.get_height();
  if (r < 0 || 2 * r > std::min(w, h)) r = std::min(w, h) / 2;
  const int n = stroke > 0 ? std::min(stroke, std::min(w, h) / 2) : 0;
  const int ya = std::max(y, 0), yb = std::min(y + h, H);
  auto row = [&](int x0, int x1, int yy, Color c) { span(it, x0, x1, yy, c); };  // [x0, x1)
  for (int yy = ya; yy < yb; yy++) {
    const float yc = yy + 0.5f;
    const Color body = a >= 1.0f ? fill : mix(fill, under(x + w * 0.5f, yc), a);
    const int d = std::min(yy - y, y + h - 1 - yy);  // rows from the nearer edge
    if (d < r) {
      // A corner row: soft corner pixels, and between them the edge or the inside.
      const Color ul = under(x + 0.5f, yc), ur = under(x + w - 0.5f, yc);
      const float ri = (float) (r - n);
      for (int dx = 0; dx < r; dx++) {
        float c = cover(dx + 0.5f, d + 0.5f, (float) r, (float) r, (float) r);
        if (n > 0 && ri > 0) c -= cover(dx + 0.5f, d + 0.5f, (float) r, (float) r, ri);
        if (c <= 0.0f) continue;
        const int lx = x + dx, rx = x + w - 1 - dx;
        if (lx >= 0 && lx < W) it.draw_pixel_at(lx, yy, c >= 1.0f ? body : mix(body, ul, c));
        if (rx >= 0 && rx < W && rx != lx) it.draw_pixel_at(rx, yy, c >= 1.0f ? body : mix(body, ur, c));
      }
      if (n == 0 || d < n) row(x + r, x + w - r, yy, body);
    } else if (n == 0 || d < n) {
      row(x, x + w, yy, body);
    } else {
      row(x, x + n, yy, body);
      row(x + w - n, x + w, yy, body);
    }
  }
}

// A circle with soft edges, filled or as a ring of `stroke` px, clipped.
template <typename Under>
inline void scene_circle(Display &it, float cx, float cy, float r, int stroke, Color fill, float a, Under under) {
  const int W = it.get_width(), H = it.get_height();
  const bool ring = stroke > 0 && stroke < r;
  const float ri = ring ? r - stroke : 0.0f;
  const int ya = std::max(0, (int) floorf(cy - r - 1)), yb = std::min(H - 1, (int) ceilf(cy + r + 1));
  for (int y = ya; y <= yb; y++) {
    const float yc = y + 0.5f, dy = yc - cy;
    if (fabsf(dy) > r + 0.5f) continue;
    const float ho = sqrtf(std::max(0.0f, r * r - dy * dy));
    const float hi = ring && fabsf(dy) < ri ? sqrtf(ri * ri - dy * dy) : 0.0f;
    const Color inside = under(cx, yc);
    const Color body = a >= 1.0f ? fill : mix(fill, inside, a);
    const Color ul = under(cx - ho, yc), ur = under(cx + ho, yc);
    auto pixel = [&](int x) {
      if (x < 0 || x >= W) return;
      float c = cover(x + 0.5f, yc, cx, cy, r);
      if (ring) c -= cover(x + 0.5f, yc, cx, cy, ri);
      if (c <= 0.0f) return;
      const float dd = sqrtf((x + 0.5f - cx) * (x + 0.5f - cx) + dy * dy);
      const Color edge = ring && dd < (r + ri) * 0.5f ? inside : (x + 0.5f < cx ? ul : ur);
      it.draw_pixel_at(x, y, c >= 1.0f ? body : mix(body, edge, c));
    };
    if (!ring || hi <= 0.0f) {
      if (ring) {  // a row above or below the hole: the whole width, pixel by pixel
        for (int x = (int) floorf(cx - ho - 1); x <= (int) ceilf(cx + ho + 1); x++) pixel(x);
        continue;
      }
      const int l1 = (int) ceilf(cx - ho + 1), r0 = (int) floorf(cx + ho - 1);
      for (int x = (int) floorf(cx - ho - 1); x < l1; x++) pixel(x);
      if (r0 > l1) span(it, l1, r0, y, body);
      for (int x = std::max(r0, l1); x <= (int) ceilf(cx + ho + 1); x++) pixel(x);
    } else {
      for (int x = (int) floorf(cx - ho - 1); x <= (int) ceilf(cx - hi + 1); x++) pixel(x);
      for (int x = (int) floorf(cx + hi - 1); x <= (int) ceilf(cx + ho + 1); x++) pixel(x);
    }
  }
}

// The points of a star (2 * points corners) or of a regular polygon around (cx, cy).
inline std::vector<std::pair<float, float>> outline_points(float cx, float cy, float r, int points, float inner,
                                                          float deg, bool star) {
  std::vector<std::pair<float, float>> p;
  const int n = star ? points * 2 : points;
  const float start = (deg - 90.0f) * 0.017453293f;  // first point straight up
  for (int i = 0; i < n; i++) {
    const float a = start + 6.2831853f * i / n;
    const float rr = star && (i % 2 == 1) ? r * inner : r;
    p.push_back({cx + rr * cosf(a), cy + rr * sinf(a)});
  }
  return p;
}

inline float rnd(uint32_t a, uint32_t b) {  // 0 .. 1, the same for the same a and b
  uint32_t h = a * 2654435761u ^ (b * 2246822519u + 0x9E3779B9u);
  h ^= h >> 15;
  h *= 2246822519u;
  h ^= h >> 13;
  h *= 3266489917u;
  h ^= h >> 16;
  return (float) (h & 0xFFFFFF) / 16777216.0f;
}

// Lines of a scene text: wrapped to `w`, cut to `lines` with "…".
inline std::vector<std::string> scene_lines(Display &it, const scene::Item &item, const std::string &text,
                                            esphome::font::Font *font) {
  const std::string clean = drawable(text, font);
  std::vector<std::string> lines;
  if (item.wrap > 0) {
    lines = wrap(it, clean, font, item.wrap);
  } else {
    size_t start = 0;
    while (start <= clean.size()) {
      size_t nl = clean.find('\n', start);
      if (nl == std::string::npos) nl = clean.size();
      lines.push_back(clean.substr(start, nl - start));
      start = nl + 1;
    }
  }
  if (item.max_lines > 0 && (int) lines.size() > item.max_lines) {
    lines.resize(item.max_lines);
    const std::string ell = font->find_glyph(0x2026) != nullptr ? "…" : "...";
    const int max_w = item.wrap > 0 ? item.wrap : 100000;
    lines.back() = fit_line(lines.back() + ell, max_w, [&](const std::string &s) { return text_width(it, s, font); }, ell);
  }
  return lines;
}

// Particles: confetti and snow fall, rain falls fast, bubbles rise, sparkles twinkle in
// place. Positions come from rnd(), so every refresh agrees with the one before.
template <typename Under>
inline void scene_particles(Display &it, const scene::Item &p, size_t index, uint32_t t, float dx, float dy, float a,
                            const SceneAssets &assets, Under under) {
  static const Color PALETTE[] = {Color(255, 59, 48),  Color(255, 149, 0), Color(255, 204, 0), Color(52, 199, 89),
                                  Color(48, 176, 199), Color(0, 122, 255), Color(175, 82, 222), Color(255, 45, 85)};
  const Color fallback[] = {Color(255, 59, 48), Color(255, 255, 255), Color(120, 170, 255), Color(255, 214, 10),
                            Color(200, 230, 255)};
  const float ax = p.x + dx, ay = p.y + dy, aw = p.w, ah = p.h;
  const float secs = t / 1000.0f * p.speed;
  const std::string glyph = p.glyph != 0 ? utf8(p.glyph) : "";
  for (int i = 0; i < p.count; i++) {
    const uint32_t seed = (uint32_t) index * 977u + (uint32_t) i;
    const float r1 = rnd(seed, 1), r2 = rnd(seed, 2), r3 = rnd(seed, 3), r4 = rnd(seed, 4);
    Color c = p.has_color ? rgb(p.color) : p.sub == scene::P_CONFETTI ? PALETTE[i % 8] : fallback[p.sub];
    float x, y, size = 1.0f;
    if (p.sub == scene::P_SPARKLE) {
      x = ax + r1 * aw;
      y = ay + r2 * ah;
      const float tw = sinf(secs * 2.6f + r3 * 6.2831853f);
      size = tw > 0 ? tw * tw : 0.0f;
      if (size < 0.05f) continue;
    } else {
      const float range = ah + 24.0f;
      const float v = p.sub == scene::P_RAIN ? 140 + r2 * 80 : p.sub == scene::P_SNOW ? 12 + r2 * 18
                      : p.sub == scene::P_BUBBLES ? 15 + r2 * 20 : 30 + r2 * 40;
      float travel = fmodf(r3 * range + v * secs, range);
      y = p.sub == scene::P_BUBBLES ? ay + ah + 12 - travel : ay - 12 + travel;
      const float sway = p.sub == scene::P_RAIN ? -0.25f * travel : 7.0f * sinf(secs * 1.3f + r4 * 6.2831853f);
      x = ax + r1 * aw + sway;
    }
    const Color below = under(x, y);
    const float vis = a * size;
    if (!glyph.empty()) {
      it.print((int) x, (int) y, assets.icons[p.size], vis >= 1.0f ? c : mix(c, below, vis), TextAlign::CENTER,
               glyph.c_str(), below);
      continue;
    }
    c = vis >= 1.0f ? c : mix(c, below, vis);
    switch (p.sub) {
      case scene::P_CONFETTI: {
        const float flutter = fabsf(sinf(secs * 4.0f + r4 * 6.2831853f));
        const int w = 2 + (int) (4 * flutter), h = 6;
        if (x + w >= 0 && x < it.get_width() && y + h >= 0 && y < it.get_height())
          it.filled_rectangle((int) x, (int) y, w, h, c);
        break;
      }
      case scene::P_SNOW:
        circle(it, x, y, 1.2f + r4 * 2.0f, c, below);
        break;
      case scene::P_RAIN:
        thick_line(it, x, y, x - 2, y + 9, 1, c);
        break;
      case scene::P_SPARKLE: {
        const float s = 2 + 5 * size;
        thick_line(it, x - s, y, x + s, y, 1, c);
        thick_line(it, x, y - s, x, y + s, 1, c);
        circle(it, x, y, 1.3f, c, below);
        break;
      }
      case scene::P_BUBBLES:
        scene_circle(it, x, y, 3 + r4 * 5, 1, c, 1.0f, [&](float, float) { return below; });
        break;
    }
  }
}

// Draws the scene `t` ms after it started. `version` changes with every new scene;
// `lcd` is the display driver behind `it`, for the direct writes (Fast).
inline void draw_scene(Display &it, esphome::ili9xxx::ILI9XXXDisplay *lcd, const scene::Scene &s, uint32_t version,
                       uint32_t t, const esphome::ESPTime &clock, const SceneAssets &assets) {
  struct Prepared {
    std::vector<std::string> lines;
    std::vector<int> widths;
    std::string filled;  // the text with placeholders filled, for texts that change
  };
  static uint32_t seen = UINT32_MAX, next_draw = 0, max_us = 0, draws = 0;
  static bool reported = false, warned = false;
  static std::vector<Prepared> prepared;
  const uint32_t now = esphome::millis();
  auto prepare = [&](size_t k, const std::string &text) {
    const scene::Item &item = s.items[k];
    esphome::font::Font *font = assets.text[item.size];
    Prepared &p = prepared[k];
    p.filled = text;
    p.lines = scene_lines(it, item, text, font);
    p.widths.clear();
    for (const auto &l : p.lines) p.widths.push_back(text_width(it, l, font));
  };
  if (version != seen) {
    seen = version;
    next_draw = 0;
    max_us = 0;
    draws = 0;
    reported = false;
    warned = false;
    prepared.assign(s.items.size(), Prepared{});
    for (size_t k = 0; k < s.items.size(); k++)
      if (s.items[k].kind == scene::TEXT) prepare(k, fill_placeholders(s.items[k].text, clock));
  }
  // A scene that takes longer than a refresh is drawn less often instead of holding up
  // the box: the next picture waits as long as the last one took.
  if ((int32_t) (now - next_draw) < 0) return;
  const uint32_t started = esphome::micros();
  const int frame = s.frame_at(t);

  Fast &f = fast();
  f.lcd = lcd;
  f.buf = nullptr;
  if (lcd != nullptr && it.get_rotation() == esphome::display::DISPLAY_ROTATION_0_DEGREES &&
      lcd->*Lcd::mode() == esphome::ili9xxx::BITS_16) {
    f.buf = lcd->*Lcd::buffer();
    f.w = lcd->*Lcd::width();
    f.h = lcd->*Lcd::height();
  }
  // The page colour first, unless an opaque background covers it anyway.
  const bool covered = !s.items.empty() && s.items[0].kind == scene::BG && scene::visible(s.items[0], t, frame) &&
                       scene::alpha(s.items[0], t) >= 1.0f;
  if (!covered) fast_fill(it, rgb(scene::PAGE));
  for (size_t k = 0; k < s.items.size(); k++) {
    const scene::Item &item = s.items[k];
    if (!scene::visible(item, t, frame)) continue;
    const float a = scene::alpha(item, t);
    if (a <= 0.0f) continue;
    float dx, dy;
    scene::offset(item, t, &dx, &dy);
    auto under = [&](float px, float py) { return rgb(scene::under(s, k, px, py, t, frame)); };
    const Color c = rgb(item.color);
    const float x = item.x + dx, y = item.y + dy;
    switch (item.kind) {
      case scene::BG: {
        const int W = it.get_width(), H = it.get_height();
        if (!item.gradient && a >= 1.0f) {
          fast_fill(it, c);
          break;
        }
        const int n = item.horizontal ? W : H;
        for (int i = 0; i < n; i++) {
          Color row = rgb(scene::bg_at(item, item.horizontal ? i + 0.5f : 0.0f, item.horizontal ? 0.0f : i + 0.5f));
          if (a < 1.0f) row = mix(row, item.horizontal ? under(i + 0.5f, H / 2.0f) : under(W / 2.0f, i + 0.5f), a);
          if (item.horizontal) vspan(it, i, 0, H, row);
          else span(it, 0, W, i, row);
        }
        break;
      }
      case scene::RECT:
        scene_rect(it, (int) lroundf(x), (int) lroundf(y), (int) lroundf(item.w), (int) lroundf(item.h), item.radius,
                   item.stroke, c, a, under);
        break;
      case scene::CIRCLE:
        scene_circle(it, x, y, item.r * scene::scale(item, t), item.stroke, c, a, under);
        break;
      case scene::LINE: {
        const Color lc = a >= 1.0f ? c : mix(c, under((x + item.x2 + dx) / 2, (y + item.y2 + dy) / 2), a);
        thick_line(it, x, y, item.x2 + dx, item.y2 + dy, (float) item.stroke, lc);
        break;
      }
      case scene::TRI: {
        const float x2 = item.x2 + dx, y2 = item.y2 + dy, x3 = item.x3 + dx, y3 = item.y3 + dy;
        const Color tc = a >= 1.0f ? c : mix(c, under((x + x2 + x3) / 3, (y + y2 + y3) / 3), a);
        if (item.stroke > 0) {
          thick_line(it, x, y, x2, y2, (float) item.stroke, tc);
          thick_line(it, x2, y2, x3, y3, (float) item.stroke, tc);
          thick_line(it, x3, y3, x, y, (float) item.stroke, tc);
        } else {
          fill_tri(it, x, y, x2, y2, x3, y3, tc);
        }
        break;
      }
      case scene::STAR:
      case scene::POLY: {
        const bool star = item.kind == scene::STAR;
        const auto pts = outline_points(x, y, item.r * scene::scale(item, t), item.points, item.inner,
                                        scene::angle(item, t), star);
        const Color sc = a >= 1.0f ? c : mix(c, under(x, y), a);
        for (size_t i = 0; i < pts.size(); i++) {
          const auto &p1 = pts[i], &p2 = pts[(i + 1) % pts.size()];
          if (item.stroke > 0) thick_line(it, p1.first, p1.second, p2.first, p2.second, (float) item.stroke, sc);
          else fill_tri(it, x, y, p1.first, p1.second, p2.first, p2.second, sc);
        }
        break;
      }
      case scene::TEXT: {
        esphome::font::Font *font = assets.text[item.size];
        if (item.text.find('{') != std::string::npos) {
          const std::string filled = fill_placeholders(item.text, clock);
          if (filled != prepared[k].filled) prepare(k, filled);
        }
        const Prepared &p = prepared[k];
        const int lh = item.line_h > 0 ? item.line_h : (int) lroundf(scene::TEXT_PX[item.size] * 1.3f);
        const int block = (int) p.lines.size() * lh;
        const float top = item.valign == 1 ? y - block / 2.0f : item.valign == 2 ? y - block : y;
        const TextAlign align = item.align == 1 ? TextAlign::TOP_CENTER
                                : item.align == 2 ? TextAlign::TOP_RIGHT : TextAlign::TOP_LEFT;
        size_t budget = scene::typed(item, t);
        for (size_t i = 0; i < p.lines.size() && budget > 0; i++) {
          std::string line = p.lines[i];
          if (budget != SIZE_MAX) {
            const auto ends = char_ends(line);
            if (ends.size() > budget) line = line.substr(0, ends[budget - 1]);
            budget = ends.size() >= budget ? 0 : budget - ends.size();
          }
          if (line.empty()) continue;
          const float ly = top + i * lh;
          const float mid = item.align == 1 ? x : item.align == 2 ? x - p.widths[i] / 2.0f : x + p.widths[i] / 2.0f;
          const Color below = under(mid, ly + lh / 2.0f);
          it.print((int) lroundf(x), (int) lroundf(ly), font, a >= 1.0f ? c : mix(c, below, a), align, line.c_str(),
                   below);
        }
        break;
      }
      case scene::ICON: {
        const Color below = under(x, y);
        it.print((int) lroundf(x), (int) lroundf(y), assets.icons[item.size], a >= 1.0f ? c : mix(c, below, a),
                 TextAlign::CENTER, utf8(item.glyph).c_str(), below);
        break;
      }
      case scene::FIGURE: {
        // Muse in a round frame: the picture's square corners are painted over with
        // what lies below, so it sits on any background.
        esphome::image::Image *img = assets.avatar;
        if (item.sub < scene::F_AVATAR) {
          auto *anim = assets.figure[item.sub];
          const int frames = anim->get_animation_frame_count();
          if (frames > 1) {
            const int cycle = 2 * (frames - 1);
            const int step = (int) ((t / 160) % (uint32_t) cycle);
            anim->set_frame(step < frames ? step : cycle - step);
          }
          img = anim;
        }
        const int w = img->get_width(), h = img->get_height();
        const int x0 = (int) lroundf(x - w / 2.0f), y0 = (int) lroundf(y - h / 2.0f);
        fast_image(it, img, x0, y0);
        const float rr = std::min(item.r, std::min(w, h) / 2.0f);
        const Color page = rgb(scene::PAGE);
        const int W = it.get_width(), H = it.get_height();
        for (int yy = std::max(0, y0); yy < std::min(H, y0 + h); yy++) {
          const float yc = yy + 0.5f, ddy = yc - y;
          const Color ul = under(x0 + 0.5f, yc), ur = under(x0 + w - 0.5f, yc);
          const float hw = fabsf(ddy) < rr ? sqrtf(rr * rr - ddy * ddy) : -1.0f;
          const int split = (int) lroundf(x);
          if (hw < 0) {
            span(it, x0, split, yy, ul);
            span(it, split, x0 + w, yy, ur);
            continue;
          }
          const int in_l = (int) floorf(x - hw - 1), in_r = (int) ceilf(x + hw + 1);
          span(it, x0, in_l, yy, ul);
          span(it, in_r + 1, x0 + w, yy, ur);
          for (int xx : {in_l, in_l + 1, in_l + 2, in_r - 2, in_r - 1, in_r}) {
            if (xx < std::max(x0, 0) || xx >= std::min(x0 + w, W)) continue;
            const float cv = cover(xx + 0.5f, yc, x, y, rr);
            if (cv >= 1.0f) continue;
            it.draw_pixel_at(xx, yy, mix(page, xx + 0.5f < x ? ul : ur, cv));
          }
        }
        break;
      }
      case scene::BAR: {
        const int bx = (int) lroundf(x), by = (int) lroundf(y), bw = (int) lroundf(item.w), bh = (int) lroundf(item.h);
        const int r = item.radius < 0 || item.radius * 2 > bh ? bh / 2 : item.radius;
        scene_rect(it, bx, by, bw, bh, r, 0, rgb(item.color2), a, under);
        const int fw = (int) lroundf(bw * item.value / 100.0f);
        if (fw > 0) scene_rect(it, bx, by, std::max(fw, std::min(2 * r, bw)), bh, r, 0, c, a, under);
        break;
      }
      case scene::PARTICLES:
        scene_particles(it, item, k, t, dx, dy, a, assets, under);
        break;
      case scene::BUTTON: {
        // A pill with its text centred; a touch on it answers with the text (button_at).
        const int bx = (int) lroundf(x), by = (int) lroundf(y), bw = (int) lroundf(item.w), bh = (int) lroundf(item.h);
        scene_rect(it, bx, by, bw, bh, item.radius, 0, c, a, under);
        esphome::font::Font *font = assets.text[item.size];
        const std::string label = fit_line(drawable(item.text, font), bw - 16,
                                           [&](const std::string &q) { return text_width(it, q, font); },
                                           font->find_glyph(0x2026) != nullptr ? "\u2026" : "...");
        const Color body = a >= 1.0f ? c : mix(c, under(x + bw / 2.0f, y + bh / 2.0f), a);
        const bool dark = (c.r * 299 + c.g * 587 + c.b * 114) / 1000 < 150;
        it.print(bx + bw / 2, by + bh / 2, font, dark ? Color(255, 255, 255) : Color(28, 28, 30), TextAlign::CENTER,
                 label.c_str(), body);
        break;
      }
    }
  }

  f.buf = nullptr;  // direct writes only while a scene draws
  const uint32_t took = esphome::micros() - started;
  draws++;
  if (took > max_us) max_us = took;
  next_draw = took > 90000 ? now + took / 1000 : 0;
  if (!warned && took > 150000) {
    ESP_LOGW("muse", "scene is slow: %u ms for one picture (%u elements); it is drawn less often",
             (unsigned) (took / 1000), (unsigned) s.items.size());
    warned = true;
  }
  if (!reported && t >= 3000) {
    ESP_LOGI("muse", "scene: %u pictures in the first 3 s, the slowest took %u ms", (unsigned) draws,
             (unsigned) (max_us / 1000));
    reported = true;
  }
}

// ------------------------------------------------------------------- queue --
//
// Cards wait in line (owner, 07.10.2026): a new card waits while another is on screen,
// and a tap on the screen shows the next one. Some go first: a question (Muse waits for
// the answer) and the doorbell. A card with the title of the one on screen replaces it
// at once, so the door photo follows "Es klingelt" without a tap. The script muse_next
// in stackchan-box3.yaml puts the next card on screen; it needs id(), this file cannot.

// mode as muse_mode: 1 text, 2 value, 3 celebration, 4 weather, 5 photo, 6 event,
// 7 scene, 8 question
struct Card {
  int mode = 1;
  std::string title, body, label, value, unit, event, url, scene;
  std::string from, to, profile;  // a route (mode 9)
  int icon = -1;
  uint32_t ms = 20000;    // time on screen
  uint32_t live_s = 0;    // a photo that is a live view, refreshed for this long
  bool conv = false;      // a voice conversation: never waits, never comes back
};

constexpr size_t QUEUE_MAX = 12;

inline std::deque<Card> &queue() {
  static std::deque<Card> q;
  return q;
}

inline Card &current_card() {
  static Card c;
  return c;
}

// enqueue() put the card on screen back into the line (an urgent card pushed it aside);
// take_next() must not put it into the history as well.
inline bool &requeued() {
  static bool r = false;
  return r;
}

// Whether the last card action put its card on screen (for the action's response).
inline bool &placed_now() {
  static bool p = false;
  return p;
}

enum Placement { WAIT, NOW, REPLACE };

// Where a new card goes. `showing` is the mode on screen (0: the status, nothing waits).
inline Placement place(const Card &c, int showing, bool urgent) {
  if (showing == 0) return NOW;
  if (!c.title.empty() && c.title == current_card().title && showing != 8) return REPLACE;
  return urgent ? NOW : WAIT;
}

// Puts the card in line as `place` decided; true when muse_next must run now. A card
// that is pushed aside by an urgent one comes back first afterwards.
inline bool enqueue(Card c, Placement p, int showing) {
  auto &q = queue();
  if (p == WAIT) {
    q.push_back(std::move(c));
    if (q.size() > QUEUE_MAX) q.pop_back();
    return false;
  }
  if (p == NOW && showing != 0 && showing != 8 && !current_card().conv) {
    q.push_front(current_card());
    requeued() = true;
  }
  q.push_front(std::move(c));
  return true;
}

// The doorbell goes before everything else.
inline bool urgent_event(const std::string &icon) {
  const std::string k = scene::detail::icon_key(icon);
  return k == "klingel" || k == "doorbell" || k == "bell" || k == "bell-ring";
}

// The scene muse_draw checked last, for its response (a waiting scene is parsed again
// when it comes on screen).
inline scene::Scene &scene_check() {
  static scene::Scene s;
  return s;
}

// The appointments of an agenda card (muse_show_agenda): one per line of its text,
// "09:00-10:00 Teammeeting @ office", "ganztägig Urlaub" or "09:00 | Teammeeting | office";
// bullets in front ("- ", "• ") are dropped.
struct AgendaItem {
  std::string time, title, place;
};

inline std::vector<AgendaItem> &agenda() {
  static std::vector<AgendaItem> a;
  return a;
}

inline std::vector<AgendaItem> parse_agenda(const std::string &text) {
  std::vector<AgendaItem> out;
  size_t start = 0;
  while (start <= text.size() && out.size() < 24) {
    size_t nl = text.find('\n', start);
    if (nl == std::string::npos) nl = text.size();
    std::string line = trim(text.substr(start, nl - start));
    start = nl + 1;
    for (const char *b : {"• ", "- ", "* "})
      if (line.compare(0, strlen(b), b) == 0) line = trim(line.substr(strlen(b)));
    if (line.empty()) continue;
    AgendaItem a;
    if (line.find('|') != std::string::npos) {
      std::vector<std::string> parts;
      size_t p = 0;
      while (true) {
        const size_t bar = line.find('|', p);
        parts.push_back(trim(line.substr(p, bar == std::string::npos ? std::string::npos : bar - p)));
        if (bar == std::string::npos) break;
        p = bar + 1;
      }
      a.time = parts[0];
      if (parts.size() > 1) a.title = parts[1];
      if (parts.size() > 2) a.place = parts[2];
    } else {
      const size_t sp = line.find(' ');
      const std::string first = line.substr(0, sp);
      const std::string low = lower(first);
      const bool clock_time = !first.empty() && first[0] >= '0' && first[0] <= '9' && first.find(':') != std::string::npos;
      const bool all_day = low == "ganztägig" || low == "ganztaegig" || low == "ganztags" || low == "all-day" ||
                           low == "allday";
      if ((clock_time || all_day) && sp != std::string::npos) {
        a.time = all_day ? "ganztägig" : first;
        line = trim(line.substr(sp));
      }
      const size_t at = line.find(" @ ");
      if (at != std::string::npos) {
        a.place = trim(line.substr(at + 3));
        line = trim(line.substr(0, at));
      }
      a.title = line;
    }
    out.push_back(a);
  }
  return out;
}

// Cards that were on screen, newest last; a swipe to the right brings the last one back
// (muse_prev). Questions, conversations and the box info card are not kept.
constexpr size_t HISTORY_MAX = 6;

inline std::deque<Card> &history() {
  static std::deque<Card> h;
  return h;
}

// The card the scripts muse_next and muse_prev chose; muse_apply puts it on screen.
inline Card &staged() {
  static Card c;
  return c;
}

inline bool keepable(const Card &c) { return c.mode != 0 && c.mode != 8 && c.mode != 12 && !c.conv; }

// Takes the next card of the line into staged(); the card on screen goes into the
// history. False when nothing waits.
inline bool take_next(int showing) {
  auto &q = queue();
  if (showing != 0 && keepable(current_card()) && !requeued()) {
    history().push_back(current_card());
    if (history().size() > HISTORY_MAX) history().pop_front();
  }
  requeued() = false;
  if (q.empty()) return false;
  staged() = q.front();
  q.pop_front();
  return true;
}

// Takes the last card of the history into staged(); the card on screen goes back to the
// front of the line, so a swipe to the left returns to it. False when there is none.
inline bool take_prev(int showing) {
  auto &h = history();
  if (h.empty()) return false;
  if (showing != 0 && keepable(current_card())) queue().push_front(current_card());
  staged() = h.back();
  h.pop_back();
  return true;
}

// A question on screen (muse_ask, muse_choose): its options and what each answers.
struct Question {
  uint32_t number = 0;
  std::string text, answer;
  std::vector<std::string> options, values;
  bool open = false;
};

inline Question &question() {
  static Question q;
  return q;
}

// Sets a new question up. One that is still open on screen is answered "none" first,
// so its answer never carries the new question's text.
template <typename Sensor>
inline void ask_prepare(Sensor *sensor, int showing, const std::string &text, const std::vector<std::string> &options,
                        const std::vector<std::string> &values) {
  Question &qs = question();
  if (qs.open && showing == 8) {
    qs.open = false;
    qs.answer = "none";
    sensor->publish_state("none: " + qs.text);
  }
  qs.number++;
  qs.text = text;
  qs.options = options;
  qs.values = values;
  qs.answer = "";
  qs.open = true;
  ESP_LOGI("muse", "question %u: \"%s\" (%u options)", (unsigned) qs.number, text.c_str(), (unsigned) options.size());
}

// Every answer a touch gave (question buttons, scene buttons), and how many so far;
// muse_wait_answer waits for the count to move.
inline std::string &last_answer() {
  static std::string a;
  return a;
}
inline uint32_t &answer_count() {
  static uint32_t n = 0;
  return n;
}
inline void give_answer(const std::string &a) {
  last_answer() = a;
  answer_count()++;
}

// Where button i of n lies on the question card: two options side by side, three or four
// in two rows. Used by the display lambda and by the touch handler alike.
inline void question_button(size_t n, size_t i, int *x, int *y, int *w, int *h) {
  if (n <= 2) {
    *x = i == 0 ? 12 : 166;
    *y = 160;
    *w = 142;
    *h = 66;
  } else {
    *x = (i % 2 == 0) ? 12 : 166;
    *y = i < 2 ? 150 : 194;
    *w = 142;
    *h = 40;
  }
}

inline int question_button_at(size_t n, int px, int py) {
  for (size_t i = 0; i < n && i < 4; i++) {
    int x, y, w, h;
    question_button(n, i, &x, &y, &w, &h);
    if (px >= x && px < x + w && py >= y && py < y + h) return (int) i;
  }
  return -1;
}

// ------------------------------------------------------------------ timers --
//
// Timers of the voice assistant (Home Assistant counts them and sends ticks) and the
// box's own (muse_show_timer, counted by millis()). The card shows the one that ends
// first; when one ends, the chime plays and a card says so (script muse_timer_done).
struct TimerEntry {
  std::string id, name;
  uint32_t total = 0, left = 0;  // seconds
  uint32_t end_ms = 0;           // own timers only
  bool local = false;
};

inline std::vector<TimerEntry> &timers() {
  static std::vector<TimerEntry> t;
  return t;
}

// Recounts the box's own timers; returns the name of one that just ended, or "" (each
// ended timer is reported once and then removed).
inline std::string timers_tick(uint32_t now) {
  auto &t = timers();
  for (auto it = t.begin(); it != t.end(); ++it) {
    if (!it->local) continue;
    const int32_t ms = (int32_t) (it->end_ms - now);
    it->left = ms > 0 ? (uint32_t) ((ms + 999) / 1000) : 0;
    if (ms <= 0) {
      const std::string name = it->name;
      t.erase(it);
      return name;
    }
  }
  return "";
}

inline const TimerEntry *timer_soonest() {
  const TimerEntry *best = nullptr;
  for (const auto &e : timers())
    if (best == nullptr || e.left < best->left) best = &e;
  return best;
}

inline void timer_remove(const std::string &id) {
  auto &t = timers();
  t.erase(std::remove_if(t.begin(), t.end(), [&](const TimerEntry &e) { return e.id == id; }), t.end());
}

// "5", "5 min", "1:30", "90 s", "1 h 20 min" -> seconds; 0 when nothing is readable.
inline uint32_t parse_duration(const std::string &raw) {
  const std::string s = lower(trim(raw));
  if (s.empty()) return 0;
  int h = 0, m = 0, sec = 0;
  if (sscanf(s.c_str(), "%d:%d:%d", &h, &m, &sec) == 3) return (uint32_t) (h * 3600 + m * 60 + sec);
  if (sscanf(s.c_str(), "%d:%d", &m, &sec) == 2) return (uint32_t) (m * 60 + sec);
  uint32_t total = 0;
  bool any = false;
  size_t i = 0;
  while (i < s.size()) {
    while (i < s.size() && !isdigit((unsigned char) s[i])) i++;
    if (i >= s.size()) break;
    double v = atof(s.c_str() + i);
    while (i < s.size() && (isdigit((unsigned char) s[i]) || s[i] == '.' || s[i] == ',')) i++;
    while (i < s.size() && s[i] == ' ') i++;
    std::string unit;
    while (i < s.size() && isalpha((unsigned char) s[i])) unit += s[i++];
    any = true;
    if (unit.compare(0, 1, "h") == 0 || unit.compare(0, 2, "st") == 0) total += (uint32_t) (v * 3600);
    else if (unit.compare(0, 1, "s") == 0) total += (uint32_t) v;
    else total += (uint32_t) (v * 60);  // minutes when no unit is given
  }
  return any ? total : 0;
}

// A ring from `from` to `to` degrees (clockwise, 0 at the top), soft edges, clipped.
inline void ring_arc(Display &it, float cx, float cy, float r_out, float r_in, float from, float to, Color c,
                     Color bg) {
  const int W = it.get_width(), H = it.get_height();
  if (to <= from) return;
  const bool full = to - from >= 359.9f;
  const int y0 = std::max(0, (int) floorf(cy - r_out - 1)), y1 = std::min(H - 1, (int) ceilf(cy + r_out + 1));
  const int x0 = std::max(0, (int) floorf(cx - r_out - 1)), x1 = std::min(W - 1, (int) ceilf(cx + r_out + 1));
  for (int y = y0; y <= y1; y++)
    for (int x = x0; x <= x1; x++) {
      const float px = x + 0.5f - cx, py = y + 0.5f - cy;
      const float d = sqrtf(px * px + py * py);
      float a = std::min(r_out - d + 0.5f, d - r_in + 0.5f);
      if (a <= 0.0f) continue;
      if (!full) {
        float deg = atan2f(px, -py) * 57.29578f;
        if (deg < 0) deg += 360.0f;
        if (deg < from || deg > to) continue;
        // a soft end: the last degree fades
        const float edge = std::min(deg - from, to - deg) * (d * 0.01745f);
        a = std::min(a, edge + 0.5f);
        if (a <= 0.0f) continue;
      }
      it.draw_pixel_at(x, y, a >= 1.0f ? c : mix(c, bg, a));
    }
}

// Items of a list card (muse_show_list): one per line, "[x] Milch" done, "[ ] Brot" or
// "- Brot" or "Brot" open.
struct ListItem {
  std::string text;
  bool done = false;
};

inline std::vector<ListItem> parse_list(const std::string &text) {
  std::vector<ListItem> out;
  size_t start = 0;
  while (start <= text.size() && out.size() < 40) {
    size_t nl = text.find('\n', start);
    if (nl == std::string::npos) nl = text.size();
    std::string line = trim(text.substr(start, nl - start));
    start = nl + 1;
    if (line.empty()) continue;
    ListItem li;
    const std::string low = lower(line.substr(0, 4));
    if (low.compare(0, 3, "[x]") == 0) {
      li.done = true;
      line = trim(line.substr(3));
    } else if (line.compare(0, 3, "[ ]") == 0 || line.compare(0, 2, "[]") == 0) {
      line = trim(line.substr(line[1] == ']' ? 2 : 3));
    }
    for (const char *b : {"\u2022 ", "- ", "* ", "\u2713 ", "\u2714 "})
      if (line.compare(0, strlen(b), b) == 0) line = trim(line.substr(strlen(b)));
    if (line.empty()) continue;
    li.text = line;
    out.push_back(li);
  }
  return out;
}

inline std::vector<ListItem> &list_items() {
  static std::vector<ListItem> l;
  return l;
}

// --------------------------------------------------------------- status bar --
//
// The right end of the top bar, as on an iPhone (owner, 07.10.2026): from the right
// the battery, the Wi-Fi fan, then an orange dot while the box listens (Apple's
// microphone dot), a crossed-out microphone while the mute switch cuts the
// microphones, and a teal dot while the radar sees someone. `cy` is the middle line
// of the bar; returns the x where the cluster ends on the left.
inline int status_right(Display &it, int right, int cy, float battery_pct, float rssi, bool listening, bool muted,
                        bool present, BaseFont *icons, Color ink, Color dim, Color bg) {
  // Battery: a rounded outline, the nub on the right, the level inside.
  const int bw = 23, bh = 12, bx = right - bw - 2, by = cy - bh / 2;
  round_rect(it, bx, by, bw, bh, 4, ink, bg);
  round_rect(it, bx + 1, by + 1, bw - 2, bh - 2, 3, bg, ink);
  it.filled_rectangle(bx + bw, cy - 2, 2, 4, ink);
  if (!std::isnan(battery_pct)) {
    const float p = battery_pct < 0 ? 0 : battery_pct > 100 ? 100 : battery_pct;
    const int fw = std::max(2, (int) lroundf((bw - 4) * p / 100.0f));
    round_rect(it, bx + 2, by + 2, fw, bh - 4, 2, p < 20 ? Color(255, 59, 48) : ink, bg);
  }
  int x = bx - 6;
  // Wi-Fi: the fan of Material Design Icons, filled by signal strength.
  static const char *const WIFI[] = {"\U000F092F", "\U000F091F", "\U000F0922", "\U000F0925", "\U000F0928"};
  const int bars = std::isnan(rssi) ? -1 : rssi >= -60 ? 4 : rssi >= -67 ? 3 : rssi >= -74 ? 2 : rssi >= -82 ? 1 : 0;
  const char *wifi = bars < 0 ? "\U000F092E" : WIFI[bars];
  int x1, y1, w, h;
  it.get_text_bounds(0, 0, wifi, icons, TextAlign::TOP_LEFT, &x1, &y1, &w, &h);
  it.print(x, cy, icons, bars < 0 ? dim : ink, TextAlign::CENTER_RIGHT, wifi, bg);
  x -= w + 6;
  if (muted) {
    it.get_text_bounds(0, 0, "\U000F036D", icons, TextAlign::TOP_LEFT, &x1, &y1, &w, &h);
    it.print(x, cy, icons, Color(255, 59, 48), TextAlign::CENTER_RIGHT, "\U000F036D", bg);
    x -= w + 6;
  } else if (listening) {
    circle(it, x - 3.5f, cy, 3.5f, Color(255, 149, 0), bg);
    x -= 7 + 6;
  }
  if (present) {
    circle(it, x - 3.0f, cy, 3.0f, Color(48, 176, 199), bg);
    x -= 6 + 6;
  }
  return x;
}

// ------------------------------------------------------------ hardware check --
//
// hw_check() asks every chip of the box and the sensor dock who it is, for the action
// muse_hw_check. Read only, apart from what the caller does with it.

struct HwReport {
  std::vector<std::pair<std::string, std::string>> items;
  void add(const std::string &k, const std::string &v) { items.push_back({k, v}); }
};

inline HwReport &hw_report() {
  static HwReport r;
  return r;
}

inline std::string hex(const uint8_t *b, size_t n) {
  std::string s;
  char t[4];
  for (size_t i = 0; i < n; i++) {
    snprintf(t, sizeof(t), "%02X", b[i]);
    s += (i ? " " : "") + std::string(t);
  }
  return s;
}

// Reads n bytes from register `reg` (8 or 16 bit) of the chip at `addr`; "error N" if the
// bus fails (2 no acknowledge, 3 timeout, 4 bus not set up, 6 other).
template <typename Bus>
inline std::string reg_read(Bus *bus, uint8_t addr, uint16_t reg, bool reg16, size_t n) {
  uint8_t w[2] = {(uint8_t) (reg16 ? reg >> 8 : reg), (uint8_t) (reg & 0xFF)};
  uint8_t r[8] = {};
  const auto err = bus->write_readv(addr, reg16 ? w : w + 1, reg16 ? 2 : 1, r, n);
  if (err != 0) return "error " + std::to_string((int) err);
  return hex(r, n);
}

// --------------------------------------------------------------- backlight --

// 100 % while the sun is up, 80 % in the evening, 65 % from 23:00 to 06:00,
// 10 % when Muse has been told to be quiet (owner, 06.10.2026).
inline float brightness(const esphome::ESPTime &now, const std::string &sun, bool quiet) {
  if (quiet) return 0.10f;
  if (!now.is_valid()) return 0.80f;
  const int minutes = now.hour * 60 + now.minute;
  if (minutes >= 23 * 60 || minutes < 6 * 60) return 0.65f;
  if (sun == "below_horizon") return 0.80f;
  return 1.0f;
}

}  // namespace muse
