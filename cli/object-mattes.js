/* Optical coverage on the native art grid, accumulated before screen effects. */
const views = Object.freeze(['camera', 'reflected', 'combined']);

function settings(value) {
  if (value === undefined || value === false) return null;
  const { objects, projected = false } = Array.isArray(value) ? { objects: value } : value ?? {};
  if (typeof projected !== 'boolean' || (!Array.isArray(value) &&
      Object.keys(value ?? {}).some(key => key !== 'objects' && key !== 'projected')))
    throw new TypeError('Object mattes expect object names and an optional projected flag');
  if (!Array.isArray(objects) || !objects.length || objects.length > 8 ||
      new Set(objects).size !== objects.length || !Array.from(objects).every(objectName))
    throw new TypeError('Object mattes need 1–8 distinct object names or positive IDs');
  return { objects:objects.slice(), projected, remaining:2_000_000 };
}

function objectName(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256 ||
    Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff;
}

function capture(w, h, plan, metadata) {
  if (!plan) return null;
  const {objects} = plan, count = objects.length, size = w*h*count;
  if (size > plan.remaining) throw new RangeError('Object mattes exceeded the shared two-million-sample budget');
  plan.remaining -= size;
  const camera = new Float32Array(size), reflected = new Float32Array(size);
  const projected = plan.projected ? new Float32Array(size) : null;
  const labels = metadata?.objects;
  function project(p, index, alpha) {
    const at = p * count + index;
    projected[at] += (1 - projected[at]) * alpha;
  }
  let rearCamera, rearReflected, sourceCamera, sourceReflected;

  function fragment(p, row, sprite, alpha, through, medium, surface) {
    const start = p*count, remain = 1-alpha;
    const id = typeof sprite?.objectId === 'number' ? sprite.objectId : metadata?.objectIds?.[row];
    const label = typeof sprite?.objectId === 'string' ? sprite.objectId : labels?.[id];
    for (let c=0;c<count;c++) {
      const owns = typeof objects[c] === 'number' ? objects[c] === id : objects[c] === label;
      if (projected && owns) project(p, c, alpha);
      camera[start+c] = remain*camera[start+c]+(owns ? alpha*through : 0);
      reflected[start+c] = remain*reflected[start+c]+alpha*((medium?.[c] ?? 0)+through*(surface?.[c] ?? 0));
    }
  }

  function projectHidden(p, row, sprite, alpha) {
    const id = typeof sprite?.objectId === 'number' ? sprite.objectId : metadata?.objectIds?.[row];
    const label = typeof sprite?.objectId === 'string' ? sprite.objectId : labels?.[id];
    for (let c = 0; c < count; c++)
      if (typeof objects[c] === 'number' ? objects[c] === id : objects[c] === label) project(p, c, alpha);
  }

  const transport = {
    save(p) {
      rearCamera ??= new Float32Array(size);
      rearReflected ??= new Float32Array(size);
      const at = p*count;
      for (let c=0;c<count;c++) {
        rearCamera[at+c]=camera[at+c];
        rearReflected[at+c]=reflected[at+c];
      }
    },
    begin(linear) {
      sourceCamera = linear && rearCamera ? camera.slice() : camera;
      sourceReflected = linear && rearReflected ? reflected.slice() : reflected;
    },
    tap(p, source, weight, sourceRear) {
      const a = p*count, b = source*count;
      const fromCamera = sourceRear ? rearCamera : sourceCamera, fromReflected = sourceRear ? rearReflected : sourceReflected;
      for (let c=0;c<count;c++) {
        camera[a+c] += (fromCamera[b+c]-rearCamera[a+c])*weight;
        reflected[a+c] += (fromReflected[b+c]-rearReflected[a+c])*weight;
      }
    }
  };

  function pattern(p, surface, through, weight, rearWeight) {
    const at = p*count;
    for (let c=0;c<count;c++) {
      reflected[at+c] += surface[c]*through*weight;
      if (rearWeight) rearReflected[at+c] += surface[c]*through*rearWeight;
    }
  }

  function finish() {
    const channels = {camera:new Float32Array(size),reflected:new Float32Array(size),combined:new Float32Array(size)};
    if (projected) channels.projected = new Float32Array(size);
    const stride = w*count;
    for (let y=0;y<h;y++) for (let i=0;i<stride;i++) {
      const from = y*stride+i, to = (h-1-y)*stride+i;
      const a = channels.camera[to] = Math.max(0,Math.min(1,camera[from]));
      const b = channels.reflected[to] = Math.max(0,Math.min(1,reflected[from]));
      channels.combined[to] = Math.min(1,a+b);
      if (projected) channels.projected[to] = projected[from];
    }
    return {width:w,height:h,objects, ...channels};
  }
  return {count, fragment, projectHidden: projected && projectHidden, pattern, transport, finish};
}

function objectMatte(frame, {object, view = 'combined'} = {}) {
  const mattes = frame?.objectMattes;
  if (!mattes) throw new RangeError('Render did not capture object mattes');
  const {width,height,objects} = mattes, index = objects.indexOf(object);
  if (index < 0 || !(view === 'projected' ? mattes.projected : views.includes(view))) throw new RangeError('Object matte needs a captured object and a valid view');
  const data = Float32Array.from({length:width*height},(_,p)=>mattes[view][p*objects.length+index]);
  return {width,height,channels:1,data};
}

module.exports = { settings, capture, objectMatte, views };
