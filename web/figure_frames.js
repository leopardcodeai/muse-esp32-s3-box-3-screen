// figure_frames.js: where the figure comes from: the project's own frames, the owner's
// own frames from a folder URL, or the figure drawn in code while neither is there.
//
// The project's figure is six animated PNGs in figure-default/, copies of the files the
// box embeds (firmware/figure/, built by tools/make_figure.py from generated poses):
// idle.png, wave.png, working.png, making.png, confetti.png (160 x 160) and avatar.png
// (72 x 72). They load from this page's own server at the start (loadDefault) and are
// the figure everybody sees without a setting; `?figure=placeholder` shows them too,
// whatever the setting says.
//
// An owner who has run tools/make_muse_assets.py on his own Mac has
// firmware/figure/muse_<name>.png; he serves that folder on his own machine
// (web/tools/serve_frames.py) and names its URL in the settings ("Figur-Quelle"). The
// page then loads <url>/muse_idle.png, muse_wave.png, muse_working.png,
// muse_making.png, muse_confetti.png and muse_avatar.png at run time. Nothing of that
// folder ever reaches the server of this page.
//
// Every set is decoded frame by frame (apng.js) and played as the box plays it:
// ping-pong one step per 160 ms in a scene and 200 ms on the cards, confetti once.
//
// Pitfalls:
//  * The owner's frames are fetched from another origin, so the folder's server must
//    send Access-Control-Allow-Origin (serve_frames.py does); without it the fetch fails
//    and the project's figure stays.
//  * A picture that is missing or broken leaves the next source in its place: the
//    owner's frame, else the project's frame, else the figure drawn in code (figure.js),
//    which is also what shows in the moment before the project's frames have loaded.
//  * Frames are pictures and are shown frame by frame, also at 60 frames a second: there
//    is nothing between two of them to draw.
//  * From a page served over HTTPS, an http:// folder is mixed content unless it is on
//    this machine (http://127.0.0.1, http://localhost); Chrome and Edge then ask once
//    whether the page may reach this device (Local Network Access).
import { Figure, SIZE, AVATAR, STEP_MS, pingPongStep, onceStep } from "./figure.js";
import { decodeApng } from "./apng.js";

export const FIGURE_NAMES = ["idle", "wave", "working", "making", "confetti", "avatar"];
export const DEFAULT_FOLDER = "./figure-default"; // the project's figure, beside this page

// The URL of one picture in the owner's folder `base`.
export function frameUrl(base, name) {
  return `${String(base || "").trim().replace(/\/+$/, "")}/muse_${name}.png`;
}

// The URL of one picture of the project's figure in folder `base`.
export function defaultUrl(name, base = DEFAULT_FOLDER) {
  return `${String(base).replace(/\/+$/, "")}/${name}.png`;
}

// Which of `count` frames shows t ms after the animation started.
export function frameIndex(sub, t, count, stepMs = STEP_MS) {
  if (count <= 1 || sub === "avatar") return 0;
  if (sub === "confetti") return onceStep(t, stepMs, count, false);
  return pingPongStep(t, stepMs, count);
}

export class FigureSource {
  constructor({ placeholder = new Figure(), fetchImpl, decode = decodeApng, log = () => {} } = {}) {
    this.placeholder = placeholder; // the figure drawn in code, the last resort
    this.fetchImpl = fetchImpl || ((url, opts) => fetch(url, opts));
    this.decode = decode;
    this.log = log;
    this.url = "";
    this.frames = new Map(); // the owner's: name -> [ImageBitmap]
    this.failed = [];
    this.loading = false;
    this.serial = 0;
    this.defaults = new Map(); // the project's: name -> [ImageBitmap]
    this.defaultsFailed = [];
    this.defaultsLoading = false;
  }

  get smooth() {
    return this.placeholder.smooth;
  }

  set smooth(v) {
    this.placeholder.smooth = v;
  }

  // Fetches and decodes the six pictures `urlOf(name)`; resolves with [name, frames, error].
  async fetchSet(urlOf, opts) {
    return Promise.all(FIGURE_NAMES.map(async (name) => {
      try {
        // One retry: six requests at once against a small local server lost one now and
        // then ("Failed to fetch" for the avatar, 08.10.2026); the second try got it.
        const get = () => this.fetchImpl(urlOf(name), opts);
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
  }

  // Loads the project's figure from `base` (figure-default/ beside the page). Until it
  // is there, and for a picture that fails, the figure drawn in code stands in.
  async loadDefault(base = DEFAULT_FOLDER) {
    this.defaultsLoading = true;
    const results = await this.fetchSet((name) => defaultUrl(name, base), { credentials: "same-origin" });
    const loaded = new Map();
    const failed = [];
    for (const [name, frames, err] of results) {
      if (frames && frames.length) loaded.set(name, frames);
      else {
        failed.push(name);
        this.log(`figure ${name} not loaded from ${defaultUrl(name, base)}: ${err ? err.message : "no frames"}`);
      }
    }
    this.defaults = loaded;
    this.defaultsFailed = failed;
    this.defaultsLoading = false;
    return { loaded: loaded.size, failed: [...failed] };
  }

  // Switches to the owner's frames in folder `url`, or back to the project's figure with
  // "". Resolves with {loaded, failed} once every picture has loaded or failed.
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
    const results = await this.fetchSet((name) => frameUrl(this.url, name),
      { mode: "cors", cache: "no-cache", credentials: "omit" });
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
    const own = this.defaults.size === FIGURE_NAMES.length ? "Figur des Projekts"
      : this.defaultsLoading ? "Figur des Projekts, lädt …"
        : this.defaults.size ? `Figur des Projekts, ${this.defaults.size} von ${FIGURE_NAMES.length}`
          : "gezeichnete Figur";
    if (!this.url) return own;
    if (this.loading) return "eigene Bilder, laden …";
    if (this.frames.size === 0) return `eigene Bilder nicht erreichbar, ${own}`;
    return `eigene Bilder, ${this.frames.size} von ${FIGURE_NAMES.length}`;
  }

  // Draws like Figure.draw(): the owner's frame when it is there, else the project's,
  // else the figure drawn in code.
  draw(r, sub, t, x0, y0, stepMs = STEP_MS) {
    const frames = this.frames.get(sub) || this.defaults.get(sub);
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
