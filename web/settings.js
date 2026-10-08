// settings.js: the display's settings in this browser's localStorage, their defaults,
// and the small decisions app.js takes from them at start: whether a first visit lands
// in demo mode, which frame rate applies, and whether the browser will refuse the Home
// Assistant URL from this page. No DOM in here, so the tests run it in Node.
//
// Pitfalls:
//  * localStorage can throw (blocked site data, some private windows); every access is
//    wrapped, and the page then runs with the defaults.
//  * The key stays "muse-web-settings" across the rename to Muse Web Screen, so settings
//    stored by an earlier version are kept.
import { DEFAULT_DEVICE } from "./ha.js";
import { normaliseFps, DEFAULT_FPS } from "./pace.js";

export const SETTINGS_KEY = "muse-web-settings";
export const FIGURE_SOURCES = ["placeholder", "url"];
export const DEFAULTS = Object.freeze({
  url: "", token: "", device: DEFAULT_DEVICE, inputText: "", name: "Muse", integer: false, sound: true,
  fps: DEFAULT_FPS, figureSource: "placeholder", figureUrl: "", bare: false,
});

// The stored settings over the defaults, cleaned.
export function loadSettings(storage) {
  let stored = {};
  try {
    stored = JSON.parse(storage.getItem(SETTINGS_KEY) || "{}") || {};
  } catch {
    stored = {};
  }
  const s = { ...DEFAULTS, ...stored };
  s.device = String(s.device || "").trim() || DEFAULT_DEVICE;
  s.fps = normaliseFps(s.fps);
  if (!FIGURE_SOURCES.includes(s.figureSource)) s.figureSource = DEFAULTS.figureSource;
  s.bare = s.bare === true;
  return s;
}

export function hasStoredSettings(storage) {
  try {
    return storage.getItem(SETTINGS_KEY) !== null;
  } catch {
    return false;
  }
}

export function saveSettings(storage, s) {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

// Where a first visit goes: a page without stored settings and without a `demo`
// parameter lands in demo mode (index.html?demo=1), so a stranger sees the display at
// once instead of an empty settings form. null: stay. `?demo=0` stays without demo.
export function landingTarget(href, stored) {
  const u = new URL(href);
  if (stored || u.searchParams.has("demo")) return null;
  if (u.pathname.endsWith("/")) u.pathname += "index.html";
  u.searchParams.set("demo", "1");
  return u.toString();
}

// The frame rate of this visit: `?fps=10|30|60` in the URL, else the setting.
export function fpsFor(search, settings) {
  const p = new URLSearchParams(search);
  return p.has("fps") ? normaliseFps(p.get("fps"), settings.fps) : normaliseFps(settings.fps);
}

// The host of a URL in lower case, or "" when it is none.
function hostOf(url) {
  try {
    return new URL(String(url || "").trim()).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isLoopbackHost(host) {
  return host === "localhost" || host.endsWith(".localhost") || /^127\.\d+\.\d+\.\d+$/.test(host) || host === "[::1]";
}

// Whether a page loaded with `pageProtocol` opens an unencrypted connection to `url`
// that browsers treat as mixed content: an http URL from an https page, except to this
// machine (loopback counts as secure).
export function insecureFromHttps(pageProtocol, url) {
  const u = String(url || "").trim();
  if (pageProtocol !== "https:" || !/^http:\/\//i.test(u)) return false;
  return !isLoopbackHost(hostOf(u));
}

// The one German sentence the settings dialog shows when insecureFromHttps() holds.
export const MIXED_CONTENT_NOTE = "Von dieser HTTPS-Seite aus blockieren Safari und Firefox die unverschlüsselte "
  + "Verbindung zu einer http-Adresse, Chrome und Edge erlauben sie nur ins lokale Netz und erst nach einer "
  + "Freigabe: zuverlässig geht es mit einer HTTPS-Adresse für Home Assistant (wss://) oder mit der App lokal "
  + "über http://localhost.";
