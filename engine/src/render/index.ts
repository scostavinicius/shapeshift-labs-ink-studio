// The engine's renderer, as the rest of the engine and the parity harness use it.
//   default: the toolkit's own WebGL2 renderer (webgl.mjs), wrapped by upstream.ts (stage 14)
//   ?renderer=old in the page's address: the engine's first renderer (splat-renderer.ts, a port of cli/render.js), kept
//   while the two are compared
import type { World } from '../../types/ink-studio';
import { SplatRenderer, type DrawOptions } from './splat-renderer';
import { UpstreamRenderer } from './upstream';
import { makeView, type View, type ViewOptions } from './view';

/** A finished picture on the art grid: rgb top row first, W * H * 3 bytes, every pixel a palette colour. */
export interface Frame {
  w: number;
  h: number;
  px: number;
  rgb: Uint8Array;
}

export type EngineRenderer = SplatRenderer | UpstreamRenderer;
export type RendererKind = 'toolkit' | 'old';

/** The renderer the page asked for: ?renderer=old picks the engine's first one. */
export function rendererKind(): RendererKind {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('renderer') : null;
  return q === 'old' ? 'old' : 'toolkit';
}

const renderers = new WeakMap<HTMLCanvasElement, EngineRenderer>();

/** The renderer that draws on this canvas (made on first use). */
export function rendererFor(canvas: HTMLCanvasElement, kind: RendererKind = rendererKind()): EngineRenderer {
  let r = renderers.get(canvas);
  if (!r) renderers.set(canvas, (r = kind === 'old' ? new SplatRenderer(canvas) : new UpstreamRenderer(canvas)));
  return r;
}

/**
 * Draw the world into the art grid and read the picture back. The splats are sent as the live page sends them (only
 * what changed since the last call), so a system that writes splats without marking them shows up here.
 */
export function renderFrame(canvas: HTMLCanvasElement, world: World, o: ViewOptions & DrawOptions = {}): Frame {
  const r = rendererFor(canvas),
    view = makeView(world, o);
  r.upload(world);
  r.draw(world, view, o);
  return { ...r.read(), px: view.px };
}

export { makeView, SplatRenderer, UpstreamRenderer };
export type { View, ViewOptions, DrawOptions };
