// tables.js: the words the box understands for a status, a weather condition and an
// event icon (a port of parse_status, condition and event in firmware/muse.h).
import { W } from "./text.js";

// Status words to the status number: 0 ready, 1 listening, 2 thinking, 3 speaking,
// 4 error, 5 quiet, 6 greeting; anything else is 0. German words are accepted too.
const STATES = {
  ready: 0, bereit: 0,
  listening: 1, hoert: 1, "hört": 1,
  thinking: 2, working: 2, denkt: 2, arbeitet: 2,
  speaking: 3, spricht: 3,
  error: 4, fehler: 4,
  off: 5, aus: 5, ruhe: 5,
};
export function parseStatus(raw) {
  const k = String(raw ?? "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(STATES, k) ? STATES[k] : 0;
}

// The status pill: its default text and its dot's colour, by status number.
export const PILLS = [
  { text: "Bereit", color: [52, 199, 89] },
  { text: "Ich höre zu …", color: [10, 132, 255] },
  { text: "Ich denke nach …", color: [255, 159, 10] },
  { text: "Ich antworte …", color: [191, 90, 242] },
  { text: "Da ging etwas schief", color: [255, 69, 58] },
  { text: "Ruhe", color: [142, 142, 147] },
  { text: "Hallo!", color: [48, 176, 199] },
];

// Home Assistant's weather conditions, plus the words an assistant may use instead.
// Longer keys win when a word is only part of the text.
const CONDITIONS = [
  ["sunny", W.CLEAR_DAY, "Sonnig"],
  ["clear-night", W.CLEAR_NIGHT, "Klar"],
  ["partlycloudy", W.PARTLY_DAY, "Teils bewölkt"],
  ["partlycloudy-night", W.PARTLY_NIGHT, "Teils bewölkt"],
  ["cloudy", W.CLOUDY, "Bewölkt"],
  ["fog", W.FOG, "Nebel"],
  ["rainy", W.RAIN, "Regen"],
  ["pouring", W.EXTREME_RAIN, "Starkregen"],
  ["lightning", W.THUNDER, "Gewitter"],
  ["lightning-rainy", W.THUNDER_RAIN, "Gewitter mit Regen"],
  ["snowy", W.SNOW, "Schnee"],
  ["snowy-rainy", W.SLEET, "Schneeregen"],
  ["hail", W.HAIL, "Hagel"],
  ["windy", W.WIND, "Windig"],
  ["windy-variant", W.WIND, "Windig und bewölkt"],
  ["exceptional", W.TORNADO, "Unwetter"],
  ["sonnig", W.CLEAR_DAY, "Sonnig"],
  ["sonne", W.CLEAR_DAY, "Sonnig"],
  ["heiter", W.PARTLY_DAY, "Heiter"],
  ["klar", W.CLEAR_NIGHT, "Klar"],
  ["teils bewölkt", W.PARTLY_DAY, "Teils bewölkt"],
  ["teilweise bewölkt", W.PARTLY_DAY, "Teils bewölkt"],
  ["bewölkt", W.CLOUDY, "Bewölkt"],
  ["wolkig", W.CLOUDY, "Wolkig"],
  ["bedeckt", W.OVERCAST, "Bedeckt"],
  ["nebel", W.FOG, "Nebel"],
  ["niesel", W.DRIZZLE, "Nieselregen"],
  ["regen", W.RAIN, "Regen"],
  ["starkregen", W.EXTREME_RAIN, "Starkregen"],
  ["schauer", W.SHOWERS, "Schauer"],
  ["gewitter", W.THUNDER_RAIN, "Gewitter"],
  ["schnee", W.SNOW, "Schnee"],
  ["schneeregen", W.SLEET, "Schneeregen"],
  ["hagel", W.HAIL, "Hagel"],
  ["wind", W.WIND, "Windig"],
  ["sturm", W.WIND, "Sturm"],
  ["unwetter", W.TORNADO, "Unwetter"],
  ["sun", W.CLEAR_DAY, "Sonnig"],
  ["clear", W.CLEAR_DAY, "Klar"],
  ["partly cloudy", W.PARTLY_DAY, "Teils bewölkt"],
  ["overcast", W.OVERCAST, "Bedeckt"],
  ["drizzle", W.DRIZZLE, "Nieselregen"],
  ["rain", W.RAIN, "Regen"],
  ["shower", W.SHOWERS, "Schauer"],
  ["thunder", W.THUNDER_RAIN, "Gewitter"],
  ["snow", W.SNOW, "Schnee"],
  ["sleet", W.SLEET, "Schneeregen"],
].map(([key, icon, label]) => ({ key, icon, label }));

export function condition(raw) {
  const k = String(raw ?? "").trim().toLowerCase();
  for (const c of CONDITIONS) if (k === c.key) return c;
  let best = null;
  let bestLen = 0;
  for (const c of CONDITIONS) {
    if (c.key.length > bestLen && k.includes(c.key)) {
      best = c;
      bestLen = c.key.length;
    }
  }
  return best;
}

// Event icons: a glyph of the Material Design Icons font on a coloured disc.
const EVENTS = [
  ["klingel", 0xF009E, [255, 149, 0]],
  ["garage", 0xF12D4, [0, 122, 255]],
  ["garage_zu", 0xF12D3, [0, 122, 255]],
  ["rollladen_runter", 0xF111C, [88, 86, 214]],
  ["rollladen_hoch", 0xF111E, [88, 86, 214]],
  ["mail", 0xF01EE, [0, 122, 255]],
  ["kalender", 0xF00F0, [255, 45, 85]],
  ["muell", 0xF0A79, [52, 199, 89]],
  ["tv_an", 0xF0502, [175, 82, 222]],
  ["tv_aus", 0xF083B, [142, 142, 147]],
  ["zuhause", 0xF0826, [48, 176, 199]],
  ["briefkasten", 0xF0D8D, [255, 149, 0]],
  ["tuer", 0xF081C, [162, 132, 94]],
  ["nachrichten", 0xF1001, [255, 59, 48]],
  ["licht", 0xF06E8, [255, 159, 10]],
  ["solar", 0xF0A72, [255, 159, 10]],
  ["timer", 0xF051B, [255, 149, 0]],
  ["erledigt", 0xF05E0, [52, 199, 89]],
  ["info", 0xF02FC, [142, 142, 147]],
].map(([key, glyph, color]) => ({ key, glyph, color }));
const EVENT_ALIASES = {
  doorbell: "klingel", bell: "klingel", garage_open: "garage", garage_closed: "garage_zu",
  rolladen_runter: "rollladen_runter", rolladen_hoch: "rollladen_hoch", shutter_down: "rollladen_runter",
  shutter_up: "rollladen_hoch", email: "mail", e_mail: "mail", calendar: "kalender", termin: "kalender",
  trash: "muell", abfall: "muell", tv_on: "tv_an", fernseher_an: "tv_an", tv_off: "tv_aus",
  fernseher_aus: "tv_aus", home: "zuhause", heimkommen: "zuhause", mailbox: "briefkasten", post: "briefkasten",
  door: "tuer", news: "nachrichten", light: "licht", pv: "solar", done: "erledigt", ok: "erledigt",
};

// Normalise an event name: lower case, spaces and dashes to underscores, umlauts spelt out.
export function eventKey(raw) {
  let k = "";
  for (const ch of String(raw ?? "").trim().toLowerCase()) {
    if (ch === "ä") k += "ae";
    else if (ch === "ö") k += "oe";
    else if (ch === "ü") k += "ue";
    else if (ch === "ß") k += "ss";
    else if (ch >= "À" && ch <= "ÿ") continue;
    else k += ch === " " || ch === "-" ? "_" : ch;
  }
  return Object.prototype.hasOwnProperty.call(EVENT_ALIASES, k) ? EVENT_ALIASES[k] : k;
}

export function event(raw) {
  const k = eventKey(raw);
  return EVENTS.find((e) => e.key === k) || EVENTS[EVENTS.length - 1];
}

// The doorbell goes before everything else.
export function urgentEvent(raw) {
  const k = String(raw ?? "").trim().toLowerCase().replace(/[ _]/g, "-");
  return k === "klingel" || k === "doorbell" || k === "bell" || k === "bell-ring";
}
