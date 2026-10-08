// weather.js: the weather icons of the cards, Meteocons by Bas Milius (MIT), the
// "fill" set, as SVG from a CDN. The box carries the same icons as PNG in
// firmware/icons/, cropped to one common square so that a sun and a cloud keep their
// relative size (tools/make_weather_icons.py); CROP is that square in the SVG's own
// 512 px box, so the icons here are cut like the box's.
//
// Pitfalls:
//  * The images are loaded with crossOrigin "anonymous": jsDelivr answers with CORS
//    headers, so drawing them keeps the canvas clean and the video fallback of Float
//    keeps working. Images from a server without CORS would taint the canvas.
//  * The SVGs carry a viewBox but no width or height, so a browser reports no natural
//    size for them. Each one is drawn once into a 1024 px canvas and cropped from
//    there, which works the same in every browser.
//  * An icon that is still loading is left out of the picture; the next picture draws it.
import { WEATHER } from "./text.js";

export const METEOCONS_VERSION = "2.0.0";
export const METEOCONS_CDN = `https://cdn.jsdelivr.net/npm/@bybas/weather-icons@${METEOCONS_VERSION}/production/fill/all/`;

// The Meteocons file for every weather number of the box (the order of WEATHER).
export const METEOCONS = [
  "clear-day", "clear-night", "partly-cloudy-day", "partly-cloudy-night", "cloudy", "overcast", "fog", "drizzle",
  "rain", "raindrops", "partly-cloudy-day-rain", "thunderstorms", "thunderstorms-rain", "snow", "sleet", "hail",
  "wind", "tornado", "umbrella", "thermometer", "raindrop", "sunrise", "sunset",
];

// The common square around the union of all drawn areas, measured on the 23 SVGs
// rendered at 512 px in Chrome the way tools/make_weather_icons.py measures them
// (union 52, 64 to 459, 506; the side is the larger span plus 8 px, centred).
export const CROP = { x: 31, y: 60, size: 450 };
const RASTER = 1024; // px of the canvas each SVG is drawn into (its viewBox is 512)

export class WeatherIcons {
  constructor() {
    this.entries = new Map(); // index -> {img, canvas}
  }

  url(index) {
    return METEOCONS_CDN + METEOCONS[index] + ".svg";
  }

  // The rasterised icon for a weather number, or null while it loads or when there is none.
  get(index) {
    if (index < 0 || index >= WEATHER.length) return null;
    let e = this.entries.get(index);
    if (!e) {
      const img = new Image();
      e = { img, canvas: null };
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.addEventListener("load", () => {
        const c = document.createElement("canvas");
        c.width = RASTER;
        c.height = RASTER;
        c.getContext("2d").drawImage(img, 0, 0, RASTER, RASTER);
        e.canvas = c;
      });
      img.src = this.url(index);
      this.entries.set(index, e);
    }
    return e.canvas;
  }

  // Draws weather icon `index` into a square of `size` px at (x, y), cropped like the
  // box's PNGs, with their soft shadow.
  draw(r, index, x, y, size) {
    const src = this.get(index);
    if (!src) return false;
    const ctx = r.ctx;
    const s = RASTER / 512;
    ctx.save();
    ctx.shadowColor = "rgba(60,60,70,0.3)";
    ctx.shadowBlur = size * 0.07 * r.k;
    ctx.shadowOffsetY = Math.max(1, Math.round(size * 0.03)) * r.k;
    ctx.drawImage(src, CROP.x * s, CROP.y * s, CROP.size * s, CROP.size * s, x, y, size, size);
    ctx.restore();
    return true;
  }
}
