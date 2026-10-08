# What leaves the house

The box talks to Home Assistant on the local network and to nothing else, with these
exceptions, each of which you can switch off by not using the feature:

| Feature | Goes to | What exactly | Policy |
|---|---|---|---|
| a picture from the web (`muse_show_image`, `muse_show_live`) | the host in the URL | the URL you send, the box's user agent | yours |
| a route (`muse_show_route`) | routing.openstreetmap.de (FOSSGIS e.V.), the tile server in `map_tiles` (tile.openstreetmap.org by default, OpenStreetMap Foundation), nominatim.openstreetmap.org for place names | start and destination coordinates or names, the tiles around the route (which say where it is) | [1] [2] [3] |
| the voice assistant | Home Assistant's pipeline (local or cloud, as you configured it) | your voice | Home Assistant's |
| Spotify through Music Assistant | Spotify | what you play | Spotify's |
| the firmware build | GitHub, jsDelivr, Google Fonts, PlatformIO registry | downloads of fonts, icons, libraries | theirs |

Nothing is sent to LeopardCode.AI, and the firmware has no telemetry.

The user agent of the box's own picture task names this repository, as the tile and
routing services ask for a way to reach whoever sends requests
(`Muse-ESP32BoxS3-Screen/4.2 (ESPHome; +https://github.com/leopardcodeai/muse-esp32boxs3-screen)`).
Until 4.0 the map came as one picture from maps.wikimedia.org; its terms allow that for
Wikimedia projects only, so 4.1 switched to tiles from a server you choose.

[1] FOSSGIS e.V., routing.openstreetmap.de usage policy, https://routing.openstreetmap.de/about.html
[2] OpenStreetMap Foundation, Tile usage policy, https://operations.osmfoundation.org/policies/tiles/ (a distinct user agent, light use, attribution on the map; the card shows it)
[3] OpenStreetMap Foundation, Nominatim usage policy, https://operations.osmfoundation.org/policies/nominatim/
