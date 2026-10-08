# Your own overlay: one file for everything that is yours

The firmware in `firmware/muse-esp32boxs3-screen.yaml` is the same for every house. What differs (the device name, the names Home Assistant shows, a fixed IP, Meta's figure, the optional TV remote) goes into one small YAML of your own that includes the firmware as a package and overrides the rest. New features arrive with `git pull`; your file never conflicts.

## Why one directory

ESPHome resolves every file path in a configuration (`includes`, `image: file`, `font`, `media_player: files`, the wake word model) against the directory of the **main** YAML, the one you pass on the command line [1]. So the overlay has to live in `firmware/`, next to `muse-esp32boxs3-screen.yaml`. If you keep it in a repository of your own, link it in:

```bash
ln -s ~/my-house/muse-esp32boxs3-screen.home.yaml ~/muse-esp32boxs3-screen/firmware/muse-esp32boxs3-screen.home.yaml
ln -s ~/my-house/secrets.yaml       ~/muse-esp32boxs3-screen/firmware/secrets.yaml
```

`.gitignore` of this repository ignores `firmware/*.home.yaml` and `firmware/secrets.yaml`, so neither can be committed here by accident.

## The file

```yaml
# muse-esp32boxs3-screen.home.yaml: the box at home, as an overlay over firmware/muse-esp32boxs3-screen.yaml.
substitutions:
  name: kitchen-box
  friendly_name: Kitchen Box
  ha_url: "http://192.168.0.10:8123"
  doorbell_image: "/local/doorbell.jpg"
  figure_prefix: "muse_"          # after tools/make_muse_assets.py, else ""
  temperature_offset: "-8.34"
  map_tiles: "https://tile.openstreetmap.org/{z}/{x}/{y}.png"

packages:
  base: !include muse-esp32boxs3-screen.yaml
  tv: !include packages/samsung_tv_ir.yaml     # leave out if you have no Samsung TV

wifi:
  manual_ip:
    static_ip: 192.168.0.84
    gateway: 192.168.0.1
    subnet: 255.255.255.0
    dns1: 192.168.0.1            # a fixed IP without dns1 resolves no host name at all

# Names Home Assistant shows. ESPHome derives the unique id of an entity from its name,
# so a renamed entity is a new entity: set the names once and keep them.
sensor:
  - id: !extend dock_climate
    temperature:
      name: "Kitchen Temperature"
    humidity:
      name: "Kitchen Humidity"
  - id: !extend wifi_rssi
    name: "Kitchen Box Wi-Fi"
binary_sensor:
  - id: !extend radar_presence
    name: "Kitchen Presence"
media_player:
  - id: !extend muse_player
    name: "Kitchen Speaker"
button:
  - id: !extend tv_power_button
    name: "Kitchen TV Power"
```

`!extend <id>` merges your keys into the component with that id; every entity, image and TV button in the firmware has one for exactly this purpose. `!remove` takes a key away, for example `api: encryption: !remove` if you must run without encryption (not recommended). Both are ESPHome's package mechanism [1].

Build, flash and read the log with the overlay as the main file:

```bash
cd ~/muse-esp32boxs3-screen/firmware
esphome run muse-esp32boxs3-screen.home.yaml --device kitchen-box.local
esphome logs muse-esp32boxs3-screen.home.yaml --device kitchen-box.local
```

## Checking that nothing changed by accident

`esphome config` prints the merged configuration. Before the first flash of an overlay that replaces an older full configuration, compare the two renderings; the entity names must be identical, or Home Assistant will create new entities and leave the old ones orphaned:

```bash
esphome config old-full-config.yaml > /tmp/old.yaml
esphome config muse-esp32boxs3-screen.home.yaml  > /tmp/new.yaml
diff <(grep -E '^\s*name:' /tmp/old.yaml | sort) <(grep -E '^\s*name:' /tmp/new.yaml | sort)
```

An empty diff is the goal. The first overlay of this kind (the author's box, 7 October 2026) rendered 43 entity names on both sides with no difference; the only other differences were the intended ones (the project name, the version, the encryption, the paths).

## What belongs where

| Yours (overlay) | Everyone's (firmware) |
|---|---|
| device name, entity names, a fixed IP | every action, card, scene command, sensor |
| `secrets.yaml` | `secrets.yaml.example` |
| Meta's figure (`figure/muse_*.png`, ignored) | the placeholder figure |
| which optional packages you take | the packages themselves |
| house-specific URLs | the defaults |

A feature you build for your house that others could use goes into the firmware and a pull request, not into the overlay.

[1] ESPHome, *Packages*, https://esphome.io/components/packages (local and remote packages, `!extend`, `!remove`).
