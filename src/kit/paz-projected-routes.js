/* Native-pixel ribbons and sprite attachments in a shared perspective view. */
(function (K) {
  const { V, procedural: P } = K;
  const up = [0,1,0], maxSegments = 4096;
  const finite = Number.isFinite;
  const vector = (value, size) => Array.isArray(value) && value.length === size && Array.from(value).every(finite);
  const clamp = (v, min, max) => Math.max(min, Math.min(max,v));
  const fract = v => v - Math.floor(v);
  const mix = (a,b,t) => a + (b-a)*t;

  function check(condition, explanation) {
    if (!condition) throw new RangeError('Projected route: ' + explanation);
  }

  function bracket(rows, distance) {
    let lo = 0, hi = rows.length-1;
    while (hi-lo > 1) {
      const mid = (lo+hi) >>> 1;
      if (rows[mid][0] <= distance) lo = mid;
      else hi = mid;
    }
    return [rows[lo],rows[hi]];
  }

  function widthTrack(width, length) {
    if (finite(width) && width > 0) return [[0,width],[length,width]];
    check(Array.isArray(width) && width.length >= 1 && width.length <= maxSegments &&
      Array.from(width).every((key,i) => vector(key,2) && key[0] >= 0 && key[0] <= length &&
        key[1] > 0 && (!i || key[0] > width[i-1][0])), 'width needs positive values at increasing distances');
    const keys = width.map(key => key.slice());
    if (keys[0][0] > 0) keys.unshift([0,keys[0][1]]);
    if (keys.at(-1)[0] < length) keys.push([length,keys.at(-1)[1]]);
    return keys;
  }

  function stations(route, width, step) {
    const { length, points } = route;
    const count = step === undefined ? 1 : Math.ceil(length/step);
    check((step === undefined || finite(step) && step > 0) && count <= maxSegments, 'segment spacing exceeds the route budget');
    const distances = new Set([0,length,...width.map(key => key[0])]);
    if (points) {
      let distance = 0;
      for (let i=1; i<points.length-1; i++) {
        distance += V.dist(points[i-1],points[i]);
        if (distance < length) distances.add(distance);
      }
    }
    const steps = step === undefined && !points ? 128 : count;
    for (let i=1;i<steps;i++) distances.add(i*length/steps);
    const sorted = [...distances].sort((a,b) => a-b);
    const tolerance = Math.min(1e-7,length*1e-9);
    const kept = [0];
    for (const distance of sorted.slice(1,-1)) {
      if (distance-kept.at(-1)>tolerance && length-distance>tolerance) kept.push(distance);
    }
    kept.push(length);
    check(kept.length <= maxSegments+1, 'a route can have up to 4096 segments');
    const rows = kept.map(distance => {
      const pose = route.sample(distance/length), point = pose?.point ?? pose?.p ?? pose;
      check(vector(point,3), 'path samples must return finite XYZ points');
      const [a,b] = bracket(width,distance);
      return [distance,point.slice(),mix(a[1],b[1],(distance-a[0])/(b[0]-a[0]))];
    });
    const sides = rows.slice(1).map(([, point],i) => {
      const side = V.cross(up,V.sub(point,rows[i][1]));
      const length = V.len(side);
      check(finite(length) && length>0, 'each segment needs a horizontal heading');
      return V.mul(side,1/length);
    });
    const closed = V.dist(rows[0][1],rows.at(-1)[1]) <= tolerance;
    if (closed) check(rows[0][2] === rows.at(-1)[2], 'a closed route needs matching widths at its seam');
    // Share one mitered cross-section between every strip and cap its reach on sharp bends.
    for (const [i,row] of rows.entries()) {
      const previous = sides[i-1] ?? (closed ? sides.at(-1) : sides[0]);
      const next = sides[i] ?? (closed ? sides[0] : sides.at(-1));
      const sum = V.add(previous,next);
      check(V.len(sum) > 1e-6, 'a route cannot reverse direction at a single station');
      const bisector = V.norm(sum);
      row[3] = V.mul(bisector,row[2]/2 / Math.max(.5,V.dot(bisector,next)));
    }
    return rows;
  }

  function clip(vertices, limit, near) {
    const result = [];
    let last = vertices.at(-1);
    for (const point of vertices) {
      const inside = near ? point[2] >= limit : point[2] <= limit;
      const had = near ? last[2] >= limit : last[2] <= limit;
      if (inside !== had) {
        const ratio = (limit-last[2])/(point[2]-last[2]);
        const edge = last.map((value,i) => mix(value,point[i],ratio));
        edge[2] = limit;
        result.push(edge);
      }
      if (inside) result.push(point);
      last = point;
    }
    return result;
  }

  function create({ path, width = 4, step, strips, props = [], scenePalette, paletteRoles } = {}) {
    const route = Array.isArray(path) ? P.routes.polyline(path) : path;
    const length = route?.length;
    check(finite(length) && length>0 && typeof route.sample === 'function' &&
      (!route.points || Array.isArray(route.points) && route.points.length <= maxSegments+1), 'supply a sampled path or XYZ points');
    const rows = stations(route,widthTrack(width,length),step);
    const owners = [null], names = new Set(), images = new WeakMap();
    let imagePixels = 0;
    function name(id, kind) {
      check(typeof id === 'string' && id.trim() && !names.has(id), 'strips and props need distinct IDs');
      names.add(id);
      return owners.push(Object.freeze({id,kind}))-1;
    }
    function image(source) {
      check(source && typeof source === 'object', 'supply a painted image or an indexed cel');
      if (!images.has(source)) {
        const width = source.width ?? source.w, height = source.height ?? source.h;
        const data = source.data ?? source.rgba ?? source.rgb;
        imagePixels += width*height;
        check(finite(imagePixels) && imagePixels <= 8*1024*1024, 'painted images exceed the route budget');
        const raster = data === undefined ? K.pixelStamps.image(source,{scenePalette,paletteRoles}) :
          P.raster.rgba({ width,height,data,channels:source.channels,pivot:source.pivot });
        images.set(source,{ width:raster.width,height:raster.height,data:raster.data ?? raster.rgba });
      }
      return images.get(source);
    }
    check(Array.isArray(strips) && strips.length>=1 && strips.length<=24 &&
      Array.isArray(props) && props.length<=1024, 'supply 1–24 strips and up to 1024 props');
    function crossSection(point, edge, across, lift) {
      return [point[0]+edge[0]*across,point[1]+lift,point[2]+edge[2]*across];
    }
    const ribbons = Array.from(strips, ({ id, paint, across = [-1,1], lift = [0,0], repeat = 4, scroll = 0 } = {}) => {
      check(vector(across,2) && across[0]>=-1 && across[1]<=1 && across[0]<across[1] &&
        vector(lift,2) && finite(repeat) && repeat>0 && length/repeat<=Number.MAX_SAFE_INTEGER &&
        finite(scroll) && finite(scroll/repeat), 'strip needs an increasing fraction across the width and a positive repeat distance');
      return { id:name(id,'strip'), texture:image(paint), scroll:scroll/repeat,
        edges: rows.map(([distance,point,,edge]) => across.map((u,i) =>
          [...crossSection(point,edge,u,lift[i]),i,distance/repeat])) };
    });
    const attachments = Array.from(props, ({ id, distance, offset = 0, elevation = 0, height = 1, sizes } = {}) => {
      check(finite(distance) && distance>=0 && distance<=length && finite(offset) && finite(elevation) &&
        finite(height) && height>0 && Array.isArray(sizes) && sizes.length>=1 && sizes.length<=32,
        'props need an on-route distance, positive height and 1–32 painted sizes');
      const cels = Array.from(sizes, ({ minPixels = 0, paint, pivot, native = false } = {},i) => {
        const texture = image(paint);
        const anchor = pivot ?? paint.pivot ?? [texture.width/2,texture.height];
        check(finite(minPixels) && minPixels>=0 && (!i || minPixels>(sizes[i-1].minPixels ?? 0)) &&
          vector(anchor,2) && typeof native === 'boolean', 'sprite sizes need increasing pixel thresholds and an XY pivot');
        return { minPixels,texture,pivot:anchor.slice(),native };
      });
      return { id:name(id,'prop'), point:sample(distance,{offset,elevation}).point,height,cels };
    });

    function sample(distance, { offset = 0, elevation = 0 } = {}) {
      check([distance,offset,elevation].every(finite), 'route samples need finite distance, offset and elevation');
      const along = clamp(distance,0,length), [a,b] = bracket(rows,along);
      const t = (along-a[0])/(b[0]-a[0]), width = mix(a[2],b[2],t);
      const point = crossSection(V.lerp(a[1],b[1],t),V.lerp(a[3],b[3],t),2*offset/width,elevation);
      check(vector(point,3), 'route sample exceeds the finite world range');
      return { distance:along,point,width };
    }

    function render({ width, height, camera = {}, time = 0 } = {}) {
      const maxPixels = 1024*1024;
      check(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width>0 && height>0 &&
        width<=2048 && height<=2048 && width*height<=maxPixels && finite(time), 'invalid frame dimensions or time');
      const { distance = 0, offset = 0, elevation = 2, lookAhead = 18, lookElevation = elevation,
        fov = Math.PI/3, near = .2, far = 512 } = camera;
      check(finite(near) && finite(far) && near>=1e-5 && far>near &&
        finite(fov) && fov>=.03 && fov<Math.PI-.03 && finite(lookAhead) && lookAhead>0, 'invalid camera field of view, clip or look ahead');
      const at = camera.at ?? sample(distance,{offset,elevation}).point;
      let target = camera.target;
      if (target === undefined) {
        const ahead = sample(clamp(distance,0,length)+lookAhead,{offset,elevation:lookElevation});
        target = ahead.point;
        if (distance >= length) {
          const behind = sample(length-lookAhead,{offset,elevation:lookElevation}).point;
          target = V.mad(ahead.point,V.sub(ahead.point,behind),1);
        }
      }
      check(vector(at,3) && vector(target,3), 'camera needs finite positions');
      const heading = V.sub(target,at);
      check(finite(V.len(heading)) && V.len(V.cross(up,heading))>1e-7, 'camera needs a nonvertical look direction');
      const forward = V.norm(heading), right = V.norm(V.cross(up,forward)), vertical = V.cross(forward,right);
      const focal = height/2 / Math.tan(fov/2), centerX = width/2, centerY = height/2;
      function view(point) {
        const relative = V.sub(point,at);
        const local = [V.dot(relative,right),V.dot(relative,vertical),V.dot(relative,forward)];
        check(local.every(finite), 'geometry exceeds the finite camera range');
        return local;
      }
      // Interpolate reciprocal depth and divided UVs so paint stays pinned through perspective.
      const project = ([x,y,z,u,v]) => [centerX+focal*x/z,centerY-focal*y/z,1/z,u/z,v/z];
      const data = new Uint8Array(width*height*4), depth = new Float64Array(width*height).fill(Infinity);
      const ids = new Uint16Array(width*height), uv = new Float64Array(width*height*2);
      const placements = [];
      let candidates = 0;
      function budget(left,top,right,bottom) {
        candidates += Math.max(0,right-left)*Math.max(0,bottom-top);
        check(candidates <= 48*1024*1024, 'frame exceeds the raster work budget');
      }
      function write(p,z,u,v,owner,texture,texel) {
        const alpha = texture.data[texel+3];
        if (!(alpha>=128 && z<depth[p])) return;
        const dst = p*4;
        data[dst] = texture.data[texel];
        data[dst+1] = texture.data[texel+1];
        data[dst+2] = texture.data[texel+2];
        data[dst+3] = 255;
        depth[p] = z;
        ids[p] = owner;
        uv[p*2] = u;
        uv[p*2+1] = v;
      }
      function triangle(a,b,c,ribbon,shift) {
        const left = Math.max(0,Math.ceil(Math.min(a[0],b[0],c[0])-.5));
        const right = Math.min(width,Math.floor(Math.max(a[0],b[0],c[0])-.5)+1);
        const top = Math.max(0,Math.ceil(Math.min(a[1],b[1],c[1])-.5));
        const bottom = Math.min(height,Math.floor(Math.max(a[1],b[1],c[1])-.5)+1);
        if (right<=left || bottom<=top) return;
        const bx=b[0]-a[0], by=b[1]-a[1], cx=c[0]-a[0], cy=c[1]-a[1];
        const area = bx*cy-by*cx;
        check(finite(area),'geometry exceeds the finite screen range');
        if (Math.abs(area)<1e-9) return;
        budget(left,top,right,bottom);
        const {texture,id} = ribbon;
        for (let y=top;y<bottom;y++) {
          const dy = y+.5-a[1];
          for (let x=left;x<right;x++) {
            const dx=x+.5-a[0], s=(dx*cy-dy*cx)/area, t=(bx*dy-by*dx)/area, r=1-s-t;
            if (r < -1e-9 || s < -1e-9 || t < -1e-9) continue;
            const p=y*width+x, z=1/(r*a[2]+s*b[2]+t*c[2]);
            if (!(z>0 && z<depth[p])) continue;
            const u=clamp(z*(r*a[3]+s*b[3]+t*c[3]),0,1), v=z*(r*a[4]+s*b[4]+t*c[4])-shift;
            const tx=Math.min(texture.width-1,Math.floor(u*texture.width));
            const ty=Math.min(texture.height-1,Math.floor(fract(v)*texture.height));
            write(p,z,u,v,id,texture,(ty*texture.width+tx)*4);
          }
        }
      }
      for (const ribbon of ribbons) {
        const shift = time*ribbon.scroll;
        check(Math.abs(shift)<=Number.MAX_SAFE_INTEGER, 'strip scroll exceeds the finite texture range');
        const edges = ribbon.edges.map(pair => pair.map(point => [...view(point),point[3],point[4]]));
        for (let i=1;i<edges.length;i++) {
          const [a,b] = edges[i-1], [c,d] = edges[i];
          for (const face of [[a,b,c],[b,d,c]]) {
            const inside = clip(face,near,true);
            if (inside.length<3) continue;
            const polygon = clip(inside,far,false).map(project);
            for (let j=2;j<polygon.length;j++) triangle(polygon[0],polygon[j-1],polygon[j],ribbon,shift);
          }
        }
      }
      // Nearest props claim pixels first so each reported count is final.
      const ordered = attachments.map(prop => ({prop,position:view(prop.point)})).sort((a,b) => a.position[2]-b.position[2]);
      for (const {prop,position} of ordered) {
        const z = position[2], projectedPixels = focal*prop.height/z;
        if (z<near || z>far || !finite(projectedPixels) || projectedPixels<.5) continue;
        const index = prop.cels.findLastIndex(cel => cel.minPixels<=projectedPixels);
        if (index<0) continue;
        const {texture,pivot,native} = prop.cels[index];
        const scale = native ? 1 : projectedPixels/texture.height;
        const [x,y] = project(position);
        const w = Math.max(1,Math.round(texture.width*scale)), h = Math.max(1,Math.round(texture.height*scale));
        const left = Math.round(x-pivot[0]*w/texture.width), top = Math.round(y-pivot[1]*h/texture.height);
        check([w,h,left,top].every(finite), 'prop exceeds the finite screen range');
        const x0=Math.max(0,left), x1=Math.min(width,left+w), y0=Math.max(0,top), y1=Math.min(height,top+h);
        if (x1<=x0 || y1<=y0) continue;
        budget(x0,y0,x1,y1);
        let pixels = 0;
        for (let row=y0;row<y1;row++) for (let column=x0;column<x1;column++) {
          const u=(column+.5-left)/w, v=(row+.5-top)/h, p=row*width+column;
          const texel = (Math.floor(v*texture.height)*texture.width+Math.floor(u*texture.width))*4;
          write(p,z,u,v,prop.id,texture,texel);
          if (ids[p]===prop.id) pixels++;
        }
        placements.push({id:owners[prop.id].id,cel:index,projectedPixels,rect:[left,top,w,h],visiblePixels:pixels});
      }
      return K.renderOutputs.create({ width,height,data,depth,ids,uv,owners,placements,
        camera:{origin:at,right,up:vertical,forward,center:[centerX,centerY],scale:[focal,focal]} });
    }
    Object.freeze(owners);
    return Object.freeze({ length,sample,render });
  }
  P.routes.projected = Object.freeze({ create });
})(KIT);
