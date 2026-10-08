// ha.test.js: the event mapping and the websocket client, with fake messages only.
// No token of anyone is used here: the fake server accepts "test-token".
import { test } from "node:test";
import assert from "node:assert/strict";
import { HaClient, mapCallService, mapMuseWeb, mapMessage, websocketUrl, socketOptions, EVENT_WEB, EVENT_ANSWER, DEFAULT_DEVICE } from "../ha.js";

const D = DEFAULT_DEVICE;

test("websocketUrl(): http and https, trailing slashes", () => {
  assert.equal(websocketUrl("http://homeassistant.local:8123"), "ws://homeassistant.local:8123/api/websocket");
  assert.equal(websocketUrl("https://ha.example.ts.net/"), "wss://ha.example.ts.net/api/websocket");
  assert.equal(websocketUrl("homeassistant.local"), null);
  assert.equal(websocketUrl(""), null);
});

test("the device name is the box's ESPHome name with underscores", () => {
  assert.equal(DEFAULT_DEVICE, "muse_esp32boxs3_screen");
  assert.equal(DEFAULT_DEVICE, "muse-esp32boxs3-screen".replaceAll("-", "_"));
});

test("mapCallService(): only esphome calls of <device>_muse_*", () => {
  assert.deepEqual(mapCallService({ domain: "esphome", service: `${D}_muse_show_text`, service_data: { title: "a", message: "b" } }),
    { action: "show_text", fields: { title: "a", message: "b" } });
  assert.deepEqual(mapCallService({ domain: "esphome", service: "kueche_muse_draw", service_data: { scene: "bg red" } }, "kueche"),
    { action: "draw", fields: { scene: "bg red" } });
  assert.equal(mapCallService({ domain: "esphome", service: "other_box_muse_show_text", service_data: {} }), null);
  assert.equal(mapCallService({ domain: "light", service: "turn_on", service_data: {} }), null);
  assert.equal(mapCallService({ domain: "esphome", service: `${D}_muse_`, service_data: {} }), null);
  assert.deepEqual(mapCallService({ domain: "esphome", service: `${D}_muse_clear` }), { action: "clear", fields: {} });
  // the box's old name is no longer the default
  assert.equal(mapCallService({ domain: "esphome", service: "muse_box_muse_clear" }), null);
  assert.equal(mapCallService(null), null);
});

test("mapMuseWeb() and mapMessage()", () => {
  assert.deepEqual(mapMuseWeb({ action: "show_text", title: "a", message: "b" }), { action: "show_text", fields: { title: "a", message: "b" } });
  assert.deepEqual(mapMuseWeb({ action: "muse_show_value", label: "l", value: "1", unit: "u" }), { action: "show_value", fields: { label: "l", value: "1", unit: "u" } });
  assert.equal(mapMuseWeb({ title: "no action" }), null);
  assert.deepEqual(mapMessage({ type: "event", event: { event_type: "call_service", data: { domain: "esphome", service: `${D}_muse_celebrate`, service_data: { title: "t", message: "m" } } } }),
    { action: "celebrate", fields: { title: "t", message: "m" } });
  assert.deepEqual(mapMessage({ type: "event", event: { event_type: EVENT_WEB, data: { action: "clear" } } }), { action: "clear", fields: {} });
  assert.equal(mapMessage({ type: "event", event: { event_type: "state_changed", data: {} } }), null);
  assert.equal(mapMessage({ type: "result", success: true }), null);
});

// A fake Home Assistant: answers the auth flow and the commands, and can push events.
class FakeSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.readyState = 0;
    FakeSocket.instances.push(this);
    queueMicrotask(() => this.message({ type: "auth_required", ha_version: "2026.9.4" }));
  }
  message(obj) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  send(raw) {
    const msg = JSON.parse(raw);
    this.sent.push(msg);
    if (msg.type === "auth") {
      queueMicrotask(() => this.message(msg.access_token === "test-token" ? { type: "auth_ok", ha_version: "2026.9.4" }
        : { type: "auth_invalid", message: "Invalid access token" }));
    } else if (msg.id) {
      queueMicrotask(() => this.message({ id: msg.id, type: "result", success: true, result: null }));
    }
  }
  close() {
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.({}));
  }
}

const settle = () => new Promise((r) => setTimeout(r, 5));

test("the client authenticates, subscribes to both event types and maps events to actions", async () => {
  FakeSocket.instances = [];
  const actions = [];
  const states = [];
  const c = new HaClient({ url: "http://ha.local:8123", token: "test-token", device: D, WebSocketImpl: FakeSocket,
    onAction: (a) => actions.push(a), onState: (s) => states.push(s), setTimeout: () => 0, clearTimeout: () => {} });
  c.connect();
  await settle();
  const ws = FakeSocket.instances[0];
  assert.equal(ws.url, "ws://ha.local:8123/api/websocket");
  assert.deepEqual(ws.sent[0], { type: "auth", access_token: "test-token" });
  assert.deepEqual(ws.sent.slice(1), [
    { id: 1, type: "subscribe_events", event_type: "call_service" },
    { id: 2, type: "subscribe_events", event_type: EVENT_WEB },
  ]);
  assert.deepEqual(states, ["connecting", "on"]);
  ws.message({ id: 1, type: "event", event: { event_type: "call_service", data: { domain: "esphome", service: `${D}_muse_show_text`, service_data: { title: "a", message: "b" } } } });
  ws.message({ id: 1, type: "event", event: { event_type: "call_service", data: { domain: "light", service: "turn_on", service_data: {} } } });
  ws.message({ id: 2, type: "event", event: { event_type: EVENT_WEB, data: { action: "show_value", label: "l", value: "2", unit: "" } } });
  assert.deepEqual(actions, [
    { action: "show_text", fields: { title: "a", message: "b" } },
    { action: "show_value", fields: { label: "l", value: "2", unit: "" } },
  ]);
  await c.answer("yes", "Licht an?", "input_text.muse_web_answer");
  const fired = ws.sent.find((m) => m.type === "fire_event");
  assert.deepEqual(fired, { id: 3, type: "fire_event", event_type: EVENT_ANSWER, event_data: { answer: "yes", question: "Licht an?" } });
  const service = ws.sent.find((m) => m.type === "call_service");
  assert.deepEqual(service, { id: 4, type: "call_service", domain: "input_text", service: "set_value",
    service_data: { entity_id: "input_text.muse_web_answer", value: "yes: Licht an?" } });
  c.close();
  await settle();
  assert.equal(states[states.length - 1], "off");
});

test("a wrong token stops the retries; a closed connection retries with backoff", async () => {
  FakeSocket.instances = [];
  const states = [];
  const timers = [];
  const bad = new HaClient({ url: "http://ha.local:8123", token: "wrong", WebSocketImpl: FakeSocket,
    onState: (s, d) => states.push([s, d]), setTimeout: (f, ms) => { timers.push(ms); return 1; }, clearTimeout: () => {} });
  bad.connect();
  await settle();
  assert.ok(states.some(([s, d]) => s === "off" && d === "auth invalid"));
  assert.ok(bad.closed, "no retry with a wrong token");
  assert.deepEqual(timers, []);

  FakeSocket.instances = [];
  let retry = null;
  const good = new HaClient({ url: "http://ha.local:8123", token: "test-token", WebSocketImpl: FakeSocket,
    onState: () => {}, setTimeout: (f, ms) => { timers.push(ms); retry = f; return 1; }, clearTimeout: () => {} });
  good.connect();
  await settle();
  FakeSocket.instances[0].onclose({});
  await settle();
  assert.deepEqual(timers, [1000], "the first retry after 1 s");
  retry(); // the retry fires: a new socket, auth ok, the backoff starts over
  await settle();
  assert.ok(good.authenticated);
  FakeSocket.instances[1].onclose({});
  await settle();
  assert.deepEqual(timers, [1000, 1000], "the backoff resets after a successful auth");
  // A server that drops the connection before auth: the waits double up to 30 s.
  FakeSocket.instances = [];
  timers.length = 0;
  const flaky = new HaClient({ url: "http://ha.local:8123", token: "test-token", WebSocketImpl: FakeSocket,
    onState: () => {}, setTimeout: (f, ms) => { timers.push(ms); retry = f; return 1; }, clearTimeout: () => {} });
  flaky.connect();
  for (let i = 0; i < 7; i++) {
    const ws = FakeSocket.instances[FakeSocket.instances.length - 1];
    ws.onmessage = null; // no auth ever arrives
    ws.onclose({});
    retry();
  }
  assert.deepEqual(timers, [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  flaky.closed = true;
  good.closed = true;
});

test("socketOptions(): the local hint only where an https page needs it", () => {
  const hint = { targetAddressSpace: "local" };
  assert.deepEqual(socketOptions("ws://homeassistant.example.ts.net:8123/api/websocket", "https:"), hint);
  assert.deepEqual(socketOptions("ws://ha.example.com/api/websocket", "https:"), hint);
  // IP literals and .local names are recognised by the browser itself; this machine is secure anyway
  assert.equal(socketOptions("ws://192.168.0.10:8123/api/websocket", "https:"), null);
  assert.equal(socketOptions("ws://[fd00::1]:8123/api/websocket", "https:"), null);
  assert.equal(socketOptions("ws://homeassistant.local:8123/api/websocket", "https:"), null);
  assert.equal(socketOptions("ws://localhost:8123/api/websocket", "https:"), null);
  // wss needs nothing, and an http page has no mixed content
  assert.equal(socketOptions("wss://ha.example.com/api/websocket", "https:"), null);
  assert.equal(socketOptions("ws://ha.example.com/api/websocket", "http:"), null);
});

test("an https page passes the hint, and a browser without WebSocketInit gets the plain socket", async () => {
  const made = [];
  class OldSocket extends FakeSocket {
    constructor(url, protocols) {
      if (protocols !== undefined && typeof protocols === "object") {
        const e = new Error("The subprotocol '[object Object]' is invalid.");
        e.name = "SyntaxError";
        throw e;
      }
      super(url);
      made.push([url, protocols]);
    }
  }
  class NewSocket extends FakeSocket {
    constructor(url, options) {
      super(url);
      made.push([url, options]);
    }
  }
  const run = async (Impl) => {
    FakeSocket.instances = [];
    made.length = 0;
    const c = new HaClient({ url: "http://ha.example.com:8123", token: "test-token", pageProtocol: "https:", WebSocketImpl: Impl,
      onState: () => {}, setTimeout: () => 0, clearTimeout: () => {} });
    c.connect();
    await settle();
    const ok = c.authenticated;
    c.close();
    await settle();
    return ok;
  };
  assert.ok(await run(NewSocket));
  assert.deepEqual(made, [["ws://ha.example.com:8123/api/websocket", { targetAddressSpace: "local" }]]);
  assert.ok(await run(OldSocket), "falls back to the plain constructor");
  assert.deepEqual(made, [["ws://ha.example.com:8123/api/websocket", undefined]]);
});
