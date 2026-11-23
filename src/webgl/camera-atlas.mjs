import { createRenderer } from './renderer.mjs';
import { createTransitionComposer } from './transition-composer.mjs';

function videoShader({ radius, encode, decode, crosstalk }) {
  const channels = (matrix, input) =>
    'vec3(' + matrix.map(row => 'dot(vec3(' + row.map(n => n.toFixed(6)).join(',') + '), ' + input + ')').join(',') + ')';
  return {
    uniforms: `
uniform float u_lumaWeights[${radius + 1}], u_chromaWeights[${radius + 1}], u_artifacts;
uniform vec2 u_carrier;
vec2 carrierAt(int x) {
  int phase = x & 3;
  vec2 quarter = vec2(-u_carrier.y, u_carrier.x);
  return phase == 0 ? u_carrier : phase == 1 ? quarter : phase == 2 ? -u_carrier : -quarter;
}
vec3 signalOf(vec3 rgb) { return ${channels(encode, 'rgb')}; }`,
    source: `
  ivec2 pixel = ivec2(gl_FragCoord.xy), size = ivec2(u_size);
  vec4 center = texelFetch(u_from, pixel, 0);
  if (center.a == 0.0) return center;
  vec3 original = signalOf(center.rgb), low = vec3(0.0);
  float lumaWeight = 0.0, chromaWeight = 0.0;
  vec2 rainbow = vec2(0.0);
  for (int offset = -${radius}; offset <= ${radius}; offset++) {
    int x = clamp(pixel.x + offset, 0, size.x - 1), tap = abs(offset);
    vec4 sampleColor = texelFetch(u_from, ivec2(x, pixel.y), 0);
    vec3 signal = signalOf(sampleColor.rgb);
    float lw = u_lumaWeights[tap] * sampleColor.a, cw = u_chromaWeights[tap] * sampleColor.a;
    lumaWeight += lw;
    chromaWeight += cw;
    low += signal * vec3(lw, cw, cw);
    if (u_artifacts > 0.0) rainbow += (signal.x - original.x) * cw * carrierAt(x);
  }
  low /= vec3(lumaWeight, chromaWeight, chromaWeight);
  float artifacts = ((size.y - 1 - pixel.y) & 1) == 0 ? u_artifacts : -u_artifacts;
  low.x += ${crosstalk[0]} * artifacts * dot(original.yz - low.yz, carrierAt(pixel.x));
  low.yz += ${crosstalk[1]} * artifacts * rainbow / chromaWeight;
  return vec4(clamp(${channels(decode, 'low')}, 0.0, 1.0), center.a);`
  };
}

export function createCameraAtlas(canvas, { toolkit, contextAttributes, ...definition } = {}) {
  const api = toolkit?.KIT?.cameraAtlas;
  if (!api) throw new TypeError('Camera atlases need the Ink Studio toolkit');
  const plan = api.prepare(definition);
  const renderer = createRenderer(canvas, { toolkit, contextAttributes, reuseOrder: false });
  const gl = canvas.getContext('webgl2'), { width, height } = plan;
  let composer, session, disposed = false;
  function available() {
    if (disposed) throw new Error('The camera atlas has been disposed');
    if (gl.isContextLost()) throw new Error('The camera atlas WebGL context is lost');
  }

  function withFramebuffers(draw) {
    const previousRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    const previousDraw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    try {
      return draw();
    } finally {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousRead);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousDraw);
    }
  }

  const restored = () => session.reset();
  try {
    composer = createTransitionComposer(gl);
    const atlas = composer.createTarget(width, height), scratch = composer.createTarget(1, 1);
    const clear = new Float32Array(4);
    let decoded;
    session = api.create(plan, {
      clear() {
        available();
        const scissor = gl.isEnabled(gl.SCISSOR_TEST);
        const channels = gl.getParameter(gl.COLOR_WRITEMASK);
        try {
          withFramebuffers(() => {
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, atlas.framebuffer);
            gl.disable(gl.SCISSOR_TEST);
            gl.colorMask(true, true, true, true);
            gl.clearBufferfv(gl.COLOR, 0, clear);
          });
        } finally {
          gl.colorMask(...channels);
          if (scissor) gl.enable(gl.SCISSOR_TEST);
        }
      },
      capture(world, frame, tile, signal, packet) {
        available();
        withFramebuffers(() => {
          const { x, y, width: w, height: h } = tile;
          if (scratch.width !== w || scratch.height !== h) scratch.resize(w, h);
          if (packet) {
            composer.setSource('render-output', packet);
            try {
              composer.draw({ shader:'mix',from:'render-output',to:'render-output',value:0,phase:0,progress:0,
                time:frame.time }, { target:scratch });
            } finally {
              composer.removeSource('render-output');
            }
          } else renderer.render(world, { ...frame, target: scratch });
          let source = scratch.framebuffer;
          if (signal) {
            if (!decoded) {
              composer.registerShader('composite-video', videoShader(api.video));
              composer.setSource('video-input', scratch);
              decoded = composer.createTarget(w, h);
            }
            if (decoded.width !== w || decoded.height !== h) decoded.resize(w, h);
            composer.draw({ shader: 'composite-video', from: 'video-input', to: 'video-input',
              value: 0, phase: 0, progress: 0, time: frame.time }, {
              target: decoded,
              uniforms: { u_lumaWeights: signal.luma, u_chromaWeights: signal.chroma,
                u_artifacts: signal.artifacts, u_carrier: api.video.carrier(signal, frame.time) }
            });
            source = decoded.framebuffer;
          }
          const destination = atlas.framebuffer;
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source);
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, destination);
          gl.disable(gl.SCISSOR_TEST);
          gl.blitFramebuffer(0, 0, w, h, x, height - y - h, x + w, height - y, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        });
      },
      read({ x, y, width: w, height: h }) {
        available();
        const bottomUp = new Uint8Array(w * h * 4);
        withFramebuffers(() => {
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, atlas.framebuffer);
          const buffer = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
          const packOptions = [gl.PACK_ALIGNMENT, gl.PACK_ROW_LENGTH, gl.PACK_SKIP_PIXELS, gl.PACK_SKIP_ROWS];
          const previous = packOptions.map(option => gl.getParameter(option));
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
          try {
            packOptions.forEach((option, i) => gl.pixelStorei(option, i === 0 ? 4 : 0));
            gl.readPixels(x, height - y - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
          } finally {
            packOptions.forEach((option, i) => gl.pixelStorei(option, previous[i]));
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
          }
        });
        const rgba = new Uint8Array(bottomUp.length), stride = w * 4;
        for (let row = 0; row < h; row++) {
          const start = (h - 1 - row) * stride;
          rgba.set(bottomUp.subarray(start, start + stride), row * stride);
        }
        return { w, h, rgba };
      },
      texture(context, tile) {
        if (context !== gl) return null;
        available();
        return { texture: withFramebuffers(() => atlas.texture), region: [tile.x, tile.y, tile.width, tile.height] };
      },
      dispose() {
        disposed = true;
        canvas.removeEventListener?.('webglcontextrestored', restored);
        renderer.dispose();
        composer.dispose();
      }
    });
    canvas.addEventListener?.('webglcontextrestored', restored);
    return Object.freeze({ ...session, get texture() {
      available();
      return withFramebuffers(() => atlas.texture);
    } });
  } catch (error) {
    renderer.dispose();
    composer?.dispose();
    throw error;
  }
}
