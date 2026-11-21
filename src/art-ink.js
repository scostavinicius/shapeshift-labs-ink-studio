/* Art-pixel line classification and palettes. The inputs are top-down render passes. */
const ArtInk = (() => {
  const selectors = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
  const defaults = Object.freeze({
    silhouette: { steps: 1, litSteps: 0 },
    crease: { steps: 1, litSteps: 0 },
    boundary: { steps: 1, litSteps: 0 }
  });
  const kinds = Object.keys(defaults);
  const SILHOUETTE = 1, CREASE = 2, BOUNDARY = 3;
  const priority = [SILHOUETTE, BOUNDARY, CREASE];
  const luma = (r, g, b) => .30 * r + .55 * g + .15 * b;
  const packedLuma = color => luma(color >> 16, (color >> 8) & 255, color & 255);
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;

  function packed(value, palette) {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return Number.parseInt(value.slice(1), 16);
    if (Number.isSafeInteger(value) && value >= 0 && value < palette.length) return palette[value];
    throw new TypeError('Ink colors must be #rrggbb or scene palette indices');
  }

  function colors(values, palette) {
    if (!Array.isArray(values) || !values.length || values.length > 64)
      throw new RangeError('Ink palettes need between one and 64 colors');
    return values.map(value => packed(value, palette));
  }

  function depthRange(value) {
    if (value === undefined || value === false) return value;
    if (!record(value) || Object.keys(value).some(key => key !== 'near' && key !== 'far') ||
        !Number.isFinite(value.near) || !Number.isFinite(value.far) || value.near < 0 || value.far < value.near)
      throw new RangeError('Ink distance needs finite scene units with 0 <= near <= far');
    return { near:value.near, far:value.far };
  }

  function lostRule(value) {
    if (value === false) return false;
    if (!record(value) || Object.keys(value).some(key => !['strength', 'lightness', 'contrast', 'distance'].includes(key)))
      throw new TypeError('Lost edges need strength, lightness, contrast or distance settings');
    const { strength = 1, lightness, contrast, distance } = value;
    if (!unit(strength)) throw new RangeError('Lost edge strength must be in 0–1');
    const range = (pair, name) => {
      if (pair === undefined) return;
      if (!Array.isArray(pair) || pair.length !== 2 || !unit(pair[0]) || !unit(pair[1]) || pair[0] > pair[1])
        throw new RangeError('Lost edge ' + name + ' needs two ascending values in 0–1');
      return pair.slice();
    };
    return { strength, lightness: range(lightness, 'lightness'), contrast: range(contrast, 'contrast'),
      distance: depthRange(distance) };
  }

  function lineRule(rule, palette, kind) {
    if (rule === false) return null;
    if (rule === true) return {};
    if (!record(rule))
      throw new TypeError('Ink line rules must be true, false, or an object');
    const { color, highlight, shadow, steps, litSteps, distance, strength, lost, contrast, mask } = rule;
    if (![steps, litSteps].every(value => value === undefined || Number.isSafeInteger(value) && Math.abs(value) <= 64))
      throw new RangeError('Ink steps must be integers between -64 and 64');
    if (strength !== undefined && !unit(strength)) throw new RangeError('Ink line strength must be in 0–1');
    let adaptive;
    if (contrast !== undefined && contrast !== false) {
      if (kind !== 'silhouette' || !record(contrast) ||
          Object.keys(contrast).some(key => !['dark', 'light', 'minGain'].includes(key)))
        throw new TypeError('Silhouette contrast needs dark and light outline swatches');
      const dark = packed(contrast.dark, palette), light = packed(contrast.light, palette);
      const minGain = contrast.minGain ?? 0, a = packedLuma(dark), b = packedLuma(light);
      if (a >= b || !unit(minGain)) throw new RangeError('Silhouette contrast needs increasing values and minGain in [0, 1]');
      adaptive = { dark, light, a, b, gain: minGain * 255 };
    }
    let painted;
    if (mask !== undefined && mask !== false) {
      if (!record(mask) || mask.type !== 'indexed') throw new TypeError('Ink masks need an indexed paint raster');
      const effects = typeof SplatEffects === 'undefined' ? require('./splat-effects.js') : SplatEffects;
      painted = effects.prepareMask(mask);
    }
    return {
      ...(steps !== undefined && { steps }), ...(litSteps !== undefined && { litSteps }),
      ...(color !== undefined && { color:packed(color, palette) }),
      ...(highlight !== undefined && { highlight:packed(highlight, palette) }),
      ...(shadow !== undefined && { shadow:packed(shadow, palette) }),
      ...(distance !== undefined && { distance:depthRange(distance) }),
      ...(strength !== undefined && { strength }),
      ...(lost !== undefined && { lost:lostRule(lost) }),
      ...(contrast !== undefined && { contrast:adaptive }), ...(mask !== undefined && { mask:painted })
    };
  }

  function stylePatch(style, palette, ramps) {
    if (!record(style)) throw new TypeError('Ink styles must be objects');
    const patch = {};
    for (const kind of kinds) if (style[kind] !== undefined) patch[kind] = lineRule(style[kind],palette,kind);
    if (style.distance !== undefined) patch.distance = depthRange(style.distance);
    if (style.ramp !== undefined) patch.ramp = colors(style.ramp,palette);
    if (style.palette !== undefined) {
      if (!ramps.has(style.palette)) throw new RangeError('Unknown reserved palette ' + style.palette);
      patch.palette = style.palette;
    }
    return patch;
  }

  function applyStyle(base, patch) {
    const result = { ...base, ...patch };
    for (const kind of kinds) if (patch[kind]) result[kind] = { ...defaults[kind], ...base[kind], ...patch[kind] };
    return result;
  }

  function prepare(definition, palette) {
    if (!definition) return null;
    const settings = definition === true ? {} : definition;
    if (typeof settings !== 'object' || Array.isArray(settings)) throw new TypeError('Expected an ink settings object');
    const {
      depthGap = .09, creaseCosine = .72, litAt = .38, suppressSameMaterial = true,
      light = [-.5, .8, .45], emissionThreshold = .25, fogThreshold = .25, materials = {}, reserved = {},
      occlusionSilhouettes = false, targets = []
    } = settings;
    if (!Number.isFinite(depthGap) || depthGap <= 0 ||
        ![creaseCosine, litAt].every(value => Number.isFinite(value) && Math.abs(value) <= 1) ||
        ![emissionThreshold, fogThreshold].every(v => Number.isFinite(v) && v >= 0 && v <= 1) ||
        !Array.isArray(light) || light.length !== 3 || !light.every(Number.isFinite) || !Math.hypot(...light) ||
        typeof suppressSameMaterial !== 'boolean' || typeof occlusionSilhouettes !== 'boolean')
      throw new RangeError('Invalid selective ink thresholds or light direction');
    if (!Array.isArray(targets) || targets.length > 128) throw new TypeError('Use an array of up to 128 ink targets');
    const length = Math.hypot(...light);
    const ramps = new Map(Object.entries(reserved).map(([key, value]) => [key, colors(value, palette)]));
    const base = applyStyle(defaults, stylePatch(settings,palette,ramps));
    const styles = new Map(Object.entries(materials).map(([name, style]) => [name, applyStyle(base,stylePatch(style,palette,ramps))]));
    const scoped = Array.from(targets, target => {
      if (!record(target) || Object.keys(target).some(key => !['select','distance','ramp','palette',...kinds].includes(key)))
        throw new TypeError('Ink targets need a selector and line settings');
      return { select:selectors.prepare(target.select), patch:stylePatch(target,palette,ramps) };
    });
    const all = [base, ...styles.values(), ...scoped.map(({ patch }) => patch)];
    const hasLostEdges = all.some(style => kinds.some(kind => style[kind]?.lost?.strength > 0));
    const usesBackdrop = hasLostEdges || all.some(style => style.silhouette?.contrast);
    const painted = all.some(style => kinds.some(kind => style[kind]?.mask));
    return { base, styles, scoped, ramps, depthGap, creaseCosine, litAt, suppressSameMaterial, occlusionSilhouettes,
      light: light.map(value => value / length), emissionThreshold, fogThreshold, hasLostEdges, usesBackdrop, painted };
  }

  function bind(settings, world) {
    if (!world || !settings.scoped.length) return null;
    const { row } = selectors.index(world), cache = new WeakMap();
    return (i, base) => {
      if (i < 0 || i >= world.count) return base;
      const target = row(i);
      if (!cache.has(target)) {
        let style = base;
        for (const { select, patch } of settings.scoped) if (selectors.matches(select,target)) style = applyStyle(style,patch);
        cache.set(target,style);
      }
      return cache.get(target);
    };
  }

  function opacity(rule, shared, depth) {
    const strength = rule.strength ?? 1;
    const range = rule.distance ?? shared;
    if (!range) return strength;
    if (depth >= range.far) return 0;
    return depth <= range.near ? strength : strength * ((range.far-depth)/(range.far-range.near));
  }

  function smooth(low, high, value) {
    if (value <= low) return 0;
    if (value >= high) return 1;
    const t = (value - low) / (high - low);
    return t * t * (3 - 2 * t);
  }

  function losesBelow(range, value) {
    return range ? 1 - smooth(range[0], range[1], value) : 1;
  }

  function blend(a, b, weight) {
    if (weight === 0) return a;
    if (weight === 1) return b;
    const r = a >> 16, g = a >> 8 & 255, blue = a & 255;
    return Math.round(r+((b>>16)-r)*weight)*65536 +
      Math.round(g+((b>>8&255)-g)*weight)*256 + Math.round(blue+((b&255)-blue)*weight);
  }

  function closest(ramp, r, g, b) {
    let best = 0, score = Infinity;
    for (let i = 0; i < ramp.length; i++) {
      const color = ramp[i], dr = r - (color >> 16), dg = g - ((color >> 8) & 255), db = b - (color & 255);
      const candidate = .30 * dr * dr + .55 * dg * dg + .15 * db * db;
      if (candidate < score) {
        best = i;
        score = candidate;
      }
    }
    return best;
  }

  function apply(frame, passes, settings, palette, signals, { world, time = 0, depthOffset = 0, inspect } = {}) {
    const { w, h, rgb, alpha } = frame;
    const { depth, normal, objectId, materialId, materials, emission, splatId } = passes;
    const mask = new Uint8Array(w * h);
    const { base, styles, ramps, depthGap, creaseCosine, litAt, light, suppressSameMaterial, occlusionSilhouettes,
      usesBackdrop } = settings;
    const scopedStyle = bind(settings,world);
    const byId = materials.map((label, id) => styles.get(String(label ?? id)) || base);
    const source = rgb.slice();
    const outputPalette = Array.from(frame.palette || palette);
    const known = new Map(outputPalette.map((color, index) => [color, index]));
    const counts = new Uint32Array(outputPalette.length);
    const additions = [];
    const neighbors = usesBackdrop ? new Int32Array(4) : null;
    const edgeTypes = usesBackdrop ? new Uint8Array(4) : null;
    const surface = settings.painted ? { position:null, worldPosition:null, time } : null;

    function classify(p, z, q, id, material) {
      if (z < 0 || !Number.isFinite(depth[z])) return SILHOUETTE;
      const dz = depth[z] - depth[p], sameMaterial = material > 0 && materialId[z] === material;
      const differentObject = id !== objectId[z] && (id || objectId[z]);
      if (occlusionSilhouettes && differentObject && dz > depthGap) return SILHOUETTE;
      if (differentObject || (material !== materialId[z] && (material || materialId[z])))
        return (!suppressSameMaterial || !sameMaterial) && (dz > depthGap || (dz >= -depthGap && p < z)) ? BOUNDARY : 0;
      if (splatId[p] === splatId[z]) return 0;
      if (dz > depthGap) return CREASE;
      if (Math.abs(dz) > depthGap || p >= z) return 0;
      const a = z * 3;
      const dot = normal[q] * normal[a] + normal[q + 1] * normal[a + 1] + normal[q + 2] * normal[a + 2];
      const aLength = Math.abs(normal[a]) + Math.abs(normal[a + 1]) + Math.abs(normal[a + 2]);
      const pLength = Math.abs(normal[q]) + Math.abs(normal[q + 1]) + Math.abs(normal[q + 2]);
      return aLength && pLength && dot < creaseCosine ? CREASE : 0;
    }

    function emits(q) {
      const amount = Math.max(emission[q], emission[q + 1], emission[q + 2]);
      return amount >= settings.emissionThreshold && amount > 0;
    }

    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x, q = p * 3;
      const id = objectId[p], material = materialId[p], materialStyle = byId[material] || base;
      const style = scopedStyle ? scopedStyle(splatId[p]-1,materialStyle) : materialStyle;
      let edges = 0;
      if (Number.isFinite(depth[p])) {
        for (let i = 0; i < 4; i++) {
          const z = i === 0 ? (x > 0 ? p - 1 : -1) : i === 1 ? (x + 1 < w ? p + 1 : -1) :
            i === 2 ? (y > 0 ? p - w : -1) : (y + 1 < h ? p + w : -1);
          const edge = classify(p,z,q,id,material);
          edges |= edge ? 1 << edge : 0;
          if (usesBackdrop) {
            edgeTypes[i] = edge;
            neighbors[i] = z;
          }
        }
      }
      const r = source[q], g = source[q + 1], b = source[q + 2];
      const original = (r << 16) | (g << 8) | b;
      let color = original;
      const signal = signals?.[p] > settings.fogThreshold ? 'fog' : null;
      const emitting = emits(q);
      const reserved = (emitting && ramps.get('emission')) || ramps.get(signal || style.palette);
      if (reserved) {
        const index = closest(reserved, r, g, b);
        color = reserved[index];
        if (inspect?.pixel === p) inspect.ink(reserved,index,[r,g,b],emitting && ramps.has('emission') ? 'emission' : signal ?? style.palette,1);
        mask[p] = 4;
      } else if (edges) {
        const distance = depth[p]-depthOffset;
        if (surface) {
          surface.position = passes.objectPosition?.subarray(q,q+3);
          surface.worldPosition = passes.position?.subarray(q,q+3);
        }
        for (const edge of priority) {
          if (!(edges & (1 << edge))) continue;
          const type = kinds[edge - 1], rule = style[type];
          if (!rule) continue;
          const paint = rule.mask ? rule.mask(surface) : 1;
          if (!paint) continue;
          const weight = opacity(rule,style.distance,distance) * paint;
          let merge = 0, neighborColor = 0;
          if (rule.lost?.strength && !emitting) {
            const { strength, lightness, contrast, distance:range } = rule.lost;
            const value = luma(r,g,b) / 255;
            const reach = paint * strength * losesBelow(lightness,value) *
              (range ? smooth(range.near,range.far,distance) : 1);
            if (reach > 0) for (let i = 0; i < 4; i++) {
              const z = neighbors[i];
              if (edgeTypes[i] !== edge || z < 0 || alpha?.[z] === 0 || emits(z * 3)) continue;
              const a = z * 3, nr = source[a], ng = source[a + 1], nb = source[a + 2];
              const amount = reach * losesBelow(contrast,Math.abs(value - luma(nr,ng,nb) / 255));
              if (amount > merge) {
                merge = amount;
                neighborColor = (nr << 16) | (ng << 8) | nb;
              }
            }
          }
          if (!weight && !merge) continue;
          const lit = (normal[q] || normal[q + 1] || normal[q + 2]) ?
            normal[q] * light[0] + normal[q + 1] * light[1] + normal[q + 2] * light[2] >= litAt : luma(r, g, b) > 160;
          let explicit = (lit ? rule.highlight : rule.shadow) ?? rule.color;
          if (rule.contrast) {
            const { a,b,dark,light:bright,gain } = rule.contrast;
            let back = 0, count = 0;
            for (let i = 0; i < 4; i++) {
              const z = neighbors[i];
              if (edgeTypes[i] !== edge || z < 0 || alpha?.[z] === 0) continue;
              back += luma(source[z*3],source[z*3+1],source[z*3+2]);
              count++;
            }
            if (count) {
              const background = back/count;
              const low = Math.abs(a-background), high = Math.abs(b-background);
              explicit = Math.max(low,high) >= Math.abs(luma(r,g,b)-background)+gain ?
                (low>=high?dark:bright) : original;
            }
          }
          const steps = lit ? rule.litSteps : rule.steps;
          if (weight && explicit !== undefined) color = explicit;
          else if (weight && steps) {
            const ramp = style.ramp;
            if (ramp) color = ramp[clamp(closest(ramp, r, g, b) - steps, 0, ramp.length - 1)];
            else {
              const gain = Math.pow(.73, steps);
              color = palette[closest(palette, r * gain, g * gain, b * gain)];
            }
          }
          if (inspect?.pixel === p && weight && (explicit !== undefined || steps))
            inspect.ink([color],0,[r,g,b],type,weight);
          color = blend(original,color,weight);
          if (merge) {
            if (inspect?.pixel === p)
              inspect.ink([neighborColor],0,[color >> 16,color >> 8 & 255,color & 255],'lost-' + type,merge);
            color = blend(color,neighborColor,merge);
          }
          if (color !== original) mask[p] = edge;
          break;
        }
      }
      rgb[q] = color >> 16;
      rgb[q + 1] = (color >> 8) & 255;
      rgb[q + 2] = color & 255;
      let index = known.get(color);
      if (index === undefined) {
        index = outputPalette.length;
        known.set(color, index);
        outputPalette.push(color);
        additions.push(0);
      }
      if (index < counts.length) counts[index]++;
      else additions[index - counts.length]++;
    }
    const use = new Uint32Array(outputPalette.length);
    use.set(counts);
    use.set(additions, counts.length);
    return { ...frame, palette: outputPalette, use, inkMask: mask };
  }

  const channels = Object.freeze(['depth', 'normal', 'objectId', 'materialId', 'emission', 'splatId']);
  return Object.freeze({ prepare, apply, channels });
})();
if (typeof module !== 'undefined') module.exports = ArtInk;
