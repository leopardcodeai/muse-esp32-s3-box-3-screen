// settings.test.js: the stored settings, the landing in demo mode, the frame rate of a
// visit, the mixed-content warning, and that the docs name the box as the code does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_DEVICE } from "../ha.js";
import {
  DEFAULTS, SETTINGS_KEY, loadSettings, saveSettings, hasStoredSettings, landingTarget, fpsFor, insecureFromHttps,
  MIXED_CONTENT_NOTE,
} from "../settings.js";

function memory(initial = {}) {
  const data = { ...initial };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
}

test("defaults: the box's device name, 60 frames a second, the placeholder figure", () => {
  assert.equal(DEFAULTS.device, DEFAULT_DEVICE);
  assert.equal(DEFAULTS.fps, 60);
  assert.equal(DEFAULTS.figureSource, "placeholder");
  assert.deepEqual(loadSettings(memory()), { ...DEFAULTS });
});

test("loadSettings(): stored values over the defaults, cleaned", () => {
  const s = loadSettings(memory({ [SETTINGS_KEY]: JSON.stringify({ url: "http://ha.local:8123", device: "", fps: 45, figureSource: "x" }) }));
  assert.equal(s.url, "http://ha.local:8123");
  assert.equal(s.device, DEFAULT_DEVICE, "an empty device name falls back");
  assert.equal(s.fps, 60, "an unknown rate falls back");
  assert.equal(s.figureSource, "placeholder");
  assert.equal(loadSettings(memory({ [SETTINGS_KEY]: "{broken" })).device, DEFAULT_DEVICE);
  const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.deepEqual(loadSettings(throwing), { ...DEFAULTS });
  assert.equal(hasStoredSettings(throwing), false);
  assert.equal(saveSettings(throwing, DEFAULTS), false);
  const m = memory();
  assert.equal(hasStoredSettings(m), false);
  assert.ok(saveSettings(m, { ...DEFAULTS, fps: 10 }));
  assert.equal(hasStoredSettings(m), true);
  assert.equal(loadSettings(m).fps, 10);
});

test("landingTarget(): a first visit without settings lands in demo mode, nothing else does", () => {
  assert.equal(landingTarget("https://muse.example/", false), "https://muse.example/index.html?demo=1");
  assert.equal(landingTarget("http://localhost:8321/web/", false), "http://localhost:8321/web/index.html?demo=1");
  assert.equal(landingTarget("https://muse.example/index.html?fps=10", false), "https://muse.example/index.html?fps=10&demo=1");
  assert.equal(landingTarget("https://muse.example/", true), null, "stored settings: stay");
  assert.equal(landingTarget("https://muse.example/?demo=1", false), null);
  assert.equal(landingTarget("https://muse.example/?demo=0", false), null, "Demo aus stays out of the demo");
});

test("fpsFor(): ?fps= in the URL wins for this visit, else the setting", () => {
  assert.equal(fpsFor("", { fps: 60 }), 60);
  assert.equal(fpsFor("?fps=10", { fps: 60 }), 10);
  assert.equal(fpsFor("?demo=1&fps=30", { fps: 60 }), 30);
  assert.equal(fpsFor("?fps=99", { fps: 30 }), 30, "an unknown rate keeps the setting");
});

test("insecureFromHttps(): http from an https page, except this machine", () => {
  assert.equal(insecureFromHttps("https:", "http://homeassistant.local:8123"), true);
  assert.equal(insecureFromHttps("https:", "http://192.168.0.10:8123"), true);
  assert.equal(insecureFromHttps("https:", " HTTP://ha.example.com "), true);
  assert.equal(insecureFromHttps("https:", "https://ha.example.ts.net"), false);
  assert.equal(insecureFromHttps("https:", "http://localhost:8123"), false);
  assert.equal(insecureFromHttps("https:", "http://127.0.0.1:8123"), false);
  assert.equal(insecureFromHttps("http:", "http://homeassistant.local:8123"), false);
  assert.equal(insecureFromHttps("https:", ""), false);
});

test("the warning is one German sentence without dashes", () => {
  assert.equal((MIXED_CONTENT_NOTE.match(/[.!?](\s|$)/g) || []).length, 1);
  assert.ok(!/[–—]| - |--/.test(MIXED_CONTENT_NOTE));
  assert.match(MIXED_CONTENT_NOTE, /HTTPS-Adresse/);
  assert.match(MIXED_CONTENT_NOTE, /http:\/\/localhost/);
});

test("README and the settings dialog name the box as DEFAULT_DEVICE does", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const [name, text] of [["README.md", readme], ["index.html", html]]) {
    assert.ok(!/muse_box|muse-box\b|esp32boxs3-toy|ESP32BoxS3 Toy/i.test(text), `${name} still names the old box`);
  }
  assert.ok(readme.includes(`esphome.${DEFAULT_DEVICE}_muse_show_text`), "README shows the action prefix");
  assert.ok(readme.includes(`\`${DEFAULT_DEVICE}\``), "README names the default device");
});
