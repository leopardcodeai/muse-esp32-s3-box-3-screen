// audio.js: the display's two sounds, generated with the Web Audio API the way
// tools/make_sounds.py generates the box's files: the chime when a timer ends (three
// rising soft tones, 1.1 s) and the "pling" when a question appears (0.35 s). Same
// notes, lengths and envelope, so both screens sound alike.
//
// Pitfalls: a browser plays nothing before the first click or key on the page; unlock()
// runs on the first user gesture and the sounds stay silent until then.
const RATE = 16000;
const SOUNDS = {
  // C6, E6, G6: a small rising arpeggio, the last tone rings longest.
  timer: { notes: [[1046.5, 0.0, 0.35, 0.8], [1318.5, 0.22, 0.35, 0.8], [1568.0, 0.44, 0.65, 1.0]], total: 1.1 },
  // One soft A6 "pling" with its octave above, quieter.
  ask: { notes: [[1760.0, 0.0, 0.35, 1.0], [3520.0, 0.0, 0.2, 0.25]], total: 0.35 },
};

// The samples of a sound, as make_sounds.py computes them (soft attack, exponential decay).
export function samples(name) {
  const { notes, total } = SOUNDS[name];
  const out = new Float32Array(Math.floor(total * RATE));
  for (const [freq, start, length, volume] of notes) {
    const n0 = Math.floor(start * RATE);
    const n = Math.floor(length * RATE);
    for (let i = 0; i < n; i++) {
      const t = i / RATE;
      const env = Math.min(1, t / 0.012) * Math.exp(-t * 4.5);
      if (n0 + i < out.length) out[n0 + i] += volume * env * Math.sin(2 * Math.PI * freq * t);
    }
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  peak = peak || 1;
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, (out[i] / peak) * 0.8));
  return out;
}

export class Sounds {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.enabled = true;
  }

  // Creates the audio context on the first user gesture (browsers block it before).
  unlock() {
    if (this.ctx || typeof AudioContext === "undefined") return;
    this.ctx = new AudioContext({ sampleRate: RATE });
    for (const name of Object.keys(SOUNDS)) {
      const s = samples(name);
      const b = this.ctx.createBuffer(1, s.length, RATE);
      b.copyToChannel(s, 0);
      this.buffers[name] = b;
    }
  }

  play(name) {
    if (!this.enabled || !this.ctx || !this.buffers[name]) return;
    if (this.ctx.state === "suspended") this.ctx.resume();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[name];
    src.connect(this.ctx.destination);
    src.start();
  }

  chime() {
    this.play("timer");
  }

  ask() {
    this.play("ask");
  }
}
