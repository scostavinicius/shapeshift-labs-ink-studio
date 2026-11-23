/* Aligned color and surface outputs for independent pixel renderers. */
const RenderOutputs = (() => {
  const frames = new WeakSet();
  const maxPixels = 1024 * 1024;
  const finite = Number.isFinite;
  const tuple = (value,n) => Array.isArray(value) && value.length === n && Array.from(value).every(finite);
  const float = value => value instanceof Float32Array || value instanceof Float64Array;
  const bytes = value => value instanceof Uint8Array || value instanceof Uint8ClampedArray;
  const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const is = frame => frames.has(frame);

  function check(condition, message) {
    if (!condition) throw new RangeError('Render outputs: ' + message);
  }

  function calibration(camera) {
    const { projection = 'perspective', origin, right, up, forward, center, scale } = camera;
    check(['perspective','orthographic'].includes(projection) && [origin,right,up,forward].every(v => tuple(v,3)) &&
      tuple(center,2) && tuple(scale,2) && scale.every(v => v>0), 'invalid camera calibration');
    const basis = [right,up,forward];
    check(basis.every((a,i) => basis.every((b,j) => Math.abs(dot(a,b)-Number(i===j))<1e-5)),
      'camera axes must form an orthonormal basis');
    const copy = vector => Object.freeze(vector.slice());
    return Object.freeze({projection,origin:copy(origin),right:copy(right),up:copy(up),forward:copy(forward),
      center:copy(center),scale:copy(scale)});
  }

  function mark(fields) {
    const frame = Object.freeze(fields);
    frames.add(frame);
    return frame;
  }

  function create(definition = {}) {
    const { width,height,data,depth,ids,uv,owners,camera,channels = 4 } = definition;
    const count = width*height;
    check(Number.isSafeInteger(width) && width>0 && Number.isSafeInteger(height) && height>0 && count<=maxPixels &&
      channels===4 && bytes(data) && data.length===count*4 && float(depth) && depth.length===count &&
      (ids instanceof Uint16Array || ids instanceof Uint32Array) && ids.length===count &&
      float(uv) && uv.length===count*2, 'expected aligned RGBA, depth, ID, and UV buffers');
    check(Array.isArray(owners) && owners.length>=1 && owners.length<=65536 && owners[0]===null,
      'owner table must start with a null entry for ID zero');
    const seen = new Set();
    const table = Array.from(owners, (owner,id) => {
      if (!id) return null;
      const { id:name, kind = 'surface' } = owner ?? {};
      check(typeof name==='string' && name.trim() && !seen.has(name) && typeof kind==='string' && kind.trim(),
        'owners need distinct names and a kind');
      seen.add(name);
      return Object.freeze({ id:name,kind });
    });
    for (let i=0;i<count;i++) {
      const id = ids[i], distance = depth[i];
      check(id<table.length && (id ? distance>=0 && finite(distance) && data[i*4+3]>0 : distance===Infinity) &&
        finite(uv[i*2]) && finite(uv[i*2+1]), 'surface IDs, depth, UVs, and alpha must agree per pixel');
    }
    return mark({ ...definition,channels,owners:Object.freeze(table),
      camera:camera==null?undefined:calibration(camera) });
  }

  function ready(frame) {
    if (!is(frame)) throw new TypeError('Use renderOutputs.create to register a shared render frame');
    return frame;
  }

  function snapshot(frame) {
    const {width,height,data,depth,ids,uv,owners,camera,channels} = ready(frame);
    return mark({width,height,data:new Uint8Array(data),depth:depth.slice(),ids:ids.slice(),uv:uv.slice(),owners,camera,channels});
  }

  function position(camera,x,y,depth) {
    const {projection,origin,right,up,forward,center,scale} = camera;
    const size = projection==='perspective'?depth:1;
    const across = (x+.5-center[0])/scale[0]*size;
    const vertical = (center[1]-y-.5)/scale[1]*size;
    const point = origin.map((value,i) => value+forward[i]*depth+right[i]*across+up[i]*vertical);
    check(point.every(finite), 'surface position exceeds the finite world range');
    return point;
  }

  function pick(frame,x,y) {
    const {width,height,data,depth,ids,uv,owners,camera} = ready(frame);
    if (!(finite(x) && finite(y) && x>=0 && y>=0 && x<width && y<height)) return null;
    const px=Math.floor(x), py=Math.floor(y), index=py*width+px, id=ids[index];
    if (!id) return null;
    const point = camera && position(camera,px,py,depth[index]);
    return { x:px,y:py,id,owner:owners[id],depth:depth[index],uv:[uv[index*2],uv[index*2+1]],
      rgba:Array.from(data.subarray(index*4,index*4+4)), ...(point && {position:point}) };
  }

  function pickUV(frame,u,v,{surface = false} = {}) {
    const {width,height} = ready(frame);
    if (!(finite(u) && finite(v) && u>=0 && u<=1 && v>=0 && v<=1)) return null;
    // Sprite atlas face UVs run from the first texel center to the last.
    const coordinate = (t,n) => surface ? .5+(n-1)*t : Math.min(n-1,Math.floor(n*t));
    return pick(frame,coordinate(u,width),coordinate(v,height));
  }

  function image(frame) {
    const {width:w,height:h,data:rgba} = ready(frame);
    return {w,h,rgba};
  }

  function layer(frame, settings = {}) {
    return { ...settings,source:image(frame) };
  }

  function raster(frame, channel = 'color', {miss = 0} = {}) {
    const {width,height,data,depth,ids,uv,camera} = ready(frame);
    const plane = (channels,data) => ({ width,height,channels,data });
    switch (channel) {
      case 'color': return plane(4,data);
      case 'ids': return plane(1,ids);
      case 'depth':
        check(finite(miss),'a depth raster needs a finite value for uncovered pixels');
        return plane(1,Float64Array.from(depth,(n,i) => ids[i]?n:miss));
      case 'uv': {
        const map = new Float64Array(ids.length*3);
        for (let i=0;i<ids.length;i++) {
          map[i*3]=uv[i*2]; map[i*3+1]=uv[i*2+1]; map[i*3+2]=ids[i]?1:0;
        }
        return plane(3,map);
      }
      case 'position': {
        check(camera && finite(miss),'a position raster needs camera calibration and a finite miss value');
        const map = new Float64Array(ids.length*3).fill(miss);
        for (let i=0;i<ids.length;i++)
          if (ids[i]) map.set(position(camera,i%width,Math.floor(i/width),depth[i]),i*3);
        return plane(3,map);
      }
      default: throw new TypeError('Unknown render output channel: ' + channel);
    }
  }

  function mask(frame, owner) {
    const {width,height,ids,owners} = ready(frame);
    const id = owner===undefined?0:owners.findIndex(entry => entry?.id===owner);
    check(id>=0,'unknown surface owner: ' + String(owner));
    return { width,height,channels:1,data:Uint8Array.from(ids,value => (id?value===id:value!==0)?255:0) };
  }

  return Object.freeze({ create,is,snapshot,image,layer,raster,mask,pick,pickUV,maxPixels });
})();
if (typeof module !== 'undefined') module.exports = RenderOutputs;
