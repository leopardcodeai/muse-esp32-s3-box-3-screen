// particles.js: where every particle of a `particles` element is at time t.
//
// A port of rnd() and scene_particles() in firmware/muse.h: the same hash and the same
// formulas, so a frame here shows the particles of the same frame on the box, up to
// rounding. Confetti and snow fall, rain falls fast, bubbles rise, sparkles twinkle in
// place. The drawing itself is in draw.js; this module runs in Node for the tests.

export const PALETTE = [
  [255, 59, 48], [255, 149, 0], [255, 204, 0], [52, 199, 89], [48, 176, 199], [0, 122, 255], [175, 82, 222], [255, 45, 85],
];
export const FALLBACK = {
  confetti: [255, 59, 48], snow: [255, 255, 255], rain: [120, 170, 255], sparkle: [255, 214, 10], bubbles: [200, 230, 255],
};

// 0 .. 1, the same for the same a and b: the firmware's hash (32-bit arithmetic).
export function rnd(a, b) {
  let h = (Math.imul(a >>> 0, 2654435761) ^ ((Math.imul(b >>> 0, 2246822519) + 0x9E3779B9) >>> 0)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 3266489917) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h & 0xFFFFFF) / 16777216;
}

// The particles of element `p` (its index in the scene is `index`) t ms after the start,
// moved by dx, dy: an array of {x, y, size, color, r4}. `size` is 1 except for sparkles,
// whose size and alpha follow their twinkle; sparkles below 0.05 are left out.
export function particles(p, index, t, dx = 0, dy = 0) {
  const ax = p.x + dx, ay = p.y + dy, aw = p.w, ah = p.h;
  const secs = (t / 1000) * p.speed;
  const out = [];
  for (let i = 0; i < p.count; i++) {
    const seed = (index * 977 + i) >>> 0;
    const r1 = rnd(seed, 1), r2 = rnd(seed, 2), r3 = rnd(seed, 3), r4 = rnd(seed, 4);
    const color = p.hasColor ? p.color : p.sub === "confetti" ? PALETTE[i % 8] : FALLBACK[p.sub];
    let x, y;
    let size = 1;
    if (p.sub === "sparkle") {
      x = ax + r1 * aw;
      y = ay + r2 * ah;
      const tw = Math.sin(secs * 2.6 + r3 * 2 * Math.PI);
      size = tw > 0 ? tw * tw : 0;
      if (size < 0.05) continue;
    } else {
      const range = ah + 24;
      const v = p.sub === "rain" ? 140 + r2 * 80 : p.sub === "snow" ? 12 + r2 * 18 : p.sub === "bubbles" ? 15 + r2 * 20 : 30 + r2 * 40;
      const travel = (r3 * range + v * secs) % range;
      y = p.sub === "bubbles" ? ay + ah + 12 - travel : ay - 12 + travel;
      const sway = p.sub === "rain" ? -0.25 * travel : 7 * Math.sin(secs * 1.3 + r4 * 2 * Math.PI);
      x = ax + r1 * aw + sway;
    }
    out.push({ i, x, y, size, color, r4, secs });
  }
  return out;
}
