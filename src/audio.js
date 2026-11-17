// All sound is synthesised; no audio files.
let ctx = null, master = null, noiseBuf = null, lastThump = 0;
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

function env(gain, t, a, d, peak) {
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + a);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

export const sfx = {
  init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch { ctx = null; }
  },
  thump(strength) {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (t - lastThump < 0.045) return;
    lastThump = t;
    const s = Math.min(1, strength);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150 + Math.random() * 60, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.16);
    env(g, t, 0.004, 0.2, 0.5 * s + 0.05);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.3);
    const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), ng = ctx.createGain();
    n.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 900; f.Q.value = 1.2;
    env(ng, t, 0.002, 0.07, 0.25 * s + 0.02);
    n.connect(f).connect(ng).connect(master); n.start(t); n.stop(t + 0.12);
  },
  chime(i) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const f = 523.25 * Math.pow(2, SCALE[Math.min(i, SCALE.length - 1)] / 12);
    for (const [mul, vol] of [[1, 0.3], [2.01, 0.12], [3.0, 0.05]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f * mul;
      env(g, t, 0.005, 0.9 / mul + 0.3, vol);
      o.connect(g).connect(master); o.start(t); o.stop(t + 1.6);
    }
  },
  whoosh(power) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = noiseBuf; f.type = 'bandpass'; f.Q.value = 0.8;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(1600 + power * 1400, t + 0.25);
    env(g, t, 0.03, 0.3, 0.18 + power * 0.15);
    n.connect(f).connect(g).connect(master); n.start(t); n.stop(t + 0.45);
  },
  win() {
    if (!ctx) return;
    [0, 2, 4, 5, 7].forEach((n, k) => setTimeout(() => this.chime(n + 3), k * 90));
  },
};
