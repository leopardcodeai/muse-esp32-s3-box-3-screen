# Actions: what the box can show, hear and answer

Every action is an ESPHome action in Home Assistant, named `esphome.<device>_muse_<action>`
(device `muse-box` gives `esphome.muse_box_muse_show_text`). Home Assistant makes every
argument mandatory; send `""` where nothing is meant. `tools/muse_box.py` wraps all of them.

## Cards wait in line, touch moves on

Since 3.3 a new card waits while another one is on screen; the line holds up to 12. Three
kinds go first: a question, the doorbell, a voice conversation (the card on screen comes
back after it). A card with the title of the one on screen replaces it at once, so the door
photo follows "Es klingelt" without a tap, and a scene replaces a scene.

| Touch | On a card | On the ready screen |
|---|---|---|
| tap | the next card in line, or the status | Muse is cuddled: it waves and wiggles, hearts rise for 2.6 s |
| swipe left | the next card | |
| swipe right | the card before (the last six are kept; the one on screen goes back to the front of the line) | the last card again |
| swipe down | every card gone | |
| long press (0.7 s) | every card gone | Muse listens (voice assistant), unless the mute switch is on |
| tap on the top bar | the box about itself for 15 s: battery, Wi-Fi, room air, uptime, free memory, what waits | the same |
| on a question | the button under the finger answers (yes/no, or one of up to four choices) | |
| on a scene with `button`s | the button under the finger answers with its text (`muse_wait_answer`) | |

Every answer a touch gives lands in `sensor.muse_box_answer` as
`<answer>: <question>` (`none: ...` when a question left the screen unanswered, `<text>:
Szene` for a scene button).
## The actions

An assistant calls these through Home Assistant with its own long-lived token.

| Home Assistant action | Data | Shows |
|---|---|---|
| `esphome.muse_box_muse_set_status` | `status`: `ready`, `listening`, `thinking`, `speaking`, `error`, `off` | the matching animation and pill; `off` dims the display |
| `esphome.muse_box_muse_set_status_text` | `status` as above, `label`: free text | the same animation, and `label` in the pill instead of its default text |
| `esphome.muse_box_muse_show_text` | `title`, `message` | Muse (or a weather icon) with title, the text on a card; line breaks stay |
| `esphome.muse_box_muse_show_weather` | `condition`, `temperature`, `message` | big weather icon, temperature, condition, text below |
| `esphome.muse_box_muse_show_event` | `icon`, `title`, `message` | a coloured disc with an icon, title and text |
| `esphome.muse_box_muse_show_image` | `title`, `message`, `url` | a photo or an animated GIF (section "Pictures"), title and text below |
| `esphome.muse_box_muse_show_live` | `title`, `url`, `seconds` | the picture at `url` again and again for 5 to 120 s: a live camera view |
| `esphome.muse_box_muse_show_route` | `title`, `from`, `to`, `mode` | a map with the way, start green, destination red, distance and time |
| `esphome.muse_box_muse_show_agenda` | `title`, `events` | a calendar sheet and the appointments, one per line of `events` |
| `esphome.muse_box_muse_show_list` | `title`, `items` | a list with ticks, one item per line of `items` |
| `esphome.muse_box_muse_show_timer` | `label`, `duration` | a timer on the box: ring and time left, the chime when it ends |
| `esphome.muse_box_muse_cancel_timer` | `label` | ends the box's own timers: all with `label` empty, else those with that name |
| `esphome.muse_box_muse_ask` | `question`, `yes_label`, `no_label` | a question with two buttons; answers which one was tapped |
| `esphome.muse_box_muse_choose` | `question`, `options` | a question with two to four answers (`options` one per line); answers the chosen text |
| `esphome.muse_box_muse_wait_answer` | `seconds` | nothing; waits up to 60 s for the next answer a touch gives (question or scene button) |
| `esphome.muse_box_muse_clear` | none | every card gone, the line emptied, the status back |
| `esphome.muse_box_muse_get_state` | none | nothing; answers with what the box shows and knows (mode, title, waiting, last answer, listening, muted, presence, battery, timers, volume) |
| `esphome.muse_box_muse_show_value` | `label`, `value`, `unit` | a large value, e.g. `21,5` `°C` |
| `esphome.muse_box_muse_celebrate` | `title`, `message` | confetti once, then the title |
| `esphome.muse_box_muse_draw` | `scene` | a picture of Muse's own design (section "Scenes"); answers with what went wrong |
| `esphome.muse_box_muse_hw_check` | none | nothing; answers with every chip, pin and memory reading (section "Hardware") |
| `media_player.play_media` on `media_player.muse_box_speaker` | a sound or music URL | plays it on the box's speaker (section "Sound") |
| `script.muse_wetter` | none | the current weather from `weather.forecast_home`, today's low and high, when the rain starts |

- `condition`: Home Assistant's weather states (`sunny`, `partlycloudy`,
  `rainy`, `pouring`, `lightning-rainy`, `snowy`, `fog`, `windy`, ...) or a word
  such as "Regen" or "bewölkt".
- `icon`: `klingel`, `garage`, `garage_zu`, `rollladen_runter`,
  `rollladen_hoch`, `mail`, `kalender`, `muell`, `tv_an`, `tv_aus`, `zuhause`,
  `briefkasten`, `tuer`, `nachrichten`, `licht`, `solar`, `timer`, `erledigt`,
  `info`. English names (`doorbell`, `calendar`, `news`, ...) work too.
- `url`: http or https, from the house or the web (section "Pictures").
- Route: `from` and `to` as `"52.5163,13.3777"`, a place name (looked up with
  OpenStreetMap's Nominatim) or `"zuhause"` (zone.home); `mode` `car`, `bike` or `foot`
  (also `auto`, `fahrrad`, `zu fuss`).
- Agenda: `title` empty gives "Heute"; `events` one appointment per line,
  `09:00-10:00 Teammeeting @ Büro`, `ganztägig Urlaub` or `09:00 | Teammeeting | Büro`;
  four per page, the pages turn every 8 s.
- Question: `muse_ask` and `muse_choose` wait up to 25 s for a tap and answer
  `{"answer": ..., "question": ...}` (ask with `?return_response`): `yes`/`no` for
  `muse_ask`, the chosen text for `muse_choose`, `pending` while the question is still on
  screen (it stays 2 min; the answer then lands in the sensor `Antwort`). A short "pling"
  plays when a question appears. Empty labels give "Ja" and "Nein".
- List: `items` one per line, `[x] Milch` done, `[ ] Brot`, `- Brot` or `Brot` open; five per
  page, the pages turn every 8 s; the header counts what is done.
- Timer: `duration` as `5`, `5 min`, `1:30`, `90 s` or `1 h 20 min` (a bare number means
  minutes); `label` names it. Answers `{"ok", "seconds", "timers"}`. The card shows the
  timer that ends first and stays while it runs; a tap moves on and the time left shows in
  the top bar. When it ends: the chime, and "Zeit ist um" with the name for 30 s.
- Every card action answers `{"on_screen": true | false, "waiting": N}`: whether the card
  went up at once or waits behind N others.
- Emojis: the fonts have none. Weather emojis become weather icons, every other
  emoji is dropped; Markdown marks (`**`, `#`, `*` bullets) are cleaned up.

`muse_set_status_text` lets the caller write the pill's text, like the progress text of
the Muse app, for example `{"status": "thinking", "label": "Ich lese deine E-Mails …"}`.
The label is one line: line breaks become spaces, emojis and unsupported characters
are dropped, and text that is wider than the pill (254 px of text, 296 px with the
pill) is cut between two characters and ends with "…". It stays while the status
stays. A new status brings the default text back: a call to `muse_set_status`, the
voice assistant moving on (listening, thinking, speaking), the wave when someone steps
up, an error. An empty `label` gives the default text at once.

Why a second action and why `label`: Home Assistant makes **every** declared argument
of an ESPHome action mandatory (`esphome/manager.py` in HA 2026.9.4, `vol.Required`;
a call without one answers HTTP 400). A `text` on `muse_set_status` would break every
caller that sends only `status`, so that action stays as it is. ESPHome reserves
`text` as a name (`RESERVED_IDS`), hence `label`.

The German status values Muse proposed first (`bereit`, `hoert`, `denkt`,
`spricht`, `fehler`, `aus`) are accepted as well. `muse_show_page` is gone with
the pages.

### Buttons in a scene

A scene (`muse_draw`) may hold `button x y w h "Text" color` (keys `size`, `r`, and the
usual timing keys; `knopf` and `taste` work too). A touch on one answers with its text:
the scene ends, the text lands in the sensor `Antwort`, and `muse_wait_answer` returns it.
So Muse can build its own menus:

```text
bg #1e3c72 #2a5298
text 160 50 "Was möchtest du hören?" size=l color=white align=center
button 20 110 130 50 "Jazz" purple
button 170 110 130 50 "Rock" orange
button 20 170 130 50 "Klassik" teal
button 170 170 130 50 "Nichts" gray
seconds 60
```

Then `muse_wait_answer` with `seconds: 30` answers `{"answered": true, "answer": "Jazz"}`,
or `{"answered": false, "answer": ""}` when nobody tapped in time.
## Pictures

Since 3.4 a task of its own on the second core loads and decodes photos, GIFs, live views
and route maps (`muse_media.h`); the display only copies the finished picture, so nothing
on the box waits for a download any more.

- **Formats** come from the file's first bytes, not from its Content-Type: baseline JPEG,
  progressive JPEG (only its first scan, so at 1/8 of its size and blurred), PNG (with
  transparency over the page colour), GIF (animated, with the frame times of the file,
  looping while the card shows, at most 480 px wide). WebP does not decode.
- **JPEG is reduced while it decodes** (1/2, 1/4, 1/8), as far as it still covers 300 ×
  168. Measured on 07.10.2026: the doorbell picture 1152 × 864 in 0.54 s (online_image
  took 5.6 s), the garage camera 2880 × 1616 in 2.8 s (27 to 32 s), a picture from the
  web in 3.8 s, most of it the TLS handshake. A GIF of 1 MB (400 × 400, 44 frames) loaded
  in 6.3 s and played.
- **Live view**: HA's `camera_proxy` with the camera's token and `&width=300&height=168`
  gave 18 pictures in 15 s.
- **Routes** come from routing.openstreetmap.de (OSRM on OpenStreetMap data, TLS 1.3
  only); the map is stitched from the 256 px tiles of the server in the substitution
  `map_tiles` (OpenStreetMap's own by default, 320 × 210 below the status bar, up to six
  tiles over one kept connection), and the box draws the way, the two points and the
  tiles' attribution itself. Start and destination leave the house with these requests.
  Measured with the static map of 3.4: 1.4 km on foot, 19 min, the card in about 7 s.
- **Limits**: 3 MB per file, 15 s timeout, five redirects. A file that does not come or
  does not decode turns the card into an event card with the reason ("Bild: HTTP 404",
  "Route: ..."), and the log says the same (`muse.media`).
## Sound

Since 3.2 the box has a media player, `media_player.muse_box_speaker`
("Lautsprecher"): sounds and music from a URL, Home Assistant's TTS, Music Assistant.
Home Assistant converts what it sends to FLAC, so OGG, MP3 or WAV all play. An
announcement lays itself over music, which steps back by 20 dB meanwhile. The voice
assistant speaks through the same player. Volume 30 to 90 %, 60 % at start.

The box's own sounds are generated, not downloaded: `make_muse_sounds.py` writes
`sounds/timer.wav` (three rising tones, 1.1 s) and `sounds/ask.wav` (one "pling",
0.35 s), 16 kHz mono, 46 KB of flash together; the media player embeds them (`files:`) and
plays them as announcements over anything else.

Until 3.2 the box made no sound and heard nothing: the audio chips were never set up and
the amplifier was off (section "Hardware"). Both chips fail to set up at boot although
they answer on the bus; the script `audio_init` sets them up again three seconds after
boot until they answer right (first try on every boot since), then starts the speaker
and keeps it running, because starting it with the amplifier on clicked before the first
sound.
