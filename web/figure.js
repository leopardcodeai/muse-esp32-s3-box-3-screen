// figure.js: the figure's pace, and the figure drawn in code as the last resort.
//
// On the box the figure is a set of pictures: idle, wave, working and making with 16
// frames each, played forwards and back; confetti with 18 frames played once; a 72 px
// avatar. In a scene the box takes the frame from the scene's time, one step per 160 ms
// (muse.h, t / 160). On the ready screen and the celebration it steps once at least
// 160 ms have passed, checked on its 100 ms display ticks, which is one step every
// second tick: 200 ms (CARD_STEP_MS). The step functions here serve every source.
//
// The figure itself comes from pictures (figure_frames.js): the project's own frames in
// figure-default/, the same files the box embeds (tools/make_figure.py), or the owner's
// own frames at run time. Figure below draws only while those pictures load or when they
// fail: the flat round character the project shipped before its generated figure (a
// blue body with a darker lower half, white eyes, pink cheeks, a smile; a waving arm,
// thought dots, an orbiting spark, falling confetti), with its geometry and colours,
// including the fade of every frame's edges into the page colour. tools/render_scene.py
// keeps the same stand-in (draw_coded_figure). Meta's own Muse artwork is not part of
// this project.
//
// Smooth: above the box's 10 frames a second the drawn figure is drawn between its
// frames (`smooth`), with the same timing, so it moves like the box's, only without the
// steps. At 10 frames a second it shows the box's frames exactly.
import { PAGE, INK, css } from "./render.js";

export const SIZE = 160;
export const AVATAR = 72;
export const BODY = [76, 150, 214];
export const BODY_DARK = [54, 112, 168];
export const CHEEK = [255, 158, 158];
export const SPARK = [255, 204, 0];
export const CONFETTI = [
  [255, 59, 48], [255, 149, 0], [255, 204, 0], [52, 199, 89], [48, 176, 199], [0, 122, 255], [175, 82, 222], [255, 45, 85],
];
export const FRAMES = 16;
export const CONFETTI_FRAMES = 18;
export const STEP_MS = 160; // a step in a scene
export const CARD_STEP_MS = 200; // a step on the ready screen and the celebration

const deg = (d) => (d * Math.PI) / 180;

// The frame of a looping animation t ms after it started: 0 .. frames - 1 forwards,
// then back, one step per `stepMs`.
export function pingPongStep(t, stepMs = STEP_MS, frames = FRAMES) {
  if (frames <= 1) return 0;
  const step = Math.floor(Math.max(0, t) / stepMs) % (2 * (frames - 1));
  return step < frames ? step : 2 * (frames - 1) - step;
}

// The same as a continuous position between the frames: equal to pingPongStep() at
// every whole step, a straight line between two of them.
export function pingPongPos(t, stepMs = STEP_MS, frames = FRAMES) {
  if (frames <= 1) return 0;
  const cycle = 2 * (frames - 1);
  const pos = (Math.max(0, t) / stepMs) % cycle;
  return pos <= frames - 1 ? pos : cycle - pos;
}

// The frame of a once-only animation (confetti) t ms after it started; it holds the last.
export function onceStep(t, stepMs = STEP_MS, frames = CONFETTI_FRAMES, smooth = false) {
  const pos = Math.max(0, t) / stepMs;
  return Math.min(frames - 1, smooth ? pos : Math.floor(pos));
}

export class Figure {
  constructor() {
    this.smooth = false; // draw between the frames (above 10 frames a second)
  }

  // Draws the figure's frame at (x0, y0): `sub` is idle, wave, working, making, avatar
  // or confetti; `t` ms since the animation started, `stepMs` the length of a step
  // (STEP_MS in a scene, CARD_STEP_MS on the cards). The frame is an opaque square in
  // the page colour, like the box's pictures, whose edges fade into that colour: on the
  // page the square is invisible, in a scene the caller clips it to a disc, which is the
  // light round frame the box shows there.
  draw(r, sub, t, x0, y0, stepMs = STEP_MS) {
    const size = sub === "avatar" ? AVATAR : SIZE;
    const c = r.ctx;
    c.save();
    c.translate(x0, y0);
    c.fillStyle = css(PAGE);
    c.fillRect(0, 0, size, size);
    if (sub === "confetti") drawConfettiFrame(c, onceStep(t, stepMs, CONFETTI_FRAMES, this.smooth), size);
    else drawFrame(c, sub, t, size, stepMs, this.smooth);
    c.restore();
  }
}

// One frame of idle, wave, working, making or the avatar, on a canvas whose origin is
// the frame's top left corner (the port of draw_coded_figure in tools/render_scene.py);
// `smooth` draws the position between two frames.
export function drawFrame(c, sub, t, size, stepMs = STEP_MS, smooth = false) {
  const step = smooth ? pingPongPos(t, stepMs) : pingPongStep(t, stepMs);
  const phase = step / FRAMES;
  const cx = size / 2;
  const [cy, br] = sub === "avatar" ? [size * 0.5, size * 0.4]
    : sub === "working" || sub === "making" ? [size * 0.56, size * 0.28] : [size * 0.54, size * 0.3];
  if (sub === "wave") { // the waving hand: a small disc on an arm that swings
    const ang = deg(-60 + 35 * Math.sin(4 * Math.PI * phase));
    const ax = cx + br * 0.95, ay = cy - br * 0.1;
    const hx = ax + Math.cos(ang) * br * 0.55, hy = ay + Math.sin(ang) * br * 0.55;
    thickLine(c, ax, ay, hx, hy, br * 0.16, BODY_DARK);
    disc(c, hx, hy, br * 0.14, BODY);
  }
  const squash = sub === "idle" ? 1 + 0.03 * Math.sin(2 * Math.PI * phase) : 1; // breathing
  body(c, cx, cy, br, squash);
  const look = sub === "working" ? Math.sin(2 * Math.PI * phase) : 0;
  const blink = sub === "idle" && Math.round(step) === 11;
  face(c, cx, cy, br, look, blink, { wave: 1.2, working: 0.4, making: 0.9 }[sub] ?? 1.0);
  if (sub === "working") { // three thought dots above, swelling one after another
    for (let k = 0; k < 3; k++) {
      const p = (Math.sin(2 * Math.PI * (phase - k * 0.18)) + 1) / 2;
      disc(c, cx + (k - 1) * br * 0.32, cy - br * 1.25 - k * br * 0.05, br * (0.06 + 0.05 * p), BODY_DARK);
    }
  }
  if (sub === "making") { // a spark that orbits the head
    const ang = 2 * Math.PI * phase;
    star(c, cx + Math.cos(ang) * br * 1.25, cy - br * 0.4 + Math.sin(ang) * br * 0.5, br * 0.16, SPARK);
  }
}

// Frame i of the drawn confetti animation: the body bounces,
// confetti falls from the top at fixed positions; a fractional i lies between two.
export function drawConfettiFrame(c, i, size) {
  const n = CONFETTI_FRAMES;
  const t = i / (n - 1);
  const cx = size / 2, cy = size * 0.58, br = size * 0.26;
  const bounce = Math.abs(Math.sin(Math.PI * t * 2)) * br * 0.15;
  body(c, cx, cy - bounce, br, 1);
  face(c, cx, cy - bounce, br, 0, false, 1.3);
  for (let k = 0; k < 26; k++) {
    const seed = ((k * 7919) % 1000) / 1000;
    const x = (k * 61) % size;
    const y = ((seed * size + t * size * 1.4) % (size * 1.2)) - size * 0.1;
    const w = br * 0.09, h = br * 0.05 * (0.5 + Math.abs(Math.sin(2 * Math.PI * (t + seed))));
    c.fillStyle = css(CONFETTI[k % 8]);
    c.fillRect(x - w, y - h, 2 * w, 2 * h);
  }
}

// A round body with a darker lower half, slightly squashed for breathing.
function body(c, cx, cy, r, squash) {
  const rx = r, ry = r * squash;
  c.beginPath();
  c.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
  c.fillStyle = css(BODY);
  c.fill();
  c.beginPath();
  c.ellipse(cx, cy, rx, ry, 0, deg(20), deg(160));
  c.closePath();
  c.fillStyle = css(BODY_DARK);
  c.fill();
  c.beginPath();
  c.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
  c.lineWidth = 3;
  c.strokeStyle = css(BODY_DARK);
  c.stroke();
}

function face(c, cx, cy, r, look, blink, smile) {
  const ex = r * 0.34, ey = cy - r * 0.12, er = r * 0.11;
  for (const sx of [-1, 1]) {
    const x = cx + sx * ex + look * r * 0.1;
    if (blink) {
      thickLine(c, x - er, ey, x + er, ey, 3, INK, false);
    } else {
      disc(c, x, ey, er, [255, 255, 255]);
      disc(c, x + look * er * 0.4, ey, er * 0.55, INK);
    }
  }
  for (const sx of [-1, 1]) {
    const x = cx + sx * r * 0.52;
    c.beginPath();
    c.ellipse(x, cy + r * 0.12, r * 0.1, r * 0.06, 0, 0, 2 * Math.PI);
    c.fillStyle = css(CHEEK);
    c.fill();
  }
  const my = cy + r * 0.3, mw = r * 0.26;
  if (smile >= 0) {
    c.beginPath();
    c.ellipse(cx, my, mw, Math.max(0.01, mw * smile), 0, deg(10), deg(170));
    c.lineWidth = 3;
    c.lineCap = "butt";
    c.strokeStyle = css(INK);
    c.stroke();
  } else {
    c.beginPath();
    c.ellipse(cx, my, mw * 0.4, mw * 0.3, 0, 0, 2 * Math.PI);
    c.fillStyle = css(INK);
    c.fill();
  }
}

function disc(c, x, y, r, color) {
  c.beginPath();
  c.arc(x, y, r, 0, 2 * Math.PI);
  c.fillStyle = css(color);
  c.fill();
}

function thickLine(c, x1, y1, x2, y2, w, color, round = true) {
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.lineWidth = w;
  c.lineCap = round ? "round" : "butt";
  c.strokeStyle = css(color);
  c.stroke();
  c.lineCap = "butt";
}

function star(c, sx, sy, s, color) {
  c.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = (Math.PI / 5) * k - Math.PI / 2;
    const rr = k % 2 === 0 ? s : s * 0.45;
    const x = sx + Math.cos(a) * rr, y = sy + Math.sin(a) * rr;
    if (k === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.closePath();
  c.fillStyle = css(color);
  c.fill();
}
