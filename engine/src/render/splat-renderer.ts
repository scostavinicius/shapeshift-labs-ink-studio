// The WebGL2 renderer. One instanced quad a splat, drawn back to front into three float targets on the art grid (colour,
// depth, glass), then resolved into the picture. It follows cli/render.js step for step: see shaders.ts.
//   default look: one splat pass, then RESOLVE (glass, contact shade, outline, ordered noise, nearest palette colour)
//   colored look: a splat pass on the art grid, WORKED into 8-bit colour; a splat pass on a grid twice as fine, QUANTized
//                 to 8 bits; then PixelLook's own resolve (coloredFS) joins them
import type { World } from '../../types/ink-studio';
import { ink } from '../kit';
import { makeScratch, sortSplats, type OrderScratch } from './order';
import {
  COLORED_MAX,
  coloredFS,
  DATA_WIDTH,
  QUANT_FS,
  RESOLVE_FS,
  SCREEN_VS,
  SPLAT_FS,
  SPLAT_VS,
  SPLATS_PER_ROW,
  WORKED_FS
} from './shaders';
import { WorkerSorter } from './sorter';
import { finer, type View } from './view';

const FLOATS_PER_ROW = DATA_WIDTH * 4;

export type Look = 'default' | 'colored';

export interface DrawOptions {
  /** the ordered-noise amount, as cli/render.js takes it (0.35 when not given) */
  dither?: number;
  look?: Look;
  /** draw in this order (farthest first) instead of sorting: for checking an order made elsewhere */
  order?: Uint32Array;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(sh));
  return sh;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('program: ' + gl.getProgramInfoLog(p));
  return p;
}

function uniforms<K extends string>(gl: WebGL2RenderingContext, p: WebGLProgram, names: readonly K[]) {
  const out = {} as Record<K, WebGLUniformLocation | null>;
  for (const n of names) out[n] = gl.getUniformLocation(p, n);
  return out;
}

/** A program and its uniform locations. */
interface Pass<K extends string> {
  prog: WebGLProgram;
  u: Record<K, WebGLUniformLocation | null>;
}

/** The three float targets one splat pass draws into, at one grid size. */
interface SceneTargets {
  W: number;
  H: number;
  fbo: WebGLFramebuffer;
  color: WebGLTexture;
  depth: WebGLTexture;
  glass: WebGLTexture;
}

/** One 8-bit colour target. */
interface Target {
  W: number;
  H: number;
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
}

export class SplatRenderer {
  readonly gl: WebGL2RenderingContext;
  /** true when colour and depth are kept in 32-bit floats (needs EXT_float_blend); otherwise 16-bit */
  readonly float32: boolean;
  private splat: Pass<
    'u_data' | 'u_boneTex' | 'u_nb' | 'u_V' | 'u_size' | 'u_lim' | 'u_t' | 'u_focal' | 'u_near' | 'u_dist' | 'u_R' | 'u_fogCol' | 'u_fog' | 'u_grow'
  >;
  private resolve: Pass<
    'u_color' | 'u_depth' | 'u_glass' | 'u_pal' | 'u_n' | 'u_dith' | 'u_bend' | 'u_ao' | 'u_edge' | 'u_line'
  >;
  private worked: Pass<'u_color' | 'u_depth' | 'u_glass' | 'u_bend' | 'u_ao'>;
  private quant: Pass<'u_color'>;
  private colored: Pass<
    'u_pal' | 'u_out' | 'u_n' | 'u_grade' | 'u_dither' | 'u_scene' | 'u_depth' | 'u_crispScene'
  > | null = null;
  private vao: WebGLVertexArrayObject;
  private indexBuf: WebGLBuffer;
  private dataTex: WebGLTexture;
  private palTex: WebGLTexture;
  private boneTex: WebGLTexture;
  private boneCount = 0;
  private sorter: WorkerSorter | null = null;
  private sorterVersion = -1;
  /** how the last draw was ordered, and what sorting cost the page's own thread in milliseconds */
  lastSort: { by: 'page' | 'worker' | 'given'; ms: number; workerMs: number } = { by: 'page', ms: 0, workerMs: 0 };
  private dataRows = 0;
  private padded: Float32Array | null = null;
  private scratch: OrderScratch | null = null;
  // targets, made at the size first asked for and made again when it changes
  private scene: SceneTargets | null = null;
  private fine: SceneTargets | null = null;
  private native8: Target | null = null;
  private fine8: Target | null = null;
  private out: Target | null = null;
  /** the size of the last picture drawn */
  W = 0;
  H = 0;
  /** splats handed to the graphics card in the last draw (all of them: culling happens there) */
  drawn = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false });
    if (!gl) throw new Error('WebGL2 is not available');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is not available');
    this.gl = gl;
    this.float32 = !!gl.getExtension('EXT_float_blend');
    this.splat = this.pass(SPLAT_VS, SPLAT_FS, [
      'u_data', 'u_boneTex', 'u_nb', 'u_V', 'u_size', 'u_lim', 'u_t', 'u_focal', 'u_near', 'u_dist', 'u_R', 'u_fogCol', 'u_fog', 'u_grow'
    ] as const);
    this.resolve = this.pass(SCREEN_VS, RESOLVE_FS, [
      'u_color', 'u_depth', 'u_glass', 'u_pal', 'u_n', 'u_dith', 'u_bend', 'u_ao', 'u_edge', 'u_line'
    ] as const);
    this.worked = this.pass(SCREEN_VS, WORKED_FS, ['u_color', 'u_depth', 'u_glass', 'u_bend', 'u_ao'] as const);
    this.quant = this.pass(SCREEN_VS, QUANT_FS, ['u_color'] as const);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.indexBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.indexBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_INT, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);

    this.dataTex = this.texture();
    this.palTex = this.texture();
    this.boneTex = this.texture();
  }

  /**
   * Sort in a worker from now on (url: the built sort-worker script). The page's thread then only passes messages; the
   * order drawn is a frame or two behind. Without this, every draw sorts in step, which is exact.
   */
  useSortWorker(url: string): WorkerSorter {
    if (this.sorter) this.sorter.dispose();
    this.sorter = new WorkerSorter(url);
    this.sorterVersion = -1;
    if (this.uploaded && this.padded) this.sorter.init(this.padded, this.uploaded.count, this.uploaded.world.back);
    return this.sorter;
  }

  /** The bones (anim.bones: 12 floats each, a 3x3 turn by rows then a move) as a texture 3 wide: a row a bone. */
  private uploadBones(world: World): void {
    const gl = this.gl,
      m = world.anim && world.anim.bones;
    this.boneCount = m ? m.length / 12 : 0;
    if (!m) return;
    const px = new Float32Array(this.boneCount * 12);
    for (let b = 0; b < this.boneCount; b++) {
      const k = b * 12;
      px.set([m[k], m[k + 1], m[k + 2], m[k + 9], m[k + 3], m[k + 4], m[k + 5], m[k + 10], m[k + 6], m[k + 7], m[k + 8], m[k + 11]], k);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.boneTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 3, this.boneCount, 0, gl.RGBA, gl.FLOAT, px);
  }

  private pass<K extends string>(vs: string, fs: string, names: readonly K[]): Pass<K> {
    const prog = program(this.gl, vs, fs);
    return { prog, u: uniforms(this.gl, prog, names) };
  }

  private texture(): WebGLTexture {
    const gl = this.gl,
      t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private storage(W: number, H: number, internal: number): WebGLTexture {
    const t = this.texture();
    this.gl.texStorage2D(this.gl.TEXTURE_2D, 1, internal, W, H);
    return t;
  }

  private framebuffer(textures: WebGLTexture[]): WebGLFramebuffer {
    const gl = this.gl,
      fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    textures.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers(textures.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer is incomplete');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fbo;
  }

  private sceneTargets(old: SceneTargets | null, W: number, H: number): SceneTargets {
    if (old && old.W === W && old.H === H) return old;
    const gl = this.gl;
    if (old) {
      gl.deleteFramebuffer(old.fbo);
      for (const t of [old.color, old.depth, old.glass]) gl.deleteTexture(t);
    }
    const color = this.storage(W, H, this.float32 ? gl.RGBA32F : gl.RGBA16F),
      depth = this.storage(W, H, this.float32 ? gl.R32F : gl.R16F),
      // (glass is kept in floats too: its small additions would be lost to rounding in 8 bits)
      glass = this.storage(W, H, this.float32 ? gl.R32F : gl.R16F);
    return { W, H, color, depth, glass, fbo: this.framebuffer([color, depth, glass]) };
  }

  private target(old: Target | null, W: number, H: number): Target {
    if (old && old.W === W && old.H === H) return old;
    const gl = this.gl;
    if (old) {
      gl.deleteFramebuffer(old.fbo);
      gl.deleteTexture(old.tex);
    }
    const tex = this.storage(W, H, gl.RGBA8);
    return { W, H, tex, fbo: this.framebuffer([tex]) };
  }

  /** Send every splat to the graphics card. */
  uploadAll(world: World): void {
    const gl = this.gl,
      rows = Math.max(1, Math.ceil(world.count / SPLATS_PER_ROW)),
      need = rows * FLOATS_PER_ROW,
      src = world.data.subarray(0, world.count * 16);
    gl.bindTexture(gl.TEXTURE_2D, this.dataTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (!this.padded || this.padded.length !== need) this.padded = new Float32Array(need);
    this.padded.set(src);
    if (rows !== this.dataRows) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, DATA_WIDTH, rows, 0, gl.RGBA, gl.FLOAT, this.padded);
      this.dataRows = rows;
    } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, DATA_WIDTH, rows, gl.RGBA, gl.FLOAT, this.padded);
    this.uploaded = { world, count: world.count };
    this.lastUpload = { rows, mode: 'all' };
    if (this.sorter) this.sorter.init(this.padded, world.count, world.back);
    const marks = world.anim && world.anim.rows;
    if (marks) marks.fill(0);
  }

  /** what upload() last sent: how many rows of 512 splats, and why */
  lastUpload: { rows: number; mode: 'all' | 'marked' | 'span' } = { rows: 0, mode: 'all' };
  private uploaded: { world: World; count: number } | null = null;

  /**
   * Send what changed since the last upload, as the toolkit's stage asks a host to (and as `ink-studio perf` counts it):
   *   - the first time, or for another world: everything
   *   - a world whose anim marks rows (anim.rows, one flag per 512 splats): those rows, and the flags are cleared
   *   - a world whose anim has no marks: its moving span, anim.start .. anim.start + anim.count, every time
   * A world without anim never changes after its first upload. Splats carried by bones stay at rest in the data (the
   * shader puts them in place from anim.bones), so a creature of tens of thousands of splats sends nothing.
   */
  upload(world: World): void {
    const a = world.anim;
    if (!this.uploaded || this.uploaded.world !== world || this.uploaded.count !== world.count) return this.uploadAll(world);
    if (!a) return void (this.lastUpload = { rows: 0, mode: 'marked' });
    const gl = this.gl,
      data = world.data,
      len = world.count * 16,
      padded = this.padded!;
    gl.bindTexture(gl.TEXTURE_2D, this.dataTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    let sent = 0;
    const changed: number[] = [];
    // one row: the floats of its 512 splats into the mirror (the last row is short), then that row of the texture
    const send = (r: number) => {
      const o = r * FLOATS_PER_ROW;
      padded.set(data.subarray(o, Math.min(o + FLOATS_PER_ROW, len)), o);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r, DATA_WIDTH, 1, gl.RGBA, gl.FLOAT, padded, o);
      changed.push(r);
      sent++;
    };
    const marks = a.rows;
    if (marks) {
      for (let r = 0; r < marks.length && r < this.dataRows; r++)
        if (marks[r]) {
          send(r);
          marks[r] = 0;
        }
      this.lastUpload = { rows: sent, mode: 'marked' };
    } else {
      const start = (a.start as number) || 0,
        count = (a.count as number) ?? world.count;
      for (let r = Math.floor(start / SPLATS_PER_ROW); r < Math.ceil((start + count) / SPLATS_PER_ROW) && r < this.dataRows; r++)
        send(r);
      this.lastUpload = { rows: sent, mode: 'span' };
    }
    if (this.sorter) this.sorter.rows(changed, padded, FLOATS_PER_ROW);
  }

  // the palette as a texture of two rows: the colours a pixel is matched against, and under each the colour that is
  // shown for it (the same, unless the world's anim has regraded the palette)
  private uploadPalette(world: World): void {
    const gl = this.gl,
      n = world.pal.length,
      px = new Uint8Array(n * 8),
      grade = world.anim && world.anim.grade;
    for (let i = 0; i < n; i++) {
      const h = world.pal[i],
        q = i * 4,
        g = (n + i) * 4;
      px[q] = (h >> 16) & 255;
      px[q + 1] = (h >> 8) & 255;
      px[q + 2] = h & 255;
      px[q + 3] = 255;
      if (grade) {
        px[g] = Math.round(grade[i * 3] * 255);
        px[g + 1] = Math.round(grade[i * 3 + 1] * 255);
        px[g + 2] = Math.round(grade[i * 3 + 2] * 255);
      } else {
        px[g] = px[q];
        px[g + 1] = px[q + 1];
        px[g + 2] = px[q + 2];
      }
      px[g + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.palTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, n, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
  }

  private static hex(world: World, i: number): number[] {
    const h = world.pal[i];
    return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
  }

  /** The splats, back to front (in the order already in indexBuf), into one set of colour, depth and glass targets. */
  private splatPass(world: World, view: View, into: SceneTargets): void {
    const gl = this.gl,
      { W, H } = view,
      bg = SplatRenderer.hex(world, 0),
      fog = SplatRenderer.hex(world, world.fog.c),
      grow = world.grow || {},
      u = this.splat.u;
    gl.bindFramebuffer(gl.FRAMEBUFFER, into.fbo);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearBufferfv(gl.COLOR, 0, [bg[0], bg[1], bg[2], 1]);
    gl.clearBufferfv(gl.COLOR, 1, [1, 0, 0, 1]);
    gl.clearBufferfv(gl.COLOR, 2, [0, 0, 0, 0]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.splat.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.dataTex);
    gl.uniform1i(u.u_data, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.boneTex);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(u.u_boneTex, 1);
    gl.uniform1i(u.u_nb, this.boneCount);
    gl.uniformMatrix4fv(u.u_V, false, view.V);
    gl.uniform2f(u.u_size, W, H);
    gl.uniform2f(u.u_lim, (1.3 * 0.5 * W) / view.focal, (1.3 * 0.5 * H) / view.focal);
    gl.uniform1f(u.u_t, view.t);
    gl.uniform1f(u.u_focal, view.focal);
    gl.uniform1f(u.u_near, view.near);
    gl.uniform1f(u.u_dist, view.dist);
    gl.uniform1f(u.u_R, world.radius);
    gl.uniform3f(u.u_fogCol, fog[0], fog[1], fog[2]);
    gl.uniform2f(u.u_fog, world.fog.start, world.fog.max);
    gl.uniform3f(u.u_grow, grow.rate || 1, grow.loop && grow.loop > 0 ? grow.loop : 0, grow.fade || 0.5);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, world.count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  /** Bind textures to units 0, 1, 2 ... for a full-screen pass. */
  private bindTextures(textures: WebGLTexture[]): void {
    const gl = this.gl;
    textures.forEach((t, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
    });
    gl.activeTexture(gl.TEXTURE0);
  }

  private screen(into: Target): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, into.fbo);
    gl.viewport(0, 0, into.W, into.H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Draw the world (as last uploaded) for this view, and show it on the canvas. */
  draw(world: World, view: View, o: DrawOptions = {}): void {
    const gl = this.gl,
      N = world.count,
      { W, H } = view,
      R2 = 2 * world.radius,
      ao = world.ao,
      aoK = ao ? (ao.k === undefined ? 0.5 : ao.k) : 0,
      aoR = ao ? (ao.range || 0.6) / R2 : 1,
      bend = world.refract === undefined ? 6 : world.refract,
      dith = (o.dither === undefined ? 0.35 : o.dither) * 0.3 * world.dither;
    this.W = W;
    this.H = H;
    this.out = this.target(this.out, W, H);
    this.scene = this.sceneTargets(this.scene, W, H);
    this.uploadBones(world);
    // ---- the order (one serves both grids of the colored look: depth depends only on the camera, which they share)
    const bones = (world.anim && world.anim.bones) || null,
      began = performance.now(),
      sorter = this.sorter;
    let order: Uint32Array | null = null,
      by: 'page' | 'worker' | 'given' = 'page';
    if (o.order) {
      order = o.order;
      by = 'given';
      this.sorterVersion = -1;
    } else if (sorter) {
      sorter.request(view.t, view.V, bones);
      by = 'worker';
      if (sorter.order && sorter.order.length === N) {
        // the newest the worker has made: sent to the graphics card only when it is new
        if (sorter.version !== this.sorterVersion) {
          order = sorter.order;
          this.sorterVersion = sorter.version;
        }
      } else by = 'page'; // nothing from the worker yet: sort this once here
    }
    if (by === 'page') {
      if (!this.scratch || this.scratch.order.length !== N) this.scratch = makeScratch(N);
      order = sortSplats(world, view, this.scratch, bones);
      this.sorterVersion = -1;
    }
    if (order) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.indexBuf);
      gl.bufferData(gl.ARRAY_BUFFER, order, gl.DYNAMIC_DRAW);
    }
    this.lastSort = { by, ms: performance.now() - began, workerMs: sorter ? sorter.ms : 0 };
    this.drawn = N;
    this.splatPass(world, view, this.scene);

    if (o.look === 'colored') {
      // the native picture, worked, in 8 bits
      this.native8 = this.target(this.native8, W, H);
      gl.useProgram(this.worked.prog);
      this.bindTextures([this.scene.color, this.scene.depth, this.scene.glass]);
      const w = this.worked.u;
      gl.uniform1i(w.u_color, 0);
      gl.uniform1i(w.u_depth, 1);
      gl.uniform1i(w.u_glass, 2);
      gl.uniform1f(w.u_bend, bend);
      gl.uniform2f(w.u_ao, aoK, aoR);
      this.screen(this.native8);
      // the samples: the same view on a grid twice as fine, in 8 bits, with their depth kept as it is
      const fv = finer(view);
      this.fine = this.sceneTargets(this.fine, fv.W, fv.H);
      this.fine8 = this.target(this.fine8, fv.W, fv.H);
      this.splatPass(world, fv, this.fine);
      gl.useProgram(this.quant.prog);
      this.bindTextures([this.fine.color]);
      gl.uniform1i(this.quant.u.u_color, 0);
      this.screen(this.fine8);
      // PixelLook's resolve
      const c = this.coloredPass(),
        n = world.pal.length;
      if (n > COLORED_MAX) throw new Error(`the colored look takes at most ${COLORED_MAX} palette colours (this world has ${n})`);
      const pal = new Float32Array(COLORED_MAX * 3),
        outPal = new Float32Array(COLORED_MAX * 3),
        grade = world.anim && world.anim.grade;
      for (let i = 0; i < n; i++) {
        pal.set(SplatRenderer.hex(world, i), i * 3);
        outPal.set(grade ? Array.from(grade).slice(i * 3, i * 3 + 3) : SplatRenderer.hex(world, i), i * 3);
      }
      gl.useProgram(c.prog);
      this.bindTextures([this.fine8.tex, this.fine.depth, this.native8.tex]);
      gl.uniform1i(c.u.u_scene, 0);
      gl.uniform1i(c.u.u_depth, 1);
      gl.uniform1i(c.u.u_crispScene, 2);
      gl.uniform3fv(c.u.u_pal, pal);
      gl.uniform3fv(c.u.u_out, outPal);
      gl.uniform1i(c.u.u_n, n);
      gl.uniform1f(c.u.u_grade, grade ? 1 : 0);
      gl.uniform1f(c.u.u_dither, dith);
      this.screen(this.out);
    } else {
      // the palette look
      this.uploadPalette(world);
      const line = SplatRenderer.hex(world, world.outline ? world.outline.c : 0),
        r = this.resolve.u;
      gl.useProgram(this.resolve.prog);
      this.bindTextures([this.scene.color, this.palTex, this.scene.depth, this.scene.glass]);
      gl.uniform1i(r.u_color, 0);
      gl.uniform1i(r.u_pal, 1);
      gl.uniform1i(r.u_depth, 2);
      gl.uniform1i(r.u_glass, 3);
      gl.uniform1i(r.u_n, world.pal.length);
      gl.uniform1f(r.u_dith, dith);
      gl.uniform1f(r.u_bend, bend);
      gl.uniform2f(r.u_ao, aoK, aoR);
      gl.uniform1f(r.u_edge, world.outline && world.outline.edge ? world.outline.edge / R2 : 0);
      gl.uniform3f(r.u_line, line[0], line[1], line[2]);
      this.screen(this.out);
    }

    // ---- onto the canvas (one canvas pixel an art pixel: the page scales it up)
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.out.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** PixelLook's resolve, compiled the first time the colored look is asked for (it needs the toolkit's GLSL). */
  private coloredPass() {
    if (!this.colored)
      this.colored = this.pass(SCREEN_VS, coloredFS(ink().PixelLook.glsl), [
        'u_pal', 'u_out', 'u_n', 'u_grade', 'u_dither', 'u_scene', 'u_depth', 'u_crispScene'
      ] as const);
    return this.colored;
  }

  /** The last picture drawn: rgb bytes, top row first. */
  read(): { w: number; h: number; rgb: Uint8Array } {
    const gl = this.gl,
      { W, H } = this,
      px = new Uint8Array(W * H * 4),
      rgb = new Uint8Array(W * H * 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.out!.fbo);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
}
