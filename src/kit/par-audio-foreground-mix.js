/* Generate different mix and arrangement moves around an authored foreground map. */
(function (P) {
  const A=P.musicProduction;
  const {fields,check,finite,integer,id}=P.musicInstruments;
  const at=(from,to)=>({from:{beat:from},to:{beat:to}});
  const definitions=[
    ['ride','Ride the competing part','level'],
    ['short-tail','Shorten the competing release','tail'],
    ['depth','Move the competing part back','depth'],
    ['arrangement-cut','Leave a gap in the arrangement','silence']
  ];

  function competition(desk,moment,score,rate,minimum) {
    const protectedParts=new Set([...moment.parts,...moment.protect,...Object.keys(P.musicComposer.locks(score.arrangement))]);
    const best=new Map();
    for (const lead of moment.parts) {
      const {report}=desk.inspect({range:at(moment.from,moment.to),context:{beforeBeats:0,afterBeats:0},
        lead,sampleRate:rate,views:[{id:'focus',mode:'mix'}]});
      for (const {range,masking} of report.windows) for (const row of masking) {
        if (row.overlap<minimum || row.coverage<minimum || !row.bands.length) continue;
        const common=band=>Math.min(band.leadDbFS,band.otherDbFS ?? -200);
        const band=row.bands.reduce((a,b)=>common(a)>=common(b) ? a : b);
        // Prefer a sustained conflict in an audible band over a high ratio on a nearly silent fragment.
        const weight=row.overlap*10**(common(band)/20);
        const previous=best.get(row.track);
        if (!previous || weight>previous.weight) best.set(row.track,{part:row.track,lead,range,
          overlap:row.overlap,coverage:row.coverage,band,weight,protected:protectedParts.has(row.track)});
      }
    }
    const ranked=[...best.values()].sort((a,b)=>b.weight-a.weight || a.part.localeCompare(b.part))
      .map(({weight,...row})=>row);
    return {ranked,selected:ranked.find(row=>!row.protected) ?? null};
  }

  function activeReleases(score,part,moment,seconds,rate) {
    const track=score.tracks[part], width={...moment,seconds,fadeSeconds:.02};
    return score.events[part].some(note=>{
      if (!note.velocity || note.time>=moment.endTime || note.time+note.gate+60<moment.startTime) return false;
      const start=note.start ?? note.time, release=note.time+note.gate;
      const duration=track.play.prepare(note,rate,release-start).duration;
      return P.musicCueMap.tailLimit([width],release,Math.min(note.choke ?? Infinity,start+duration))!==null;
    });
  }

  function plan(source,settings={},assets={}) {
    check(fields(settings,['moments','select','context','sampleRate','move','level','target','ceiling']) &&
      (settings.moments===undefined || Array.isArray(settings.moments) && integer(settings.moments.length,1,128)) &&
      (settings.select===undefined || Array.isArray(settings.select) && integer(settings.select.length,1,8) &&
        Array.from(settings.select).every(id) && new Set(settings.select).size===settings.select.length) &&
      integer(settings.sampleRate ?? 24000,8000,48000) && ['matched','fixed'].includes(settings.level ?? 'matched') &&
      finite(settings.target ?? -18,-35,-9) && finite(settings.ceiling ?? -1,-12,-.1) &&
      fields(settings.context ?? {},['beforeBeats','afterBeats']) &&
      Object.values(settings.context ?? {}).every(value=>finite(value,0,32)),
    'Invalid foreground mix request');
    const move=settings.move ?? {};
    check(fields(move,['minOverlap','rideDb','tailSeconds','depthHz','depthSend','fadeSeconds']) &&
      finite(move.minOverlap ?? .3,.05,1) && finite(move.rideDb ?? -3.5,-24,-.1) &&
      finite(move.tailSeconds ?? .09,.005,2) && finite(move.depthHz ?? 1450,100,24000) &&
      finite(move.depthSend ?? .46,0,1) && finite(move.fadeSeconds ?? .065,0,1),
    'Invalid foreground mix move settings');
    const {minOverlap=.3,rideDb=-3.5,tailSeconds=.09,depthHz=1450,depthSend=.46,fadeSeconds=.065}=move;
    const momentMap=settings.moments ?? source.cueMap?.foreground;
    check(Array.isArray(momentMap) && momentMap.length>0,'Mark at least one foreground moment in the cue');
    const cueMap={...source.cueMap,foreground:momentMap};
    const production=A.revise(source,{cueMap},assets), score=A.compile(production,assets);
    const selected=score.cue.foreground.filter(row=>!settings.select || settings.select.includes(row.id));
    check(integer(selected.length,1,8) && (!settings.select || selected.length===settings.select.length),
      'Select one to eight known foreground moments to audition');
    const {sampleRate=24000,context={beforeBeats:1,afterBeats:1}}=settings;
    const first=Math.max(0,selected[0].from-(context.beforeBeats ?? 1));
    const last=Math.min(score.cue.beats,selected.at(-1).to+(context.afterBeats ?? 1));
    check(score.clock.timeAt({beat:last})-score.clock.timeAt({beat:first})<=30,
      'Selected moments and context must fit a thirty-second audition');
    const desk=A.critique.openAudio(production,assets);
    const edits=new Map(definitions.map(([id])=>[id,[]]));
    const moments=selected.map(moment=>{
      const {ranked,selected}=competition(desk,moment,score,sampleRate,minOverlap);
      const range=at(moment.from,moment.to), offered=[], blocked=[];
      if (selected) {
        const parts=[selected.part], common={range,parts};
        const choices={
          level:{gainDb:rideDb,fadeSeconds},
          tail:{seconds:tailSeconds,fadeSeconds:Math.max(.001,Math.min(.025,tailSeconds*.5))},
          depth:{cutoffHz:depthHz,send:move.depthSend ?? Math.max(depthSend,score.tracks[selected.part].mix.send,
            ...score.cue.perTrack[selected.part].room.filter(row=>row.from<moment.to && row.to>moment.from).flatMap(row=>row.send)),
            fadeSeconds},
          silence:{mode:'ring'}
        };
        for (const [id,,op] of definitions) {
          const occupied=score.cue.perTrack[selected.part][op].some(row=>row.from<moment.to && row.to>moment.from);
          const possible=op==='tail' ? activeReleases(score,selected.part,moment,tailSeconds,sampleRate) :
            op!=='silence' || score.events[selected.part].some(note=>note.velocity &&
              note.time<moment.endTime && note.time+note.gate>moment.startTime);
          if (occupied || !possible) {
            const reason=occupied ? 'The competing track already has a '+op+' window here.' :
              op==='tail' ? 'No voice release is longer than the requested cap here.' : 'Only earlier releases are sounding here.';
            blocked.push({id,reason});
          } else {
            offered.push(id);
            edits.get(id).push({op,...common,...choices[op]});
          }
        }
      }
      return {id:moment.id,...(moment.label && {label:moment.label}),range,parts:moment.parts,protect:moment.protect,
        ...(ranked.length && {competition:ranked}),selected,offered,blocked};
    });
    const request={range:at(selected[0].from,selected.at(-1).to),context,
      sampleRate,level:settings.level ?? 'matched',target:settings.target ?? -18,ceiling:settings.ceiling ?? -1,
      targets:moments.map(({id,range,parts,selected})=>({id,range,parts,rivals:selected ? [selected.part] : []})),
      candidates:definitions.flatMap(([id,label])=>edits.get(id).length ? [{id,label,edits:edits.get(id)}] : [])};
    return {production,request,report:{moments}};
  }

  function audition(source,settings,assets={}) {
    const planned=plan(source,settings,assets);
    return {...planned,comparison:A.critique.openAudio(planned.production,assets).compare(planned.request)};
  }

  P.musicProduction=Object.freeze({...A,foregroundMix:Object.freeze({plan,audition})});
})(KIT.procedural);
