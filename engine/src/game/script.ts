// Input as data (docs/engine-stage6-design.md §5): a script plays into an InputState exactly as the keyboard would, and a
// recorder turns what a player did into a script. An event at step n is in place when step n runs (the first step is 0).
import type { InputState } from '../core/input';
import type { Script, ScriptEvent } from './types';

const STEP = 1 / 60;

/** the step an event is for */
export function stepOf(e: ScriptEvent): number {
  return 'step' in e ? Math.round(e.step) : Math.round(e.t / STEP);
}

type Op = (inp: InputState) => void;

export class ScriptPlayer {
  private ops = new Map<number, Op[]>();
  /** the last step any event touches (a tap's release included) */
  readonly lastStep: number;

  constructor(readonly script: Script) {
    let last = 0;
    const at = (n: number, op: Op) => {
      if (n < 0) throw new Error(`script: an event at step ${n}: steps start at 0`);
      const l = this.ops.get(n);
      if (l) l.push(op);
      else this.ops.set(n, [op]);
      last = Math.max(last, n);
    };
    // events are applied in the order written, within a step
    for (const e of script.events) {
      const n = stepOf(e);
      if ('press' in e) at(n, i => i.press(e.press));
      else if ('release' in e) at(n, i => i.release(e.release));
      else if ('tap' in e) {
        at(n, i => i.press(e.tap));
        at(n + Math.max(1, e.for ?? 1), i => i.release(e.tap));
      } else if ('stick' in e) at(n, i => i.stick(e.stick[0], e.stick[1]));
      else if ('turn' in e) at(n, i => i.turn(e.turn[0], e.turn[1], e.zoom ?? 1));
      else if ('click' in e) at(n, i => i.click(e.click[0], e.click[1]));
      else throw new Error('script: an event that does nothing: ' + JSON.stringify(e));
    }
    this.lastStep = last;
  }

  /** the size of the stage clicks are worked out through */
  get view(): { w: number; h: number } {
    return this.script.view || { w: 900, h: 620 };
  }

  /** put the events of step n into the input (call just before step n runs) */
  apply(n: number, inp: InputState): void {
    for (const op of this.ops.get(n) || []) op(inp);
  }
}

/**
 * Records what is done to an InputState, step by step, as a script. `step()` says which step is next (game.steps).
 * The stick is recorded when it changes.
 */
export class InputRecorder {
  private events: ScriptEvent[] = [];
  private undo: (() => void)[] = [];
  private lastStick: [number, number] = [0, 0];

  constructor(
    private inp: InputState,
    private step: () => number,
    private view?: { w: number; h: number }
  ) {
    const wrap = <K extends 'press' | 'release' | 'stick' | 'turn' | 'click'>(name: K, ev: (...a: Parameters<InputState[K]>) => ScriptEvent | null) => {
      const real = inp[name].bind(inp) as (...a: unknown[]) => void;
      (inp as any)[name] = (...a: Parameters<InputState[K]>) => {
        const e = ev(...a);
        if (e) this.events.push(e);
        real(...a);
      };
      this.undo.push(() => delete (inp as any)[name]);
    };
    wrap('press', a => ({ step: this.step(), press: a }));
    wrap('release', a => ({ step: this.step(), release: a }));
    wrap('stick', (x, y) => {
      if (x === this.lastStick[0] && y === this.lastStick[1]) return null;
      this.lastStick = [x, y];
      return { step: this.step(), stick: [x, y] };
    });
    wrap('turn', (yaw, pitch, zoom = 1) => (yaw || pitch || zoom !== 1 ? { step: this.step(), turn: [yaw, pitch], ...(zoom !== 1 ? { zoom } : {}) } : null));
    wrap('click', (u, v) => ({ step: this.step(), click: [u, v] }));
  }

  /** what was recorded so far */
  script(seed?: number): Script {
    return { ...(seed !== undefined ? { seed } : {}), ...(this.view ? { view: this.view } : {}), events: this.events.map(e => ({ ...e })) };
  }

  /** stop recording */
  stop(): void {
    for (const f of this.undo) f();
    this.undo = [];
  }
}
