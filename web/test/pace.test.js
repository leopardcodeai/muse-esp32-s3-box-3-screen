// pace.test.js: the frame clock holds 10, 30 and 60 pictures a second on screens of
// 60, 120 and 144 Hz without drift, and the scale keeps whole pixels.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FrameClock, fitScale, normaliseFps, FPS_CHOICES, BOX_FPS } from "../pace.js";

// Pictures drawn in `seconds` when animation frames come at `hz` with a little jitter.
function drawn(fps, hz, seconds = 10) {
  const clock = new FrameClock(fps);
  const times = [];
  const frame = 1000 / hz;
  for (let i = 0; i * frame < seconds * 1000; i++) {
    const now = 5000 + i * frame + (i % 3 === 0 ? 0.6 : i % 3 === 1 ? -0.4 : 0.1);
    if (clock.due(now)) times.push(now);
  }
  return times;
}

test("10, 30 and 60 frames a second on 60, 120 and 144 Hz screens", () => {
  for (const hz of [60, 120, 144]) {
    for (const fps of FPS_CHOICES) {
      const n = drawn(fps, hz).length;
      const want = Math.min(fps, hz) * 10;
      assert.ok(Math.abs(n - want) <= 1, `${fps} fps on ${hz} Hz: ${n} pictures in 10 s, want ${want}`);
    }
  }
});

test("box-exact: 10 frames a second are 100 ms apart on a 60 Hz screen", () => {
  const t = drawn(BOX_FPS, 60, 2);
  const gaps = t.slice(1).map((x, i) => Math.round(x - t[i]));
  assert.ok(gaps.every((g) => g >= 99 && g <= 101), gaps.join(","));
});

test("a hidden tab that comes back does not draw a burst", () => {
  const c = new FrameClock(60);
  assert.ok(c.due(0));
  assert.ok(c.due(16.7));
  assert.ok(c.due(60000), "after a minute away: one picture");
  assert.equal(c.due(60001), false, "and not a second one at once");
});

test("normaliseFps() and fitScale()", () => {
  assert.equal(normaliseFps("30"), 30);
  assert.equal(normaliseFps(25), 60);
  assert.equal(normaliseFps(undefined, 10), 10);
  assert.equal(fitScale(1000, 800, 320, 240), 3.125);
  const k = fitScale(1003, 777, 320, 240);
  assert.equal(Number.isInteger(320 * k) && Number.isInteger(240 * k), true, "whole CSS pixels");
  assert.ok(320 * k <= 1003 && 240 * k <= 777);
  assert.equal(fitScale(1003, 777, 320, 240, true), 3);
  assert.equal(fitScale(50, 50, 320, 240), 0.25);
});
