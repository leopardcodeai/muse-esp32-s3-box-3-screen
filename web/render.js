// render.js: the canvas as the box's display. Everything draws in the box's logical
// pixels (320 x 240) and the canvas scales them up; text is placed the way ESPHome's
// print() places it (TOP_LEFT at the ascender line, CENTER on the line box of ascent
// plus descent, BASELINE_LEFT on the baseline), with Inter in the weights of the box's
// font table and Material Design Icons for the icons.
//
// Pitfalls:
//  * Fonts must be loaded before the first picture (app.js waits for document.fonts),
//    or the browser measures a fallback font and every text lands elsewhere.
//  * Coordinates are rounded where the box rounds (print at integer pixels), so a
//    scene preview and this display agree to the pixel at scale 1.
export const W = 320;
export const H = 240;
export const PAGE = [243, 243, 243];
export const INK = [28, 28, 30];
export const SUB = [99, 99, 104];
export const CARD = [255, 255, 255];
export const TXT = [44, 44, 46];
export const SHADOW = [226, 226, 231];
export const WHITE = [255, 255, 255];
export const ORANGE = [255, 149, 0];

// The Inter weights behind the six scene text sizes (xs s m l xl xxl), as muse-esp32boxs3-screen.yaml lists them.
export const TEXT_WEIGHT = [500, 500, 700, 600, 700, 700];
export const TEXT_PX = [13, 16, 20, 24, 36, 54];
export const ICON_PX = [24, 46];
// The fonts of the cards: [weight, px], the ids of muse-esp32boxs3-screen.yaml.
export const CARD_FONTS = {
  brand: [800, 19], clock: [600, 17], status: [600, 16], title: [700, 20], body: [500, 16], small: [500, 13],
  label: [600, 17], value: [700, 54], unit: [600, 24], head: [700, 36],
};
export const INTER = '"Inter", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
export const MDI = '"Material Design Icons"';

export function textFont(size) {
  return `${TEXT_WEIGHT[size]} ${TEXT_PX[size]}px ${INTER}`;
}
export function cardFont(name) {
  const [w, px] = CARD_FONTS[name];
  return `${w} ${px}px ${INTER}`;
}
export function iconFont(px) {
  return `${px}px ${MDI}`;
}
export function css(c, a = 1) {
  return a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

// Every font this display uses, for document.fonts.load().
export function allFonts() {
  const out = new Set();
  for (let i = 0; i < 6; i++) out.add(textFont(i));
  for (const n of Object.keys(CARD_FONTS)) out.add(cardFont(n));
  for (const px of [18, ...ICON_PX]) out.add(iconFont(px));
  return [...out];
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.k = 1;
    this.metricsCache = new Map();
  }

  // k device pixels per logical pixel.
  resize(k) {
    const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.k = k;
  }

  begin() {
    this.ctx.setTransform(this.k, 0, 0, this.k, 0, 0);
    this.ctx.textBaseline = "alphabetic";
    this.ctx.textAlign = "left";
    this.ctx.lineCap = "butt";
    this.ctx.lineJoin = "miter";
  }

  // Ascent and descent of a font in logical px: the line box ESPHome's font generator
  // uses (ascent + descent is the height a CENTER alignment halves).
  metrics(font) {
    let m = this.metricsCache.get(font);
    if (m) return m;
    const ctx = this.ctx;
    ctx.font = font;
    const px = parseFloat(font.match(/(\d+(?:\.\d+)?)px/)[1]);
    const t = ctx.measureText("Hg");
    const ascent = t.fontBoundingBoxAscent > 0 ? t.fontBoundingBoxAscent : px * 0.96875;
    const descent = t.fontBoundingBoxDescent > 0 ? t.fontBoundingBoxDescent : px * 0.2412;
    m = { ascent, descent, height: ascent + descent };
    this.metricsCache.set(font, m);
    return m;
  }

  width(text, font) {
    this.ctx.font = font;
    return this.ctx.measureText(text).width;
  }

  widthOf(font) {
    return (s) => this.width(s, font);
  }

  // Text like it.print(x, y, font, color, align, text): align is one of TL, TC, TR
  // (top), CL, C, CR (vertical centre), BL (baseline left), BC (baseline centre).
  print(x, y, font, color, align, text, alpha = 1) {
    if (!text) return;
    const ctx = this.ctx;
    ctx.font = font;
    const m = this.metrics(font);
    const w = ctx.measureText(text).width;
    let left = x;
    if (align === "TC" || align === "C" || align === "BC") left = x - w / 2;
    else if (align === "TR" || align === "CR") left = x - w;
    let baseline;
    if (align === "BL" || align === "BC") baseline = y;
    else if (align === "C" || align === "CL" || align === "CR") baseline = Math.round(y - m.height / 2) + m.ascent;
    else baseline = y + m.ascent;
    ctx.fillStyle = css(color, alpha);
    ctx.fillText(text, Math.round(left), baseline);
  }

  fill(color) {
    const ctx = this.ctx;
    ctx.fillStyle = css(color);
    ctx.fillRect(0, 0, W, H);
  }

  rect(x, y, w, h, color) {
    this.ctx.fillStyle = css(color);
    this.ctx.fillRect(x, y, w, h);
  }

  roundRectPath(x, y, w, h, r) {
    const ctx = this.ctx;
    if (r < 0 || 2 * r > Math.min(w, h)) r = Math.min(w, h) / 2;
    ctx.beginPath();
    if (r <= 0) {
      ctx.rect(x, y, w, h);
      return;
    }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // A rectangle with round corners; r = h / 2 gives a pill.
  roundRect(x, y, w, h, r, color) {
    if (w <= 0 || h <= 0) return;
    this.roundRectPath(x, y, w, h, r);
    this.ctx.fillStyle = css(color);
    this.ctx.fill();
  }

  // The outline of a rounded rectangle, `stroke` px wide, drawn inside its bounds.
  roundRectOutline(x, y, w, h, r, stroke, color) {
    if (w <= 0 || h <= 0) return;
    const ctx = this.ctx;
    if (r < 0 || 2 * r > Math.min(w, h)) r = Math.min(w, h) / 2;
    const n = Math.min(stroke, Math.floor(Math.min(w, h) / 2));
    const iw = w - 2 * n, ih = h - 2 * n;
    ctx.fillStyle = css(color);
    if (iw > 0 && ih > 0) {
      // Outer minus inner, through the even-odd rule.
      const p = new Path2D(this.pathToString(x, y, w, h, r));
      p.addPath(new Path2D(this.pathToString(x + n, y + n, iw, ih, Math.max(0, r - n))));
      ctx.fill(p, "evenodd");
    } else {
      this.roundRectPath(x, y, w, h, r);
      ctx.fill();
    }
  }

  pathToString(x, y, w, h, r) {
    if (r <= 0) return `M${x} ${y}h${w}v${h}h${-w}Z`;
    return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}`
      + `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
  }

  circle(cx, cy, r, color) {
    if (r <= 0) return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.fillStyle = css(color);
    ctx.fill();
  }

  // A ring of `stroke` px inside radius r.
  ring(cx, cy, r, stroke, color) {
    if (r <= 0) return;
    const ctx = this.ctx;
    const ri = Math.max(0, r - stroke);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.arc(cx, cy, ri, 0, 2 * Math.PI, true);
    ctx.fillStyle = css(color);
    ctx.fill("evenodd");
  }

  // A line w px wide with round ends; w <= 1 is a plain one-pixel line, like on the box.
  line(x1, y1, x2, y2, w, color) {
    const ctx = this.ctx;
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (w <= 1 || len < 0.01) {
      if (len < 0.01) {
        this.circle(x1, y1, Math.max(0.5, w / 2), color);
        return;
      }
      ctx.beginPath();
      ctx.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
      ctx.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
      ctx.lineWidth = 1;
      ctx.lineCap = "butt";
      ctx.strokeStyle = css(color);
      ctx.stroke();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineWidth = w;
    ctx.lineCap = "round";
    ctx.strokeStyle = css(color);
    ctx.stroke();
    ctx.lineCap = "butt";
  }

  // A closed shape through `pts` ([x, y] pairs): filled, or `stroke` px lines with round joints.
  polygon(pts, stroke, color) {
    const ctx = this.ctx;
    if (pts.length < 2) return;
    if (stroke > 0) {
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        this.line(a[0], a[1], b[0], b[1], stroke, color);
      }
      return;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = css(color);
    ctx.fill();
  }

  // A ring from `from` to `to` degrees (clockwise, 0 at the top) between two radii.
  ringArc(cx, cy, rOut, rIn, from, to, color) {
    if (to <= from) return;
    const ctx = this.ctx;
    const r = (rOut + rIn) / 2;
    const a0 = ((from - 90) * Math.PI) / 180, a1 = ((Math.min(to, 360) - 90) * Math.PI) / 180;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a1);
    ctx.lineWidth = rOut - rIn;
    ctx.lineCap = "butt";
    ctx.strokeStyle = css(color);
    ctx.stroke();
  }

  // Small dots that show which page of a long text is up.
  pageDots(right, y, pages, current, on, off) {
    if (pages <= 1) return;
    if (pages > 8) pages = 8;
    const x = right - (pages - 1) * 10;
    for (let p = 0; p < pages; p++) this.circle(x + p * 10, y, 2.6, p === current ? on : off);
  }

  // Clips the following drawing to a disc; call restore() afterwards.
  clipDisc(cx, cy, r) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.clip();
  }

  restore() {
    this.ctx.restore();
  }

  // An image (a weather icon) with the soft shadow the box's icons carry.
  image(img, x, y, w, h, shadow = false) {
    const ctx = this.ctx;
    if (!img) return;
    if (shadow) {
      ctx.save();
      ctx.shadowColor = "rgba(60,60,70,0.3)";
      ctx.shadowBlur = w * 0.07 * this.k;
      ctx.shadowOffsetY = Math.max(1, Math.round(w * 0.03)) * this.k;
    }
    ctx.drawImage(img, x, y, w, h);
    if (shadow) ctx.restore();
  }
}
