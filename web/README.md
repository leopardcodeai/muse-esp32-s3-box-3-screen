# Muse Web: the box's twin on a Mac

The ESP32-S3-BOX-3 of this project shows what the assistant sends: cards, questions, timers and scenes in its own drawing language. `web/` is the same display in a browser: a canvas of 320 x 240 logical pixels, scaled up with its aspect kept, that draws the same cards with the same fonts, colours, positions and timings, parses scenes with the same parser (same commands, keys, defaults, limits and error messages, suggestions included) and plays them ten times a second with the same particle formulas, so a scene looks like it does on the box, only bigger. It mirrors the box through Home Assistant, installs as a Dock app and floats above every other window.

Plain ES modules, no build step, no npm dependencies. Everything in `web/` is English (code, comments, docs); the strings on the display stay German like the box's ([docs/LOCALIZATION.md](../docs/LOCALIZATION.md)).

## Five ways to run it

1. **A file server.** Any static server serves the folder; the page needs no backend of its own. Then open it in Chrome, Edge or Safari.

   ```bash
   cd web
   python3 -m http.server 8321
   open http://localhost:8321/
   ```

2. **Home Assistant's `www` folder.** Copy `web/` to `/config/www/muse-web/` on your Home Assistant and open `http://homeassistant.local:8123/local/muse-web/index.html`. Home Assistant serves the files; the display still talks to Home Assistant through its websocket API, so the settings need the URL and a token like everywhere else. Note that Chrome offers "Install" only on HTTPS or localhost, so over plain HTTP in the LAN use Safari's "Add to Dock" or a file server on the Mac.

3. **Chrome or Edge, installed as an app.** Open the page, then click the install icon at the right end of the address bar, or choose "Install page as app" from the browser menu [3]. The app opens in its own window without browser chrome, has a Dock icon (the figure) and keeps the settings of that browser profile.

4. **Safari, Add to Dock.** macOS Sonoma 14 or later: open the page in Safari and choose File, Add to Dock, or the Share button, then Add to Dock [4]. The web app gets its own window, icon and localStorage; the settings have to be entered once more there.

5. **Demo mode.** `index.html?demo=1` needs no Home Assistant: it plays the twelve scenes of `demo/scenes/` (copies of `../scenes/`) and a round of sample cards (text, value, weather, event, a question, a timer of 15 s, a list, an agenda, a choice, a celebration) in a loop, every item for seven seconds, the timer and the questions for their own time. Anyone sees the app within ten seconds, and the rendering can be checked without credentials.

The four buttons under the display: **Float** (always on top), **Kiosk** (full screen), **Demo** (switches demo mode on or off) and **Einstellungen** (the settings). For the browser console there is `muse.dispatch("show_text", {title: "Hallo", message: "Welt"})`, with every action of the table below.

## Settings

The settings panel opens by itself until a URL and a token are stored. Everything is kept in the `localStorage` of that browser on that machine, nowhere else: this is the person's own Mac, and the token never leaves the page except in the auth message to Home Assistant. A long-lived access token made for this display alone (Home Assistant profile page, Security, Long-lived access tokens [5]) is wise: it can be revoked without touching anything else.

| Setting | Default | What it is |
|---|---|---|
| Home Assistant URL | | `http://homeassistant.local:8123`, or the Tailscale or HTTPS address you use from this Mac |
| Langlebiger Zugriffstoken | | the token; the page sends it once over the websocket and never logs it |
| Gerätename der Box | `muse_box` | the part before `_muse_` in the box's actions: `muse_box` for `esphome.muse_box_muse_show_text` |
| input_text für Antworten | | optional: an `input_text` entity that receives every answer as `<answer>: <question>`, the format of the box's sensor "Antwort" |
| Name in der Leiste | `Muse` | the name at the left of the top bar |
| Nur ganzzahlig vergrößern | off | scale only by whole numbers (2x, 3x), pixel-exact like the box; otherwise the display fills the window |
| Töne | on | the chime when a timer ends and the "pling" when a question appears, generated with Web Audio after the first click on the page |

## How it mirrors the box

The display subscribes to Home Assistant's `call_service` events and reacts to every call whose domain is `esphome` and whose service starts with `<device>_muse_`, with the call's `service_data` as the action's fields. So whatever the assistant, an automation or a script sends to the box appears on the Mac too, without any change in Home Assistant, as long as the box's device is set up there (Home Assistant fires the event when the service exists, even when the box is off at that moment). The actions and fields are the box's ([docs/ACTIONS.md](../docs/ACTIONS.md)): `set_status`, `set_status_text`, `show_text`, `show_value`, `show_weather`, `show_event`, `show_image`, `show_live`, `show_route`, `show_agenda`, `show_list`, `show_timer`, `cancel_timer`, `celebrate`, `draw`, `ask`, `choose`, `clear`. (`muse_wait_answer`, `muse_get_state` and `muse_hw_check` have no screen to show and are ignored.)

A house without a box, or an automation that means only this display, fires the event `muse_web`, whose data carries the action and its fields:

```bash
curl -s -X POST "$HA_URL/api/events/muse_web" \
  -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json" \
  -d '{"action": "show_text", "title": "Erinnerung", "message": "Sam kommt um 18:30."}'

curl -s -X POST "$HA_URL/api/events/muse_web" \
  -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json" \
  -d '{"action": "draw", "scene": "bg #0b1d3a #3a1c5c\ntext 20 70 \"Gute Nacht\" size=xl color=white\nparticles sparkle 30\nseconds 60"}'
```

`$HA_TOKEN` is a token of your own in your shell's environment, never written into a file of this repository. The same from an automation:

```yaml
action: event
event_type: muse_web
event_data:
  action: show_event
  icon: klingel
  title: Es klingelt
  message: Jemand steht vor der Tür.
```

Answers go the other way. A tap on a question's button or on a scene's `button` fires the event `muse_web_answer` with `{answer, question}` (`yes` or `no` for `ask`, the chosen text for `choose`, the button's text with the question `Szene` for a scene; `none` when a question left the screen unanswered), and, when the settings name an `input_text`, sets its value to `<answer>: <question>`:

```yaml
triggers:
  - trigger: event
    event_type: muse_web_answer
    event_data:
      answer: "yes"
```

The dot at the right end of the top bar is the connection: green connected, orange connecting, red off, teal in demo mode. The connection reconnects by itself, waiting 1 s, 2 s, 4 s and so on up to 30 s between tries; a rejected token stops the tries until the settings change.

## Float and Kiosk

**Float** opens a Document Picture-in-Picture window, moves the whole display into it and lets it float above every other app and space; the touch buttons keep working there, pictures and GIFs come along. Chrome and Edge have the API since version 116, Firefox since 151, Safari not at all [1]. Where it is missing, the canvas is streamed into a `<video>` element (`canvas.captureStream()`) that goes into the browser's own video Picture-in-Picture window (Safari since 13.1, Chrome since 69, Firefox since 153 [2]): always on top too, but a video, so a tap does nothing there and pictures, which are elements above the canvas, are not in it; the page says so when it falls back. A second click on the button brings the display back.

**Kiosk** goes full screen, hides the cursor after three seconds without movement and holds a screen wake lock, so the Mac does not dim or lock the display while the page shows. The Screen Wake Lock API needs a secure context (HTTPS or localhost) and is in Chrome and Edge since 84, Safari since 16.4 and Firefox since 126 [6]; where it is missing the page says so and the system's own energy settings apply. Escape leaves kiosk mode.

Both the app window of an installed page and a Document Picture-in-Picture window keep their `requestAnimationFrame` running; a browser tab in the background does not, so the display then advances once a second (timers end, cards give way) and catches up when the tab is visible again.

## Touch

The table of the box, with the mouse or a trackpad: a click moves on to the next card in line (on the ready screen it cuddles the figure: it waves and hearts rise), a drag to the left is the next card, to the right the card before (the last six are kept), down clears every card; a press of 0.7 s clears every card; a click on the top bar shows the display about itself for 15 s; on a question or a scene button, the button under the pointer answers.

## What differs from the box

- No microphone, wake word or voice conversation; the status pill and the figure follow `set_status` and `set_status_text` only. A long press on the ready screen does nothing.
- No radar, climate sensor, battery or Wi-Fi: the top bar shows a connection dot where the box shows battery, Wi-Fi and the microphone dot. No backlight schedule and no night calm.
- Routes: the box asks OpenStreetMap for the way and stitches a map; this display has no map service and shows title, start, destination and the way of travel as a card that says so.
- Pictures, GIFs and live views are an `<img>` element above the canvas (a GIF plays natively); a picture that does not load turns the card into an event card without a status code, because an `<img>` tells none. Live views reload once a second.
- The figure is this repository's placeholder, drawn on the canvas with the geometry and colours of `tools/make_placeholder_figure.py` (16 frames forwards and back at 160 ms, confetti 18 frames once). Meta's Muse artwork is not part of the web display.
- Weather icons are Meteocons 2.0.0 (MIT) as SVG from jsDelivr, drawn as still pictures and cropped to the same common square as the box's PNGs. The scene icons come from the Material Design Icons webfont 7.4.47 on cdnjs, the text from Inter on Google Fonts; nothing is bundled.
- The chime and the question sound are generated with the Web Audio API from the same notes, lengths and envelope as the box's files; browsers play nothing before the first click on the page.
- The service worker caches the files of this folder only (the app shell), never Home Assistant data, fonts or icons; the browser's own cache keeps those. Shell files come from the network when it answers and from the cache when it does not, so an installed app starts without the server and picks up edited files on its next start.
- Fullscreen and the wake lock need a real click on a visible page (browser rules); when a browser refuses them, the kiosk layout still applies and the page says so in the console.

## Add a card type

1. **The card** in `cards.js`: a `drawXyz(r, d, now, clock)` that draws with the renderer (`r.print`, `r.roundRect`, `r.circle`, fonts from `cardFont`, colours from `render.js`), and its mode in `drawCard`. Modes follow the box: 0 status, 1 text, 2 value, 3 celebration, 4 weather, 5 photo, 6 event, 7 scene, 8 question, 9 route, 10 agenda, 11 timer, 12 info, 13 list; the next free number is 14.
2. **The action** in `display.js`: a method that cleans its fields with `clean()` from `text.js`, builds a card with `makeCard({mode, ms, ...})` and hands it to `offer(card)`, which applies the queue rules and answers `{on_screen, waiting}` like the box; add it to `dispatch()` so that the box's service name and the `muse_web` event reach it.
3. **A test** in `test/display.test.js` for its time on screen, and a sample in `demo.js` so that the demo shows it.

Text that an assistant sends goes through `clean()` (weather emojis become an icon, other emojis and Markdown marks go) and `wrap()` or `fitLine()` with the renderer's width function, like on the box.

## Development

- **Tests**: `node --test web/test` from the project root (Node 22 or newer, no packages; an older Node takes the files, `node --test web/test/*.test.js`). They cover the parser against the message cases of `tools/tests/test_muse_scene.cpp` and `tools/test_render_scene.py`, every scene in `scenes/`, frames and timing, the particle hash, the queue rules, the display's timings and touches with a fake clock, the event mapping and the websocket client with fake messages, and the sounds. No real token appears anywhere.
- **Icons**: `node web/tools/make_icon_module.mjs` regenerates `icons.js` from `firmware/muse_icons.h`; the test fails when the two drift apart. `python3 web/tools/make_app_icons.py` draws the app icons in `icons/` from the placeholder figure (needs Pillow).
- **Layout**: a module per concern. `scene.js` the parser, `draw.js` the scene renderer, `particles.js` the particle formulas, `figure.js` the figure, `cards.js` the cards, `text.js` text cleaning and wrapping, `tables.js` the words of the box, `queue.js` and `timers.js` the state, `display.js` the state machine, `render.js` the canvas, `weather.js` and `media.js` the pictures, `ha.js` the connection, `pip.js` Float and Kiosk, `audio.js` the sounds, `demo.js` the demo, `app.js` the page.
- **Before a commit**: `python3 tools/check_private.py` from the project root scans this folder too.

## Third-party work

Loaded at run time from the CDNs named in `index.html`, `style.css` and `weather.js`, each under its own licence: Inter by Rasmus Andersson (SIL OFL 1.1, Google Fonts), Material Design Icons 7.4.47 by Pictogrammers (Apache 2.0, cdnjs), Meteocons 2.0.0 by Bas Milius (MIT, jsDelivr). The project's licence is in [LICENSE](../LICENSE).

## Sources

Accessed on 7 October 2026.

1. MDN, *Document Picture-in-Picture API*: https://developer.mozilla.org/en-US/docs/Web/API/Document_Picture-in-Picture_API (Chrome and Edge 116, Firefox 151, no Safari; browser compatibility data 8.1.4).
2. MDN, *Picture-in-Picture API*: https://developer.mozilla.org/en-US/docs/Web/API/Picture-in-Picture_API (`requestPictureInPicture`: Chrome 69, Edge 79, Safari 13.1, Firefox 153) and *HTMLCanvasElement: captureStream()*: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream (Chrome 51, Safari 11, Firefox 43).
3. Google, *Use web apps* (Chrome Help): https://support.google.com/chrome/answer/9658361 and MDN, *Installing and uninstalling web apps*: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing.
4. Apple, *Use Safari web apps on Mac*: https://support.apple.com/en-us/104996 (macOS Sonoma 14 or later; File, Add to Dock).
5. Home Assistant, *Authentication API*, long-lived access tokens: https://developers.home-assistant.io/docs/auth_api/#long-lived-access-token and the *WebSocket API*: https://developers.home-assistant.io/docs/api/websocket/ (`subscribe_events`, `fire_event`, `call_service`).
6. MDN, *Screen Wake Lock API*: https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API (secure contexts; Chrome and Edge 84, Safari 16.4, Firefox 126).
