#!/usr/bin/env python3
"""Talks to the box through Home Assistant from any shell, agent or script.

What: one command per card and question of the firmware, sent to Home Assistant's REST
  API with the box's device name; prints the box's answer (what went on screen, what a
  tap answered, what a scene did not understand). Any assistant that can run a shell
  command can drive the box with it: Claude Code, a Muse gadget bridge, a Grok or
  custom agent, cron.
Why: the firmware's actions are ESPHome actions in Home Assistant; typing their JSON by
  hand is error-prone, and an agent needs a stable, documented surface.
Pitfalls:
  * Needs HA_URL (default http://homeassistant.local:8123) and HA_TOKEN (a long-lived
    access token) in the environment; the token never goes on the command line.
  * Home Assistant makes every argument of an ESPHome action mandatory; this tool sends
    "" for anything you leave out.
  * `ask`, `choose` and `wait` block until a tap or their timeout (25 s, 60 s).
Usage:
  export HA_TOKEN=...          # better: from a keychain, never in a file
  tools/muse_screen.py text "Hallo" "Die Box lebt."
  tools/muse_screen.py event klingel "Es klingelt" "Haustür"
  tools/muse_screen.py scene scenes/night.txt
  tools/muse_screen.py ask "Licht aus?"             # answers yes / no / pending
  tools/muse_screen.py timer "Pizza" "12 min"
  tools/muse_screen.py state
  tools/muse_screen.py --device my-box hw           # another device name
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

DEFAULT_DEVICE = "muse_esp32_s3_box_3_screen"


def call(device, action, data, response=True):
    base = os.environ.get("HA_URL", "http://homeassistant.local:8123").rstrip("/")
    token = os.environ.get("HA_TOKEN") or os.environ.get("HOMEASSISTANT_TOKEN")
    if not token:
        sys.exit("HA_TOKEN is not set (a long-lived access token of Home Assistant).")
    url = f"{base}/api/services/esphome/{device}_{action}" + ("?return_response" if response else "")
    req = urllib.request.Request(url, data=json.dumps(data).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            body = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"Home Assistant answered HTTP {e.code} for {action}: {e.read().decode()[:300]}")
    except urllib.error.URLError as e:
        sys.exit(f"Home Assistant not reachable at {base}: {e.reason}")
    return body.get("service_response", body) if isinstance(body, dict) else body


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--device", default=os.environ.get("MUSE_BOX_DEVICE", DEFAULT_DEVICE),
                    help="the ESPHome device name with underscores (default muse_esp32_s3_box_3_screen)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("status", help="status: ready, listening, thinking, speaking, error, off; optional label")
    s.add_argument("status"); s.add_argument("label", nargs="?", default="")
    s = sub.add_parser("text", help="a text card"); s.add_argument("title"); s.add_argument("message")
    s = sub.add_parser("value", help="a big value"); s.add_argument("label"); s.add_argument("value"); s.add_argument("unit", nargs="?", default="")
    s = sub.add_parser("event", help="an event card"); s.add_argument("icon"); s.add_argument("title"); s.add_argument("message", nargs="?", default="")
    s = sub.add_parser("weather", help="a weather card"); s.add_argument("condition"); s.add_argument("temperature"); s.add_argument("message", nargs="?", default="")
    s = sub.add_parser("celebrate", help="confetti"); s.add_argument("title"); s.add_argument("message", nargs="?", default="")
    s = sub.add_parser("image", help="a photo or GIF from a URL"); s.add_argument("title"); s.add_argument("url"); s.add_argument("message", nargs="?", default="")
    s = sub.add_parser("live", help="a live camera view"); s.add_argument("title"); s.add_argument("url"); s.add_argument("seconds", type=int, nargs="?", default=30)
    s = sub.add_parser("route", help="a route on a map"); s.add_argument("title"); s.add_argument("start"); s.add_argument("destination"); s.add_argument("mode", nargs="?", default="car")
    s = sub.add_parser("agenda", help="appointments, one per line or a file"); s.add_argument("events"); s.add_argument("--title", default="")
    s = sub.add_parser("list", help="a list with ticks, one item per line or a file"); s.add_argument("items"); s.add_argument("--title", default="")
    s = sub.add_parser("timer", help="a timer on the box"); s.add_argument("label"); s.add_argument("duration")
    s = sub.add_parser("cancel-timer", help="cancel the box's timers"); s.add_argument("label", nargs="?", default="")
    s = sub.add_parser("ask", help="a yes/no question, waits up to 25 s"); s.add_argument("question"); s.add_argument("--yes", default=""); s.add_argument("--no", default="")
    s = sub.add_parser("choose", help="2 to 4 options, one per line, waits up to 25 s"); s.add_argument("question"); s.add_argument("options")
    s = sub.add_parser("wait", help="wait for the next tap answer"); s.add_argument("seconds", type=int, nargs="?", default=30)
    s = sub.add_parser("scene", help="draw a scene (file or text)"); s.add_argument("scene")
    sub.add_parser("clear", help="every card gone")
    sub.add_parser("state", help="what the box shows and knows")
    sub.add_parser("hw", help="hardware check: chips, pins, memory")
    a = ap.parse_args()

    def lines(value):
        return open(value, encoding="utf-8").read() if os.path.isfile(value) else value.replace("\\n", "\n")

    d = a.device
    if a.cmd == "status":
        r = call(d, "muse_set_status_text" if a.label else "muse_set_status", {"status": a.status, "label": a.label} if a.label else {"status": a.status}, response=False)
    elif a.cmd == "text":
        r = call(d, "muse_show_text", {"title": a.title, "message": a.message})
    elif a.cmd == "value":
        r = call(d, "muse_show_value", {"label": a.label, "value": a.value, "unit": a.unit})
    elif a.cmd == "event":
        r = call(d, "muse_show_event", {"icon": a.icon, "title": a.title, "message": a.message})
    elif a.cmd == "weather":
        r = call(d, "muse_show_weather", {"condition": a.condition, "temperature": a.temperature, "message": a.message})
    elif a.cmd == "celebrate":
        r = call(d, "muse_celebrate", {"title": a.title, "message": a.message})
    elif a.cmd == "image":
        r = call(d, "muse_show_image", {"title": a.title, "message": a.message, "url": a.url})
    elif a.cmd == "live":
        r = call(d, "muse_show_live", {"title": a.title, "url": a.url, "seconds": a.seconds})
    elif a.cmd == "route":
        r = call(d, "muse_show_route", {"title": a.title, "from": a.start, "to": a.destination, "mode": a.mode})
    elif a.cmd == "agenda":
        r = call(d, "muse_show_agenda", {"title": a.title, "events": lines(a.events)})
    elif a.cmd == "list":
        r = call(d, "muse_show_list", {"title": a.title, "items": lines(a.items)})
    elif a.cmd == "timer":
        r = call(d, "muse_show_timer", {"label": a.label, "duration": a.duration})
    elif a.cmd == "cancel-timer":
        r = call(d, "muse_cancel_timer", {"label": a.label})
    elif a.cmd == "ask":
        r = call(d, "muse_ask", {"question": a.question, "yes_label": a.yes, "no_label": a.no})
    elif a.cmd == "choose":
        r = call(d, "muse_choose", {"question": a.question, "options": lines(a.options)})
    elif a.cmd == "wait":
        r = call(d, "muse_wait_answer", {"seconds": a.seconds})
    elif a.cmd == "scene":
        r = call(d, "muse_draw", {"scene": lines(a.scene)})
    elif a.cmd == "clear":
        r = call(d, "muse_clear", {})
    elif a.cmd == "state":
        r = call(d, "muse_get_state", {})
    elif a.cmd == "hw":
        r = call(d, "muse_hw_check", {})
    else:
        r = {}
    print(json.dumps(r, ensure_ascii=False, indent=2) if r else "ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
