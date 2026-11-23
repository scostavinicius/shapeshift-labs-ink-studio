/* Editable, edge-registered stamp cels driven by a seekable pulse graph. */
(function (K) {
  const sides = 'NESW', dx = [0, 1, 0, -1], dy = [-1, 0, 1, 0];
  const templates = [
    { kind: 'cap', ports: 'S', entry: 2 },
    { kind: 'straight', ports: 'NS', entry: 0 },
    { kind: 'bend', ports: 'ES', entry: 2 },
    { kind: 'fork', ports: 'ESW', entry: 2 },
    { kind: 'cross', ports: 'NESW', entry: 2 }
  ];
  const bits = ports => [...ports].reduce((mask, side) => mask | (1 << sides.indexOf(side)), 0);
  const names = mask => [...sides].filter((_, d) => mask & (1 << d)).join('');
  const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const epsilon = 1e-9;
  function check(ok, message) {
    if (!ok) throw new RangeError('Pixel tiles: ' + message);
  }

  function rotations() {
    const byMask = new Map();
    for (const template of templates) {
      for (const mirror of [false, true]) for (let turn = 0; turn < 4; turn++) {
        const move = d => (turn + (mirror ? 4 - d : d)) % 4;
        const ports = [...template.ports].map(side => sides[move(sides.indexOf(side))]).join('');
        const mask = bits(ports);
        if (!byMask.has(mask)) byMask.set(mask, []);
        byMask.get(mask).push({ template, mirror, turn, entry: move(template.entry) });
      }
    }
    return byMask;
  }
  const variants = rotations();

  function rotate(source, size, { mirror, turn }) {
    if (!mirror && !turn) return source;
    const rgba = new Uint8Array(source.length);
    PixelGridMotion.blit(source,{rgba,width:size},size,0,0,turn,mirror);
    return rgba;
  }

  function checkSockets(slots, size, ports) {
    check(PixelGridMotion.matchSockets(slots,size,ports),
      'cel pixels must match the two center pixels of each ' + ports + ' socket');
  }

  function create({ width, height, size = 10, paths, style = 'copper', clips = {}, swatches,
    forkHold = .08, after = 'idle', cues = [] } = {}, palette = {}) {
    check(integer(width, 1, 4096) && integer(height, 1, 4096) && width * height <= 4096 &&
      integer(size, 4, 32) && size % 2 === 0 && width * height * size * size <= 1048576,
    'expected a bounded grid and an even tile size from 4 to 32');
    check(['copper', 'frost'].includes(style) && record(clips) &&
      Object.keys(clips).every(key => variants.has(bits(key)) && key === names(bits(key))) &&
      Number.isFinite(forkHold) && forkHold >= 0 && forkHold <= 3600 && ['idle', 'hold'].includes(after),
    'expected a style, canonical NESW clip keys, fork hold and idle or hold policy');
    check(Array.isArray(paths) && integer(paths.length, 1, 4096) &&
      Array.isArray(cues) && cues.length <= 32, 'expected routes and at most 32 cues');

    const count = width * height, neighbors = new Map();
    function address(point) {
      check(Array.isArray(point) && point.length === 2 &&
        integer(point[0], 0, width - 1) && integer(point[1], 0, height - 1), 'route and cue coordinates must be inside the grid');
      return point[1] * width + point[0];
    }
    function links(index) {
      if (!neighbors.has(index)) neighbors.set(index, [-1, -1, -1, -1]);
      return neighbors.get(index);
    }
    let work = 0;
    for (const path of paths) {
      check(Array.isArray(path) && integer(path.length, 2, 16384), 'a route needs at least two grid points');
      let a = address(path[0]);
      for (let j = 1; j < path.length; j++) {
        const b = address(path[j]), x = b % width - a % width, y = Math.floor(b / width) - Math.floor(a / width);
        check((x === 0) !== (y === 0), 'route segments must be nonzero and orthogonal');
        const d = x > 0 ? 1 : x < 0 ? 3 : y > 0 ? 2 : 0, stride = dx[d] + dy[d] * width;
        work += Math.abs(x || y);
        check(work <= 65536, 'routes exceed the segment budget');
        for (; a !== b; a += stride) {
          links(a)[d] = a + stride;
          links(a + stride)[(d + 2) % 4] = a;
        }
      }
    }

    const stamps = K.pixelStamps, art = new Map(), oriented = new Map();
    function readArt(key, template) {
      if (art.has(key)) return art.get(key);
      const spec = Object.hasOwn(clips, key) ? clips[key] :
        stamps.clip('tile-' + style + '-' + template.kind, { swatches });
      check(spec?.width === size && spec.height === size && Array.isArray(spec.frames) &&
        integer(spec.frames.length, 4, 32), 'each clip needs 4–32 cels on the declared square grid');
      const { entries, palette: colors } = stamps.prepare(spec);
      const durations = entries.map(({ duration }) => duration);
      check(durations.every(d => d >= .0001 && d <= 3600), 'cel holds must be from .0001 to 3600 seconds');
      const frames = entries.map(({ slots }) => {
        checkSockets(slots, size, key);
        return stamps.image({ width: size, height: size, slots, palette: colors }, palette).rgba;
      });
      const result = { frames, durations };
      art.set(key, result);
      return result;
    }
    function tile(mask, incoming, ports) {
      const code = mask * 5 + incoming + 1;
      if (oriented.has(code)) return oriented.get(code);
      const choices = variants.get(mask);
      const orientation = choices.find(choice => choice.entry === incoming) ?? choices[0];
      const { template } = orientation, exact = Object.hasOwn(clips, ports);
      const { frames, durations } = readArt(exact ? ports : template.ports, template);
      const result = {
        durations, kind: template.kind,
        images: exact ? frames : frames.map(frame => rotate(frame, size, orientation))
      };
      oriented.set(code, result);
      return result;
    }
    const cells = [...neighbors].sort(([a], [b]) => a - b).map(([index, links]) => {
      const mask = links.reduce((value, next, d) => value | (next < 0 ? 0 : 1 << d), 0);
      const ports = names(mask), base = tile(mask, -1, ports), { kind, durations } = base;
      const hold = kind === 'fork' || kind === 'cross' ? forkHold : 0;
      const active = durations.slice(1).map((duration, i) => ({ frame: i + 1, duration: duration + (i === 1 ? hold : 0) }));
      return {
        index, links, x: index % width, y: Math.floor(index / width), ports, kind,
        images: [base.images, ...links.map((next, d) => next < 0 ? base.images : tile(mask, d, ports).images)],
        clock: SpriteCels.playback(active, 12, 'once'),
        release: active[0].duration + active[1].duration,
        duration: active.reduce((sum, cel) => sum + cel.duration, 0)
      };
    });
    const byIndex = new Map(cells.map(cell => [cell.index, cell])), routes = new Map();

    function arrivals(first) {
      if (routes.has(first)) return routes.get(first);
      const offsets = new Float64Array(count).fill(Infinity), from = new Int8Array(count).fill(-1);
      // A wave visits each reachable cell once, even on closed paths.
      const queue = new ProceduralHeap((a, b) => a.time < b.time || (a.time === b.time && a.index < b.index));
      offsets[first] = 0;
      queue.push({ time: 0, index: first });
      while (queue.size) {
        const { time, index } = queue.pop();
        if (time !== offsets[index]) continue;
        const cell = byIndex.get(index), exit = time + cell.release;
        for (const [d, next] of cell.links.entries()) {
          if (next < 0 || exit + epsilon >= offsets[next]) continue;
          offsets[next] = exit;
          from[next] = (d + 2) % 4;
          queue.push({ time: exit, index: next });
        }
      }
      const result = { offsets, from };
      routes.set(first, result);
      return result;
    }
    const schedule = Array.from(cues, cue => {
      check(record(cue), 'each cue needs a cell and a time');
      const { at, time = 0, period } = cue, first = address(at);
      check(byIndex.has(first) && Number.isFinite(time) &&
        (period === undefined || Number.isFinite(period) && period >= .0001),
      'cues must start on a route at a finite time with a positive optional period');
      return { ...arrivals(first), time, period };
    });
    const w = width * size, h = height * size;

    function state(cell, time) {
      let age = Infinity, entry = -1;
      for (const { offsets, from, time: start, period } of schedule) {
        const elapsed = (time - start) - offsets[cell.index];
        if (!(elapsed >= -epsilon && Number.isFinite(elapsed))) continue;
        let since = Math.max(0, elapsed);
        if (period !== undefined) {
          since %= period;
          if (period - since <= epsilon) since = 0;
        }
        if (since >= age) continue;
        age = since;
        entry = from[cell.index];
      }
      const idle = age === Infinity || (after === 'idle' && age + epsilon >= cell.duration);
      return { frame: idle ? 0 : cell.clock(age + epsilon), age: age === Infinity ? null : age, entry };
    }
    function raster(time = 0) {
      check(Number.isFinite(time), 'sample time must be finite');
      const rgba = new Uint8Array(w * h * 4);
      for (const cell of cells) {
        const { frame, entry } = state(cell, time);
        const image = cell.images[frame === 0 ? 0 : entry + 1][frame];
        for (let y = 0; y < size; y++) {
          const start = y * size * 4;
          rgba.set(image.subarray(start, start + size * 4), ((cell.y * size + y) * w + cell.x * size) * 4);
        }
      }
      return { w, h, rgba };
    }

    return Object.freeze({
      w, h, raster,
      cells: Object.freeze(cells.map(({ x, y, ports, kind }) => Object.freeze({ x, y, ports, kind }))),
      sample(x, y, time = 0) {
        check(Number.isFinite(time), 'sample time must be finite');
        const cell = byIndex.get(address([x, y]));
        if (!cell) return null;
        const { frame, age, entry } = state(cell, time);
        return { frame, age, from: sides[entry] ?? null };
      }
    });
  }

  function pairedArcs(size = 8, swatches) {
    check([8,12].includes(size),'paired arc presets come in 8×8 and 12×12');
    const clip = id => K.pixelStamps.clip('tile-reconnect-'+size+'-'+id,{swatches});
    return {
      variants:{a:{pairs:['NE','SW'],cel:clip('a')},b:{pairs:['NW','ES'],cel:clip('b')}},
      transitions:[
        {from:'a',to:'b',clip:clip('a-b'),stages:['from','open','open','to']},
        {from:'b',to:'a',clip:clip('b-a'),stages:['from','open','open','to']}
      ]
    };
  }

  function reconnect({width,height,size=8,variants,transitions=[],initial='a',cues=[],period}={},palette={}) {
    const timeline=PixelGridMotion.clock(width,height,cues,period), w=width*size,h=height*size;
    check(integer(size,4,32) && size%2===0 && w*h<=1048576,
      'reconnection needs an even tile size from 4 to 32 and a bounded raster');
    check(record(variants) && integer(Object.keys(variants).length,1,64) && Array.isArray(transitions) &&
      transitions.length<=256,'expected named variants and up to 256 transitions');
    const {pixelStamps:stamps}=K, byName=new Map(), byChange=new Map(), open=Object.freeze([]);
    let paintBudget=1048576;
    function art(spec,ports,single){
      check(spec?.width===size && spec.height===size &&
        (spec.frames===undefined || Array.isArray(spec.frames)&&integer(spec.frames.length,1,single?1:32)),
      'expected one steady cel or a transition of up to 32 cels on the declared square');
      const {entries,palette:colors,duration}=stamps.prepare(spec);
      paintBudget-=entries.length*size*size;
      check(paintBudget>=0 && entries.every(cel=>cel.duration>=.0001&&cel.duration<=3600),
        'reconnection exceeded the art budget or has an invalid cel hold');
      const images=entries.map(({slots})=>{
        checkSockets(slots,size,ports);
        return stamps.image({width:size,height:size,slots,palette:colors},palette).rgba;
      });
      return {images,duration,at:SpriteCels.playback(entries,12,'once')};
    }
    for (const [id,variant] of Object.entries(variants)){
      check(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(id) && record(variant) &&
        Array.isArray(variant.pairs) && variant.pairs.length<=2 &&
        Array.from(variant.pairs).every(pair=>typeof pair==='string' && /^[NESW]{2}$/.test(pair)) &&
        new Set(variant.pairs.join('')).size===variant.pairs.length*2,
      'a variant needs an ID and distinct paired NESW sockets');
      const pairs=Object.freeze(variant.pairs.slice()), ports=names(bits(pairs.join('')));
      byName.set(id,{id,pairs,ports,art:art(variant.cel,ports,true).images[0]});
    }
    const variant = id => {
      check(byName.has(id),'unknown reconnection variant '+id);
      return byName.get(id);
    };
    const transitionKey=(from,to)=>from.id+'>'+to.id;
    for (const transition of transitions) {
      check(record(transition),'expected a transition record');
      const from=variant(transition.from),to=variant(transition.to),key=transitionKey(from,to);
      check(from!==to && from.ports===to.ports&&!byChange.has(key),
        'transitions must be unique and preserve the exterior sockets');
      const clip=art(transition.clip,from.ports,false), stages=transition.stages??
        clip.images.map(()=> 'open');
      check(Array.isArray(stages)&&stages.length===clip.images.length &&
        Array.from(stages).every(stage=>['from','open','to'].includes(stage)),
      'each transition cel needs a from, open, or to stage');
      byChange.set(key,{...clip,stages:stages.slice()});
    }
    const count=width*height;
    check(typeof initial==='string' || typeof initial==='function' || Array.isArray(initial)&&initial.length===count,
      'initial state must be a variant, one variant per cell, or a cell callback');
    const base=Array.from({length:count},(_,i)=>{
      const [x,y]=timeline.coords(i);
      return variant(typeof initial==='function' ? initial({x,y}) : Array.isArray(initial) ? initial[i] : initial);
    });
    for(const [i,cell] of base.entries()){
      const [x,y]=timeline.coords(i);
      check((x===width-1 || cell.ports.includes('E')===base[i+1].ports.includes('W')) &&
        (y===height-1 || cell.ports.includes('S')===base[i+width].ports.includes('N')),
      'adjacent tiles must agree on their exterior sockets');
    }
    const targets=cues.map(({to,next})=>{
      check((to===undefined)!==(next===undefined),'a reconnection cue needs either to or next');
      if(to!==undefined) return ()=>variant(to);
      check(record(next),'next must map source variants to destination variants');
      const map=new Map(Object.entries(next).map(([from,to])=>[variant(from),variant(to)]));
      return from=>map.get(from)??from;
    });
    const rows=timeline.rows.map((row,i)=>{
      let current=base[i];
      const events=row.flatMap(entry=>{
        const from=current,to=targets[entry.id](from);
        if(from===to) return [];
        const change=byChange.get(transitionKey(from,to));
        check(change,'missing painted transition from '+from.id+' to '+to.id);
        current=to;
        return [{...entry,from,to,change}];
      });
      check(period===undefined || current===base[i],'looping reconnections must restore every initial variant');
      return events;
    });
    function state(i,local) {
      const event=timeline.at(rows[i],local), current=event?.to??base[i];
      if(!event || local+epsilon>=event.end) return {variant:current.id,pairs:current.pairs,art:current.art,active:false};
      const {from,to,change}=event,progress=Math.max(0,(local-event.start)/(event.end-event.start)),
        frame=change.at(progress*change.duration+epsilon);
      const stage=change.stages[frame], paired=stage==='from'?from:stage==='to'?to:null;
      return {variant:paired?.id??null,pairs:paired?.pairs??open,art:change.images[frame],
        active:true,from:from.id,to:to.id,stage,frame,progress};
    }
    function raster(time=0){
      const local=timeline.time(time),rgba=new Uint8Array(w*h*4),target={rgba,width:w};
      for(let i=0;i<count;i++){
        const [x,y]=timeline.coords(i);
        PixelGridMotion.blit(state(i,local).art,target,size,x*size,y*size);
      }
      return {w,h,rgba};
    }
    function trace(x,y,entry,time=0){
      check(typeof entry==='string'&&entry.length===1&&sides.includes(entry),'trace entry must be one NESW socket');
      let i=timeline.address([x,y]);
      const local=timeline.time(time), path=[],seen=new Set();
      if(!base[i].ports.includes(entry)) return {path,end:'absent'};
      while(true){
        const key=i*4+sides.indexOf(entry);
        if(seen.has(key)) return {path,end:'loop'};
        seen.add(key);
        [x,y]=timeline.coords(i);
        const pair=state(i,local).pairs.find(link=>link.includes(entry));
        if(!pair) return {path,end:'open'};
        const exit=pair[0]===entry ? pair[1] : pair[0],d=sides.indexOf(exit);
        path.push({x,y,entry,exit});
        x+=dx[d];y+=dy[d];
        if(x<0||x>=width||y<0||y>=height) return {path,end:'edge'};
        i=y*width+x;
        entry=sides[(d+2)%4];
      }
    }
    return Object.freeze({w,h,raster,trace,sample(x,y,time=0){
      const {art,...pose}=state(timeline.address([x,y]),timeline.time(time));
      return pose;
    }});
  }

  K.pixelTiles = Object.freeze({create,reconnect,pairedArcs});
})(KIT);
