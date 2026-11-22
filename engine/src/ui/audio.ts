// Sound (stage 8): WebAudio, three channels (master, effects, music) each with its own volume, the volumes kept in the
// browser. No sound files: every sound is made on the spot from oscillators and noise, in the spirit of the pixel art
// (and so the engine still has nothing to download). The game's events become sounds between steps (game.takeEvents()),
// never inside one: the sound's own randomness must not touch the game's dice.
//
// Browsers only let a page make sound after the player has done something (a key, a click): the context is made then.
import type { GameEvent } from '../game/types';

export type Channel = 'master' | 'sfx' | 'music';

export interface Volumes {
  master: number;
  sfx: number;
  music: number;
  /** music on or off (M) */
  musicOn: boolean;
  /** all sound off (N) */
  muted: boolean;
}

export const DEFAULT_VOLUMES: Volumes = { master: 0.8, sfx: 0.8, music: 0.35, musicOn: true, muted: false };

/** the engine's events and the sounds they make; a game adds or changes these with def.sounds */
export const DEFAULT_SOUNDS: Record<string, string> = {
  swing: 'swing',
  hit: 'hit',
  death: 'death',
  respawn: 'respawn',
  'hit-object': 'hit',
  break: 'crash'
};

/** the sounds the synthesizer knows */
export const SOUND_NAMES = ['swing', 'hit', 'death', 'respawn', 'blip', 'save', 'crash'] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

/** Which sounds a batch of events makes, in order (no DOM, no audio: what tests check). */
export function soundsFor(events: GameEvent[], extra: Record<string, string> = {}): { sound: string; event: GameEvent }[] {
  const map = { ...DEFAULT_SOUNDS, ...extra };
  const out: { sound: string; event: GameEvent }[] = [];
  for (const e of events) {
    const s = map[e.name];
    if (s && (SOUND_NAMES as readonly string[]).includes(s)) out.push({ sound: s, event: e });
  }
  return out;
}

const STORE = 'ink-engine:audio';

function readVolumes(): Volumes {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return { ...DEFAULT_VOLUMES, ...JSON.parse(raw) };
  } catch {
    // the defaults, then
  }
  return { ...DEFAULT_VOLUMES };
}

export class Sound {
  ctx: AudioContext | null = null;
  readonly volumes: Volumes;
  /** how many of each sound were played (for tests and the status line) */
  readonly played: Record<string, number> = {};
  private gain: Partial<Record<Channel, GainNode>> = {};
  private noise: AudioBuffer | null = null;
  private musicTimer: number | null = null;
  private nextBeat = 0;
  private beat = 0;
  private off: (() => void)[] = [];

  constructor(private extraSounds: Record<string, string> = {}) {
    this.volumes = readVolumes();
    // make the context on the first thing the player does
    const unlock = () => this.unlock();
    for (const t of ['keydown', 'pointerdown'] as const) {
      addEventListener(t, unlock, { capture: true });
      this.off.push(() => removeEventListener(t, unlock, { capture: true }));
    }
    const keys = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'KeyM') this.set({ musicOn: !this.volumes.musicOn });
      if (e.code === 'KeyN') this.set({ muted: !this.volumes.muted });
    };
    addEventListener('keydown', keys);
    this.off.push(() => removeEventListener('keydown', keys));
  }

  /** make (or wake) the audio context; safe to call any number of times */
  unlock(): void {
    const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      const ctx = new AC();
      this.ctx = ctx;
      const master = ctx.createGain();
      master.connect(ctx.destination);
      const sfx = ctx.createGain(),
        music = ctx.createGain();
      sfx.connect(master);
      music.connect(master);
      this.gain = { master, sfx, music };
      // a second of white noise, made once (the sound's own randomness: not the game's)
      const n = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate),
        d = n.getChannelData(0);
      let s = 0x2545f491;
      for (let i = 0; i < d.length; i++) {
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        d[i] = ((s >>> 0) / 4294967296) * 2 - 1;
      }
      this.noise = n;
      this.apply();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.music();
  }

  /** change volumes or switches, keep them, and hear the change */
  set(v: Partial<Volumes>): void {
    Object.assign(this.volumes, v);
    try {
      localStorage.setItem(STORE, JSON.stringify(this.volumes));
    } catch {
      // not kept, but heard
    }
    this.apply();
    this.music();
  }

  private apply(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime,
      v = this.volumes;
    this.gain.master!.gain.setTargetAtTime(v.muted ? 0 : v.master, t, 0.02);
    this.gain.sfx!.gain.setTargetAtTime(v.sfx, t, 0.02);
    this.gain.music!.gain.setTargetAtTime(v.musicOn ? v.music : 0, t, 0.05);
  }

  /** the sounds of the game's events since the last frame */
  /**
   * The game's events as sounds. With `where` (an event's place in the world, or null), each sound comes from its place
   * (stage 23): panned and quieter with distance, heard from the listener (listen()).
   */
  events(events: GameEvent[], where?: (e: GameEvent) => readonly number[] | null | undefined): void {
    for (const { sound, event } of soundsFor(events, this.extraSounds)) this.play(sound as SoundName, where ? where(event) ?? undefined : undefined);
  }

  /**
   * Where the player hears from (stage 23): the point the camera follows, turned as the camera is, so a sound left of
   * the player on screen comes from the left. V is the view matrix (column-major, the camera looking down -z).
   */
  listen(at: readonly number[], V: readonly number[]): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const L = ctx.listener as AudioListener & { positionX?: AudioParam },
      fwd = [-V[2], -V[6], -V[10]],
      up = [V[1], V[5], V[9]];
    if (L.positionX) {
      const t = ctx.currentTime;
      L.positionX.setValueAtTime(at[0], t);
      L.positionY!.setValueAtTime(at[1], t);
      L.positionZ!.setValueAtTime(at[2], t);
      L.forwardX.setValueAtTime(fwd[0], t);
      L.forwardY.setValueAtTime(fwd[1], t);
      L.forwardZ.setValueAtTime(fwd[2], t);
      L.upX.setValueAtTime(up[0], t);
      L.upY.setValueAtTime(up[1], t);
      L.upZ.setValueAtTime(up[2], t);
    } else {
      (L as any).setPosition(at[0], at[1], at[2]);
      (L as any).setOrientation(fwd[0], fwd[1], fwd[2], up[0], up[1], up[2]);
    }
  }

  play(name: SoundName, at?: readonly number[]): void {
    this.played[name] = (this.played[name] || 0) + 1;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    // a sound with a place goes through a panner (HRTF): from its side, fainter the farther it is (full within 3 units)
    let out: AudioNode = this.gain.sfx!;
    if (at) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 3;
      p.rolloffFactor = 0.9;
      p.maxDistance = 60;
      if (p.positionX) {
        p.positionX.value = at[0];
        p.positionY.value = at[1] + 0.8;
        p.positionZ.value = at[2];
      } else (p as any).setPosition(at[0], at[1] + 0.8, at[2]);
      p.connect(out);
      out = p;
      setTimeout(() => p.disconnect(), 1500);
    }
    const env = (g: GainNode, peak: number, a: number, d: number) => {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    };
    const tone = (type: OscillatorType, f0: number, f1: number, dur: number, peak: number, at = 0) => {
      const o = ctx.createOscillator(),
        g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t + at);
      o.frequency.exponentialRampToValueAtTime(f1, t + at + dur);
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(peak, t + at + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      o.connect(g).connect(out);
      o.start(t + at);
      o.stop(t + at + dur + 0.02);
    };
    const hiss = (f0: number, f1: number, dur: number, peak: number) => {
      const s = ctx.createBufferSource(),
        f = ctx.createBiquadFilter(),
        g = ctx.createGain();
      s.buffer = this.noise;
      f.type = 'bandpass';
      f.Q.value = 1.2;
      f.frequency.setValueAtTime(f0, t);
      f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      env(g, peak, 0.005, dur);
      s.connect(f).connect(g).connect(out);
      s.start(t, Math.random() * 0.5);
      s.stop(t + dur + 0.02);
    };
    switch (name) {
      case 'swing':
        hiss(2400, 500, 0.12, 0.35);
        break;
      case 'hit':
        tone('square', 240, 70, 0.11, 0.25);
        hiss(1800, 300, 0.06, 0.4);
        break;
      case 'death':
        tone('sawtooth', 320, 40, 0.55, 0.22);
        hiss(900, 120, 0.4, 0.25);
        break;
      case 'respawn':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => tone('triangle', f, f, 0.09, 0.22, k * 0.07));
        break;
      case 'blip':
        tone('square', 880, 880, 0.05, 0.12);
        break;
      case 'crash':
        hiss(1200, 90, 0.5, 0.5);
        tone('square', 150, 45, 0.3, 0.2);
        hiss(3000, 800, 0.15, 0.25);
        break;
      case 'save':
        tone('triangle', 660, 660, 0.06, 0.18);
        tone('triangle', 990, 990, 0.08, 0.18, 0.07);
        break;
    }
  }

  /** a quiet loop under the game: a bass and an arpeggio on a minor pentatonic, scheduled a little ahead */
  private music(): void {
    const ctx = this.ctx;
    if (!ctx || this.musicTimer !== null) return;
    const BEAT = 60 / 96 / 2; // eighths at 96 bpm
    const ROOT = 110; // A2
    const SCALE = [0, 3, 5, 7, 10, 12, 15, 17];
    const ARP = [0, 2, 4, 5, 4, 2, 3, 1];
    const CHORDS = [0, 5, 3, 4]; // a bar each
    this.nextBeat = ctx.currentTime + 0.1;
    const tick = () => {
      if (!this.ctx) return;
      while (this.nextBeat < this.ctx.currentTime + 0.3) {
        const t = this.nextBeat,
          bar = Math.floor(this.beat / 8) % CHORDS.length,
          step = this.beat % 8,
          base = SCALE[CHORDS[bar]];
        const note = (semi: number, type: OscillatorType, dur: number, peak: number) => {
          const o = this.ctx!.createOscillator(),
            g = this.ctx!.createGain();
          o.type = type;
          o.frequency.value = ROOT * Math.pow(2, semi / 12);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
          o.connect(g).connect(this.gain.music!);
          o.start(t);
          o.stop(t + dur + 0.02);
        };
        if (step % 4 === 0) note(base - 12, 'triangle', BEAT * 3.5, 0.5);
        note(base + 12 + SCALE[ARP[step]], 'square', BEAT * 0.8, 0.08);
        this.nextBeat += BEAT;
        this.beat++;
      }
    };
    tick();
    this.musicTimer = window.setInterval(tick, 100);
  }

  dispose(): void {
    for (const f of this.off) f();
    if (this.musicTimer !== null) clearInterval(this.musicTimer);
    void this.ctx?.close();
  }
}
