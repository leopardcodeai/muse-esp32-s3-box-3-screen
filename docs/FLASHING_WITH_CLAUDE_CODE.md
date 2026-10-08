# Flashing with Claude Code (or any coding agent)

Meta sells no Muse gadget outside the United States. A box from Espressif, a Mac or a
Linux machine and a coding agent are enough to build one. The agent does the typing;
you watch the box and answer four questions. Every step below is something Claude Code
runs for you when you ask it to "set up and flash this box"; the commands are listed
so you can check what it does.

## What you need

| Thing | Where from |
|---|---|
| ESP32-S3-BOX-3, with the BOX-3-SENSOR dock if you want radar, temperature, IR and battery | Espressif's shops and the usual distributors (Mouser, DigiKey, Reichelt); about 50 to 70 EUR, the dock about 20 EUR |
| an 18650 battery for the dock (optional) | any |
| a USB-C data cable | one that carries data, not only power |
| Home Assistant with the ESPHome integration | https://www.home-assistant.io |
| ESPHome 2026.9 or newer on the computer | `pip install esphome` or `brew install esphome` |
| Claude Code (or Codex, Gemini CLI, Grok, Dots, Spark) opened in this folder | https://claude.com/claude-code |

## Step by step

1. **Clone and open.** `git clone https://github.com/leopardcodeai/muse-esp32boxs3-screen` and
   open the folder in the agent. It reads `CLAUDE.md` (or `AGENTS.md`) and knows the rules.
2. **Secrets.** Say: *"create firmware/secrets.yaml from the example with my Wi-Fi"*. The
   agent copies `firmware/secrets.yaml.example`, asks for the Wi-Fi name and password
   (type them into the terminal prompt, not into the chat), and generates the API key
   with `openssl rand -base64 32`. `secrets.yaml` is ignored by git.
3. **Figure.** The repo ships a placeholder character. With the Muse app installed on the
   Mac, *"build the Muse figure"* runs `tools/make_muse_assets.py`, which cuts Muse's own
   animations out of the app into `firmware/figure/`. Those files stay on your machine;
   `tools/check_private.py` refuses to let them be pushed.
4. **Check and build.** `esphome config firmware/muse-esp32boxs3-screen.yaml` must say
   "Configuration is valid"; `esphome compile firmware/muse-esp32boxs3-screen.yaml` takes 5 to 10
   minutes the first time and ends with a line like `Flash: [==========] 95.0%`.
5. **First flash over USB.** Plug the box in. The agent runs
   `esphome upload firmware/muse-esp32boxs3-screen.yaml --device /dev/cu.usbmodem*` (Linux:
   `/dev/ttyACM0`). If the upload does not start, hold the box's BOOT button (top left)
   while plugging in. About 60 s.
6. **Read the boot.** `esphome logs firmware/muse-esp32boxs3-screen.yaml --device muse-esp32boxs3-screen.local`.
   The agent waits for `Project leopardcodeai.muse_esp32boxs3_screen version 4.0.0`, counts
   `[W]` and `[E]` lines (target: zero), and checks that both audio chips came up
   (`audio chips, try 1: es8311 80 (80), es7210 C3 (C3)`).
7. **Home Assistant.** Settings, Devices and services, ESPHome: the box is discovered as
   `muse-esp32boxs3-screen`; paste the API key from `secrets.yaml`. The actions appear as
   `esphome.muse_esp32boxs3_screen_muse_*`.
8. **The first card.** `tools/muse_screen.py text "Hallo" "Die Box lebt."` with `HA_TOKEN`
   set (a long-lived token from your Home Assistant profile, kept in a keychain or a
   password manager, never in a file in this repo). The card stays 20 s.
9. **Hardware check.** `tools/muse_screen.py hw` lists every chip, pin and memory figure;
   `docs/HARDWARE.md` says what a healthy box answers.
10. **Later flashes** go over the air: `esphome upload firmware/muse-esp32boxs3-screen.yaml --device muse-esp32boxs3-screen.local`.

## What the agent checks that people forget

- The device log after every flash, not only the upload result.
- That `firmware/secrets.yaml` is not tracked (`git status`) and `tools/check_private.py`
  passes before a push.
- That a missing glyph (`Codepoint ... not found in font`) is fixed in the generator,
  not by hand in the header.
- That the figure files in the repo are the placeholder (checksums in
  `tools/figure_checksums.txt`).

## When something fails

| Symptom | Cause, fix |
|---|---|
| `Configuration is valid` but the build dies at `muse_gif` | an older ESPHome; 2026.9 or newer is needed (ESP-IDF 5.5) |
| upload over USB never starts | hold BOOT while plugging in; use a data cable |
| the box boots, no sound ever | the amplifier or codecs: `tools/muse_screen.py hw` shows `audio chips ready: no`; power-cycle the box once |
| pictures from the web fail with `couldn't get hostname` | a fixed IP without `dns1`; use DHCP or add the DNS server |
| `Flash: 100%` or more | fewer icons in `tools/make_icon_table.py`, or shorter figure animations |
