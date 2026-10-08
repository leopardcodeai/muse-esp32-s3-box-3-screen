# Muse Web Screen: the box's twin in the browser

The ESP32-S3-BOX-3 of the [Muse ESP32-S3-BOX-3 Screen](https://github.com/leopardcodeai/muse-esp32-s3-box-3-screen) (the box `muse-esp32-s3-box-3-screen`) shows what the assistant sends: cards, questions, timers and scenes in its own drawing language. `web/` is the same display in a browser, **Muse Web Screen**: a canvas of 320 x 240 logical pixels, scaled up with its aspect kept and drawn at the screen's own resolution, that draws the same cards with the same fonts, colours, positions and timings, parses scenes with the same parser (same commands, keys, defaults, limits and error messages, suggestions included) and plays them with the same particle formulas. The box draws ten pictures a second; the web display draws up to 60 (a setting, with a box-exact 10 for the side-by-side test), always from the time in milliseconds, so a scene looks like it does on the box, only bigger and smoother. It mirrors the box through Home Assistant, installs as a Dock app and floats above every other window.

**Hosted:** https://muse-web-screen.vercel.app opens in demo mode on a first visit, without any Home Assistant (see [Connecting from the hosted page](#connecting-from-the-hosted-page) before you enter a Home Assistant URL there).

Plain ES modules, no build step, no npm dependencies. Everything in `web/` is English (code, comments, docs); the strings on the display stay German like the box's ([docs/LOCALIZATION.md](../docs/LOCALIZATION.md)).

## Six ways to run it

1. **The hosted page.** https://muse-web-screen.vercel.app, a static copy of this folder on Vercel (see [Hosting on Vercel](#hosting-on-vercel)). A first visit without stored settings lands in demo mode (`index.html?demo=1`); "Demo aus" and the settings lead out of it. HTTPS, so Chrome offers "Install" and the wake lock works; reaching a Home Assistant in the LAN from there has limits, see [Connecting from the hosted page](#connecting-from-the-hosted-page).

2. **A file server on this Mac.** Any static server serves the folder; the page needs no backend of its own. Then open it in Chrome, Edge or Safari. `http://localhost` counts as a secure origin, so this page may open `ws://` to Home Assistant in the LAN and gets "Install" and the wake lock as well.

   ```bash
   cd web
   python3 -m http.server 8321
   open http://localhost:8321/
   ```

3. **Home Assistant's `www` folder.** Copy `web/` to `/config/www/muse-web/` on your Home Assistant and open `http://homeassistant.local:8123/local/muse-web/index.html`. Home Assistant serves the files; the display still talks to Home Assistant through its websocket API, so the settings need the URL and a token like everywhere else. Note that Chrome offers "Install" only on HTTPS or localhost, so over plain HTTP in the LAN use Safari's "Add to Dock" or a file server on the Mac.

4. **Chrome or Edge, installed as an app.** Open the page, then click the install icon at the right end of the address bar, or choose "Install page as app" from the browser menu [3]. The app opens in its own window without browser chrome, has a Dock icon (the figure) and keeps the settings of that browser profile.

5. **Safari, Add to Dock.** macOS Sonoma 14 or later: open the page in Safari and choose File, Add to Dock, or the Share button, then Add to Dock [4]. The web app gets its own window, icon and localStorage; the settings have to be entered once more there.

6. **Demo mode.** `index.html?demo=1` needs no Home Assistant: it plays the twelve scenes of `demo/scenes/` (copies of `../scenes/`) and a round of sample cards (text, value, weather, event, a question, a timer of 15 s, a list, an agenda, a choice, a celebration) in a loop, every item for seven seconds, the timer and the questions for their own time. Anyone sees the app within ten seconds, and the rendering can be checked without credentials. A page without stored settings starts here by itself; `?demo=0` stays out.

The four buttons under the display: **Float** (always on top), **Kiosk** (full screen), **Demo** (switches demo mode on or off) and **Einstellungen** (the settings). For the browser console there is `muse.dispatch("show_text", {title: "Hallo", message: "Welt"})`, with every action of the table below, and `muse.fps(10)` to switch the frame rate until the next reload.

## Your own screen on your Mac (local, with your own figure)

Step by step, with the icon and the reasons for Chrome over Safari: [../docs/MAC_APP.md](../docs/MAC_APP.md).

`web/tools/serve_local.sh --install` serves this folder at http://localhost:8321 from a LaunchAgent (127.0.0.1 only, started at login). From there the page may open `ws://` to Home Assistant on your LAN, which a page from https may not. Put your own figure frames into `web/local/` (git and Vercel ignore that folder; for Meta's Muse frames run `tools/make_muse_assets.py` and copy `firmware/figure/muse_*.png`), and set the figure source to `http://localhost:8321/local`.

**Nur Display** (setting, or `?bare=1`): no toolbar and no frame; the strip beside the display takes the colour of the display's edge, and the toolbar appears while the pointer is near the bottom edge. Keys: F floats the display above every window (Picture in Picture), K full screen, E settings. Installed from Chrome ("Install page as app"), the app draws into its own title bar (Window Controls Overlay) and only the three window buttons remain. In Chrome the floating window stays clickable (Document Picture-in-Picture); Safari can float only a video of the display, which cannot be clicked.

## Settings

The settings panel opens by itself until a URL and a token are stored (outside demo mode). Everything is kept in the `localStorage` of that browser on that machine, nowhere else: the token never leaves the page except in the auth message to Home Assistant, also on the hosted page, whose server only ever delivers the static files. A long-lived access token made for this display alone (Home Assistant profile page, Security, Long-lived access tokens [5]) is wise: it can be revoked without touching anything else.

| Setting | Default | What it is |
|---|---|---|
| Home Assistant URL | | `http://homeassistant.local:8123`, or the Tailscale or HTTPS address you use from this machine; on the hosted page an `http://` address shows a note why the browser may refuse it |
| Langlebiger Zugriffstoken | | the token; the page sends it once over the websocket and never logs it |
| Gerätename der Box | `muse_esp32_s3_box_3_screen` | the part before `_muse_` in the box's actions: `muse_esp32_s3_box_3_screen` for `esphome.muse_esp32_s3_box_3_screen_muse_show_text` |
| input_text für Antworten | | optional: an `input_text` entity that receives every answer as `<answer>: <question>`, the format of the box's sensor "Antwort" |
| Name in der Leiste | `Muse` | the name at the left of the top bar |
| Bildrate | 60 | pictures a second: 60 (smooth), 30, or 10, exactly like the box, for the side-by-side test; `?fps=10` in the URL does the same for one visit |
| Figur-Quelle | Figur des Projekts | the project's own figure (`figure-default/`), or "Eigene Bilder aus einem Ordner" with its folder URL (see [The figure](#the-figure)) |
| Nur ganzzahlig vergrößern | off | scale only by whole numbers (2x, 3x), pixel-exact like the box; otherwise the display fills the window |
| Töne | on | the chime when a timer ends and the "pling" when a question appears, generated with Web Audio after the first click on the page |

## Smoother than the box

The box redraws its display every 100 ms (`interval: 100ms` in the firmware). The web display draws on the browser's animation frames at the chosen rate, 60, 30 or 10 pictures a second, through a frame clock that keeps a timeline of due times, so 10 stay 10 and 60 stay 60 on a 60 Hz, 120 Hz or 144 Hz screen (`pace.js`). Nothing in the display counts pictures: cards, timers, scenes, transitions, typed text, particles and the cuddle hearts are all computed from the time in milliseconds, so a scene keeps its timing at every rate and only gets smoother.

The figure follows the box's own pace. In a scene the box takes the frame from the scene's time, one step per 160 ms; on the ready screen and the celebration it steps once 160 ms have passed, checked on its 100 ms ticks, which is a step every 200 ms. The web display uses the same two paces and shows the figure's frames as they are, at every rate: they are pictures, there is nothing between two of them to draw. Only the figure drawn in code (`figure.js`, while the frames load or when they fail) is drawn between its 16 frames above 10 pictures a second.

The canvas is drawn at the device pixel ratio: the stage is a whole number of CSS pixels (the scale is a multiple of 1/80, so 320 x 240 times it stays whole), the canvas behind it has that size times `devicePixelRatio` in device pixels, and everything is drawn there in the 320 x 240 logical layout. Text and lines are sharp on a Retina screen instead of being an enlarged 320 x 240 picture, and the page redraws when the window moves to a screen with another pixel ratio. The display about itself (a tap on the top bar) shows the canvas pixels under "Anzeige" and the rate beside the browser.

## The figure

The hosted page and this repository carry only the project's own figure: six animated PNGs in `figure-default/`, byte for byte the files the box embeds (`firmware/figure/`, built by `tools/make_figure.py` from poses an image model drew, see the main README). The page loads them from its own server at the start, the service worker keeps them with the app shell, and `?figure=placeholder` shows them for one visit whatever the setting says. Until they are there, and for a picture that fails, `figure.js` draws the flat round figure the project had before. A test fails when `figure-default/` and `firmware/figure/` differ, and `tools/check_private.py` refuses a file there that is not the project's. Meta's Muse artwork is excluded from every licence Meta grants for the Muse SDK (its README: "The Apache License does not cover the Jollybot avatar"), so its frames, GIFs and the Muse app's videos never go into `web/`, a commit or a deployment.

An owner who has made his own frames with `tools/make_muse_assets.py` (they land in `firmware/figure/` as `muse_idle.png`, `muse_wave.png`, `muse_working.png`, `muse_making.png`, `muse_confetti.png` and `muse_avatar.png`, animated PNGs of 160 x 160, the avatar 72 x 72, all ignored by git) can show them in his own browser:

```bash
python3 web/tools/serve_frames.py
```

serves exactly those six files from `firmware/figure/` on `http://127.0.0.1:8322`, with `Access-Control-Allow-Origin: *`, and nothing else of the folder; `--dir` names another folder, `--port` another port, `--placeholder` serves the project's own frames under the same names to try it without Meta's artwork. Then, in the settings: Figur-Quelle "Eigene Bilder aus einem Ordner", Ordner-URL `http://127.0.0.1:8322`. The page loads the six pictures at run time into that browser's memory; the server of the page gets nothing of them, and `.vercelignore` and `web/.gitignore` keep `muse_*.png`, `*.apng` and folders named `local/`, `figure/` or `frames/` out of every deployment and commit.

From the hosted HTTPS page, `http://127.0.0.1` is not mixed content (browsers count this machine as secure [7]), but Chrome and Edge ask once whether the page may reach apps on this device (Local Network Access [8]); allow it. The local file server of way 2 needs no such question.

The frames are played as the box plays them: idle, wave, working and making forwards and backwards, one step per 160 ms in a scene and 200 ms on the cards, confetti once, the avatar as a still. That needs control over every frame, which an `<img>` does not give (it plays the file's own order at the file's 167 ms delays on its own clock), and WebCodecs' `ImageDecoder` is not available in every browser [9]. So `apng.js` reads the file itself: every frame becomes a small standalone PNG that the browser decodes, composited on a canvas with the frame's offset, blend and dispose rules (Pillow writes only the changed rectangle of each frame), and kept as an `ImageBitmap`. The project's and the owner's frames are shown frame by frame also at 60 pictures a second; a picture of the owner's that does not load leaves the project's in its place, and the settings say how many arrived.

## Connecting from the hosted page

What holds in October 2026:

- **Mixed content.** A page served over HTTPS may not open an unencrypted connection: `ws://` from an `https://` page is blockable mixed content, and Safari and Firefox refuse it. Only this machine is exempt, `http://localhost` and `http://127.0.0.1` count as secure [7].
- **Chrome and Edge: Local Network Access.** Since Chrome 142 a public site needs the person's permission to reach the local network or this device, with a prompt instead of the earlier Private Network Access preflights [8]. Since Chrome and Edge 147 (April 2026) that covers WebSockets too, and a `ws://` URL to a private IP literal or a `.local` name is let through the mixed-content check once the permission is given [10]; Chrome 154 (22 September 2026) added `targetAddressSpace` to the WebSocket constructor for a host name that resolves into the local network [11]. The display passes that option itself when an HTTPS page opens `ws://` to such a name (`ha.js`), and opens a plain socket in a browser that does not know it. In the Local Network Access specification the Tailscale range 100.64.0.0/10 counts as local [12], so the same prompt comes for a Tailscale address, also over `wss://`.

So from the hosted page in Chrome or Edge, `http://homeassistant.local:8123` or the LAN IP of Home Assistant can work after "Allow" in the prompt; in Safari and Firefox it cannot, and a denied prompt or a managed browser that suppresses prompts blocks it silently. When the page is served over HTTPS and the URL starts with `http://`, the settings say so in one sentence. The two ways that work everywhere:

1. **Run the app locally.** `python3 -m http.server 8321` in `web/` and `http://localhost:8321/` (way 2 above), or the installed app from that address. A page on localhost may open `ws://` to the LAN without any prompt, because a request from this device into the local network is not one from a public site.
2. **Give Home Assistant an HTTPS address and use it with `https://` (the display then opens `wss://`).** With the Tailscale add-on: switch on Tailscale Serve for Home Assistant (`share_homeassistant`), enable MagicDNS and HTTPS certificates on the DNS page of the Tailscale admin console, and in Home Assistant, Settings, System, Network, HTTP server, Reverse proxy, turn on "Trust X-Forwarded-For" and add `127.0.0.1` as a trusted proxy; the URL is then `https://homeassistant.example.ts.net` without a port [13]. `tailscale serve` on any other host does the same. Home Assistant Cloud (Nabu Casa) gives a public HTTPS address that needs no prompt at all. In Chrome the Tailscale address still asks for local network access once, because it is in 100.64.0.0/10.

Demo mode needs none of this and works on the hosted page as it is.

## Hosting on Vercel

`web/` is a static site with `web/` as the root: no install, no build (`vercel.json`: `framework: null`, empty `installCommand` and `buildCommand`, `outputDirectory: "."`).

- **Headers** (`vercel.json`): `sw.js` and `manifest.webmanifest` with `Cache-Control: no-cache`, so a new service worker and manifest are seen on the next visit; `icons/` for 30 days; a `fonts/` folder for a year, should fonts ever be bundled (today they come from Google Fonts and cdnjs with their own long caching); every other file with Vercel's default (revalidate every time).
- **Content-Security-Policy**: scripts only from the page itself; styles from the page and Google Fonts; fonts from Google Fonts (`fonts.gstatic.com`) and cdnjs (Material Design Icons); `connect-src` for `https:`, `wss:` and `ws:` so any Home Assistant URL the person enters works, plus `http://127.0.0.1:*` and `http://localhost:*` for the figure frames; `img-src` for `https: http: data: blob:`, because pictures and the Meteocons come from arbitrary URLs; no objects, no framing. Float copies the style sheets into its window as links, not as inline styles, because the window inherits this policy.
- **What is uploaded** (`.vercelignore`): everything is left out first and only `index.html`, the `*.js` modules, `style.css`, `manifest.webmanifest`, `icons/`, `demo/` and `figure-default/` come back; `muse_*.png`, `*.apng` and folders named `local/`, `figure/` or `frames/` never go, wherever they sit. The tests, `tools/`, this README and `package.json` stay at home.
- **The landing**: `/` goes to `index.html?demo=1` only when that browser has no stored settings, decided in `app.js` (a server redirect cannot see `localStorage`).

Deploying (the Vercel CLI, logged in; the link writes `web/.vercel/`, which `web/.gitignore` keeps out of git):

```bash
python3 tools/check_private.py                       # from the project root: no token, no private address
cd web
vercel link --yes --project muse-web-screen
vercel deploy --prod --yes
```

## How it mirrors the box

The display subscribes to Home Assistant's `call_service` events and reacts to every call whose domain is `esphome` and whose service starts with `<device>_muse_`, with the call's `service_data` as the action's fields. The device is `muse_esp32_s3_box_3_screen` unless the settings say otherwise: the box's ESPHome name `muse-esp32-s3-box-3-screen` with underscores, so `esphome.muse_esp32_s3_box_3_screen_muse_show_text` arrives here as `show_text` (one constant in the code, `DEFAULT_DEVICE` in `ha.js`). So whatever the assistant, an automation or a script sends to the box appears in the browser too, without any change in Home Assistant, as long as the box's device is set up there (Home Assistant fires the event when the service exists, even when the box is off at that moment). The actions and fields are the box's ([docs/ACTIONS.md](../docs/ACTIONS.md)): `set_status`, `set_status_text`, `show_text`, `show_value`, `show_weather`, `show_event`, `show_image`, `show_live`, `show_route`, `show_agenda`, `show_list`, `show_timer`, `cancel_timer`, `celebrate`, `draw`, `ask`, `choose`, `clear`. (`muse_wait_answer`, `muse_get_state` and `muse_hw_check` have no screen to show and are ignored.)

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

**Float** opens a Document Picture-in-Picture window, moves the whole display into it and lets it float above every other app and space; the touch buttons keep working there, pictures and GIFs come along. Chrome and Edge have the API since version 116, Firefox since 151, Safari not at all [1]. Where it is missing, the canvas is streamed into a `<video>` element (`canvas.captureStream()` at the frame rate of the settings) that goes into the browser's own video Picture-in-Picture window (Safari since 13.1, Chrome since 69, Firefox since 153 [2]): always on top too, but a video, so a tap does nothing there and pictures, which are elements above the canvas, are not in it; the page says so when it falls back. A second click on the button brings the display back.

**Kiosk** goes full screen, hides the cursor after three seconds without movement and holds a screen wake lock, so the Mac does not dim or lock the display while the page shows. The Screen Wake Lock API needs a secure context (HTTPS or localhost) and is in Chrome and Edge since 84, Safari since 16.4 and Firefox since 126 [6]; where it is missing the page says so and the system's own energy settings apply. Escape leaves kiosk mode.

Both the app window of an installed page and a Document Picture-in-Picture window keep their `requestAnimationFrame` running (the drawing loop moves with the display into the floating window and back); a browser tab in the background does not, so the display then advances once a second (timers end, cards give way) and catches up when the tab is visible again.


## Touch

The table of the box, with the mouse or a trackpad: a click moves on to the next card in line (on the ready screen it cuddles the figure: it waves and hearts rise), a drag to the left is the next card, to the right the card before (the last six are kept), down clears every card; a press of 0.7 s clears every card; a click on the top bar shows the display about itself for 15 s; on a question or a scene button, the button under the pointer answers.


## What differs from the box

- No microphone, wake word or voice conversation; the status pill and the figure follow `set_status` and `set_status_text` only. A long press on the ready screen does nothing.
- No radar, climate sensor, battery or Wi-Fi: the top bar shows a connection dot where the box shows battery, Wi-Fi and the microphone dot. No backlight schedule and no night calm.
- Routes: the box asks OpenStreetMap for the way and stitches a map; this display has no map service and shows title, start, destination and the way of travel as a card that says so.
- Pictures, GIFs and live views are an `<img>` element above the canvas (a GIF plays natively); a picture that does not load turns the card into an event card without a status code, because an `<img>` tells none. Live views reload once a second.
- Up to 60 pictures a second instead of 10 (see [Smoother than the box](#smoother-than-the-box)); at 10 the display draws what the box draws.
- The figure is the project's own, the box's frames in `figure-default/` (16 frames forwards and back, confetti 18 frames once), or the owner's own frames from a folder on his machine (see [The figure](#the-figure)). Meta's Muse artwork is not part of the web display.
- Weather icons are Meteocons 2.0.0 (MIT) as SVG from jsDelivr, drawn as still pictures and cropped to the same common square as the box's PNGs. The scene icons come from the Material Design Icons webfont 7.4.47 on cdnjs, the text from Inter on Google Fonts; nothing is bundled.
- The chime and the question sound are generated with the Web Audio API from the same notes, lengths and envelope as the box's files; browsers play nothing before the first click on the page.
- The service worker caches the files of this folder only (the app shell, the project's figure included), never Home Assistant data, fonts, icons or the owner's figure frames; the browser's own cache keeps the fonts. Shell files come from the network when it answers and from the cache when it does not, so an installed app starts without the server and picks up edited files on its next start.
- Fullscreen and the wake lock need a real click on a visible page (browser rules); when a browser refuses them, the kiosk layout still applies and the page says so in the console.

## Add a card type

1. **The card** in `cards.js`: a `drawXyz(r, d, now, clock)` that draws with the renderer (`r.print`, `r.roundRect`, `r.circle`, fonts from `cardFont`, colours from `render.js`), and its mode in `drawCard`. Modes follow the box: 0 status, 1 text, 2 value, 3 celebration, 4 weather, 5 photo, 6 event, 7 scene, 8 question, 9 route, 10 agenda, 11 timer, 12 info, 13 list; the next free number is 14.
2. **The action** in `display.js`: a method that cleans its fields with `clean()` from `text.js`, builds a card with `makeCard({mode, ms, ...})` and hands it to `offer(card)`, which applies the queue rules and answers `{on_screen, waiting}` like the box; add it to `dispatch()` so that the box's service name and the `muse_web` event reach it.
3. **A test** in `test/display.test.js` for its time on screen, and a sample in `demo.js` so that the demo shows it.

Text that an assistant sends goes through `clean()` (weather emojis become an icon, other emojis and Markdown marks go) and `wrap()` or `fitLine()` with the renderer's width function, like on the box.


## Development

- **Tests**: `node --test web/test` from the project root (Node 22 or newer, no packages; an older Node takes the files, `node --test web/test/*.test.js`). They cover the parser against the message cases of `tools/tests/test_muse_scene.cpp` and `tools/test_render_scene.py`, every scene in `scenes/`, frames and timing, the particle hash, the queue rules, the display's timings and touches with a fake clock, the event mapping and the websocket client with fake messages (the device name, the local hint for an HTTPS page), the sounds, the settings and the landing in demo mode, the frame clock on 60, 120 and 144 Hz, the figure's pace like the box's, the order of the figure's sources, `figure-default/` against `firmware/figure/`, and the APNG decoder on the project's figure. They also fail when this README or the settings dialog names another device than `DEFAULT_DEVICE`. No real token appears anywhere.
- **Icons**: `node web/tools/make_icon_module.mjs` regenerates `icons.js` from `firmware/muse_icons.h`; the test fails when the two drift apart. `uv run --python 3.14 --with pillow --with numpy web/tools/make_app_icons.py` draws the app icons in `icons/` and `docs/screens/mac-app-icon.png` from the project's figure (its neutral pose).
- **Figure frames**: `python3 web/tools/serve_frames.py` (see [The figure](#the-figure)).
- **Layout**: a module per concern. `scene.js` the parser, `draw.js` the scene renderer, `particles.js` the particle formulas, `figure.js` the figure's pace and the figure drawn in code, `figure_frames.js` the figure's sources (`figure-default/`, the owner's folder), `apng.js` the APNG decoder, `cards.js` the cards, `text.js` text cleaning and wrapping, `tables.js` the words of the box, `queue.js` and `timers.js` the state, `display.js` the state machine, `render.js` the canvas, `pace.js` the frame clock and the scale, `weather.js` and `media.js` the pictures, `ha.js` the connection (and `DEFAULT_DEVICE`), `settings.js` the stored settings, `pip.js` Float and Kiosk, `audio.js` the sounds, `demo.js` the demo, `app.js` the page.
- **Before a commit or a deploy**: `python3 tools/check_private.py` from the project root scans this folder too.

## Third-party work

Loaded at run time from the CDNs named in `index.html`, `style.css` and `weather.js`, each under its own licence: Inter by Rasmus Andersson (SIL OFL 1.1, Google Fonts), Material Design Icons 7.4.47 by Pictogrammers (Apache 2.0, cdnjs), Meteocons 2.0.0 by Bas Milius (MIT, jsDelivr). The project's licence is in [LICENSE](../LICENSE).

## Sources

Accessed on 7 October 2026 (1 to 6) and 8 October 2026 (7 to 14).

1. MDN, *Document Picture-in-Picture API*: https://developer.mozilla.org/en-US/docs/Web/API/Document_Picture-in-Picture_API (Chrome and Edge 116, Firefox 151, no Safari; browser compatibility data 8.1.4).
2. MDN, *Picture-in-Picture API*: https://developer.mozilla.org/en-US/docs/Web/API/Picture-in-Picture_API (`requestPictureInPicture`: Chrome 69, Edge 79, Safari 13.1, Firefox 153) and *HTMLCanvasElement: captureStream()*: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream (Chrome 51, Safari 11, Firefox 43).
3. Google, *Use web apps* (Chrome Help): https://support.google.com/chrome/answer/9658361 and MDN, *Installing and uninstalling web apps*: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing.
4. Apple, *Use Safari web apps on Mac*: https://support.apple.com/en-us/104996 (macOS Sonoma 14 or later; File, Add to Dock).
5. Home Assistant, *Authentication API*, long-lived access tokens: https://developers.home-assistant.io/docs/auth_api/#long-lived-access-token and the *WebSocket API*: https://developers.home-assistant.io/docs/api/websocket/ (`subscribe_events`, `fire_event`, `call_service`).
6. MDN, *Screen Wake Lock API*: https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API (secure contexts; Chrome and Edge 84, Safari 16.4, Firefox 126).
7. MDN, *Mixed content*: https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content (last modified 15 August 2026: blockable content is all mixed content that is not upgradable; loopback addresses such as `http://127.0.0.1/` and `http://localhost/` count as secure origins).
8. Chrome for Developers, *New permission prompt for Local Network Access*: https://developer.chrome.com/blog/local-network-access (9 June 2025, updated 29 September 2025: the prompt launches in Chrome 142; private IP literals and `.local` names are exempt from mixed-content checks once permitted).
9. MDN, *ImageDecoder*: https://developer.mozilla.org/en-US/docs/Web/API/ImageDecoder (not Baseline; secure contexts only).
10. blink-dev, *Intent to Ship: Local network access restrictions for WebSockets*: https://groups.google.com/a/chromium.org/g/blink-dev/c/O6GMKt44Ups (19 February 2026; shipping in Chrome 147; explicit local IP addresses and `.local` domains exempted from mixed-content checks).
11. Chrome for Developers, *Chrome 154 release notes*: https://developer.chrome.com/release-notes/154 (stable 22 September 2026; `WebSocketInit` and `targetAddressSpace` in the WebSocket constructor, to bypass mixed-content restrictions for local servers once permitted).
12. WICG, *Local Network Access*: https://wicg.github.io/local-network-access/ (the address space table: 100.64.0.0/10, carrier-grade NAT, is local; WebSockets fall under the same permission).
13. Home Assistant Community Add-ons, *Tailscale* documentation: https://github.com/hassio-addons/addon-tailscale/blob/main/tailscale/DOCS.md (`share_homeassistant` with Tailscale Serve, HTTPS certificates in the admin console, the reverse proxy settings of Home Assistant).
14. Vercel, *Static Configuration with vercel.json*: https://vercel.com/docs/project-configuration/vercel-json (`framework: null` for "Other", an empty `installCommand` skips the install, `headers`).
