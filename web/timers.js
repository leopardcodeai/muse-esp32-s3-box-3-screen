// timers.js: the display's own timers (muse_show_timer), counted by the clock of the
// page, as the box counts its own by millis() (firmware/muse.h "timers"). The card
// shows the one that ends first; when one ends, the chime plays and a card says so.
export class Timers {
  constructor() {
    this.list = [];
    this.serial = 0;
  }

  // Adds a timer of `seconds`; `now` is the page's clock in ms.
  add(name, seconds, now) {
    const e = {
      id: "local-" + ++this.serial,
      name: name || "Timer",
      total: seconds,
      left: seconds,
      endMs: now + seconds * 1000,
    };
    this.list.push(e);
    return e;
  }

  // Recounts the timers; returns the name of one that just ended, or "" (each ended
  // timer is reported once and then removed).
  tick(now) {
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      const ms = e.endMs - now;
      e.left = ms > 0 ? Math.floor((ms + 999) / 1000) : 0;
      if (ms <= 0) {
        this.list.splice(i, 1);
        return e.name;
      }
    }
    return "";
  }

  soonest() {
    let best = null;
    for (const e of this.list) if (best === null || e.left < best.left) best = e;
    return best;
  }

  // Cancels all timers with `label` empty, else those with that name; returns how many.
  cancel(label) {
    const want = String(label ?? "").trim().toLowerCase();
    const before = this.list.length;
    this.list = this.list.filter((e) => !(want === "" || e.name.toLowerCase() === want));
    return before - this.list.length;
  }

  get size() {
    return this.list.length;
  }
}
