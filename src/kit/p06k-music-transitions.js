/* Map quantized adaptive-score intents onto playable production windows. */
(function (P) {
  const A=P.musicProduction, I=P.musicInstruments, T=P.takeTime, F=P.musicPhraseRoutes, R=P.musicMotifRecall;
  const {record,fields,finite,integer,id,check,clamp,db}=I;
  const sample=(time,rate)=>T.index(T.roundDown(T.mul(T.read(time),[BigInt(rate),1n])));
  const numeric=(value,lo,hi,label)=>{
    check(finite(value,lo,hi),'Invalid transition '+label);
    return value;
  };
  function compileCadences(value,segments,phrases) {
    check(Array.isArray(value) && integer(value.length,1,8),'Choose one to eight authored cadence variants');
    const ids=new Set();
    return Array.from(value,row=>{
      check(fields(row,['id','segment','when']) && id(row.id) && !ids.has(row.id) && id(row.segment) &&
        Object.hasOwn(segments,row.segment) && fields(row.when ?? {},['phase','minDwell','phrase']),
      'Cadences need unique IDs, known segments and optional phrase conditions');
      const {phase=[0,1],minDwell=0,phrase}=row.when ?? {};
      check(Array.isArray(phase) && phase.length===2 && finite(phase[0],0,1) && finite(phase[1],0,1) &&
        phase[1]>phase[0] && finite(minDwell,0,3600) && (phrase===undefined || phrases.includes(phrase)),
      'Invalid cadence phrase, phase or dwell condition');
      ids.add(row.id);
      const {start,end}=segments[row.segment];
      return {id:row.id,segment:row.segment,duration:end-start,phase:phase.slice(),minDwell,phrase};
    });
  }
  function prepare(sources,spec,assets,host,bank,liveResources,offlineStreams) {
    const live=liveResources!==undefined;
    check(record(sources) && Object.keys(sources).length<=32 && Object.keys(sources).every(id) &&
      fields(spec,['entry','segments','transitions','stingers','stingerRules','end','thematic','phrasing','performers','scoring']) && record(spec.segments) &&
      Object.keys(spec.segments).length<=64 && Object.keys(spec.segments).every(id),'Invalid production timeline');
    check(spec.scoring===undefined || live,'Render live scoring cue rules with music live replay');
    const end=live ? Infinity : numeric(spec.end,.001,300,'end'), compiled=Object.create(null);
    const load=name=>{
      check(Object.hasOwn(sources,name),'Unknown production source');
      if (!bank.has(name)) bank.set(name,A.compile(sources[name],assets,host));
      return compiled[name]=bank.get(name);
    };
    const segments=Object.fromEntries(Object.entries(spec.segments).map(([name,raw])=>{
      check(fields(raw,['source','start','end','loop','layers','gain']) && Object.hasOwn(sources,raw.source),
        'Transition segment must name a production source');
      const cue=load(raw.source);
      const at=(value,fallback)=>P.musicTiming.isPosition(value) ? cue.clock.timeAt(value) : value ?? fallback;
      const start=numeric(at(raw.start,0),0,cue.end,'segment start');
      const end=numeric(at(raw.end,cue.end),start+.001,cue.end,'segment end');
      const {loop=true,layers={}}=raw;
      check(typeof loop==='boolean' && record(layers) && Object.keys(layers).every(key=>
        Object.hasOwn(cue.tracks,key) && finite(layers[key],0,1)),'Invalid transition layer levels');
      return [name,{source:raw.source,start,end,loop,layers,gain:db(numeric(raw.gain ?? 0,-60,12,'segment gain'))}];
    }));
    const known=name=>id(name) && Object.hasOwn(segments,name);
    const position=(segment,value,fallback)=>{
      const cue=compiled[segments[segment].source];
      return P.musicTiming.isPosition(value) ? cue.clock.timeAt(value) : value ?? fallback;
    };
    check(known(spec.entry),'Transition entry must name a segment');
    const thematic=spec.thematic;
    let memory;
    let recalls=new Map();
    const routes=new Map();
    if (thematic!==undefined) {
      check(fields(thematic,['maps','routes','recalls']) && record(thematic.maps) && record(thematic.routes ?? {}) &&
        record(thematic.recalls ?? {}) && Object.keys(thematic.recalls ?? {}).length<=64 &&
        Object.keys(thematic.maps).length<=32 && Object.keys(thematic.routes ?? {}).length<=64,'Invalid thematic timeline');
      for (const name of Object.keys(thematic.maps)) load(name);
      const themes=new Set(Object.values(thematic.recalls ?? {}).map(row=>row?.theme));
      memory=P.musicThemes.createHistory(thematic.maps,end,compiled,live,themes);
      const vocabulary=memory.at(0);
      recalls=R.compile(thematic.recalls ?? {},vocabulary,known);
      for (const [segment,choices] of Object.entries(thematic.routes ?? {})) {
        check(known(segment) && Array.isArray(choices) && choices.length>=1 && choices.length<=8,'Invalid thematic route');
        const base=compiled[segments[segment].source];
        const parsed=Array.from(choices,row=>{
          check(fields(row,['source','when']) && Object.hasOwn(thematic.maps,row.source) &&
            fields(row.when,['theme','stage','min']) && Object.hasOwn(vocabulary,row.when.theme) &&
            P.musicThemes.stages.includes(row.when.stage) && integer(row.when.min ?? 1,1,4096),
            'A thematic route needs a mapped source and listening requirement');
          const variant=load(row.source);
          check(F.sharesGrid(variant,base) &&
            Object.keys(base.tracks).every(track=>Object.hasOwn(variant.tracks,track)),
            'Thematic alternatives must share the segment grid and tracks');
          return row;
        });
        routes.set(segment,parsed);
      }
    }
    const phrasing=live || spec.phrasing!==undefined ? F.create(spec.phrasing===undefined ? {} : spec.phrasing,segments,load,end,live) : null;
    for(const [segment,recall] of recalls){
      const names=[segments[segment].source,...(routes.get(segment)??[]).map(row=>row.source),
        ...(spec.phrasing?.routes?.[segment]??[]).map(row=>row.source)];
      check(names.every(name=>Object.hasOwn(compiled[name].tracks,recall.part)&&
        !compiled[name].tracks[recall.part].pad&&
        (recall.preserve==='rhythm'||compiled[name].arrangement.parts[recall.part].role!=='percussion')),
      'Every destination phrase needs the motif recall part, with a pitched track for intervals');
    }
    const edges=spec.transitions ?? [], stingers=spec.stingers ?? {};
    check(Array.isArray(edges) && edges.length<=128 && record(stingers) && Object.keys(stingers).length<=128 &&
      Object.entries(stingers).every(([key,value])=>id(key) && known(value)),'Invalid transition or stinger table');
    const holds=spec.stingerRules ?? [];
    check(Array.isArray(holds) && holds.length<=128 && Array.from(holds).every(row=>
      fields(row,['resource','section','linked']) && (Object.hasOwn(stingers,row.resource) || (liveResources ?? offlineStreams)?.has(row.resource)) && known(row.section) &&
      (row.linked===undefined || typeof row.linked==='boolean')),
    'Stinger rules need a mapped resource and a section in which to withhold it');
    const rules=new Map();
    for (const edge of edges) {
      check(fields(edge,['from','to','exit','entry','tail','fadeIn','bridge','pickup','commonTone','switchPoints','harmonicBridge','cadences']) && known(edge.from) &&
        known(edge.to) && (edge.bridge===undefined || known(edge.bridge)),'Invalid music transition edge');
      const key=edge.from+'>'+edge.to;
      check(!rules.has(key),'Duplicate music transition edge');
      const from=segments[edge.from], to=segments[edge.to];
      const fadeIn=numeric(edge.fadeIn ?? 0,0,4,'fade in');
      if (edge.switchPoints!==undefined) {
        check(live,'Render matched performance switch points with music live replay');
        check(fields(edge,['from','to','switchPoints','fadeIn']) && edge.from!==edge.to && from.source!==to.source &&
          from.start===to.start && from.end===to.end && from.loop===to.loop &&
          F.sharesGrid(compiled[from.source],compiled[to.source]),
        'Matched performances need distinct sources on the same score grid and playback window');
        check(record(edge.switchPoints) && integer(Object.keys(edge.switchPoints).length,1,32),
          'Name up to 32 matched performance switch points');
        const switchPoints=Object.entries(edge.switchPoints).map(([idValue,at])=>{
          check(id(idValue) && at!==undefined && at!==null,'Invalid matched performance switch point');
          return {id:idValue,position:numeric(position(edge.from,at),from.start,from.end-.001,'switch point')};
        }).sort((a,b)=>a.position-b.position);
        check(new Set(switchPoints.map(point=>point.position)).size===switchPoints.length,
          'Matched performance switch points must have distinct positions');
        rules.set(key,{switchPoints,waitForExit:true,fadeIn,tail:0,pickup:0});
        continue;
      }
      const exit=numeric(position(edge.from,edge.exit,from.end),from.start+.001,from.end,'exit marker');
      const entry=numeric(position(edge.to,edge.entry,to.start),to.start,to.end-.001,'entry marker');
      const tail=numeric(edge.tail ?? 0,0,4,'tail');
      const pickup=numeric(edge.pickup ?? 0,0,4,'pickup');
      check(!pickup || edge.bridge,'A pickup requires a transition bridge');
      const tone=edge.commonTone;
      if (tone!==undefined) {
        check(fields(tone,['segment','pickup']) && known(tone.segment),'A common tone needs an authored segment');
        const clip=segments[tone.segment];
        numeric(tone.pickup ?? 0,0,Math.min(4,clip.end-clip.start-.001),'common tone pickup');
      }
      let cadences,harmonicBridge;
      if (edge.cadences!==undefined) {
        check(live,'Render branch cadences with music live replay');
        check(edge.from!==edge.to && edge.exit!==undefined && edge.exit!==null && edge.bridge===undefined &&
          edge.harmonicBridge===undefined,'Cadences need a distinct edge with an exit marker and no other bridge');
        const phrases=[edge.from,...(spec.phrasing?.routes?.[edge.from] ?? []).map(row=>row.id)];
        cadences=compileCadences(edge.cadences,segments,phrases);
      }
      if (edge.harmonicBridge!==undefined) {
        check(live,'Render a harmonic bridge with music live replay');
        check(!edge.bridge && !tone && edge.from!==edge.to,'Use a harmonic bridge on a distinct edge without an authored pickup');
        harmonicBridge=P.musicHarmonicBridge.compile(edge.harmonicBridge);
        const variants=[to.source,...(routes.get(edge.to) ?? []).map(row=>row.source),
          ...(spec.phrasing?.routes?.[edge.to] ?? []).map(row=>row.source)];
        check(variants.every(source=>Object.hasOwn(compiled[source].tracks,harmonicBridge.track) &&
          compiled[source].arrangement.parts[harmonicBridge.track].role!=='percussion'),
        'Every destination phrase needs the harmonic bridge pitched track');
      }
      rules.set(key,{exit,entry,tail,fadeIn,bridge:edge.bridge,pickup,commonTone:tone,
        ...(cadences && {cadences}),...(harmonicBridge && {harmonicBridge}),...(live && {waitForExit:edge.exit!==undefined})});
    }
    if (id(spec.performers?.roomSource)) load(spec.performers.roomSource);
    return {compiled,segments,end,known,memory,routes,recalls,phrasing,stingers,holds,rules};
  }

  function schedule(sources,spec,intents=[],assets={},host,bank=new Map(),evidence) {
    check(Array.isArray(intents) && intents.length<=(evidence ? 8192 : 2048),'Invalid production timeline');
    const {compiled,segments,end,known,memory,routes,recalls,phrasing,stingers,holds,rules}=
      prepare(sources,spec,assets,host,bank,undefined,evidence?.streams);
    const decisions=[];
    const eligible=intents.filter(intent=>intent?.kind==='music-transition' || intent?.kind==='music-cue');
    check(eligible.every(event=>finite(event.time,0,1e9)),'Music intents need nonnegative times');
    const events=eligible.filter(event=>event.time<end)
      .sort((a,b)=>a.time-b.time || (a.serial ?? 0)-(b.serial ?? 0));
    const placements=[], markers=[], cueDecisions=[];
    const landing=new Map(events.filter(event=>event.kind==='music-transition').map(event=>[event.time,event.to]));
    function place(name,at,from,to,{tail=0,fadeIn=0,layers={},kind='segment',source=segments[name].source,phrase,recall}={}) {
      if (to<=from+1e-8 || at>=end) return;
      check(placements.length<4096,'Music timeline exceeds its placement budget');
      const levels=Object.fromEntries(Object.entries({...segments[name].layers,...layers})
        .filter(([part])=>Object.hasOwn(compiled[source].tracks,part)));
      const placement={segment:name,source,at,from,to,tail,
        fadeIn,layers:levels,gain:segments[name].gain,kind,...(phrase && {phrase})};
      if(recall&&!recall.used){
        recall.used=true;
        const result=R.realize(recall.config,recall.version,compiled[source],from,to,levels);
        placement.recall=result.report;
        if(result.notes.length)Object.defineProperty(placement,'recallNotes',{value:result.notes});
      }
      placements.push(placement);
      memory?.add(placement);
      phrasing?.remember(placement);
      return placement;
    }
    let via=[], incomingRule=null;
    function choose(name,time,reason='entry') {
      const state=memory?.at(time), choices=routes.get(name);
      const match=choices?.find(({when})=>state[when.theme].counts[when.stage]>=(when.min ?? 1));
      const source=match?.source ?? segments[name].source;
      const selected=phrasing?.choose(name,time,source,via,incomingRule,reason) ?? {source};
      if (choices) decisions.push({segment:name,time,source,matched:match?.when ?? null,history:state,
        ...(selected.source!==source && {overriddenBy:selected.phrase,playedSource:selected.source})});
      const config=reason==='entry'&&recalls.get(name);
      return config?{...selected,recall:{config,version:memory.versions.select(config),used:false}}:selected;
    }
    function playRegion(name,selection,offset,at,stop,fadeIn,layers,rule) {
      const segment=segments[name], first=placements.length, span=stop-at;
      if (span<=0) return selection;
      if (rule && rule.exit<segment.end) {
        const exit=rule.exit, finalLen=Math.min(exit-segment.start,span), lead=stop-finalLen;
        selection=playRegion(name,selection,offset,at,lead,fadeIn,layers);
        place(name,lead,exit-finalLen,exit,{...selection,tail:rule.tail,
          fadeIn:lead===at ? fadeIn : Math.min(.008,finalLen/2),layers});
        return selection;
      }
      let time=at, cursor=offset;
      while (time<stop-1e-8) {
        const duration=Math.min(stop-time,segment.end-cursor);
        place(name,time,cursor,cursor+duration,{...selection,fadeIn:time===at ? fadeIn : 0,layers});
        time+=duration;
        if (!segment.loop || duration<=1e-8) break;
        cursor=segment.start;
        if (time<stop-1e-8 && phrasing?.repeats(name)) selection=choose(name,time,'repeat');
      }
      if (rule && placements.length>first && Math.abs(time-stop)<1e-8) placements.at(-1).tail=rule.tail;
      return selection;
    }
    let name=spec.entry, start=0, offset=segments[name].start, fadeIn=0, layers={}, selection=choose(name,0);
    for (const [eventIndex,event] of events.entries()) {
      if (event.kind==='music-cue') {
        const resource=event.resource ?? event.cue;
        const clip=Object.hasOwn(stingers,resource) && stingers[resource];
        const section=landing.get(event.time) ?? name;
        const stream=evidence?.streams?.has(resource);
        const withheld=(clip || stream) && holds.some(row=>row.resource===resource && row.section===section &&
          (row.linked===undefined || row.linked===(event.transition!==undefined)));
        const decision={time:event.time,serial:event.serial ?? null,eventIndex,resource,section,
          cue:event.cue ?? resource,linked:event.transition ?? null,segment:clip || null,
          status:withheld ? 'withheld' : clip || stream ? 'played' : 'unmapped'};
        cueDecisions.push(decision);
        if (decision.status==='played' && clip) {
          const segment=segments[clip];
          const placement=place(clip,event.time,segment.start,segment.end,{kind:'stinger'});
          if (placement) evidence?.cues.set(eventIndex,placement);
        }
        continue;
      }
      check(event.from===name && known(event.to) && event.time>=start,'Adaptive intent does not follow the production timeline');
      const to=segments[event.to], from=segments[name];
      const edge=rules.get(name+'>'+event.to) ??
        {exit:from.end,entry:to.start,tail:0,fadeIn:0,pickup:0};
      const first=placements.length;
      playRegion(name,selection,offset,start,event.time,fadeIn,layers,edge);
      if (placements.length>first) evidence?.exits.set(eventIndex,placements.at(-1));
      if (edge.bridge) {
        const bridge=segments[edge.bridge], pickup=Math.min(edge.pickup,event.time-start);
        place(edge.bridge,event.time-pickup,bridge.start,bridge.end,{kind:'bridge'});
      }
      if (edge.commonTone) {
        const tone=edge.commonTone, clip=segments[tone.segment];
        const pickup=Math.min(tone.pickup ?? 0,event.time-start);
        place(tone.segment,event.time-pickup,clip.start,clip.end,{kind:'common-tone'});
      }
      markers.push({time:event.time,beat:event.beat ?? null,from:name,to:event.to,rule:event.rule ?? null,
        serial:event.serial ?? null,eventIndex,exit:edge.exit,entry:edge.entry,tail:edge.tail,fadeIn:edge.fadeIn,
        bridge:edge.bridge ?? null,pickup:edge.bridge ? Math.min(edge.pickup,event.time-start) : 0,
        commonTone:edge.commonTone ?? null});
      via=[...via.slice(-7),name]; incomingRule=event.rule ?? null;
      name=event.to; start=event.time; offset=edge.entry; fadeIn=edge.fadeIn;
      selection=choose(name,start);
      evidence?.entries.set(eventIndex,selection);
      layers=event.layers ?? {};
      check(record(layers) && Object.values(layers).every(level=>finite(level,0,1)),'Invalid adaptive intent layer levels');
    }
    playRegion(name,selection,offset,start,end,fadeIn,layers);
    placements.sort((a,b)=>a.at-b.at);
    const themes=memory && {final:memory.at(end),decisions,appearances:memory.completed(),
      ...(memory.versions&&{versions:memory.versions.inspect(),
        recalls:placements.filter(row=>row.recall).map(({segment,at,recall})=>({segment,at,...recall}))})};
    const performerSpec=spec.performers===undefined ? null : P.musicPersistentPerformers.prepare(
      spec.performers,{sources,compiled,segments,placements,entry:spec.entry});
    return {compiled,segments,placements,markers,cueDecisions,duration:end,themes,performerSpec,
      ...(phrasing && {phrasing:phrasing.report()})};
  }

  function renderScheduled(timeline,spec,options={},shared,comparison) {
    check(fields(options,['sampleRate','start','end','stems','world']),'Invalid production timeline render options');
    const {sampleRate=48000,start:beginPoint=0,end:endPoint=timeline.duration,stems=false}=options;
    const start=T.seconds(T.read(beginPoint)),end=T.seconds(T.read(endPoint));
    check(integer(sampleRate,8000,96000)&& finite(start,0,timeline.duration) &&
      finite(end,start,timeline.duration) && end>start && typeof stems==='boolean','Invalid production timeline range');
    const begin=sample(beginPoint,sampleRate),last=sample(endPoint,sampleRate),count=last-begin;
    check(count>0 && count<=16e6,'Production timeline exceeds its sample budget');
    const world=options.world===undefined ? null : P.musicWorldScore.prepare(options.world,timeline,spec,sampleRate,begin,last);
    const value={sampleRate,channels:2,samples:new Float32Array(count*2)}, buffers={}, cache=new Map();
    const envelopes=new Map(), placementEvidence=comparison && new Map();
    let cached=0, work=0;
    function add(part,stem,first,{gain:level=1,span=Infinity,fadeIn=0,tail=0,automation}={}) {
      if (!level) return;
      if (world && !envelopes.has(part)) envelopes.set(part,world.envelope(part));
      const envelope=envelopes.get(part);
      if (stems && !Object.hasOwn(buffers,part)) {
        check((Object.keys(buffers).length+2)*count*2<=36e6,'Transition stems exceed their sample budget');
        buffers[part]={sampleRate,channels:2,samples:new Float32Array(count*2)};
      }
      const dry=buffers[part]?.samples;
      const stop=Math.min(stem.samples.length/2,last-first), low=Math.max(0,begin-first);
      check((work+=stop-low)<=72e6,'Production timeline exceeds its mixing budget');
      for (let i=low;i<stop;i++) {
        let gain=level;
        if (fadeIn) gain*=Math.sin(Math.PI*.5*clamp(i/(fadeIn*sampleRate)));
        if (i>=span && tail) gain*=Math.cos(Math.PI*.5*clamp((i-span)/(tail*sampleRate)));
        if (envelope) gain*=envelope.values[i+first-envelope.first] ?? 1;
        if (automation) gain*=automation(i+first);
        const at=(i+first-begin)*2, l=stem.samples[2*i]*gain, r=stem.samples[2*i+1]*gain;
        value.samples[at]+=l; value.samples[at+1]+=r;
        if (dry) {dry[at]+=l;dry[at+1]+=r;}
      }
    }
    const continuous=timeline.performerSpec && P.musicPersistentPerformers.render(timeline,world,{start:beginPoint,end:endPoint,sampleRate});
    for (const [part,stem] of Object.entries(continuous?.stems ?? {}))
      add(part,stem,begin,{automation:part==='room' ? undefined : comparison?.gain.read(part)});
    for (const clip of timeline.placements) {
      const first=sample(clip.at,sampleRate), span=sample(clip.to,sampleRate)-sample(clip.from,sampleRate);
      if (first>=last || first+span+Math.ceil(clip.tail*sampleRate)<=begin) continue;
      const additions=R.additions(clip,world?.additions.get(clip));
      const separate=clip.kind==='segment' && timeline.performerSpec?.uses.get(clip.source);
      const key=JSON.stringify([clip.source,clip.from,clip.to,clip.tail,clip.layers,separate ? [...separate] : null]);
      let tracks=additions ? undefined : cache.get(key) ?? shared?.find(sampleRate,key);
      if (!tracks) {
        let music=timeline.compiled[clip.source];
        let layers=clip.layers;
        if (separate) {
          const tracks=Object.fromEntries(Object.entries(music.tracks).filter(([part])=>!separate.has(part)));
          if (!Object.keys(tracks).length) continue;
          music={...music,tracks};
          layers=Object.fromEntries(Object.entries(layers).filter(([part])=>Object.hasOwn(tracks,part)));
        }
        if (additions) {
          const events=Object.fromEntries(Object.entries(music.events).map(([name,notes])=>{
            const response=additions[name] ?? [];
            return [name,[...notes.map(note=>({...note})),...response.map((note,i)=>({...note,roundRobin:notes.length+i}))]
              .sort((a,b)=>a.time-b.time)];
          }));
          A.applyChokes(music.tracks,events);
          music={...music,events};
        }
        const captured=comparison && {first:Infinity,last:0,assets:new Set()};
        const observe=captured && ((first,last,asset)=>{
          captured.first=Math.min(captured.first,first);
          captured.last=Math.max(captured.last,last);
          if (asset) captured.assets.add(asset);
        });
        const render=A.renderCompiled(music,{start:clip.from,end:clip.to,sampleRate,tail:clip.tail,stems:true,layers},
          false,undefined,observe);
        if (captured) placementEvidence.set(key,captured);
        tracks=render.stems;
        cached+=Object.values(tracks).reduce((sum,stem)=>sum+stem.samples.length,0);
        check(cached<=48e6,'Production timeline exceeds its source audio budget');
        if (!additions) {
          cache.set(key,tracks);
          shared?.keep(sampleRate,key,tracks);
        }
      }
      const captured=placementEvidence?.get(key);
      if (captured && captured.first<Infinity && first+captured.first<last)
        comparison.placements.set(clip,{first:first+captured.first,end:Math.min(last,first+captured.last),
          assets:[...captured.assets].sort()});
      for (const [part,stem] of Object.entries(tracks))
        add(part,stem,first,{...clip,span,automation:clip.kind==='segment' && part!=='room' ? comparison?.gain.read(part) : undefined});
    }
    return {value,stems:buffers,report:{start,end,sampleRate,placements:timeline.placements,markers:timeline.markers,
      cueDecisions:timeline.cueDecisions,
      ...(timeline.themes && {themes:timeline.themes}),
      ...(timeline.phrasing && {phrasing:timeline.phrasing}),
      ...(continuous && {performers:continuous.report}),
      ...(world && {world:world.report}),
      ...(A.meters(value))}};
  }
  function study(sources,assets,host) {
    const bank=new Map(), clips=new Map(), budget=3e6;
    let samples=0;
    const shared={
      find:(rate,key)=>clips.get(rate+':'+key)?.tracks,
      keep(rate,key,tracks) {
        const count=Object.values(tracks).reduce((sum,track)=>sum+track.samples.length,0);
        if (count>budget) return;
        while (samples+count>budget) {
          const oldest=clips.keys().next().value;
          samples-=clips.get(oldest).count;
          clips.delete(oldest);
        }
        clips.set(rate+':'+key,{tracks,count});
        samples+=count;
      }
    };
    return {
      schedule:(spec,intents)=>schedule(sources,spec,intents,assets,host,bank),
      render:(schedule,spec,options)=>renderScheduled(schedule,spec,options,shared)
    };
  }

  function renderTimeline(sources,spec,intents,assets={},options={},host) {
    return renderScheduled(schedule(sources,spec,intents,assets,host),spec,options);
  }
  P.musicTimeline=Object.freeze({prepare,schedule,renderScheduled,study});
  P.musicProduction=Object.freeze({...A,renderTimeline});
})(KIT.procedural);
