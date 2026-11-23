/* Scoped arrangement edits and exact reference playback outside their edit windows. */
(function (P) {
  const A=P.musicProduction,T=P.takeTime;
  const {check,fields,record,id,integer,finite}=P.musicInstruments;
  const format='ink-studio/locked-arrangement', searchFormat='ink-studio/locked-arrangement-search';
  const eps=1e-7, round=n=>Number(n.toFixed(9)), same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const inside=(n,from,to)=>n>=from-eps && n<to-eps;
  const sample=(time,rate)=>T.index(T.roundDown(T.mul(T.read(time),[BigInt(rate),1n])));

  function position(score,raw) {
    if (typeof raw==='number') return round(raw);
    check(P.musicTiming.isPosition(raw),'Use a beat number or musical position for an edit boundary');
    return round(score.clock.sample(score.clock.timeAt(raw)).beat);
  }
  function context(source,score,raw) {
    const {range,locks={},fade=.024}=raw, end=score.arrangement.sections.at(-1).end;
    check(fields(range,['from','to']) && range.from!==undefined && range.to!==undefined &&
      fields(locks,['tracks','regions']) && finite(fade,0,.25),'Use an edit range, optional locks, and a fade up to 0.25 seconds');
    function window(row) {
      const from=position(score,row.from),to=position(score,row.to);
      check(finite(from,0,end) && finite(to,from+.0625,end),'Edit windows need increasing positions inside the score');
      return {from,to};
    }
    const roles=Object.fromEntries(Object.entries(score.arrangement.parts).map(([name,row])=>[name,row.role]));
    const names=Object.keys(score.tracks), supplied=locks.tracks ?? {};
    check(record(supplied) && Object.entries(supplied).every(([name,mode])=>names.includes(name) &&
      (mode==='all' || mode==='pitch' && roles[name]!=='percussion')), 'Choose named track locks using all or pitch');
    const tracks={...supplied};
    for (const name of Object.keys(P.musicComposer.locks(score.arrangement))) if (names.includes(name)) tracks[name]='all';
    const rawRegions=locks.regions ?? [];
    check(Array.isArray(rawRegions) && rawRegions.length<=16,'Choose up to sixteen protected regions');
    const regions=Array.from(rawRegions,row=>{
      check(fields(row,['id','from','to']) && id(row.id),'A protected region needs an ID and a range');
      return {id:row.id,...window(row)};
    }).sort((a,b)=>a.from-b.from);
    check(new Set(regions.map(row=>row.id)).size===regions.length,'Protected region IDs must be unique');
    const span=window(range);
    const editable=subtract(span,regions);
    check(editable.length,'The locks cover the entire edit range');
    const clock=beat=>score.clock.timeAt({beat});
    return {source,score,roles,names,range:span,locks:{tracks,regions},fade,windows:editable.map(({from,to})=>
      ({from,to,start:clock(from),end:clock(to)})),clock};
  }
  function subtract({from,to},blocks) {
    let at=from;
    const result=[];
    for (const row of blocks) {
      if (row.to<=at || row.from>=to) continue;
      if (row.from>at) result.push({from:at,to:row.from});
      at=Math.max(at,row.to);
    }
    if (at<to) result.push({from:at,to});
    return result;
  }
  const inEdit=(ctx,beat)=>ctx.windows.some(row=>inside(beat,row.from,row.to));
  const outside=(rows,ctx)=>rows.filter(row=>!inEdit(ctx,row.beat)).map(row=>
    [row.beat,row.time,row.midi,row.frequency,row.velocity,row.clip,row.voice,row.note,row.play]);
  const pitches=rows=>rows.map(row=>[row.beat,row.midi,row.clip,row.voice,row.note]);
  function localLanes(cue,name) {
    const row=cue?.perTrack[name];
    return row?.room.length || row?.level.length || row?.cuts.length ? [row.room,row.level,row.cuts] : [];
  }
  function validate(ctx,production,assets) {
    check(same(ctx.source.room,production.room) && same(ctx.source.gain,production.gain) &&
      same(ctx.source.seed,production.seed),'The edited production changed the shared mix or seed');
    const next=A.compile(production,assets), base=ctx.score;
    const shape=score=>score.arrangement.sections.map(({id,beat,end})=>[id,beat,end]);
    check(same(shape(base),shape(next)) && same(base.arrangement.score.tempoMap,next.arrangement.score.tempoMap) &&
      base.end===next.end,'A locked edit must share the original score clock');
    for (const name of ctx.names) {
      const before=base.events[name], after=next.events[name];
      check(after && same(outside(before,ctx),outside(after,ctx)),'The edit changes attacks outside its range on '+name);
      const mode=ctx.locks.tracks[name];
      if (mode==='pitch') check(same(pitches(before),pitches(after)),'The edit changes pinned pitches on '+name);
      if (mode==='all') {
        const a=ctx.source.tracks[name], b=production.tracks[name];
        check(same(a,b) && same(ctx.source.patches[a.patch],production.patches[b.patch]) && same(before,after) &&
          same(localLanes(base.cue,name),localLanes(next.cue,name)),'The edit changes locked performance on '+name);
        const key=base.tracks[name].mix.duck?.from;
        check(!key || same(base.events[key],next.events[key]),'The edit changes a sidechain driving locked track '+name);
      }
    }
    for (const [name,rows] of Object.entries(next.events)) if (!ctx.names.includes(name))
      check(!outside(rows,ctx).length,'An added voice extends outside the edit range on '+name);
    const oldChords=base.program.events, newChords=next.program.events;
    const at=(rows,time)=>rows.findLast(row=>row.time<=time+eps)?.harmony;
    const spec=(score,name)=>score.arrangement.score.harmonies[name];
    const times=new Set([0,...oldChords.map(row=>row.time),...newChords.map(row=>row.time),
      ...ctx.windows.flatMap(row=>[row.start,row.end])]);
    for (const time of times) if (!ctx.windows.some(row=>time>=row.start-eps && time<row.end-eps)) {
      const a=at(oldChords,time),b=at(newChords,time);
      check(a===b && same(spec(base,a),spec(next,b)),'The edit changes harmony outside its range');
    }
    return next;
  }

  function keep(value,key) {
    check(value?.format===searchFormat && value.version===1 && record(value.source) && id(key) &&
      Array.isArray(value.candidates),'Choose a winner from a locked arrangement search');
    const found=value.candidates.find(row=>row.id===key);
    check(found && record(found.production),'Unknown locked arrangement take '+key);
    const {source,report:{range,locks,fade}}=value;
    return P.data.freeze({format,version:1,id:key,source,production:found.production,range,locks,fade});
  }

  function render(edit,assets={},options={}) {
    check(fields(edit,['format','version','id','source','production','range','locks','fade']) &&
      edit.format===format && edit.version===1 && id(edit.id),'Expected a saved locked arrangement edit');
    const base=A.compile(edit.source,assets), ctx=context(edit.source,base,edit);
    const next=validate(ctx,edit.production,assets), {sampleRate:rate=48000,stems=false,layers}=options;
    check(layers===undefined || record(layers) && Object.entries(layers)
      .every(([name,level])=>Object.hasOwn(next.tracks,name) && finite(level,0,1)), 'Use known arranged track levels');
    const originalLayers=layers && Object.fromEntries(Object.entries(layers).filter(([name])=>Object.hasOwn(base.tracks,name)));
    const original=A.renderCompiled(base,{...options,layers:originalLayers});
    const first=original.report.firstSample, last=original.report.endSample;
    const spans=ctx.windows.map(({start,end})=>({from:sample(start,rate),to:sample(end,rate),start,end}))
      .filter(row=>row.to>first && row.from<last);
    const tracks=original.stems, size=original.value.samples.length;
    if (stems) for (const name of Object.keys(next.tracks)) if (!Object.hasOwn(tracks,name))
      tracks[name]={sampleRate:rate,channels:2,samples:new Float32Array(size)};
    let changed=0;
    for (const row of spans) {
      const left=Math.max(first,row.from),right=Math.min(last,row.to);
      const from=Math.max(options.start ?? 0,row.start), to=Math.min(options.end ?? next.end,row.end);
      if (right<=left || to<=from) continue;
      const replacement=A.renderCompiled(next,{start:from,end:to,sampleRate:rate,stems,layers},
        false,options.end ?? next.end);
      const offset=replacement.report.firstSample, edge=Math.min(Math.round(ctx.fade*rate),Math.floor((row.to-row.from-1)/2));
      const pairs=[[original.value.samples,replacement.value.samples],...Object.entries(tracks).flatMap(([name,pcm])=>
        ctx.locks.tracks[name]==='all' ? [] : [[pcm.samples,replacement.stems[name]?.samples]])];
      for (let frame=left;frame<right;frame++) {
        const i=(frame-first)*2,j=(frame-offset)*2;
        const weight=edge ? Math.min(1,(frame-row.from)/edge,(row.to-1-frame)/edge) : 1;
        for (const [a,b] of pairs) {
          const l=a[i],r=a[i+1];
          a[i]=l+((b?.[j] ?? 0)-l)*weight;
          a[i+1]=r+((b?.[j+1] ?? 0)-r)*weight;
        }
      }
      changed+=right-left;
    }
    const {peak,rms}=A.meters(original.value);
    let clipped=0;
    for (let i=0;i<size;i+=2) if (Math.max(Math.abs(original.value.samples[i]),Math.abs(original.value.samples[i+1]))>1) clipped++;
    return {...original,report:{...original.report,peak,rms,clipped,edit:{id:edit.id,range:ctx.range,
      locks:ctx.locks,spans,replacementSamples:changed,preservedSamples:size/2-changed}}};
  }

  P.musicArrangementLocks=Object.freeze({context,validate,keep,render,searchFormat,subtract,inEdit,round,same});
})(KIT.procedural);
