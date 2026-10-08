// cards.js: the cards the box shows, drawn as its display lambda draws them
// (firmware/muse-esp32boxs3-screen.yaml, display:): the top bar, the status with the figure and the
// pill, text, value, celebration, weather, photo, event, route, agenda, question, timer,
// info and list. Same positions, fonts and colours; the texts stay German like the box's.
//
// Every function takes the renderer `r` and the display `d` (display.js), which holds
// the card on screen, its timing, the queue, the timers and the question.
import { wrap, fitLine, pageText, timeLeft, clockText, DAYS_SHORT, LARGE_COUNT, WEATHER } from "./text.js";
import { PILLS, event as eventIcon } from "./tables.js";
import { questionButton } from "./queue.js";
import { particles } from "./particles.js";
import { cardFont, iconFont, PAGE, INK, SUB, CARD, TXT, SHADOW, WHITE, ORANGE } from "./render.js";
import { Item, mix } from "./scene.js";
import { PHOTO_W, PHOTO_H, PHOTO_TOP } from "./media.js";
import { CARD_STEP_MS } from "./figure.js";

const BG = PAGE;
const RED = [255, 59, 48];
const MORE = " …";

// Wraps the body text again when the card changed; a long text keeps its card longer.
function layout(r, d, text, font, width, per) {
  const p = d.paged;
  if (p && p.version === d.version && p.perPage === per) return p.layout;
  const lay = pageText(text, r.widthOf(font), width, per);
  d.paged = { version: d.version, perPage: per, layout: lay };
  const until = d.since + lay.cycle + 10000;
  if (lay.pages > 1 && until > d.until) d.until = until;
  return lay;
}

// The top bar as on an iPhone: the name on the left with the soonest timer and the
// orange "+N" of waiting cards, the time in the middle, a dot for the connection on
// the right (the box shows battery, Wi-Fi and the microphone there).
export function drawTopBar(r, d, now, clock) {
  r.print(14, 7, cardFont("brand"), INK, "TL", d.name);
  r.print(160, 8, cardFont("clock"), INK, "TC", clockText(clock));
  const dot = d.connection === "on" ? [52, 199, 89] : d.connection === "connecting" ? ORANGE
    : d.connection === "demo" ? [48, 176, 199] : [255, 59, 48];
  r.circle(306 - 3.5, 17, 3.5, dot);
  let badgeX = 68;
  const soonest = d.timers.soonest();
  const mode = d.card.mode;
  if (soonest && mode !== 11) {
    const left = timeLeft(soonest.left);
    const bw = Math.round(r.width(left, cardFont("small"))) + 14;
    r.roundRect(badgeX, 8, bw, 19, 9, ORANGE);
    r.print(Math.floor(badgeX + bw / 2), 17, cardFont("small"), WHITE, "C", left);
    badgeX += bw + 6;
  }
  const waiting = d.queue.waiting.length;
  if (waiting > 0 && mode !== 0) {
    const more = `+${waiting}`;
    const bw = Math.round(r.width(more, cardFont("small"))) + 14;
    r.roundRect(badgeX, 8, bw, 19, 9, ORANGE);
    r.print(Math.floor(badgeX + bw / 2), 17, cardFont("small"), WHITE, "C", more);
  }
}

// The ready screen: the figure for the status, hearts when cuddled, the status pill.
export function drawStatus(r, d, now) {
  const state = d.status;
  const anim = state === 1 || state === 6 ? "wave" : state === 2 ? "working" : state === 3 ? "making" : "idle";
  if (anim !== d.animName) {
    d.animName = anim;
    d.animSince = now;
  }
  const cuddle = d.cuddleUntil - now;
  const wiggle = cuddle > 0 ? Math.round(4 * Math.sin(now / 70)) : 0;
  d.figure.draw(r, anim, now - d.animSince, 80 + wiggle, 30, CARD_STEP_MS);
  if (cuddle > 0) {
    // Cuddled: hearts rise for 2.6 s, drawn like a particles element of a scene.
    const hearts = new Item("particles");
    Object.assign(hearts, { sub: "bubbles", count: 9, glyph: 0xF02D1, hasColor: true, color: [255, 45, 85],
      x: 90, y: 34, w: 140, h: 150, size: 0, speed: 2.2 });
    const fade = cuddle < 600 ? cuddle / 600 : 1;
    for (const q of particles(hearts, 4242, 2600 - cuddle)) {
      r.print(Math.trunc(q.x), Math.trunc(q.y), iconFont(24), fade >= 1 ? q.color : mix(q.color, BG, fade), "C",
        String.fromCodePoint(hearts.glyph));
    }
  }
  const pill = PILLS[state >= 0 && state <= 6 ? state : 0];
  // A label from set_status_text replaces the pill's default text while the status stays.
  if (state !== d.labelState) {
    if (state !== d.statusTextState) d.statusText = "";
    d.labelState = state;
  }
  let label = pill.text;
  if (d.statusText && state === d.statusTextState) {
    label = fitLine(d.statusText, 254, r.widthOf(cardFont("status")), "…");
  }
  const w = Math.round(r.width(label, cardFont("status"))) + 42;
  const px = 160 - Math.floor(w / 2);
  r.roundRect(px, 203, w, 30, 15, SHADOW);
  r.roundRect(px, 201, w, 30, 15, CARD);
  r.circle(px + 18, 216, 4.5, pill.color);
  r.print(px + 30, 216, cardFont("status"), TXT, "CL", label);
}

// A text from the assistant: the figure or a weather icon on the left, the title, the
// text on a white card, paged when long.
export function drawText(r, d, now) {
  const c = d.card;
  const shown = now - d.since;
  if (c.icon >= 0 && c.icon < WEATHER.length) d.weather.draw(r, c.icon, 12, 32, 72);
  else d.figure.draw(r, "avatar", 0, 12, 32);
  let head = wrap(c.title, r.widthOf(cardFont("title")), 206);
  if (head.length > 2) {
    head = head.slice(0, 2);
    head[1] += MORE;
  }
  const top = 68 - head.length * 12;
  head.forEach((line, k) => r.print(96, top + 24 * k, cardFont("title"), INK, "TL", line));
  r.roundRect(10, 110, 300, 124, 16, CARD);
  const lay = layout(r, d, c.body, cardFont("body"), 276, 5);
  const page = lay.pageAt(shown);
  lay.pageLines(page).forEach((line, k) => r.print(24, 118 + 21 * k, cardFont("body"), TXT, "TL", line));
  r.pageDots(296, 226, lay.pages, page, SUB, SHADOW);
}

export function drawValue(r, d) {
  const c = d.card;
  r.print(160, 42, cardFont("label"), SUB, "TC", c.label);
  const wv = Math.round(r.width(c.value, cardFont("value")));
  const wu = c.unit ? Math.round(r.width(c.unit, cardFont("unit"))) + 8 : 0;
  const x = 160 - Math.floor((wv + wu) / 2);
  r.print(x, 128, cardFont("value"), INK, "BL", c.value);
  if (wu > 0) r.print(x + wv + 8, 128, cardFont("unit"), SUB, "BL", c.unit);
  d.figure.draw(r, "avatar", 0, 124, 150);
}

// Confetti plays once, then holds its last frame (a step per 200 ms, like the box).
export function drawCelebration(r, d, now) {
  const c = d.card;
  d.figure.draw(r, "confetti", now - d.since, 80, 22, CARD_STEP_MS);
  r.print(160, 186, cardFont("title"), INK, "TC", c.title);
  const body = wrap(c.body, r.widthOf(cardFont("body")), 290);
  if (body.length) r.print(160, 212, cardFont("body"), SUB, "TC", body[0]);
}

// Weather: big icon, temperature and condition, the forecast below.
export function drawWeather(r, d, now) {
  const c = d.card;
  const shown = now - d.since;
  if (c.icon >= 0 && c.icon < LARGE_COUNT) d.weather.draw(r, c.icon, 8, 30, 104);
  else if (c.icon >= 0 && c.icon < WEATHER.length) d.weather.draw(r, c.icon, 24, 46, 72);
  r.print(124, 92, cardFont("value"), INK, "BL", c.value);
  const label = wrap(c.label, r.widthOf(cardFont("label")), 186);
  if (label.length) r.print(126, 102, cardFont("label"), SUB, "TL", label[0]);
  r.roundRect(10, 140, 300, 94, 16, CARD);
  const lay = layout(r, d, c.body, cardFont("body"), 276, 3);
  const page = lay.pageAt(shown);
  lay.pageLines(page).forEach((line, k) => r.print(24, 150 + 21 * k, cardFont("body"), TXT, "TL", line));
  r.pageDots(296, 226, lay.pages, page, SUB, SHADOW);
}

// A photo, GIF or live view (the picture itself is media.js's <img> above the canvas)
// with title and message below; while it loads, a white card with the figure.
export function drawPhoto(r, d) {
  const c = d.card;
  const state = d.media.state;
  if (state !== "ready") {
    r.roundRect(10, PHOTO_TOP, PHOTO_W, PHOTO_H, 14, CARD);
    d.figure.draw(r, "avatar", 0, 124, 66);
    r.print(160, 150, cardFont("small"), SUB, "TC", "Bild lädt …");
  }
  const title = wrap(c.title, r.widthOf(cardFont("label")), 292);
  if (title.length) r.print(14, 203, cardFont("label"), INK, "TL", title[0]);
  const body = wrap(c.body, r.widthOf(cardFont("small")), 292);
  if (body.length) r.print(14, 223, cardFont("small"), c.body === "Live" ? RED : SUB, "TL", body[0]);
}

// A route: the box fetches a map and the way; this display has neither (no map
// service), so it shows the title, start, destination and the way of travel as a card.
export function drawRoute(r, d) {
  const c = d.card;
  const PILL = WHITE, EDGE = [205, 205, 210];
  if (c.title) {
    const t = fitLine(c.title, 270, r.widthOf(cardFont("label")), "…");
    const tw = Math.round(r.width(t, cardFont("label"))) + 24;
    r.roundRect(10, 36, tw, 28, 14, PILL);
    r.print(22, 50, cardFont("label"), INK, "CL", t);
  }
  r.roundRect(10, 72, 300, 118, 14, CARD);
  // Start green, destination red, a dashed way between them, as the box marks them.
  const ctx = r.ctx;
  ctx.save();
  ctx.setLineDash([6, 6]);
  r.line(44, 104, 44, 158, 3, EDGE);
  ctx.restore();
  r.circle(44, 104, 8, WHITE);
  r.circle(44, 104, 5.5, [52, 199, 89]);
  r.circle(44, 158, 8, WHITE);
  r.circle(44, 158, 5.5, RED);
  r.print(64, 92, cardFont("small"), SUB, "TL", "Von");
  r.print(64, 106, cardFont("body"), TXT, "TL", fitLine(c.from || "zuhause", 230, r.widthOf(cardFont("body")), "…"));
  r.print(64, 146, cardFont("small"), SUB, "TL", "Nach");
  r.print(64, 160, cardFont("body"), TXT, "TL", fitLine(c.to || "zuhause", 230, r.widthOf(cardFont("body")), "…"));
  const icon = c.profile === "bike" ? 0xF00A3 : c.profile === "foot" ? 0xF0583 : 0xF010B;
  const info = c.profile === "bike" ? "Fahrrad" : c.profile === "foot" ? "Zu Fuß" : "Auto";
  const iw = Math.round(r.width(info, cardFont("label"))) + 58;
  r.roundRect(10, 198, iw, 34, 17, PILL);
  r.print(24, 215, iconFont(24), INK, "CL", String.fromCodePoint(icon));
  r.print(54, 215, cardFont("label"), INK, "CL", info);
  const note = "Karte nur auf der Box";
  const aw = Math.round(r.width(note, cardFont("small"))) + 16;
  r.roundRect(310 - aw, 204, aw, 22, 11, PILL);
  r.print(310 - aw + 8, 215, cardFont("small"), INK, "CL", note);
}

// An event from the house: a coloured disc with its icon, title, message.
export function drawEvent(r, d, now) {
  const c = d.card;
  const shown = now - d.since;
  const ev = eventIcon(c.event);
  r.circle(160, 85, 42, SHADOW);
  r.circle(160, 82, 42, ev.color);
  r.print(160, 82, iconFont(46), WHITE, "C", String.fromCodePoint(ev.glyph));
  const title = wrap(c.title, r.widthOf(cardFont("title")), 296);
  if (title.length) r.print(160, 134, cardFont("title"), INK, "TC", title[0]);
  const lay = layout(r, d, c.body, cardFont("body"), 290, 3);
  const page = lay.pageAt(shown);
  lay.pageLines(page).forEach((line, k) => r.print(160, 162 + 21 * k, cardFont("body"), SUB, "TC", line));
  r.pageDots(306, 232, lay.pages, page, SUB, SHADOW);
}

// The day's appointments: a calendar sheet, title and count, four rows per page.
export function drawAgenda(r, d, now, clock) {
  const c = d.card;
  const items = d.agenda;
  const shown = now - d.since;
  const sx = 14, sy = 36, sw = 66, sh = 74;
  r.roundRect(sx, sy + 2, sw, sh, 12, SHADOW);
  r.roundRect(sx, sy, sw, sh, 12, CARD);
  r.roundRect(sx, sy, sw, 24, 12, RED);
  r.rect(sx, sy + 12, sw, 12, RED);
  r.print(sx + sw / 2, sy + 12, cardFont("small"), WHITE, "C", DAYS_SHORT[clock.getDay()]);
  r.print(sx + sw / 2, sy + 51, cardFont("head"), INK, "C", String(clock.getDate()));
  r.print(96, 40, cardFont("title"), INK, "TL", c.title);
  const count = items.length === 0 ? "Keine Termine" : items.length === 1 ? "1 Termin" : `${items.length} Termine`;
  r.print(96, 68, cardFont("label"), SUB, "TL", count);
  const pages = Math.max(1, Math.ceil(items.length / 4));
  const page = pages > 1 ? Math.floor(shown / 8000) % pages : 0;
  const DOTS = [[0, 122, 255], [255, 149, 0], [52, 199, 89], [175, 82, 222], [255, 45, 85]];
  for (let k = 0; k < 4; k++) {
    const i = page * 4 + k;
    if (i >= items.length) break;
    const y = 122 + k * 28;
    r.roundRect(14, y + 3, 4, 20, 2, DOTS[i % 5]);
    r.print(26, y + 13, cardFont("label"), INK, "CL", fitLine(items[i].time, 84, r.widthOf(cardFont("label")), "…"));
    const what = items[i].title + (items[i].place ? " · " + items[i].place : "");
    r.print(114, y + 13, cardFont("body"), TXT, "CL", fitLine(what, 200, r.widthOf(cardFont("body")), "…"));
  }
  r.pageDots(306, 232, pages, page, SUB, SHADOW);
}

// A question: two options beside the figure, three or four without it in two rows.
export function drawQuestion(r, d) {
  const qs = d.question;
  const n = qs.options.length;
  let lines;
  if (n <= 2) {
    d.figure.draw(r, "avatar", 0, 12, 40);
    lines = wrap(d.card.title, r.widthOf(cardFont("title")), 206);
    if (lines.length > 4) {
      lines = lines.slice(0, 4);
      lines[3] += MORE;
    }
    const top = 95 - lines.length * 12;
    lines.forEach((line, k) => r.print(96, top + 24 * k, cardFont("title"), INK, "TL", line));
  } else {
    lines = wrap(d.card.title, r.widthOf(cardFont("title")), 296);
    if (lines.length > 4) {
      lines = lines.slice(0, 4);
      lines[3] += MORE;
    }
    const top = 92 - lines.length * 12;
    lines.forEach((line, k) => r.print(160, top + 24 * k, cardFont("title"), INK, "TC", line));
  }
  const CHOICE = [[0, 122, 255], [175, 82, 222], [48, 176, 199], [255, 149, 0]];
  const YES = [52, 199, 89], NO = [142, 142, 147];
  const yesno = qs.values.length === 2 && qs.values[0] === "yes" && qs.values[1] === "no";
  for (let i = 0; i < n && i < 4; i++) {
    const b = questionButton(n, i);
    const c = yesno ? (i === 0 ? YES : NO) : CHOICE[i];
    r.roundRect(b.x, b.y, b.w, b.h, b.h / 2 > 18 ? 18 : Math.floor(b.h / 2), c);
    const t = fitLine(qs.options[i], b.w - 16, r.widthOf(cardFont("unit")), "…");
    r.print(Math.floor(b.x + b.w / 2), Math.floor(b.y + b.h / 2), cardFont("unit"), WHITE, "C", t);
  }
}

// A timer: its name, a ring that empties, the time left; the card stays while it runs.
export function drawTimer(r, d, now) {
  const tm = d.timers.soonest();
  if (!tm) return false;
  const keep = now + 2500;
  if (keep > d.until) d.until = keep;
  r.print(160, 40, cardFont("label"), SUB, "TC", fitLine(tm.name, 290, r.widthOf(cardFont("label")), "…"));
  r.ringArc(160, 140, 74, 65, 0, 360, SHADOW);
  const share = tm.total > 0 ? tm.left / tm.total : 0;
  if (share > 0) r.ringArc(160, 140, 74, 65, 0, 360 * share, ORANGE);
  r.print(160, 140, cardFont("head"), INK, "C", timeLeft(tm.left));
  if (d.timers.size > 1) r.print(160, 226, cardFont("small"), SUB, "TC", `+${d.timers.size - 1} weitere`);
  return true;
}

// The display about itself (a tap on the top bar): connection, host, uptime, cards.
export function drawInfo(r, d, now) {
  r.print(160, 36, cardFont("title"), INK, "TC", `Muse Web Screen ${d.version_string}`);
  const up = Math.floor(now / 1000);
  const lines = [
    d.connection === "on" ? "verbunden" : d.connection === "connecting" ? "verbindet …" : d.connection === "demo" ? "Demo" : "getrennt",
    d.host || "nicht eingerichtet",
    `${Math.floor(up / 3600)} h ${String(Math.floor(up / 60) % 60).padStart(2, "0")} min`,
    `${d.queue.waiting.length} warten  ·  ${d.queue.history.length} zurück  ·  ${d.timers.size} Timer`,
    d.displayInfo || "",
    d.browserInfo || "",
  ];
  const LABELS = ["Verbindung", "Home Assistant", "Läuft seit", "Karten", "Anzeige", "Browser"];
  for (let k = 0; k < 6; k++) {
    const y = 70 + k * 27;
    r.print(16, y, cardFont("small"), SUB, "TL", LABELS[k]);
    r.print(304, y - 2, cardFont("body"), TXT, "TR", fitLine(lines[k], 200, r.widthOf(cardFont("body")), "…"));
  }
}

// A list with ticks: the title, how many are done, five rows per page.
export function drawList(r, d, now) {
  const c = d.card;
  const items = d.list;
  const shown = now - d.since;
  const DISC = [48, 176, 199], DONE = [52, 199, 89];
  r.circle(40, 58, 24, DISC);
  r.print(40, 58, iconFont(24), WHITE, "C", String.fromCodePoint(0xF0756)); // format-list-checks
  r.print(78, 40, cardFont("title"), INK, "TL", c.title);
  const done = items.filter((i) => i.done).length;
  r.print(78, 66, cardFont("label"), SUB, "TL", items.length === 0 ? "Nichts drauf" : `${done} von ${items.length} erledigt`);
  const pages = Math.max(1, Math.ceil(items.length / 5));
  const page = pages > 1 ? Math.floor(shown / 8000) % pages : 0;
  for (let k = 0; k < 5; k++) {
    const i = page * 5 + k;
    if (i >= items.length) break;
    const y = 104 + k * 26;
    // checkbox-marked-circle in green when done, checkbox-blank-circle-outline else
    if (items[i].done) r.print(26, y, iconFont(24), DONE, "C", String.fromCodePoint(0xF0133));
    else r.print(26, y, iconFont(24), SUB, "C", String.fromCodePoint(0xF0130));
    r.print(44, y, cardFont("body"), items[i].done ? SUB : TXT, "CL", fitLine(items[i].text, 262, r.widthOf(cardFont("body")), "…"));
  }
  r.pageDots(306, 232, pages, page, SUB, SHADOW);
}

// The card on screen by its mode; false when the mode has nothing to show any more.
export function drawCard(r, d, now, clock) {
  switch (d.card.mode) {
    case 1: drawText(r, d, now); return true;
    case 2: drawValue(r, d); return true;
    case 3: drawCelebration(r, d, now); return true;
    case 4: drawWeather(r, d, now); return true;
    case 5: drawPhoto(r, d); return true;
    case 6: drawEvent(r, d, now); return true;
    case 8: drawQuestion(r, d); return true;
    case 9: drawRoute(r, d); return true;
    case 10: drawAgenda(r, d, now, clock); return true;
    case 11: return drawTimer(r, d, now);
    case 12: drawInfo(r, d, now); return true;
    case 13: drawList(r, d, now); return true;
    default: drawStatus(r, d, now); return true;
  }
}
