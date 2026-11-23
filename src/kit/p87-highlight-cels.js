/* Light and view pose selection for depth-tested, native-pixel highlights. */
(function (K) {
  const V = K.V, stamps = K.pixelStamps;
  const planCache = new WeakMap();
  const number = (n, low, high) => Number.isFinite(n) && n >= low && n <= high;
  const tuple = (value, count, test) => Array.isArray(value) && value.length === count && Array.from(value).every(test);
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const id = value => typeof value === 'string' && /^[\w-]{1,64}$/.test(value);
  const vector = value => tuple(value, 3, Number.isFinite);
  const aim = ([x,y,z]) => x*x + y*y + z*z;
  const nonzero = value => vector(value) && number(aim(value), 1e-14, 1e16);
  const offsetOK = value => tuple(value, 2, n => Number.isSafeInteger(n) && Math.abs(n) <= 256);

  function check(ok, message) {
    if (!ok) throw new RangeError('Highlight cels: ' + message);
  }

  function preset(material, { swatches } = {}) {
    check(['brass','enamel','glass'].includes(material), 'unknown material preset ' + material);
    const pose = (name, light = [0, 0, 1], view = [0, 0, 1]) => ({
      id: name, light, view, stamp: stamps.clip('highlight-' + material + '-' + name, { swatches })
    });
    const head = tier => [
      pose(tier + '-left', [-.87, .13, 1]), pose(tier + '-front'), pose(tier + '-right', [.87, .13, 1])
    ];
    return { sizes: [
      { id: 'pin', minPixels: 0, cels: [pose('pin')] },
      { id: 'hook', minPixels: 15, cels: head('hook') },
      { id: 'arc', minPixels: 30, cels: [...head('arc'), pose('arc-grazing', [0, 0, 1], [.90, 0, .72])] }
    ] };
  }

  function prepare(placements, { scenePalette, paletteRoles } = {}) {
    if (placements === undefined || placements === false) return [];
    check(Array.isArray(placements) && placements.length <= 128, 'expected up to 128 world anchors');
    const saved = planCache.get(placements);
    if (saved && saved.palette === scenePalette && saved.roles === paletteRoles) return saved.rows;
    const families = new Map(), names = new Set();
    let cells = 0;
    function compileFamily(source) {
      if (families.has(source)) return families.get(source);
      const value = typeof source === 'string' ? preset(source) : source;
      check(record(value), 'expected a material family or preset name');
      const { sizes, minLight = .02, minFacing = .08 } = value;
      check(Array.isArray(sizes) && number(sizes.length, 1, 8) &&
        number(minLight, 0, 512) && number(minFacing, 0, 1), 'expected sizes and finite light thresholds');
      let prior = -1;
      const compiled = Array.from(sizes, (band, index) => {
        const { id: name, minPixels, cels } = band ?? {};
        check(id(name) && number(minPixels, 0, 4096) && minPixels > prior && (index !== 0 || minPixels === 0)
          && Array.isArray(cels) && number(cels.length, 1, 16), 'sizes need increasing pixel thresholds starting at zero');
        prior = minPixels;
        return { name, minPixels, cels: Array.from(cels, pose => {
          const { id: name, light = [0, 0, 1], view = [0, 0, 1], stamp, pivot, offset = [0, 0] } = pose ?? {};
          check(id(name) && nonzero(light) && nonzero(view) && offsetOK(offset), 'invalid pose, light, view or pixel offset');
          const source = typeof stamp === 'string' ? stamps.clip(stamp) : stamp;
          check(record(source) && Number.isInteger(source.width) && number(source.width, 1, 31) &&
            Number.isInteger(source.height) && number(source.height, 1, 31) &&
            (!source.frames || source.frames.length <= 16), 'cels are limited to 31 by 31 pixels and 16 frames');
          const { width, height, entries, palette, at } = stamps.prepare(source);
          const pin = pivot ?? [width >> 1, height >> 1];
          check(offsetOK(pin) && number(pin[0], 0, width - 1) && number(pin[1], 0, height - 1), 'pivot must be a pixel in the cel');
          cells += width * height * entries.length;
          check(cells <= 262144, 'scene exceeds its highlight cel budget');
          const frames = entries.map(({ slots }) =>
            stamps.image({ width, height, slots, palette }, { scenePalette, paletteRoles }));
          return { name, light: V.norm(light), view: V.norm(view), x: offset[0] - pin[0], y: offset[1] - pin[1],
            image: time => frames[at(time)] };
        }) };
      });
      const family = { sizes: compiled, minLight, minFacing };
      families.set(source, family);
      return family;
    }
    const rows = Array.from(placements, placement => {
      const { id: name, family, light, at, normal = [0,0,1], tangent = [1,0,0], span = 1, bias = .025 } = placement ?? {};
      check(id(name) && !names.has(name) && id(light) && (vector(at) || typeof at === 'function') &&
        (nonzero(normal) || typeof normal === 'function') && (nonzero(tangent) || typeof tangent === 'function') &&
        number(span, .0001, 1000) && number(bias, 0, 1), 'expected a unique named anchor, light, surface axes and span');
      names.add(name);
      return { name, family: compileFamily(family), light, at, normal, tangent, span, bias };
    });
    planCache.set(placements, { palette:scenePalette, roles:paletteRoles, rows });
    return rows;
  }

  const atTime = (value, time) => typeof value === 'function' ? value(time) : value;

  function frame(rows, world, camera, { w, h, time, lights, clip, spriteSurfaces, spriteAtlases, spriteAtlasMode, cutoutShadows, shadowShells } = {}) {
    if (!rows.length || !lights.length) return [];
    const named = new Map(lights.map(light => [light.id, light]));
    const project = DrawingPrimitives.projector(camera, w, h);
    const view = camera.view, back = [view[2], view[6], view[10]];
    let shadow;
    function shadowQuery() {
      const sources = AreaLights.staticSources(world);
      const cutouts = ShadowCutouts.prepare(world, {
        time, enabled: cutoutShadows !== false, shadowShells, surfaces: spriteSurfaces, sprites: spriteAtlases, atlasMode: spriteAtlasMode
      });
      return (origin, dir, stop) =>
        ShadowCutouts.occludes(cutouts, origin, dir, stop) || AreaLights.occludes(sources, origin, dir, stop);
    }
    const result = [], illumination = [0,0,0];
    for (const site of rows) {
      const light = named.get(site.light);
      if (!light?.intensity) continue;
      const at = atTime(site.at, time), normal = atTime(site.normal, time), tangent = atTime(site.tangent, time);
      check(vector(at) && nonzero(normal) && nonzero(tangent), 'animated anchors need finite XYZ and nonzero axes');
      if (clip && !clip(at)) continue;
      const n = V.norm(normal), raw = V.mad(tangent, n, -V.dot(tangent, n));
      check(nonzero(raw), 'tangent must have a direction along the surface');
      const u = V.norm(raw), v = V.cross(n, u);
      const eye = camera.ortho ? back : V.norm(V.sub(camera.eye, at)), ray = V.norm(V.sub(light.at, at));
      const { sizes, minLight, minFacing } = site.family;
      if (V.dot(n, eye) <= minFacing || V.dot(n, ray) <= 0) continue;
      const origin = project.toView(V.mad(at, n, site.bias));
      if (!project.visible(origin)) continue;
      const width = project.line(project.toView(V.mad(at, u, -site.span / 2)), project.toView(V.mad(at, u, site.span / 2)));
      if (!width) continue;
      const [a, b] = width.map(project.point), size = Math.hypot(b[0] - a[0], b[1] - a[1]);
      AreaLights.evaluate([light], at, n, illumination, { shadow: light.shadows ? (shadow ??= shadowQuery()) : undefined });
      if (Math.max(...illumination) <= minLight) continue;
      const band = sizes.findLast(band => size >= band.minPixels);
      const local = dir => [V.dot(dir, u), V.dot(dir, v), V.dot(dir, n)];
      const l = local(ray), e = local(eye);
      let pose, best = -Infinity;
      for (const cel of band.cels) {
        const score = V.dot(l, cel.light) + V.dot(e, cel.view);
        if (score > best) { pose = cel; best = score; }
      }
      const [x, y] = project.point(origin), image = pose.image(time);
      const left = Math.floor(x) + pose.x, top = Math.floor(y) + pose.y;
      if (left >= w || top >= h || left + image.width <= 0 || top + image.height <= 0) continue;
      const { depthAt } = K.nativeCelPixels.plane(camera,w,h,origin,n);
      result.push({ id: site.name, size: band.name, pose: pose.name, left, top, depth: origin[2], depthAt, image });
    }
    return result.sort((a,b) => b.depth - a.depth);
  }

  K.highlightCels = Object.freeze({ preset, prepare, frame, pixels: K.nativeCelPixels.pixels });
})(KIT);
