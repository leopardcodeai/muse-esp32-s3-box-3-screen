// demo.js: the display without Home Assistant (index.html?demo=1). It plays the scenes
// of demo/scenes/ (copies of ../scenes/) and a round of sample cards in a loop, every
// item for a few seconds, so that anyone sees the app within seconds and so that the
// rendering can be checked in a browser without any credentials.
//
// The demo feeds the same actions the box takes; only the time on screen is shortened
// (display.demoMs), questions and the timer keep their own.
export const DEMO_SCENES = ["welcome", "weather", "ring", "menu", "progress", "wink", "night", "party",
  "hello_claude", "hello_grok", "hello_dots", "hello_spark"];

export const DEMO_CARDS = [
  ["set_status_text", { status: "thinking", label: "Ich lese deine E-Mails …" }],
  ["show_text", { title: "Erinnerung", message: "Sam kommt um 18:30. Der Kuchen steht im Ofen, in 20 Minuten ist er fertig." }],
  ["show_value", { label: "Wohnzimmer", value: "21,5", unit: "°C" }],
  ["show_weather", { condition: "partlycloudy", temperature: "14", message: "Ab 15 Uhr kommen Schauer. Nimm einen Schirm mit." }],
  ["show_event", { icon: "klingel", title: "Es klingelt", message: "Jemand steht vor der Tür." }],
  ["ask", { question: "Soll ich die Heizung im Büro auf 21 Grad stellen?", yes_label: "Ja, bitte", no_label: "Später" }],
  ["show_timer", { label: "Tee", duration: "15 s" }],
  ["show_list", { title: "Einkaufen", items: "[x] Milch\n[ ] Brot\n[ ] Eier\n- Butter\nKäse" }],
  ["show_agenda", { title: "", events: "09:00-10:00 Teammeeting @ Büro\n12:30 Mittag mit Kim\nganztägig Urlaub Sam\n15:00 | Zahnarzt | Praxis Nord" }],
  ["choose", { question: "Was möchtest du hören?", options: "Jazz\nRock\nKlassik\nNichts" }],
  ["celebrate", { title: "Geschafft!", message: "Alle Aufgaben für heute sind erledigt." }],
  ["set_status", { status: "ready" }],
];

export class Demo {
  constructor(display, { fetchText, stepMs = 7000, log = () => {} }) {
    this.display = display;
    this.fetchText = fetchText;
    this.stepMs = stepMs;
    this.log = log;
    this.timer = null;
    this.index = 0;
    this.scenes = new Map();
  }

  async start() {
    this.display.demoMs = this.stepMs;
    this.display.connection = "demo";
    for (const name of DEMO_SCENES) {
      try {
        this.scenes.set(name, await this.fetchText(`demo/scenes/${name}.txt`));
      } catch (e) {
        this.log(`demo scene ${name} missing: ${e.message}`);
      }
    }
    this.sequence = [
      ...DEMO_SCENES.filter((n) => this.scenes.has(n)).map((n) => ["draw", { scene: this.scenes.get(n) }]),
      ...DEMO_CARDS,
    ];
    this.index = 0;
    this.step();
  }

  step() {
    const d = this.display;
    const [action, fields] = this.sequence[this.index % this.sequence.length];
    this.index++;
    // The line is emptied first, so the demo shows one item after another.
    d.queue.clear();
    if (d.mode !== 0 && d.mode !== 11 && d.mode !== 8) d.next();
    d.dispatch(action, fields);
    let wait = this.stepMs;
    if (action === "show_timer") wait = 15000 + 4000;
    if (action === "ask" || action === "choose") wait = this.stepMs + 3000;
    this.timer = setTimeout(() => this.step(), wait);
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
    this.display.demoMs = 0;
  }
}
