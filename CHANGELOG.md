# Changelog

The version is `esphome: project: version` in `firmware/muse-esp32-s3-box-3-screen.yaml`; the box reports it in `muse_get_state` and on its info screen. Dates are the day the firmware ran on the box. Wrong turns are recorded, because the same mistake comes back otherwise.

## 4.3.0, 8 October 2026

- The project is called Muse ESP32-S3-BOX-3 Screen, after the board's own name; "ESP32BoxS3" is gone. The repository moved to github.com/leopardcodeai/muse-esp32-s3-box-3-screen (both earlier addresses redirect), the firmware file is `firmware/muse-esp32-s3-box-3-screen.yaml`, and the default device name is `muse-esp32-s3-box-3-screen`, so a box flashed from scratch has the actions `esphome.muse_esp32_s3_box_3_screen_muse_*`.
- A box already running under `muse-esp32boxs3-screen` keeps its name, its actions and everything that calls them: set `name: muse-esp32boxs3-screen` in the substitutions of your overlay (docs/HOME_OVERLAY.md). Changing the device name changes every action name, and the prompt your assistant keeps has to change with it.
- Muse Web Screen keeps the device name saved in its settings; only a browser that never saved its settings follows the new default.

## 4.2.0, 8 October 2026

- The figure is the project's own generated character instead of the flat circle drawn in code: a glossy, soft 3D, round blue creature with big eyes, a tuft and tiny hands, the one on the hero picture. OpenAI's `gpt-image-2.5-flare` drew it from that picture and then in five poses (neutral, blink, wave, thinking, celebrating), each as an edit of the first; the PNGs and prompts are in `tools/figure_source/` (`tools/make_figure_source.py`). `tools/make_figure.py` replaces `tools/make_placeholder_figure.py` and animates the poses (bob, breath and blink; sway; an orbiting spark; sparkles; hops and confetti), with the same file names, sizes and frame counts (4,208,768 bytes of RGB565, as before) and the plain page left undithered so it matches the box's background. `tools/render_scene.py` draws the figure from these files, so the previews show it. Muse Web Screen 1.3 shows the same frames by default (`web/figure-default/`, cached by the service worker), with new app icons; the figure drawn in code remains only as the fallback.
- The project is called Muse ESP32BoxS3 Screen, and the box's default device name is `muse-esp32boxs3-screen`, so its actions are `esphome.muse_esp32boxs3_screen_muse_*` (they were `esphome.muse_box_muse_*`). The repository moved to github.com/leopardcodeai/muse-esp32boxs3-screen; the old address redirects. The firmware file is `firmware/muse-esp32boxs3-screen.yaml`, the command line `tools/muse_screen.py`. Home Assistant keeps every entity of a renamed device: their unique ids come from the MAC and the entity name, not the device name. It does keep the old action names until the device's entry is reloaded once.
- Muse Web Screen 1.2: Nur Display (no toolbar, no frame, edge colour, keys F, K, E), Window Controls Overlay when installed from Chrome, `web/tools/serve_local.sh` for a local LaunchAgent at http://localhost:8321, one retry per figure frame.
- docs/MAC_APP.md: Muse Web Screen as a Chrome app on a Mac (local service, install, Nur Display, Window Controls Overlay, floating, your own figure), and `web/tools/set_mac_app_icon.py` for an icon of your own figure on black.
- The firmware's OTA entry has `id: ota_esphome`, so an overlay can drop the OTA encryption for the one bootstrap flash onto a box without a key (docs/HOME_OVERLAY.md).
- The web version is called Muse Web Screen and runs at https://muse-web-screen.vercel.app (demo without setup). New on the web: a frame rate setting (60, 30, or 10 like the box for a side-by-side test), drawing at the screen's pixel ratio, a figure source that can load your own frames from a local folder at run time (never deployed), and a note when an https page is pointed at an http Home Assistant. 83 Node tests.

## 4.1.0, 7 October 2026

- Route maps are stitched from the 256 px tiles of a `{z}/{x}/{y}` server (substitution `map_tiles`, OpenStreetMap's own by default) over one kept TLS connection, with the attribution the tiles require on the card. Measured: 4 tiles in 1.7 to 2.1 s. Until 4.0 the map came as one picture from Wikimedia's map service, whose terms allow that for Wikimedia projects only.
- New substitutions `doorbell_image` and `figure_prefix`; every entity and every TV button has an id, so an overlay can rename it with `!extend` (`docs/HOME_OVERLAY.md`).
- `tools/render_scene.py`: a host renderer of the drawing language, PNG and GIF, with the placeholder figure; the previews in `docs/previews/` come from it. `tools/check_private.py` ignores git-ignored files.
- `web/`: the display as a web app for a Mac, the box's twin: the same parser, cards, timings and particles on a canvas, fed by Home Assistant's `call_service` events or a `muse_web` event, Document Picture-in-Picture to float above other windows, a PWA manifest for the Dock, a demo mode and 60 Node tests.
- First public release of the repository as a whole.
- Three `-Wformat-truncation` notes from the compiler in the display lambda, older than 4.1, are gone: the timer and the info screen format into wider buffers.

## 4.0.0, 7 October 2026

- Timers (`muse_show_timer`, `muse_cancel_timer`, and the voice assistant's own), questions with up to four answers (`muse_choose`), `muse_wait_answer`, lists with ticks (`muse_show_list`), buttons in scenes, swipes (left, right, down), `muse_clear`, `muse_get_state`, responses for every action, the night calm switch, two generated sounds (the chime, the question).
- Measured: a 12 s timer ended after 12.1 s with the chime (media player playing for 1.7 s); `muse_wait_answer` with nobody tapping answered `{"answered": false}` after its 3 s.

## 3.5.3, 7 October 2026

- Sound: the ES8311 and ES7210 codecs are set up by a script 3 s after boot, because both fail at boot although they answer on the bus. Before this version the box had never heard or spoken; the assist satellite had shown only `idle` and `unavailable` for ten days, which earlier notes had read as "listening".
- Touch: tap, swipes, long press, the cuddle on the ready screen, the box info on the top bar; the card queue (twelve cards, three kinds go first).
- Pictures moved into a task on the second core (`muse_media.h`): JPEG at 1/2, 1/4, 1/8 right away, PNG, GIF animations, live views, routes, the day's appointments. The doorbell picture 5.6 s to 0.54 s, a 2880 x 1616 camera picture 27 to 32 s to 2.8 s.
- DNS: with a fixed IP and no `dns1` the box resolved nothing; TLS 1.3 for routing.openstreetmap.de; the peer certificate kept after the handshake; mbedTLS buffers in PSRAM after `spi: Transmit failed - err 101` during handshakes; the decoders in PSRAM after `pngle_new()` ran out of internal RAM.
- Wrong turn recorded: the first diagnosis of the picture failures was "TLS"; it was DNS.

## 3.1.1 and 3.1.0, 7 October 2026

- The drawing language (`muse_draw`, `muse_scene.h`): shapes, text, icons, the figure, particles, frames, timing, parse errors in the response. Comments in scenes end at the line end, `;` included, after a scene with `#` in a colour was cut short.
- Status labels, result cards 20 s instead of 45 s (measured 20.08, 20.02, 20.01 to 20.03 s).

## 3.0.0, 7 October 2026

- The box shows the assistant's figure, status and answers instead of the StackChan face it had worn since August 2026.
- Wrong turn recorded: a local training of German wake words ("Hey Muse", "Muse") was stopped after eight hours; the wake word stays `hey_jarvis` under the display name "Muse".
