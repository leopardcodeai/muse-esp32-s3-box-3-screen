// display.test.js: the state machine behind the display, with a fake clock and fakes
// for the canvas, the figure, the weather icons and the picture overlay: the actions
// become cards with the box's timings, the queue rules hold, timers end with the chime,
// touches move on and answers go out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Display } from "../display.js";

function make(extra = {}) {
  const clock = { t: 100000 };
  const answers = [];
  const sounds = [];
  const media = { state: "none", shown: [], show(url, live) { this.state = "loading"; this.shown.push([url, live]); }, hide() { this.state = "none"; } };
  const d = new Display({
    renderer: {}, figure: {}, weather: {}, media,
    now: () => clock.t,
    clock: () => new Date(2026, 9, 7, 21, 30),
    onAnswer: (a, q) => answers.push([a, q]),
    sound: { ask: () => sounds.push("ask"), chime: () => sounds.push("chime") },
    ...extra,
  });
  const advance = (ms) => {
    clock.t += ms;
    d.tick();
  };
  return { d, clock, answers, sounds, media, advance };
}

test("the cards stay as long as on the box", () => {
  const cases = [
    ["show_text", { title: "T", message: "M" }, 20000],
    ["show_value", { label: "L", value: "1", unit: "u" }, 20000],
    ["show_event", { icon: "mail", title: "T", message: "M" }, 20000],
    ["celebrate", { title: "T", message: "M" }, 30000],
    ["show_weather", { condition: "sunny", temperature: "20", message: "M" }, 60000],
    ["show_image", { title: "T", message: "M", url: "http://x/y.jpg" }, 90000],
    ["show_live", { title: "T", url: "http://x/y.jpg", seconds: 30 }, 33000],
    ["show_route", { title: "T", from: "a", to: "b", mode: "bike" }, 60000],
    ["show_agenda", { title: "", events: "09:00 a" }, 30000],
    ["show_list", { title: "", items: "a" }, 30000],
    ["ask", { question: "Q?", yes_label: "", no_label: "" }, 120000],
    ["draw", { scene: "bg red\nseconds 45" }, 45000],
  ];
  for (const [action, fields, ms] of cases) {
    const { d, advance } = make();
    const r = d.dispatch(action, fields);
    assert.ok(r, action);
    assert.notEqual(d.mode, 0, action);
    advance(ms - 1);
    assert.notEqual(d.mode, 0, `${action} still up before ${ms} ms`);
    advance(2);
    assert.equal(d.mode, 0, `${action} gone after ${ms} ms`);
  }
});

test("the responses of the actions look like the box's", () => {
  const { d } = make();
  assert.deepEqual(d.dispatch("show_text", { title: "a", message: "b" }), { on_screen: true, waiting: 0 });
  assert.deepEqual(d.dispatch("show_text", { title: "c", message: "d" }), { on_screen: false, waiting: 1 });
  assert.deepEqual(d.dispatch("draw", { scene: "kreis" }), { ok: false, elements: 0, frames: 0, seconds: 20, skipped: 1,
    errors: ["line 1: circle: needs r above 0"] });
  assert.deepEqual(d.dispatch("show_timer", { label: "Tee", duration: "3 min" }), { ok: true, seconds: 180, timers: 1 });
  assert.deepEqual(d.dispatch("show_timer", { label: "x", duration: "nope" }), { ok: false, seconds: 0, timers: 1 });
  assert.deepEqual(d.dispatch("cancel_timer", { label: "tee" }), { cancelled: true, timers: 0 });
  assert.equal(d.dispatch("get_state", {}).mode, "timer");
  assert.deepEqual(d.dispatch("clear", {}), { cleared: true });
  assert.equal(d.dispatch("get_state", {}).mode, "status");
  assert.equal(d.dispatch("unknown", {}), null);
});

test("a question goes first, its buttons answer, an unanswered one answers none", () => {
  const { d, answers, sounds, advance } = make();
  d.dispatch("show_text", { title: "T", message: "M" });
  d.dispatch("ask", { question: "Licht an?", yes_label: "", no_label: "" });
  assert.equal(d.mode, 8);
  assert.deepEqual(d.question.options, ["Ja", "Nein"]);
  assert.deepEqual(sounds, ["ask"]);
  assert.equal(d.queue.waiting[0].title, "T", "the text card comes back afterwards");
  d.touchStart(160, 100);
  d.touchEnd();
  assert.equal(d.mode, 8, "a tap beside the buttons does nothing");
  d.touchStart(200, 190);
  d.touchEnd();
  assert.deepEqual(answers, [["no", "Licht an?"]]);
  assert.equal(d.mode, 1, "the text card is back");
  d.dispatch("choose", { question: "Was?", options: "Jazz\nRock\nKlassik" });
  advance(120001);
  assert.deepEqual(answers[1], ["none", "Was?"]);
  assert.equal(d.mode, 1);
});

test("scene buttons answer with their text and the scene ends", () => {
  const { d, answers } = make();
  d.dispatch("draw", { scene: "bg navy\nbutton 20 110 130 50 \"Jazz\" purple\nbutton 170 110 130 50 \"Rock\" orange\nseconds 60" });
  assert.equal(d.mode, 7);
  d.touchStart(200, 130);
  d.touchEnd();
  assert.deepEqual(answers, [["Rock", "Szene"]]);
  assert.equal(d.mode, 0);
});

test("a scene replaces a scene; an empty scene ends it; a scene waits behind a card", () => {
  const { d } = make();
  d.dispatch("draw", { scene: "bg red" });
  d.dispatch("draw", { scene: "bg blue" });
  assert.equal(d.mode, 7);
  assert.deepEqual(d.scene.items[0].color, [0, 122, 255]);
  assert.equal(d.queue.waiting.length, 0);
  d.dispatch("draw", { scene: "   " });
  assert.equal(d.mode, 0);
  d.dispatch("show_text", { title: "T", message: "M" });
  assert.deepEqual(d.dispatch("draw", { scene: "bg red" }).ok, true);
  assert.equal(d.mode, 1);
  assert.equal(d.queue.waiting[0].mode, 7);
});

test("a timer: the card stays while it runs, then the chime and the card that says so", () => {
  const { d, sounds, advance } = make();
  d.dispatch("show_text", { title: "T", message: "M" });
  d.dispatch("show_timer", { label: "Tee", duration: "15 s" });
  assert.equal(d.mode, 11);
  assert.equal(d.timers.soonest().left, 15);
  advance(14000);
  assert.equal(d.mode, 11);
  assert.equal(d.timers.soonest().left, 1);
  d.touchStart(160, 120);
  d.touchEnd();
  assert.equal(d.mode, 1, "a tap moves on; the time left shows in the top bar");
  advance(1001);
  assert.deepEqual(sounds, ["chime"]);
  assert.equal(d.mode, 6);
  assert.equal(d.card.title, "Zeit ist um");
  assert.equal(d.card.body, "Tee");
  assert.equal(d.card.event, "timer");
  assert.equal(d.timers.size, 0);
  advance(30001);
  assert.equal(d.mode, 1, "the text card comes back after 30 s");
});

test("the doorbell goes first; the door photo with the same title replaces it", () => {
  const { d, media } = make();
  d.dispatch("show_text", { title: "T", message: "M" });
  assert.deepEqual(d.dispatch("show_event", { icon: "klingel", title: "Es klingelt", message: "Haustür" }), { on_screen: true, waiting: 1 });
  assert.equal(d.mode, 6);
  d.dispatch("show_image", { title: "Es klingelt", message: "", url: "http://x/door.jpg" });
  assert.equal(d.mode, 5);
  assert.equal(d.card.event, "klingel", "a failed photo would still show the doorbell");
  assert.deepEqual(media.shown, [["http://x/door.jpg", 0]]);
  assert.equal(d.queue.waiting[0].title, "T");
  d.dispatch("show_image", { title: "Ohne Bild", message: "x", url: "" });
  assert.equal(d.queue.waiting[1].mode, 6, "no url: an event card");
});

test("touch: tap moves on, swipe right goes back, swipe down and a long press clear everything, the top bar shows the info", () => {
  const { d, clock } = make();
  d.dispatch("show_text", { title: "A", message: "M" });
  d.dispatch("show_text", { title: "B", message: "M" });
  d.dispatch("show_text", { title: "C", message: "M" });
  d.touchStart(160, 120);
  d.touchEnd();
  assert.equal(d.card.title, "B");
  d.touchStart(100, 120);
  d.touchMove(200, 125);
  d.touchEnd();
  assert.equal(d.card.title, "A", "swipe right: the card before");
  d.touchStart(200, 120);
  d.touchMove(100, 125);
  d.touchEnd();
  assert.equal(d.card.title, "B", "swipe left: the next");
  d.touchStart(160, 60);
  d.touchMove(165, 160);
  d.touchEnd();
  assert.equal(d.mode, 0, "swipe down: every card gone");
  assert.equal(d.queue.waiting.length, 0);
  d.dispatch("show_text", { title: "D", message: "M" });
  d.touchStart(160, 120);
  clock.t += 800;
  d.touchEnd();
  assert.equal(d.mode, 0, "long press: every card gone");
  d.touchStart(160, 10);
  d.touchEnd();
  assert.equal(d.mode, 12, "the top bar: the display about itself");
  d.touchStart(160, 120);
  d.touchEnd();
  assert.equal(d.mode, 0);
  d.touchStart(160, 120);
  d.touchEnd();
  assert.equal(d.status, 6, "a tap on the ready screen: cuddled, the figure waves");
  assert.ok(d.cuddleUntil > clock.t);
});

test("status and status text", () => {
  const { d, advance } = make();
  assert.deepEqual(d.dispatch("set_status", { status: "thinking" }), { status: 2 });
  d.dispatch("set_status_text", { status: "thinking", label: "Ich lese **deine** E-Mails …\nZeile" });
  assert.equal(d.statusText, "Ich lese deine E-Mails … Zeile");
  d.dispatch("set_status", { status: "error" });
  assert.equal(d.status, 4);
  advance(6001);
  assert.equal(d.status, 0, "an error shows for 6 s");
});

test("the demo shortens every card to its step, but not questions and timers", () => {
  const { d, advance } = make({ demoMs: 7000 });
  d.dispatch("show_weather", { condition: "sunny", temperature: "20", message: "M" });
  advance(7001);
  assert.equal(d.mode, 0);
  d.dispatch("ask", { question: "Q?", yes_label: "", no_label: "" });
  advance(7001);
  assert.equal(d.mode, 8);
});
