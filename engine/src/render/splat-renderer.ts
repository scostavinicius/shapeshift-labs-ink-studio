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
import { finer, type View } from './view';

const FLOATS_PER_ROW = DATA_WIDTH * 4;

export type Look = 'default' | 'colored';

export interface DrawOptions {
  /** the ordered-noise amount, as cli/render.js takes it (0.35 when not given) */
  dither?: number;
  look?: Look;
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
    'u_data' | 'u_V' | 'u_size' | 'u_lim' | 'u_t' | 'u_focal' | 'u_near' | 'u_dist' | 'u_R' | 'u_fogCol' | 'u_fog' | 'u_grow'
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
      'u_data', 'u_V', 'u_size', 'u_lim', 'u_t', 'u_focal', 'u_near', 'u_dist', 'u_R', 'u_fogCol', 'u_fog', 'u_grow'
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

  /** Send every splat to the graphics card. (Stage 4 sends only the rows the stage marks.) */
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
    if (!this.scratch || this.scratch.order.length !== N) this.scratch = makeScratch(N);
    // (one order serves both grids of the colored look: depth depends only on the camera, which they share)
    const order = sortSplats(world, view, this.scratch);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.indexBuf);
    gl.bufferData(gl.ARRAY_BUFFER, order, gl.DYNAMIC_DRAW);
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
