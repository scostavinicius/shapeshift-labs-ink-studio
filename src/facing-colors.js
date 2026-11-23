/* Material colors sampled from the geometric normal or local camera direction. */
const FacingColors = (() => {
  const width = 512, bandLimit = 8, rampLimit = 64;
  const isDirectionalLayer = layer => layer?.type === 'directionalColor' && layer.views !== undefined && layer.views !== false;
  const viewNames = ['left', 'right', 'front', 'back'];
  const directionOffset = 1 + bandLimit + rampLimit;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const rgb = color => [(color >> 16 & 255) / 255, (color >> 8 & 255) / 255, (color & 255) / 255];

  function prepare(value, palette, { inheritedRamp, resolveColor, validateOnly = false } = {}) {
    if (value === undefined || value === false) return null;
    if (!record(value) || Object.keys(value).some(key => !['mode', 'bands', 'ramp'].includes(key)))
      throw new TypeError('Invalid facingColors material settings');
    const { mode = 'replace', bands, ramp = inheritedRamp } = value;
    if (!['replace', 'shift'].includes(mode) || !Array.isArray(bands) || !bands.length || bands.length > bandLimit)
      throw new TypeError('facingColors needs replace or shift mode and one to eight bands');
    const color = swatch => {
      if (typeof swatch === 'string' && /^#[0-9a-f]{6}$/i.test(swatch)) return rgb(parseInt(swatch.slice(1), 16));
      if (Number.isInteger(swatch) && swatch >= 0 && Number.isInteger(palette[swatch])) return rgb(palette[swatch]);
      if (typeof swatch === 'string' && swatch && !swatch.startsWith('#') && resolveColor) return resolveColor(swatch);
      if (Array.isArray(swatch) && swatch.length === 3 && [...swatch].every(n => Number.isFinite(n) && n >= 0 && n <= 1))
        return swatch.slice();
      throw new TypeError('Facing colors must be palette slots, roles, #rrggbb, or normalized RGB triples');
    };
    let previous = -1;
    const stops = Array.from(bands, band => {
      const key = mode === 'shift' ? 'steps' : 'color';
      if (!record(band) || Object.keys(band).some(field => field !== 'maxAngle' && field !== key))
        throw new TypeError('Invalid facingColors band');
      const { maxAngle } = band;
      if (!Number.isFinite(maxAngle) || maxAngle < 0 || maxAngle <= previous || maxAngle > 90)
        throw new RangeError('Facing band angles must strictly increase from 0 to 90 degrees');
      previous = maxAngle;
      const cosine = maxAngle === 90 ? 0 : Math.fround(Math.cos(maxAngle * Math.PI / 180));
      if (mode === 'replace') return { cosine, color: band.color === null ? null : color(band.color) };
      if (!Number.isInteger(band.steps) || Math.abs(band.steps) >= rampLimit)
        throw new RangeError('Facing ramp steps must be integers from -63 to 63');
      return { cosine, steps: band.steps };
    });
    if (previous !== 90) throw new RangeError('The last facing band must end at 90 degrees');
    if (mode === 'replace' && value.ramp !== undefined) throw new TypeError('Only shift mode accepts a facing ramp');
    let colors = [];
    if (mode === 'shift' && !(validateOnly && ramp === undefined)) {
      if (!Array.isArray(ramp) || !ramp.length || ramp.length > rampLimit)
        throw new RangeError('Facing ramp shifts need one to 64 material swatches');
      colors = Array.from(ramp, color);
    }
    return { mode, stops, colors };
  }

  function shade(profile, base, normal, view, output = base) {
    if (!profile) return output;
    const area = Math.hypot(...normal) * Math.hypot(...view);
    if (!(area >= 1e-8)) return output;
    const cosine = Math.abs((normal[0] * view[0] + normal[1] * view[1] + normal[2] * view[2]) / area);
    const band = profile.stops.find(stop => cosine >= stop.cosine);
    let swatch = band.color;
    if (band.steps) {
      let nearest = 0, error = Infinity;
      for (const [i, color] of profile.colors.entries()) {
        const distance = (base[0] - color[0]) ** 2 + (base[1] - color[1]) ** 2 + (base[2] - color[2]) ** 2;
        if (distance < error) { nearest = i; error = distance; }
      }
      swatch = profile.colors[Math.max(0, Math.min(profile.colors.length - 1, nearest + band.steps))];
    }
    if (swatch) for (let i = 0; i < 3; i++) output[i] = swatch[i];
    return output;
  }

  function prepareDirection(layers, resolveColor) {
    const entries = Object.entries(layers ?? {}).filter(([, layer]) => isDirectionalLayer(layer));
    if (!entries.length) return null;
    if (entries.length > 1) throw new RangeError('A surface can have one signed directionalColor layer');
    const [id, layer] = entries[0];
    const { views, axes = {}, blendAngle = 0, strength = 1 } = layer;
    if (!record(views) || !Object.keys(views).length || Object.keys(views).some(key => !viewNames.includes(key)))
      throw new TypeError(id + '.views needs left, right, front or back swatches');
    if (!record(axes) || Object.keys(axes).some(key => key !== 'right' && key !== 'front'))
      throw new TypeError(id + '.axes needs right and front vectors');
    if (!Number.isFinite(blendAngle) || blendAngle < 0 || blendAngle > 45 ||
        !Number.isFinite(strength) || strength < 0 || strength > 1)
      throw new RangeError(id + ' needs blendAngle in [0, 45] and strength in [0, 1]');
    if (['mask', 'drive', 'lightingRamp', 'rotation', 'stage', 'steps'].some(key =>
      layer[key] !== undefined && layer[key] !== false))
      throw new TypeError(id + ' signed views support strength, blendAngle and local axes');
    const axis = value => {
      if (!Array.isArray(value) || value.length !== 3 || ![...value].every(Number.isFinite) || Math.hypot(...value) < 1e-8)
        throw new TypeError(id + ' needs nonzero XYZ axes');
      const length = Math.hypot(...value);
      return value.map(n => n / length);
    };
    const right = axis(axes.right ?? [1, 0, 0]), authored = axis(axes.front ?? [0, 0, 1]);
    const alignment = dot(right, authored);
    if (Math.abs(alignment) > .99999) throw new RangeError(id + ' axes must be independent');
    const front = axis(authored.map((n, i) => n - right[i] * alignment));
    const colors = viewNames.map(key => views[key] == null ? null : resolveColor(views[key]));
    return strength && colors.some(Boolean) ? { right, front, colors, width: blendAngle * Math.PI / 180, strength } : null;
  }

  function shadeDirection(profile, color, view) {
    if (!profile) return color;
    const x = dot(profile.right, view), z = dot(profile.front, view);
    if (Math.hypot(x, z) <= 1e-6 * Math.hypot(...view)) return color;
    const lateral = profile.colors[x < 0 ? 0 : 1] ?? color;
    const longitudinal = profile.colors[z >= 0 ? 2 : 3] ?? color;
    const a = Math.abs(x), b = Math.abs(z);
    let weight = Number(b > a);
    if (profile.width > 0) {
      const angle = Math.atan2(b, a);
      const t = Math.max(0, Math.min(1, (angle - Math.PI / 4 + profile.width) / (2 * profile.width)));
      weight = t * t * (3 - 2 * t);
    }
    for (let i = 0; i < 3; i++) {
      const tint = lateral[i] + (longitudinal[i] - lateral[i]) * weight;
      color[i] += (tint - color[i]) * profile.strength;
    }
    return color;
  }

  function table(world, prepareSurface, prepareDirection) {
    if (!world.surfaceData || !world.surfaces?.some(({ settings }) => settings.facingColors ||
      (prepareDirection && Object.values(settings.layers ?? {}).some(isDirectionalLayer))))
      return null;
    const profiles = [], byDefinition = new Map();
    const slots = world.surfaces.map(({ settings, facingRamp }) => {
      const facing = prepareSurface(settings, facingRamp);
      const direction = prepareDirection?.(settings);
      if (!facing && !direction) return -1;
      const key = JSON.stringify([facing, direction]);
      if (!byDefinition.has(key)) byDefinition.set(key, profiles.push({ facing, direction }) - 1);
      return byDefinition.get(key);
    });
    if (!profiles.length) return null;
    const rows = Math.ceil(world.count / width), normals = world.surfaceData;
    const posed = [], posedSlots = new Map();
    const rig = world.anim?.rig;
    if (rig) for (let i = 0; i < world.count; i++) {
      const bone = rig.bid[i], base = slots[normals[i * 8] - 1];
      if (!bone || !(base >= 0)) continue;
      const profile = profiles[base], key = base + '/' + bone;
      if (profile.direction && !posedSlots.has(key)) posedSlots.set(key, profiles.push(profile) - 1);
      posed.push({ index:i, base, slot:posedSlots.get(key) });
    }
    const height = rows + profiles.length;
    const data = new Float32Array(width * height * 4);
    for (let i = 0; i < world.count; i++) {
      const at = i * 8, slot = slots[normals[at] - 1];
      if (!(slot >= 0)) continue;
      data.set(normals.subarray(at + 1, at + 4), i * 4);
      data[i * 4 + 3] = (rows + slot + 1) * (world.pix?.[at] ? -1 : 1);
    }
    for (const [i, { facing, direction }] of profiles.entries()) {
      const at = (rows + i) * width * 4;
      data.set([facing?.stops.length ?? 0, facing?.colors.length ?? 0, Number(facing?.mode === 'shift'), Number(Boolean(direction))], at);
      facing?.stops.forEach((band, j) => {
        const color = band.color ?? [band.steps ?? 0, 0, band.color === null ? -1 : 0];
        data.set([...color, band.cosine], at + (j + 1) * 4);
      });
      facing?.colors.forEach((color, j) => data.set(color, at + (j + 1 + bandLimit) * 4));
      if (direction) {
        const start = at + directionOffset * 4;
        data.set([...direction.right, direction.width, ...direction.front, direction.strength], start);
        direction.colors.forEach((color, j) => {
          if (color) data.set([...color, 1], start + (j + 2) * 4);
        });
      }
    }
    return { data, height, posed, profiles, rows, count: world.count };
  }

  function pose(binding, world, time, frames) {
    if (!binding.posed.length) return false;
    const sample = frames(world, time), updated = new Set();
    const { data, profiles, rows } = binding;
    const rig = world.anim?.rig;
    for (const { index, base, slot } of binding.posed) {
      const kind = Math.round(world.data[index * 16 + 11]) & 15;
      // GPU skinning and analytic orbit apply their frames in the shader.
      const frame = [5, 12, 13].includes(kind) || !rig || rig.free?.[index] ? null : sample(index);
      const at = index * 8 + 1, offset = index * 4;
      data.set(frame?.normal ?? world.surfaceData.subarray(at, at + 3), offset);
      const profile = frame && slot !== undefined ? slot : base;
      data[offset + 3] = (rows + profile + 1) * (world.pix?.[at - 1] ? -1 : 1);
      if (profile === base || updated.has(profile)) continue;
      const { right, front } = profiles[profile].direction;
      const start = ((rows + profile) * width + directionOffset) * 4;
      data.set(frame.worldCovector(right), start);
      data.set(frame.worldCovector(front), start + 4);
      updated.add(profile);
    }
    return true;
  }

  const rowsGLSL = `
uniform highp sampler2D u_facingRows;
uniform int u_facingCount, u_disabledViewColors;
int facingProfileRow(vec4 row) { return int(abs(row.w)) - 1; }
vec4 viewColorInfo(int profile) { return texelFetch(u_facingRows, ivec2(0, profile), 0); }
vec4 facingRow(int i) {
  ivec2 at = ivec2(i & 511, i >> 9);
  return i >= 0 && i < u_facingCount ? texelFetch(u_facingRows, at, 0) : vec4(0.0);
}
`;

  const transformGLSL = `
mat3 viewColorCovectors(mat3 transform) {
  return abs(determinant(transform)) > 1e-8 ? transpose(inverse(transform)) : mat3(1.0);
}
void viewColorAxes(int profile, mat3 transform, out vec3 right, out vec3 front) {
  right = vec3(0.0);
  front = vec3(0.0);
  if ((u_disabledViewColors & 2) != 0 || viewColorInfo(profile).w < 0.5) return;
  right = transform * texelFetch(u_facingRows, ivec2(${directionOffset}, profile), 0).xyz;
  front = transform * texelFetch(u_facingRows, ivec2(${directionOffset + 1}, profile), 0).xyz;
}
`;

  const shadeGLSL = `
vec3 facingShade(vec3 base, vec4 row, vec3 toEye) {
  float area = length(row.xyz) * length(toEye);
  if ((u_disabledViewColors & 1) != 0 || row.w == 0.0 || area < 1e-8) return base;
  int profile = facingProfileRow(row);
  vec3 info = viewColorInfo(profile).xyz;
  float cosine = abs(dot(row.xyz, toEye) / area);
  for (int i = 1; i <= int(info.x); i++) {
    vec4 band = texelFetch(u_facingRows, ivec2(i, profile), 0);
    if (cosine < band.w) continue;
    if (info.z < 0.5) return band.b < 0.0 ? base : band.rgb;
    int steps = int(band.r);
    if (steps == 0) return base;
    int nearest = 0;
    float error = 1e9;
    for (int j = 0; j < int(info.y); j++) {
      vec3 d = base - texelFetch(u_facingRows, ivec2(j + ${bandLimit + 1}, profile), 0).rgb;
      float distance = dot(d, d);
      if (distance < error) { error = distance; nearest = j; }
    }
    int swatch = clamp(nearest + steps, 0, int(info.y) - 1);
    return texelFetch(u_facingRows, ivec2(swatch + ${bandLimit + 1}, profile), 0).rgb;
  }
  return base;
}
vec3 directionShade(vec3 base, int profile, vec3 right, vec3 front, vec3 toEye) {
  vec2 view = vec2(dot(right, toEye), dot(front, toEye));
  if (length(view) <= 1e-6 * length(toEye)) return base;
  vec4 side = texelFetch(u_facingRows, ivec2(view.x < 0.0 ? ${directionOffset + 2} : ${directionOffset + 3}, profile), 0);
  vec4 end = texelFetch(u_facingRows, ivec2(view.y >= 0.0 ? ${directionOffset + 4} : ${directionOffset + 5}, profile), 0);
  vec2 blend = vec2(texelFetch(u_facingRows, ivec2(${directionOffset}, profile), 0).w,
    texelFetch(u_facingRows, ivec2(${directionOffset + 1}, profile), 0).w);
  vec2 axis = abs(view);
  float weight = float(axis.y > axis.x);
  if (blend.x > 0.0) {
    float angle = axis.x > 0.0 ? atan(axis.y, axis.x) : 1.57079632679;
    weight = smoothstep(0.78539816339 - blend.x, 0.78539816339 + blend.x, angle);
  }
  return mix(base, mix(mix(base, side.rgb, side.a), mix(base, end.rgb, end.a), weight), blend.y);
}
vec3 facingRay(vec2 pixel, vec2 size, float focal, bool ortho) {
  return vec3(ortho ? vec2(0.0) : (size * 0.5 - pixel) / focal, 1.0);
}
`;

  const splatVertexGLSL = rowsGLSL + transformGLSL + `
uniform bool u_facingPattern;
flat out vec4 v_facing;
flat out float v_facingFog;
flat out vec3 v_directionRight, v_directionFront;
void facingVertex(int index, mat3 pose, mat4 view, bool patternOwner, float fog) {
  vec4 row = facingRow(index);
  v_directionRight = vec3(0.0);
  v_directionFront = vec3(0.0);
  if (row.w != 0.0 && !(row.w < 0.0 && u_facingPattern && patternOwner)) {
    mat3 transform = mat3(view) * viewColorCovectors(pose);
    row.xyz = transform * row.xyz;
    viewColorAxes(facingProfileRow(row), transform, v_directionRight, v_directionFront);
  } else row.w = 0.0;
  v_facing = row;
  v_facingFog = fog;
}
`;

  const splatFragmentGLSL = rowsGLSL + shadeGLSL + `
uniform float u_facingGridScale;
flat in vec4 v_facing;
flat in float v_facingFog;
flat in vec3 v_directionRight, v_directionFront;
vec3 facingFragment(vec3 color, vec3 fog, vec2 viewport, float focal, bool ortho) {
  if (v_facing.w == 0.0 || v_facingFog >= 0.999) return color;
  float scale = max(1.0, u_facingGridScale);
  vec2 pixel = (floor(gl_FragCoord.xy / scale) + 0.5) * scale;
  vec3 base = clamp((color - fog * v_facingFog) / (1.0 - v_facingFog), 0.0, 1.0);
  vec3 toEye = facingRay(pixel, viewport, focal, ortho);
  vec3 next = facingShade(base, v_facing, toEye);
  next = directionShade(next, facingProfileRow(v_facing), v_directionRight, v_directionFront, toEye);
  return mix(next, fog, v_facingFog);
}
`;

  const indexedGLSL = rowsGLSL + shadeGLSL + transformGLSL + `
uniform highp sampler2D u_facingBones;
mat3 facingIndexedPose(int i, highp sampler2D splats, float time) {
  ivec2 at = ivec2((i & 511) * 4, i >> 9);
  int kind = int(round(texelFetch(splats, at + ivec2(2, 0), 0).w)) & 15;
  vec2 motion = texelFetch(splats, at + ivec2(3, 0), 0).xy;
  if (kind == 5) {
    float angle = time * motion.y, c = cos(angle), s = sin(angle);
    return mat3(c,0,-s, 0,1,0, s,0,c);
  }
  if (kind == 12 || kind == 13) {
    int iBone = int(round(motion.x)) * 3;
    ivec2 bone = ivec2(iBone % 768, iBone / 768);
    vec3 a = texelFetch(u_facingBones, bone, 0).xyz;
    vec3 b = texelFetch(u_facingBones, bone + ivec2(1, 0), 0).xyz;
    vec3 c = texelFetch(u_facingBones, bone + ivec2(2, 0), 0).xyz;
    return transpose(mat3(a,b,c));
  }
  return mat3(1.0);
}
vec3 facingIndexed(vec3 color, int index, highp sampler2D splats, float time,
    mat4 view, vec2 pixel, vec2 size, float focal, bool ortho) {
  vec4 row = facingRow(index);
  if (row.w >= 0.0) return color;
  mat3 transform = mat3(view) * viewColorCovectors(facingIndexedPose(index, splats, time));
  row.xyz = transform * row.xyz;
  vec3 toEye = facingRay(pixel, size, focal, ortho);
  vec3 right, front;
  int profile = facingProfileRow(row);
  viewColorAxes(profile, transform, right, front);
  return directionShade(facingShade(color, row, toEye), profile, right, front, toEye);
}
`;

  return Object.freeze({ width, prepare, shade, isDirectionalLayer, prepareDirection, shadeDirection, table, pose, splatVertexGLSL, splatFragmentGLSL, indexedGLSL });
})();
if (typeof module !== 'undefined') module.exports = FacingColors;
