// apng.test.js: the APNG parser on the repository's own figure (animated PNGs
// written by Pillow with changed rectangles only) and on a plain PNG. Every rebuilt
// frame must be a valid PNG: signature, IHDR with the frame's size, correct CRCs, and
// image data that inflates to exactly the frame's scanlines.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
import { parseApng, crc32, chunk } from "../apng.js";

const figure = (name) => readFileSync(new URL(`../../firmware/figure/${name}.png`, import.meta.url));

function chunks(png) {
  const out = [];
  for (let i = 8; i < png.length;) {
    const len = png.readUInt32BE(i);
    const type = png.toString("latin1", i + 4, i + 8);
    const data = png.subarray(i + 8, i + 8 + len);
    out.push({ type, data, crcOk: png.readUInt32BE(i + 8 + len) === crc32(png, i + 4, i + 8 + len) });
    i += 12 + len;
  }
  return out;
}

function checkFrame(f, channels) {
  const png = Buffer.from(f.png);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const cs = chunks(png);
  assert.ok(cs.every((c) => c.crcOk), "every CRC is right");
  assert.equal(cs[0].type, "IHDR");
  assert.equal(cs[0].data.readUInt32BE(0), f.width);
  assert.equal(cs[0].data.readUInt32BE(4), f.height);
  assert.equal(cs[cs.length - 1].type, "IEND");
  const raw = inflateSync(Buffer.concat(cs.filter((c) => c.type === "IDAT").map((c) => c.data)));
  assert.equal(raw.length, f.height * (1 + f.width * channels), "the scanlines of the frame");
}

test("crc32() of the IEND chunk", () => {
  assert.equal(crc32(new TextEncoder().encode("IEND")), 0xAE426082);
  assert.deepEqual([...chunk("IEND", new Uint8Array(0))], [0, 0, 0, 0, 73, 69, 78, 68, 0xAE, 0x42, 0x60, 0x82]);
});

test("the project's animations: 16 frames, confetti 18, the first full, the rest rectangles", () => {
  for (const [name, n] of [["idle", 16], ["wave", 16], ["working", 16], ["making", 16], ["confetti", 18]]) {
    const a = parseApng(figure(name));
    assert.equal(a.width, 160, name);
    assert.equal(a.height, 160, name);
    assert.equal(a.frames.length, n, name);
    assert.deepEqual([a.frames[0].x, a.frames[0].y, a.frames[0].width, a.frames[0].height], [0, 0, 160, 160]);
    for (const f of a.frames) {
      assert.ok(f.x + f.width <= 160 && f.y + f.height <= 160, `${name}: inside the canvas`);
      assert.ok(f.delayMs > 150 && f.delayMs < 180, `${name}: about 6 frames a second in the file`);
      checkFrame(f, 3);
    }
  }
});

test("a plain PNG (the avatar) is one frame, the file itself", () => {
  const a = parseApng(figure("avatar"));
  assert.equal(a.frames.length, 1);
  assert.equal(a.width, 72);
  checkFrame(a.frames[0], 3);
});

test("a hand-made APNG with a default image that is not a frame, PLTE carried into every frame", () => {
  const u32 = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const ihdr = new Uint8Array([...u32(4), ...u32(2), 8, 3, 0, 0, 0]); // 4 x 2, palette
  const plte = new Uint8Array([0, 0, 0, 255, 255, 255]);
  const scan = (w, h, v) => deflateSync(Buffer.from(Array.from({ length: h }, () => [0, ...Array(w).fill(v)]).flat()));
  const fctl = (seq, w, h, x, y) => new Uint8Array([...u32(seq), ...u32(w), ...u32(h), ...u32(x), ...u32(y), 0, 1, 0, 10, 0, 1]);
  const fdat = (seq, data) => new Uint8Array([...u32(seq), ...data]);
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("acTL", new Uint8Array([...u32(2), ...u32(0)])), chunk("PLTE", plte),
    chunk("IDAT", scan(4, 2, 0)), // the default image: no fcTL before it
    chunk("fcTL", fctl(0, 4, 2, 0, 0)), chunk("fdAT", fdat(1, scan(4, 2, 1))),
    chunk("fcTL", fctl(2, 2, 1, 1, 1)), chunk("fdAT", fdat(3, scan(2, 1, 0))),
    chunk("IEND", new Uint8Array(0)),
  ]);
  const a = parseApng(png);
  assert.equal(a.frames.length, 2, "the default image is left out");
  assert.deepEqual(a.frames.map((f) => [f.x, f.y, f.width, f.height, f.delayMs, f.blend]), [[0, 0, 4, 2, 100, 1], [1, 1, 2, 1, 100, 1]]);
  for (const f of a.frames) {
    checkFrame(f, 1);
    assert.ok(chunks(Buffer.from(f.png)).some((c) => c.type === "PLTE"), "the palette comes along");
  }
  assert.throws(() => parseApng(new Uint8Array([1, 2, 3])), /not a PNG/);
});
