// draw.js: draws a parsed scene on the canvas the way draw_scene in firmware/muse.h
// draws it on the box, ten times a second.
//
// The compositing model is the box's, not an image editor's: a translucent element is
// painted in its colour mixed with what scene.under() finds below it, and under() knows
// only the background, filled rectangles and circles, and bars. So a half-transparent
// rectangle shows the background through but hides a star, a text or the figure drawn
// before it; the figure ignores opacity and fade (it appears in full); a button's label
// is always printed in full. Particles mix their colour with under() at their own spot.
//
// Pitfalls:
//  * Text lines are wrapped once per scene and kept (`cache`); a text with {time} is
//    wrapped again when the clock changes, as on the box.
//  * Coordinates are rounded where the box rounds, so the preview PNGs of docs/previews
//    and this display agree to the pixel at scale 1 (anti-aliasing aside).
import * as S from "./scene.js";
import { particles } from "./particles.js";
import { sceneLines, fillPlaceholders, drawable, fitLine, canDraw } from "./text.js";
import { textFont, iconFont, css, W, H, INK, WHITE, TEXT_PX, ICON_PX } from "./render.js";

const PAGE = S.PAGE;

// The corners of a star (2 * points) or of a regular polygon around (cx, cy), the
// first one straight up.
export function outlinePoints(cx, cy, r, points, inner, degrees, star) {
  const n = star ? points * 2 : points;
  const start = ((degrees - 90) * Math.PI) / 180;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = start + (2 * Math.PI * i) / n;
    const rr = star && i % 2 === 1 ? r * inner : r;
    out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return out;
}

// Fills the current clip path row by row in the colour `colorAt(yc)` gives for the row's
// centre, merging rows of one colour into one rectangle.
function fillRows(r, y0, y1, x0, x1, colorAt) {
  const ctx = r.ctx;
  const overlap = 0.75 / r.k; // runs overlap a little, or fractional scales show seams
  let runStart = y0;
  let runColor = null;
  for (let yy = y0; yy <= y1; yy++) {
    const c = yy < y1 ? colorAt(yy + 0.5) : null;
    const key = c ? c.join(",") : null;
    if (runColor !== null && key !== runColor.key) {
      ctx.fillStyle = css(runColor.c);
      ctx.fillRect(x0, runStart, x1 - x0, yy - runStart + (yy < y1 ? overlap : 0));
      runColor = null;
    }
    if (c && runColor === null) {
      runStart = yy;
      runColor = { key, c };
    }
  }
}

export class SceneDrawer {
  constructor(figure) {
    this.figure = figure;
    this.cache = { version: -1, prepared: [] };
  }

  prepare(r, item, text) {
    const font = textFont(item.size);
    const lines = sceneLines(item, text, r.widthOf(font));
    return { filled: text, lines, widths: lines.map((l) => r.width(l, font)) };
  }

  // The scene `t` ms after it started. `version` changes with every new scene.
  draw(r, s, version, t, clock) {
    const ctx = r.ctx;
    r.begin();
    if (this.cache.version !== version) {
      this.cache = { version, prepared: s.items.map(() => null) };
      s.items.forEach((it, k) => {
        if (it.kind === "text") this.cache.prepared[k] = this.prepare(r, it, fillPlaceholders(it.text, clock));
      });
    }
    const frame = s.frameAt(t);
    const first = s.items[0];
    const covered = first && first.kind === "bg" && S.visible(first, t, frame) && S.alpha(first, t) >= 1;
    if (!covered) r.fill(PAGE);
    for (let k = 0; k < s.items.length; k++) {
      const item = s.items[k];
      if (!S.visible(item, t, frame)) continue;
      const a = S.alpha(item, t);
      if (a <= 0) continue;
      const [dx, dy] = S.offset(item, t);
      const under = (px, py) => S.under(s, k, px, py, t, frame);
      const c = item.color;
      const x = item.x + dx, y = item.y + dy;
      const mixed = (px, py) => (a >= 1 ? c : S.mix(c, under(px, py), a));
      switch (item.kind) {
        case "bg": {
          if (!item.gradient && a >= 1) {
            r.fill(c);
            break;
          }
          if (a >= 1) {
            // The gradient the box computes row by row (bgAt at the row's centre), as one
            // linear gradient between the same end points: no seams at any scale.
            const g = item.horizontal ? ctx.createLinearGradient(0.5, 0, W - 0.5, 0) : ctx.createLinearGradient(0, 0.5, 0, H - 0.5);
            g.addColorStop(0, css(item.color2));
            g.addColorStop(1, css(item.color));
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, W, H);
            break;
          }
          const n = item.horizontal ? W : H;
          const overlap = 0.75 / r.k; // rows overlap a little, or fractional scales show seams
          for (let i = 0; i < n; i++) {
            let row = S.bgAt(item, item.horizontal ? i + 0.5 : 0, item.horizontal ? 0 : i + 0.5);
            row = S.mix(row, item.horizontal ? under(i + 0.5, H / 2) : under(W / 2, i + 0.5), a);
            ctx.fillStyle = css(row);
            if (item.horizontal) ctx.fillRect(i, 0, 1 + overlap, H);
            else ctx.fillRect(0, i, W, 1 + overlap);
          }
          break;
        }
        case "rect": {
          const bx = Math.round(x), by = Math.round(y), bw = Math.round(item.w), bh = Math.round(item.h);
          this.rect(r, bx, by, bw, bh, item.radius, item.stroke, c, a, under);
          break;
        }
        case "circle": {
          const rr = item.r * S.scale(item, t);
          const ring = item.stroke > 0 && item.stroke < rr;
          if (a >= 1) {
            if (ring) r.ring(x, y, rr, item.stroke, c);
            else r.circle(x, y, rr, c);
            break;
          }
          ctx.save();
          ctx.beginPath();
          ctx.arc(x, y, rr, 0, 2 * Math.PI);
          if (ring) ctx.arc(x, y, rr - item.stroke, 0, 2 * Math.PI, true);
          ctx.clip(ring ? "evenodd" : "nonzero");
          fillRows(r, Math.floor(y - rr - 1), Math.ceil(y + rr + 1), Math.floor(x - rr - 1), Math.ceil(x + rr + 1),
            (yc) => S.mix(c, under(x, yc), a));
          ctx.restore();
          break;
        }
        case "line": {
          const x2 = item.x2 + dx, y2 = item.y2 + dy;
          r.line(x, y, x2, y2, item.stroke, mixed((x + x2) / 2, (y + y2) / 2));
          break;
        }
        case "tri": {
          const x2 = item.x2 + dx, y2 = item.y2 + dy, x3 = item.x3 + dx, y3 = item.y3 + dy;
          r.polygon([[x, y], [x2, y2], [x3, y3]], item.stroke, mixed((x + x2 + x3) / 3, (y + y2 + y3) / 3));
          break;
        }
        case "star":
        case "poly": {
          const pts = outlinePoints(x, y, item.r * S.scale(item, t), item.points, item.inner, S.angle(item, t),
            item.kind === "star");
          r.polygon(pts, item.stroke, mixed(x, y));
          break;
        }
        case "text": {
          let p = this.cache.prepared[k];
          if (item.text.includes("{")) {
            const filled = fillPlaceholders(item.text, clock);
            if (!p || filled !== p.filled) p = this.cache.prepared[k] = this.prepare(r, item, filled);
          }
          if (!p) p = this.cache.prepared[k] = this.prepare(r, item, item.text);
          const font = textFont(item.size);
          const lh = item.lineH > 0 ? item.lineH : Math.round(TEXT_PX[item.size] * 1.3);
          const block = p.lines.length * lh;
          const top = item.valign === 1 ? y - block / 2 : item.valign === 2 ? y - block : y;
          const align = item.align === 1 ? "TC" : item.align === 2 ? "TR" : "TL";
          let budget = S.typed(item, t);
          for (let i = 0; i < p.lines.length && budget > 0; i++) {
            let line = p.lines[i];
            if (budget !== Infinity) {
              const chars = [...line];
              if (chars.length > budget) line = chars.slice(0, budget).join("");
              budget = chars.length >= budget ? 0 : budget - chars.length;
            }
            if (!line) continue;
            const ly = top + i * lh;
            const mid = item.align === 1 ? x : item.align === 2 ? x - p.widths[i] / 2 : x + p.widths[i] / 2;
            r.print(Math.round(x), Math.round(ly), font, mixed(mid, ly + lh / 2), align, line);
          }
          break;
        }
        case "icon":
          r.print(Math.round(x), Math.round(y), iconFont(ICON_PX[item.size]), mixed(x, y), "C",
            String.fromCodePoint(item.glyph));
          break;
        case "muse": {
          // The figure in a round frame: outside the disc the scene below shows through.
          const size = item.sub === "avatar" ? 72 : 160;
          const rr = Math.min(item.r, size / 2);
          r.clipDisc(x, y, rr);
          this.figure.draw(r, item.sub, t, Math.round(x - size / 2), Math.round(y - size / 2));
          r.restore();
          break;
        }
        case "bar": {
          const bx = Math.round(x), by = Math.round(y), bw = Math.round(item.w), bh = Math.round(item.h);
          const rad = item.radius < 0 || item.radius * 2 > bh ? Math.floor(bh / 2) : item.radius;
          this.rect(r, bx, by, bw, bh, rad, 0, item.color2, a, under);
          const fw = Math.round((bw * item.value) / 100);
          if (fw > 0) this.rect(r, bx, by, Math.max(fw, Math.min(2 * rad, bw)), bh, rad, 0, c, a, under);
          break;
        }
        case "particles":
          this.particles(r, item, k, t, dx, dy, a, under);
          break;
        case "button": {
          // A pill with its text centred; a touch on it answers with the text (buttonAt).
          const bx = Math.round(x), by = Math.round(y), bw = Math.round(item.w), bh = Math.round(item.h);
          this.rect(r, bx, by, bw, bh, item.radius, 0, c, a, under);
          const font = textFont(item.size);
          const ell = canDraw(item.size, "…") ? "…" : "...";
          const label = fitLine(drawable(item.text, item.size), bw - 16, r.widthOf(font), ell);
          const dark = Math.floor((c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000) < 150;
          r.print(Math.floor(bx + bw / 2), Math.floor(by + bh / 2), font, dark ? WHITE : INK, "C", label);
          break;
        }
        default:
          break;
      }
    }
  }

  // A rectangle with round corners, filled or as an outline of `stroke` px; translucent
  // rows blend against under() at the row's middle, as scene_rect does on the box.
  rect(r, x, y, w, h, radius, stroke, c, a, under) {
    if (w <= 0 || h <= 0) return;
    if (a >= 1) {
      if (stroke > 0) r.roundRectOutline(x, y, w, h, radius, stroke, c);
      else r.roundRect(x, y, w, h, radius, c);
      return;
    }
    const ctx = r.ctx;
    ctx.save();
    let rr = radius;
    if (rr < 0 || 2 * rr > Math.min(w, h)) rr = Math.min(w, h) / 2;
    if (stroke > 0) {
      const n = Math.min(stroke, Math.floor(Math.min(w, h) / 2));
      const p = new Path2D(r.pathToString(x, y, w, h, rr));
      if (w - 2 * n > 0 && h - 2 * n > 0) p.addPath(new Path2D(r.pathToString(x + n, y + n, w - 2 * n, h - 2 * n, Math.max(0, rr - n))));
      ctx.clip(p, "evenodd");
    } else {
      r.roundRectPath(x, y, w, h, rr);
      ctx.clip();
    }
    fillRows(r, y, y + h, x, x + w, (yc) => S.mix(c, under(x + w * 0.5, yc), a));
    ctx.restore();
  }

  // Confetti and snow fall, rain falls fast, bubbles rise, sparkles twinkle in place
  // (scene_particles on the box). Every particle's colour is mixed with what lies below it.
  particles(r, p, index, t, dx, dy, a, under) {
    const ctx = r.ctx;
    const glyph = p.glyph ? String.fromCodePoint(p.glyph) : "";
    for (const q of particles(p, index, t, dx, dy)) {
      const vis = a * q.size;
      const below = under(q.x, q.y);
      const c = vis >= 1 ? q.color : S.mix(q.color, below, vis);
      if (glyph) {
        r.print(Math.trunc(q.x), Math.trunc(q.y), iconFont(ICON_PX[p.size]), c, "C", glyph);
        continue;
      }
      switch (p.sub) {
        case "confetti": {
          const w = 2 + Math.trunc(4 * Math.abs(Math.sin(q.secs * 4 + q.r4 * 2 * Math.PI)));
          ctx.fillStyle = css(c);
          ctx.fillRect(Math.trunc(q.x), Math.trunc(q.y), w, 6);
          break;
        }
        case "snow":
          r.circle(q.x, q.y, 1.2 + q.r4 * 2, c);
          break;
        case "rain":
          r.line(q.x, q.y, q.x - 2, q.y + 9, 1, c);
          break;
        case "sparkle": {
          const arm = 2 + 5 * q.size;
          r.line(q.x - arm, q.y, q.x + arm, q.y, 1, c);
          r.line(q.x, q.y - arm, q.x, q.y + arm, 1, c);
          r.circle(q.x, q.y, 1.3, c);
          break;
        }
        default: // bubbles
          r.ring(q.x, q.y, 3 + q.r4 * 5, 1, c);
          break;
      }
    }
  }
}
