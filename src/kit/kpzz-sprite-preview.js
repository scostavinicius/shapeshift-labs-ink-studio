/* Native sprite cels and onion skins on a common export grid. */
(function (K) {
  const previousColor = Object.freeze([73, 210, 233]), nextColor = Object.freeze([246, 117, 183]);
  const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
  const same = (a,b,i) => !a[i+3] && !b[i+3] ||
    a[i] === b[i] && a[i+1] === b[i+1] && a[i+2] === b[i+2] && a[i+3] === b[i+3];
  function check(ok, message) {
    if (!ok) throw new RangeError('Sprite cel preview: ' + message);
  }
  function bytes(data, length) {
    return ArrayBuffer.isView(data) && data.BYTES_PER_ELEMENT === 1 && data.length === length;
  }
  function dimensions(width, height, count) {
    check(integer(width,1,2048) && integer(height,1,2048) && integer(count,1,1200) &&
      width * height * count <= 16000000, 'preview exceeds the sixteen-million-pixel sequence budget');
  }

  // Keep the clean export raster available. Only the inspection copy receives colored neighbors.
  function onion(current, previous, next, { opacity = .62, changesOnly = true } = {}) {
    check(bytes(current,current?.length) && current.length % 4 === 0 &&
      (!previous || bytes(previous,current.length)) && (!next || bytes(next,current.length)) &&
      Number.isFinite(opacity) && opacity >= 0 && opacity <= 1 && typeof changesOnly === 'boolean',
      'onion skins need aligned RGBA rasters and opacity in [0, 1]');
    const result = new Uint8Array(current);
    function apply(source, ink) {
      if (!source) return;
      for (let i = 0; i < result.length; i += 4) {
        const a = source[i+3] * opacity / 255;
        if (!a || changesOnly && same(source,current,i)) continue;
        const remaining = result[i+3] * (1 - a) / 255, coverage = a + remaining;
        for (let c = 0; c < 3; c++) result[i+c] = Math.round((ink[c] * a + result[i+c] * remaining) / coverage);
        result[i+3] = Math.round(coverage * 255);
      }
    }
    apply(previous,previousColor);
    apply(next,nextColor);
    return result;
  }

  function session({ width, height, fps, start, count, render }) {
    dimensions(width,height,count);
    check(Number.isFinite(fps) && fps > 0 && Number.isFinite(start) &&
      Number.isFinite(start + (count - 1) / fps), 'invalid sample times');
    const cache = [], matchingEdges = [];
    const time = index => start + index / fps;
    function raster(index) {
      return cache[index] ??= render(time(index),index);
    }
    function matches(index) {
      if (matchingEdges[index] !== undefined) return matchingEdges[index];
      const first = raster(index), second = raster(index+1);
      for (let i=0; i<first.length; i+=4)
        if (!same(first,second,i)) return matchingEdges[index] = false;
      return matchingEdges[index] = true;
    }
    function adjacent(index, direction, mode) {
      for (let n=index+direction; n>=0 && n<count; n+=direction) {
        if (mode === 'frames' || !matches(direction > 0 ? n-1 : n))
          return { index:n, time:time(n), rgba:raster(n) };
      }
      return null;
    }
    function inspect(index, { previous = true, next = true, neighbors = 'drawings', opacity, changesOnly } = {}) {
      check(integer(index,0,count-1), 'frame is outside the preview');
      check(neighbors === 'drawings' || neighbors === 'frames', 'choose adjacent drawings or adjacent export frames');
      const rgba = raster(index);
      const before = previous && adjacent(index,-1,neighbors), after = next && adjacent(index,1,neighbors);
      const copy = frame => frame ? { ...frame, rgba: new Uint8Array(frame.rgba) } : null;
      return { index, time:time(index), rgba:new Uint8Array(rgba), previous:copy(before), next:copy(after),
        onion:onion(rgba,before?.rgba,after?.rgba,{opacity,changesOnly}) };
    }
    return Object.freeze({ width,height,fps,start,count,inspect });
  }

  function fromFrames({ width, height, frames, fps = 12, start = 0 }) {
    const count = frames?.length;
    dimensions(width,height,count);
    const images = Array.from(frames, data => {
      check(bytes(data,width*height*4), 'each exported frame must contain matching RGBA bytes');
      return new Uint8Array(data);
    });
    return session({ width,height,count,fps,start,render:(_time,i)=>images[i] });
  }

  function create({ atlas, width = 128, height = 128, origin = [width/2,height/2],
    fps = 12, start = 0, count = 48, mode = 'impostor', yaw = 0, pitch = 0,
    playback = 'once', viewAt, silhouette } = {}) {
    const asset = K.sprite.atlas(atlas);
    check(Array.isArray(origin) && origin.length === 2 && Array.from(origin).every(Number.isFinite) &&
      (viewAt === undefined || typeof viewAt === 'function'), 'expected an XY pivot and an optional view callback');
    const isolated = silhouette !== undefined;
    check(!isolated || asset.silhouettes?.includes(silhouette), 'unknown silhouette track');
    const point = origin.slice(), clock = asset.playback(playback), channels = { depth:true, emission:true, silhouetteOnly:isolated };
    return session({ width,height,fps,start,count,render(time,index) {
      const { mode: selection = mode,yaw: azimuth = yaw,pitch: elevation = pitch,frame = clock(time) } = viewAt?.(time,index) ?? {};
      check(['impostor','card'].includes(selection) && Number.isFinite(azimuth) && Number.isFinite(elevation),
        'view needs card or impostor mode and finite angles');
      const view = asset.select(frame,selection,AtlasSprites.basis(azimuth,elevation).normal);
      const motion = isolated ? asset.silhouette(view,time,silhouette) : asset.transition?.(view,time);
      const out = new Uint8Array(width*height*4);
      if (isolated && !motion) return out;
      const [left,top] = isolated ? point.map((n,i)=>Math.round(n) - motion.pin[i]) :
        AtlasSprites.nativeOrigin(view,point[0],point[1]);
      const { width:w,height:h } = view.rect;
      const fringe = isolated ? null : asset.fringe?.(view,time), effect = isolated ? null : asset.effect(view);
      const texel = { color:[0,0,0], normal:[0,0,0], emission:[0,0,0] }, fx = [0,0,0], layers = [];
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const u=x-left,v=y-top, i=(y*width+x)*4;
        layers.length=0;
        if (asset.sample(view,u,v,channels,texel,undefined,motion)) {
          const color = asset.emissionMode === 'add' ? texel.color.map((n,c)=>Math.min(1,n+texel.emission[c])) : texel.color;
          layers.push({alpha:texel.alpha,depth:texel.depth,color});
        }
        if (effect && u>=0 && v>=0 && u<w && v<h) {
          const alpha = effect.sample(u,v,fx);
          if (alpha) layers.push({alpha,depth:effect.depth,color:fx});
        }
        const strands = fringe?.at(u,v);
        if (strands) layers.push(...strands);
        if (!layers.length) continue;
        if (layers.length > 1) layers.sort((a,b)=>b.depth-a.depth);
        let r=0,g=0,b=0,a=0;
        for (const { color,alpha } of layers) {
          const remain = 1 - alpha;
          r = r*remain + color[0]*alpha;
          g = g*remain + color[1]*alpha;
          b = b*remain + color[2]*alpha;
          a = a*remain + alpha;
        }
        if (a > 0) out.set([Math.round(r*255/a),Math.round(g*255/a),Math.round(b*255/a),Math.round(a*255)],i);
      }
      return out;
    } });
  }

  // The sprite namespace is installed before this module by the toolkit.
  K.sprite.celPreview = Object.freeze({ create,fromFrames,onion,previousColor,nextColor });
})(KIT);
