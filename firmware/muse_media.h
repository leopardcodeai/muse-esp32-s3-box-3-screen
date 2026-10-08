// muse_media.h: pictures for the Muse box that never block it.
//
// Photos (JPEG, PNG), GIF animations, live camera views and route maps are fetched and
// decoded by a task of their own on the other core; the display only copies the
// finished picture. The display lambda reads Media::front under Media::lock.
//
// Why not ESPHome's online_image: it connects in the main loop (a TLS handshake took
// 2.5 s, and the Bluetooth proxy dropped events meanwhile), decodes a JPEG at full size
// before it scales it (2880 x 1616 took 27 to 32 s, 07.10.2026), picks the format from
// the Content-Type header only, and knows no GIF.
//
// Pitfalls:
//  * The format comes from the first bytes, not from Content-Type: file hosts answer
//    "application/octet-stream" for pictures.
//  * JPEG is decoded at 1/2, 1/4 or 1/8 of its size right away when that still covers
//    the target; a progressive JPEG only at 1/8 (JPEGDEC reads its first scan only).
//  * GIF frames are drawn on a canvas of their own (AnimatedGIF's raw mode): its cooked
//    mode keeps 8-bit indices, which mix up colours when frames bring their own palette.
//  * Only the newest job counts: a new one stops a running animation or live view.
//  * URLs are logged without their query, which carries Home Assistant's camera token.
//  * A route's map is stitched from 256 px tiles of a {z}/{x}/{y} server (tile_template,
//    set from the YAML). They come over one kept connection: a TLS handshake costs more
//    than a tile. A server that closes the connection gets one fresh retry per tile.
//  * malloc() and new only reach internal RAM in this build (ESPHome sets
//    CONFIG_SPIRAM_USE_CAPS_ALLOC). The decoders are large (JPEGDEC 17 KB, AnimatedGIF
//    25 KB, pngle 44 KB) and internal RAM runs short beside Bluetooth, Wi-Fi and TLS:
//    pngle_new() failed there (07.10.2026). They live in PSRAM (in_psram, png_new).
#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <new>
#include <string>
#include <vector>

#include "esp_crt_bundle.h"
#include "esp_heap_caps.h"
#include "esp_http_client.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "esphome/core/hal.h"
#include "esphome/core/log.h"

#include <ArduinoJson.h>
#include "muse_gif/AnimatedGIF.h"
#include "JPEGDEC.h"
#include "pngle.h"

namespace muse {
namespace media {

static const char *const TAG = "muse.media";
constexpr size_t MAX_FILE = 3 * 1024 * 1024;  // a picture or GIF, in PSRAM
constexpr uint16_t PAGE565 = 0xF79E;           // the page colour 243, 243, 243
constexpr int MAP_W = 320, MAP_H = 210, MAP_TOP = 30;  // route map below the status bar

enum Kind : uint8_t { PHOTO, LIVE, ROUTE };
enum State : uint8_t { IDLE, LOADING, READY, FAILED };

// RGB565 big endian, the byte order of the display buffer, in PSRAM.
struct Picture {
  uint8_t *px = nullptr;
  int w = 0, h = 0, cap = 0;
  bool reserve(int ww, int hh) {
    const int need = ww * hh * 2;
    if (need > cap) {
      if (px != nullptr) heap_caps_free(px);
      px = (uint8_t *) heap_caps_malloc(need, MALLOC_CAP_SPIRAM);
      cap = px != nullptr ? need : 0;
    }
    w = ww;
    h = hh;
    return px != nullptr;
  }
  void set(int x, int y, uint16_t c) {
    uint8_t *p = px + ((size_t) y * w + x) * 2;
    p[0] = c >> 8;
    p[1] = c & 0xFF;
  }
};

struct Job {
  Kind kind = PHOTO;
  std::string url, from, to, profile, title;
  int max_w = 300, max_h = 168;
  uint32_t seconds = 0;  // live view
};

struct RoutePoint {
  int16_t x, y;
};

struct Media {
  SemaphoreHandle_t lock = nullptr;  // guards front, the pictures and the route
  TaskHandle_t task = nullptr;
  Job job;                       // the newest job, under lock
  std::atomic<uint32_t> job_number{0};
  std::atomic<uint8_t> state{IDLE};
  std::atomic<uint32_t> seen{0};  // millis() when the display last showed the picture
  Picture pic[2];
  int front = 0;
  uint32_t frames = 0;            // pictures shown since the job began
  std::string error;              // why the job failed, for the card
  std::string kind_name;          // "JPEG", "PNG", "GIF"
  // route
  std::vector<RoutePoint> route;
  float distance_m = 0, duration_s = 0;
};

inline Media &media() {
  static Media m;
  return m;
}

// ---------------------------------------------------------------- download --

inline std::string without_query(const std::string &url) {
  const size_t q = url.find('?');
  return q == std::string::npos ? url : url.substr(0, q) + "?...";
}

struct Download {
  uint8_t *data = nullptr;
  size_t size = 0, cap = 0;
  int status = 0;
  std::string type, error;
  ~Download() { clear(); }
  void clear() {
    if (data != nullptr) heap_caps_free(data);
    data = nullptr;
    size = cap = 0;
  }
  bool grow(size_t need) {
    if (need <= cap) return true;
    size_t n = std::max(need, cap * 2);
    if (n < 64 * 1024) n = 64 * 1024;
    auto *d = (uint8_t *) heap_caps_realloc(data, n, MALLOC_CAP_SPIRAM);
    if (d == nullptr) return false;
    data = d;
    cap = n;
    return true;
  }
};

inline esp_err_t on_http_event(esp_http_client_event_t *e) {
  if (e->event_id == HTTP_EVENT_ON_HEADER && e->user_data != nullptr && strcasecmp(e->header_key, "Content-Type") == 0)
    ((Download *) e->user_data)->type = e->header_value;
  return ESP_OK;
}

// A connection kept open across requests to one host: the tiles of a map come in a row
// from one server. esp_http_client reuses the transport when the next URL names the
// same host and port.
struct Keep {
  esp_http_client_handle_t c = nullptr;
  ~Keep() { drop(); }
  void drop() {
    if (c == nullptr) return;
    esp_http_client_close(c);
    esp_http_client_cleanup(c);
    c = nullptr;
  }
};

// GET into PSRAM, following redirects; false with d.error set when it fails. `number`
// is the job this belongs to: a newer job stops the transfer. With `keep` the connection
// stays open for the next request; `dead` tells that a kept connection failed before any
// answer came, which is what a server does that closed it meanwhile.
inline bool http_get_once(const std::string &url, Download &d, size_t max, uint32_t number, Keep *keep, bool *dead) {
  const uint32_t t0 = esphome::millis();
  *dead = false;
  d.clear();
  d.type.clear();
  d.error.clear();
  const bool reused = keep != nullptr && keep->c != nullptr;
  esp_http_client_handle_t c = nullptr;
  if (reused) {
    c = keep->c;
    if (esp_http_client_set_url(c, url.c_str()) != ESP_OK || esp_http_client_set_user_data(c, &d) != ESP_OK) {
      d.error = "kept connection refused the URL";
      *dead = true;
      return false;
    }
  } else {
    esp_http_client_config_t cfg = {};
    cfg.url = url.c_str();
    cfg.timeout_ms = 15000;
    cfg.buffer_size = 4096;
    cfg.buffer_size_tx = 2048;
    cfg.crt_bundle_attach = esp_crt_bundle_attach;
    // The map and routing services want a way to reach whoever sends the request; without
    // a URL here a map service answered 403 (07.10.2026).
    cfg.user_agent = "Muse-ESP32BoxS3-Screen/4.2 (ESPHome; +https://github.com/leopardcodeai/muse-esp32boxs3-screen)";
    cfg.max_redirection_count = 5;
    cfg.event_handler = on_http_event;
    cfg.user_data = &d;
    c = esp_http_client_init(&cfg);
    if (c == nullptr) {
      d.error = "http client could not start";
      return false;
    }
    if (keep != nullptr) keep->c = c;
  }
  bool ok = false;
  for (int hop = 0; hop < 6; hop++) {
    esp_err_t err = esp_http_client_open(c, 0);
    if (err != ESP_OK) {
      d.error = std::string("connection failed (") + esp_err_to_name(err) + "; DNS, TLS or no route)";
      *dead = reused && hop == 0;
      break;
    }
    const int64_t len = esp_http_client_fetch_headers(c);
    d.status = esp_http_client_get_status_code(c);
    if (len < 0 || d.status == 0) {
      d.error = reused && hop == 0 ? "kept connection dropped" : "no answer";
      *dead = reused && hop == 0;
      break;
    }
    if (d.status >= 300 && d.status < 400) {
      if (esp_http_client_set_redirection(c) != ESP_OK) {
        d.error = "redirect without a location";
        break;
      }
      esp_http_client_close(c);
      continue;
    }
    if (d.status != 200) {
      d.error = "HTTP " + std::to_string(d.status);
      break;
    }
    if (len > (int64_t) max) {
      d.error = "too large: " + std::to_string((long long) len) + " bytes";
      break;
    }
    ok = true;
    while (true) {
      if (media().job_number.load() != number) {
        d.error = "replaced by a newer job";
        ok = false;
        break;
      }
      if (!d.grow(d.size + 16384)) {
        d.error = "out of memory";
        ok = false;
        break;
      }
      const int n = esp_http_client_read(c, (char *) d.data + d.size, 16384);
      if (n < 0) {
        d.error = "read failed";
        ok = false;
        break;
      }
      if (n == 0) break;
      d.size += n;
      if (d.size > max) {
        d.error = "too large";
        ok = false;
        break;
      }
    }
    break;
  }
  if (keep == nullptr || !ok) {
    esp_http_client_close(c);
    esp_http_client_cleanup(c);
    if (keep != nullptr) keep->c = nullptr;
  }
  const uint32_t ms = esphome::millis() - t0;
  if (ok && (d.size > 200000 || ms > 3000))
    ESP_LOGI(TAG, "download: %u bytes in %u ms (%s)", (unsigned) d.size, (unsigned) ms, without_query(url).c_str());
  return ok && d.size > 0;
}

inline bool http_get(const std::string &url, Download &d, size_t max, uint32_t number, Keep *keep = nullptr) {
  bool dead = false;
  if (http_get_once(url, d, max, number, keep, &dead)) return true;
  if (!dead) return false;
  // The server closed the kept connection: once more on a fresh one.
  keep->drop();
  return http_get_once(url, d, max, number, keep, &dead);
}

// ------------------------------------------------------------------ decode --

// A decoder object in PSRAM instead of internal RAM; freed with free_psram().
template <typename T>
inline T *in_psram() {
  void *mem = heap_caps_malloc(sizeof(T), MALLOC_CAP_SPIRAM);
  return mem == nullptr ? nullptr : new (mem) T();
}

template <typename T>
inline void free_psram(T *p) {
  if (p == nullptr) return;
  p->~T();
  heap_caps_free(p);
}

// pngle_new() is calloc() plus pngle_reset(); the same in PSRAM. pngle_destroy() frees
// with free(), which also returns PSRAM in ESP-IDF.
inline pngle_t *png_new() {
  auto *p = (pngle_t *) heap_caps_calloc(1, PNGLE_T_SIZE, MALLOC_CAP_SPIRAM);
  if (p != nullptr) pngle_reset(p);
  return p;
}

enum Format { UNKNOWN, JPEG, PNG, GIF, WEBP };

inline Format sniff(const Download &d) {
  const uint8_t *b = d.data;
  if (d.size >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return JPEG;
  if (d.size >= 8 && b[0] == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G') return PNG;
  if (d.size >= 6 && memcmp(b, "GIF8", 4) == 0) return GIF;
  if (d.size >= 12 && memcmp(b, "RIFF", 4) == 0 && memcmp(b + 8, "WEBP", 4) == 0) return WEBP;
  return UNKNOWN;
}

// Size of a w x h picture that fits max_w x max_h; never larger than it is.
inline void fit(int w, int h, int max_w, int max_h, int *ow, int *oh) {
  const float f = std::min(1.0f, std::min((float) max_w / w, (float) max_h / h));
  *ow = std::max(1, (int) lroundf(w * f));
  *oh = std::max(1, (int) lroundf(h * f));
}

// Nearest-neighbour scaling of an RGB565 big endian picture into `out` (already sized).
inline void resample(const uint8_t *src, int sw, int sh, Picture &out) {
  for (int y = 0; y < out.h; y++) {
    const int sy = std::min(sh - 1, (int) ((y + 0.5f) * sh / out.h));
    const uint8_t *row = src + (size_t) sy * sw * 2;
    uint8_t *dst = out.px + (size_t) y * out.w * 2;
    for (int x = 0; x < out.w; x++) {
      const int sx = std::min(sw - 1, (int) ((x + 0.5f) * sw / out.w));
      dst[2 * x] = row[2 * sx];
      dst[2 * x + 1] = row[2 * sx + 1];
    }
  }
}

struct JpegTarget {
  uint8_t *buf;
  int w, h;
};

inline int jpeg_draw(JPEGDRAW *p) {
  auto *t = (JpegTarget *) p->pUser;
  for (int y = 0; y < p->iHeight; y++) {
    const int ty = p->y + y;
    if (ty >= t->h) break;
    const int n = std::min(p->iWidthUsed > 0 ? p->iWidthUsed : p->iWidth, t->w - p->x);
    if (n <= 0) continue;
    memcpy(t->buf + ((size_t) ty * t->w + p->x) * 2, p->pPixels + y * p->iWidth, n * 2);
  }
  return 1;
}

inline bool decode_jpeg(const Download &d, Picture &out, int max_w, int max_h, std::string *error) {
  auto *jpeg = in_psram<JPEGDEC>();
  bool ok = false;
  if (jpeg == nullptr) {
    *error = "out of memory for the JPEG decoder";
    return false;
  }
  if (!jpeg->openRAM(d.data, (int) d.size, jpeg_draw)) {
    *error = "JPEG unreadable (error " + std::to_string(jpeg->getLastError()) + ")";
    free_psram(jpeg);
    return false;
  }
  const int w = jpeg->getWidth(), h = jpeg->getHeight();
  const bool progressive = jpeg->getJPEGType() == JPEG_MODE_PROGRESSIVE;
  int ow, oh;
  fit(w, h, max_w, max_h, &ow, &oh);
  // The largest reduction that still covers the target; a progressive JPEG only at 1/8.
  int s = 1;
  while (s < 8 && w / (s * 2) >= ow && h / (s * 2) >= oh) s *= 2;
  if (progressive) s = 8;
  const int dw = (w + s - 1) / s, dh = (h + s - 1) / s;
  auto *tmp = (uint8_t *) heap_caps_malloc((size_t) (dw + 16) * (dh + 16) * 2, MALLOC_CAP_SPIRAM);
  if (tmp != nullptr && out.reserve(ow, oh)) {
    JpegTarget t{tmp, dw, dh};
    jpeg->setUserPointer(&t);
    jpeg->setPixelType(RGB565_BIG_ENDIAN);
    const int opt = s == 2 ? JPEG_SCALE_HALF : s == 4 ? JPEG_SCALE_QUARTER : s == 8 ? JPEG_SCALE_EIGHTH : 0;
    if (jpeg->decode(0, 0, opt)) {
      resample(tmp, dw, dh, out);
      ok = true;
      ESP_LOGI(TAG, "JPEG %d x %d%s, decoded at 1/%d, shown %d x %d", w, h, progressive ? " progressive" : "", s, ow,
               oh);
    } else {
      *error = std::string(progressive ? "progressive " : "") + "JPEG decode error " +
               std::to_string(jpeg->getLastError());
    }
  } else {
    *error = "out of memory for the JPEG";
  }
  if (tmp != nullptr) heap_caps_free(tmp);
  jpeg->close();
  free_psram(jpeg);
  return ok;
}

struct PngTarget {
  Picture *out;
  int w = 0, h = 0, max_w, max_h;
  bool ok = true;
};

inline void png_init(pngle_t *p, uint32_t w, uint32_t h) {
  auto *t = (PngTarget *) pngle_get_user_data(p);
  t->w = (int) w;
  t->h = (int) h;
  int ow, oh;
  fit(t->w, t->h, t->max_w, t->max_h, &ow, &oh);
  t->ok = t->out->reserve(ow, oh);
}

inline void png_draw(pngle_t *p, uint32_t x, uint32_t y, uint32_t w, uint32_t h, const uint8_t rgba[4]) {
  auto *t = (PngTarget *) pngle_get_user_data(p);
  if (!t->ok) return;
  const Picture &o = *t->out;
  // Transparent pixels show the page colour.
  const float a = rgba[3] / 255.0f;
  const uint8_t r = (uint8_t) lroundf(243 + (rgba[0] - 243) * a), g = (uint8_t) lroundf(243 + (rgba[1] - 243) * a),
                b = (uint8_t) lroundf(243 + (rgba[2] - 243) * a);
  const uint16_t c = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
  const int x0 = (int) (x * o.w / t->w), y0 = (int) (y * o.h / t->h);
  const int x1 = std::max(x0 + 1, (int) ((x + w) * o.w / t->w)), y1 = std::max(y0 + 1, (int) ((y + h) * o.h / t->h));
  for (int yy = y0; yy < y1 && yy < o.h; yy++)
    for (int xx = x0; xx < x1 && xx < o.w; xx++) t->out->set(xx, yy, c);
}

inline bool decode_png(const Download &d, Picture &out, int max_w, int max_h, std::string *error) {
  pngle_t *p = png_new();
  if (p == nullptr) {
    *error = "out of memory for the PNG";
    return false;
  }
  PngTarget t{&out, 0, 0, max_w, max_h, true};
  pngle_set_user_data(p, &t);
  pngle_set_init_callback(p, png_init);
  pngle_set_draw_callback(p, png_draw);
  size_t at = 0;
  bool ok = true;
  while (at < d.size) {
    const int n = pngle_feed(p, d.data + at, std::min((size_t) 4096, d.size - at));
    if (n < 0) {
      *error = std::string("PNG error: ") + pngle_error(p);
      ok = false;
      break;
    }
    if (n == 0) break;
    at += n;
  }
  pngle_destroy(p);
  if (ok && (!t.ok || t.w == 0)) {
    *error = "PNG without picture or out of memory";
    ok = false;
  }
  if (ok) ESP_LOGI(TAG, "PNG %d x %d, shown %d x %d", t.w, t.h, out.w, out.h);
  return ok;
}

// GIF frames go onto a canvas of the GIF's own size; disposal 2 clears the last frame's
// area to the page colour before the next one.
struct GifCanvas {
  uint8_t *px = nullptr;  // RGB565 big endian
  int w = 0, h = 0;
  int disposal = 0;       // of the frame just drawn
};

inline void gif_draw(GIFDRAW *g) {
  auto *cv = (GifCanvas *) g->pUser;
  cv->disposal = g->ucDisposalMethod;
  const int y = g->iY + g->y;
  if (y < 0 || y >= cv->h) return;
  uint8_t *row = cv->px + (size_t) y * cv->w * 2;
  const uint8_t *src = g->pPixels;
  for (int x = 0; x < g->iWidth; x++) {
    const int cx = g->iX + x;
    if (cx < 0 || cx >= cv->w) continue;
    const uint8_t i = src[x];
    if (g->ucHasTransparency && i == g->ucTransparent) continue;
    const uint16_t c = g->pPalette[i];  // already big endian (GIF_PALETTE_RGB565_BE)
    memcpy(row + cx * 2, &c, 2);
  }
}

// ------------------------------------------------------------------- route --

// Google's encoded polyline, precision 5 (what OSRM sends).
inline std::vector<std::pair<double, double>> decode_polyline(const char *s) {
  std::vector<std::pair<double, double>> pts;
  int lat = 0, lon = 0;
  while (*s) {
    for (int k = 0; k < 2; k++) {
      int shift = 0, result = 0, b;
      do {
        b = *s++ - 63;
        result |= (b & 0x1F) << shift;
        shift += 5;
      } while (b >= 0x20 && *s);
      const int delta = (result & 1) ? ~(result >> 1) : (result >> 1);
      (k == 0 ? lat : lon) += delta;
    }
    pts.push_back({lat / 1e5, lon / 1e5});
  }
  return pts;
}

// Web Mercator, 256 px tiles: world pixel coordinates at zoom z.
inline void mercator(double lat, double lon, int z, double *x, double *y) {
  const double n = 256.0 * (1 << z);
  const double r = lat * M_PI / 180.0;
  *x = (lon + 180.0) / 360.0 * n;
  *y = (1.0 - std::log(std::tan(r) + 1.0 / std::cos(r)) / M_PI) / 2.0 * n;
}

// The tile server for route maps, "https://host/{z}/{x}/{y}.png" with 256 px PNG tiles;
// {s} becomes a, b or c. Set from the YAML (substitution map_tiles).
inline std::string &tile_template() {
  static std::string t = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  return t;
}

inline void replace_all(std::string &s, const char *from, const std::string &to) {
  const size_t n = strlen(from);
  for (size_t at = s.find(from); at != std::string::npos; at = s.find(from, at + to.size())) s.replace(at, n, to);
}

struct TileTarget {
  Picture *out;
  int ox, oy;  // where the tile's top left corner lands on the map
};

inline void tile_draw(pngle_t *p, uint32_t x, uint32_t y, uint32_t w, uint32_t h, const uint8_t rgba[4]) {
  auto *t = (TileTarget *) pngle_get_user_data(p);
  const uint16_t c = ((rgba[0] & 0xF8) << 8) | ((rgba[1] & 0xFC) << 3) | (rgba[2] >> 3);
  for (uint32_t yy = 0; yy < h; yy++) {
    const int py = t->oy + (int) (y + yy);
    if (py < 0 || py >= t->out->h) continue;
    for (uint32_t xx = 0; xx < w; xx++) {
      const int px = t->ox + (int) (x + xx);
      if (px >= 0 && px < t->out->w) t->out->set(px, py, c);
    }
  }
}

// One tile, drawn at (ox, oy) of `out`, clipped; `out` is already sized.
inline bool decode_tile(const Download &d, Picture &out, int ox, int oy, std::string *error) {
  pngle_t *p = png_new();
  if (p == nullptr) {
    *error = "out of memory for a tile";
    return false;
  }
  TileTarget t{&out, ox, oy};
  pngle_set_user_data(p, &t);
  pngle_set_draw_callback(p, tile_draw);
  size_t at = 0;
  bool ok = true;
  while (at < d.size) {
    const int n = pngle_feed(p, d.data + at, std::min((size_t) 4096, d.size - at));
    if (n < 0) {
      *error = std::string("tile PNG error: ") + pngle_error(p);
      ok = false;
      break;
    }
    if (n == 0) break;
    at += n;
  }
  pngle_destroy(p);
  return ok;
}

// The map MAP_W x MAP_H whose top left corner is the world pixel (left, top) at zoom z,
// stitched from the tiles of tile_template(). A tile that fails stays page coloured;
// false only when none came or a newer job took over.
inline bool fetch_tiles(Picture &out, int z, double left, double top, uint32_t number, std::string *error) {
  if (!out.reserve(MAP_W, MAP_H)) {
    *error = "out of memory for the map";
    return false;
  }
  for (int y = 0; y < MAP_H; y++)
    for (int x = 0; x < MAP_W; x++) out.set(x, y, PAGE565);
  const long n = 1L << z;
  const long tx0 = (long) std::floor(left / 256.0), tx1 = (long) std::floor((left + MAP_W - 1) / 256.0);
  const long ty0 = (long) std::floor(top / 256.0), ty1 = (long) std::floor((top + MAP_H - 1) / 256.0);
  const uint32_t t0 = esphome::millis();
  int got = 0, asked = 0;
  Keep keep;
  for (long ty = ty0; ty <= ty1; ty++) {
    if (ty < 0 || ty >= n) continue;  // beyond the poles of the Mercator world
    for (long tx = tx0; tx <= tx1; tx++) {
      const long wx = ((tx % n) + n) % n;  // the world wraps at the date line
      std::string url = tile_template();
      replace_all(url, "{z}", std::to_string(z));
      replace_all(url, "{x}", std::to_string(wx));
      replace_all(url, "{y}", std::to_string(ty));
      replace_all(url, "{s}", std::string(1, "abc"[(wx + ty) % 3]));
      asked++;
      Download d;
      if (!http_get(url, d, 512 * 1024, number, &keep)) {
        *error = d.error;
        if (media().job_number.load() != number) return false;
        continue;
      }
      if (sniff(d) != PNG) {
        *error = "tile is not a PNG";
        continue;
      }
      std::string derr;
      if (decode_tile(d, out, (int) lround(tx * 256 - left), (int) lround(ty * 256 - top), &derr)) got++;
      else *error = derr;
    }
  }
  ESP_LOGI(TAG, "map: %d of %d tiles, zoom %d, %u ms", got, asked, z, (unsigned) (esphome::millis() - t0));
  if (got == 0) {
    if (error->empty()) *error = "no tiles";
    return false;
  }
  return true;
}

inline std::string url_encode(const std::string &s) {
  std::string o;
  char t[4];
  for (unsigned char c : s) {
    if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') o += (char) c;
    else if (c == ' ') o += "%20";
    else {
      snprintf(t, sizeof(t), "%%%02X", c);
      o += t;
    }
  }
  return o;
}

// "50.94,6.96" or a place name (looked up with Nominatim, OpenStreetMap's search).
inline bool locate(const std::string &where, double home_lat, double home_lon, double *lat, double *lon,
                   std::string *error, uint32_t number) {
  std::string w = where;
  for (auto &ch : w) ch = tolower(ch);
  if (w == "home" || w == "zuhause" || w == "daheim" || w == "hier") {
    if (std::isnan(home_lat) || std::isnan(home_lon)) {
      *error = "home has no coordinates (zone.home)";
      return false;
    }
    *lat = home_lat;
    *lon = home_lon;
    return true;
  }
  double a, b;
  char rest;
  if (sscanf(where.c_str(), " %lf , %lf %c", &a, &b, &rest) == 2 && fabs(a) <= 90 && fabs(b) <= 180) {
    *lat = a;
    *lon = b;
    return true;
  }
  Download d;
  const std::string url =
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + url_encode(where);
  if (!http_get(url, d, 256 * 1024, number)) {
    *error = "place search failed: " + d.error;
    return false;
  }
  JsonDocument doc;
  if (deserializeJson(doc, (const char *) d.data, d.size) || doc.size() == 0) {
    *error = "place not found: " + where;
    return false;
  }
  *lat = atof(doc[0]["lat"] | "nan");
  *lon = atof(doc[0]["lon"] | "nan");
  if (std::isnan(*lat) || std::isnan(*lon)) {
    *error = "place not found: " + where;
    return false;
  }
  return true;
}

// ------------------------------------------------------------------- task --

inline void publish(Media &m, int back) {
  xSemaphoreTake(m.lock, portMAX_DELAY);
  m.front = back;
  m.frames++;
  xSemaphoreGive(m.lock);
  m.state = READY;
}

inline void fail(Media &m, const std::string &why, const Job &job) {
  xSemaphoreTake(m.lock, portMAX_DELAY);
  m.error = why;
  xSemaphoreGive(m.lock);
  m.state = FAILED;
  ESP_LOGW(TAG, "%s failed: %s (%s)", job.kind == ROUTE ? "route" : "picture", why.c_str(),
           without_query(job.url).c_str());
}

// Still wanted: the display showed the picture within the last 3 s.
inline bool wanted(Media &m, uint32_t number) {
  return m.job_number.load() == number && (int32_t) (esphome::millis() - m.seen.load()) < 3000;
}

inline bool decode_still(Media &m, const Download &d, Format f, int back, const Job &job, std::string *err) {
  if (f == JPEG) return decode_jpeg(d, m.pic[back], job.max_w, job.max_h, err);
  if (f == PNG) return decode_png(d, m.pic[back], job.max_w, job.max_h, err);
  if (f == WEBP) *err = "WebP is not supported (JPEG, PNG, GIF are)";
  else if (f == UNKNOWN) *err = "not a picture (Content-Type " + d.type + ")";
  return false;
}

inline void play_gif(Media &m, const Download &d, const Job &job, uint32_t number) {
  auto *gif = in_psram<AnimatedGIF>();
  if (gif == nullptr) {
    fail(m, "out of memory for the GIF decoder", job);
    return;
  }
  gif->begin(GIF_PALETTE_RGB565_BE);
  GifCanvas cv;
  if (!gif->open(d.data, (int) d.size, gif_draw)) {
    fail(m, "GIF unreadable (error " + std::to_string(gif->getLastError()) + ")", job);
    free_psram(gif);
    return;
  }
  cv.w = gif->getCanvasWidth();
  cv.h = gif->getCanvasHeight();
  cv.px = (uint8_t *) heap_caps_malloc((size_t) cv.w * cv.h * 2, MALLOC_CAP_SPIRAM);
  int ow, oh;
  fit(cv.w, cv.h, job.max_w, job.max_h, &ow, &oh);
  if (cv.px == nullptr) {
    fail(m, "out of memory for the GIF", job);
    if (cv.px) heap_caps_free(cv.px);
    gif->close();
    free_psram(gif);
    return;
  }
  for (int i = 0; i < cv.w * cv.h; i++) {
    cv.px[2 * i] = PAGE565 >> 8;
    cv.px[2 * i + 1] = PAGE565 & 0xFF;
  }
  ESP_LOGI(TAG, "GIF %d x %d, %u bytes, shown %d x %d", cv.w, cv.h, (unsigned) d.size, ow, oh);
  int back = 1 - m.front, frames = 0;
  uint32_t due = esphome::millis();
  int disposal = 0, dx = 0, dy = 0, dw = 0, dh = 0;
  m.seen = esphome::millis();
  while (wanted(m, number)) {
    if (disposal == 2) {  // the last frame's area goes back to the page colour
      for (int y = dy; y < dy + dh && y < cv.h; y++)
        for (int x = dx; x < dx + dw && x < cv.w; x++) {
          cv.px[((size_t) y * cv.w + x) * 2] = PAGE565 >> 8;
          cv.px[((size_t) y * cv.w + x) * 2 + 1] = PAGE565 & 0xFF;
        }
    }
    int delay = 0;
    cv.disposal = 0;
    const int r = gif->playFrame(false, &delay, &cv);
    if (r < 0) {
      if (frames == 0) {
        fail(m, "GIF decode error " + std::to_string(gif->getLastError()), job);
        break;
      }
      gif->reset();
      continue;
    }
    dx = gif->getFrameXOff();
    dy = gif->getFrameYOff();
    dw = gif->getFrameWidth();
    dh = gif->getFrameHeight();
    disposal = cv.disposal;
    // Only the buffer that is not on screen is ever resized or written.
    if (!m.pic[back].reserve(ow, oh)) {
      fail(m, "out of memory for the GIF", job);
      break;
    }
    resample(cv.px, cv.w, cv.h, m.pic[back]);
    frames++;
    // Browsers show frames shorter than 20 ms for 100 ms; so does the box.
    if (delay < 20) delay = 100;
    const int32_t wait = (int32_t) (due - esphome::millis());
    if (wait > 0) vTaskDelay(pdMS_TO_TICKS(wait));
    publish(m, back);
    back = 1 - back;
    due = esphome::millis() + delay;
    if (r == 0) gif->reset();  // the last frame: loop
  }
  ESP_LOGI(TAG, "GIF stopped after %d frames", frames);
  heap_caps_free(cv.px);
  gif->close();
  free_psram(gif);
}

inline void run_route(Media &m, const Job &job, uint32_t number, double home_lat, double home_lon) {
  std::string err;
  double lat1, lon1, lat2, lon2;
  if (!locate(job.from, home_lat, home_lon, &lat1, &lon1, &err, number) ||
      !locate(job.to, home_lat, home_lon, &lat2, &lon2, &err, number)) {
    fail(m, err, job);
    return;
  }
  char path[200];
  snprintf(path, sizeof(path), "%.6f,%.6f;%.6f,%.6f", lon1, lat1, lon2, lat2);
  const std::string url = "https://routing.openstreetmap.de/routed-" + job.profile + "/route/v1/driving/" + path +
                          "?overview=simplified&geometries=polyline";
  Download d;
  if (!http_get(url, d, 512 * 1024, number)) {
    fail(m, "routing failed: " + d.error, job);
    return;
  }
  JsonDocument doc;
  if (deserializeJson(doc, (const char *) d.data, d.size)) {
    fail(m, "routing answer unreadable", job);
    return;
  }
  const char *code = doc["code"] | "";
  if (strcmp(code, "Ok") != 0 || doc["routes"].size() == 0) {
    fail(m, std::string("no route (") + code + ")", job);
    return;
  }
  const auto pts = decode_polyline(doc["routes"][0]["geometry"] | "");
  const float dist = doc["routes"][0]["distance"] | 0.0f, dur = doc["routes"][0]["duration"] | 0.0f;
  if (pts.size() < 2) {
    fail(m, "route without points", job);
    return;
  }
  // The largest zoom that fits the route between the title (top) and the info (bottom).
  double minx = 1e18, miny = 1e18, maxx = -1e18, maxy = -1e18;
  int z = 17;
  for (; z >= 2; z--) {
    minx = miny = 1e18;
    maxx = maxy = -1e18;
    for (const auto &p : pts) {
      double x, y;
      mercator(p.first, p.second, z, &x, &y);
      minx = std::min(minx, x), maxx = std::max(maxx, x), miny = std::min(miny, y), maxy = std::max(maxy, y);
    }
    if (maxx - minx <= MAP_W - 2 * 22 && maxy - miny <= 160 - 34) break;
  }
  // The map is MAP_W x MAP_H below the status bar; the route sits in its free part
  // (x 22 .. 298, y 34 .. 160, between the title and the distance), whose middle is
  // 8 px above the map's.
  const double cx = (minx + maxx) / 2.0, cy = (miny + maxy) / 2.0 + 8;
  const double left = cx - MAP_W / 2.0, top = cy - MAP_H / 2.0;
  const int back = 1 - m.front;
  std::string merr;
  if (!fetch_tiles(m.pic[back], z, left, top, number, &merr)) {
    fail(m, "map failed: " + merr, job);
    return;
  }
  std::vector<RoutePoint> route;
  for (const auto &p : pts) {
    double x, y;
    mercator(p.first, p.second, z, &x, &y);
    // screen coordinates: the map is drawn at y = MAP_TOP
    route.push_back({(int16_t) lround(x - left), (int16_t) lround(y - top + MAP_TOP)});
  }
  xSemaphoreTake(m.lock, portMAX_DELAY);
  m.route = std::move(route);
  m.distance_m = dist;
  m.duration_s = dur;
  xSemaphoreGive(m.lock);
  publish(m, back);
  ESP_LOGI(TAG, "route %s: %.1f km, %.0f min, %u points, zoom %d", job.profile.c_str(), dist / 1000.0f, dur / 60.0f,
           (unsigned) pts.size(), z);
}

// Home coordinates for "home" in routes; set by the YAML from zone.home.
inline double &home_lat() {
  static double v = NAN;
  return v;
}
inline double &home_lon() {
  static double v = NAN;
  return v;
}

inline void task(void *) {
  Media &m = media();
  while (true) {
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
    while (true) {
      // A job that arrived while the last one ran is the one read here; its wake-up must
      // not run it a second time afterwards (seen 07.10.2026: a route ran twice).
      ulTaskNotifyTake(pdTRUE, 0);
      xSemaphoreTake(m.lock, portMAX_DELAY);
      const Job job = m.job;
      xSemaphoreGive(m.lock);
      const uint32_t number = m.job_number.load();
      m.state = LOADING;
      m.frames = 0;
      ESP_LOGI(TAG, "job %u: %s %s", (unsigned) number,
               job.kind == ROUTE ? "route" : job.kind == LIVE ? "live view" : "picture",
               job.kind == ROUTE ? (job.from + " -> " + job.to + ", " + job.profile).c_str()
                                 : without_query(job.url).c_str());
      if (job.kind == ROUTE) {
        run_route(m, job, number, home_lat(), home_lon());
      } else {
        const uint32_t start = esphome::millis();
        do {
          Download d;
          const uint32_t t0 = esphome::millis();
          if (!http_get(job.url, d, MAX_FILE, number)) {
            if (m.job_number.load() == number) fail(m, d.error, job);
            break;
          }
          const Format f = sniff(d);
          if (f == GIF && job.kind == PHOTO) {
            m.kind_name = "GIF";
            play_gif(m, d, job, number);
            break;
          }
          const int back = 1 - m.front;
          std::string err;
          if (!decode_still(m, d, f, back, job, &err)) {
            fail(m, err, job);
            break;
          }
          m.kind_name = f == JPEG ? "JPEG" : "PNG";
          publish(m, back);
          if (job.kind == PHOTO)
            ESP_LOGI(TAG, "picture ready in %u ms: %u bytes (%s)", (unsigned) (esphome::millis() - t0),
                     (unsigned) d.size, without_query(job.url).c_str());
        } while (job.kind == LIVE && wanted(m, number) && esphome::millis() - start < job.seconds * 1000);
        if (job.kind == LIVE) ESP_LOGI(TAG, "live view ended after %u pictures", (unsigned) m.frames);
      }
      if (m.job_number.load() == number) break;  // no newer job came in meanwhile
    }
  }
}

// Starts a job; a running one stops at its next step. Called from the main loop.
inline void submit(const Job &job) {
  Media &m = media();
  if (m.lock == nullptr) {
    m.lock = xSemaphoreCreateMutex();
    xTaskCreatePinnedToCore(task, "muse_media", 16384, nullptr, 2, &m.task, 0);
  }
  xSemaphoreTake(m.lock, portMAX_DELAY);
  m.job = job;
  m.error.clear();
  m.route.clear();
  xSemaphoreGive(m.lock);
  m.state = LOADING;
  m.seen = esphome::millis();
  m.job_number++;
  xTaskNotifyGive(m.task);
}

}  // namespace media
}  // namespace muse
