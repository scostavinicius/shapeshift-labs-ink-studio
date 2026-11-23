import { mountTurntable } from './turntable.mjs';
import { createDrawingInput } from '../../src/webgl/drawing-input.mjs';
import { createSplatMaskPainter } from '../../src/webgl/splat-mask-painter.mjs';
import { createGaussianColorInspector, gaussianSwatchJump } from '../../src/webgl/gaussian-color-inspector.mjs';
import { createRenderer } from '../../src/webgl/renderer.mjs';
import { decodeGaussianSplat, gaussianSplatWorld } from '../../src/gaussian-splats.mjs';
import { samplePly, sampleSpz, pelagicPalette } from '../webgpu-graphs/sample.mjs';

const get = id => document.getElementById(id);
const orbit = get('angle'), degrees = get('degrees'), play = get('play'), status = get('status');
const palette = get('palette'), probe = get('probe'), clear = get('clear'), feedback = get('jump-status');
const tool = get('splat-tool'), brushSize = get('brush-size'), showMask = get('show-mask');
const applyRamp = get('apply-ramp'), pixelCleanup = get('pixel-cleanup'), protectMask = get('protect-mask');
const undoMask = get('undo-mask'), clearMask = get('clear-mask'), maskStatus = get('mask-status');
const rampInputs = [...document.querySelectorAll('.ramp input')];
const samples = [['ply', samplePly], ['spz', sampleSpz]];
const maxBytes = 768 * 1024 * 1024;
let views, drawCanvas, gl, renderer, world, inspector, painter, turntable, currentFrame, current, jump, probeResult, cursor;
let ticket = 0, playing = false, previous, request, angle = Number(orbit.value);

function frame(now) {
  request = undefined;
  if (playing && previous !== undefined) {
    angle = (angle + Math.min(.05, (now - previous) / 1000) * 28 + 180) % 360 - 180;
    orbit.value = Math.round(angle);
  }
  previous = now;
  degrees.value = orbit.value + '°';
  if (world) {
    currentFrame = atAngle(angle);
    try {
      let observed;
      for (const { canvas, context } of views) {
        const { width, height } = canvas;
        renderer.render(world, { ...currentFrame, gaussianColor: canvas.id, width, height });
        if (canvas === palette) observed = inspector.inspect(currentFrame, readPalettePixel);
        context.drawImage(drawCanvas, 0, drawCanvas.height - height, width, height, 0, 0, width, height);
      }
      const change = gaussianSwatchJump(current, observed);
      if (change) {
        jump = change;
        probeResult = undefined;
      }
      current = observed;
      displayInspection();
    } catch (error) {
      errorStatus(error);
      world = currentFrame = undefined;
      turntable.invalidate();
      clearInspection();
      setPlaying(false);
    }
  }
  if (playing) redraw();
}

function atAngle(degrees) {
  const mask = painter?.mask;
  const splatPaint = mask?.indices.length ? {
    mask, protect: protectMask.checked, preview: showMask.checked,
    ramp: applyRamp.checked ? rampInputs.map(input => Number.parseInt(input.value.slice(1), 16)) : undefined
  } : false;
  return {
    camera: { ...world.cam, yaw: degrees * Math.PI / 180, pitch: -.08, dist: world.cam.dist * .94 },
    gaussianColor: 'palette', width: palette.width, height: palette.height,
    colored: false, dither: 0, damp: false, changedRows: [], clean: pixelCleanup.checked, splatPaint
  };
}

const pixel = new Uint8Array(4);
function readPalettePixel(x, y) {
  gl.readPixels(x, palette.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  return Array.from(pixel.subarray(0, 3));
}

const hex = rgb => '#' + rgb.map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase();
function colorChip(id, rgb, text) {
  const value = get(id);
  value.textContent = rgb ? (text ? text + ' ' : '') + hex(rgb) : '—';
  value.parentElement.style.setProperty('--chip', rgb ? hex(rgb) : 'transparent');
}

function inspectionMessage(swatch, event, emptyMessage) {
  if (!current) return emptyMessage;
  if (current.state === 'offscreen') return 'The selected patch is outside the view.';
  if (current.state === 'obscured') return 'The selected patch is obscured from this angle.';
  if (!swatch) return 'No palette swatch at this pixel.';
  if (event) return 'Swatch jump ' + event.from.index + ' → ' + event.to.index + ' across ' +
    event.degrees.toFixed(1) + '° (' + hex(event.from.rgb) + ' → ' + hex(event.to.rgb) + ').';
  if (probeResult === null) return 'No abrupt swatch jump in the nearby visible samples.';
  return 'Orbit slowly or check nearby angles for swatch jumps.';
}

function displayInspection(emptyMessage = 'Pick a patch to track its swatch.') {
  for (const { marker } of views) {
    const point = cursor ?? current?.uv;
    marker.hidden = !point;
    if (point) {
      marker.style.left = point[0] * 100 + '%';
      marker.style.top = point[1] * 100 + '%';
      marker.dataset.state = cursor ? 'cursor' : current.state;
    }
  }
  const swatch = current?.swatch;
  colorChip('base-color', current?.base);
  colorChip('live-color', current?.rgb);
  colorChip('palette-color', swatch?.rgb, swatch && (swatch.ramp ? 'Ramp ' : 'Swatch ') + swatch.index);
  probe.disabled = !swatch;
  clear.disabled = !current;
  const event = probeResult === null ? null : probeResult ?? jump;
  const text = inspectionMessage(swatch, event, emptyMessage);
  feedback.dataset.state = event && swatch ? 'jump' : current?.state ?? 'empty';
  if (feedback.textContent !== text) feedback.textContent = text;
}

function clearInspection(message) {
  inspector?.clear();
  current = jump = probeResult = cursor = undefined;
  displayInspection(message);
}

function select(u, v) {
  if (!currentFrame) return;
  setPlaying(false);
  clearInspection();
  if (inspector.select(u, v, currentFrame)) redraw();
  else displayInspection('No visible splat here. Pick a patch on the cloud.');
}

function checkNearby() {
  if (!current?.swatch) return;
  setPlaying(false);
  const inspectAt = degrees => {
    const frame = atAngle(degrees);
    return inspector.inspect(frame, (x, y) => {
      renderer.render(world, frame);
      return readPalettePixel(x, y);
    });
  };
  try {
    const degrees = currentFrame.camera.yaw * 180 / Math.PI;
    const before = inspectAt(degrees - 1), after = inspectAt(degrees + 1);
    const jumps = [gaussianSwatchJump(before, current), gaussianSwatchJump(current, after),
      gaussianSwatchJump(before, after)].filter(Boolean);
    probeResult = jumps.reduce((best, event) => !best || event.distance > best.distance ? event : best, null);
    displayInspection();
  } catch (error) {
    feedback.textContent = error.message;
  }
}

function pointAt(canvas, event) {
  const bounds = canvas.getBoundingClientRect();
  return [(event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height];
}

function showBrush(view, point) {
  view.brush.hidden = !point;
  if (!point) return;
  view.brush.style.left = point[0] * 100 + '%';
  view.brush.style.top = point[1] * 100 + '%';
  view.brush.style.width = 2 * Number(brushSize.value) / palette.width * 100 + '%';
}

function updateMask() {
  const count = painter?.mask.indices.length ?? 0;
  maskStatus.textContent = count.toLocaleString() + ' splats painted';
  undoMask.disabled = !painter?.canUndo;
  clearMask.disabled = !count;
  turntable?.invalidate();
}

function updateTool() {
  const painting = tool.value !== 'inspect';
  get('color-inspector').hidden = painting;
  for (const view of views) {
    view.canvas.toggleAttribute('data-paint', painting);
    showBrush(view, null);
  }
  if (painting) {
    setPlaying(false);
    clearInspection();
  }
}

function attachBrush(view) {
  const { canvas } = view;
  createDrawingInput(canvas, {
    brush() {
      if (tool.value === 'inspect' || !currentFrame) return null;
      setPlaying(false);
      return { kind: 'stroke', surface: 'view', radius: Number(brushSize.value),
        erase: tool.value === 'erase', frame: currentFrame, painter };
    },
    project: event => pointAt(canvas, event),
    preview: draft => showBrush(view, draft?.points.at(-1)),
    commit({ points, radius, erase, frame, painter: source }) {
      if (source !== painter) return;
      try {
        painter.stroke(points, frame, { radius, erase });
        updateMask();
        redraw();
      } catch (error) {
        maskStatus.textContent = error.message;
      }
    }
  });
  canvas.addEventListener('pointermove', event => {
    if (tool.value !== 'inspect' && !event.buttons) showBrush(view, pointAt(canvas, event));
  });
  canvas.addEventListener('pointerleave', () => showBrush(view, null));
}

function redraw() {
  request ??= requestAnimationFrame(frame);
}

function setPlaying(active) {
  playing = active;
  previous = undefined;
  play.textContent = active ? 'Pause' : 'Play';
  play.setAttribute('aria-pressed', active);
  if (active) redraw();
}

function errorStatus(error) {
  status.dataset.state = 'error';
  status.textContent = error.message;
}

async function open(name, read, mode, examplePoint) {
  const job = ++ticket;
  status.dataset.state = 'loading';
  status.textContent = 'Opening ' + name + '…';
  try {
    const cloud = await decodeGaussianSplat(await read(), { maxPoints: 2_000_000 });
    if (job !== ticket) return;
    world = gaussianSplatWorld(cloud, { colorMode: 'rgb', palette: pelagicPalette });
    currentFrame = undefined;
    clearInspection();
    const grid = { width: palette.width, height: palette.height };
    inspector = createGaussianColorInspector(renderer, world, grid);
    painter = createSplatMaskPainter(renderer, world, grid);
    updateMask();
    status.dataset.state = 'ready';
    status.textContent = name + ' · ' + cloud.count.toLocaleString() + ' splats · SH degree ' + cloud.degree;
    for (const [id] of samples) get(id).setAttribute('aria-pressed', id === mode);
    if (examplePoint) inspector.select(...examplePoint, atAngle(angle));
    redraw();
    if (examplePoint) requestAnimationFrame(() => {
      if (job === ticket) checkNearby();
    });
  } catch (error) {
    if (job === ticket) errorStatus(error);
  }
}

try {
  views = ['rgb', 'palette'].map(id => {
    const canvas = get(id);
    return { canvas, context: canvas.getContext('2d', { alpha: false }), marker: canvas.nextElementSibling, brush: canvas.parentElement.querySelector('.brush') };
  });
  drawCanvas = document.createElement('canvas');
  drawCanvas.width = views[0].canvas.width;
  drawCanvas.height = views[0].canvas.height;
  renderer = createRenderer(drawCanvas, { toolkit: { KIT, PixelLook } });
  gl = drawCanvas.getContext('webgl2');
  turntable = mountTurntable({ renderer, source: () => ({ world, frame: world && atAngle(angle) }), pause: () => setPlaying(false) });
  for (const view of views) {
    const { canvas } = view;
    attachBrush(view);
    canvas.addEventListener('click', event => {
      if (tool.value === 'inspect') select(...pointAt(canvas, event));
    });
    canvas.addEventListener('keydown', event => {
      if (tool.value !== 'inspect') return;
      const steps = { ArrowLeft: [-1,0], ArrowRight: [1,0], ArrowUp: [0,-1], ArrowDown: [0,1] };
      if (steps[event.key]) {
        event.preventDefault();
        const at = cursor ?? current?.uv ?? [.5,.5], step = event.shiftKey ? 8 : 1;
        cursor = steps[event.key].map((delta, i) =>
          Math.min(.999, Math.max(0, at[i] + delta * step / (i ? palette.height : palette.width))));
        displayInspection();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select(...(cursor ?? current?.uv ?? [.5,.5]));
      } else if (event.key === 'Escape') clearInspection();
    });
    canvas.addEventListener('blur', () => { cursor = undefined; displayInspection(); });
  }
  tool.addEventListener('change', updateTool);
  brushSize.addEventListener('input', () => { get('brush-value').value = brushSize.value + ' px'; });
  for (const setting of [showMask, applyRamp, pixelCleanup, protectMask, ...rampInputs])
    setting.addEventListener('input', () => {
      probeResult = undefined;
      jump = undefined;
      if (setting !== showMask) turntable.invalidate();
      redraw();
    });
  undoMask.addEventListener('click', () => { painter.undo(); updateMask(); redraw(); });
  clearMask.addEventListener('click', () => { painter.clear(); updateMask(); redraw(); });
  probe.addEventListener('click', checkNearby);
  clear.addEventListener('click', () => clearInspection());
  orbit.addEventListener('input', () => {
    angle = Number(orbit.value);
    probeResult = undefined;
    cursor = undefined;
    setPlaying(false);
    redraw();
  });
  play.addEventListener('click', () => setPlaying(!playing));
  for (const [id, read] of samples) get(id).addEventListener('click', () => open('Sample ' + id.toUpperCase(), read, id));
  get('file').addEventListener('change', event => {
    const file = event.currentTarget.files[0];
    if (file) void open(file.name, () => {
      if (file.size > maxBytes) throw new RangeError('Gaussian file exceeds the byte limit');
      return file.arrayBuffer();
    });
  });
  void open('Sample PLY', samplePly, 'ply', [.578543, .398297]);
} catch (error) {
  errorStatus(error);
  for (const id of ['angle', 'play', 'ply', 'spz', 'file', 'splat-tool', 'turntable-generate']) get(id).disabled = true;
}
