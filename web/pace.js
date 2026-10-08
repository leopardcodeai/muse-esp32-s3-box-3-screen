// pace.js: how often the display draws and how large, as pure functions for the tests.
//
// The box draws ten pictures a second (an `interval: 100ms` that updates the display).
// The web app draws up to the display's refresh rate: the frame rate setting is 10 (the
// box, for a side-by-side test), 30 or 60. Every picture is drawn from the time in
// milliseconds, so a scene looks the same at every rate, only smoother above 10.
//
// Pitfalls:
//  * requestAnimationFrame runs at the screen's rate (60 Hz, 120 Hz on ProMotion,
//    144 Hz elsewhere), which is rarely a multiple of the chosen rate. FrameClock keeps
//    a timeline of due times instead of comparing with the last picture, so 10 frames a
//    second stay 10 on every screen and never drift; a little slack takes the jitter of
//    the animation frame timestamps.
//  * The scale is a multiple of 1/80, so 320 x 240 times it are whole CSS pixels and
//    the canvas backing store (times devicePixelRatio) whole device pixels: text stays
//    sharp on Retina instead of being resampled.
export const FPS_CHOICES = [60, 30, 10];
export const BOX_FPS = 10;
export const DEFAULT_FPS = 60;

// A valid frame rate from a setting or a URL parameter; anything else is the default.
export function normaliseFps(v, fallback = DEFAULT_FPS) {
  const n = Number(v);
  return FPS_CHOICES.includes(n) ? n : fallback;
}

export class FrameClock {
  constructor(fps = DEFAULT_FPS, slackMs = 2) {
    this.slack = slackMs;
    this.next = -Infinity;
    this.set(fps);
  }

  set(fps) {
    this.fps = normaliseFps(fps);
    this.interval = 1000 / this.fps;
    this.next = -Infinity;
  }

  // Whether a picture is due at `now` (ms); when it is, the next one is planned.
  due(now) {
    if (now < this.next - this.slack) return false;
    this.next += this.interval;
    if (this.next < now) this.next = now + this.interval; // fell behind (a hidden tab): start over
    return true;
  }
}

// The scale k (CSS px per logical px) for a stage of `w` x `h` CSS px: the largest
// multiple of 1/80 that fits, whole numbers only when `integer`, never below 0.25.
export function fitScale(w, h, logicalW, logicalH, integer = false) {
  let k = Math.min(w / logicalW, h / logicalH);
  if (integer && k >= 1) k = Math.floor(k);
  else k = Math.floor(k * 80) / 80;
  return Math.max(0.25, k);
}
