// The page the parity harness drives (public/parity.html). It builds and poses worlds exactly as the harness does in Node,
// draws them with the engine's renderer, and hands the pictures back. See test/parity/run.mjs.
import type { Scene, World } from '../types/ink-studio';
import { findScene, ink, loadSceneFile } from './kit';
import { poseAt, start } from './shared/pose.mjs';
import { makeView, rendererFor, renderFrame } from './render/index';
import type { Look } from './render/splat-renderer';

/** One scene, built once and walked forward through its times, drawn from several angles at each. */
export interface ParityScene {
  scene?: string;
  file?: string;
  times: number[];
  /** offsets added to the scene's own camera yaw */
  yaws: number[];
  /** the looks to draw each angle in */
  looks: Look[];
  w: number;
  h: number;
}

export interface ParityShot {
  t: number;
  yaw: number;
  look: Look;
  /** the grid the reference uses, worked out on this side (a mismatch here is itself a bug) */
  view: { px: number; W: number; H: number };
  /** the engine's picture, base64 rgb top row first, or null while there is no renderer */
  frame: { w: number; h: number; rgb: string } | null;
  ms: number;
  /** what the renderer sent to the graphics card before drawing this shot */
  upload: { rows: number; mode: string; total: number };
}

const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

async function sceneOf(spec: ParityScene): Promise<Scene> {
  return spec.file ? loadSceneFile(spec.file) : findScene(spec.scene!);
}

async function run(spec: ParityScene): Promise<ParityShot[]> {
  const scene = await sceneOf(spec);
  const world: World = scene.build(scene.seed);
  start(world);
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const shots: ParityShot[] = [];
  for (const t of [...spec.times].sort((a, b) => a - b)) {
    poseAt(world, t, ink().KIT);
    for (const look of spec.looks)
    for (const dy of spec.yaws) {
      const o = { t, yaw: world.cam.yaw + dy, w: spec.w, h: spec.h, look };
      const v = makeView(world, o);
      const t0 = performance.now();
      const frame = renderFrame(canvas, world, o);
      shots.push({
        t,
        yaw: dy,
        look,
        view: { px: v.px, W: v.W, H: v.H },
        frame: frame && { w: frame.w, h: frame.h, rgb: toBase64(frame.rgb) },
        ms: performance.now() - t0,
        upload: { ...rendererFor(canvas).lastUpload, total: Math.ceil(world.count / 512) }
      });
    }
  }
  return shots;
}

(window as unknown as { PARITY: unknown }).PARITY = { run, ready: true };
