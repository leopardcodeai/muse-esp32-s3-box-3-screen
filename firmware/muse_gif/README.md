# muse_gif

AnimatedGIF 2.2.3 by Larry Bank (BitBank Software), Apache License 2.0 (`LICENSE`), for the
GIF animations of the Muse box (`muse_media.h`, DECISIONS.md E-63).

A copy instead of the PlatformIO library, because the library calls Arduino's `millis()` and
`delay()` and does not build on ESP-IDF. The only change is at the top of `AnimatedGIF.cpp`:
two small replacements for those functions. `AnimatedGIF.h` and `gif.inl` are unchanged.
