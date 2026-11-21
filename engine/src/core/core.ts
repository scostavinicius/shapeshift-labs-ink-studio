// The game core: one world, the fixed-step clock, input, the follow camera and clicks into the scene, put together. No
// DOM and no renderer: the page (main.ts) feeds it frames and input and draws the view it returns; the headless runner
// (stage 6) will drive the same core from a script of inputs.
//
// One fixed step, in order:
//   1. the input since the last step is sampled (movement turned by the camera's yaw)
//   2. the camera takes the player's turns and zoom
//   3. clicks become lines from the eye (through the view that was on screen) and poke the world, before it moves on,
//      as the CLI's --poke does
//   4. the game's own step (onStep) runs: it reads the input, moves things, tells the camera what to follow
//   5. the camera eases, and the world's systems run to the new time
import type { Kit, Vec3, World } from '../../types/ink-studio';
import { makeView, type View } from '../render/view';
import { poseAt, start as startWorld } from '../shared/pose.mjs';
import { FollowCamera, type CameraOptions } from './camera';
import { InputState, type Sample } from './input';
import { FixedLoop, type LoopOptions } from './loop';
import { rayThrough, type Ray } from './pick';

export interface PokeRecord {
  /** simulation time of the step it went into */
  t: number;
  ray: Ray;
  /** what the world's K.pick found along the line (null: nothing there, or no system listens to taps) */
  hit: { i: number; t: number; p: Vec3 } | null;
}

export interface CoreOptions extends LoopOptions {
  camera?: CameraOptions;
  input?: InputState;
  /** 'gpu' (default) leaves splats carried by bones at rest for the engine's renderer; 'cpu' poses them in world.data */
  bones?: 'gpu' | 'cpu';
  /** the game's step, after input and clicks, before the world moves on */
  onStep?: (dt: number, t: number, input: Sample, core: Core) => void;
}

export class Core {
  readonly loop: FixedLoop;
  readonly input: InputState;
  readonly camera: FollowCamera;
  onStep: CoreOptions['onStep'];
  /** the last taps (newest last, up to 32), for the page's status and for tests */
  readonly pokes: PokeRecord[] = [];
  /** the view last drawn: clicks are worked out through it, since it is what the player saw */
  shown: View | null = null;
  /** the art-pixel size asked for (screen pixels per art pixel), or null: worked out from the scene (makeView) */
  px: number | null = null;
  private bones: 'gpu' | 'cpu';

  constructor(
    readonly world: World,
    readonly K: Kit,
    o: CoreOptions = {}
  ) {
    this.loop = new FixedLoop(o);
    this.input = o.input || new InputState();
    this.camera = FollowCamera.fromWorld(world, o.camera);
    this.onStep = o.onStep;
    this.bones = o.bones || 'gpu';
    startWorld(world);
  }

  /** Simulation time, in seconds. */
  get t(): number {
    return this.loop.t;
  }

  /**
   * Let `real` seconds pass (runs the steps that fit). beforeStep gets the step's dt and its index (0 for the first step:
   * the numbering of scripts). Returns how far into the next step the remainder goes (0..1).
   */
  advance(real: number, beforeStep?: (dt: number, step: number) => void): number {
    return this.loop.advance(real, (dt, t) => {
      // (the loop has counted this step already: its index is one less)
      beforeStep?.(dt, this.loop.steps - 1);
      this.step(dt, t);
    });
  }

  /**
   * Run the simulation until `seconds` more have passed, every step of it, with no frame cap (a test, a headless run).
   * Ends on the step boundary nearest the time asked for.
   */
  run(seconds: number): void {
    const n = Math.round(seconds / this.loop.step);
    for (let k = 0; k < n; k++) this.advance(this.loop.step);
  }

  private step(dt: number, t: number): void {
    const s = this.input.sample(this.camera.yaw);
    this.camera.look(s.look);
    for (const c of s.clicks) if (this.shown) this.poke(rayThrough(this.shown, c.u, c.v));
    this.onStep?.(dt, t, s, this);
    this.camera.update(dt);
    poseAt(this.world, t, this.K, { bones: this.bones });
  }

  /** Tap the world along a line (what a click does). Returns what was hit, if anything. */
  poke(ray: Ray): PokeRecord['hit'] {
    const an = this.world.anim;
    const hit = an && an.poke ? ((an.poke(ray.eye, ray.dir, this.t) as PokeRecord['hit']) ?? null) : null;
    this.pokes.push({ t: this.t, ray, hit: hit ? { i: hit.i, t: hit.t, p: hit.p } : null });
    if (this.pokes.length > 32) this.pokes.shift();
    return hit;
  }

  /** The view of the camera now, on a stage of w x h screen pixels (what makeView would give the renderer). */
  view(w: number, h: number): View {
    return makeView(this.world, { t: this.t, ...this.camera.view(), w, h, px: this.px ?? undefined });
  }
}
