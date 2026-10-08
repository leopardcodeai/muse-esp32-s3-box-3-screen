// text.js: text the way the box treats it (a port of the text half of firmware/muse.h
// and of muse_fit.h): cleaning what an assistant sends, wrapping, fitting one line
// into a width, paging long texts, placeholders, and the small parsers of the cards.
//
// Pitfalls:
//  * The fonts of the box hold no emoji: weather emojis become a weather icon number,
//    every other emoji is dropped, Markdown marks go. The same happens here so that a
//    card reads the same on both screens.
//  * Width functions are passed in (measureText on the canvas, a fake in tests), so this
//    module runs in Node without a canvas.

// Weather icons in the order of ICONS in tools/make_weather_icons.py (the box's numbers).
export const WEATHER = [
  "clear_day", "clear_night", "partly_day", "partly_night", "cloudy", "overcast", "fog", "drizzle", "rain",
  "extreme_rain", "showers", "thunder", "thunder_rain", "snow", "sleet", "hail", "wind", "tornado",
  "umbrella", "thermometer", "raindrop", "sunrise", "sunset",
];
export const W = Object.fromEntries(WEATHER.map((k, i) => [k.toUpperCase(), i]));
export const W_NONE = -1;
export const LARGE_COUNT = W.UMBRELLA; // the first ones exist at 104 px for the weather card

// A weather emoji becomes its icon; every other emoji is dropped by clean().
export function emojiWeather(cp) {
  switch (cp) {
    case 0x2600: case 0x1F31E: return W.CLEAR_DAY;
    case 0x1F319: case 0x1F31B: case 0x1F31C: return W.CLEAR_NIGHT;
    case 0x1F324: case 0x26C5: return W.PARTLY_DAY;
    case 0x1F325: return W.OVERCAST;
    case 0x2601: return W.CLOUDY;
    case 0x1F326: return W.SHOWERS;
    case 0x1F327: return W.RAIN;
    case 0x26C8: return W.THUNDER_RAIN;
    case 0x1F329: return W.THUNDER;
    case 0x1F328: case 0x2744: case 0x2603: case 0x26C4: return W.SNOW;
    case 0x1F32B: return W.FOG;
    case 0x1F4A8: case 0x1F32C: return W.WIND;
    case 0x1F32A: return W.TORNADO;
    case 0x2614: case 0x2602: return W.UMBRELLA;
    case 0x1F321: return W.THERMOMETER;
    case 0x1F4A7: return W.RAINDROP;
    case 0x1F305: case 0x1F304: return W.SUNRISE;
    case 0x1F307: case 0x1F306: return W.SUNSET;
    default: return W_NONE;
  }
}

// What the two largest fonts on the box hold (muse-esp32boxs3-screen.yaml, m_head and m_value). The
// four smaller ones hold Google Fonts' Latin Core set, approximated by the Latin blocks.
export const GLYPHS_XL = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz"
  + "{|}~äöüÄÖÜß€°„“”‘’–—…•·àáâéèêëíìîïóòôúùûçñÀÁÉÈÓÚÇÑ";
export const GLYPHS_XXL = "0123456789,.:-+%°/ abcdefghijklmnopqrstuvwxyzäöüßABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ€!?'&()";

// Whether the box's font of text size `size` (0 xs .. 5 xxl) holds the character.
export function canDraw(size, ch) {
  if (size === 4) return GLYPHS_XL.includes(ch);
  if (size === 5) return GLYPHS_XXL.includes(ch);
  const cp = ch.codePointAt(0);
  return cp >= 0x20 && (cp < 0x250 || (cp >= 0x2000 && cp < 0x20D0) || cp === 0x2122 || cp === 0x2212);
}

export function trim(s) {
  return s.replace(/^[ \t\r\n]+/, "").replace(/[ \t\r\n]+$/, "");
}

// Keeps only what the font of `size` can draw: weather emojis become an icon number,
// other emojis and symbols go, Markdown marks from language models go, line breaks
// stay. Returns {text, icon}.
export function clean(input, size = 1) {
  let icon = W_NONE;
  let out = "";
  let space = true; // no leading space, no double spaces
  for (const ch of String(input ?? "")) {
    let cp = ch.codePointAt(0);
    if (cp === 0x0D) continue;
    if (cp === 0x0A) {
      out = out.replace(/ +$/, "") + "\n";
      space = true;
      continue;
    }
    if (cp === 0x09 || cp === 0xA0 || cp === 0x2002 || cp === 0x2003 || cp === 0x2009 || cp === 0x202F) cp = 0x20;
    if (cp === 0x20) {
      if (!space) out += " ";
      space = true;
      continue;
    }
    const w = emojiWeather(cp);
    if (w !== W_NONE) {
      if (icon === W_NONE) icon = w;
      continue;
    }
    if (cp === 0x2192) { // an arrow the font lacks
      out += "->";
      space = false;
      continue;
    }
    if (cp === 0x2212) cp = 0x2D;
    const c = String.fromCodePoint(cp);
    if (!canDraw(size, c)) continue;
    out += c;
    space = false;
  }
  // Markdown, line by line: headings, bullets, bold and code marks.
  const bullet = size < 4;
  const md = out.split("\n").map((line) => {
    let h = 0;
    while (h < line.length && line[h] === "#") h++;
    if (h > 0 && h < line.length && line[h] === " ") line = line.slice(h + 1);
    if (line.length > 1 && (line[0] === "*" || line[0] === "-" || line[0] === "+") && line[1] === " ") {
      line = (bullet ? "• " : "- ") + line.slice(2);
    }
    let kept = "";
    for (let k = 0; k < line.length; k++) {
      if (line[k] === "*" || line[k] === "`") continue;
      if (line[k] === "_" && k + 1 < line.length && line[k + 1] === "_") {
        k++;
        continue;
      }
      kept += line[k];
    }
    return kept;
  }).join("\n");
  // No more than one empty line in a row, nothing around the text.
  let tidy = "";
  let newlines = 0;
  for (const c of md) {
    if (c === "\n") {
      if (++newlines > 2) continue;
    } else {
      newlines = 0;
    }
    tidy += c;
  }
  return { text: trim(tidy), icon };
}

// What the font of `size` can draw of a scene text, line breaks included. Unlike clean()
// it keeps stars and hashes: in a scene they are meant, not Markdown.
export function drawable(input, size) {
  let out = "";
  for (const ch of input) {
    let cp = ch.codePointAt(0);
    if (cp === 0x0D) continue;
    if (cp === 0x0A) {
      out += "\n";
      continue;
    }
    if (cp === 0x09 || cp === 0xA0 || cp === 0x2009 || cp === 0x202F) cp = 0x20;
    if (cp === 0x2212) cp = 0x2D;
    const c = String.fromCodePoint(cp);
    if (cp !== 0x20 && !canDraw(size, c)) continue;
    out += c;
  }
  return out;
}

// Line breaks and tabs become spaces, runs of spaces become one, nothing stays at the ends.
export function singleLine(s) {
  return String(s ?? "").replace(/[\n\r\t]/g, " ").replace(/ +/g, " ").replace(/^ /, "").replace(/ $/, "");
}

// Breaks text into lines no wider than maxWidth; '\n' starts a new line and a word
// wider than a whole line (a link, say) is cut between characters.
export function wrap(text, widthOf, maxWidth) {
  const lines = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (let word of para.split(" ")) {
      if (!word) continue;
      const test = line ? line + " " + word : word;
      if (widthOf(test) <= maxWidth) {
        line = test;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      while (widthOf(word) > maxWidth) {
        const chars = [...word];
        let fit = 0;
        for (let k = 1; k <= chars.length; k++) {
          if (widthOf(chars.slice(0, k).join("")) > maxWidth) break;
          fit = k;
        }
        fit = Math.max(fit, 1);
        lines.push(chars.slice(0, fit).join(""));
        word = chars.slice(fit).join("");
      }
      line = word;
    }
    lines.push(line);
  }
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines;
}

// `text` when it fits, else its longest beginning that fits together with the ellipsis,
// cut between characters, trailing spaces removed (muse_fit.h).
export function fitLine(text, maxWidth, widthOf, ellipsis = "…") {
  if (!text || widthOf(text) <= maxWidth) return text;
  const chars = [...text];
  const candidate = (k) => chars.slice(0, k).join("").replace(/ +$/, "") + ellipsis;
  if (widthOf(candidate(0)) > maxWidth) return ellipsis;
  let lo = 0;
  let hi = chars.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (widthOf(candidate(mid)) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return candidate(lo);
}

// Lines of a scene text: wrapped to `w`, cut to `lines` with "…".
export function sceneLines(item, text, widthOf) {
  const cleaned = drawable(text, item.size);
  let lines = item.wrap > 0 ? wrap(cleaned, widthOf, item.wrap) : cleaned.split("\n");
  if (item.maxLines > 0 && lines.length > item.maxLines) {
    lines = lines.slice(0, item.maxLines);
    const ell = canDraw(item.size, "…") ? "…" : "...";
    lines[lines.length - 1] = fitLine(lines[lines.length - 1] + ell, item.wrap > 0 ? item.wrap : 100000, widthOf, ell);
  }
  return lines;
}

export const DAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
export const DAYS_SHORT = ["SO", "MO", "DI", "MI", "DO", "FR", "SA"];
export const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September",
  "Oktober", "November", "Dezember"];

export function clockText(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// {time}, {date} and {weekday} in a scene text, in German.
export function fillPlaceholders(text, date) {
  if (!text.includes("{")) return text;
  return text
    .replaceAll("{time}", clockText(date))
    .replaceAll("{date}", `${date.getDate()}. ${MONTHS[date.getMonth()]}`)
    .replaceAll("{weekday}", DAYS[date.getDay()]);
}

// A long text in pages that change by themselves, slow enough to read along.
export function pageText(text, widthOf, width, perPage) {
  const lines = wrap(text, widthOf, width);
  const ends = []; // when each page ends, in ms after the start
  let t = 0;
  for (let p = 0; p < lines.length; p += perPage) {
    let chars = 0;
    for (let k = p; k < lines.length && k < p + perPage; k++) chars += lines[k].length;
    let ms = chars * 65; // about 15 characters a second
    ms = ms < 5000 ? 5000 : ms > 16000 ? 16000 : ms;
    t += ms;
    ends.push(t);
  }
  return {
    lines,
    ends,
    perPage,
    pages: ends.length,
    cycle: ends.length ? ends[ends.length - 1] : 0,
    pageAt(elapsed) {
      if (ends.length <= 1) return 0;
      const tt = elapsed % ends[ends.length - 1];
      for (let p = 0; p < ends.length; p++) if (tt < ends[p]) return p;
      return 0;
    },
    pageLines(page) {
      return lines.slice(page * perPage, page * perPage + perPage);
    },
  };
}

// "21.5", "21,5 °C", "21 Grad" -> "21,5°" (German decimal comma).
export function temperature(raw) {
  let t = "";
  for (const c of String(raw ?? "")) {
    if ((c >= "0" && c <= "9") || c === "-" || c === "+") t += c;
    else if (c === "." || c === ",") t += ",";
  }
  return t ? t + "°" : "";
}

// "5", "5 min", "1:30", "90 s", "1 h 20 min" -> seconds; 0 when nothing is readable.
export function parseDuration(raw) {
  const s = trim(String(raw ?? "")).toLowerCase();
  if (!s) return 0;
  let m = s.match(/^(\d+):(\d+):(\d+)/);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  m = s.match(/^(\d+):(\d+)/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  let total = 0;
  let any = false;
  const re = /(\d+(?:[.,]\d*)?)\s*([a-z]*)/g;
  for (const part of s.matchAll(re)) {
    const v = parseFloat(part[1].replace(",", "."));
    const unit = part[2];
    any = true;
    if (unit.startsWith("h") || unit.startsWith("st")) total += Math.trunc(v * 3600);
    else if (unit.startsWith("s")) total += Math.trunc(v);
    else total += Math.trunc(v * 60); // minutes when no unit is given
  }
  return any ? total : 0;
}

// "m:ss", or "h:mm:ss" from an hour on, like the timer card and the top bar.
export function timeLeft(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s >= 3600) {
    return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// The appointments of an agenda card: one per line, "09:00-10:00 Teammeeting @ office",
// "ganztägig Urlaub" or "09:00 | Teammeeting | office"; bullets in front are dropped.
export function parseAgenda(text) {
  const out = [];
  for (let line of String(text ?? "").split("\n")) {
    if (out.length >= 24) break;
    line = trim(line);
    for (const b of ["• ", "- ", "* "]) if (line.startsWith(b)) line = trim(line.slice(b.length));
    if (!line) continue;
    const a = { time: "", title: "", place: "" };
    if (line.includes("|")) {
      const parts = line.split("|").map(trim);
      a.time = parts[0];
      if (parts.length > 1) a.title = parts[1];
      if (parts.length > 2) a.place = parts[2];
    } else {
      const sp = line.indexOf(" ");
      const first = sp < 0 ? line : line.slice(0, sp);
      const low = first.toLowerCase();
      const clockTime = first && first[0] >= "0" && first[0] <= "9" && first.includes(":");
      const allDay = ["ganztägig", "ganztaegig", "ganztags", "all-day", "allday"].includes(low);
      if ((clockTime || allDay) && sp >= 0) {
        a.time = allDay ? "ganztägig" : first;
        line = trim(line.slice(sp));
      }
      const at = line.indexOf(" @ ");
      if (at >= 0) {
        a.place = trim(line.slice(at + 3));
        line = trim(line.slice(0, at));
      }
      a.title = line;
    }
    out.push(a);
  }
  return out;
}

// Items of a list card: one per line, "[x] Milch" done, "[ ] Brot" or "- Brot" or "Brot" open.
export function parseList(text) {
  const out = [];
  for (let line of String(text ?? "").split("\n")) {
    if (out.length >= 40) break;
    line = trim(line);
    if (!line) continue;
    let done = false;
    if (line.slice(0, 3).toLowerCase() === "[x]") {
      done = true;
      line = trim(line.slice(3));
    } else if (line.startsWith("[ ]") || line.startsWith("[]")) {
      line = trim(line.slice(line[1] === "]" ? 2 : 3));
    }
    for (const b of ["• ", "- ", "* ", "✓ ", "✔ "]) if (line.startsWith(b)) line = trim(line.slice(b.length));
    if (!line) continue;
    out.push({ text: line, done });
  }
  return out;
}

// The options of muse_choose: one per line, two to four; fewer than two give Ja and Nein.
export function parseOptions(text) {
  const opts = [];
  for (const line of clean(text, 3).text.split("\n")) {
    if (opts.length >= 4) break;
    const l = singleLine(line);
    if (l) opts.push(l);
  }
  return opts.length < 2 ? ["Ja", "Nein"] : opts;
}
