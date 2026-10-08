// text.test.js: text cleaning, wrapping, fitting, paging and the small parsers of the cards.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "../text.js";
import { condition, event, eventKey, parseStatus, urgentEvent } from "../tables.js";

const mono = (s) => [...s].length * 7; // a fake font: 7 px per character

test("clean(): weather emojis become an icon, other emojis and Markdown go", () => {
  const r = T.clean("**Hallo** Welt ☀️ 🎉 → ok\n\n\n# Titel\n- Punkt\n`code` __fett__", 1);
  assert.equal(r.text, "Hallo Welt -> ok\n\nTitel\n• Punkt\ncode fett");
  assert.equal(r.icon, T.W.CLEAR_DAY);
  assert.equal(T.clean("🌧 Regen", 1).icon, T.W.RAIN);
  assert.equal(T.clean("kein Wetter", 1).icon, T.W_NONE);
  assert.equal(T.clean("  zu   viele   Leerzeichen  ", 1).text, "zu viele Leerzeichen");
  assert.equal(T.clean("- Punkt", 4).text, "- Punkt", "the big fonts have no bullet");
  assert.equal(T.clean("Grüße ñ ü €", 1).text, "Grüße ñ ü €");
  assert.equal(T.clean("Grüße", 5).text, "Grüße");
  assert.equal(T.clean("Σ ok", 5).text, "ok", "the xxl font lacks Greek");
});

test("drawable() keeps stars and hashes, drops what the font lacks", () => {
  assert.equal(T.drawable("# 5 * 3 🎉", 1), "# 5 * 3 ");
  assert.equal(T.drawable("a\tb c −1", 1), "a b c -1");
});

test("wrap(): words, a word wider than a line, explicit line breaks", () => {
  assert.deepEqual(T.wrap("Dies ist ein langer Text", mono, 100), ["Dies ist ein", "langer Text"]);
  assert.deepEqual(T.wrap("abcdefghijklmnopqrstuvwxyz", mono, 70), ["abcdefghij", "klmnopqrst", "uvwxyz"]);
  assert.deepEqual(T.wrap("eins\nzwei\n\n", mono, 100), ["eins", "zwei"]);
  assert.deepEqual(T.wrap("", mono, 100), []);
});

test("fitLine(): the longest beginning that fits with the ellipsis, cut between characters", () => {
  assert.equal(T.fitLine("kurz", 100, mono), "kurz");
  assert.equal(T.fitLine("Ich lese deine E-Mails und sortiere sie", 100, mono), "Ich lese dein…");
  assert.equal(T.fitLine("Grüße aus Köln, ein langer Satz", 70, mono), "Grüße aus…");
  assert.equal(T.fitLine("abc", 5, mono), "…");
});

test("sceneLines(): wrapped to w, cut to lines with an ellipsis", () => {
  const item = { size: 1, wrap: 100, maxLines: 2 };
  assert.deepEqual(T.sceneLines(item, "Dies ist ein langer Text mit noch mehr Worten", mono), ["Dies ist ein", "langer Text…"]);
  assert.deepEqual(T.sceneLines({ size: 1, wrap: 0, maxLines: 0 }, "a\nb", mono), ["a", "b"]);
});

test("placeholders, clock, temperature, time left", () => {
  const d = new Date(2026, 9, 7, 21, 30);
  assert.equal(T.fillPlaceholders("{time} {date} {weekday}", d), "21:30 7. Oktober Mittwoch");
  assert.equal(T.fillPlaceholders("ohne", d), "ohne");
  assert.equal(T.clockText(new Date(2026, 0, 1, 9, 5)), "09:05");
  assert.equal(T.temperature("21.5 °C"), "21,5°");
  assert.equal(T.temperature("14"), "14°");
  assert.equal(T.temperature("-3 Grad"), "-3°");
  assert.equal(T.temperature(""), "");
  assert.equal(T.timeLeft(299), "4:59");
  assert.equal(T.timeLeft(3661), "1:01:01");
  assert.equal(T.timeLeft(0), "0:00");
});

test("parseDuration(): the forms the box accepts", () => {
  assert.equal(T.parseDuration("5"), 300);
  assert.equal(T.parseDuration("5 min"), 300);
  assert.equal(T.parseDuration("1:30"), 90);
  assert.equal(T.parseDuration("90 s"), 90);
  assert.equal(T.parseDuration("1 h 20 min"), 4800);
  assert.equal(T.parseDuration("1:00:05"), 3605);
  assert.equal(T.parseDuration("2 Std."), 7200);
  assert.equal(T.parseDuration("abc"), 0);
  assert.equal(T.parseDuration(""), 0);
});

test("pageText(): pages of a long text, 5 s to 16 s each, about 15 characters a second", () => {
  const long = Array.from({ length: 12 }, (_, i) => `Zeile ${i} mit ein paar Worten`).join("\n");
  const p = T.pageText(long, mono, 1000, 5);
  assert.equal(p.pages, 3);
  assert.deepEqual(p.ends, [5000 + 0, 0, 0].map((_, i) => p.ends[i]));
  assert.ok(p.ends.every((e, i) => e >= 5000 * (i + 1) && e <= 16000 * (i + 1)));
  assert.equal(p.pageAt(0), 0);
  assert.equal(p.pageAt(p.ends[0]), 1);
  assert.equal(p.pageAt(p.cycle), 0);
  assert.equal(p.pageLines(2).length, 2);
  const short = T.pageText("kurz", mono, 1000, 5);
  assert.equal(short.pages, 1);
  assert.equal(short.pageAt(99999), 0);
});

test("parseAgenda() and parseList(): the three forms, bullets, ticks", () => {
  assert.deepEqual(T.parseAgenda("09:00-10:00 Teammeeting @ Büro\nganztägig Urlaub\n09:00 | Teammeeting | Büro\n- 12:30 Mittag\nnur Titel"), [
    { time: "09:00-10:00", title: "Teammeeting", place: "Büro" },
    { time: "ganztägig", title: "Urlaub", place: "" },
    { time: "09:00", title: "Teammeeting", place: "Büro" },
    { time: "12:30", title: "Mittag", place: "" },
    { time: "", title: "nur Titel", place: "" },
  ]);
  assert.deepEqual(T.parseList("[x] Milch\n[ ] Brot\n[] Eier\n- Butter\nKäse\n✓ Salz\n\n"), [
    { text: "Milch", done: true }, { text: "Brot", done: false }, { text: "Eier", done: false },
    { text: "Butter", done: false }, { text: "Käse", done: false }, { text: "Salz", done: false },
  ]);
  assert.equal(T.parseList(Array.from({ length: 50 }, (_, i) => `Punkt ${i}`).join("\n")).length, 40);
  assert.deepEqual(T.parseOptions("Jazz\nRock\n\nKlassik\nNichts\nMehr"), ["Jazz", "Rock", "Klassik", "Nichts"]);
  assert.deepEqual(T.parseOptions("nur eins"), ["Ja", "Nein"]);
});

test("the words of the box: status, weather conditions, event icons", () => {
  assert.equal(parseStatus("thinking"), 2);
  assert.equal(parseStatus("Denkt"), 2);
  assert.equal(parseStatus("ruhe"), 5);
  assert.equal(parseStatus("sonstwas"), 0);
  assert.deepEqual(condition("partlycloudy"), { key: "partlycloudy", icon: T.W.PARTLY_DAY, label: "Teils bewölkt" });
  assert.equal(condition("Morgen Regen und Wind").key, "regen", "the longer word wins");
  assert.equal(condition("lightning-rainy").label, "Gewitter mit Regen");
  assert.equal(condition("xyz"), null);
  assert.equal(eventKey("Rollladen runter"), "rollladen_runter");
  assert.equal(eventKey("doorbell"), "klingel");
  assert.equal(event("garage_open").glyph, 0xF12D4);
  assert.deepEqual(event("nope").color, [142, 142, 147]);
  assert.equal(event("Tür").key, "tuer");
  assert.ok(urgentEvent("klingel") && urgentEvent("doorbell") && urgentEvent("bell-ring") && !urgentEvent("mail"));
});
