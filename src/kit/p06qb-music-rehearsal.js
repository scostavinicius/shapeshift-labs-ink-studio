/* Rehearse identical performances across scoped transition-matrix edits. */
(function (P) {
  const A=P.musicProduction, L=P.musicTimeline, Q=P.adaptiveRehearsalTrace, E=P.adaptiveRehearsalEvidence;
  const {fields,finite,integer,id,check,record}=P.musicInstruments;
  const frozen=value=>P.data.freeze(P.data.clone(value));
  const format='ink-studio/adaptive-score-rehearsal';
  const edgeKey=row=>row.from+'>'+row.to;

  function revise(sources,timeline,revision,assets={}) {
    check(record(sources) && record(timeline?.segments) &&
      fields(revision,['id','note','transitions','segments','stingers','stingerRules','productions','performers','phrasing']) &&
      (revision.id===undefined || id(revision.id)) &&
      (revision.note===undefined || typeof revision.note==='string' && revision.note.length<=640) &&
      Array.isArray(revision.transitions ?? []) && (revision.transitions?.length ?? 0)<=64 &&
      Array.isArray(revision.stingerRules ?? []) && (revision.stingerRules?.length ?? 0)<=64 &&
      ['segments','stingers','productions'].every(key=>record(revision[key] ?? {}) &&
        Object.keys(revision[key] ?? {}).length<=64 && Object.keys(revision[key] ?? {}).every(id)),
    'Invalid adaptive rehearsal revision');
    const patches=revision.transitions ?? [], markerFields=['exit','entry','bridge','pickup','tail','fadeIn','commonTone'];
    check(Array.from(patches).every(row=>fields(row,['from','to',...markerFields]) && id(row.from) && id(row.to) &&
      Object.hasOwn(timeline.segments,row.from) && Object.hasOwn(timeline.segments,row.to)) &&
      new Set(patches.map(edgeKey)).size===patches.length,'Transition revisions need distinct named edges');
    const edges=new Map((timeline.transitions ?? []).map(row=>[edgeKey(row),row]));
    for (const patch of patches) {
      const row={...edges.get(edgeKey(patch)),...patch};
      for (const field of markerFields) if (row[field]===null) delete row[field];
      edges.set(edgeKey(row),row);
    }
    const segments={...timeline.segments};
    for (const [key,patch] of Object.entries(revision.segments ?? {})) {
      check(record(patch),'A segment revision needs segment fields');
      segments[key]={...segments[key],...patch};
    }
    const stingers={...timeline.stingers};
    for (const [resource,segment] of Object.entries(revision.stingers ?? {})) {
      if (segment===null) delete stingers[resource];
      else stingers[resource]=segment;
    }
    const stingerRules=[...(timeline.stingerRules ?? []).filter(row=>revision.stingers?.[row.resource]!==null),
      ...revision.stingerRules ?? []];
    const next={...sources};
    for (const [name,patch] of Object.entries(revision.productions ?? {})) {
      check(Object.hasOwn(sources,name),'Unknown rehearsal production source');
      next[name]=A.revise(sources[name],patch,assets);
    }
    const updated={...timeline,segments,transitions:[...edges.values()],stingers,stingerRules};
    for (const key of ['performers','phrasing']) {
      if (revision[key]===null) delete updated[key];
      else if (revision[key]!==undefined) updated[key]=revision[key];
    }
    L.schedule(next,updated,[],assets);
    return frozen({sources:next,timeline:updated});
  }

  function matrix(timeline,reports) {
    const rows=new Map((timeline.transitions ?? []).map(row=>[edgeKey(row),
      {from:row.from,to:row.to,authored:true,count:0,pending:0,cancelled:0,worst:null}]));
    const get=(from,to)=>{
      const key=edgeKey({from,to});
      if (!rows.has(key)) rows.set(key,{from,to,authored:false,count:0,pending:0,cancelled:0,worst:null});
      return rows.get(key);
    };
    for (const report of reports) {
      for (const join of report.cases) if (join.kind==='transition') {
        const edge=get(join.from,join.to);
        edge.count++;
        if (!edge.worst || join.priority>edge.worst.priority)
          edge.worst={trace:report.id,id:join.id,time:join.time,priority:join.priority,
            issues:join.issues.map(row=>row.kind)};
      }
      for (const request of report.requests) if (request.outcome!=='committed')
        get(request.from,request.to)[request.outcome]++;
    }
    return [...rows.values()];
  }

  function run(sources,timeline,rawTraces,variants=[],assets={},options={},host) {
    check(fields(options,['sampleRate','before','after','radius','watchTracks','target','ceiling','limit','cases','world']) &&
      Array.isArray(rawTraces) && integer(rawTraces.length,1,12) && Array.isArray(variants) && variants.length<=5 &&
      Array.from(variants).every(row=>record(row) && id(row.id) && row.id!=='reference') &&
      new Set(variants.map(row=>row.id)).size===variants.length &&
      integer(options.sampleRate ?? 24000,8000,48000) && finite(options.before ?? 1,0,8) &&
      finite(options.after ?? 1.5,.15,8) && finite(options.radius ?? .18,.025,.75) &&
      finite(options.target ?? -18,-35,-9) && finite(options.ceiling ?? -1.2,-8,-.1) &&
      integer(options.limit ?? 12,1,24) &&
      Array.isArray(options.watchTracks ?? []) && (options.watchTracks?.length ?? 0)<=8 &&
      Array.from(options.watchTracks ?? []).every(id) &&
      new Set(options.watchTracks ?? []).size===(options.watchTracks?.length ?? 0) &&
      (options.world===undefined || fields(options.world,['rhythms','space'])),
    'Invalid adaptive rehearsal request');
    const {sampleRate=24000,before=1,after=1.5,radius=.18,target=-18,ceiling=-1.2,limit=12}=options;
    const traces=Array.from(rawTraces,Q.validate);
    check(new Set(traces.map(row=>row.id)).size===traces.length &&
      traces.every(row=>row.entry===timeline?.entry &&
        row.intents.length+row.requests.length+row.worldEvents.length<=1024) &&
      traces.reduce((total,row)=>total+Math.ceil(row.end*sampleRate),0)*(variants.length+1)<=14e6,
    'Rehearsal traces must share the entry and fit the event and audio budgets');
    const watchTracks=options.watchTracks ?? [...new Set(Object.values(sources).flatMap(source=>{
      const arrangement=source.arrangement?.definition ?? source.arrangement;
      return Object.keys(source.tracks ?? {}).filter(name=>arrangement?.parts?.[name]?.role==='lead');
    }))].slice(0,8);
    const versions=[{id:'reference',sources,timeline},...variants.map(revision=>
      ({id:revision.id,note:revision.note ?? null,...revise(sources,timeline,revision,assets)}))];
    const passes=versions.map(version=>({id:version.id,note:version.note,
      traces:traces.map(trace=>{
        const spec={...version.timeline,end:trace.end};
        const scheduled=L.schedule(version.sources,spec,trace.intents,assets,host);
        const result=L.renderScheduled(scheduled,spec,{sampleRate,
          ...(options.world && {world:{...options.world,events:trace.worldEvents}})});
        return {value:result.value,report:E.observe(trace,scheduled,result,{watchTracks,radius})};
      })}));
    const reports=passes[0].traces.map(row=>row.report);
    const weakness=reports.flatMap(row=>row.cases.map(join=>{
      const {id,kind,time,priority,issues}=join;
      return {trace:row.id,id,kind,time,priority,issues};
    })).sort((a,b)=>b.priority-a.priority || a.trace.localeCompare(b.trace) || a.time-b.time);
    const selected=options.cases ?? weakness.slice(0,limit).map(({trace,id})=>({trace,id}));
    check(Array.isArray(selected) && selected.length<=24 && Array.from(selected).every(row=>
      fields(row,['trace','id']) && id(row.trace) && id(row.id)) &&
      new Set(selected.map(row=>row.trace+':'+row.id)).size===selected.length &&
      selected.length*(variants.length+1)*(before+after)*sampleRate<=8e6,
    'Select distinct rehearsal cases within the audition budget');
    const audio={}, listening=Array.from(selected,selection=>{
      const index=traces.findIndex(row=>row.id===selection.trace);
      const baseline=reports[index]?.cases.find(row=>row.id===selection.id);
      check(baseline,'Unknown rehearsal case '+selection.trace+'/'+selection.id);
      const start=Math.max(0,baseline.time-before), end=Math.min(traces[index].end,baseline.time+after);
      const first=E.sample(start,sampleRate), stop=E.sample(end,sampleRate);
      check(stop>first,'Listening window needs at least one sample');
      const samples=passes.map(pass=>{
        const wave=pass.traces[index].value;
        return {...wave,samples:wave.samples.slice(2*first,2*stop)};
      });
      const clips=E.matched(samples,target,ceiling);
      const key=selection.trace+':'+selection.id;
      audio[key]=Object.fromEntries(clips.map((row,i)=>[passes[i].id,row.value]));
      return {...selection,kind:baseline.kind,time:baseline.time,sampleRate,firstSample:first,endSample:stop,
        start:first/sampleRate,end:stop/sampleRate,
        takes:passes.map((pass,i)=>{
          const {value,report}=pass.traces[index];
          const join=report.cases.find(row=>row.id===selection.id && Math.abs(row.time-baseline.time)<1e-8);
          const nearby=report.cases.filter(row=>row.time>=start && row.time<end)
            .map(({id,kind,time,priority})=>({id,kind,time,priority}));
          return {id:pass.id,playback:clips[i].playback,join:join ?? null,
            nearby,audio:join?.audio ?? E.audioEvidence(value,baseline.time)};
        })};
    });
    return {report:frozen({format,version:1,sampleRate,watchTracks,traces:reports,matrix:matrix(timeline,reports),
      weakest:weakness.slice(0,limit),listening,variants:passes.slice(1).map(pass=>({id:pass.id,note:pass.note,
        traces:pass.traces.map(({report})=>({id:report.id,peak:report.peak,rms:report.rms,
          dwells:report.dwells,cases:report.cases.length,flagged:report.cases.filter(row=>row.priority>0).length}))}))}),audio};
  }

  const rehearsal=Object.freeze({capture:Q.captureWorld,captureScore:Q.captureScore,validateTrace:Q.validate,revise,run});
  P.musicProduction=Object.freeze({...A,rehearsal});
})(KIT.procedural);
