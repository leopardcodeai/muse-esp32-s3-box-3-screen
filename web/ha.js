// ha.js: the connection to Home Assistant over its websocket API.
//
// The display mirrors the box: it subscribes to `call_service` events and reacts to
// every call of the esphome domain whose service starts with "<device>_muse_", using the
// call's service_data as the action's fields. That way every card the assistant sends
// to the box appears here as well, without any change in Home Assistant. A second
// subscription to the event type `muse_web` lets a house without a box, or an
// automation, address this display directly ({action: "show_text", ...fields}).
// Answers go back as the event `muse_web_answer` {answer, question}, and, when the
// settings name an input_text entity, as input_text.set_value with "<answer>: <question>".
//
// Pitfalls:
//  * The token is sent once in the auth message and never logged; it comes from
//    localStorage of this browser (app.js), nowhere else.
//  * A service call that fails (the box is off) still produces the call_service event;
//    that is on purpose: the Mac shows the card even when the box does not.
//  * Reconnects back off from 1 s to 30 s; `onState` reports off, connecting, on.
export const EVENT_WEB = "muse_web";
export const EVENT_ANSWER = "muse_web_answer";

// The websocket URL for a Home Assistant base URL.
export function websocketUrl(base) {
  const u = String(base || "").trim().replace(/\/+$/, "");
  const m = u.match(/^(https?):\/\/(.*)$/i);
  if (!m) return null;
  return `${m[1].toLowerCase() === "https" ? "wss" : "ws"}://${m[2]}/api/websocket`;
}

// A call_service event's data to {action, fields}, or null when it is not for the
// box: domain esphome, service "<device>_muse_<action>", service_data the fields.
export function mapCallService(data, device = "muse_box") {
  if (!data || data.domain !== "esphome" || typeof data.service !== "string") return null;
  const prefix = `${device}_muse_`;
  if (!data.service.startsWith(prefix)) return null;
  const action = data.service.slice(prefix.length);
  if (!action) return null;
  const fields = data.service_data && typeof data.service_data === "object" ? { ...data.service_data } : {};
  delete fields.entity_id;
  return { action, fields };
}

// A muse_web event's data to {action, fields}: {action: "show_text", ...fields}.
export function mapMuseWeb(data) {
  if (!data || typeof data.action !== "string") return null;
  const { action, ...fields } = data;
  return { action: action.replace(/^muse_/, ""), fields };
}

// One websocket message of Home Assistant to the action it carries, or null.
export function mapMessage(msg, device = "muse_box") {
  if (!msg || msg.type !== "event" || !msg.event) return null;
  if (msg.event.event_type === "call_service") return mapCallService(msg.event.data, device);
  if (msg.event.event_type === EVENT_WEB) return mapMuseWeb(msg.event.data);
  return null;
}

export class HaClient {
  constructor(opts) {
    this.url = opts.url;
    this.token = opts.token;
    this.device = opts.device || "muse_box";
    this.onAction = opts.onAction || (() => {}); // ({action, fields})
    this.onState = opts.onState || (() => {}); // ("off" | "connecting" | "on", detail)
    this.log = opts.log || (() => {});
    this.WebSocketImpl = opts.WebSocketImpl || (typeof WebSocket !== "undefined" ? WebSocket : null);
    this.setTimeoutImpl = opts.setTimeout || ((f, ms) => setTimeout(f, ms));
    this.clearTimeoutImpl = opts.clearTimeout || ((h) => clearTimeout(h));
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map(); // id -> {resolve, reject}
    this.subscriptions = new Set();
    this.backoff = 1000;
    this.retry = null;
    this.closed = true;
    this.authenticated = false;
  }

  connect() {
    this.closed = false;
    this.open();
  }

  open() {
    const url = websocketUrl(this.url);
    if (!url || !this.WebSocketImpl) {
      this.onState("off", "no URL");
      return;
    }
    this.onState("connecting");
    this.authenticated = false;
    let ws;
    try {
      ws = new this.WebSocketImpl(url);
    } catch (e) {
      this.onState("off", String(e));
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {};
    ws.onmessage = (ev) => this.receive(ev.data);
    ws.onerror = () => {};
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.authenticated = false;
      for (const p of this.pending.values()) p.reject(new Error("connection closed"));
      this.pending.clear();
      this.onState("off", "closed");
      this.scheduleRetry();
    };
  }

  scheduleRetry() {
    if (this.closed || this.retry) return;
    const wait = this.backoff;
    this.backoff = Math.min(30000, this.backoff * 2);
    this.retry = this.setTimeoutImpl(() => {
      this.retry = null;
      if (!this.closed) this.open();
    }, wait);
  }

  close() {
    this.closed = true;
    if (this.retry) {
      this.clearTimeoutImpl(this.retry);
      this.retry = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws) ws.close();
    this.onState("off", "closed by the page");
  }

  send(obj) {
    if (!this.ws) return;
    this.ws.send(JSON.stringify(obj));
  }

  // A command with an id; resolves with the result message.
  command(obj) {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this.authenticated) {
        reject(new Error("not connected"));
        return;
      }
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.send({ id, ...obj });
    });
  }

  async receive(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === "auth_required") {
      this.send({ type: "auth", access_token: this.token });
      return;
    }
    if (msg.type === "auth_invalid") {
      this.log("auth invalid: " + (msg.message || ""));
      this.onState("off", "auth invalid");
      this.closed = true; // a wrong token is not retried; the person fixes the settings
      if (this.ws) this.ws.close();
      return;
    }
    if (msg.type === "auth_ok") {
      this.authenticated = true;
      this.backoff = 1000;
      this.onState("on", msg.ha_version);
      try {
        await this.command({ type: "subscribe_events", event_type: "call_service" });
        await this.command({ type: "subscribe_events", event_type: EVENT_WEB });
      } catch (e) {
        this.log("subscribe failed: " + e.message);
      }
      return;
    }
    if (msg.type === "result" && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.success) p.resolve(msg.result);
      else p.reject(new Error(msg.error ? msg.error.message : "failed"));
      return;
    }
    if (msg.type === "event") {
      const a = mapMessage(msg, this.device);
      if (a) this.onAction(a);
    }
  }

  fireEvent(type, data) {
    return this.command({ type: "fire_event", event_type: type, event_data: data });
  }

  callService(domain, service, data) {
    return this.command({ type: "call_service", domain, service, service_data: data });
  }

  // An answer a touch gave: the event, and the input_text when one is named.
  async answer(answer, question, inputText = "") {
    const jobs = [this.fireEvent(EVENT_ANSWER, { answer, question })];
    if (inputText) jobs.push(this.callService("input_text", "set_value", { entity_id: inputText, value: `${answer}: ${question}`.slice(0, 255) }));
    return Promise.allSettled(jobs);
  }
}
