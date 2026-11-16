// The engine's renderer. Stage 1 of docs/engine-plan.md: only the contract the parity harness checks against.
// Stage 2 fills renderFrame with the WebGL2 splat pass, stage 3 with the palette look.
import type { World } from '../../types/ink-studio';
import { makeView, type View, type ViewOptions } from './view';

/** A finished picture on the art grid: rgb top row first, W * H * 3 bytes, every pixel a palette colour. */
export interface Frame {
  w: number;
  h: number;
  px: number;
  rgb: Uint8Array;
}

/**
 * Draw the world as cli/render.js does, into the art grid, and read the picture back.
 * Returns null while there is no renderer yet (the harness then scores the case 0%).
 */
export function renderFrame(_canvas: HTMLCanvasElement, world: World, o: ViewOptions = {}): Frame | null {
  const view: View = makeView(world, o);
  void view; // stage 2: the WebGL2 splat pass draws here
  return null;
}

export { makeView };
export type { View, ViewOptions };
