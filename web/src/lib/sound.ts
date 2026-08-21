// Tiny synthesized sound effects for the Mine page, via the Web Audio API — no
// asset files to bundle or fetch. Everything is generated from oscillators so it
// stays crisp at any volume and adds nothing to the bundle size.
//
// Audio contexts can only start after a user gesture, so the context is created
// lazily on the first play() and resumed if the browser suspended it. A global
// mute (persisted per-device) lets the user silence the app; we fail silently on
// any browser that lacks Web Audio so the UI never breaks.

const STORAGE_KEY = 'icebox.sound.muted';

let ctx: AudioContext | null = null;
let muted = readMuted();

function readMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return null;
      ctx = new Ctx();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

interface Note {
  freq: number;
  start: number; // seconds from now
  dur: number;
  type?: OscillatorType;
  gain?: number;
  slideTo?: number; // glide to this frequency over the note
}

/** Play a short envelope of notes. Each note gets its own gain envelope. */
function play(notes: Note[]): void {
  const ac = audio();
  if (!ac) return;
  const now = ac.currentTime;
  for (const n of notes) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = n.type ?? 'sine';
    const t0 = now + n.start;
    const t1 = t0 + n.dur;
    osc.frequency.setValueAtTime(n.freq, t0);
    if (n.slideTo) osc.frequency.exponentialRampToValueAtTime(n.slideTo, t1);
    const peak = n.gain ?? 0.14;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.02, n.dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t1);
    osc.connect(g).connect(ac.destination);
    osc.start(t0);
    osc.stop(t1 + 0.02);
  }
}

export const sfx = {
  /** A soft crystalline tap when the coin/rig is pressed. */
  tap() {
    play([{ freq: 660, slideTo: 880, start: 0, dur: 0.09, type: 'triangle', gain: 0.1 }]);
  },
  /** Coins collected — a quick ascending "cha-ching" sparkle. */
  claim() {
    play([
      { freq: 784, start: 0, dur: 0.09, type: 'triangle', gain: 0.13 },
      { freq: 1047, start: 0.07, dur: 0.1, type: 'triangle', gain: 0.13 },
      { freq: 1319, start: 0.15, dur: 0.14, type: 'triangle', gain: 0.12 },
      { freq: 2093, start: 0.15, dur: 0.14, type: 'sine', gain: 0.05 },
    ]);
  },
  /** Level up — a bright triumphant arpeggio. */
  levelUp() {
    play([
      { freq: 523, start: 0, dur: 0.12, type: 'triangle', gain: 0.14 },
      { freq: 659, start: 0.1, dur: 0.12, type: 'triangle', gain: 0.14 },
      { freq: 784, start: 0.2, dur: 0.12, type: 'triangle', gain: 0.14 },
      { freq: 1047, start: 0.3, dur: 0.28, type: 'triangle', gain: 0.15 },
      { freq: 1568, start: 0.3, dur: 0.28, type: 'sine', gain: 0.06 },
    ]);
  },
  /** Subtle click for opening a sheet / pressing a secondary button. */
  click() {
    play([{ freq: 420, start: 0, dur: 0.05, type: 'square', gain: 0.05 }]);
  },
  /** Soft error thud. */
  error() {
    play([{ freq: 220, slideTo: 140, start: 0, dur: 0.16, type: 'sawtooth', gain: 0.08 }]);
  },
};
