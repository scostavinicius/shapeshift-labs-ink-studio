// The engine's renderer, as the rest of the engine and the parity harness use it.
import type { World } from '../../types/ink-studio';
import { SplatRenderer } from './splat-renderer';
import { makeView, type View, type ViewOptions } from './view';

/** A finished picture on the art grid: rgb top row first, W * H * 3 bytes, every pixel a palette colour. */
export interface Frame {
  w: number;
  h: number;
  px: number;
  rgb: Uint8Array;
}

const renderers = new WeakMap<HTMLCanvasElement, SplatRenderer>();

/** The renderer that draws on this canvas (made on first use). */
export function rendererFor(canvas: HTMLCanvasElement): SplatRenderer {
  let r = renderers.get(canvas);
  if (!r) renderers.set(canvas, (r = new SplatRenderer(canvas)));
  return r;
}

/** Draw the world as cli/render.js does, into the art grid, and read the picture back. */
export function renderFrame(canvas: HTMLCanvasElement, world: World, o: ViewOptions & { dither?: number } = {}): Frame {
  const r = rendererFor(canvas),
    view = makeView(world, o);
  r.uploadAll(world);
  r.draw(world, view, o);
  return { ...r.read(), px: view.px };
}

export { makeView, SplatRenderer };
export type { View, ViewOptions };
