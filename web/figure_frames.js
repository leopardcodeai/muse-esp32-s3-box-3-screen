// figure_frames.js: where the figure comes from, the placeholder or the owner's own
// frames from a folder URL.
//
// The deployment carries only the placeholder (figure.js). An owner who has run
// tools/make_muse_assets.py on his own Mac has firmware/figure/muse_<name>.png, animated
// PNGs of 160 x 160 (the avatar 72 x 72); he serves that folder on his own machine
// (web/tools/serve_frames.py) and names its URL in the settings ("Figur-Quelle"). The
// page then loads <url>/muse_idle.png, muse_wave.png, muse_working.png,
// muse_making.png, muse_confetti.png and muse_avatar.png at run time, decodes their
// frames (apng.js) and plays them as the box does: ping-pong one step per 160 ms in a
// scene and 200 ms on the cards, confetti once. Nothing of that folder ever reaches the
// server of this page.
//
// Pitfalls:
//  * The frames are fetched, so the folder's server must send
//    Access-Control-Allow-Origin (serve_frames.py does); without it the fetch fails and
//    the placeholder stays.
//  * A picture that is missing or broken leaves the placeholder in its place; the
//    settings dialog and the console say which ones loaded.
//  * The owner's frames are pictures and are shown frame by frame, also at 60 frames a
//    second: there is nothing between two video frames to draw.
//  * From a page served over HTTPS, an http:// folder is mixed content unless it is on
//    this machine (http://127.0.0.1, http://localhost); Chrome and Edge then ask once
//    whether the page may reach this device (Local Network Access).
import { Figure, SIZE, AVATAR, STEP_MS, pingPongStep, onceStep } from "./figure.js";
import { decodeApng } from "./apng.js";

export const FIGURE_NAMES = ["idle", "wave", "working", "making", "confetti", "avatar"];

// The URL of one picture in the folder `base`.
export function frameUrl(base, name) {
  return `${String(base || "").trim().replace(/\/+$/, "")}/muse_${name}.png`;
}

// Which of `count` frames shows t ms after the animation started.
export function frameIndex(sub, t, count, stepMs = STEP_MS) {
  if (count <= 1 || sub === "avatar") return 0;
  if (sub === "confetti") return onceStep(t, stepMs, count, false);
  return pingPongStep(t, stepMs, count);
}

export class FigureSource {
  constructor({ placeholder = new Figure(), fetchImpl, decode = decodeApng, log = () => {} } = {}) {
    this.placeholder = placeholder;
    this.fetchImpl = fetchImpl || ((url, opts) => fetch(url, opts));
    this.decode = decode;
    this.log = log;
    this.url = "";
    this.frames = new Map(); // name -> [ImageBitmap]
    this.failed = [];
    this.loading = false;
    this.serial = 0;
  }

  get smooth() {
    return this.placeholder.smooth;
  }

  set smooth(v) {
    this.placeholder.smooth = v;
  }

  // Switches to the frames in folder `url`, or back to the placeholder with "".
  // Resolves with {loaded, failed} once every picture has loaded or failed.
  async use(url) {
    const serial = ++this.serial;
    this.url = String(url || "").trim();
    this.frames = new Map();
    this.failed = [];
    if (!this.url) {
      this.loading = false;
      return { loaded: 0, failed: [] };
    }
    this.loading = true;
    const results = await Promise.all(FIGURE_NAMES.map(async (name) => {
      try {
        // One retry: six requests at once against a small local server lost one now and
        // then ("Failed to fetch" for the avatar, 08.10.2026); the second try got it.
        const get = () => this.fetchImpl(frameUrl(this.url, name), { mode: "cors", cache: "no-cache", credentials: "omit" });
        let res;
        try {
          res = await get();
        } catch {
          await new Promise((r) => setTimeout(r, 300));
          res = await get();
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const frames = await this.decode(new Uint8Array(await res.arrayBuffer()));
        return [name, frames, null];
      } catch (e) {
        return [name, null, e];
      }
    }));
    if (serial !== this.serial) return { loaded: 0, failed: [], stale: true };
    for (const [name, frames, err] of results) {
      if (frames && frames.length) this.frames.set(name, frames);
      else {
        this.failed.push(name);
        this.log(`figure ${name} not loaded from ${frameUrl(this.url, name)}: ${err ? err.message : "no frames"}`);
      }
    }
    this.loading = false;
    return { loaded: this.frames.size, failed: [...this.failed] };
  }

  // A short German line for the settings dialog and the display's info.
  describe() {
    if (!this.url) return "Platzhalter";
    if (this.loading) return "eigene Bilder, laden …";
    if (this.frames.size === 0) return "eigene Bilder nicht erreichbar, Platzhalter";
    return `eigene Bilder, ${this.frames.size} von ${FIGURE_NAMES.length}`;
  }

  // Draws like Figure.draw(): the owner's frame when it is there, the placeholder else.
  draw(r, sub, t, x0, y0, stepMs = STEP_MS) {
    const frames = this.frames.get(sub);
    if (!frames) {
      this.placeholder.draw(r, sub, t, x0, y0, stepMs);
      return;
    }
    const size = sub === "avatar" ? AVATAR : SIZE;
    const ctx = r.ctx;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(frames[frameIndex(sub, t, frames.length, stepMs)], x0, y0, size, size);
    ctx.restore();
  }
}
