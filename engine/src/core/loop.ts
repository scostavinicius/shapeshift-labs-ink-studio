// The game clock: a fixed step of simulation, however fast or slow frames come. The simulation only ever sees steps of
// exactly `step` seconds, so what happens in a game never depends on the frame rate, and the same steps run the same
// way in a headless run (stage 6). No DOM here: the page feeds it the time between frames.

export const STEP = 1 / 60;

export interface LoopOptions {
  /** seconds of simulation a step (default 1/60) */
  step?: number;
  /**
   * most steps run for one frame. A frame that comes very late (a background tab, a pause in the debugger) does not
   * make the game run hundreds of steps to catch up: the time beyond this is dropped (default 8, about 0.13 s).
   */
  maxSteps?: number;
}

export class FixedLoop {
  readonly step: number;
  readonly maxSteps: number;
  /** simulation time, in seconds: always a whole number of steps */
  t = 0;
  /** steps run since the start */
  steps = 0;
  /** time waiting to be simulated, under one step after each advance() */
  private acc = 0;
  /** real time dropped because frames came too late */
  dropped = 0;

  constructor(o: LoopOptions = {}) {
    this.step = o.step ?? STEP;
    this.maxSteps = o.maxSteps ?? 8;
  }

  /**
   * Let `real` seconds pass: runs as many whole steps as fit (each one calls onStep(step, t) with t the time at the end
   * of the step), keeps the remainder for the next frame, and returns how far into the next step the remainder goes
   * (0..1), for whoever wants to smooth what is drawn between steps.
   */
  advance(real: number, onStep: (dt: number, t: number) => void): number {
    if (!(real > 0)) real = 0;
    this.acc += real;
    let n = 0;
    // a hair of tolerance, so that a frame of exactly 1/60 s is one step and not none with the error carried along
    while (this.acc >= this.step - 1e-9) {
      if (n === this.maxSteps) {
        this.dropped += this.acc;
        this.acc = 0;
        break;
      }
      this.acc -= this.step;
      this.steps++;
      // computed from the count, not added up, so the clock never drifts
      this.t = this.steps * this.step;
      onStep(this.step, this.t);
      n++;
    }
    if (this.acc < 0) this.acc = 0;
    return this.acc / this.step;
  }
}
