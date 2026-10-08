// muse_fit.h: fits one line of text into a pixel width (status label of the Muse box).
//
// No ESPHome includes on purpose: the font metrics arrive as a callback, so
// test_muse_fit.cpp can compile this file on the Mac and test it without a box.
//
// Pitfalls:
//  * Cut between UTF-8 characters, never inside one: a half character is drawn as
//    an empty box and logs a font warning ten times a second.
//  * Trailing spaces go before the ellipsis is appended ("Ich arbeite …" and not
//    "Ich arbeite …" with a gap in front of it).
//  * The search assumes a longer prefix is never narrower than a shorter one. That
//    holds for a proportional font; the result fits in any case, because only
//    prefixes that were measured and fit are ever returned.
#pragma once

#include <cstddef>
#include <string>
#include <vector>

namespace muse {

// Byte offset just after each UTF-8 character of `s`. A broken sequence counts
// byte by byte, like utf8_next() in muse.h.
inline std::vector<size_t> char_ends(const std::string &s) {
  std::vector<size_t> ends;
  size_t i = 0;
  while (i < s.size()) {
    const unsigned char c = (unsigned char) s[i];
    size_t n = c < 0x80 ? 1 : (c >> 5) == 0x6 ? 2 : (c >> 4) == 0xE ? 3 : (c >> 3) == 0x1E ? 4 : 1;
    if (i + n > s.size()) n = 1;
    i += n;
    ends.push_back(i);
  }
  return ends;
}

// Line breaks and tabs become spaces, runs of spaces become one, nothing stays at the ends.
inline std::string single_line(const std::string &s) {
  std::string out;
  bool space = true;  // swallows leading spaces
  for (char c : s) {
    if (c == '\n' || c == '\r' || c == '\t') c = ' ';
    if (c == ' ') {
      if (!space) out += ' ';
      space = true;
    } else {
      out += c;
      space = false;
    }
  }
  while (!out.empty() && out.back() == ' ') out.pop_back();
  return out;
}

// `text` itself when width(text) <= max_width. Otherwise the longest beginning of it
// that fits together with `ellipsis`, cut between characters, trailing spaces removed.
// When not even the ellipsis fits, the ellipsis alone.
template <typename WidthFn>
inline std::string fit_line(const std::string &text, int max_width, WidthFn width, const std::string &ellipsis) {
  if (text.empty() || width(text) <= max_width) return text;
  const std::vector<size_t> ends = char_ends(text);
  auto candidate = [&](size_t k) {  // the first k characters plus the ellipsis
    std::string head = k == 0 ? std::string() : text.substr(0, ends[k - 1]);
    while (!head.empty() && head.back() == ' ') head.pop_back();
    return head + ellipsis;
  };
  if (width(candidate(0)) > max_width) return ellipsis;
  size_t lo = 0, hi = ends.size() - 1;  // candidate(lo) always fits
  while (lo < hi) {
    const size_t mid = (lo + hi + 1) / 2;
    if (width(candidate(mid)) <= max_width) lo = mid;
    else hi = mid - 1;
  }
  return candidate(lo);
}

}  // namespace muse
