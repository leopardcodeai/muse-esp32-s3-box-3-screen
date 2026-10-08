// apng.js: a small decoder for animated PNGs, so the figure can play the owner's own
// frames the way the box plays them.
//
// Why not an <img>: an <img> plays an APNG by itself, in the file's order, at the file's
// delays (167 ms, the 6 fps of the source video) and on the browser's clock from the
// moment it decoded the file. The box plays the same frames forwards and backwards
// (ping-pong), steps at its own pace (160 ms in a scene, 200 ms on the ready screen) and
// starts confetti with the card; a scene is drawn from its own time `t`. None of that
// can be told to an <img>, and drawing one into the canvas shows whatever frame the
// browser is at. WebCodecs' ImageDecoder would give frame control, but it is not
// Baseline (Safari lacks it), so this parses the file itself: every frame becomes a
// small standalone PNG that the browser decodes, composited on a canvas with the
// frame's offset, blend and dispose rules, and kept as an ImageBitmap.
//
// Pitfalls:
//  * Pillow (tools/make_muse_assets.py dithers every frame through it) writes only the
//    changed rectangle of each frame after the first, so frames must be composited in
//    order; drawing a frame's own PNG alone shows a cut-out.
//  * Browsers check the CRC of critical chunks, so the rebuilt chunks carry real CRCs.
//  * An IDAT that comes before the first fcTL is the default image and not part of the
//    animation (APNG spec); a plain PNG has no acTL and is one frame.
//  * parseApng() runs in Node for the tests; decodeApng() needs a browser.
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

let CRC_TABLE = null;
export function crc32(bytes, start = 0, end = bytes.length) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u16 = (b, i) => (b[i] << 8) | b[i + 1];

// One chunk as bytes: length, type, data, CRC over type and data.
export function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const n = data.length;
  out[0] = n >>> 24; out[1] = (n >>> 16) & 255; out[2] = (n >>> 8) & 255; out[3] = n & 255;
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const c = crc32(out, 4, 8 + n);
  out[8 + n] = c >>> 24; out[9 + n] = (c >>> 16) & 255; out[10 + n] = (c >>> 8) & 255; out[11 + n] = c & 255;
  return out;
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// The structure of a PNG or APNG: {width, height, plays, frames}, every frame
// {x, y, width, height, delayMs, dispose, blend, png} where `png` is a standalone PNG of
// that frame's rectangle. dispose: 0 none, 1 background, 2 previous; blend: 0 source,
// 1 over. Throws on a file that is no PNG.
export function parseApng(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (b.length < 8 || SIGNATURE.some((v, i) => b[i] !== v)) throw new Error("not a PNG");
  let ihdr = null;
  let animated = false;
  let plays = 0;
  const shared = []; // chunks before the first IDAT that every frame needs (PLTE, tRNS, gAMA, ...)
  const frames = [];
  let current = null; // the frame whose data is being collected
  let seenData = false;
  for (let i = 8; i + 12 <= b.length;) {
    const len = u32(b, i);
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const data = b.subarray(i + 8, i + 8 + len);
    i += 12 + len;
    if (type === "IHDR") ihdr = data;
    else if (type === "acTL") {
      animated = true;
      plays = u32(data, 4);
    } else if (type === "fcTL") {
      const den = u16(data, 22) || 100;
      current = {
        width: u32(data, 4), height: u32(data, 8), x: u32(data, 12), y: u32(data, 16),
        delayMs: (u16(data, 20) / den) * 1000, dispose: data[24], blend: data[25], parts: [],
      };
      frames.push(current);
    } else if (type === "IDAT") {
      seenData = true;
      if (!animated) {
        if (!current) {
          current = { width: u32(ihdr, 0), height: u32(ihdr, 4), x: 0, y: 0, delayMs: 0, dispose: 0, blend: 0, parts: [] };
          frames.push(current);
        }
        current.parts.push(data);
      } else if (current) current.parts.push(data); // else: the default image, not a frame
    } else if (type === "fdAT") {
      if (current) current.parts.push(data.subarray(4));
    } else if (type === "IEND") break;
    else if (!seenData && type !== "acTL") shared.push(chunk(type, data));
  }
  if (!ihdr) throw new Error("PNG without IHDR");
  const width = u32(ihdr, 0), height = u32(ihdr, 4);
  const out = frames.filter((f) => f.parts.length > 0).map((f) => {
    const h = new Uint8Array(13); // the file's IHDR with the frame's size
    h.set(ihdr);
    h[0] = f.width >>> 24; h[1] = (f.width >>> 16) & 255; h[2] = (f.width >>> 8) & 255; h[3] = f.width & 255;
    h[4] = f.height >>> 24; h[5] = (f.height >>> 16) & 255; h[6] = (f.height >>> 8) & 255; h[7] = f.height & 255;
    const png = concat([new Uint8Array(SIGNATURE), chunk("IHDR", h), ...shared, chunk("IDAT", concat(f.parts)),
      chunk("IEND", new Uint8Array(0))]);
    return { x: f.x, y: f.y, width: f.width, height: f.height, delayMs: f.delayMs, dispose: f.dispose, blend: f.blend, png };
  });
  if (out.length === 0) throw new Error("PNG without image data");
  return { width, height, plays, frames: out };
}

// Decodes a PNG or APNG into full frames: an array of ImageBitmaps of width x height,
// composited as the APNG spec says. Browser only (createImageBitmap, a canvas).
export async function decodeApng(bytes, { createBitmap = (blob) => createImageBitmap(blob), makeCanvas } = {}) {
  const info = parseApng(bytes);
  const { width, height } = info;
  const bitmaps = await Promise.all(info.frames.map((f) => createBitmap(new Blob([f.png], { type: "image/png" }))));
  if (bitmaps.length === 1 && info.frames[0].width === width && info.frames[0].height === height) return bitmaps;
  const canvas = makeCanvas ? makeCanvas(width, height)
    : typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement("canvas"), { width, height });
  const ctx = canvas.getContext("2d");
  const out = [];
  for (let k = 0; k < info.frames.length; k++) {
    const f = info.frames[k];
    // The first frame's "previous" is a cleared canvas (APNG spec).
    const dispose = k === 0 && f.dispose === 2 ? 1 : f.dispose;
    const saved = dispose === 2 ? ctx.getImageData(f.x, f.y, f.width, f.height) : null;
    if (f.blend === 0) ctx.clearRect(f.x, f.y, f.width, f.height);
    ctx.drawImage(bitmaps[k], f.x, f.y);
    out.push(await createImageBitmap(canvas));
    if (dispose === 1) ctx.clearRect(f.x, f.y, f.width, f.height);
    else if (dispose === 2) ctx.putImageData(saved, f.x, f.y);
    bitmaps[k].close?.();
  }
  return out;
}
