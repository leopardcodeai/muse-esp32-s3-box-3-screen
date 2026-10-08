// scene.test.js: the parser answers like the box. The cases mirror tools/tests/
// test_muse_scene.cpp (their numbers are noted) and tools/test_render_scene.py.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as S from "../scene.js";
import { ICON_WORDS } from "../icons.js";

const here = dirname(fileURLToPath(import.meta.url));
const SCENES = resolve(here, "../../scenes");
const DEMO_SCENES = resolve(here, "../demo/scenes");

test("the example from the header parses without a message (case 1)", () => {
  const s = S.parse("bg #0b1d3a #3a1c5c\ncircle 252 58 26 #ffd166 pulse=3000\ntext 20 70 \"Gute Nacht, Sam\" size=xl color=white\n"
    + "icon 40 190 weather-night color=#c9d6ff\nparticles sparkle 30\nseconds 60\n");
  assert.deepEqual(s.errors, []);
  assert.equal(s.items.length, 5);
  assert.equal(s.seconds, 60);
  assert.equal(s.items[0].kind, "bg");
  assert.equal(s.items[0].gradient, true);
  assert.deepEqual(s.items[0].color, [0x0b, 0x1d, 0x3a]);
  assert.deepEqual(s.items[0].color2, [0x3a, 0x1c, 0x5c]);
  assert.equal(s.items[1].kind, "circle");
  assert.equal(s.items[1].pulse, 3000);
  assert.equal(s.items[2].text, "Gute Nacht, Sam");
  assert.equal(s.items[2].size, 4);
  assert.deepEqual(s.items[2].color, [255, 255, 255]);
  assert.equal(s.items[3].glyph, 0xF0594);
  assert.equal(s.items[4].sub, "sparkle");
  assert.equal(s.items[4].count, 30);
  assert.deepEqual([s.items[4].w, s.items[4].h, s.items[4].size], [320, 240, 0]);
});

test("unknown command names the closest one (case 6)", () => {
  const s = S.parse("circel 10 10 5 red");
  assert.deepEqual(s.errors, ["line 1: unknown command 'circel'; did you mean 'circle'?"]);
  assert.deepEqual(s.items, []);
  assert.equal(s.skipped, 1);
});

test("bad colour and unknown key with the key list; the rest draws (cases 4 and 6)", () => {
  const s = S.parse("rect 0 0 10 10 #abc\nrect 0 0 10 10 rosa\nrect 0 0 10 10 red radius=4\nstar 160 120 30 gold");
  assert.equal(s.errors[0], "line 2: rect: color='rosa' is no colour; use #rrggbb or a name (white, black, gray, red, orange, "
    + "yellow, green, mint, teal, cyan, blue, navy, indigo, purple, pink, brown, gold, page, ink)");
  assert.equal(s.errors[1], "line 3: rect: unknown key 'radius'; keys: x y w h color r line opacity delay dur blink fade move period");
  assert.equal(s.errors.length, 2);
  assert.deepEqual(s.items[0].color, [0xaa, 0xbb, 0xcc]);
  assert.deepEqual(s.items[1].color, S.INK);
  assert.deepEqual(s.items.map((i) => i.kind), ["rect", "rect", "rect", "star"]);
});

test("icon typo, missing values, one value too many (cases 5 and 6)", () => {
  const s = S.parse("icon 10 10 kafee\nrect 0 0 0 10 red\ncircle 50 50 abc\ntext 10 10\nrect 1 2 3 4 5 6 7");
  assert.equal(s.errors[0], "line 1: icon: no icon 'kafee'; did you mean 'kaffee'?");
  assert.ok(s.errors.includes("line 2: rect: needs w and h above 0"));
  assert.ok(s.errors.includes("line 3: circle: r='abc' is not a number"));
  assert.ok(s.errors.includes("line 4: text: needs a text"));
  assert.ok(s.errors.includes("line 5: rect: one value too many: '6'"));
  assert.ok(s.errors.includes("line 5: rect: one value too many: '7'"));
  assert.deepEqual(s.items.map((i) => i.kind), ["rect"]);
  assert.equal(s.skipped, 4);
});

test("icon suggestions: typo, part of a name, no wild guess (case 5)", () => {
  const s = S.parse("icon 10 10 kafee\nicon 10 10 sunny\nicon 10 10 zzzzzzzz");
  assert.equal(s.items.length, 0);
  assert.equal(s.skipped, 3);
  assert.ok(s.errors.some((e) => e.includes("did you mean 'weather-sunny'")));
  assert.ok(s.errors.some((e) => e.includes("no icon 'zzzzzzzz'") && !e.includes("'zzzzzzzz'; did")));
  assert.equal(S.closest("kafee", ICON_WORDS), "kaffee");
  assert.equal(S.closest("hert", ICON_WORDS), "heart");
  assert.equal(S.closest("kalendar", ICON_WORDS), "calendar");
  assert.equal(S.closest("xyz", ICON_WORDS), "eye");
});

test("icon names: MDI names, prefixes, case, aliases, umlauts, underscores (case 5)", () => {
  assert.equal(S.iconCodepoint("coffee"), 0xF0176);
  assert.equal(S.iconCodepoint("mdi:coffee"), 0xF0176);
  assert.equal(S.iconCodepoint(" Coffee "), 0xF0176);
  assert.equal(S.iconCodepoint("kaffee"), 0xF0176);
  assert.equal(S.iconCodepoint("Schlüssel"), S.iconCodepoint("key"));
  assert.notEqual(S.iconCodepoint("key"), 0);
  assert.equal(S.iconCodepoint("rollladen_runter"), 0xF111C);
  assert.equal(S.iconCodepoint("klingel"), 0xF009E);
  assert.equal(S.iconCodepoint("weather_sunny"), S.iconCodepoint("weather-sunny"));
  assert.equal(S.iconCodepoint("kafee"), 0);
});

test("the whole list of mistakes is capped at 12 messages and the good line still draws (case 6)", () => {
  const s = S.parse("circel 10 10 5 red\nrect 0 0 10 10 red radius=4\nrect 0 0 0 10 red\ncircle 10 10\nline 0 0 10\ntri 0 0 10 10\n"
    + "text 10 10\nrect 1 2 3 4 5 6 7\ncircle 50 50 abc\ntext 10 10 \"ok\" size=riesig align=mitte\nstar 160 120 30 gold");
  assert.equal(s.errors.length, S.MAX_ERRORS);
  assert.ok(s.errors[s.errors.length - 1].endsWith("(and 2 more)"));
  assert.ok(s.errors.includes("line 5: line: needs x2 and y2"));
  assert.ok(s.errors.includes("line 6: tri: needs three points: x y x2 y2 x3 y3"));
  assert.ok(s.items.some((i) => i.kind === "star"));
  const german = S.parse("hintergrund navy\nkreis 10 10 5 red\nsymbol 20 20 herz\nsekunden 40");
  assert.deepEqual(german.errors, []);
  assert.equal(german.items.length, 3);
  assert.equal(german.seconds, 40);
});

test("positional and named values mean the same; ';' separates commands (case 2)", () => {
  const a = S.parse("rect 10 20 100 50 #ff0000 r=8").items[0];
  const b = S.parse("rect color=#f00 h=50 w=100 y=20 x=10 r=8").items[0];
  assert.deepEqual([a.x, a.y, a.w, a.h, a.color, a.radius], [10, 20, 100, 50, [255, 0, 0], 8]);
  assert.deepEqual([b.x, b.y, b.w, b.h, b.color, b.radius], [10, 20, 100, 50, [255, 0, 0], 8]);
  const c = S.parse("bg black; rect 0 0 10 10 red ; circle 5 5 3 blue;;");
  assert.deepEqual(c.errors, []);
  assert.equal(c.items.length, 3);
});

test("quotes, escapes, comments, ';' inside quotes, unquoted text (case 3)", () => {
  const s = S.parse("# a comment\n// another one\ntext 10 10 \"Eins; zwei\" size=m\ntext 10 40 'Geht\\'s gut?' color=red\n"
    + "text 10 70 Hallo Welt, wie geht's? size=l\ntext x=10 y=100 text=\"Zeile 1\\nZeile 2\"\n");
  assert.deepEqual(s.errors, []);
  assert.deepEqual(s.items.map((i) => i.text), ["Eins; zwei", "Geht's gut?", "Hallo Welt, wie geht's?", "Zeile 1\nZeile 2"]);
  assert.deepEqual(s.items.map((i) => i.size), [2, 1, 3, 1]);
  const comments = S.parse("# a; b\nrect 0 0 5 5 #f00; // c; d\n  # e;f\ncircle 1 1 1 red # the sun; really\n"
    + "text 0 0 \"# not a comment\" // but this is\n#fff");
  assert.deepEqual(comments.errors, []);
  assert.equal(comments.items.length, 3);
  assert.deepEqual(comments.items[0].color, [255, 0, 0]);
  assert.equal(comments.items[2].text, "# not a comment");
  const open = S.parse("text 10 10 \"nicht zu\ncircle 50 50 10 red");
  assert.equal(open.items.length, 2);
  assert.ok(open.errors.some((e) => e.includes("quote is not closed")));
});

test("colours: #rgb, #rrggbb, alpha, names, percent opacity (case 4)", () => {
  const s = S.parse("rect 0 0 10 10 #abc\nrect 0 0 10 10 #11223380\nrect 0 0 10 10 teal opacity=0.25\n"
    + "rect 0 0 10 10 #ffffff80 opacity=90\nrect 0 0 10 10 rosa");
  assert.equal(s.items.length, 5);
  assert.deepEqual(s.items[1].color, [0x11, 0x22, 0x33]);
  assert.ok(Math.abs(s.items[1].opacity - 128 / 255) < 0.01);
  assert.deepEqual(s.items[2].color, [48, 176, 199]);
  assert.equal(s.items[2].opacity, 0.25);
  assert.ok(Math.abs(s.items[3].opacity - 0.9) < 0.001, "opacity percent wins over alpha");
  assert.ok(s.errors.some((e) => e.includes("'rosa' is no colour")));
});

test("frames, once, frame end, and the timing of frames (case 7)", () => {
  const s = S.parse("bg navy\nframe 300\ncircle 10 10 5 red\nframe\ncircle 20 20 5 blue\nframe end\ntext 0 0 \"immer\"");
  assert.deepEqual(s.errors, []);
  assert.deepEqual(s.frames, [300, 500]);
  assert.deepEqual(s.items.map((i) => i.frame), [-1, 0, 1, -1]);
  assert.deepEqual([0, 299, 300, 799, 800].map((t) => s.frameAt(t)), [0, 0, 1, 1, 0]);
  assert.ok(S.visible(s.items[1], 100, 0) && !S.visible(s.items[1], 100, 1) && S.visible(s.items[3], 100, 1));
  const once = S.parse("once\nframe 100\nframe 100");
  assert.ok(once.once && once.frameAt(150) === 1 && once.frameAt(5000) === 1);
  const none = S.parse("rect 0 0 5 5 red");
  assert.ok(none.frameAt(1234) === -1 && S.visible(none.items[0], 1234, -1));
  const capped = S.parse("frame 100\n".repeat(30));
  assert.equal(capped.frames.length, S.MAX_FRAMES);
  assert.ok(capped.errors.some((e) => e.includes("more than 24 frames")));
  const bad = S.parse("frame abc\nrect 0 0 5 5 red");
  assert.deepEqual(bad.errors, ["line 1: frame: 'abc' is not a number of ms; 500 ms instead"]);
  assert.deepEqual(bad.frames, [500]);
});

test("seconds: plain, with unit, minutes, clamped, seconds=30 (case 8)", () => {
  assert.equal(S.parse("seconds 45").seconds, 45);
  assert.equal(S.parse("seconds 30s").seconds, 30);
  assert.equal(S.parse("seconds 2min").seconds, 120);
  assert.equal(S.parse("seconds 1").seconds, 3);
  assert.equal(S.parse("seconds 99999").seconds, 3600);
  assert.equal(S.parse("seconds=30").seconds, 30);
  assert.equal(S.parse("").seconds, 20);
  const bad = S.parse("seconds lange");
  assert.equal(bad.seconds, 20);
  assert.deepEqual(bad.errors, ["line 1: seconds: 'lange' is not a number"]);
});

test("element timing: delay, dur, blink, fade, move, spin, pulse, type (case 9)", () => {
  const s = S.parse("rect 0 0 10 10 red delay=1000 dur=2000 fade=500\nrect 0 0 10 10 red blink=250\n"
    + "circle 50 50 10 red move=20,-10 period=1000 pulse=400\nstar 1 1 5 red spin=2000 rot=10\ntext 0 0 \"abc\" type=100");
  assert.deepEqual(s.errors, []);
  const a = s.items[0];
  assert.ok(!S.visible(a, 999, -1) && S.visible(a, 1000, -1) && S.visible(a, 2999, -1) && !S.visible(a, 3000, -1));
  assert.equal(S.alpha(a, 1000), 0);
  assert.ok(Math.abs(S.alpha(a, 1250) - 0.5) < 0.01);
  assert.equal(S.alpha(a, 2000), 1);
  assert.ok(Math.abs(S.alpha(a, 2750) - 0.5) < 0.01);
  const b = s.items[1];
  assert.ok(S.visible(b, 0, -1) && !S.visible(b, 250, -1) && S.visible(b, 500, -1));
  assert.deepEqual(S.offset(s.items[2], 0), [0, -0]);
  const [dx, dy] = S.offset(s.items[2], 500);
  assert.ok(Math.abs(dx - 20) < 0.01 && Math.abs(dy + 10) < 0.01);
  assert.ok(Math.abs(S.scale(s.items[2], 100) - 1.12) < 0.001);
  assert.ok(Math.abs(S.angle(s.items[3], 500) - 100) < 0.01);
  assert.equal(S.typed(s.items[4], 0), 1);
  assert.equal(S.typed(s.items[4], 250), 3);
  assert.equal(S.typed(s.items[0], 0), Infinity);
  const move = S.parse("rect 0 0 5 5 red move=5");
  assert.deepEqual(move.errors, ["line 1: rect: move='5' should be dx,dy such as move=0,-12"]);
});

test("under(): gradient, shapes, translucency, frames, time, deep stacks (case 10)", () => {
  const s = S.parse("bg #000000 #ffffff\nrect 100 100 50 50 red\nrect 100 100 50 50 #0000ff opacity=0.5\n"
    + "circle 20 20 10 green\nframe 100\nrect 0 0 320 240 yellow\nframe end\nrect 200 0 10 10 white delay=1000");
  assert.deepEqual(s.errors, []);
  assert.deepEqual(S.under(s, 4, 5, 0, 0, 0), [0, 0, 0]);
  assert.deepEqual(S.under(s, 4, 5, 239, 0, 0), [255, 255, 255]);
  const half = S.under(s, 4, 5, 119.5, 0, 0);
  assert.ok(half[0] > 120 && half[0] < 135);
  assert.deepEqual(S.under(s, 2, 120, 120, 0, 0), [255, 59, 48]);
  assert.deepEqual(S.under(s, 3, 120, 120, 0, 0), [128, 30, 152], "half blue over red");
  assert.deepEqual(S.under(s, 4, 20, 20, 0, 0), [52, 199, 89]);
  assert.deepEqual(S.under(s, s.items.length, 20, 20, 0, 0), [255, 204, 0], "frame 0 rect covers all");
  assert.deepEqual(S.under(s, s.items.length, 20, 20, 0, -1), [52, 199, 89], "other frame ignored");
  assert.notDeepEqual(S.under(s, s.items.length, 205, 5, 0, -1), [255, 255, 255], "before its delay");
  assert.deepEqual(S.under(s, s.items.length, 205, 5, 1000, -1), [255, 255, 255], "after its delay");
  const two = S.parse("bg black\nrect 0 0 50 50 red opacity=0.5\nrect 0 0 50 50 #0000ff opacity=0.5");
  assert.deepEqual(S.under(two, 3, 10, 10, 0, -1), [64, 15, 140], "layer order");
  assert.deepEqual(S.under(S.parse(""), 0, 10, 10, 0, -1), S.PAGE);
  const deep = S.parse("bg black\n" + "rect 0 0 320 240 white opacity=0.1\n".repeat(240));
  assert.ok(S.under(deep, deep.items.length, 10, 10, 0, -1)[0] > 200, "240 translucent layers");
});

test("limits: elements, source size, text length, particles (case 11)", () => {
  const s = S.parse("rect 0 0 5 5 red\n".repeat(300));
  assert.equal(s.items.length, S.MAX_ITEMS);
  assert.ok(s.errors.some((e) => e.includes("more than 250 elements")));
  const h = S.parse("x".repeat(S.MAX_SOURCE + 500));
  assert.ok(h.errors.some((e) => e.includes("only the first 16384 are read")));
  const t = S.parse("text 0 0 \"" + "a".repeat(2000) + "\"");
  assert.equal(t.items[0].text.length, S.MAX_TEXT);
  assert.equal(S.parse("particles snow 999").items[0].count, S.MAX_PARTICLES);
});

test("defaults and the other commands (case 12)", () => {
  const s = S.parse("bg\nmuse\navatar 40 40\nmuse 100 120 wave r=60\nbar 20 200 280 12 65%\n"
    + "bar 20 220 280 12 30 #ff9500 bg=#333333 r=pill\npoly 160 120 40 6 purple rot=30\nline 0 0 320 240 white w=3\n"
    + "tri 0 0 10 0 5 8 pink line=2\nparticles snow count=80 color=white\nparticles confetti icon=heart size=l speed=2\n"
    + "text 160 120 Mitte align=center valign=middle w=200 lines=2 lh=30\nicon 50 50 heart size=s\nicon 50 50 heart size=40");
  assert.deepEqual(s.errors, []);
  assert.equal(s.items.length, 14);
  assert.deepEqual(s.items[0].color, S.PAGE);
  assert.deepEqual([s.items[1].x, s.items[1].y, s.items[1].r, s.items[1].sub], [160, 110, 80, "idle"]);
  assert.equal(s.items[2].sub, "avatar");
  assert.deepEqual([s.items[3].sub, s.items[3].r], ["wave", 60]);
  assert.deepEqual([s.items[4].value, s.items[4].color, s.items[4].color2], [65, [52, 199, 89], [209, 209, 214]]);
  assert.deepEqual([s.items[5].radius, s.items[5].color2], [-1, [0x33, 0x33, 0x33]]);
  assert.deepEqual([s.items[6].points, s.items[6].rot], [6, 30]);
  assert.equal(s.items[7].stroke, 3);
  assert.equal(s.items[8].stroke, 2);
  assert.deepEqual([s.items[9].sub, s.items[9].count, s.items[9].hasColor], ["snow", 80, true]);
  assert.deepEqual([s.items[10].glyph, s.items[10].size, s.items[10].speed], [S.iconCodepoint("heart"), 1, 2]);
  assert.deepEqual([s.items[11].align, s.items[11].valign, s.items[11].wrap, s.items[11].maxLines, s.items[11].lineH], [1, 1, 200, 2, 30]);
  assert.deepEqual([s.items[12].size, s.items[13].size], [0, 1]);
  const sizes = S.parse("text 0 0 a size=xs\ntext 0 0 a size=xxl\ntext 0 0 a size=30\ntext 0 0 a size=19");
  assert.deepEqual(sizes.items.map((i) => i.size), [0, 5, 3, 2]);
  assert.deepEqual(S.parse("muse 10 10 dance").errors, ["line 1: muse: anim='dance' is none of idle, wave, working, making, avatar"]);
  assert.deepEqual(S.parse("particles stars 10").errors, ["line 1: particles: kind='stars' is none of confetti, snow, rain, sparkle, bubbles"]);
  assert.deepEqual(S.parse("bg red blue dir=up").errors, ["line 1: bg: dir='up' is none of down, right"]);
  assert.deepEqual(S.parse("icon 10 10 heart size=huge").errors, ["line 1: icon: size='huge' is none of s, l (24, 46 px)"]);
});

test("buttons: positional and named, defaults, hit test, mistakes (case 13)", () => {
  const s = S.parse("bg page\nbutton 20 160 130 50 \"Ja, gern\" green\nbutton x=170 y=160 w=130 h=50 text=Nein\n"
    + "button 10 10 0 10 Leer\nbutton 10 10 50 20\nknopf 10 100 100 30 Deutsch size=s r=6 delay=5000");
  assert.equal(s.items.length, 4);
  assert.ok(s.errors.includes("line 4: button: needs w and h above 0"));
  assert.ok(s.errors.includes("line 5: button: needs a text"));
  assert.deepEqual([s.items[1].text, s.items[1].color, s.items[1].radius, s.items[1].size], ["Ja, gern", [52, 199, 89], -1, 2]);
  assert.deepEqual([s.items[2].text, s.items[2].color], ["Nein", [0, 122, 255]]);
  assert.deepEqual([s.items[3].text, s.items[3].size, s.items[3].radius], ["Deutsch", 1, 6]);
  assert.equal(S.buttonAt(s, 25, 165, 0, -1), 1);
  assert.equal(S.buttonAt(s, 299, 209, 0, -1), 2);
  assert.equal(S.buttonAt(s, 300, 160, 0, -1), -1);
  assert.equal(S.buttonAt(s, 50, 110, 1000, -1), -1);
  assert.equal(S.buttonAt(s, 50, 110, 6000, -1), 3);
});

test("every scene in scenes/ and in demo/scenes/ parses without a message", () => {
  for (const dir of [SCENES, DEMO_SCENES]) {
    const files = readdirSync(dir).filter((f) => f.endsWith(".txt")).sort();
    assert.ok(files.length >= 12, `scenes in ${dir}`);
    for (const f of files) {
      const s = S.parse(readFileSync(resolve(dir, f), "utf8"));
      assert.deepEqual(s.errors, [], f);
      assert.ok(s.items.length > 0, f);
    }
  }
});

test("the demo scenes are copies of the project's scenes", () => {
  for (const f of readdirSync(SCENES).filter((f) => f.endsWith(".txt"))) {
    assert.equal(readFileSync(resolve(DEMO_SCENES, f), "utf8"), readFileSync(resolve(SCENES, f), "utf8"), f);
  }
});

test("the response of muse_draw has the box's fields", () => {
  const r = S.response(S.parse("rect 0 0 5 5 red\nseconds 40\nkreis"));
  assert.deepEqual(r, { ok: false, elements: 1, frames: 0, seconds: 40, skipped: 1,
    errors: ["line 3: circle: needs r above 0"] });
});

test("random scenes neither crash nor exceed the limits (case 14)", () => {
  const pieces = ["bg", "rect", "circle", "text", "icon", "star", "frame", "once", "seconds", "particles", "muse", "bar",
    "line", "tri", "poly", "10", "-5", "300", "1e9", "nan", "#fff", "#12", "red", "\"", "'", "\\", ";", "\n", " ", "=",
    "x=", "color=", "move=1,2", "move=,", "size=xl", "heart", "mdi:", "button", "knopf", "ä", "�", "😀", "opacity=2",
    "delay=-1", "r=pill", "frame end", "#", "//", "type=0", "period=0", "spin=1"];
  let seed = 11;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
  for (let round = 0; round < 1500; round++) {
    let src = "";
    const len = rand() % 120;
    for (let k = 0; k < len; k++) {
      src += pieces[rand() % pieces.length];
      if (rand() % 3) src += " ";
    }
    const s = S.parse(src);
    assert.ok(s.items.length <= S.MAX_ITEMS && s.frames.length <= S.MAX_FRAMES && s.errors.length <= S.MAX_ERRORS);
    for (const it of s.items) {
      assert.ok(it.opacity >= 0 && it.opacity <= 1);
      assert.ok(it.count >= 1 && it.count <= S.MAX_PARTICLES);
      assert.ok(it.period >= 100);
      S.under(s, s.items.length, it.x, it.y, 1234, s.frameAt(1234));
      S.alpha(it, 777);
    }
    assert.ok(s.seconds >= 3 && s.seconds <= 3600);
  }
});
