# The screen speaks German

The firmware grew up in a German-speaking house, so the strings on the display are
German. Everything else (code, comments, docs, entity names) is English. To change the
display language, edit these places and rebuild; a substitution cannot reach into
lambdas, so there is no switch.

| String | Where |
|---|---|
| status pills "Bereit", "Ich höre zu …", "Ich denke nach …", "Ich antworte …", "Da ging etwas schief", "Ruhe", "Hallo!", "Mikrofon aus" | `firmware/muse-esp32-s3-box-3-screen.yaml`, display lambda, `PILLS[]` and the mute line |
| "Bild lädt …", "Route wird berechnet …", "Zeit ist um", "Timer", "+N weitere", "Keine Termine", "N Termine", "N von N erledigt", "Nichts drauf", "Liste", "Heute", "Live" | `firmware/muse-esp32-s3-box-3-screen.yaml`, the cards and the actions |
| "Ja" / "Nein" default buttons, "Min.", "Std." | `firmware/muse-esp32-s3-box-3-screen.yaml` |
| weather labels ("Sonnig", "Regen", ...) and the German weather words | `firmware/muse.h`, `condition()` |
| event icon names (`klingel`, `muell`, ...) and their aliases | `firmware/muse.h`, `event()` |
| "ganztägig" in agendas, the German icon words (`herz`, `kaffee`, ...) | `firmware/muse.h` `parse_agenda`, `tools/make_icon_table.py` ALIASES |
| weekday and month names of `{weekday}` and `{date}` | `firmware/muse.h`, `fill_placeholders()` |
| scene parser messages | English already (`firmware/muse_scene.h`) |

The 36 px headline font carries ASCII, German umlauts and the common accents; the 54 px
font only letters, digits and `, . : - + % ° / € ! ? ' & ( )`. Other characters are left
out of a text rather than drawn as boxes. For Cyrillic or Greek, add the glyph sets to
`m_head` in `muse-esp32-s3-box-3-screen.yaml` (flash permitting).
