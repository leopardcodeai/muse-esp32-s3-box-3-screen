# Working with this project (for Claude Code and any other coding agent)

A one-file ESPHome firmware (`firmware/muse-esp32-s3-box-3-screen.yaml` plus headers) for the Espressif
ESP32-S3-BOX-3, driven through Home Assistant by an AI assistant. Read `README.md` first,
then `docs/ACTIONS.md` (what the box can show) and `docs/SCENES.md` (the drawing language).

## Rules

- English everywhere in code, comments and docs; the display strings are German by
  design (`docs/LOCALIZATION.md` lists them).
- Secrets only in `firmware/secrets.yaml` (ignored by git), never in YAML, docs or chat.
  Run `python3 tools/check_private.py` before every push; it refuses private data and
  Meta's artwork.
- Newest stable ESPHome before a build (`pip install -U esphome` or Homebrew), and the
  newest libraries the generators pin; never upgrade mid-build.
- After every flash read the device log (`esphome logs firmware/muse-esp32-s3-box-3-screen.yaml`) until the
  boot is through: no `[W]` or `[E]` lines is the target; `Codepoint ... not found in
  font` means a glyph is missing from a font table.
- Generated files are generated: `firmware/muse_icons.h` and `muse_icon_glyphs.yaml` by
  `tools/make_icon_table.py`, `firmware/sounds/` by `tools/make_sounds.py`,
  `firmware/figure/` by `tools/make_figure.py` (from the poses in `tools/figure_source/`,
  which `tools/make_figure_source.py` generated once; keep them). Edit the generator.
- Host tests before a flash: `tools/tests/` (C++ parser tests, commands in their headers)
  and `tools/test_render_scene.py`; the web app's `node --test web/test`.
- House-specific things (names, a fixed IP, Meta's figure, optional packages) go into an
  overlay `firmware/*.home.yaml` (`docs/HOME_OVERLAY.md`), never into `muse-esp32-s3-box-3-screen.yaml`.
- Previews in `docs/previews/` are rendered from `scenes/` by `tools/render_scene.py`;
  re-render after a scene changes, with the fixed clock the README names.

## The flash flow in short

1. `cp firmware/secrets.yaml.example firmware/secrets.yaml`, fill it in.
2. `esphome config firmware/muse-esp32-s3-box-3-screen.yaml`, then `esphome compile firmware/muse-esp32-s3-box-3-screen.yaml`.
3. First time over USB: `esphome upload firmware/muse-esp32-s3-box-3-screen.yaml --device /dev/cu.usbmodem*`
   (the BOX-3 shows up as a USB serial device); afterwards OTA by name:
   `--device muse-esp32-s3-box-3-screen.local`.
4. `esphome logs firmware/muse-esp32-s3-box-3-screen.yaml --device muse-esp32-s3-box-3-screen.local` and read the boot.
5. In Home Assistant: Settings, Devices, ESPHome, add `muse-esp32-s3-box-3-screen.local` with the API key.

Full guide with the checks at every step: `docs/FLASHING_WITH_CLAUDE_CODE.md`.
