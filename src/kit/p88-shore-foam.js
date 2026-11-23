/* Authored foam follows directed wet-left shorelines at native pixel size. */
(function (K) {
  const V = K.V, planes = K.nativeCelPixels, stamps = K.pixelStamps;
  const states = new WeakMap(), kinds = ['straight','inside','tip'], up = [0,1,0];
  const names = kinds.flatMap(kind => ['east','se'].map(direction => 'foam-' + kind + '-' + direction));
  const range = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
  const point = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(n => range(n, -1e6, 1e6));
  const norm = (a,b) => V.norm([b[0]-a[0],0,b[2]-a[2]]);
  const wetward = ([x,,z]) => [-z,0,x];
  const turn = (a,b) => Math.atan2(a[0]*b[2]-a[2]*b[0],V.dot(a,b));
  const same = (a,b) => V.dist(a,b) < 1e-8;
  const mod = n => n - Math.floor(n);
  function requireFoam(ok, message) {
    if (!ok) throw new RangeError('Shore foam: ' + message);
  }

  function join(edges) {
    requireFoam(Array.isArray(edges) && edges.length <= 16384, 'waterline exceeds its segment budget');
    const next = new Map(), incoming = new Set();
    const links = Array.from(edges, edge => {
      requireFoam(Array.isArray(edge) && edge.length === 2 && edge.every(point) && !same(...edge), 'invalid directed waterline edge');
      const [a,b] = edge, start = a.join(','), end = b.join(',');
      const row = { a,b,start,end,tangent:norm(a,b),used:false };
      if (!next.has(start)) next.set(start,[]);
      next.get(start).push(row);
      incoming.add(end);
      return row;
    });
    const paths = [];
    for (const head of [...links.filter(edge=>!incoming.has(edge.start)),...links]) {
      if (head.used) continue;
      const path = [head.a];
      for (let edge = head; edge; ) {
        edge.used = true;
        path.push(edge.b);
        if (edge.end === head.start) break;
        let best = -Infinity, onward;
        for (const option of next.get(edge.end) ?? []) {
          if (option.used) continue;
          // Paired wet cells touching at one vertex keep their own loops.
          const angle = turn(edge.tangent, option.tangent);
          if (angle > best) { best = angle; onward = option; }
        }
        edge = onward;
      }
      paths.push(path);
    }
    return paths;
  }

  function rotate({ width, height, rgba }) {
    const result = new Uint8Array(rgba.length);
    for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
      const p=(y*width+x)*4;
      result.set(rgba.subarray(p,p+4),(x*height+height-1-y)*4);
    }
    return { width:height, height:width, rgba:result };
  }

  function create(body, { paths, spacing=.40, inset=.085, corner=.60, period=1.6, phase=0, stagger=1,
    release=.47, push=.27, maxDrift=1, lift=.025, levelTolerance=.05, maxMarks=512,
    seed=0, mask, swatches, clips={} } = {}) {
    requireFoam(body && typeof body.columnAt === 'function' && (paths !== undefined || typeof body.shoreline === 'function') &&
      range(spacing,.02,100) && range(inset,.001,5) && range(corner,.1,Math.PI-.01) &&
      range(period,.04,120) && Number.isFinite(phase) && range(stagger,0,1) && range(release,0,.99) &&
      range(push,0,8) && range(maxDrift,0,8) && range(lift,0,1) && range(levelTolerance,1e-5,2) &&
      Number.isSafeInteger(seed) && Number.isInteger(maxMarks) && range(maxMarks,1,2048) &&
      (mask === undefined || typeof mask === 'function') && clips && Object.getPrototypeOf(clips)===Object.prototype &&
      Object.keys(clips).every(key=>names.includes(key)), 'invalid shoreline, animation, mask or placement options');

    const boundaries = paths ?? join(body.shoreline());
    requireFoam(Array.isArray(boundaries) && boundaries.length <= 16384, 'expected bounded wet-left waterline paths');
    const sites = [], art = new Map(), rotations = new WeakMap();
    let points = 0, candidates = 0, palette, roles;
    function wet(x,y,z) {
      const column = body.columnAt(x,z);
      return column && Math.abs(y-column.surface) <= levelTolerance && (!mask || mask(x,z)) ? column : null;
    }
    function site(at, dir, kind) {
      if (++candidates > 32768) throw new RangeError('Shore foam exceeds its placement work budget');
      for (const scale of [1,1.6,2.4]) {
        const anchor = V.mad(at,dir,inset*scale), column = wet(...anchor);
        if (!column) continue;
        requireFoam(sites.length < maxMarks,'waterline exceeds its mark budget');
        anchor[1] = column.surface;
        const drift = column.current ?? [0,0,0];
        requireFoam(point(drift),'water columns must supply finite world currents');
        sites.push({ at:anchor, dir, kind, current:[drift[0],0,drift[2]],
          phase: stagger*K.hash(sites.length,seed,331) });
        break;
      }
    }
    for (const path of boundaries) {
      requireFoam(Array.isArray(path) && path.length >= 2 && Array.from(path).every(point),'expected paths of finite XYZ points');
      points += path.length;
      requireFoam(points <= 32768,'waterline exceeds its path budget');
      const closed = same(path[0],path.at(-1)), trail = [];
      let total = 0;
      for (let i=1;i<path.length;i++) {
        const a = path[i-1], b = path[i], length = Math.hypot(b[0]-a[0],b[2]-a[2]);
        if (length < 1e-8) continue;
        trail.push({ a,b,start:total,length,tangent:norm(a,b) });
        total += length;
      }
      if (!trail.length) continue;
      const bends = [];
      for (let i=closed?0:1;i<trail.length;i++) {
        const a = trail[(i+trail.length-1)%trail.length], b = trail[i];
        if (!same(a.b,b.a)) continue;
        const angle = turn(a.tangent,b.tangent);
        if (Math.abs(angle) < corner || Math.abs(angle) >= Math.PI-.01) continue;
        if (bends.length && b.start-bends.at(-1) < spacing*.60) continue;
        if (closed && bends.length && total-b.start+bends[0] < spacing*.60) continue;
        bends.push(b.start);
        site(b.a,V.norm(V.add(wetward(a.tangent),wetward(b.tangent))),angle>0?'inside':'tip');
      }
      let edge=0, bend=0;
      for (let d=Math.min(total*.5,spacing*.5);d<total;d+=spacing) {
        while (edge<trail.length-1 && d>=trail[edge+1].start) edge++;
        while (bend<bends.length && bends[bend]<d-spacing*.52) bend++;
        if (bend<bends.length && Math.abs(bends[bend]-d)<spacing*.52 ||
            closed && bends.length && total-d+bends[0]<spacing*.52) continue;
        const row=trail[edge];
        site(V.lerp(row.a,row.b,(d-row.start)/row.length),wetward(row.tangent),'straight');
      }
    }
    for (const name of names) {
      const spec = clips[name] ?? stamps.clip(name,{swatches});
      requireFoam(range(spec.width,1,31) && range(spec.height,1,31) && spec.width===spec.height &&
        spec.width%2===1 && (spec.frames?.length??1)<=16,'foam clips need odd square cels up to 31 pixels and 16 frames');
      art.set(name,stamps.prepare(spec));
    }
    function image(kind, direction, t, colors) {
      if (colors.scenePalette!==palette || colors.paletteRoles!==roles) {
        palette=colors.scenePalette;
        roles=colors.paletteRoles;
        for (const clip of art.values()) for (const frame of clip.entries) rotations.delete(frame);
      }
      const clip=art.get('foam-'+kind+'-'+(direction%2?'se':'east'));
      const entry=clip.entries[clip.at(t*clip.duration)];
      if (!rotations.has(entry)) {
        const steps=[stamps.image({width:clip.width,height:clip.height,slots:entry.slots,palette:clip.palette},colors)];
        while (steps.length<4) steps.push(rotate(steps.at(-1)));
        rotations.set(entry,steps);
      }
      return rotations.get(entry)[direction>>1];
    }
    const effect = Object.freeze({ sites: K.procedural.data.freeze(sites) });
    states.set(effect,{ wet, period, phase:mod(phase), release, push, maxDrift, lift, image });
    return effect;
  }

  function frame(value, world, camera, { w,h,time=0,clip } = {}) {
    if (!value) return [];
    const effects=Array.isArray(value)?value:[value];
    requireFoam(effects.length<=8 && Array.from(effects).every(effect=>states.has(effect)),'expected up to eight foam effects from create()');
    const project=DrawingPrimitives.projector(camera,w,h), colors={scenePalette:world.pal,paletteRoles:world.paletteRoles}, rows=[];
    for (const effect of effects) {
      const { wet,period,phase,release,push,maxDrift,lift,image }=states.get(effect);
      const clock=mod((time%period)/period+phase);
      for (const site of effect.sites) {
        const age=mod(clock+site.phase), after=Math.max(0,(age-release)/(1-release));
        const delta=V.mad(V.mul(site.current,after*period*(1-release)),site.dir,push*after);
        const distance=Math.min(V.len(delta),maxDrift), steps=Math.ceil(distance/.06);
        const driftDirection=steps && V.norm(delta);
        let at=site.at;
        for (let i=1;i<=steps;i++) {
          const next=V.mad(site.at,driftDirection,i/steps*distance);
          if (!wet(...next)) break;
          at=next;
        }
        if ((camera.ortho ? camera.view[6]<=0 : camera.eye[1]<=at[1]+lift) || (clip && !clip(at))) continue;
        const lifted=V.mad(at,up,lift), origin=project.toView(lifted);
        if (!project.visible(origin)) continue;
        const [x,y]=project.point(origin), [u,v]=project.point(project.toView(V.mad(lifted,site.dir,.03)));
        const direction=Math.round(Math.atan2(v-y,u-x)/(Math.PI/4))&7;
        const art=image(site.kind,direction,age,colors);
        const left=Math.floor(x)-(art.width>>1), top=Math.floor(y)-(art.height>>1);
        if (left>=w || top>=h || left+art.width<=0 || top+art.height<=0) continue;
        const plane=planes.plane(camera,w,h,origin,up);
        rows.push({ left,top,depthAt:plane.depthAt,image:art,
          accepts(x,y,depth) {
            const [u,,v]=plane.point(x,y,depth);
            return wet(u,at[1],v);
          }
        });
      }
    }
    return rows;
  }
  K.shoreFoam = Object.freeze({ create, frame });
})(KIT);
