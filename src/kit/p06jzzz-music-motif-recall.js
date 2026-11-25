/* Keep played versions distinct and realize their musical shape on a new part. */
(function(P){
  const {check,fields,record,finite,integer,id,hash}=P.musicInstruments, H=P.musicHarmony;
  const eps=1e-8, round=n=>Number(n.toFixed(9));
  const noteKey=(part,time,midi)=>JSON.stringify([part,time,midi]);

  function compile(raw,vocabulary,known){
    check(record(raw)&&Object.keys(raw).length<=64,'Invalid motif recall table');
    return new Map(Object.entries(raw).map(([segment,row])=>{
      check(known(segment)&&fields(row,['theme','part','preserve','offset','length','spacing','anchor','minNotes','level'])&&
        Object.hasOwn(vocabulary,row.theme)&&id(row.part),'A motif recall needs a mapped theme, destination and part');
      const {theme,part,preserve='both',offset=0,length=4,spacing=.5,anchor,minNotes=3,level=.8}=row;
      check(['both','rhythm','intervals'].includes(preserve)&&finite(offset,0,64)&&finite(length,.125,16)&&
        finite(spacing,.125,4)&&integer(minNotes,2,64)&&finite(level,.05,1),'Invalid motif recall settings');
      return [segment,{theme,part,preserve,offset,length,spacing,minNotes,level,
        ...(anchor!==undefined&&{anchor:H.midi(anchor)})}];
    }));
  }

  function history(indexes,compiled,themes){
    const catalog=new Map(), visits=new Map(), retained=new Map(), waiting=[];
    for(const [source,hits] of indexes){
      const list=hits.filter(hit=>themes.has(hit.theme)).sort((a,b)=>a.onset-b.onset), lookup=new Map();
      for(const hit of list){
        const key=noteKey(hit.part,hit.time,hit.midi);
        if(!lookup.has(key))lookup.set(key,[]);
        lookup.get(key).push(hit);
      }
      catalog.set(source,{list,lookup});
    }
    const rank=(a,b)=>b.last-a.last||b.notes.length-a.notes.length||a.order-b.order;
    let order=0;
    function recordHits(source,segment,visit,hits,on,local,off){
      const score=compiled[source], beat=round(score.clock.sample(local).beat);
      const gate=round(Math.max(.012,score.clock.sample(Math.max(local,off)).beat-beat));
      if(!visits.has(visit))visits.set(visit,new Map());
      const lanes=visits.get(visit);
      for(const hit of hits){
        const key=JSON.stringify([source,hit.appearance,hit.part]), {theme,appearance,part}=hit;
        if(!lanes.has(key))lanes.set(key,{theme,source,segment,appearance,part,
          pitched:score.arrangement.parts[part].role!=='percussion',total:hit.count,order:++order,
          last:on,first:on,notes:[],ids:new Set()});
        const row=lanes.get(key);
        if(row.ids.has(hit.note))continue;
        row.ids.add(hit.note);
        row.notes.push({id:hit.note,midi:hit.midi,beat,gate,velocity:hit.velocity});
        row.last=on;
        if(!retained.has(theme))retained.set(theme,new Map());
        const options=retained.get(theme), slot=row.pitched+':'+row.notes.length, previous=options.get(slot);
        if(!previous||rank(row,previous)<0)options.set(slot,row);
      }
    }
    function describe(row){
      const first=row.notes[0].beat;
      return {source:row.source,segment:row.segment,appearance:row.appearance,part:row.part,
        first:row.first,last:row.last,complete:row.notes.length===row.total,pitched:row.pitched,
        notes:row.notes.map(({beat,...note})=>({...note,beat:round(Math.max(0,beat-first))}))};
    }
    function find(theme,minNotes,pitched){
      const choices=retained.get(theme);
      return choices&&[...new Set(choices.values())].filter(row=>row.notes.length>=minNotes&&(!pitched||row.pitched)).sort(rank)[0];
    }
    function schedule(placement,end){
      const {source,segment,from,to,at,layers,gain}=placement, list=catalog.get(source)?.list;
      if(!list?.length||!gain)return;
      let low=0,high=list.length;
      while(low<high){
        const mid=(low+high)>>>1;
        if(list[mid].onset<from-eps)low=mid+1;else high=mid;
      }
      const visit={};
      let last;
      for(let i=low;i<list.length&&list[i].onset<to-eps;i++){
        const hit=list[i], on=round(at+Math.max(0,hit.onset-from));
        if(layers[hit.part]===0||on>=end)continue;
        check(waiting.length<65536,'Motif memory exceeds its pending onset budget');
        last={source,segment,visit,hit,on,off:Math.min(hit.off,to)};
        waiting.push(last);
      }
      if(last)last.finish=true;
    }
    function advance(time){
      if(!waiting.length)return;
      waiting.sort((a,b)=>a.on-b.on);
      let n=0;
      for(;n<waiting.length&&waiting[n].on<time-eps;n++){
        const {source,segment,visit,hit,on,off,finish}=waiting[n];
        recordHits(source,segment,visit,[hit],on,hit.onset,off);
        if(finish)visits.delete(visit);
      }
      if(n)waiting.splice(0,n);
    }
    return {
      schedule,advance,record:recordHits,
      matches(source,part,note){return catalog.get(source)?.lookup.get(noteKey(part,note.time,note.midi));},
      finish(visit){visits.delete(visit);},
      select({theme,minNotes,preserve}){const row=find(theme,minNotes,preserve!=='rhythm');return row?describe(row):null;},
      inspect(){return Object.fromEntries([...themes].map(theme=>{const row=find(theme,1,false);return [theme,row?describe(row):null];}));}
    };
  }

  function realize(config,version,score,entry,stop,layers={}){
    const {theme,part,preserve,offset,length,spacing,level}=config;
    const skipped=reason=>({report:{theme,part,preserve,status:reason,...(version&&{version})},notes:[]});
    if(!version)return skipped('unheard');
    if(layers[part]===0)return skipped('muted');
    const {clock}=score, beginning=clock.sample(entry).beat+offset, available=Math.min(length,clock.sample(stop).beat-beginning);
    if(available<.125-eps)return skipped('no-room');
    const straight=preserve==='intervals', marks=version.notes.map(({beat},i)=>straight?i*spacing:beat);
    const gates=version.notes.map(({gate},i)=>{
      const gap=marks[i+1]-marks[i];
      return Math.min(gate,gap>eps?gap*.88:straight?spacing*.86:1,1);
    });
    const total=Math.max(...marks.map((beat,i)=>beat+gates[i])), fit=Math.min(1,available/total);
    if(fit*Math.min(...gates)<.012-eps)return skipped('no-room');
    const chord=score.program.events.findLast(row=>row.time<=clock.timeAt({beat:beginning})+eps);
    const percussion=score.arrangement.parts[part].role==='percussion';
    const root=percussion?(score.events[part][0]?.midi??36):H.midi(chord?.root??score.arrangement.score.key?.root??'C4');
    const anchor=config.anchor??root, base=version.notes[0].midi;
    const pitches=version.notes.map(({midi})=>anchor+(preserve==='rhythm'?0:midi-base));
    if(pitches.some(midi=>!integer(midi,0,127)))return skipped('pitch-range');
    const notes=version.notes.map(({id,velocity},i)=>{
      const beat=round(beginning+marks[i]*fit), time=round(clock.timeAt({beat}));
      const end=clock.timeAt({beat:beginning+(marks[i]+gates[i])*fit}), midi=pitches[i];
      return {part,beat,time,gate:round(Math.max(.001,end-time)),midi,velocity:Math.min(1,velocity*level),
        frequency:score.program.chordPitch(midi,time),play:{},roundRobin:i,salt:hash([theme,version.appearance,part,id,beat,midi])};
    });
    const first=notes[0].time, end=Math.max(...notes.map(note=>note.time+note.gate));
    if(score.events[part].some(note=>note.velocity>0&&(note.start??note.time)<end-eps&&
      Math.min(note.time+note.gate,note.choke??Infinity)>first+eps)||
      score.cue?.perTrack[part]?.cuts.some(row=>row.startTime<end-eps&&row.endTime>first+eps))
      return skipped('occupied');
    return {notes,report:{theme,part,preserve,status:'scheduled',version,notes:notes.map(({beat,time,midi,gate})=>({beat,time,midi,gate}))}};
  }

  function additions(clip,other){
    const added=clip.recallNotes;
    if(!added)return other;
    const part=clip.recall.part;
    return {...other,[part]:[...(other?.[part]??[]),...added]};
  }

  P.musicMotifRecall=Object.freeze({compile,history,realize,additions});
})(KIT.procedural);
