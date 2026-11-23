/* Independent screen-space crops and placements registered to tracked anchors. */
const TrackedWindow = (() => {
  const annotations = typeof ViewAnnotations === 'undefined' ? require('./view-annotations.js') : ViewAnnotations;
  const drawing = typeof DrawingPrimitives === 'undefined' ? require('./drawing-primitives.js') : DrawingPrimitives;
  const composite = typeof FrameComposite === 'undefined' ? require('./frame-composite.js') : FrameComposite;
  const finite = Number.isFinite;
  const xy = at => Array.isArray(at) && at.length === 2 && finite(at[0]) && finite(at[1]);
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  function check(ok, message) {
    if (!ok) throw new TypeError('Tracked window: ' + message);
  }

  function record(value, keys, name) {
    check(value && Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).every(key => keys.includes(key)), 'invalid ' + name);
  }

  function anchor(at) {
    return typeof at === 'function' ? at : xy(at) ? at.slice() : annotations.anchor(at);
  }

  function box(value, fallback) {
    record(value, ['size', 'at', 'offset'], 'crop or placement');
    const { size = fallback, offset = [0, 0], at } = value;
    check(xy(size) && size.every(n => Number.isInteger(n) && n > 0 && n <= 4096) &&
      xy(offset), 'boxes need an integer [width, height] and a finite XY offset');
    return { size: size.slice(), at: at === undefined ? undefined : anchor(at), offset: offset.slice() };
  }

  function prepare(pass, reference) {
    const { filter = 'nearest', switches = [], sourceMask, chrome } = pass;
    const at = anchor(pass.at), crop = box(pass.crop), place = box(pass.place ?? {}, crop.size);
    check(filter === 'nearest' || filter === 'linear', 'filter must be nearest or linear');
    check(Array.isArray(switches) && switches.length <= 32, 'expected up to 32 source switches');
    let previous = -Infinity;
    const cues = Array.from(switches, cue => {
      check(Array.isArray(cue) && cue.length === 2 && finite(cue[0]) && cue[0] > previous,
        'switches need strictly increasing [time, source] pairs');
      previous = cue[0];
      return [previous, reference(cue[1], 'image')];
    });
    let ink;
    if (chrome !== undefined) {
      record(chrome, ['color', 'border', 'leader', 'leaderWidth'], 'chrome');
      const { color = '#ffffff', border = 1, leader = false, leaderWidth = 1 } = chrome;
      check(typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) && finite(border) && border >= 0 &&
        border <= 16 && typeof leader === 'boolean' && finite(leaderWidth) && leaderWidth > 0 &&
        leaderWidth <= 16, 'invalid border, leader, or #rrggbb color');
      ink = { rgba: [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)).concat(255), border,
        leaderWidth: leader ? leaderWidth : 0 };
    }
    return { at, crop, place, linear: filter === 'linear', cues, ink,
      source: reference(pass.source ?? 'scene', 'image'),
      sourceMask: sourceMask === undefined ? undefined : reference(sourceMask, 'mask'),
      needsCamera: [at, crop.at, place.at].some(value => value !== undefined && !xy(value)) };
  }

  function frame(window, context) {
    const { camera, width, height, time, resolve, world } = context;
    let source = window.source;
    for (const [when, name] of window.cues) {
      if (time < when) break;
      source = name;
    }
    let projector;
    function project(point) {
      if (!camera || !point || point.length !== 3 || !Array.from(point).every(finite)) return null;
      projector ??= drawing.projector(camera, width, height);
      const view = projector.toView(point);
      return projector.visible(view) ? projector.point(view) : null;
    }
    const ctx = { world, time, sceneTime: context.sceneTime ?? world?.lookSnapshot?.time ?? time,
      width, height, camera, source, project };
    function locate(value) {
      const at = typeof value === 'function' ? value(ctx) : value;
      if (xy(at)) return at;
      return project(at && typeof at === 'object' && !Array.isArray(at) && !ArrayBuffer.isView(at) ?
        resolve?.(at, ctx) : at);
    }
    const pin = locate(window.at);
    if (!pin) return null;
    function place({ at, offset, size }) {
      const center = at === undefined ? pin : locate(at);
      if (!center) return null;
      const origin = center.map((n, i) => n + offset[i] - size[i] / 2);
      return [...(window.linear ? origin : origin.map(Math.round)), ...size];
    }
    const crop = place(window.crop), dest = place(window.place);
    if (!crop || !dest) return null;
    const edge = pin.map((n, i) => clamp(n, dest[i], dest[i] + dest[i + 2]));
    const line = [...pin, ...edge].map(n => window.linear ? n : Math.floor(n) + .5);
    const leader = line[0] !== line[2] || line[1] !== line[3] ? window.ink?.leaderWidth ?? 0 : 0;
    return { source, crop, dest, line, leader, ink: window.ink, linear: window.linear };
  }

  function paint(pose, image, mask, output, w, h, weightAt, opacity) {
    const { crop, dest: [l, t, dw, dh], line: [a, b, c, d], leader, ink, linear } = pose;
    const right = l + dw, bottom = t + dh, border = ink?.border ?? 0;
    const half = leader / 2, dx = c - a, dy = d - b, lineLength2 = dx * dx + dy * dy;
    const x0 = Math.max(0, Math.floor(leader ? Math.min(l, a - half, c - half) : l));
    const y0 = Math.max(0, Math.floor(leader ? Math.min(t, b - half, d - half) : t));
    const x1 = Math.min(w, Math.ceil(leader ? Math.max(right, a + half, c + half) : right));
    const y1 = Math.min(h, Math.ceil(leader ? Math.max(bottom, b + half, d + half) : bottom));
    const color = new Float64Array(4);
    function tap(x, y, factor) {
      const i = clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1);
      if (mask) factor *= mask[i] / 255;
      for (let channel = 0; channel < 4; channel++) color[channel] += image[i * 4 + channel] * factor;
    }
    for (let y = y0 + .5; y < y1; y++) for (let x = x0 + .5; x < x1; x++) {
      const amount = opacity * weightAt(x, y);
      if (!amount) continue;
      const pixel = (Math.floor(y) * w + Math.floor(x)) * 4;
      if (x >= l && x < right && y >= t && y < bottom) {
        if (Math.min(x - l, right - x, y - t, bottom - y) < border) {
          composite.blend(output, pixel, ink.rgba, amount, false);
          continue;
        }
        const sx = crop[0] + (x - l) * crop[2] / dw, sy = crop[1] + (y - t) * crop[3] / dh;
        if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
        color.fill(0);
        if (linear) {
          const u = Math.floor(sx - .5), v = Math.floor(sy - .5);
          const fx = sx - .5 - u, fy = sy - .5 - v;
          tap(u, v, (1 - fx) * (1 - fy));
          tap(u + 1, v, fx * (1 - fy));
          tap(u, v + 1, (1 - fx) * fy);
          tap(u + 1, v + 1, fx * fy);
        } else tap(Math.floor(sx), Math.floor(sy), 1);
        composite.blend(output, pixel, color, amount, false);
      } else if (leader) {
        const f = clamp(((x - a) * dx + (y - b) * dy) / lineLength2, 0, 1);
        if ((x - a - dx * f) ** 2 + (y - b - dy * f) ** 2 <= half * half)
          composite.blend(output, pixel, ink.rgba, amount, false);
      }
    }
  }

  return Object.freeze({ prepare, frame, paint });
})();
if (typeof module !== 'undefined') module.exports = TrackedWindow;
