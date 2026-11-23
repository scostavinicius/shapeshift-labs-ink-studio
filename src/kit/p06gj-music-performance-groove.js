/* Performance grooves retain independent beat offsets, relative accents and gates. */
(function (P) {
  const {fields,record,finite,integer,id,check}=P.musicInstruments, T=P.takeTime;
  const format='ink-studio/performance-groove', eps=1e-8;
  const round=value=>Number(value.toFixed(9));
  const median=values=>{
    const sorted=values.slice().sort((a,b)=>a-b), center=Math.floor(sorted.length/2);
    return sorted.length%2 ? sorted[center] : (sorted[center-1]+sorted[center])/2;
  };
  function table(value,max,label) {
    check(record(value) && Object.keys(value).length<=max && Object.keys(value).every(id),'Invalid groove '+label);
    return Object.entries(value);
  }
  function grid(step,length) {
    check(finite(step,.0625,4) && finite(length,step,128) && Math.abs(length/step-Math.round(length/step))<eps &&
      length/step<=512,'A groove needs an integral grid of up to 512 slots');
    return Math.round(length/step);
  }
  function template(raw) {
    check(fields(raw,['format','version','id','step','length','lanes']) && raw.format===format &&
      raw.version===1 && id(raw.id),'Invalid performance groove');
    const slots=grid(raw.step,raw.length), lanes=table(raw.lanes,32,'lanes');
    check(lanes.length,'A groove needs at least one observed lane');
    for (const [,rows] of lanes) {
      check(Array.isArray(rows) && integer(rows.length,1,slots),'Invalid groove lane cells');
      const seen=new Set();
      for (const cell of rows) {
        check(fields(cell,['slot','offset','accent','length']) && integer(cell.slot,0,slots-1) && !seen.has(cell.slot) &&
          finite(cell.offset,-raw.step/2-eps,raw.step/2+eps) && finite(cell.accent,.125,2) &&
          (cell.length===undefined || finite(cell.length,1e-5,64)),'Invalid groove cell');
        seen.add(cell.slot);
      }
    }
    return raw;
  }
  function fit(points,settings={}) {
    check(Array.isArray(points) && integer(points.length,1,16384) &&
      fields(settings,['id','step','length','cycles','startBeat','map','tolerance']),
    'Groove fit needs measured notes and a reference grid');
    const {id:key='performance',step=.25,length=4,cycles=1,startBeat=0,map,
      tolerance=step*.48}=settings;
    const slots=grid(step,length), clock=P.musicTiming.compile(map);
    check(id(key) && integer(cycles,1,128) && finite(startBeat,0,65536) &&
      finite(tolerance,1e-5,step/2),'Invalid source groove grid or fit tolerance');
    const lanes=new Map(), measured=[];
    let outside=0, unmatched=0;
    for (const row of points) {
      check(fields(row,['lane','beat','time','velocity','durationBeats','duration','articulation','midi']) && id(row.lane) &&
        (row.articulation===undefined || id(row.articulation)) && (row.midi===undefined || integer(row.midi,0,127)) &&
        (row.beat===undefined)!==(row.time===undefined) &&
        (row.duration===undefined || row.time!==undefined && row.durationBeats===undefined) &&
        (row.velocity===undefined || finite(row.velocity,1e-7,1)), 'Invalid measured groove note');
      const at=row.time===undefined ? null : T.read(row.time);
      const beat=at ? clock.sample(row.time).beat : row.beat;
      const gate=row.duration===undefined ? row.durationBeats : clock.sample(T.seconds(T.add(at,T.read(row.duration)))).beat-beat;
      check(finite(beat,-128,1e6) && (gate===undefined || finite(gate,1e-5,64)),'Invalid measured groove onset or gate');
      const relative=beat-startBeat, index=Math.round(relative/step);
      if (index<0 || index>=slots*cycles) { outside++; continue; }
      const offset=relative-index*step;
      if (Math.abs(offset)>tolerance+eps) { unmatched++; continue; }
      const slot=index%slots, cycle=Math.floor(index/slots);
      if (!lanes.has(row.lane)) {
        check(lanes.size<32,'Groove fit exceeds its lane budget');
        lanes.set(row.lane,{velocities:[],cells:new Map()});
      }
      const lane=lanes.get(row.lane);
      if (!lane.cells.has(slot)) lane.cells.set(slot,[]);
      lane.cells.get(slot).push({offset,velocity:row.velocity,gate});
      if (row.velocity!==undefined) lane.velocities.push(row.velocity);
      measured.push({lane:row.lane,beat:round(beat),slot,cycle,offset:round(offset),
        ...(row.velocity!==undefined && {velocity:row.velocity}),...(gate!==undefined && {length:round(gate)}),
        ...(row.articulation!==undefined && {articulation:row.articulation}),...(row.midi!==undefined && {midi:row.midi})});
    }
    const value={format,version:1,id:key,step,length,lanes:Object.fromEntries(Array.from(lanes,([lane,{velocities,cells}])=>{
      const center=velocities.length ? median(velocities) : 1;
      return [lane,Array.from(cells,([slot,rows])=>{
        const level=rows.flatMap(row=>row.velocity===undefined ? [] : [row.velocity]);
        const gate=rows.flatMap(row=>row.gate===undefined ? [] : [row.gate]);
        return {slot,offset:round(median(rows.map(row=>row.offset))),
          accent:level.length ? round(Math.max(.125,Math.min(2,median(level)/center))) : 1,
          ...(gate.length && {length:round(median(gate))})};
      }).sort((a,b)=>a.slot-b.slot)];
    }))};
    return {value:P.data.freeze(template(value)),take:P.musicEnsemble.snapshot(measured,{id:key,step,length,cycles}),report:{step,length,cycles,startBeat,tolerance,outside,unmatched,measured}};
  }

  function compile(raw,plan,names,articulations) {
    check(fields(raw,['template','startBeat','anchors','tracks','roles','links','ensemble']) &&
      (raw.template!==undefined || raw.ensemble!==undefined),'Invalid production groove transfer');
    const model=raw.template===undefined ? null : template(raw.template), slots=model && grid(model.step,model.length);
    const ensemble=raw.ensemble===undefined ? null : P.musicEnsemble.compile(raw.ensemble,plan,names,articulations);
    const {startBeat=0,anchors=[],links=[]}=raw;
    check(finite(startBeat,0,65536) && Array.isArray(anchors) && anchors.length<=1024 &&
      Array.from(anchors).every(beat=>finite(beat,0,plan.sections.at(-1).end)) &&
      Array.isArray(links) && links.length<=8,'Invalid groove phase, anchors or links');
    const pin=new Set(anchors.map(round));
    const cells=Object.fromEntries(Object.entries(model?.lanes ?? {}).map(([name,rows])=>[name,new Map(rows.map(row=>[row.slot,row]))]));
    const knobs=['lane','timing','accent','length'];
    function route(settings,defaults={}) {
      check(fields(settings,knobs),'Invalid groove route');
      const value={timing:1,accent:1,length:1,...defaults,...settings};
      check(id(value.lane) && Object.hasOwn(cells,value.lane) &&
        ['timing','accent','length'].every(key=>finite(value[key],0,2)),'Groove route needs a known lane and separate strengths');
      return value;
    }
    function withArticulations(settings,inherited) {
      check(fields(settings,[...knobs,'articulations']),'Invalid groove track or role route');
      const {articulations={},...base}=settings;
      const main=route(base,inherited?.main);
      return {main,articulations:{...inherited?.articulations,
        ...Object.fromEntries(table(articulations,32,'articulations').map(([name,patch])=>[name,route(patch,main)]))}};
    }
    const roles=Object.fromEntries(table(raw.roles ?? {},8,'roles').map(([name,row])=>{
      check(names.some(track=>plan.parts[track]?.role===name),'Groove route has no such production role');
      return [name,withArticulations(row)];
    }));
    const routes=Object.fromEntries(table(raw.tracks ?? {},8,'tracks').map(([name,row])=>{
      check(names.includes(name),'Groove route has no such production track');
      return [name,withArticulations(row,roles[plan.parts[name].role])];
    }));
    const followers=new Map();
    for (const row of links) {
      check(fields(row,['leader','followers','within','strength','offset']) && names.includes(row.leader) &&
        Array.isArray(row.followers) && integer(row.followers.length,1,7),'Groove link needs a leader and followers');
      const {within=.0625,strength=1,offset}=row;
      check(finite(within,0,.5) && finite(strength,0,1),'Invalid groove link tolerance or strength');
      if (offset!==undefined) {
        check(fields(offset,['unit','points']) && ['seconds','beats'].includes(offset.unit) &&
          Array.isArray(offset.points) && integer(offset.points.length,1,64),'A groove link offset needs a unit and beat-addressed points');
        const limit=offset.unit==='beats' ? .25 : .125;
        check(Array.from(offset.points).every((point,i)=>Array.isArray(point) && point.length===2 &&
          finite(point[0],0,plan.sections.at(-1).end) && finite(point[1],-limit,limit) &&
          (!i || point[0]>offset.points[i-1][0])),'Groove link offsets need increasing beats and bounded offsets');
      }
      for (const name of row.followers) {
        check(names.includes(name) && name!==row.leader && !followers.has(name),'Each groove follower needs one other leader');
        followers.set(name,{leader:row.leader,within,strength,offset});
      }
    }
    const order=[], visiting=new Set();
    function visit(name) {
      check(!visiting.has(name),'Groove links cannot form a cycle');
      if (order.includes(name)) return;
      visiting.add(name);
      const leader=followers.get(name)?.leader;
      if (leader) visit(leader);
      visiting.delete(name);
      order.push(name);
    }
    for (const name of names) visit(name);
    function style(name,articulation,beat,clock) {
      const route=routes[name] ?? roles[plan.parts[name].role];
      const rule=route && (Object.hasOwn(route.articulations,articulation) ? route.articulations[articulation] : route.main);
      if (!rule || beat<startBeat-eps) return {delay:0,accent:1};
      const index=Math.round((beat-startBeat)/model.step);
      if (Math.abs(beat-startBeat-index*model.step)>model.step*.49+eps) return {delay:0,accent:1};
      const cell=cells[rule.lane].get((index%slots+slots)%slots);
      if (!cell) return {delay:0,accent:1};
      const at=clock.timeAt({beat});
      return {
        delay:rule.timing ? clock.timeAt({beat:round(Math.max(0,beat+cell.offset*rule.timing))})-at : 0,
        accent:1+(cell.accent-1)*rule.accent,
        ...(cell.length!==undefined && rule.length>0 && {gate:{
          target:clock.timeAt({beat:round(beat+cell.length)})-at,strength:rule.length}})
      };
    }
    function driver(name,events,clock) {
      const link=followers.get(name);
      if (!link || !link.strength) return null;
      const leader=events[link.leader].filter(row=>row.velocity>0).slice().sort((a,b)=>a.beat-b.beat || a.time-b.time);
      return (time,beat)=>{
        let lo=0,hi=leader.length;
        while (lo<hi) {
          const mid=(lo+hi)>>1;
          if (leader[mid].beat<beat-eps) lo=mid+1;
          else hi=mid;
        }
        const a=leader[lo-1], b=leader[lo];
        const best=!b || a && beat-a.beat<b.beat-beat-eps ? a : b;
        if (!best || Math.abs(best.beat-beat)>link.within+eps) return time;
        // Equal written beats may contain rolls. Lock to the first attack.
        let first=best;
        for (let i=(best===b ? lo : lo-1)-1;i>=0 && Math.abs(leader[i].beat-best.beat)<eps;i--)
          first=leader[i];
        let offset=0;
        if (link.offset) {
          const {unit,points}=link.offset;
          const index=points.findIndex(row=>row[0]>beat);
          const before=index<0 ? points.at(-1) : points[Math.max(0,index-1)], after=points[index];
          offset=index<=0 ? before[1] : before[1]+(after[1]-before[1])*(beat-before[0])/(after[0]-before[0]);
          if (unit==='beats')
            offset=clock.timeAt({beat:round(Math.max(0,beat+offset))})-clock.timeAt({beat:round(beat)});
        }
        return time+(first.time+offset-time)*link.strength;
      };
    }
    return {order,style,driver,ensemble,anchor:beat=>pin.has(round(beat))};
  }

  P.performanceGroove=Object.freeze({fit,compile});
})(KIT.procedural);
