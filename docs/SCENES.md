# Scenes: the drawing language

`muse_draw` takes one argument, `scene`: a picture described in lines of text, so that
Muse decides what the screen looks like instead of filling a fixed card. The canvas is
the whole screen, 320 × 240 px, x to the right and y down from the top left corner. The
box parses a scene once (`muse_scene.h`), draws it ten times a second (`draw_scene` in
`muse.h`) and answers with what it did not understand. Background: the project history.

```text
bg #0b1d3a #3a1c5c
circle 252 58 26 #ffd166 pulse=3000
text 20 70 "Gute Nacht, Sam" size=xl color=white
text 20 118 "Morgen 7 Grad, ab 10 Uhr Sonne" color=#c9d6ff w=280
icon 40 190 weather-night color=#c9d6ff
particles sparkle 30
seconds 60
```

- One command per line, or several separated by `;`. A comment runs to the end of its
  line, `;` included: a line that starts with `#` or `//`, or after a command `# ` (with
  a space, so `#fff` stays a colour) or `//`.
- Values in the order of the table, or as `key=value` in any order. Values with spaces
  go in "double" or 'single' quotes, where `\n` is a line break. At the end of a `text`
  line the text may also stand without quotes.
- Later elements cover earlier ones.
- A mistake does not stop the scene. An element that cannot be drawn is left out, the
  rest draws, and the response names each mistake with its line, with the closest valid
  word where there is one (`line 1: icon: no icon 'kafee'; did you mean 'kaffee'?`).

| Command | Values in order | More keys | Draws |
|---|---|---|---|
| `bg` | `color` `to` | `dir=down` or `right` | the background; with `to` a gradient |
| `rect` | `x y w h color` | `r` (corner radius, or `pill`), `line` (outline width) | a rectangle, top left corner at x y |
| `circle` | `x y r color` | `line`, `pulse` | a circle around x y |
| `line` | `x y x2 y2 color` | `w` (width) | a line with round ends |
| `tri` | `x y x2 y2 x3 y3 color` | `line` | a triangle |
| `star` | `x y r color` | `points` (5), `inner` (0.45), `rot`, `spin`, `pulse`, `line` | a star around x y |
| `poly` | `x y r sides color` | `rot`, `spin`, `pulse`, `line` | a regular polygon |
| `text` | `x y text` | `size`, `color`, `align`, `valign`, `w` (wrap width), `lines` (at most, then "…"), `lh` (line height), `type` | text; x y is its top left corner, its top centre with `align=center`, its top right with `align=right` |
| `icon` | `x y name color` | `size=s` or `l` (24 or 46 px) | an icon centred on x y |
| `muse` | `x y anim` | `r` (frame radius, at most 80) | Muse's figure, 160 px, centred on x y; `anim`: `idle`, `wave`, `working`, `making`, `avatar` |
| `bar` | `x y w h value color` | `bg` (track colour), `r` | a progress bar, `value` 0 to 100 |
| `particles` | `kind count color` | `icon`, `size`, `x y w h` (area), `speed` | `confetti`, `snow`, `rain`, `sparkle` or `bubbles`; with `icon=heart` every particle is that icon |
| `seconds` | `n` | | how long the scene stays, 3 to 3600; 20 when not given |
| `frame` | `ms` | | starts the next frame of an animation (500 ms when not given); `frame end` goes back to elements shown in every frame |
| `once` | | | the frames play once and the last one stays |

Every element also takes:

| Key | Effect |
|---|---|
| `opacity` | 0 to 1, or a percentage |
| `delay` | ms after the start before it appears |
| `dur` | ms it stays once it is there (0 or none: to the end) |
| `fade` | ms to fade in, and to fade out at the end of `dur` |
| `blink` | ms on, then as long off |
| `move=dx,dy` | glides by dx, dy and back once every `period` ms (3000) |
| `spin` | ms per turn (star, poly) |
| `pulse` | ms per breath, 12 % larger and smaller (circle, star, poly) |
| `type` | ms per character, like a typewriter (text) |

- **Colours:** `#rgb`, `#rrggbb`, `#rrggbbaa` (the alpha becomes the opacity) or a
  name: `white`, `black`, `ink`, `page`, `gray`, `lightgray`, `darkgray`, `red`,
  `orange`, `yellow`, `gold`, `green`, `mint`, `teal`, `cyan`, `blue`, `navy`, `indigo`,
  `purple`, `pink`, `brown`. `page` is the light grey (243, 243, 243) of Muse's screens.
- **Text sizes:** `xs` 13, `s` 16 (default), `m` 20 bold, `l` 24, `xl` 36 bold, `xxl` 54
  bold; a number picks the nearest. `xl` has ASCII, German and the common accents;
  `xxl` only letters, digits and `, . : - + % ° / € ! ? ' & ( )`. What a font lacks is
  left out, emojis included. `{time}`, `{date}` and `{weekday}` show the time, the date
  ("7. Oktober") and the day ("Mittwoch").
- **Icons:** 264 Material Design Icons by their MDI name (`coffee`, `mdi:coffee`,
  `weather-sunny`, `party-popper`, ...), the names of the event icons (`klingel`,
  `muell`, ...) and German words (`herz`, `kaffee`, `sonne`, `geschenk`, ...): 110 more
  names. The full list is `muse_icons.h`.
- **Muse's figure** fades into the page colour at its edges. On a dark background it
  therefore sits in a light round frame.
- **Response:** when the caller asks for one (REST `?return_response`, or
  `response_variable` in a script), for example
  `{"ok": false, "elements": 6, "frames": 0, "seconds": 60, "skipped": 1, "errors": ["line 4: ..."]}`.
- **Limits:** 16 KB of scene, 250 elements, 24 frames, 150 particles per `particles`,
  500 characters per text, 12 messages. A scene that needs more than 90 ms for one
  picture is drawn less often and the box logs `scene is slow`; for every scene it logs
  `scene: N pictures in the first 3 s, the slowest took N ms`.

Tried examples are in `scenes/` (weather, welcome, wink, night, progress). `tools/muse_screen.py scene scenes/night.txt` sends one and prints the box's answer.

An animation in frames, here a face that winks:

```text
bg page
frame 700
icon 160 100 emoticon-happy-outline orange size=l
frame 300
icon 160 100 emoticon-wink-outline orange size=l
frame end
text 160 150 "Hallo!" size=xl align=center
```
