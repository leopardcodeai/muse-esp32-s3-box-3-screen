// app.js: wires the page: the stage (canvas plus picture overlay) scaled to the window
// at the device pixel ratio, the display state machine drawn at the chosen frame rate,
// the settings panel, the Home Assistant connection, the figure source, the demo mode,
// the Float and Kiosk buttons, the sounds and the service worker.
//
// Pitfalls:
//  * The drawing loop runs on the requestAnimationFrame of the window the stage is in;
//    Float moves the stage into another window, so the loop is restarted there (and on
//    the way back), with a generation number that ends the old one.
//  * A first visit without stored settings is sent to demo mode (settings.js,
//    landingTarget) before anything starts, so the hosted page shows the display at once.
import { Renderer, allFonts, W, H } from "./render.js";
import { Figure } from "./figure.js";
import { FigureSource, FIGURE_NAMES } from "./figure_frames.js";
import { WeatherIcons } from "./weather.js";
import { MediaOverlay } from "./media.js";
import { Display, VERSION } from "./display.js";
import { Sounds } from "./audio.js";
import { HaClient, EVENT_WEB, DEFAULT_DEVICE } from "./ha.js";
import { Demo } from "./demo.js";
import { floatDocument, floatVideo, unfloatVideo, hasDocumentPip, hasVideoPip, Kiosk } from "./pip.js";
import { FrameClock, BOX_FPS, fitScale, normaliseFps } from "./pace.js";
import {
  DEFAULTS, loadSettings, saveSettings, hasStoredSettings, landingTarget, fpsFor, insecureFromHttps, MIXED_CONTENT_NOTE,
} from "./settings.js";

const $ = (id) => document.getElementById(id);
const stage = $("stage");
const canvas = $("screen");
const overlayEl = $("overlay");
const notice = $("notice");
const params = new URLSearchParams(location.search);
const demoMode = params.get("demo") === "1";

function storage() {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => { throw new Error("no storage"); } };
  }
}
let settings = loadSettings(storage());

const log = (line) => console.info("[muse] " + line);
const renderer = new Renderer(canvas);
const figure = new FigureSource({ placeholder: new Figure(), log });
const weather = new WeatherIcons();
const media = new MediaOverlay(overlayEl);
const sounds = new Sounds();
sounds.enabled = settings.sound;
let ha = null;
let demo = null;
let hostWindow = window;
let pipWindow = null;
let videoPipActive = false;
const kiosk = new Kiosk(document.documentElement);
const frames = new FrameClock(fpsFor(location.search, settings));
figure.smooth = frames.fps > BOX_FPS;

const display = new Display({
  renderer, figure, weather, media,
  now: () => performance.now(),
  clock: () => new Date(),
  name: settings.name || "Muse",
  sound: sounds,
  log,
  onAnswer: (answer, question) => {
    log(`answer "${answer}" to "${question}"`);
    if (ha) ha.answer(answer, question, settings.inputText).catch((e) => log("answer not sent: " + e.message));
  },
});
display.browserInfo = browserName();

function browserName() {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "Browser";
}

// --------------------------------------------------------------- scaling --

// The stage in whole CSS pixels, the canvas backing store in device pixels: the 320 x 240
// logical layout stays, the text is drawn at the screen's own resolution.
function fit() {
  const host = hostWindow;
  const rect = stage.parentElement.getBoundingClientRect();
  const dpr = host.devicePixelRatio || 1;
  const k = fitScale(rect.width, rect.height, W, H, settings.integer);
  stage.style.width = `${Math.round(W * k)}px`;
  stage.style.height = `${Math.round(H * k)}px`;
  renderer.resize(k * dpr);
  media.rescale(k);
  display.displayInfo = `${Math.round(W * k * dpr)} x ${Math.round(H * k * dpr)} px`;
  display.browserInfo = `${browserName()}  ·  ${frames.fps} Bilder/s`;
  render();
}

// devicePixelRatio changes when the window moves to another screen or the page is zoomed.
let dprQuery = null;
function watchPixelRatio() {
  if (dprQuery) dprQuery.removeEventListener("change", onPixelRatio);
  dprQuery = hostWindow.matchMedia(`(resolution: ${hostWindow.devicePixelRatio || 1}dppx)`);
  dprQuery.addEventListener("change", onPixelRatio);
}
function onPixelRatio() {
  fit();
  watchPixelRatio();
}

// ------------------------------------------------------------- the loop --

let lastDraw = 0;
let fontsReady = false;
function render() {
  if (!fontsReady) return;
  display.tick();
  display.render();
  lastDraw = performance.now();
}
let loopGeneration = 0;
function startLoop() {
  const generation = ++loopGeneration;
  const win = hostWindow;
  const step = () => {
    if (generation !== loopGeneration) return;
    if (frames.due(performance.now())) render();
    win.requestAnimationFrame(step);
  };
  win.requestAnimationFrame(step);
}
// A hidden tab stops requestAnimationFrame; this keeps the state machine moving.
setInterval(() => {
  if (performance.now() - lastDraw >= 100) render();
}, 100);

function setFps(fps) {
  frames.set(fps);
  figure.smooth = frames.fps > BOX_FPS;
  if (video.srcObject) video.srcObject = null; // the Float video picks up the new rate next time
  fit();
}

// ---------------------------------------------------------------- touch --

function logical(ev) {
  const rect = canvas.getBoundingClientRect();
  return [((ev.clientX - rect.left) / rect.width) * W, ((ev.clientY - rect.top) / rect.height) * H];
}
function bindTouch(el) {
  el.addEventListener("pointerdown", (ev) => {
    sounds.unlock();
    el.setPointerCapture(ev.pointerId);
    const [x, y] = logical(ev);
    display.touchStart(x, y);
  });
  el.addEventListener("pointermove", (ev) => {
    if (display.touch) {
      const [x, y] = logical(ev);
      display.touchMove(x, y);
    }
  });
  const end = (ev) => {
    if (!display.touch) return;
    const [x, y] = logical(ev);
    display.touchMove(x, y);
    display.touchEnd();
    render();
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", () => { display.touch = null; });
}
bindTouch(stage);

// ------------------------------------------------------- Home Assistant --

function connect() {
  if (ha) {
    ha.close();
    ha = null;
  }
  display.host = settings.url ? settings.url.replace(/^https?:\/\//, "") : "";
  if (demoMode || !settings.url || !settings.token) {
    display.connection = demoMode ? "demo" : "off";
    return;
  }
  if (insecureFromHttps(location.protocol, settings.url)) {
    log("an http Home Assistant URL from an https page: browsers may block it as mixed content (see the settings)");
  }
  ha = new HaClient({
    url: settings.url,
    token: settings.token,
    device: settings.device || DEFAULT_DEVICE,
    pageProtocol: location.protocol,
    log,
    onState: (state, detail) => {
      display.connection = state;
      if (detail) log(`connection ${state}: ${detail}`);
    },
    onAction: ({ action, fields }) => {
      log(`action ${action} ${JSON.stringify(fields).slice(0, 120)}`);
      display.dispatch(action, fields);
      render();
    },
  });
  ha.connect();
}

// ---------------------------------------------------------------- figure --

const figureStatus = $("figure-status");
async function useFigure() {
  const url = settings.figureSource === "url" ? settings.figureUrl : "";
  figureStatus.textContent = url ? "lädt …" : "";
  const r = await figure.use(url);
  if (r.stale) return;
  if (url) {
    log(`figure from ${url}: ${r.loaded} of ${FIGURE_NAMES.length} loaded${r.failed.length ? ", missing " + r.failed.join(", ") : ""}`);
    if (r.loaded === 0) say("Die eigenen Bilder der Figur kamen nicht an: die Anzeige zeigt den Platzhalter (Konsole und Einstellungen sagen mehr).");
  }
  figureStatus.textContent = url ? figure.describe() + (r.failed.length && r.loaded ? `, fehlt: ${r.failed.join(", ")}` : "") : "";
}

// ------------------------------------------------------------- settings --

const dialog = $("settings");
const form = $("settings-form");
const mixedNote = $("mixed-note");
form.device.placeholder = DEFAULT_DEVICE;
$("device-example").textContent = DEFAULT_DEVICE;
$("device-action").textContent = `esphome.${DEFAULT_DEVICE}_muse_show_text`;
mixedNote.textContent = MIXED_CONTENT_NOTE;

function updateDialog() {
  mixedNote.hidden = !insecureFromHttps(location.protocol, form.url.value);
  const own = form.figureSource.value === "url";
  $("figure-url-row").hidden = !own;
}
function openSettings() {
  form.url.value = settings.url;
  form.token.value = settings.token;
  form.device.value = settings.device;
  form.inputText.value = settings.inputText;
  form.name.value = settings.name;
  form.fps.value = String(settings.fps);
  form.figureSource.value = settings.figureSource;
  form.figureUrl.value = settings.figureUrl;
  form.integer.checked = settings.integer;
  form.sound.checked = settings.sound;
  updateDialog();
  dialog.showModal();
}
form.addEventListener("input", updateDialog);
form.addEventListener("change", updateDialog);
form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const before = settings;
  settings = {
    url: form.url.value.trim(),
    token: form.token.value.trim(),
    device: form.device.value.trim() || DEFAULT_DEVICE,
    inputText: form.inputText.value.trim(),
    name: form.name.value.trim() || DEFAULTS.name,
    fps: normaliseFps(form.fps.value),
    figureSource: form.figureSource.value === "url" && form.figureUrl.value.trim() ? "url" : "placeholder",
    figureUrl: form.figureUrl.value.trim(),
    integer: form.integer.checked,
    sound: form.sound.checked,
  };
  if (!saveSettings(storage(), settings)) say("Dieser Browser speichert nichts: die Einstellungen gelten nur bis zum Neuladen.");
  dialog.close();
  // New credentials in demo mode: leave the demo for the real connection.
  if (demoMode && settings.url && settings.token && (settings.url !== before.url || settings.token !== before.token)) {
    const u = new URL(location.href);
    u.searchParams.delete("demo");
    location.href = u.toString();
    return;
  }
  display.name = settings.name;
  sounds.enabled = settings.sound;
  if (settings.fps !== before.fps) setFps(settings.fps); // a ?fps= of the URL holds until the setting changes
  else fit();
  if (settings.figureSource !== before.figureSource || settings.figureUrl !== before.figureUrl) useFigure();
  if (settings.url !== before.url || settings.token !== before.token || settings.device !== before.device || !ha) connect();
});
$("settings-cancel").addEventListener("click", () => dialog.close());
$("btn-settings").addEventListener("click", openSettings);

// ------------------------------------------------------------ float --

const video = $("pip-video");
async function toggleFloat() {
  sounds.unlock();
  if (pipWindow) {
    pipWindow.close();
    return;
  }
  if (videoPipActive) {
    await unfloatVideo(video);
    return;
  }
  const k = parseFloat(stage.style.width) / W || 1;
  if (hasDocumentPip()) {
    try {
      pipWindow = await floatDocument(stage, {
        width: Math.round(W * Math.min(k, 2)),
        height: Math.round(H * Math.min(k, 2)),
        fonts: allFonts(),
        onMove: (win) => {
          hostWindow = win;
          if (win !== window) win.addEventListener("resize", fit);
          watchPixelRatio();
          fit();
          startLoop();
        },
        onClose: () => {
          pipWindow = null;
          $("btn-float").textContent = "Float";
          fit();
        },
      });
      $("btn-float").textContent = "Zurück";
      return;
    } catch (e) {
      log("document picture-in-picture refused: " + e.message);
    }
  }
  if (hasVideoPip(video)) {
    try {
      await floatVideo(canvas, video, () => {
        videoPipActive = false;
        $("btn-float").textContent = "Float";
        video.pause();
      }, frames.fps);
      videoPipActive = true;
      $("btn-float").textContent = "Zurück";
      say("Dieser Browser kennt kein Document Picture-in-Picture: das Bild schwebt als Video, ohne Tippen und ohne Fotos.");
      return;
    } catch (e) {
      log("video picture-in-picture refused: " + e.message);
    }
  }
  say("Float braucht Chrome oder Edge (Document Picture-in-Picture) oder Safari (Video).");
}
$("btn-float").addEventListener("click", toggleFloat);
if (!hasDocumentPip() && !hasVideoPip(video)) $("btn-float").disabled = true;

// ------------------------------------------------------------- kiosk --

async function toggleKiosk() {
  sounds.unlock();
  if (kiosk.active) {
    await kiosk.exit();
    $("btn-kiosk").textContent = "Kiosk";
  } else {
    await kiosk.enter();
    $("btn-kiosk").textContent = "Zurück";
    if (!("wakeLock" in navigator)) say("Kein Wake Lock in diesem Browser: der Bildschirm kann sich abschalten.");
  }
  fit();
}
$("btn-kiosk").addEventListener("click", toggleKiosk);
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && kiosk.active) {
    kiosk.exit();
    $("btn-kiosk").textContent = "Kiosk";
  }
  fit();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && kiosk.active) toggleKiosk();
});

// -------------------------------------------------------------- demo --

// "Demo aus" sets demo=0 instead of dropping the parameter, so a page without stored
// settings does not land in the demo again.
$("btn-demo").addEventListener("click", () => {
  const u = new URL(location.href);
  u.searchParams.set("demo", demoMode ? "0" : "1");
  location.href = u.toString();
});

let noticeTimer = null;
function say(text) {
  notice.textContent = text;
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 8000);
}

// ------------------------------------------------------------- start --

async function start() {
  const target = landingTarget(location.href, hasStoredSettings(storage()));
  if (target) {
    location.replace(target);
    return;
  }
  await Promise.all(allFonts().map((f) => document.fonts.load(f).catch(() => null)));
  await document.fonts.ready;
  fontsReady = true;
  fit();
  window.addEventListener("resize", fit);
  watchPixelRatio();
  startLoop();
  useFigure();
  if (demoMode) {
    $("btn-demo").textContent = "Demo aus";
    demo = new Demo(display, {
      fetchText: async (path) => {
        const res = await fetch(path);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      },
      log,
    });
    demo.start();
  } else {
    connect();
    if (!settings.url || !settings.token) openSettings();
  }
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch((e) => log("service worker not registered: " + e.message));
  }
  log(`Muse Web Screen ${VERSION}; ${frames.fps} frames a second; muse_web events: ${EVENT_WEB}`);
}
start();

// For the browser console: muse.dispatch("show_text", {title: "Hallo", message: "Welt"}).
window.muse = {
  display,
  dispatch: (action, fields) => { const r = display.dispatch(action, fields); render(); return r; },
  settings: () => ({ ...settings, token: settings.token ? "(set)" : "" }),
  fps: (n) => { if (n !== undefined) setFps(n); return frames.fps; },
};
