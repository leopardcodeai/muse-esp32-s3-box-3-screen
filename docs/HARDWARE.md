# Hardware

ESP32-S3-BOX-3 (ESP32-S3-WROOM-1, 16 MB flash, 16 MB octal PSRAM, 2.4" 320 x 240 ILI9342C
with a GT911 touch controller, two microphones through an ES7210, a speaker through an
ES8311 and an amplifier, an ICM-42607-P motion sensor, three buttons) with the
BOX-3-SENSOR dock (AHT20 temperature and humidity, IR sender and receiver, a 24 GHz radar,
an 18650 battery holder with charger, a microSD slot). Pins from Espressif's board
support package `esp-box-3.h` [1].

| Part | Bus or pin | What the firmware does with it | A healthy box answers `muse_hw_check` with |
|---|---|---|---|
| speaker codec ES8311 | I2C bus A (GPIO8/18), 0x18 | all sound: media player, voice replies, the chime | chip id `83 FF`, register 00 `80` |
| microphone ADC ES7210 | I2C bus A, 0x40 | wake word and voice assistant | chip id `72 FF`, register 40 `C3` |
| amplifier | GPIO46 | on at boot | |
| touch GT911 | I2C bus A, 0x5D, interrupt GPIO3 | taps, swipes, buttons, questions | product `39 31 31` ("911") |
| motion sensor ICM-42607-P | I2C bus A, 0x68 | not used yet | WHO_AM_I `60` |
| display ILI9342C | SPI GPIO7/6, CS 5, DC 4, reset 48, backlight GPIO47 | everything you see | |
| mute switch (top) | GPIO1 | cuts the microphones in hardware; the box shows "Mikrofon aus" | `1` on, `0` off |
| top left button (BOOT) | GPIO0 | a press switches the display light off and on | `1` up |
| bottom left switch | | power, in hardware; the firmware cannot see it | |
| dock: AHT20 | I2C bus B (GPIO41/40), 0x38 | room temperature and humidity, corrected for the warm board | status `18` |
| dock: chip at 0x28 | I2C bus B | unknown, likely the radar's set-up interface; not used | answers 8 registers |
| dock: radar | GPIO21 | presence, held 30 s after the last movement; Muse waves once per arrival | `0` or `1` |
| dock: IR | TX GPIO39, RX GPIO38, power GPIO44 | the optional Samsung TV remote package | |
| dock: battery | GPIO10 (ADC, divider x 4.11) | voltage and a percentage | `3.0` to `4.2 V` |

Measured on 07.10.2026: internal RAM free 64 to 82 KB at rest, PSRAM 16 MB; the build
uses 95 % of the 8 MB app partition and 51 % of the 342 KB of static RAM. Both audio
codecs fail to set up at boot although they answer on the bus; a retry 3 s later works
every time, which is what the `audio_init` script does.

Large buffers go to PSRAM on purpose: the picture decoders (a PNG decoder needs 44 KB),
the pictures, and the TLS buffers of mbedTLS (`CONFIG_MBEDTLS_EXTERNAL_MEM_ALLOC`); with
TLS in internal RAM the display's DMA transfer failed during handshakes
(`spi: Transmit failed - err 101`).

[1] Espressif, esp-bsp, `bsp/esp-box-3/include/bsp/esp-box-3.h`,
https://github.com/espressif/esp-bsp/blob/master/bsp/esp-box-3/include/bsp/esp-box-3.h
