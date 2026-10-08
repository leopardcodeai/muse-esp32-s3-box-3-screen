// display.js: the display's state machine, the port of what the box's YAML does around
// its display lambda: the actions become cards, cards wait in line, the one on screen
// has its time and gives way, timers count, questions wait for a tap, a touch moves on.
//
// Everything here is independent of the browser (the renderer, the figure, the weather
// icons and the picture overlay are handed in), so the tests drive it with fakes.
//
// Modes, as on the box: 0 status, 1 text, 2 value, 3 celebration, 4 weather, 5 photo,
// 6 event, 7 scene, 8 question, 9 route, 10 agenda, 11 timer, 12 info, 13 list.
import { CardQueue, Question, makeCard, NOW, questionButtonAt } from "./queue.js";
import { Timers } from "./timers.js";
import { clean, singleLine, temperature, parseDuration, parseAgenda, parseList, parseOptions, W_NONE } from "./text.js";
import { parseStatus, condition, urgentEvent } from "./tables.js";
import * as S from "./scene.js";
import { drawTopBar, drawCard } from "./cards.js";
import { SceneDrawer } from "./draw.js";

export const VERSION = "1.1.0";

export class Display {
  constructor(opts) {
    this.renderer = opts.renderer; // render.js Renderer
    this.figure = opts.figure; // figure.js Figure
    this.weather = opts.weather; // weather.js WeatherIcons
    this.media = opts.media; // media.js MediaOverlay
    this.now = opts.now || (() => performance.now()); // ms, monotonic
    this.clock = opts.clock || (() => new Date());
    this.name = opts.name || "Muse";
    this.onAnswer = opts.onAnswer || (() => {}); // (answer, question) when a touch answers
    this.sound = opts.sound || { ask() {}, chime() {} };
    this.log = opts.log || (() => {});
    this.demoMs = opts.demoMs || 0; // demo mode: every card stays this long instead of its own time
    this.version_string = VERSION;
    this.connection = "off"; // off, connecting, on, demo
    this.host = "";
    this.displayInfo = "";
    this.browserInfo = "";

    this.queue = new CardQueue();
    this.question = new Question();
    this.timers = new Timers();
    this.card = this.queue.current;
    this.version = 0; // counts up with every new content; the cards re-wrap text on change
    this.since = 0; // when the content appeared, and when the status returns
    this.until = 0;
    this.status = 0; // 0 ready, 1 listening, 2 thinking, 3 speaking, 4 error, 5 quiet, 6 greeting
    this.statusText = "";
    this.statusTextState = -1;
    this.labelState = -1;
    this.greetUntil = 0;
    this.errorUntil = 0;
    this.cuddleUntil = 0;
    this.animName = "";
    this.animSince = 0;
    this.scene = null; // the parsed scene on screen (mode 7)
    this.sceneCheck = null; // the response of the last draw
    this.sceneDrawer = new SceneDrawer(this.figure);
    this.paged = null;
    this.agenda = [];
    this.list = [];
    this.lastAnswer = "";
    this.answerCount = 0;
    this.touch = null; // {x0, y0, x1, y1, at}
    this.placedNow = false;
  }

  get mode() {
    return this.card.mode;
  }

  // ------------------------------------------------------------- the line --

  // Puts a card in line and shows it when its turn is now; the action's response.
  offer(card, urgent = false) {
    if (this.demoMs > 0 && card.mode !== 8 && card.mode !== 11) card.ms = this.demoMs;
    this.placedNow = this.queue.offer(card, urgent);
    if (this.placedNow) this.next();
    else this.log(`card waits, ${this.queue.waiting.length} in line`);
    return { on_screen: this.placedNow, waiting: this.queue.waiting.length };
  }

  // The next card of the line, or the status when none waits. A question that leaves
  // the screen unanswered is answered "none".
  next() {
    if (this.question.open && this.mode === 8) this.question.abandon((s) => this.publishAnswer(s));
    const c = this.queue.takeNext();
    if (c === null) {
      this.card = this.queue.current;
      this.media.hide();
      this.scene = null;
      return;
    }
    this.apply(c);
  }

  // The card before (a swipe to the right); the one on screen goes back to the front.
  prev() {
    if (this.question.open && this.mode === 8) this.question.abandon((s) => this.publishAnswer(s));
    const c = this.queue.takePrev();
    if (c === null) {
      this.log("nothing to go back to");
      return;
    }
    this.apply(c);
  }

  apply(c) {
    const now = this.now();
    this.card = c;
    this.version++;
    this.since = now;
    this.until = now + c.ms;
    this.media.hide();
    this.scene = null;
    if (c.mode === 7) this.scene = S.parse(c.scene);
    if (c.mode === 5) this.media.show(c.url, c.liveSeconds, Date.now());
    if (c.mode === 10) this.agenda = parseAgenda(c.body);
    if (c.mode === 13) this.list = parseList(c.body);
    this.log(`card ${c.mode} on screen, ${this.queue.waiting.length} waiting, ${this.queue.history.length} back`);
  }

  publishAnswer(text) {
    // "<answer>: <question>", the format of the box's sensor "Antwort".
    const at = text.indexOf(": ");
    this.lastAnswer = text;
    this.onAnswer(text.slice(0, at), text.slice(at + 2));
  }

  giveAnswer(answer, question) {
    this.lastAnswer = answer;
    this.answerCount++;
    this.onAnswer(answer, question);
  }

  // --------------------------------------------------------------- actions --

  setStatus(status) {
    this.status = parseStatus(status);
    this.statusText = "";
    if (this.status === 4) this.errorUntil = this.now() + 6000;
    return { status: this.status };
  }

  setStatusText(status, label) {
    this.status = parseStatus(status);
    this.statusText = singleLine(clean(label, 1).text);
    this.statusTextState = this.status;
    if (this.status === 4) this.errorUntil = this.now() + 6000;
    return { status: this.status };
  }

  showText(title, message) {
    const t = clean(title, 2), b = clean(message, 1);
    return this.offer(makeCard({ mode: 1, title: t.text, body: b.text, icon: b.icon !== W_NONE ? b.icon : t.icon, ms: 20000 }));
  }

  showValue(label, value, unit) {
    return this.offer(makeCard({ mode: 2, label: clean(label, 1).text, value: clean(value, 5).text, unit: clean(unit, 3).text, ms: 20000 }));
  }

  celebrate(title, message) {
    return this.offer(makeCard({ mode: 3, title: clean(title, 2).text, body: clean(message, 1).text, ms: 30000 }));
  }

  showWeather(cond, temp, message) {
    const w = condition(cond);
    const b = clean(message, 1);
    return this.offer(makeCard({
      mode: 4,
      icon: w ? w.icon : b.icon !== W_NONE ? b.icon : 4,
      label: w ? w.label : clean(cond, 1).text,
      value: temperature(temp),
      body: b.text,
      ms: 60000,
    }));
  }

  showEvent(icon, title, message) {
    const c = makeCard({ mode: 6, event: String(icon ?? ""), title: clean(title, 2).text, body: clean(message, 1).text, ms: 20000 });
    return this.offer(c, urgentEvent(c.event));
  }

  // A picture from a URL; without one, title and message show as an event card, with
  // the icon of the card it replaces, so a failed door photo still shows the doorbell.
  showImage(title, message, url) {
    const u = String(url ?? "").trim();
    const c = makeCard({ mode: u ? 5 : 6, title: clean(title, 2).text, body: clean(message, 1).text, url: u, ms: 90000 });
    const on = this.card;
    c.event = c.title && on.title === c.title && on.event ? on.event : "info";
    return this.offer(c);
  }

  showLive(title, url, seconds) {
    const s = Math.min(120, Math.max(5, Number(seconds) || 0));
    return this.offer(makeCard({ mode: 5, title: clean(title, 2).text, body: "Live", url: String(url ?? ""), event: "info",
      liveSeconds: s, ms: s * 1000 + 3000 }));
  }

  showRoute(title, from, to, mode) {
    const m = String(mode ?? "").trim().toLowerCase();
    const profile = ["bike", "fahrrad", "rad", "bicycle"].includes(m) ? "bike"
      : ["foot", "walk", "zu fuss", "zu fuß", "laufen", "gehen", "fuss"].includes(m) ? "foot" : "car";
    return this.offer(makeCard({ mode: 9, title: singleLine(clean(title, 1).text), from: String(from ?? ""), to: String(to ?? ""),
      profile, event: "info", ms: 60000 }));
  }

  showAgenda(title, events) {
    const body = clean(events, 1).text;
    const pages = Math.ceil(parseAgenda(body).length / 4);
    return this.offer(makeCard({ mode: 10, title: title ? singleLine(clean(title, 2).text) : "Heute", body,
      ms: Math.max(30000, pages * 8000 + 6000) }));
  }

  showList(title, items) {
    const body = clean(items, 1).text;
    const pages = Math.ceil(parseList(body).length / 5);
    return this.offer(makeCard({ mode: 13, title: title ? singleLine(clean(title, 2).text) : "Liste", body,
      ms: Math.max(30000, pages * 8000 + 6000) }));
  }

  // A scene of the assistant's own design; an empty scene ends the one on screen.
  draw(scene) {
    const src = String(scene ?? "");
    const r = S.parse(src);
    this.sceneCheck = r;
    if (!src.trim()) {
      if (this.mode === 7) this.next();
      return S.response(r);
    }
    const c = makeCard({ mode: 7, scene: src, ms: r.seconds * 1000 });
    if (this.demoMs > 0) c.ms = Math.min(c.ms, this.demoMs);
    const placement = this.mode === 7 ? "replace" : this.queue.place(c, false);
    if (this.queue.enqueue(c, placement)) this.next();
    return S.response(r);
  }

  // A yes/no question; it goes before every other card and stays 2 min.
  ask(question, yesLabel, noLabel) {
    const options = [
      yesLabel ? singleLine(clean(yesLabel, 3).text) : "Ja",
      noLabel ? singleLine(clean(noLabel, 3).text) : "Nein",
    ];
    return this.question_(clean(question, 2).text, options, ["yes", "no"]);
  }

  // A question with two to four answers, one per line of `options`.
  choose(question, options) {
    const opts = parseOptions(options);
    return this.question_(clean(question, 2).text, opts, opts);
  }

  question_(text, options, values) {
    this.question.prepare(this.mode, text, options, values, (s) => this.publishAnswer(s));
    const c = makeCard({ mode: 8, title: this.question.text, ms: 120000 });
    this.queue.enqueue(c, NOW);
    this.next();
    this.sound.ask();
    return { answer: "pending", question: text };
  }

  // A timer: a ring and the time left on a card that stays while it runs.
  showTimer(label, duration) {
    const secs = parseDuration(duration);
    if (secs === 0 || secs > 24 * 3600) {
      this.log(`timer: '${duration}' is no duration`);
      return { ok: false, seconds: 0, timers: this.timers.size };
    }
    const e = this.timers.add(singleLine(clean(label, 1).text), secs, this.now());
    this.timerCard();
    return { ok: true, seconds: e.total, timers: this.timers.size };
  }

  cancelTimer(label) {
    const n = this.timers.cancel(label);
    return { cancelled: n > 0, timers: this.timers.size };
  }

  timerCard() {
    const t = this.timers.soonest();
    if (!t) return;
    if (this.mode === 11) {
      this.version++;
      return;
    }
    this.queue.enqueue(makeCard({ mode: 11, title: t.name, ms: t.left * 1000 + 3000 }), NOW);
    this.next();
  }

  // A timer ended: the chime, and a card that says which one, for 30 s.
  timerDone(name) {
    if (this.mode === 11 && !this.timers.soonest()) {
      this.queue.current = makeCard({ mode: 0 });
      this.card = this.queue.current;
    }
    this.queue.enqueue(makeCard({ mode: 6, event: "timer", title: "Zeit ist um", body: name || "Timer", ms: 30000 }), NOW);
    this.next();
    this.sound.chime();
    this.log(`timer ended: ${name}`);
  }

  // Every card gone, the line emptied, the status back.
  clear() {
    const cleared = this.mode !== 0 || this.queue.waiting.length > 0;
    this.queue.clear();
    this.next();
    return { cleared };
  }

  getState() {
    return {
      mode: ["status", "text", "value", "celebration", "weather", "photo", "event", "scene", "question", "route",
        "agenda", "timer", "info", "list"][this.mode] || "?",
      title: this.card.title,
      waiting: this.queue.waiting.length,
      history: this.queue.history.length,
      question_open: this.question.open,
      last_answer: this.lastAnswer,
      status: this.status,
      timers: this.timers.size,
      version: VERSION,
    };
  }

  // The display about itself (a tap on the top bar), for 15 s.
  info() {
    if (this.mode === 12) return;
    this.queue.enqueue(makeCard({ mode: 12, title: "Muse Web Screen", ms: 15000 }), NOW);
    this.next();
  }

  // An action by name with its fields, as the box's actions are called.
  dispatch(action, f = {}) {
    const s = (k) => (f[k] === undefined || f[k] === null ? "" : String(f[k]));
    switch (action) {
      case "set_status": return this.setStatus(s("status"));
      case "set_status_text": return this.setStatusText(s("status"), s("label"));
      case "show_text": return this.showText(s("title"), s("message"));
      case "show_value": return this.showValue(s("label"), s("value"), s("unit"));
      case "celebrate": return this.celebrate(s("title"), s("message"));
      case "show_weather": return this.showWeather(s("condition"), s("temperature"), s("message"));
      case "show_event": return this.showEvent(s("icon"), s("title"), s("message"));
      case "show_image": return this.showImage(s("title"), s("message"), s("url"));
      case "show_live": return this.showLive(s("title"), s("url"), f.seconds);
      case "show_route": return this.showRoute(s("title"), s("from"), s("to"), s("mode"));
      case "show_agenda": return this.showAgenda(s("title"), s("events"));
      case "show_list": return this.showList(s("title"), s("items"));
      case "show_timer": return this.showTimer(s("label"), s("duration"));
      case "cancel_timer": return this.cancelTimer(s("label"));
      case "draw": return this.draw(s("scene"));
      case "ask": return this.ask(s("question"), s("yes_label"), s("no_label"));
      case "choose": return this.choose(s("question"), s("options"));
      case "clear": return this.clear();
      case "get_state": return this.getState();
      default:
        this.log(`unknown action ${action}`);
        return null;
    }
  }

  // ----------------------------------------------------------------- time --

  // Called before every picture (10 to 60 a second, the frame rate setting): cards that
  // had their time give way, timers count, the greeting and an error end. Everything
  // here goes by the clock, so the rate changes nothing but the smoothness.
  tick() {
    const now = this.now();
    if (this.mode !== 0 && now > this.until) {
      this.log(`card ${this.mode} gone after ${Math.round(now - this.since)} ms`);
      this.next();
    }
    const ended = this.timers.tick(now);
    if (ended) this.timerDone(ended);
    if (this.status === 6 && now > this.greetUntil) this.status = 0;
    if (this.status === 4 && now > this.errorUntil) this.status = 0;
    if (this.mode === 11 && !this.timers.soonest()) this.next();
  }

  // Waves once, like when someone steps in front of the box.
  greet() {
    if (this.status === 0) {
      this.status = 6;
      this.greetUntil = this.now() + 4000;
    }
  }

  // Draws the display: a scene fills the whole screen; everything else has the top bar.
  render() {
    const r = this.renderer;
    const now = this.now();
    const clock = this.clock();
    r.begin();
    if (this.mode === 7 && this.scene) {
      this.sceneDrawer.draw(r, this.scene, this.version, now - this.since, clock);
      return;
    }
    r.fill(S.PAGE);
    drawTopBar(r, this, now, clock);
    drawCard(r, this, now, clock);
  }

  // ---------------------------------------------------------------- touch --
  // The table of the box: tap, swipe left, right and down, long press, the top bar,
  // the buttons of a question or a scene.

  touchStart(x, y) {
    this.touch = { x0: x, y0: y, x1: x, y1: y, at: this.now() };
  }

  touchMove(x, y) {
    if (this.touch) {
      this.touch.x1 = x;
      this.touch.y1 = y;
    }
  }

  touchEnd() {
    const t = this.touch;
    if (!t) return;
    this.touch = null;
    const now = this.now();
    const held = now - t.at;
    const dx = t.x1 - t.x0, dy = t.y1 - t.y0;
    const mode = this.mode;
    const swipeLeft = dx < -60 && Math.abs(dx) > 2 * Math.abs(dy);
    const swipeRight = dx > 60 && Math.abs(dx) > 2 * Math.abs(dy);
    const swipeDown = dy > 60 && Math.abs(dy) > 2 * Math.abs(dx);
    this.log(`touch ${t.x0 | 0}, ${t.y0 | 0} -> ${t.x1 | 0}, ${t.y1 | 0} for ${held | 0} ms on mode ${mode}`);
    if (mode === 8) { // only the buttons answer
      const qs = this.question;
      const i = questionButtonAt(qs.options.length, t.x1, t.y1);
      if (i < 0) return;
      const a = qs.choose(i, (s) => this.publishAnswer(s));
      this.answerCount++;
      this.next();
      return a;
    }
    if (mode === 7 && held < 700 && this.scene) { // a button in a scene
      const st = now - this.since;
      const i = S.buttonAt(this.scene, t.x1, t.y1, st, this.scene.frameAt(st));
      if (i >= 0) {
        const a = this.scene.items[i].text;
        this.giveAnswer(a, "Szene");
        this.next();
        return a;
      }
    }
    if (swipeDown) {
      if (mode !== 0) {
        this.queue.clear();
        this.next();
      }
      return;
    }
    if (swipeRight) {
      this.prev();
      return;
    }
    if (swipeLeft) {
      if (mode !== 0) this.next();
      return;
    }
    if (held >= 700) {
      if (mode !== 0) {
        this.queue.clear();
        this.next();
      }
      return; // on the ready screen the box starts listening; this display has no microphone
    }
    if (t.y0 < 30 && mode !== 12) { // the top bar: the display about itself
      this.info();
      return;
    }
    if (mode !== 0) {
      this.next();
      return;
    }
    this.cuddleUntil = now + 2600;
    this.greet();
  }
}
