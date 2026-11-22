// The toolkit's own WebGL2 renderer (webgl.mjs -> src/webgl/renderer.mjs), behind the same face as the engine's first
// renderer (splat-renderer.ts), so the page, the parity harness and the perf harness use either one the same way.
//
// What the engine keeps doing itself, because the toolkit's renderer does not:
//   - the view: makeView (view.ts) still picks the art-pixel size and the grid, and clicks are traced through it; the
//     renderer gets that orbit as it is, with lockCamera so it does not apply the world's zoom and kick a second time
//   - the order: sorting stays in the Worker (sorter.ts), off the page's thread, and each order goes to the renderer as
//     an Int32Array; the toolkit's renderer would sort on the page's thread every frame something moves
//   - what changed: the rows marked in anim.rows (or the anim's span) become the renderer's changedRows
//   - reading the picture back, and timing the graphics card
import type { World } from '../../types/ink-studio';
import { ink } from '../kit';
// @ts-ignore -- plain JavaScript; the little of it used here is typed below
import { createRenderer as createToolkitRenderer } from '../../../webgl.mjs';
import { WorkerSorter } from './sorter';
import type { DrawOptions } from './splat-renderer';
import type { View } from './view';

const SPLATS_PER_ROW = 512;
const FLOATS_PER_ROW = SPLATS_PER_ROW * 16;

/** The part of the toolkit's renderer the engine uses (docs/browser-renderer.md). */
interface ToolkitRenderer {
  render(world: World, frame: Record<string, unknown>): unknown;
  dispose(): void;
}

/** Frame options the engine passes through as they are (docs/browser-renderer.md, docs/continuous-splat-coverage.md). */
export interface UpstreamFrameOptions {
  /** 'legacy' (the default), 'continuous' (joins neighbouring opaque splats: no holes at small art pixels) or 'soft' */
  splatCoverage?: 'legacy' | 'continuous' | 'soft';
  /** anything else the toolkit's renderer takes for a frame (tone, outline, renderGraph, emitter resolutions...) */
  extra?: Record<string, unknown>;
}

export class UpstreamRenderer {
  readonly kind = 'toolkit' as const;
  readonly gl: WebGL2RenderingContext;
  /** the toolkit's renderer keeps its targets in floats when it can; reported for the status line only */
  readonly float32: boolean;
  private r: ToolkitRenderer;
  private sorter: WorkerSorter | null = null;
  private padded: Float32Array | null = null;
  private uploaded: { world: World; count: number } | null = null;
  /** rows changed since the last draw; null: send everything */
  private pending: Set<number> | null = null;
  /** how the last draw was ordered, and what sorting cost the page's own thread in milliseconds */
  lastSort: { by: 'page' | 'worker' | 'given'; ms: number; workerMs: number } = { by: 'page', ms: 0, workerMs: 0 };
  /** what upload() last took note of: how many rows of 512 splats, and why */
  lastUpload: { rows: number; mode: 'all' | 'marked' | 'span' } = { rows: 0, mode: 'all' };
  lastGpuMs = NaN;
  private timer: { ext: any; pending: WebGLQuery[] } | null = null;
  W = 0;
  H = 0;
  drawn = 0;
  /** frame options added to every draw (set by the page: coverage, emitters...) */
  frame: UpstreamFrameOptions = {};

  constructor(readonly canvas: HTMLCanvasElement) {
    const toolkit = ink();
    const create = createToolkitRenderer as unknown as (c: HTMLCanvasElement, o: { toolkit: unknown }) => ToolkitRenderer;
    this.r = create(canvas, { toolkit });
    // the same context the toolkit's renderer made (getContext hands back the existing one)
    this.gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
    this.float32 = !!this.gl.getExtension('EXT_float_blend');
  }

  /** Sort in a worker from now on (url: the built sort-worker script); see splat-renderer.ts. */
  useSortWorker(url: string): WorkerSorter {
    if (this.sorter) this.sorter.dispose();
    this.sorter = new WorkerSorter(url);
    if (this.uploaded && this.padded) this.sorter.init(this.padded, this.uploaded.count, this.uploaded.world.back);
    return this.sorter;
  }

  private mirrorAll(world: World): void {
    const rows = Math.max(1, Math.ceil(world.count / SPLATS_PER_ROW)),
      need = rows * FLOATS_PER_ROW;
    if (!this.padded || this.padded.length !== need) this.padded = new Float32Array(need);
    else this.padded.fill(0);
    this.padded.set(world.data.subarray(0, world.count * 16));
    this.uploaded = { world, count: world.count };
    this.pending = null;
    this.lastUpload = { rows, mode: 'all' };
    if (this.sorter) this.sorter.init(this.padded, world.count, world.back);
    const marks = world.anim && world.anim.rows;
    if (marks) marks.fill(0);
  }

  /** Take note of what changed since the last upload (the same rules as splat-renderer.ts upload()). */
  upload(world: World): void {
    const a = world.anim;
    if (!this.uploaded || this.uploaded.world !== world || this.uploaded.count !== world.count) return this.mirrorAll(world);
    if (!a) return void (this.lastUpload = { rows: 0, mode: 'marked' });
    const data = world.data,
      len = world.count * 16,
      padded = this.padded!,
      rows = padded.length / FLOATS_PER_ROW,
      changed: number[] = [];
    const take = (r: number) => {
      const o = r * FLOATS_PER_ROW;
      padded.set(data.subarray(o, Math.min(o + FLOATS_PER_ROW, len)), o);
      changed.push(r);
      if (this.pending) this.pending.add(r);
    };
    const marks = a.rows;
    if (marks) {
      for (let r = 0; r < marks.length && r < rows; r++)
        if (marks[r]) {
          take(r);
          marks[r] = 0;
        }
      this.lastUpload = { rows: changed.length, mode: 'marked' };
    } else {
      const start = (a.start as number) || 0,
        count = (a.count as number) ?? world.count;
      for (let r = Math.floor(start / SPLATS_PER_ROW); r < Math.ceil((start + count) / SPLATS_PER_ROW) && r < rows; r++) take(r);
      this.lastUpload = { rows: changed.length, mode: 'span' };
    }
    if (this.sorter) this.sorter.rows(changed, padded, FLOATS_PER_ROW);
  }

  /** Time the graphics card's work for each draw. False if the browser cannot. */
  timeGpu(on: boolean): boolean {
    if (!on) {
      this.timer = null;
      return true;
    }
    const ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return false;
    this.timer = { ext, pending: [] };
    return true;
  }

  /** Draw the world for this view onto the canvas. */
  draw(world: World, view: View, o: DrawOptions = {}): void {
    const tm = this.timer;
    if (!tm) return this.drawFrame(world, view, o);
    const gl = this.gl;
    while (tm.pending.length) {
      const q = tm.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      tm.pending.shift();
      if (!gl.getParameter(tm.ext.GPU_DISJOINT_EXT)) this.lastGpuMs = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(q);
    }
    const q = gl.createQuery()!;
    gl.beginQuery(tm.ext.TIME_ELAPSED_EXT, q);
    try {
      this.drawFrame(world, view, o);
    } finally {
      gl.endQuery(tm.ext.TIME_ELAPSED_EXT);
    }
    tm.pending.push(q);
    if (tm.pending.length > 8) gl.deleteQuery(tm.pending.shift()!);
  }

  private drawFrame(world: World, view: View, o: DrawOptions): void {
    if (this.gl.isContextLost()) return; // the toolkit's renderer rebuilds itself on the first draw after a restore
    const N = world.count,
      began = performance.now(),
      sorter = this.sorter,
      bones = (world.anim && world.anim.bones) || null;
    let order: Int32Array | undefined,
      by: 'page' | 'worker' | 'given' = 'page';
    if (o.order) {
      order = new Int32Array(o.order.buffer, o.order.byteOffset, o.order.length);
      by = 'given';
    } else if (sorter) {
      sorter.request(view.t, view.V, bones);
      if (sorter.order && sorter.order.length === N) {
        order = new Int32Array(sorter.order.buffer, sorter.order.byteOffset, sorter.order.length);
        by = 'worker';
      }
    }
    const frame: Record<string, unknown> = {
      ...this.frame.extra,
      width: view.W,
      height: view.H,
      time: view.t,
      // the orbit as a camera layer, not as frame.target: inside the renderer, some passes (textured surfaces) hand a
      // frame on with `target` set to a draw target, and a frame-level target array would be read as that
      camera: { yaw: view.yaw, pitch: view.pitch, dist: view.dist, target: view.target },
      lockCamera: true,
      colored: o.look === 'colored',
      dither: o.dither === undefined ? 0.35 : o.dither,
      changedRows: this.pending ? [...this.pending] : undefined
    };
    if (this.frame.splatCoverage) frame.splatCoverage = this.frame.splatCoverage;
    if (order) frame.order = order;
    this.r.render(world, frame);
    this.pending = new Set();
    this.W = view.W;
    this.H = view.H;
    this.drawn = N;
    this.lastSort = { by, ms: by === 'page' ? performance.now() - began : 0, workerMs: sorter ? sorter.ms : 0 };
  }

  /** The last picture drawn: rgb bytes, top row first (read straight after drawing, before the browser shows it). */
  read(): { w: number; h: number; rgb: Uint8Array } {
    const gl = this.gl,
      { W, H } = this,
      px = new Uint8Array(W * H * 4),
      rgb = new Uint8Array(W * H * 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const s = ((H - 1 - y) * W + x) * 4,
          d = (y * W + x) * 3;
        rgb[d] = px[s];
        rgb[d + 1] = px[s + 1];
        rgb[d + 2] = px[s + 2];
      }
    return { w: W, h: H, rgb };
  }

  dispose(): void {
    if (this.sorter) this.sorter.dispose();
    this.r.dispose();
  }
}
