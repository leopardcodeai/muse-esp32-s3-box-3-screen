// queue.js: cards wait in line, as on the box (a port of the queue half of
// firmware/muse.h and of the scripts muse_next and muse_prev in muse-box.yaml).
//
// A new card waits while another is on screen, up to QUEUE_MAX; a tap shows the next.
// Some go first: a question, the doorbell, a voice conversation. A card with the title
// of the one on screen replaces it at once, so the door photo follows "Es klingelt"
// without a tap, and a scene replaces a scene. Cards that were on screen go into a
// history of HISTORY_MAX, which a swipe to the right walks back.
//
// Modes, as on the box: 0 status, 1 text, 2 value, 3 celebration, 4 weather, 5 photo,
// 6 event, 7 scene, 8 question, 9 route, 10 agenda, 11 timer, 12 info, 13 list.
export const QUEUE_MAX = 12;
export const HISTORY_MAX = 6;
export const MODES = ["status", "text", "value", "celebration", "weather", "photo", "event", "scene", "question",
  "route", "agenda", "timer", "info", "list"];

export const WAIT = "wait";
export const NOW = "now";
export const REPLACE = "replace";

export function makeCard(fields = {}) {
  return {
    mode: 1,
    title: "", body: "", label: "", value: "", unit: "", event: "", url: "", scene: "",
    from: "", to: "", profile: "", // a route
    icon: -1, // weather icon of a text or weather card
    ms: 20000, // time on screen
    liveSeconds: 0, // a photo that is a live view, refreshed for this long
    conv: false, // a voice conversation: never waits, never comes back
    ...fields,
  };
}

// Questions, conversations and the info card are not kept in the history.
export function keepable(c) {
  return c.mode !== 0 && c.mode !== 8 && c.mode !== 12 && !c.conv;
}

export class CardQueue {
  constructor() {
    this.waiting = []; // the line
    this.history = []; // cards that were on screen, newest last
    this.current = makeCard({ mode: 0 }); // the card on screen (mode 0: the status)
    this.requeued = false; // the card on screen went back into the line; take_next must not keep it
  }

  get showing() {
    return this.current.mode;
  }

  // Where a new card goes. `showing` is the mode on screen (0: the status, nothing waits).
  place(c, urgent = false) {
    const showing = this.showing;
    if (showing === 0) return NOW;
    if (c.title && c.title === this.current.title && showing !== 8) return REPLACE;
    return urgent ? NOW : WAIT;
  }

  // Puts the card in line as `placement` decided; true when the next card must be shown
  // now. A card that is pushed aside by an urgent one comes back first afterwards.
  enqueue(c, placement) {
    const showing = this.showing;
    if (placement === WAIT) {
      this.waiting.push(c);
      if (this.waiting.length > QUEUE_MAX) this.waiting.pop();
      return false;
    }
    if (placement === NOW && showing !== 0 && showing !== 8 && !this.current.conv) {
      this.waiting.unshift(this.current);
      this.requeued = true;
    }
    this.waiting.unshift(c);
    return true;
  }

  // Puts a card in line and says whether it went on screen at once (the action's response).
  offer(c, urgent = false) {
    return this.enqueue(c, this.place(c, urgent));
  }

  // Takes the next card of the line as the current one; the card on screen goes into
  // the history. Returns the new current card, or null when nothing waits (then the
  // status is on screen).
  takeNext() {
    if (this.showing !== 0 && keepable(this.current) && !this.requeued) {
      this.history.push(this.current);
      if (this.history.length > HISTORY_MAX) this.history.shift();
    }
    this.requeued = false;
    if (this.waiting.length === 0) {
      this.current = makeCard({ mode: 0 });
      return null;
    }
    this.current = this.waiting.shift();
    return this.current;
  }

  // Takes the last card of the history; the card on screen goes back to the front of
  // the line, so a swipe to the left returns to it. Null when there is none.
  takePrev() {
    if (this.history.length === 0) return null;
    if (this.showing !== 0 && keepable(this.current)) this.waiting.unshift(this.current);
    this.current = this.history.pop();
    return this.current;
  }

  // Every card gone, the line emptied (muse_clear, a swipe down, a long press).
  clear() {
    const dropped = this.waiting.length;
    this.waiting.length = 0;
    return dropped;
  }

  // A voice conversation pushes the card on screen aside; it comes back afterwards.
  startConversation(card) {
    if (this.showing !== 0 && this.showing !== 8 && !this.current.conv) this.waiting.unshift(this.current);
    this.current = makeCard({ ...card, conv: true });
    return this.current;
  }
}

// A question on screen (muse_ask, muse_choose): its options and what each answers.
export class Question {
  constructor() {
    this.number = 0;
    this.text = "";
    this.answer = "";
    this.options = [];
    this.values = [];
    this.open = false;
  }

  // Sets a new question up. One that is still open on screen is answered "none" first,
  // so its answer never carries the new question's text. `publish` gets "<answer>: <question>".
  prepare(showing, text, options, values, publish) {
    if (this.open && showing === 8) {
      this.open = false;
      this.answer = "none";
      publish("none: " + this.text);
    }
    this.number++;
    this.text = text;
    this.options = options;
    this.values = values;
    this.answer = "";
    this.open = true;
  }

  // The question leaves the screen unanswered.
  abandon(publish) {
    if (!this.open) return;
    this.open = false;
    this.answer = "none";
    publish("none: " + this.text);
  }

  // Button i was tapped.
  choose(i, publish) {
    this.answer = this.values[i];
    this.open = false;
    publish(this.answer + ": " + this.text);
    return this.answer;
  }
}

// Where button i of n lies on the question card: two options side by side, three or four
// in two rows. Used by the card and by the touch handler alike.
export function questionButton(n, i) {
  if (n <= 2) return { x: i === 0 ? 12 : 166, y: 160, w: 142, h: 66 };
  return { x: i % 2 === 0 ? 12 : 166, y: i < 2 ? 150 : 194, w: 142, h: 40 };
}

export function questionButtonAt(n, px, py) {
  for (let i = 0; i < n && i < 4; i++) {
    const b = questionButton(n, i);
    if (px >= b.x && px < b.x + b.w && py >= b.y && py < b.y + b.h) return i;
  }
  return -1;
}
