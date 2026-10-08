# Home Assistant side

The box is an ESPHome device; Home Assistant discovers it and lists its actions as
`esphome.<device>_muse_*` (device `muse-box` gives `esphome.muse_box_muse_show_text`).
Every argument is mandatory in Home Assistant, send `""` where nothing is meant.

- `automations/`: four examples to import or copy (doorbell with photo, garage with a
  live view, someone comes home, waste tomorrow). Replace the entity ids.
- `scripts/muse_weather.yaml`: today's weather as a card; the assistant can call
  `script.muse_weather` instead of composing the weather itself.
- An assistant (Muse, Claude, a Grok bot, anything that can call Home Assistant) uses
  the same actions; see `../docs/ASSISTANT_PROMPT.md` for the text that teaches it, and
  `../tools/muse_box.py` for a command line that wraps them.
