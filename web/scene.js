// scene.js: the scene language of muse_draw, parsed into elements.
//
// A port of firmware/muse_scene.h (the box's parser) and of the parser half of
// tools/render_scene.py: the same commands, keys, defaults, clamps, limits and
// messages, so a scene that the box answers with "line 4: ..." gets the same answer
// here, and so that the renderer in draw.js finds the same elements the box draws.
//
// Pitfalls:
//  * Messages are part of the contract: an assistant corrects its next scene from
//    them. Change a message here only together with muse_scene.h.
//  * The order of the icon names matters for the "did you mean" suggestion: the first
//    of two equally close names wins, so ICON_WORDS keeps the firmware's order.
//  * Numbers follow the firmware's integer casts: ms values, strokes, radii and the
//    seconds are truncated, not rounded.
import { ICON_MAP, ICON_WORDS } from "./icons.js";

export const MAX_SOURCE = 16384;
export const MAX_ITEMS = 250;
export const MAX_FRAMES = 24;
export const MAX_TEXT = 500;
export const MAX_PARTICLES = 150;
export const MAX_ERRORS = 12;

export const PAGE = [243, 243, 243]; // the page colour of the Muse screens
export const INK = [28, 28, 30];

// Pixel sizes of the six text fonts (xs .. xxl) and the two icon fonts (s, l).
export const TEXT_PX = [13, 16, 20, 24, 36, 54];
export const ICON_PX = [24, 46];

export const FIGURES = ["idle", "wave", "working", "making", "avatar"];
export const PARTICLE_KINDS = ["confetti", "snow", "rain", "sparkle", "bubbles"];

const NAMED_COLORS = {
  white: [255, 255, 255], black: [0, 0, 0], ink: INK, page: PAGE,
  gray: [142, 142, 147], grey: [142, 142, 147], lightgray: [209, 209, 214], lightgrey: [209, 209, 214],
  darkgray: [72, 72, 74], darkgrey: [72, 72, 74], red: [255, 59, 48], orange: [255, 149, 0],
  yellow: [255, 204, 0], gold: [255, 214, 10], green: [52, 199, 89], mint: [0, 199, 190],
  teal: [48, 176, 199], cyan: [50, 173, 230], blue: [0, 122, 255], navy: [16, 30, 72],
  indigo: [88, 86, 214], purple: [175, 82, 222], pink: [255, 45, 85], brown: [162, 132, 94],
};
const COLOR_HINT = "use #rrggbb or a name (white, black, gray, red, orange, yellow, green, mint, teal, cyan, "
  + "blue, navy, indigo, purple, pink, brown, gold, page, ink)";

// Keys every drawn element takes.
const COMMON = "opacity delay dur blink fade move period";

// command: kind, drawn element (true) or a setting of the scene, positional values, keys.
const COMMANDS = {
  bg: { kind: "bg", item: true, pos: ["color", "to"], keys: "color to dir" },
  rect: { kind: "rect", item: true, pos: ["x", "y", "w", "h", "color"], keys: "x y w h color r line" },
  circle: { kind: "circle", item: true, pos: ["x", "y", "r", "color"], keys: "x y r color line pulse" },
  line: { kind: "line", item: true, pos: ["x", "y", "x2", "y2", "color"], keys: "x y x2 y2 color w" },
  tri: { kind: "tri", item: true, pos: ["x", "y", "x2", "y2", "x3", "y3", "color"], keys: "x y x2 y2 x3 y3 color line" },
  star: { kind: "star", item: true, pos: ["x", "y", "r", "color"], keys: "x y r color points inner rot spin pulse line" },
  poly: { kind: "poly", item: true, pos: ["x", "y", "r", "sides", "color"], keys: "x y r sides color rot spin pulse line" },
  text: { kind: "text", item: true, pos: ["x", "y", "text"], keys: "x y text size color align valign w lines lh type" },
  icon: { kind: "icon", item: true, pos: ["x", "y", "name", "color"], keys: "x y name color size" },
  muse: { kind: "muse", item: true, pos: ["x", "y", "anim"], keys: "x y anim r" },
  bar: { kind: "bar", item: true, pos: ["x", "y", "w", "h", "value", "color"], keys: "x y w h value color bg r" },
  particles: { kind: "particles", item: true, pos: ["kind", "count", "color"], keys: "kind count color icon size x y w h speed" },
  // A button answers a touch with its text (muse_wait_answer, the sensor "Antwort").
  button: { kind: "button", item: true, pos: ["x", "y", "w", "h", "text", "color"], keys: "x y w h text color size r" },
  seconds: { kind: "bg", item: false, pos: ["n"], keys: "n" },
  frame: { kind: "bg", item: false, pos: ["ms"], keys: "ms" },
  once: { kind: "bg", item: false, pos: [], keys: "" },
};
const COMMAND_NAMES = Object.keys(COMMANDS);
// English synonyms, and the German words an assistant may slip into.
const COMMAND_ALIASES = {
  background: "bg", rectangle: "rect", box: "rect", triangle: "tri", polygon: "poly", figure: "muse",
  avatar: "muse", progress: "bar", particle: "particles", duration: "seconds", hintergrund: "bg",
  rechteck: "rect", kreis: "circle", linie: "line", dreieck: "tri", stern: "star", vieleck: "poly",
  symbol: "icon", figur: "muse", balken: "bar", partikel: "particles", sekunden: "seconds",
  dauer: "seconds", einmal: "once", taste: "button", knopf: "button", schaltflaeche: "button",
};

export class Item {
  constructor(kind, line = 0, frame = -1) {
    this.kind = kind;
    this.line = line; // line of the source, for messages
    this.frame = frame; // -1: every frame
    this.x = NaN; this.y = NaN; this.w = NaN; this.h = NaN; this.r = NaN;
    this.x2 = NaN; this.y2 = NaN; this.x3 = NaN; this.y3 = NaN;
    this.color = INK;
    this.color2 = PAGE; // bg: second colour of the gradient; bar: the track
    this.gradient = false; // bg: a second colour was given
    this.horizontal = false; // bg: the gradient runs left to right
    this.hasColor = false; // a colour was given (particles: one colour instead of the palette)
    this.hasColor2 = false; // bar: a track colour was given
    this.hasSize = false;
    this.opacity = 1.0;
    this.stroke = 0; // outline width in px; 0 fills
    this.radius = 0; // rect corners; -1 makes a pill
    this.points = 5; // star points, polygon sides
    this.inner = 0.45; // star: inner radius as a share of r
    this.rot = 0; // degrees, clockwise
    this.value = 0; // bar: 0 .. 100
    this.size = 1; // text: index into TEXT_PX; icon: index into ICON_PX
    this.align = 0; // 0 left, 1 centre, 2 right
    this.valign = 0; // 0 top, 1 middle, 2 bottom
    this.wrap = 0; // text: wrap width in px, 0 keeps one line
    this.maxLines = 0; // text: 0 = as many as needed
    this.lineH = 0; // text: 0 = from the font
    this.count = 40; // particles
    this.speed = 1.0; // particles
    this.sub = kind === "muse" ? "idle" : "confetti"; // particles: PARTICLE_KINDS; muse: FIGURES
    this.glyph = 0; // icon, or particles drawn as an icon
    this.text = "";
    this.delay = 0; this.dur = 0; this.blink = 0; this.fade = 0; this.type = 0;
    this.moveX = 0; this.moveY = 0;
    this.period = 3000; this.spin = 0; this.pulse = 0;
  }
}

export class Scene {
  constructor() {
    this.items = [];
    this.frames = []; // length of each frame in ms; empty: no frames
    this.once = false; // frames play once and hold the last one
    this.seconds = 20;
    this.errors = [];
    this.skipped = 0; // elements left out because of an error
  }
  cycle() {
    let t = 0;
    for (const f of this.frames) t += f;
    return t;
  }
  // The frame shown t ms after the start; -1 when the scene has no frames.
  frameAt(t) {
    if (this.frames.length === 0) return -1;
    const c = this.cycle();
    if (c === 0) return 0;
    if (this.once && t >= c) return this.frames.length - 1;
    t = Math.floor(t) % c;
    for (let i = 0; i < this.frames.length; i++) {
      if (t < this.frames[i]) return i;
      t -= this.frames[i];
    }
    return this.frames.length - 1;
  }
}

// ------------------------------------------------------------------ time --

function local(it, t) {
  return t > it.delay ? t - it.delay : 0;
}

// Whether an element is on screen t ms after the scene started, in frame `frame`.
export function visible(it, t, frame) {
  if (it.frame >= 0 && it.frame !== frame) return false;
  if (t < it.delay) return false;
  const l = t - it.delay;
  if (it.dur > 0 && l >= it.dur) return false;
  if (it.blink > 0 && Math.floor(l / it.blink) % 2 === 1) return false;
  return true;
}

// Opacity at t: fades in over `fade` ms after its delay, and out again over the last
// `fade` ms of its duration.
export function alpha(it, t) {
  let a = it.opacity;
  if (it.fade > 0) {
    const l = local(it, t);
    if (l < it.fade) a *= l / it.fade;
    if (it.dur > 0 && l < it.dur && it.dur - l < it.fade) a *= (it.dur - l) / it.fade;
  }
  return a < 0 ? 0 : a > 1 ? 1 : a;
}

// Offset of a moving element: there and back once per period, eased. Returns [dx, dy].
export function offset(it, t) {
  if ((it.moveX === 0 && it.moveY === 0) || it.period === 0) return [0, 0];
  const phase = (local(it, t) % it.period) / it.period;
  const s = (1 - Math.cos(2 * Math.PI * phase)) * 0.5;
  return [it.moveX * s, it.moveY * s];
}

// Rotation in degrees at t (star, polygon).
export function angle(it, t) {
  if (it.spin === 0) return it.rot;
  return it.rot + (360 * (local(it, t) % it.spin)) / it.spin;
}

// Size factor of a pulsing circle, star or polygon: 0.88 .. 1.12.
export function scale(it, t) {
  if (it.pulse === 0) return 1;
  return 1 + 0.12 * Math.sin((2 * Math.PI * (local(it, t) % it.pulse)) / it.pulse);
}

// How many characters of a typed text are out at t; Infinity when it is not typed.
export function typed(it, t) {
  if (it.type === 0) return Infinity;
  return Math.floor(local(it, t) / it.type) + 1;
}

export function mix(fg, bg, a) {
  if (a >= 1) return fg;
  if (a <= 0) return bg;
  return [
    Math.round(bg[0] + (fg[0] - bg[0]) * a),
    Math.round(bg[1] + (fg[1] - bg[1]) * a),
    Math.round(bg[2] + (fg[2] - bg[2]) * a),
  ];
}

export function bgAt(bg, px, py) {
  if (!bg.gradient) return bg.color;
  const f = bg.horizontal ? px / 319 : py / 239;
  return mix(bg.color2, bg.color, f < 0 ? 0 : f > 1 ? 1 : f);
}

// The colour of the scene at (px, py) below element `before` at t: the topmost filled
// rectangle, circle or bar that covers the point, else the background. Translucent
// layers are collected on the way down and laid on top again on the way up.
export function under(s, before, px, py, t, frame) {
  const LAYERS = 16;
  const layerC = [];
  const layerA = [];
  let base = PAGE;
  for (let k = before; k-- > 0;) {
    const it = s.items[k];
    if (!visible(it, t, frame)) continue;
    if (it.kind === "bg") {
      base = bgAt(it, px, py);
      break;
    }
    const a = alpha(it, t);
    if (a <= 0) continue;
    const [dx, dy] = offset(it, t);
    const x = it.x + dx, y = it.y + dy;
    let c = null;
    let hit = false;
    if (it.kind === "rect" && it.stroke === 0) {
      hit = px >= x && px < x + it.w && py >= y && py < y + it.h;
      c = it.color;
    } else if (it.kind === "circle" && it.stroke === 0) {
      const r = it.r * scale(it, t);
      hit = (px - x) * (px - x) + (py - y) * (py - y) <= r * r;
      c = it.color;
    } else if (it.kind === "bar") {
      hit = px >= x && px < x + it.w && py >= y && py < y + it.h;
      c = px < x + (it.w * it.value) / 100 ? it.color : it.color2;
    }
    if (!hit) continue;
    if (a >= 1 || layerC.length === LAYERS) {
      base = c;
      break;
    }
    layerC.push(c);
    layerA.push(a);
  }
  for (let i = layerC.length - 1; i >= 0; i--) base = mix(layerC[i], base, layerA[i]);
  return base;
}

// ----------------------------------------------------------------- parsing --

// ASCII lower case only, like the firmware (umlauts are handled where they matter).
export function lower(s) {
  return s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
}

export function trim(s) {
  return s.replace(/^[ \t\r\n]+/, "").replace(/[ \t\r\n]+$/, "");
}

// "12", "-3.5", "12px", "500ms", "65%" -> number, or null.
export function number(raw) {
  let s = lower(raw);
  for (const unit of ["px", "ms", "%"]) {
    if (s.length > unit.length && s.endsWith(unit)) {
      s = s.slice(0, -unit.length);
      break;
    }
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

// "#rgb", "#rrggbb", with alpha "#rgba" or "#rrggbbaa", or a name -> {rgb, a} or null.
export function parseColor(raw) {
  const s = lower(trim(raw));
  if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, s)) return { rgb: NAMED_COLORS[s], a: 1 };
  const h = s.startsWith("#") ? s.slice(1) : s;
  if (![3, 4, 6, 8].includes(h.length) || !/^[0-9a-f]*$/.test(h)) return null;
  const v = [...h].map((ch) => parseInt(ch, 16));
  if (h.length <= 4) return { rgb: [v[0] * 17, v[1] * 17, v[2] * 17], a: h.length === 4 ? (v[3] * 17) / 255 : 1 };
  return {
    rgb: [v[0] * 16 + v[1], v[2] * 16 + v[3], v[4] * 16 + v[5]],
    a: h.length === 8 ? (v[6] * 16 + v[7]) / 255 : 1,
  };
}

// Icon names the way the table holds them: lower case, "mdi:" gone, words joined by
// "-", umlauts spelt out, other Latin-1 letters dropped.
export function iconKey(raw) {
  let l = trim(raw).toLowerCase();
  if (l.startsWith("mdi:")) l = l.slice(4);
  let k = "";
  for (const ch of l) {
    if (ch === "ä") k += "ae";
    else if (ch === "ö") k += "oe";
    else if (ch === "ü") k += "ue";
    else if (ch === "ß") k += "ss";
    else if (ch >= "À" && ch <= "ÿ") continue;
    else k += ch === " " || ch === "_" ? "-" : ch;
  }
  return k;
}

// The codepoint of an icon by its MDI name ("coffee", "mdi:coffee") or one of its
// other names ("kaffee", "klingel"); 0 when there is none.
export function iconCodepoint(raw) {
  return ICON_MAP.get(iconKey(raw)) || 0;
}

export function distance(a, b) {
  const row = [];
  for (let j = 0; j <= b.length; j++) row.push(j);
  for (let i = 1; i <= a.length; i++) {
    let diag = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return row[b.length];
}

// The closest of `names` to `word`: a name that has the word as one of its parts first
// ("sunny" -> "weather-sunny"), else the nearest by edit distance, if near enough.
export function closest(word, names) {
  let best = "";
  let bestD = Infinity;
  for (const n of names) {
    const at = n.indexOf(word);
    if (word && at >= 0 && (at === 0 || n[at - 1] === "-")
      && (at + word.length === n.length || n[at + word.length] === "-")) {
      if (bestD > 0 || n.length < best.length) best = n;
      bestD = 0;
      continue;
    }
    const d = distance(word, n);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  const limit = word.length < 6 ? 2 : Math.floor(word.length / 3);
  return bestD <= limit ? best : "";
}

const isSpace = (c) => c === " " || c === "\t" || c === "\r";

// Splits one command into tokens: words, "quoted" or 'quoted' strings (\" \\ \n inside),
// key=value and key="quoted value". A quote only opens at the start of a value.
export function tokenize(s) {
  const out = [];
  let openQuote = false;
  let i = 0;
  const n = s.length;
  for (;;) {
    while (i < n && isSpace(s[i])) i++;
    if (i >= n) break;
    let key = "";
    let j = i;
    while (j < n && !isSpace(s[j]) && s[j] !== "=" && s[j] !== '"' && s[j] !== "'") j++;
    if (j < n && s[j] === "=" && j > i) {
      key = lower(s.slice(i, j));
      i = j + 1;
    }
    let value = "";
    if (i < n && (s[i] === '"' || s[i] === "'")) {
      const q = s[i++];
      let closed = false;
      while (i < n) {
        const c = s[i++];
        if (c === "\\" && i < n) {
          const d = s[i++];
          value += d === "n" ? "\n" : d;
          continue;
        }
        if (c === q) {
          closed = true;
          break;
        }
        value += c;
      }
      if (!closed) openQuote = true;
    } else {
      let k = i;
      while (k < n && !isSpace(s[k])) k++;
      value = s.slice(i, k);
      i = k;
    }
    out.push({ key, value });
  }
  return { tokens: out, openQuote };
}

// Cuts the source into commands at line ends, and at ";" outside quotes and comments.
// A comment runs to the end of its line, ";" included: "#" or "//" where a command
// starts, or after a command as "# " (with a space, so "#fff" stays a colour) or "//".
export function statements(src) {
  const out = [];
  let cur = "";
  let line = 1;
  let startLine = 1;
  let quote = "";
  let tokenStart = true;
  let comment = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\n") {
      out.push({ line: startLine, text: cur });
      cur = "";
      quote = "";
      comment = false;
      tokenStart = true;
      startLine = ++line;
      continue;
    }
    if (comment) continue;
    if (!quote) {
      const next = i + 1 < src.length ? src[i + 1] : "\n";
      const start = /^[ \t\r]*$/.test(cur);
      const hash = c === "#" && (start || (tokenStart && (next === " " || next === "\t" || next === "\r" || next === "\n")));
      const slashes = c === "/" && next === "/" && (start || tokenStart);
      if (hash || slashes) {
        comment = true;
        continue;
      }
    }
    if (quote) {
      if (c === "\\" && i + 1 < src.length && src[i + 1] !== "\n") {
        cur += c + src[++i];
        continue;
      }
      if (c === quote) quote = "";
      cur += c;
      tokenStart = false;
      continue;
    }
    if (c === ";") {
      out.push({ line: startLine, text: cur });
      cur = "";
      tokenStart = true;
      continue;
    }
    if ((c === '"' || c === "'") && tokenStart) quote = c;
    cur += c;
    tokenStart = isSpace(c) || c === "=";
  }
  out.push({ line: startLine, text: cur });
  return out;
}

function command(name) {
  const n = Object.prototype.hasOwnProperty.call(COMMAND_ALIASES, name) ? COMMAND_ALIASES[name] : name;
  return Object.prototype.hasOwnProperty.call(COMMANDS, n) ? { name: n, ...COMMANDS[n] } : null;
}

function hasWord(list, w) {
  return (" " + list + " ").includes(" " + w + " ");
}

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);
const BIG = 2000;

class Parser {
  constructor(scene) {
    this.s = scene;
    this.frame = -1;
    this.full = false;
    this.extra = 0;
  }

  error(line, msg) {
    if (this.s.errors.length < MAX_ERRORS) this.s.errors.push(`line ${line}: ${msg}`);
    else this.extra++;
  }

  finish() {
    if (this.extra > 0) this.s.errors[this.s.errors.length - 1] += ` (and ${this.extra} more)`;
  }

  statement(line, raw) {
    const text = trim(raw);
    if (!text || text[0] === "#" || text.startsWith("//")) return;
    const { tokens, openQuote } = tokenize(text);
    if (tokens.length === 0) return;
    if (openQuote) this.error(line, "a quote is not closed; it ends at the end of the line");
    if (tokens[0].key) {
      // "seconds=30" reads as "seconds 30"
      tokens.splice(1, 0, { key: "", value: tokens[0].value });
      tokens[0] = { key: "", value: tokens[0].key };
    }
    const name = lower(tokens[0].value);
    const cmd = command(name);
    if (cmd === null) {
      const near = closest(name, COMMAND_NAMES);
      this.error(line, `unknown command '${name}'` + (near ? `; did you mean '${near}'?` : ""));
      this.s.skipped++;
      return;
    }
    tokens.shift();
    if (!cmd.item) {
      this.setting(line, cmd, tokens);
      return;
    }
    if (this.s.items.length >= MAX_ITEMS) {
      if (!this.full) this.error(line, `more than ${MAX_ITEMS} elements; the rest is left out`);
      this.full = true;
      this.s.skipped++;
      return;
    }
    const it = new Item(cmd.kind, line, this.frame);
    if (name === "avatar") it.sub = "avatar";
    let opacitySet = false;
    let ok = true;
    let p = 0;
    const rest = []; // text: words after the positional ones
    for (const t of tokens) {
      let key = t.key;
      if (!key) {
        if (p < cmd.pos.length) {
          key = cmd.pos[p++];
        } else if (it.kind === "text" || it.kind === "button") {
          rest.push(t.value);
          continue;
        } else {
          this.error(line, `${cmd.name}: one value too many: '${t.value}'`);
          continue;
        }
      }
      if (key === "x1") key = "x";
      if (key === "y1") key = "y";
      if (key === "colour") key = "color";
      if (!hasWord(cmd.keys, key) && !hasWord(COMMON, key)) {
        this.error(line, `${cmd.name}: unknown key '${key}'; keys: ${cmd.keys} ${COMMON}`);
        continue;
      }
      if (key === "opacity") opacitySet = true;
      if (!this.set(line, it, key, t.value, opacitySet)) ok = false;
    }
    if ((it.kind === "text" || it.kind === "button") && rest.length) {
      it.text = it.text ? it.text + " " + rest.join(" ") : rest.join(" ");
    }
    if (ok) ok = this.complete(line, it);
    if (!ok) {
      this.s.skipped++;
      return;
    }
    this.s.items.push(it);
  }

  setting(line, cmd, tokens) {
    if (cmd.name === "once") {
      this.s.once = true;
      return;
    }
    const v = tokens.length ? tokens[0].value : "";
    if (cmd.name === "seconds") {
      let factor = 1;
      let l = lower(v);
      if (l.length > 3 && l.endsWith("min")) {
        l = l.slice(0, -3);
        factor = 60;
      } else if (l.length > 1 && l.endsWith("s") && !l.endsWith("ms")) {
        l = l.slice(0, -1);
      }
      const n = number(l);
      if (n === null) {
        this.error(line, `seconds: '${v}' is not a number`);
        return;
      }
      this.s.seconds = Math.trunc(clamp(n * factor, 3, 3600));
      return;
    }
    // frame [ms]; "frame end" goes back to elements shown in every frame
    if (lower(v) === "end" || lower(v) === "all") {
      this.frame = -1;
      return;
    }
    let ms = 500;
    if (v) {
      const n = number(v);
      if (n === null) this.error(line, `frame: '${v}' is not a number of ms; 500 ms instead`);
      else ms = Math.trunc(clamp(n, 50, 10000));
    }
    if (this.s.frames.length >= MAX_FRAMES) {
      this.error(line, `more than ${MAX_FRAMES} frames; the rest goes into the last one`);
      return;
    }
    this.s.frames.push(ms);
    this.frame = this.s.frames.length - 1;
  }

  num(line, it, key, v, lo, hi) {
    const n = number(v);
    if (n === null) {
      this.error(line, `${it.kind}: ${key}='${v}' is not a number`);
      return null;
    }
    return clamp(n, lo, hi);
  }

  ms(line, it, key, v) {
    const n = this.num(line, it, key, v, 0, 3600000);
    return n === null ? null : Math.trunc(n);
  }

  choice(line, it, key, v, names, fallback) {
    const l = lower(trim(v));
    const i = names.indexOf(l);
    if (i >= 0) return i;
    this.error(line, `${it.kind}: ${key}='${v}' is none of ${names.join(", ")}`);
    return fallback;
  }

  // One key of an element. False when the element cannot be drawn without this value.
  set(line, it, key, v, opacitySet) {
    const put = (attr, lo, hi, int = false) => {
      const n = this.num(line, it, key, v, lo, hi);
      if (n !== null) it[attr] = int ? Math.trunc(n) : n;
    };
    const msKey = { delay: "delay", dur: "dur", blink: "blink", fade: "fade", type: "type", spin: "spin", pulse: "pulse" };
    if (key === "x" || key === "y" || key === "x2" || key === "y2" || key === "x3" || key === "y3") {
      put(key, -BIG, BIG);
    } else if (key === "h") {
      put("h", 0, BIG);
    } else if (key === "w") {
      if (it.kind === "line") put("stroke", 1, 40, true);
      else if (it.kind === "text") put("wrap", 0, BIG, true);
      else put("w", 0, BIG);
    } else if (key === "r") {
      if (it.kind === "rect" || it.kind === "bar" || it.kind === "button") {
        if (lower(v) === "pill" || lower(v) === "full") it.radius = -1;
        else put("radius", 0, 500, true);
      } else {
        put("r", 0, 1000);
      }
    } else if (key === "color" || key === "to" || (key === "bg" && it.kind === "bar")) {
      const c = parseColor(v);
      if (c === null) {
        this.error(line, `${it.kind}: ${key}='${v}' is no colour; ${COLOR_HINT}`);
        return !(it.kind === "bg" && key === "color");
      }
      if (key === "color") {
        it.color = c.rgb;
        it.hasColor = true;
        if (c.a < 1 && !opacitySet) it.opacity = c.a;
      } else {
        it.color2 = c.rgb;
        it.hasColor2 = true;
        if (key === "to") it.gradient = true;
      }
    } else if (key === "dir") {
      it.horizontal = this.choice(line, it, key, v, ["down", "right"], 0) === 1;
    } else if (key === "line") {
      put("stroke", 0, 50, true);
    } else if (key === "opacity") {
      const n = this.num(line, it, key, v, 0, 100);
      if (n !== null) it.opacity = n > 1 ? n / 100 : n;
    } else if (key === "points" || key === "sides") {
      put("points", 3, 24, true);
    } else if (key === "inner") {
      put("inner", 0.1, 1.0);
    } else if (key === "rot") {
      put("rot", -3600, 3600);
    } else if (key === "value") {
      put("value", 0, 100);
    } else if (key === "text") {
      it.text = [...v].length > MAX_TEXT ? [...v].slice(0, MAX_TEXT).join("") : v;
    } else if (key === "size") {
      this.size(line, it, v);
    } else if (key === "align") {
      const i = this.choice(line, it, key, v, ["left", "center", "right", "centre", "middle"], 0);
      it.align = i >= 3 ? 1 : i;
    } else if (key === "valign") {
      const i = this.choice(line, it, key, v, ["top", "middle", "bottom", "center", "centre"], 0);
      it.valign = i >= 3 ? 1 : i;
    } else if (key === "lines") {
      put("maxLines", 0, 20, true);
    } else if (key === "lh") {
      put("lineH", 0, 200, true);
    } else if (key === "name" || key === "icon") {
      const cp = iconCodepoint(v);
      if (cp === 0) {
        const near = closest(iconKey(v), ICON_WORDS);
        this.error(line, `${it.kind}: no icon '${v}'` + (near ? `; did you mean '${near}'?` : ""));
        return it.kind !== "icon";
      }
      it.glyph = cp;
    } else if (key === "anim") {
      it.sub = FIGURES[this.choice(line, it, key, v, FIGURES, 0)];
    } else if (key === "kind") {
      it.sub = PARTICLE_KINDS[this.choice(line, it, key, v, PARTICLE_KINDS, 0)];
    } else if (key === "count") {
      put("count", 1, MAX_PARTICLES, true);
    } else if (key === "speed") {
      put("speed", 0.1, 5.0);
    } else if (Object.prototype.hasOwnProperty.call(msKey, key)) {
      const n = this.ms(line, it, key, v);
      if (n !== null) it[msKey[key]] = n;
    } else if (key === "period") {
      const n = this.ms(line, it, key, v);
      if (n !== null) it.period = n < 100 ? 100 : n;
    } else if (key === "move") {
      // move=dx,dy
      const comma = v.indexOf(",");
      const dx = comma >= 0 ? number(trim(v.slice(0, comma))) : null;
      const dy = comma >= 0 ? number(trim(v.slice(comma + 1))) : null;
      if (dx === null || dy === null) {
        this.error(line, `${it.kind}: move='${v}' should be dx,dy such as move=0,-12`);
      } else {
        it.moveX = clamp(dx, -BIG, BIG);
        it.moveY = clamp(dy, -BIG, BIG);
      }
    }
    return true;
  }

  size(line, it, v) {
    const l = lower(trim(v));
    it.hasSize = true;
    if (it.kind === "icon" || it.kind === "particles") {
      if (l === "s" || l === "small" || l === "m") it.size = 0;
      else if (l === "l" || l === "large" || l === "xl") it.size = 1;
      else {
        const n = number(l);
        if (n !== null) it.size = n < 35 ? 0 : 1;
        else this.error(line, `${it.kind}: size='${v}' is none of s, l (24, 46 px)`);
      }
      return;
    }
    const names = ["xs", "s", "m", "l", "xl", "xxl"];
    const i = names.indexOf(l);
    if (i >= 0) {
      it.size = i;
      return;
    }
    const n = number(l);
    if (n === null) {
      this.error(line, `text: size='${v}' is none of xs, s, m, l, xl, xxl (13, 16, 20, 24, 36, 54 px)`);
      return;
    }
    let best = 0;
    for (let k = 1; k < 6; k++) if (Math.abs(TEXT_PX[k] - n) < Math.abs(TEXT_PX[best] - n)) best = k;
    it.size = best;
  }

  // Checks what an element needs to be drawn at all, and fills in sensible defaults.
  complete(line, it) {
    const need = (have, what) => {
      if (!have) this.error(line, `${it.kind}: needs ${what}`);
      return have;
    };
    const def = (attr, d) => {
      if (Number.isNaN(it[attr])) it[attr] = d;
    };
    switch (it.kind) {
      case "bg":
        if (!it.hasColor) it.color = PAGE;
        return true;
      case "rect":
        def("x", 0);
        def("y", 0);
        return need(it.w > 0 && it.h > 0, "w and h above 0");
      case "circle":
      case "star":
      case "poly":
        def("x", 160);
        def("y", 120);
        return need(it.r > 0, "r above 0");
      case "line":
        def("x", 0);
        def("y", 0);
        if (it.stroke === 0) it.stroke = 1;
        return need(!Number.isNaN(it.x2) && !Number.isNaN(it.y2), "x2 and y2");
      case "tri":
        return need(![it.x, it.y, it.x2, it.y2, it.x3, it.y3].some(Number.isNaN), "three points: x y x2 y2 x3 y3");
      case "text":
        def("x", 0);
        def("y", 0);
        return need(trim(it.text) !== "", "a text");
      case "icon":
        def("x", 160);
        def("y", 120);
        if (it.size > 1) it.size = 1;
        return need(it.glyph !== 0, "an icon name");
      case "muse":
        def("x", 160);
        def("y", 110);
        if (Number.isNaN(it.r) || it.r > 80) it.r = 80;
        if (it.r < 20) it.r = 20;
        return true;
      case "bar":
        def("x", 0);
        def("y", 0);
        if (!it.hasColor) it.color = [52, 199, 89];
        if (!it.hasColor2) it.color2 = [209, 209, 214];
        return need(it.w > 0 && it.h > 0, "w and h above 0");
      case "particles":
        def("x", 0);
        def("y", 0);
        def("w", 320);
        def("h", 240);
        if (!it.hasSize || it.size > 1) it.size = 0;
        return true;
      case "button":
        def("x", 0);
        def("y", 0);
        if (!it.hasColor) it.color = [0, 122, 255];
        if (!it.hasSize) it.size = 2; // text size m
        if (it.radius === 0) it.radius = -1; // a pill unless r was given
        return need(it.w > 0 && it.h > 0, "w and h above 0") && need(trim(it.text) !== "", "a text");
      default:
        return true;
    }
  }
}

// A scene from its source, with every message the box would give.
export function parse(src) {
  const s = new Scene();
  const p = new Parser(s);
  const bytes = new TextEncoder().encode(src);
  let body = src;
  if (bytes.length > MAX_SOURCE) {
    p.error(1, `the scene has ${bytes.length} bytes; only the first ${MAX_SOURCE} are read`);
    body = new TextDecoder().decode(bytes.subarray(0, MAX_SOURCE)).replace(/�$/, "");
  }
  for (const st of statements(body)) p.statement(st.line, st.text);
  p.finish();
  return s;
}

// The button under (px, py) at time t in frame `frame`, or -1. The touch has to land
// inside the button; no margin, so two buttons may touch each other.
export function buttonAt(s, px, py, t, frame) {
  for (let k = s.items.length; k-- > 0;) {
    const it = s.items[k];
    if (it.kind !== "button" || !visible(it, t, frame)) continue;
    const [dx, dy] = offset(it, t);
    if (px >= it.x + dx && px < it.x + dx + it.w && py >= it.y + dy && py < it.y + dy + it.h) return k;
  }
  return -1;
}

// The response of muse_draw, as the box answers it.
export function response(s) {
  return {
    ok: s.errors.length === 0,
    elements: s.items.length,
    frames: s.frames.length,
    seconds: s.seconds,
    skipped: s.skipped,
    errors: [...s.errors],
  };
}
