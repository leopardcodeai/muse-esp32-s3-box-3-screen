# The ESP32-S3-BOX-3, from the box to Home Assistant

For people who have never flashed an ESP32. The whole thing takes an evening; most of it
is waiting for builds. Numbers and pins come from Espressif's documentation [1] [2] and
from this firmware's own measurements (`docs/HARDWARE.md`).

## What you are holding

The ESP32-S3-BOX-3 is Espressif's development kit for voice assistants: a 2.4-inch
touch screen (320 x 240), two microphones, a speaker, a motion sensor, Wi-Fi and
Bluetooth, 16 MB flash and 16 MB PSRAM, in a case with a stand. It costs about 50 to
70 EUR [3]. The firmware here needs the plain box; the optional BOX-3-SENSOR dock
(about 20 EUR) adds the radar, a temperature and humidity sensor, an infrared sender and
receiver, a microSD slot and a holder for an 18650 battery; the "bread board" dock adds
pin headers instead. Everything the dock gives is optional: without it the box has no
presence detection, no room climate and no battery, and everything else works.

Buttons and switches on the case:

| Where | What | In this firmware |
|---|---|---|
| top, left (red, "BOOT") | enters download mode when held at power-on | a press switches the display light off and on |
| top, middle (slider) | mutes the microphones in hardware | the box shows "Mikrofon aus" and does not listen |
| top, right | reset | reboots |
| USB-C on the back | power and serial | first flash, logs when needed |
| the dock's switch at the bottom left | battery power on and off | invisible to the firmware |

## 1. Assemble

Clip the box onto the dock (the connector on the back of the box mates with the dock's),
put an 18650 cell into the holder if you have one (plus pole towards the spring's
opposite side, as printed), and plug in USB-C. The dock charges the cell from USB and
shows it with its own LED; the firmware reads the voltage (4.2 V full, below 3.3 V
empty).

## 2. First power-on

Out of the box it runs Espressif's demo firmware, which wants its own app. Ignore it; we
replace it. If the screen stays dark, the dock's power switch is off.

## 3. Download mode and the first flash

The first flash goes over USB; every later one goes over Wi-Fi (OTA).

1. Use a USB-C cable that carries data (many charging cables do not).
2. Plug the box into the computer. macOS needs no driver; the box appears as
   `/dev/cu.usbmodem*`. Linux: `/dev/ttyACM0`, and your user needs the `dialout` group
   (`sudo usermod -aG dialout $USER`, then log in again). Windows: the port shows in the
   Device Manager as "USB Serial Device".
3. If the upload tool cannot talk to the box, put it into download mode by hand: hold
   BOOT (top left), press reset (top right) once, release BOOT. The screen stays dark in
   this mode; that is right.
4. `esphome upload firmware/muse-esp32boxs3-screen.yaml --device /dev/cu.usbmodem101` (your port).
   The first upload also erases nothing you need; the demo firmware is simply replaced.
5. Press reset or replug. The box boots into the new firmware in about 10 s and shows
   the figure with the "Bereit" pill once Wi-Fi is up.

Wi-Fi: the credentials come from `firmware/secrets.yaml`. If the box cannot find the
network (wrong password, 5 GHz only), it opens its own access point named like the
device (`muse-esp32boxs3-screen`) with the `ap_password` from the secrets; connect to it and a
captive portal lets you pick a network.

## 4. Home Assistant

Home Assistant finds the box by mDNS within a minute: Settings, Devices and services,
the ESPHome integration offers "muse-esp32boxs3-screen". Enter the API encryption key from
`secrets.yaml`. From then on the box is a device with these entities: presence
(radar), temperature, humidity, battery, Wi-Fi signal, the backlight, the speaker (a
media player), the mute switch, the top button, the answer sensor, and the night calm
switch; plus all `esphome.muse_esp32boxs3_screen_muse_*` actions in Developer tools, Actions.

The voice assistant needs an Assist pipeline (Settings, Voice assistants): speech to
text, a conversation agent, text to speech. The box's `assist_satellite` entity uses the
preferred pipeline. Wake word "Hey Jarvis" is detected on the box itself (microWakeWord);
"Okay Nabu", "Hey Mycroft" and "Alexa" are compiled in too and can be picked in Home
Assistant.

## 5. Keep it running

- Flash over the air: `esphome upload firmware/muse-esp32boxs3-screen.yaml --device muse-esp32boxs3-screen.local`,
  about 60 s; the box keeps running until the last second.
- Read the log after every flash: `esphome logs firmware/muse-esp32boxs3-screen.yaml --device muse-esp32boxs3-screen.local`.
- Updates of ESPHome come from PyPI or Homebrew; newer is better, and never update
  while a build runs.
- The box reboots cleanly on power loss and keeps nothing it needs on the SD card.

## ESP32 in two paragraphs, for the curious

The ESP32-S3 is a dual-core microcontroller from Espressif with Wi-Fi and Bluetooth LE,
up to 240 MHz, and no operating system you would recognise: the firmware is one program
that runs on FreeRTOS. ESPHome [4] is the tool that turns a YAML file into that program:
you describe sensors, a display, a microphone, and ESPHome generates the C++ and builds
it with Espressif's ESP-IDF. Home Assistant speaks to the result over an encrypted
local API. This project's YAML is 2,400 lines because the display lambda draws every
card and the headers hold the drawing language; a plain sensor is 20 lines.

Memory decides what is possible. The chip has about 340 KB of fast internal RAM, which
Wi-Fi, Bluetooth, TLS and the display's DMA all want; the 16 MB of PSRAM on the module
are slower but plentiful, so everything large (pictures, decoders, TLS buffers, audio
tasks) lives there. Flash holds the program and all assets: fonts, icons, the figure's
animation frames (one 160 x 160 frame is 51 KB), sounds. This firmware fills 95 % of
the 8 MB app partition; that is the budget every new icon competes for.

[1] Espressif, ESP32-S3-BOX-3 hardware overview,
https://github.com/espressif/esp-box/blob/master/docs/hardware_overview/esp32_s3_box_3/hardware_overview_for_box_3.md
[2] Espressif, esp-bsp board support `esp-box-3.h` (pin assignments),
https://github.com/espressif/esp-bsp/blob/master/bsp/esp-box-3/include/bsp/esp-box-3.h
[3] Prices as listed by Espressif's distributors in October 2026; they vary by shop and country.
[4] ESPHome documentation, https://esphome.io
