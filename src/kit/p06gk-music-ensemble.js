/* Beat-addressed ensemble phrasing, performance takes and two-way pocket. */
(function (P) {
  const {fields,record,finite,integer,id,check}=P.musicInstruments;
  const eps=1e-8, round=value=>Number(value.toFixed(9));
  const neutral={delay:0,accent:1,length:1};
  const takeFormat='ink-studio/performance-take';
  function table(value,max,label) {
    check(record(value) && Object.keys(value).length<=max && Object.keys(value).every(id),'Invalid ensemble '+label);
    return Object.entries(value);
  }
  function take(raw) {
    check(fields(raw,['format','version','id','step','length','lanes']) && raw.format===takeFormat &&
      raw.version===1 && id(raw.id) && finite(raw.step,.0625,4) && finite(raw.length,raw.step,16384),
    'Invalid ensemble performance take');
    const lanes=table(raw.lanes,32,'take lanes');
    let count=0;
    for (const [,rows] of lanes) {
      check(Array.isArray(rows) && rows.length && (count+=rows.length)<=16384,'Invalid take lane or event budget');
      const ids=new Set();
      check(Array.from(rows).every((row,i)=>{
        if (!fields(row,['id','beat','offset','velocity','length','articulation','midi']) || !id(row.id) ||
          ids.has(row.id) || !finite(row.beat,0,raw.length-eps) || i && row.beat<rows[i-1].beat ||
          !finite(row.offset,-raw.step/2-eps,raw.step/2+eps) ||
          row.velocity!==undefined && !finite(row.velocity,1e-7,1) ||
          row.length!==undefined && !finite(row.length,1e-5,64) ||
          row.articulation!==undefined && !id(row.articulation) || row.midi!==undefined && !integer(row.midi,0,127))
          return false;
        ids.add(row.id);
        return true;
      }),'Invalid or unordered performance take event');
    }
    check(count>0,'A performance take needs observed events');
    return raw;
  }
  function snapshot(measured,{id:key,step,length,cycles}) {
    const lanes=new Map();
    for (const {lane,slot,cycle,offset,velocity,length:gate,articulation,midi} of measured) {
      if (!lanes.has(lane)) lanes.set(lane,[]);
      const rows=lanes.get(lane);
      rows.push({id:'hit-'+(rows.length+1),beat:round(cycle*length+slot*step),offset,
        ...(velocity!==undefined && {velocity}),...(gate!==undefined && {length:gate}),
        ...(articulation!==undefined && {articulation}),...(midi!==undefined && {midi})});
    }
    for (const rows of lanes.values()) rows.sort((a,b)=>a.beat-b.beat || a.offset-b.offset);
    return P.data.freeze(take({format:takeFormat,version:1,id:key,step,length:length*cycles,lanes:Object.fromEntries(lanes)}));
  }
  function lower(rows,beat) {
    let lo=0,hi=rows.length;
    while (lo<hi) {
      const mid=(lo+hi)>>1;
      if (rows[mid].beat<beat) lo=mid+1;
      else hi=mid;
    }
    return lo;
  }
  function curve(points,end,lo,hi,label) {
    check(Array.isArray(points) && integer(points.length,1,128) &&
      Array.from(points).every((row,i)=>Array.isArray(row) && row.length===2 && finite(row[0],0,end) &&
        finite(row[1],lo,hi) && (!i || row[0]>points[i-1][0])), 'Invalid ensemble '+label+' curve');
    return beat=>{
      const index=points.findIndex(row=>row[0]>beat);
      if (index<0) return points.at(-1)[1];
      if (index===0) return points[0][1];
      const [start,a]=points[index-1], [stop,b]=points[index];
      return a+(b-a)*(beat-start)/(stop-start);
    };
  }
  const beatShift=(clock,beat,amount)=>amount ?
    clock.timeAt({beat:round(Math.max(0,beat+amount))})-clock.timeAt({beat:round(beat)}) : 0;
  function offset(spec,end,label) {
    if (spec===undefined) return ()=>0;
    check(fields(spec,['unit','points']) && ['beats','seconds'].includes(spec.unit),'Invalid ensemble '+label+' units');
    const limit=spec.unit==='beats' ? .5 : .25;
    const value=curve(spec.points,end,-limit,limit,label);
    return (beat,clock)=>spec.unit==='beats' ? beatShift(clock,beat,value(beat)) : value(beat);
  }
  function compile(raw,plan,names,articulations={}) {
    check(fields(raw,['id','pulse','players','takes','transfers','partners']) && (raw.id===undefined || id(raw.id)),
      'Invalid ensemble performance');
    const end=plan.sections.at(-1).end, pulse=offset(raw.pulse,end,'pulse');
    const players=new Map(table(raw.players ?? {},8,'players').map(([name,row])=>{
      check(names.includes(name) && fields(row,['offset','accent','length']),'Invalid ensemble player');
      return [name,{delay:offset(row.offset,end,'player offset'),
        accent:row.accent===undefined ? ()=>1 : curve(row.accent,end,0,2,'accent'),
        length:row.length===undefined ? ()=>1 : curve(row.length,end,.125,4,'length')}];
    }));
    const takes=new Map(table(raw.takes ?? {},32,'takes').map(([name,model])=>[name,take(model)]));
    const transfers=new Map(names.map(name=>[name,[]]));
    const transferRows=raw.transfers ?? [];
    check(Array.isArray(transferRows) && transferRows.length<=128,'Invalid ensemble transfer list');
    for (const row of transferRows) {
      check(fields(row,['track','take','lane','from','to','sourceFrom','sourceTo','within','byPitch',
        'timing','accent','length','articulation','articulations']) && names.includes(row.track) &&
        takes.has(row.take) && id(row.lane),'Invalid ensemble transfer');
      const model=takes.get(row.take), lane=Object.hasOwn(model.lanes,row.lane) && model.lanes[row.lane];
      const {from,to,sourceFrom=0,sourceTo=model.length,within=model.step*.49,byPitch=false,
        timing=1,accent=1,length=1,articulation=true}=row;
      check(lane && finite(from,0,end) && finite(to,from+eps,end) && finite(sourceFrom,0,model.length) &&
        finite(sourceTo,sourceFrom+eps,model.length) && finite(within,0,2) && typeof byPitch==='boolean' &&
        typeof articulation==='boolean' && [timing,accent,length].every(value=>finite(value,0,2)),
      'Invalid ensemble transfer lane, ranges or strengths');
      const labels=new Map(table(row.articulations ?? {},32,'articulation mapping'));
      check([...labels.values()].every(id),'Invalid destination articulation');
      const observed=lane.filter(hit=>hit.beat>=sourceFrom-eps && hit.beat<sourceTo-eps);
      check(observed.length,'Ensemble transfer range contains no observed attacks');
      const levels=observed.flatMap(hit=>hit.velocity===undefined ? [] : [hit.velocity]).sort((a,b)=>a-b);
      const mid=Math.floor(levels.length/2), median=levels.length ? (levels[mid]+levels[Math.floor((levels.length-1)/2)])/2 : 1;
      const pitches=new Map();
      if (byPitch) for (const hit of observed) {
        if (!pitches.has(hit.midi)) pitches.set(hit.midi,[]);
        pitches.get(hit.midi).push(hit);
      }
      const scale=(to-from)/(sourceTo-sourceFrom);
      check(finite(scale,.125,8),'Ensemble transfer span ratio must be between 1/8 and 8');
      transfers.get(row.track).push({from,to,sourceFrom,scale,within,byPitch,
        timing,accent,length,articulation,labels,observed,pitches,median,take:row.take,lane:row.lane});
    }
    for (const spans of transfers.values()) {
      spans.sort((a,b)=>a.from-b.from);
      check(spans.every((row,i)=>!i || row.from>=spans[i-1].to),'Overlapping ensemble transfers on a player');
    }
    const pairs=raw.partners ?? [];
    check(Array.isArray(pairs) && pairs.length<=28,'Invalid ensemble partners');
    const seen=new Set();
    const partners=Array.from(pairs,row=>{
      check(fields(row,['tracks','within','strength','mobility','offset']) && Array.isArray(row.tracks) &&
        row.tracks.length===2 && row.tracks[0]!==row.tracks[1] && Array.from(row.tracks).every(name=>names.includes(name)),
      'An ensemble partnership needs two production tracks');
      const {tracks,within=.0625,strength=1,mobility=[1,1]}=row, key=JSON.stringify(tracks.slice().sort());
      check(!seen.has(key) && finite(within,0,.5) && finite(strength,0,1) &&
        Array.isArray(mobility) && mobility.length===2 && Array.from(mobility).every(value=>finite(value,0,1)) &&
        mobility.some(Boolean),'Invalid or duplicated ensemble partnership');
      seen.add(key);
      return {tracks,within,strength,mobility,offset:offset(row.offset,end,'partner offset'),key};
    }).sort((a,b)=>a.key.localeCompare(b.key));

    function style(name,beat,midi,clock) {
      const player=players.get(name), span=transfers.get(name).find(row=>beat>=row.from-eps && beat<row.to-eps);
      const result={...neutral,delay:pulse(beat,clock)+(player?.delay(beat,clock) ?? 0),
        accent:player?.accent(beat) ?? 1,length:player?.length(beat) ?? 1};
      if (!span) return result;
      const hits=span.byPitch ? span.pitches.get(midi) ?? [] : span.observed;
      const target=span.sourceFrom+(beat-span.from)/span.scale, index=lower(hits,target-eps);
      const a=hits[index-1], b=hits[index];
      const best=!b || a && target-a.beat<b.beat-target-eps ? a : b;
      if (!best || Math.abs(target-best.beat)>span.within+eps) return result;
      result.delay+=beatShift(clock,beat,best.offset*span.scale*span.timing);
      if (best.velocity!==undefined) {
        const relative=Math.max(.125,Math.min(2,best.velocity/span.median));
        result.accent*=1+(relative-1)*span.accent;
      }
      if (best.length!==undefined && span.length)
        result.gate={target:beatShift(clock,beat,best.length*span.scale),strength:span.length};
      const label=span.articulation && best.articulation ? span.labels.get(best.articulation) ?? best.articulation : undefined;
      if (label && articulations[name]?.has(label)) result.articulation=label;
      result.reference={take:span.take,lane:span.lane,hit:best.id,...(label && {articulation:label,applied:!!result.articulation})};
      return result;
    }
    function couple(lines,clock,anchor) {
      const cohorts=new Map(names.map(name=>{
        const byBeat=new Map();
        for (const draft of lines[name].drafts) {
          if (!draft.audible) continue;
          const beat=round(draft.row.beat);
          if (!byBeat.has(beat)) byBeat.set(beat,{beat,time:Infinity,drafts:[]});
          const group=byBeat.get(beat);
          group.time=Math.min(group.time,draft.proposed);
          group.drafts.push(draft);
        }
        return [name,[...byBeat.values()].sort((a,b)=>a.beat-b.beat)];
      }));
      const shifts=new Map(), matches=[];
      for (const {tracks,within,strength,mobility,offset} of partners) {
        if (!strength) continue;
        const [first,second]=tracks.map(name=>cohorts.get(name));
        let used=0;
        for (const a of first) {
          const index=Math.max(used,lower(second,a.beat-eps));
          const before=index>used ? second[index-1] : undefined, after=second[index];
          const prev=before && (!after || a.beat-before.beat<after.beat-a.beat-eps);
          const b=prev ? before : after;
          if (!b || Math.abs(a.beat-b.beat)>within+eps) continue;
          used=prev ? index : index+1;
          const [wa,wb]=[a,b].map((group,i)=>anchor(group.beat) ? 0 : mobility[i]), sum=wa+wb;
          if (!sum) continue;
          const lag=clock.timeAt({beat:b.beat})-clock.timeAt({beat:a.beat})+offset(a.beat,clock);
          const error=b.time-a.time-lag;
          for (const [group,delta,weight] of [[a,error,wa],[b,-error,wb]]) {
            if (!weight) continue;
            for (const draft of group.drafts) {
              const acc=shifts.get(draft) ?? {delta:0,strength:0};
              acc.delta+=delta*weight/sum*strength;
              acc.strength+=strength;
              shifts.set(draft,acc);
            }
          }
          matches.push({tracks,beats:[a.beat,b.beat],targetSeconds:round(lag),proposedSeconds:round(b.time-a.time)});
        }
      }
      for (const [draft,shift] of shifts) draft.adjustment=draft.proposed-draft.authored+shift.delta/Math.max(1,shift.strength);
      return matches;
    }
    return {id:raw.id ?? 'ensemble',style,couple};
  }
  P.musicEnsemble=Object.freeze({snapshot,compile});
})(KIT.procedural);
