// Procedural sound: every noise is synthesized with WebAudio — gunfire,
// footsteps, bomb beeps, round stingers. No audio assets, no network. The
// context is created on the first user gesture (the Play button); before
// that every call is a silent no-op.
let ctx = null;
let master = null;
let noiseBuffer = null;

function ensure() {
  if (ctx) return true;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return false;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    const len = ctx.sampleRate * 0.5;
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return true;
  } catch {
    return false;
  }
}

export function initAudio() {
  if (ensure() && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

function burst({ duration, freq, type = 'lowpass', gain = 1, slideTo = null }) {
  if (!ensure() || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t);
  if (slideTo) filter.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + duration);
  src.connect(filter).connect(g).connect(master);
  src.start(t);
  src.stop(t + duration + 0.05);
}

function tone({ freq, duration, type = 'sine', gain = 0.4, slideTo = null }) {
  if (!ensure() || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

export const sfx = {
  shot(def) {
    burst({ duration: 0.12, freq: 1800, slideTo: 300, gain: 0.9 * (def?.loud ?? 1) });
    tone({ freq: 150, duration: 0.08, type: 'square', gain: 0.35 });
  },
  distantShot() {
    burst({ duration: 0.09, freq: 900, slideTo: 200, gain: 0.25 });
  },
  shotgun() {
    burst({ duration: 0.22, freq: 1200, slideTo: 150, gain: 1.0 });
    tone({ freq: 90, duration: 0.16, type: 'square', gain: 0.5 });
  },
  dryFire() {
    tone({ freq: 1400, duration: 0.03, type: 'square', gain: 0.15 });
  },
  reload() {
    tone({ freq: 900, duration: 0.05, type: 'square', gain: 0.2 });
    setTimeout(() => tone({ freq: 600, duration: 0.05, type: 'square', gain: 0.2 }), 220);
  },
  step(run) {
    burst({ duration: 0.05, freq: 500, gain: run ? 0.16 : 0.1 });
  },
  hit() {
    tone({ freq: 2200, duration: 0.05, type: 'sine', gain: 0.35 });
  },
  kill() {
    tone({ freq: 660, duration: 0.1, type: 'sine', gain: 0.4 });
    setTimeout(() => tone({ freq: 990, duration: 0.14, type: 'sine', gain: 0.4 }), 90);
  },
  hurt() {
    tone({ freq: 180, duration: 0.12, type: 'sawtooth', gain: 0.25 });
  },
  plantBeep() {
    tone({ freq: 1200, duration: 0.07, type: 'sine', gain: 0.3 });
  },
  defuseBeep() {
    tone({ freq: 900, duration: 0.07, type: 'sine', gain: 0.3 });
  },
  bombTick() {
    tone({ freq: 1500, duration: 0.04, type: 'square', gain: 0.18 });
  },
  detonate() {
    burst({ duration: 0.9, freq: 400, slideTo: 60, gain: 1.2 });
    tone({ freq: 55, duration: 0.8, type: 'sine', gain: 0.8 });
  },
  throwPop() {
    burst({ duration: 0.08, freq: 2500, gain: 0.3 });
  },
  smokeHiss() {
    burst({ duration: 0.7, freq: 3000, type: 'highpass', gain: 0.25 });
  },
  buyClick() {
    tone({ freq: 800, duration: 0.05, type: 'sine', gain: 0.3 });
  },
  roundWin() {
    tone({ freq: 523, duration: 0.16, type: 'sine', gain: 0.4 });
    setTimeout(() => tone({ freq: 659, duration: 0.16, type: 'sine', gain: 0.4 }), 140);
    setTimeout(() => tone({ freq: 784, duration: 0.28, type: 'sine', gain: 0.4 }), 280);
  },
  roundLose() {
    tone({ freq: 392, duration: 0.2, type: 'sine', gain: 0.35 });
    setTimeout(() => tone({ freq: 311, duration: 0.34, type: 'sine', gain: 0.35 }), 180);
  },
};
