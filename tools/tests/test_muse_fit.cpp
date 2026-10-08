// test_muse_fit.cpp: host test for muse_fit.h (no box, no ESPHome needed).
//
// Build and run on the Mac:
//   c++ -std=c++17 -Wall -Wextra -O1 test_muse_fit.cpp -o /tmp/test_muse_fit && /tmp/test_muse_fit
//
// The font is faked: every character is as wide as its table entry says (ASCII
// letters differ, everything outside ASCII is 11 px, the ellipsis 13 px), which is
// proportional like the real status font. The properties tested are the ones the
// box relies on: the result always fits, is cut between characters only, and is
// the longest beginning that fits.
#include <cstdio>
#include <cstdlib>
#include <string>

#include "../../firmware/muse_fit.h"

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

static const std::string ELLIPSIS = "\xE2\x80\xA6";  // U+2026

// Width of one UTF-8 character starting at s[i], and its length in bytes.
static int char_width(const std::string &s, size_t i, size_t *len) {
  const unsigned char c = (unsigned char) s[i];
  size_t n = c < 0x80 ? 1 : (c >> 5) == 0x6 ? 2 : (c >> 4) == 0xE ? 3 : (c >> 3) == 0x1E ? 4 : 1;
  if (i + n > s.size()) n = 1;
  *len = n;
  if (s.compare(i, n, ELLIPSIS) == 0) return 13;
  if (c >= 0x80) return 11;
  if (c == ' ') return 4;
  if (c == 'i' || c == 'l' || c == 'j' || c == '.' || c == ',' || c == '!') return 4;
  if (c == 'm' || c == 'w' || c == 'M' || c == 'W') return 14;
  if (c >= 'A' && c <= 'Z') return 11;
  return 8;
}

static int width(const std::string &s) {
  int w = 0;
  for (size_t i = 0; i < s.size();) {
    size_t n;
    w += char_width(s, i, &n);
    i += n;
  }
  return w;
}

static bool valid_utf8(const std::string &s) {
  for (size_t i = 0; i < s.size();) {
    const unsigned char c = (unsigned char) s[i];
    size_t n = c < 0x80 ? 1 : (c >> 5) == 0x6 ? 2 : (c >> 4) == 0xE ? 3 : (c >> 3) == 0x1E ? 4 : 0;
    if (n == 0 || i + n > s.size()) return false;
    for (size_t k = 1; k < n; k++)
      if (((unsigned char) s[i + k] >> 6) != 0x2) return false;
    i += n;
  }
  return true;
}

// Reference: the longest k whose candidate fits, found by trying all of them.
static std::string brute(const std::string &text, int max_width) {
  if (text.empty() || width(text) <= max_width) return text;
  const auto ends = muse::char_ends(text);
  std::string best = ELLIPSIS;
  for (size_t k = 0; k < ends.size(); k++) {
    std::string head = k == 0 ? "" : text.substr(0, ends[k - 1]);
    while (!head.empty() && head.back() == ' ') head.pop_back();
    if (width(head + ELLIPSIS) <= max_width) best = head + ELLIPSIS;
  }
  return best;
}

static std::string fit(const std::string &t, int max) { return muse::fit_line(t, max, width, ELLIPSIS); }

int main() {
  // 1. Fits: returned unchanged, also with an exact fit.
  CHECK(fit("Ich arbeite " + ELLIPSIS, 300) == "Ich arbeite " + ELLIPSIS, "short text unchanged");
  CHECK(fit("abc", width("abc")) == "abc", "exact fit unchanged");
  CHECK(fit("", 100).empty(), "empty stays empty");

  // 2. Too long: fits, ends with the ellipsis, is a beginning of the original.
  const std::string longer = "Ich lese gerade deine E-Mails und fasse sie zusammen";
  const std::string cut = fit(longer, 254);
  CHECK(width(cut) <= 254, "cut width %d", width(cut));
  CHECK(cut.size() >= ELLIPSIS.size() && cut.compare(cut.size() - ELLIPSIS.size(), ELLIPSIS.size(), ELLIPSIS) == 0,
        "ends with ellipsis: %s", cut.c_str());
  CHECK(longer.compare(0, cut.size() - ELLIPSIS.size(), cut, 0, cut.size() - ELLIPSIS.size()) == 0, "is a beginning: %s", cut.c_str());
  CHECK(cut == brute(longer, 254), "longest: %s vs %s", cut.c_str(), brute(longer, 254).c_str());

  // 3. No space in front of the ellipsis.
  const std::string spaced = fit("Ich arbeite gerade an deiner Anfrage", width("Ich arbeite ") + 13);
  CHECK(spaced == "Ich arbeite" + ELLIPSIS, "space removed: '%s'", spaced.c_str());

  // 4. Multi-byte characters are never cut in the middle.
  const std::string umlauts = "\xC3\x9C" "berpr" "\xC3\xBC" "fe \xC3\xA4\xC3\xB6\xC3\xBC \xE2\x82\xAC \xF0\x9F\x98\x80 und mehr Text hinterher";
  for (int max = 10; max < width(umlauts) + 20; max += 3) {
    const std::string r = fit(umlauts, max);
    CHECK(valid_utf8(r), "valid utf-8 at max %d", max);
    CHECK(width(r) <= max || r == ELLIPSIS, "fits at max %d (%d)", max, width(r));
    CHECK(r == brute(umlauts, max), "longest at max %d", max);
  }

  // 5. Tiny widths: the ellipsis alone, even if it does not fit.
  CHECK(fit("zu lang fuer nichts", 5) == ELLIPSIS, "ellipsis alone");
  CHECK(fit("zu lang fuer nichts", 13) == ELLIPSIS, "just the ellipsis fits");

  // 6. Random strings against the reference, 4000 rounds.
  std::srand(7);
  const char *alphabet[] = {"a", "i", "m", "W", " ", "l", "\xC3\xA4", "\xE2\x82\xAC", "\xF0\x9F\x98\x80", ".", "x", "T"};
  for (int round = 0; round < 4000; round++) {
    std::string t;
    const int n = 1 + std::rand() % 40;
    for (int k = 0; k < n; k++) t += alphabet[std::rand() % 12];
    const int max = 5 + std::rand() % 300;
    const std::string r = fit(t, max);
    CHECK(valid_utf8(r), "round %d valid", round);
    CHECK(r == brute(t, max), "round %d: '%s' max %d -> '%s' vs '%s'", round, t.c_str(), max, r.c_str(), brute(t, max).c_str());
    CHECK(width(r) <= max || r == ELLIPSIS, "round %d fits", round);
  }

  // 7. single_line.
  CHECK(muse::single_line("  Ich\n arbeite\t\tgerade  \r\n") == "Ich arbeite gerade", "single_line: '%s'",
        muse::single_line("  Ich\n arbeite\t\tgerade  \r\n").c_str());
  CHECK(muse::single_line("\n\n").empty(), "only breaks");
  CHECK(muse::single_line("ok") == "ok", "unchanged");

  if (failures == 0) std::printf("OK: all checks passed\n");
  else std::printf("%d check(s) failed\n", failures);
  return failures == 0 ? 0 : 1;
}
