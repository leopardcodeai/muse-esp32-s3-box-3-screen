// figure.test.js: the figure steps like the box (ping-pong, 160 ms in a scene, 200 ms on
// the cards, confetti once), the smooth position meets the box's frames at every step,
// the figure source takes the owner's frames first, then the project's, then the figure
// drawn in code, and the project's frames in figure-default/ are the box's own files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pingPongStep, pingPongPos, onceStep, STEP_MS, CARD_STEP_MS, FRAMES, CONFETTI_FRAMES } from "../figure.js";
import { FigureSource, frameIndex, frameUrl, defaultUrl, DEFAULT_FOLDER, FIGURE_NAMES } from "../figure_frames.js";

test("ping-pong like the box: 0 .. 15 and back, one step per 160 ms", () => {
  const seq = [];
  for (let i = 0; i < 32; i++) seq.push(pingPongStep(i * STEP_MS));
  assert.deepEqual(seq, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1]);
  assert.equal(pingPongStep(159), 0);
  assert.equal(pingPongStep(160), 1);
});

test("the cards step every 200 ms, as the box does on its 100 ms ticks", () => {
  // The box steps once at least 160 ms have passed, checked every 100 ms: at 200, 400, ...
  let frame = 0, step = 0;
  const box = [];
  for (let now = 0; now <= 3000; now += 100) {
    if (now - step >= 160) { step = now; frame++; }
    box.push(frame);
  }
  const web = [];
  for (let now = 0; now <= 3000; now += 100) web.push(Math.floor(now / CARD_STEP_MS));
  assert.deepEqual(web, box);
});

test("the smooth position equals the box's frame at every whole step and lies between", () => {
  for (let i = 0; i < 2 * (FRAMES - 1) * 2; i++) {
    assert.equal(pingPongPos(i * STEP_MS), pingPongStep(i * STEP_MS), `step ${i}`);
  }
  const mid = pingPongPos(2.5 * STEP_MS);
  assert.ok(mid > 2 && mid < 3);
  const turn = pingPongPos(15.5 * STEP_MS);
  assert.ok(turn > 14 && turn < 15, "turns back without a jump");
  assert.equal(onceStep(10 * 1000, STEP_MS), CONFETTI_FRAMES - 1, "confetti holds its last frame");
  assert.equal(onceStep(250, STEP_MS, CONFETTI_FRAMES, true), 250 / STEP_MS);
});

test("frameIndex(): avatar still, confetti once, the rest ping-pong over the file's frames", () => {
  assert.equal(frameIndex("avatar", 5000, 1), 0);
  assert.equal(frameIndex("confetti", 0, 18), 0);
  assert.equal(frameIndex("confetti", 100000, 18), 17);
  assert.equal(frameIndex("idle", 16 * STEP_MS, 16), 14);
  assert.equal(frameIndex("wave", 3 * CARD_STEP_MS, 16, CARD_STEP_MS), 3);
  assert.equal(frameUrl("http://127.0.0.1:8322/", "idle"), "http://127.0.0.1:8322/muse_idle.png");
});

test("FigureSource: loads the owner's six pictures, the figure drawn in code for the missing ones", async () => {
  const asked = [];
  const placeholderCalls = [];
  const placeholder = { smooth: false, draw: (...a) => placeholderCalls.push(a[1]) };
  const src = new FigureSource({
    placeholder,
    fetchImpl: async (url) => {
      asked.push(url);
      if (url.endsWith("muse_wave.png")) return { ok: false, status: 404 };
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    },
    decode: async () => ["f0", "f1", "f2"],
  });
  assert.equal(src.describe(), "gezeichnete Figur", "nothing loaded yet: the figure drawn in code");
  src.smooth = true;
  assert.equal(placeholder.smooth, true, "smooth goes to the figure drawn in code");
  const r = await src.use("http://127.0.0.1:8322");
  assert.deepEqual(asked, FIGURE_NAMES.map((n) => `http://127.0.0.1:8322/muse_${n}.png`));
  assert.equal(r.loaded, 5);
  assert.deepEqual(r.failed, ["wave"]);
  assert.equal(src.describe(), "eigene Bilder, 5 von 6");
  const drawn = [];
  const r2d = { ctx: { save() {}, restore() {}, drawImage: (img, x, y, w, h) => drawn.push([img, x, y, w, h]) } };
  src.draw(r2d, "idle", 2 * STEP_MS, 80, 30);
  src.draw(r2d, "avatar", 0, 12, 32);
  src.draw(r2d, "wave", 0, 80, 30);
  assert.deepEqual(drawn, [["f2", 80, 30, 160, 160], ["f0", 12, 32, 72, 72]]);
  assert.deepEqual(placeholderCalls, ["wave"]);
  await src.use("");
  assert.equal(src.describe(), "gezeichnete Figur");
});

test("FigureSource: the project's frames are the default, the owner's go first, code draws the rest", async () => {
  const asked = [];
  const placeholderCalls = [];
  const placeholder = { smooth: false, draw: (...a) => placeholderCalls.push(a[1]) };
  const src = new FigureSource({
    placeholder,
    fetchImpl: async (url) => {
      asked.push(url);
      if (url.endsWith("/confetti.png") || url.endsWith("muse_wave.png") || url.endsWith("muse_confetti.png")) {
        return { ok: false, status: 404 };
      }
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode(url).buffer };
    },
    decode: async (bytes) => {
      const url = new TextDecoder().decode(bytes);
      return [url + "#0", url + "#1", url + "#2"];
    },
  });
  const pending = src.loadDefault();
  assert.equal(src.describe(), "Figur des Projekts, lädt …");
  const r = await pending;
  assert.deepEqual(asked, FIGURE_NAMES.map((n) => `${DEFAULT_FOLDER}/${n}.png`));
  assert.equal(defaultUrl("idle"), "./figure-default/idle.png");
  assert.deepEqual([r.loaded, r.failed], [5, ["confetti"]]);
  assert.equal(src.describe(), "Figur des Projekts, 5 von 6");
  const drawn = [];
  const r2d = { ctx: { save() {}, restore() {}, drawImage: (img, x, y, w, h) => drawn.push([img, x, y, w, h]) } };
  src.draw(r2d, "wave", 2 * STEP_MS, 80, 30);
  src.draw(r2d, "confetti", 0, 80, 22);
  assert.deepEqual(drawn, [["./figure-default/wave.png#2", 80, 30, 160, 160]]);
  assert.deepEqual(placeholderCalls, ["confetti"], "what the project lacks is drawn in code");
  await src.use("http://127.0.0.1:8322");
  drawn.length = 0;
  src.draw(r2d, "idle", STEP_MS, 80, 30);
  src.draw(r2d, "wave", STEP_MS, 80, 30);
  assert.deepEqual(drawn.map((d) => d[0]), ["http://127.0.0.1:8322/muse_idle.png#1", "./figure-default/wave.png#1"],
    "the owner's frame first, the project's where the owner's is missing");
  assert.equal(src.describe(), "eigene Bilder, 4 von 6");
});

test("figure-default/ holds the box's own frames, byte for byte", () => {
  for (const name of FIGURE_NAMES) {
    const web = readFileSync(new URL(`../figure-default/${name}.png`, import.meta.url));
    const box = readFileSync(new URL(`../../firmware/figure/${name}.png`, import.meta.url));
    assert.ok(web.equals(box), `${name}.png: copy firmware/figure/${name}.png to web/figure-default/`);
  }
});
