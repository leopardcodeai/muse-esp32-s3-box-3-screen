// app.js: wires the page: the stage (canvas plus picture overlay) scaled to the window,
// the display state machine, the settings panel, the Home Assistant connection, the
// demo mode, the Float and Kiosk buttons, the sounds and the service worker.
import { Renderer, allFonts, W, H } from "./render.js";
import { Figure } from "./figure.js";
import { WeatherIcons } from "./weather.js";
import { MediaOverlay } from "./media.js";
import { Display, VERSION } from "./display.js";
import { Sounds } from "./audio.js";
import { HaClient, EVENT_WEB } from "./ha.js";
import { Demo } from "./demo.js";
import { floatDocument, floatVideo, unfloatVideo, hasDocumentPip, hasVideoPip, Kiosk } from "./pip.js";

const SETTINGS_KEY = "muse-web-settings";
const DEFAULTS = { url: "", token: "", device: "muse_box", inputText: "", name: "Muse", integer: false, sound: true };

const $ = (id) => document.getElementById(id);
const stage = $("stage");
const canvas = $("screen");
const overlayEl = $("overlay");
const toolbar = $("toolbar");
const notice = $("notice");
const params = new URLSearchParams(location.search);
const demoMode = params.get("demo") === "1";

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}
function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
let settings = loadSettings();

const log = (line) => console.info("[muse] " + line);
const renderer = new Renderer(canvas);
const figure = new Figure();
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

function fit() {
  const host = hostWindow;
  const rect = stage.parentElement.getBoundingClientRect();
  const dpr = host.devicePixelRatio || 1;
  let k = Math.min(rect.width / W, rect.height / H);
  if (settings.integer && k >= 1) k = Math.floor(k);
  k = Math.max(0.25, k);
  stage.style.width = `${Math.round(W * k)}px`;
  stage.style.height = `${Math.round(H * k)}px`;
  renderer.resize(k * dpr);
  media.rescale(k);
  display.displayInfo = `${k.toFixed(2)}x, ${Math.round(W * k * dpr)} x ${Math.round(H * k * dpr)} px`;
  render(true);
}

// ------------------------------------------------------------- the loop --

let lastDraw = 0;
let fontsReady = false;
function render(force = false) {
  if (!fontsReady) return;
  display.tick();
  display.render();
  lastDraw = performance.now();
}
function loop() {
  const now = performance.now();
  if (now - lastDraw >= 100) render();
  hostWindow.requestAnimationFrame(loop);
}
// A hidden tab stops requestAnimationFrame; this keeps the state machine moving.
setInterval(() => {
  if (performance.now() - lastDraw >= 100) render();
}, 100);

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
  ha = new HaClient({
    url: settings.url,
    token: settings.token,
    device: settings.device || "muse_box",
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

// ------------------------------------------------------------- settings --

const dialog = $("settings");
const form = $("settings-form");
function openSettings() {
  form.url.value = settings.url;
  form.token.value = settings.token;
  form.device.value = settings.device;
  form.inputText.value = settings.inputText;
  form.name.value = settings.name;
  form.integer.checked = settings.integer;
  form.sound.checked = settings.sound;
  dialog.showModal();
}
form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  settings = {
    url: form.url.value.trim(),
    token: form.token.value.trim(),
    device: form.device.value.trim() || "muse_box",
    inputText: form.inputText.value.trim(),
    name: form.name.value.trim() || "Muse",
    integer: form.integer.checked,
    sound: form.sound.checked,
  };
  saveSettings(settings);
  display.name = settings.name;
  sounds.enabled = settings.sound;
  dialog.close();
  fit();
  connect();
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
          win.addEventListener("resize", fit);
          fit();
          win.requestAnimationFrame(loop);
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
      });
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

$("btn-demo").addEventListener("click", () => {
  const u = new URL(location.href);
  if (demoMode) u.searchParams.delete("demo");
  else u.searchParams.set("demo", "1");
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
  await Promise.all(allFonts().map((f) => document.fonts.load(f).catch(() => null)));
  await document.fonts.ready;
  fontsReady = true;
  fit();
  window.addEventListener("resize", fit);
  hostWindow.requestAnimationFrame(loop);
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
  log(`Muse Web ${VERSION}; muse_web events: ${EVENT_WEB}`);
}
start();

// For the browser console: muse.display.dispatch("show_text", {title: "Hallo", message: "Welt"}).
window.muse = { display, dispatch: (action, fields) => { const r = display.dispatch(action, fields); render(); return r; }, settings: () => settings };
