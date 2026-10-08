// particles.test.js: the firmware's hash and the particle formulas, against values of
// tools/render_scene.py (its rnd() is the firmware's, bit for bit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { rnd, particles } from "../particles.js";
import { parse } from "../scene.js";

test("rnd() is the firmware's hash", () => {
  const golden = [[0, 1, 0.6475965976715088], [0, 2, 0.4022688865661621], [0, 3, 0.762319028377533], [0, 4, 0.3972473740577698],
    [977, 1, 0.09538280963897705], [977, 4, 0.4774930477142334], [4144442, 2, 0.5868516564369202],
    [123456, 7, 0.9468051195144653], [4294967295, 1, 0.05708789825439453]];
  for (const [a, b, v] of golden) assert.ok(Math.abs(rnd(a, b) - v) < 1e-12, `rnd(${a}, ${b})`);
  for (let i = 0; i < 1000; i++) {
    const v = rnd(i * 977 + 3, 2);
    assert.ok(v >= 0 && v < 1);
  }
});

test("the same frame shows the same particles", () => {
  const s = parse("particles confetti 70 speed=1.2\nparticles sparkle 30 color=#fff6d5\nparticles bubbles 20 x=0 y=0 w=320 h=200");
  for (const [k, p] of s.items.entries()) {
    const a = particles(p, k, 2000), b = particles(p, k, 2000), c = particles(p, k, 2100);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a.map((q) => q.y), c.map((q) => q.y), "they move");
  }
});

test("confetti falls through the area, bubbles rise, sparkles stay put and twinkle", () => {
  const s = parse("particles confetti 50 x=0 y=0 w=320 h=240\nparticles bubbles 20\nparticles sparkle 40\nparticles rain 10\nparticles snow 10");
  const confetti = particles(s.items[0], 0, 0);
  assert.equal(confetti.length, 50);
  assert.deepEqual(confetti.map((q) => q.color).slice(0, 8), [[255, 59, 48], [255, 149, 0], [255, 204, 0], [52, 199, 89],
    [48, 176, 199], [0, 122, 255], [175, 82, 222], [255, 45, 85]], "the palette repeats");
  assert.ok(confetti.every((q) => q.y >= -12 && q.y <= 240 + 12 && q.size === 1));
  const later = particles(s.items[0], 0, 100);
  assert.ok(later.every((q, i) => q.y > confetti[i].y || q.y < confetti[i].y - 200), "confetti falls (or wraps)");
  const bubbles = particles(s.items[1], 1, 0), bubblesLater = particles(s.items[1], 1, 100);
  assert.ok(bubblesLater.every((q, i) => q.y < bubbles[i].y || q.y > bubbles[i].y + 200), "bubbles rise (or wrap)");
  const a = particles(s.items[2], 2, 0), b = particles(s.items[2], 2, 700);
  assert.ok(a.length < 40 && a.every((q) => q.size >= 0.05 && q.size <= 1), "sparkles below 0.05 are left out");
  const ax = new Map(a.map((q) => [q.i, q.x]));
  assert.ok(b.every((q) => !ax.has(q.i) || ax.get(q.i) === q.x), "a sparkle never moves");
  assert.deepEqual(particles(s.items[3], 3, 0)[0].color, [120, 170, 255]);
  assert.deepEqual(particles(s.items[4], 4, 0)[0].color, [255, 255, 255]);
});
