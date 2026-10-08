// audio.test.js: the two sounds have the lengths of the box's files (tools/make_sounds.py).
import { test } from "node:test";
import assert from "node:assert/strict";
import { samples } from "../audio.js";

test("the chime is 1.1 s and the pling 0.35 s at 16 kHz, peaking at 0.8", () => {
  const timer = samples("timer"), ask = samples("ask");
  assert.equal(timer.length, 17600);
  assert.equal(ask.length, 5600);
  for (const s of [timer, ask]) {
    let peak = 0;
    for (const v of s) peak = Math.max(peak, Math.abs(v));
    assert.ok(Math.abs(peak - 0.8) < 1e-6);
    assert.equal(s[0], 0, "a soft start, no click");
  }
  // The third tone of the chime starts at 0.44 s and rings to the end.
  assert.ok(Math.abs(timer[Math.floor(0.45 * 16000)]) > 0.01);
});
