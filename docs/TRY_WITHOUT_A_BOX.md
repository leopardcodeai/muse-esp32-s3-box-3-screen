# Try it today, without a box

You do not need an ESP32-S3-BOX-3 to see what this project does. **Muse Web Screen** is the
box's display in a browser: the same cards, questions, timers and scenes, drawn by the same
code. Anyone can use it; it is a static page, and your settings and your Home Assistant token
stay in your own browser and go only to your own Home Assistant.

Three steps, each one optional after the first.

## 1. Look at it (30 seconds, nothing to install)

Open **https://muse-web-screen.vercel.app**. A first visit plays the demo: twelve scenes and a
round of sample cards (weather, doorbell, a question with buttons, a timer, a list, the day's
appointments).

Send it a card of your own from the browser console (View, Developer, JavaScript Console):

```js
muse.dispatch("show_text", {title: "Hello", message: "My first card"})
muse.dispatch("ask", {question: "Open the door?", yes_label: "Yes", no_label: "No"})
muse.dispatch("draw", {scene: 'bg #0b1d3a #3a1c5c\ntext 20 70 "Good night" size=xl color=white\nparticles sparkle 30\nseconds 30'})
```

Every action and its fields: [ACTIONS.md](ACTIONS.md). The scene language: [SCENES.md](SCENES.md).
The labels on the display are German, like the box's; the text you send can be any language.

## 2. Connect your Home Assistant (10 minutes)

**Where to open the page.** A page from `https://` may not open an unencrypted `ws://`
connection to a Home Assistant in your LAN. Pick one:

- **Chrome or Edge on the hosted page** with a LAN address such as
  `http://homeassistant.local:8123`: allow "local network access" when the browser asks.
  Safari and Firefox refuse this.
- **Your Home Assistant has an HTTPS address** (Home Assistant Cloud, Tailscale Serve, your own
  reverse proxy): use it with `https://` on the hosted page, in any browser.
- **Run the page on your own computer**, the way that works everywhere. Python 3 is enough:

  ```bash
  git clone https://github.com/leopardcodeai/muse-esp32-s3-box-3-screen
  cd muse-esp32-s3-box-3-screen/web
  python3 -m http.server 8321
  ```

  Then open http://localhost:8321/. On a Mac you can make it a borderless app that floats above
  every window: [MAC_APP.md](MAC_APP.md).

**Settings** (button "Einstellungen"): the Home Assistant URL, and a long-lived access token
(your profile in Home Assistant, Security, Long-lived access tokens). The token must belong to
an **administrator**: the display listens to Home Assistant events, and Home Assistant lets
other users listen only to a short list of its own events. Switch the demo off ("Demo aus").
The dot at the top right turns green when the display is connected.

**Send a card.** Without a box there are no `esphome.*_muse_*` actions, so Home Assistant sends
the event `muse_web` instead; its data is the action and its fields. In Home Assistant:
Developer tools, Events, event type `muse_web`, data:

```yaml
action: show_event
icon: klingel
title: Doorbell
message: Someone is at the door.
```

The same from a terminal, with your token in the environment variable `HA_TOKEN`:

```bash
curl -s -X POST "http://homeassistant.local:8123/api/events/muse_web" \
  -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json" \
  -d '{"action": "show_weather", "condition": "partlycloudy", "temperature": "14", "message": "Showers from 3 pm."}'
```

**Get the answer back.** A tap on a button fires `muse_web_answer` with `answer` and
`question`, so an automation can react:

```yaml
triggers:
  - trigger: event
    event_type: muse_web_answer
    event_data:
      answer: "yes"
actions:
  - action: persistent_notification.create
    data:
      message: "Answered yes: {{ trigger.event.data.question }}"
```

## 3. Let your agent drive it

Any assistant that can call Home Assistant (its REST API, its MCP server, or Assist) can use
the display. Give it one script to call; paste this into Settings, Automations & scenes,
Scripts, new script, Edit in YAML:

```yaml
alias: Muse Web Screen card
description: >-
  Shows a card or a scene on Muse Web Screen. action is one of show_text, show_value,
  show_weather, show_event, show_image, show_list, show_agenda, show_timer, ask, choose,
  celebrate, draw, clear; fields as in docs/ACTIONS.md of muse-esp32-s3-box-3-screen.
mode: queued
fields:
  action:
    description: The card, for example show_text or draw.
    required: true
    selector:
      text:
  fields:
    description: >-
      The card's fields, for example {"title": "Hello", "message": "Dinner is ready"}.
    required: true
    selector:
      object:
sequence:
  - event: muse_web
    event_data:
      action: "{{ action }}"
      title: "{{ fields.get('title', '') }}"
      message: "{{ fields.get('message', '') }}"
      icon: "{{ fields.get('icon', '') }}"
      condition: "{{ fields.get('condition', '') }}"
      temperature: "{{ fields.get('temperature', '') }}"
      label: "{{ fields.get('label', '') }}"
      value: "{{ fields.get('value', '') }}"
      unit: "{{ fields.get('unit', '') }}"
      url: "{{ fields.get('url', '') }}"
      seconds: "{{ fields.get('seconds', '') }}"
      from: "{{ fields.get('from', '') }}"
      to: "{{ fields.get('to', '') }}"
      mode: "{{ fields.get('mode', '') }}"
      events: "{{ fields.get('events', '') }}"
      items: "{{ fields.get('items', '') }}"
      duration: "{{ fields.get('duration', '') }}"
      question: "{{ fields.get('question', '') }}"
      yes_label: "{{ fields.get('yes_label', '') }}"
      no_label: "{{ fields.get('no_label', '') }}"
      options: "{{ fields.get('options', '') }}"
      scene: "{{ fields.get('scene', '') }}"
      status: "{{ fields.get('status', '') }}"
```

Home Assistant takes event data only key by key, so the script lists every field name of
[ACTIONS.md](ACTIONS.md); a field the card does not use goes out empty, which the display reads
as "nothing", like the box.

Expose the script to Assist (its settings, Voice assistants) if your agent reaches Home
Assistant through Assist or the MCP server. Then tell your agent what the display can do: the
prompt in [ASSISTANT_PROMPT.md](ASSISTANT_PROMPT.md) describes the cards and the scene language; where it names an
`esphome.…_muse_<action>` action, the agent calls this script with that `action` instead.

## When you get a box

Flash the firmware ([FLASHING_WITH_CLAUDE_CODE.md](FLASHING_WITH_CLAUDE_CODE.md)), and the same
display mirrors the box: Muse Web Screen also shows every call of the box's actions, with no
change in Home Assistant.
