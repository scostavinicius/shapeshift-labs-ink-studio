// The WebGL2 renderer. One instanced quad a splat, drawn back to front into three targets on the art grid (colour, depth,
// glass), then resolved to palette colours. It follows cli/render.js step for step: see shaders.ts.
import type { World } from '../../types/ink-studio';
import { makeScratch, sortSplats, type OrderScratch } from './order';
import { DATA_WIDTH, RESOLVE_FS, SCREEN_VS, SPLAT_FS, SPLAT_VS, SPLATS_PER_ROW } from './shaders';
import type { View } from './view';

const FLOATS_PER_ROW = DATA_WIDTH * 4;

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

export class SplatRenderer {
  readonly gl: WebGL2RenderingContext;
  /** true when colour and depth are kept in 32-bit floats (needs EXT_float_blend); otherwise 16-bit */
  readonly float32: boolean;
  private splat: WebGLProgram;
  private resolve: WebGLProgram;
  private us;
  private ur;
  private vao: WebGLVertexArrayObject;
  private indexBuf: WebGLBuffer;
  private dataTex: WebGLTexture;
  private palTex: WebGLTexture;
  private dataRows = 0;
  private padded: Float32Array | null = null;
  private scratch: OrderScratch | null = null;
  private W = 0;
  private H = 0;
  private sceneFbo: WebGLFramebuffer | null = null;
  private outFbo: WebGLFramebuffer | null = null;
  private targets: WebGLTexture[] = [];
  /** splats handed to the graphics card in the last draw (all of them: culling happens there) */
  drawn = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false });
    if (!gl) throw new Error('WebGL2 is not available');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is not available');
    this.gl = gl;
    this.float32 = !!gl.getExtension('EXT_float_blend');
    this.splat = program(gl, SPLAT_VS, SPLAT_FS);
    this.resolve = program(gl, SCREEN_VS, RESOLVE_FS);
    this.us = uniforms(gl, this.splat, [
      'u_data', 'u_V', 'u_size', 'u_lim', 'u_t', 'u_focal', 'u_near', 'u_dist', 'u_R', 'u_fogCol', 'u_fog', 'u_grow'
    ] as const);
    this.ur = uniforms(gl, this.resolve, [
      'u_color', 'u_depth', 'u_glass', 'u_pal', 'u_n', 'u_dith', 'u_bend', 'u_ao', 'u_edge', 'u_line'
    ] as const);

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

  private resize(W: number, H: number): void {
    if (W === this.W && H === this.H && this.sceneFbo) return;
    const gl = this.gl;
    for (const t of this.targets) gl.deleteTexture(t);
    if (this.sceneFbo) gl.deleteFramebuffer(this.sceneFbo);
    if (this.outFbo) gl.deleteFramebuffer(this.outFbo);
    this.W = W;
    this.H = H;
    const make = (internal: number) => {
      const t = this.texture();
      gl.texStorage2D(gl.TEXTURE_2D, 1, internal, W, H);
      return t;
    };
    const color = make(this.float32 ? gl.RGBA32F : gl.RGBA16F),
      depth = make(this.float32 ? gl.R32F : gl.R16F),
      // (glass is kept in floats too: its small additions would be lost to rounding in 8 bits)
      glass = make(this.float32 ? gl.R32F : gl.R16F),
      out = make(gl.RGBA8);
    this.targets = [color, depth, glass, out];
    this.sceneFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, depth, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, glass, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('scene framebuffer is incomplete');
    this.outFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.outFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('output framebuffer is incomplete');
    this.canvas.width = W;
    this.canvas.height = H;
  }

  /**
   * Draw the world (as last uploaded) for this view, and show it on the canvas.
   * o.dither is the option of the same name in cli/render.js (0.35 when not given).
   */
  draw(world: World, view: View, o: { dither?: number } = {}): void {
    const gl = this.gl,
      N = world.count,
      { W, H } = view;
    this.resize(W, H);
    this.uploadPalette(world);
    if (!this.scratch || this.scratch.order.length !== N) this.scratch = makeScratch(N);
    const order = sortSplats(world, view, this.scratch);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.indexBuf);
    gl.bufferData(gl.ARRAY_BUFFER, order, gl.DYNAMIC_DRAW);

    // ---- the splats, back to front, into colour, depth and glass
    const hex = (i: number) => {
      const h = world.pal[i];
      return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
    };
    const bg = hex(0),
      fog = hex(world.fog.c),
      grow = world.grow || {};
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearBufferfv(gl.COLOR, 0, [bg[0], bg[1], bg[2], 1]);
    gl.clearBufferfv(gl.COLOR, 1, [1, 0, 0, 1]);
    gl.clearBufferfv(gl.COLOR, 2, [0, 0, 0, 0]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.splat);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.dataTex);
    const u = this.us;
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
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, N);
    this.drawn = N;

    // ---- the palette look
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.outFbo);
    gl.useProgram(this.resolve);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.targets[0]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.palTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.targets[1]);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.targets[2]);
    const r = this.ur,
      R2 = 2 * world.radius,
      ao = world.ao,
      line = hex(world.outline ? world.outline.c : 0);
    gl.uniform1i(r.u_color, 0);
    gl.uniform1i(r.u_pal, 1);
    gl.uniform1i(r.u_depth, 2);
    gl.uniform1i(r.u_glass, 3);
    gl.uniform1i(r.u_n, world.pal.length);
    gl.uniform1f(r.u_dith, (o.dither === undefined ? 0.35 : o.dither) * 0.3 * world.dither);
    gl.uniform1f(r.u_bend, world.refract === undefined ? 6 : world.refract);
    gl.uniform2f(r.u_ao, ao ? (ao.k === undefined ? 0.5 : ao.k) : 0, ao ? (ao.range || 0.6) / R2 : 1);
    gl.uniform1f(r.u_edge, world.outline && world.outline.edge ? world.outline.edge / R2 : 0);
    gl.uniform3f(r.u_line, line[0], line[1], line[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);

    // ---- onto the canvas (one canvas pixel an art pixel: the page scales it up)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.outFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** The last picture drawn: rgb bytes, top row first. */
  read(): { w: number; h: number; rgb: Uint8Array } {
    const gl = this.gl,
      { W, H } = this,
      px = new Uint8Array(W * H * 4),
      rgb = new Uint8Array(W * H * 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.outFbo);
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

  /** One of the scene targets as floats, bottom row first: 0 colour (rgba), 1 depth, 2 glass. For looking into differences. */
  readTarget(which: 0 | 1 | 2): Float32Array {
    const gl = this.gl,
      { W, H } = this,
      out = new Float32Array(W * H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT0 + which);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, out);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }
}
