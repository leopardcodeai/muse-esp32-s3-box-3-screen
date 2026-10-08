// icons.test.js: icons.js is the firmware's table, name for name and in its order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ICON_NAMES, ICON_ALIASES, ICON_MAP, ICON_WORDS, MDI_VERSION } from "../icons.js";

const here = dirname(fileURLToPath(import.meta.url));
const header = readFileSync(resolve(here, "../../firmware/muse_icons.h"), "utf8");

function table(name) {
  const block = header.match(new RegExp(name + "\\[\\] = \\{([\\s\\S]*?)\\};"))[1];
  return [...block.matchAll(/\{"([^"]+)",\s*0x([0-9A-Fa-f]+)\}/g)].map((m) => [m[1], parseInt(m[2], 16)]);
}

test("the generated module matches muse_icons.h", () => {
  assert.deepEqual(ICON_NAMES, table("ICON_NAMES"));
  assert.deepEqual(ICON_ALIASES, table("ICON_ALIASES"));
  assert.equal(ICON_NAMES.length, Number(header.match(/ICON_COUNT = (\d+)/)[1]));
  assert.equal(ICON_ALIASES.length, Number(header.match(/ICON_ALIAS_COUNT = (\d+)/)[1]));
  assert.equal(MDI_VERSION, header.match(/Material Design Icons ([\d.]+)/)[1]);
});

test("names are sorted, unique, and the words keep the firmware's order", () => {
  for (let i = 1; i < ICON_NAMES.length; i++) assert.ok(ICON_NAMES[i - 1][0] < ICON_NAMES[i][0], ICON_NAMES[i][0]);
  assert.equal(new Set(ICON_WORDS).size, ICON_WORDS.length);
  assert.equal(ICON_WORDS[0], ICON_NAMES[0][0]);
  assert.equal(ICON_WORDS[ICON_NAMES.length], ICON_ALIASES[0][0]);
  assert.equal(ICON_MAP.get("coffee"), 0xF0176);
  assert.equal(ICON_MAP.get("kaffee"), 0xF0176);
  assert.equal(ICON_MAP.get("klingel"), 0xF009E);
  assert.equal(ICON_MAP.size, ICON_WORDS.length);
});
