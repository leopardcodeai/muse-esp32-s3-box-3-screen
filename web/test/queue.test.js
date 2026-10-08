// queue.test.js: cards wait in line as on the box.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CardQueue, Question, makeCard, keepable, questionButton, questionButtonAt, QUEUE_MAX, HISTORY_MAX, WAIT, NOW, REPLACE } from "../queue.js";

const card = (mode, title, extra = {}) => makeCard({ mode, title, ...extra });

test("a card goes on screen when nothing shows, waits behind the one on screen", () => {
  const q = new CardQueue();
  assert.equal(q.place(card(1, "a")), NOW);
  assert.equal(q.offer(card(1, "a")), true);
  assert.equal(q.takeNext().title, "a");
  assert.equal(q.showing, 1);
  assert.equal(q.place(card(1, "b")), WAIT);
  assert.equal(q.offer(card(1, "b")), false);
  assert.equal(q.waiting.length, 1);
  assert.equal(q.takeNext().title, "b");
  assert.deepEqual(q.history.map((c) => c.title), ["a"]);
  assert.equal(q.takeNext(), null);
  assert.equal(q.showing, 0);
  assert.deepEqual(q.history.map((c) => c.title), ["a", "b"]);
});

test("the line holds twelve; the thirteenth is dropped", () => {
  const q = new CardQueue();
  q.offer(card(1, "on"));
  q.takeNext();
  for (let i = 0; i < 20; i++) q.offer(card(1, `w${i}`));
  assert.equal(q.waiting.length, QUEUE_MAX);
  assert.equal(q.waiting[QUEUE_MAX - 1].title, "w11");
});

test("a question, the doorbell and a conversation go first; the card on screen comes back", () => {
  const q = new CardQueue();
  q.offer(card(1, "text"));
  q.takeNext();
  q.offer(card(1, "later"));
  assert.equal(q.place(card(6, "Es klingelt"), true), NOW);
  assert.equal(q.offer(card(6, "Es klingelt"), true), true);
  assert.equal(q.takeNext().title, "Es klingelt");
  assert.deepEqual(q.waiting.map((c) => c.title), ["text", "later"], "the pushed-aside card is first in line");
  assert.deepEqual(q.history, [], "it is not in the history as well");
  assert.equal(q.takeNext().title, "text");
  assert.deepEqual(q.history.map((c) => c.title), ["Es klingelt"]);
  // A question
  q.enqueue(card(8, "Frage?"), NOW);
  assert.equal(q.takeNext().title, "Frage?");
  assert.deepEqual(q.waiting.map((c) => c.title), ["text", "later"]);
  // Another urgent card while the question shows does not push the question into the line
  q.enqueue(card(6, "Es klingelt"), NOW);
  assert.equal(q.takeNext().title, "Es klingelt");
  assert.deepEqual(q.waiting.map((c) => c.title), ["text", "later"]);
  assert.ok(!q.history.some((c) => c.mode === 8), "questions are not kept");
  // A conversation
  const conv = q.startConversation(card(1, "Wie spät?"));
  assert.ok(conv.conv);
  assert.deepEqual(q.waiting.map((c) => c.title), ["Es klingelt", "text", "later"]);
  assert.equal(q.place(card(1, "x"), true), NOW);
  q.enqueue(card(1, "x"), NOW);
  assert.equal(q.waiting[0].title, "x", "a conversation never goes back into the line");
  assert.equal(q.waiting[1].title, "Es klingelt");
});

test("a card with the title of the one on screen replaces it at once", () => {
  const q = new CardQueue();
  q.offer(card(6, "Es klingelt", { event: "klingel" }));
  q.takeNext();
  q.offer(card(1, "other"));
  assert.equal(q.place(card(5, "Es klingelt")), REPLACE);
  assert.equal(q.offer(card(5, "Es klingelt")), true);
  assert.equal(q.takeNext().mode, 5);
  assert.deepEqual(q.waiting.map((c) => c.title), ["other"]);
  assert.deepEqual(q.history.map((c) => c.mode), [6]);
  // but never a question
  q.enqueue(card(8, "Frage?"), NOW);
  q.takeNext();
  assert.equal(q.place(card(1, "Frage?")), WAIT);
});

test("the history keeps six; a swipe back returns the card and re-lines the one on screen", () => {
  const q = new CardQueue();
  for (let i = 0; i < 9; i++) {
    q.offer(card(1, `c${i}`));
    q.takeNext();
  }
  assert.equal(q.history.length, HISTORY_MAX);
  assert.deepEqual(q.history.map((c) => c.title), ["c2", "c3", "c4", "c5", "c6", "c7"]);
  assert.equal(q.takePrev().title, "c7");
  assert.deepEqual(q.waiting.map((c) => c.title), ["c8"]);
  assert.equal(q.takePrev().title, "c6");
  assert.deepEqual(q.waiting.map((c) => c.title), ["c7", "c8"]);
  assert.equal(q.takeNext().title, "c7");
  assert.deepEqual(q.history.map((c) => c.title), ["c2", "c3", "c4", "c5", "c6"]);
  const empty = new CardQueue();
  assert.equal(empty.takePrev(), null);
});

test("keepable: the status, questions, the info card and conversations stay out of the history", () => {
  assert.ok(keepable(card(1, "a")));
  assert.ok(!keepable(card(0, "")));
  assert.ok(!keepable(card(8, "?")));
  assert.ok(!keepable(card(12, "info")));
  assert.ok(!keepable(card(1, "a", { conv: true })));
});

test("clear() empties the line and says how many were dropped", () => {
  const q = new CardQueue();
  q.offer(card(1, "a"));
  q.takeNext();
  q.offer(card(1, "b"));
  q.offer(card(1, "c"));
  assert.equal(q.clear(), 2);
  assert.equal(q.takeNext(), null);
});

test("questions: a new one answers an open one with none; buttons answer by value", () => {
  const q = new Question();
  const published = [];
  q.prepare(0, "Licht an?", ["Ja", "Nein"], ["yes", "no"], (s) => published.push(s));
  assert.ok(q.open);
  q.prepare(8, "Musik?", ["Jazz", "Rock"], ["Jazz", "Rock"], (s) => published.push(s));
  assert.deepEqual(published, ["none: Licht an?"]);
  assert.equal(q.choose(1, (s) => published.push(s)), "Rock");
  assert.ok(!q.open);
  assert.deepEqual(published, ["none: Licht an?", "Rock: Musik?"]);
  q.abandon((s) => published.push(s));
  assert.equal(published.length, 2, "a closed question is not abandoned twice");
  assert.deepEqual(questionButton(2, 1), { x: 166, y: 160, w: 142, h: 66 });
  assert.deepEqual(questionButton(4, 3), { x: 166, y: 194, w: 142, h: 40 });
  assert.equal(questionButtonAt(2, 20, 170), 0);
  assert.equal(questionButtonAt(2, 300, 220), 1);
  assert.equal(questionButtonAt(2, 160, 100), -1);
  assert.equal(questionButtonAt(3, 20, 200), 2);
  assert.equal(questionButtonAt(3, 200, 200), -1, "the fourth button of three does not exist");
});
