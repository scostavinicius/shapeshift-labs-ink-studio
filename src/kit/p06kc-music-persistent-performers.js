/* Assemble persistent performer lanes on the output clock before running DSP. */
(function (P) {
  const A=P.musicProduction, F=P.musicPhraseRoutes, Q=P.musicCueMap;
  const {fields,check,id,finite,clamp}=P.musicInstruments;
  const epsilon=1e-8, round=n=>Number(n.toFixed(9));
  const laneKeys=['room','level','eq','depth','tail','cuts'];
  const cutAt=rows=>{
    let index=0;
    return note=>{
      const at=F.onset(note);
      while (index<rows.length && rows[index].endTime<=at+epsilon) index++;
      const cut=rows[index];
      if (!cut) return true;
      if (cut.startTime<=at+epsilon) return false;
      note.choke=Math.min(note.choke ?? Infinity,cut.startTime);
      return true;
    };
  };
  const stamp=(source,music,name)=>F.signature({
    patch:source.patches[music.tracks[name].patch],mix:music.tracks[name].mix
  });
  function prepare(raw,{sources,compiled,segments,placements,entry}) {
    check(fields(raw,['tracks','roomSource','tempoMap','endFade']) && Array.isArray(raw.tracks) &&
      raw.tracks.length>=1 && raw.tracks.length<=8 && Array.from(raw.tracks).every(id) &&
      new Set(raw.tracks).size===raw.tracks.length && finite(raw.endFade ?? 0,0,8),
    'Persistent performers need distinct track names and an optional end fade');
    const roomName=raw.roomSource ?? segments[entry].source;
    check(id(roomName) && Object.hasOwn(compiled,roomName),'Persistent performer room needs a timeline source');
    const base=compiled[segments[entry].source];
    const tempoMap=raw.tempoMap ?? base.arrangement.score.tempoMap ?? {};
    const clock=P.musicTiming.compile(tempoMap);
    const clips=placements.filter(clip=>clip.kind==='segment'), active=[...new Set(clips.map(clip=>clip.source))];
    const names=raw.tracks.slice(), tracks={}, uses=new Map();
    for (const name of names) {
      const eligible=active.filter(source=>Object.hasOwn(compiled[source].tracks,name));
      const exemplar=eligible[0] ?? Object.keys(compiled).find(source=>Object.hasOwn(compiled[source].tracks,name));
      check(exemplar,'Unknown persistent performer '+name);
      const identity=stamp(sources[exemplar],compiled[exemplar],name);
      check(eligible.every(source=>stamp(sources[source],compiled[source],name)===identity),
        'Persistent performer '+name+' needs the same patch and desk defaults across its phrases');
      tracks[name]={...compiled[exemplar].tracks[name],gestures:[]};
      for (const source of eligible) {
        if (!uses.has(source)) uses.set(source,new Set());
        uses.get(source).add(name);
      }
    }
    for (const track of Object.values(tracks)) {
      check(!track.mix.duck || names.includes(track.mix.duck.from),
        'A persistent performer ducking key must also be a persistent performer');
    }
    return {clips,names,tracks,uses,tempoMap,clock,endFade:raw.endFade ?? 0,room:compiled[roomName].room,
      roomSource:roomName,host:base.host};
  }

  function window(row,clip,delta) {
    const from=Math.max(row.startTime,clip.from), to=Math.min(row.endTime,clip.to);
    return to>from+epsilon ? {...row,startTime:round(from+delta),endTime:round(to+delta)} : null;
  }
  function automation(clip,source,name,track,local,delta) {
    const lanes=source.cue?.perTrack[name];
    let windows=0;
    for (const key of laneKeys) for (const row of lanes?.[key] ?? []) {
      const view=window(row,clip,delta);
      if (!view) continue;
      if (key==='room') {
        const send=at=>row.send[0]+(row.send[1]-row.send[0])*
          clamp((at-delta-row.startTime)/(row.endTime-row.startTime));
        view.send=[send(view.startTime),send(view.endTime)];
      } else if (row.fadeSeconds && key!=='tail') {
        // Keep the authored fade phase even when the selected window trims the ramp.
        view.fadeFrom=round(row.startTime+delta);
        view.fadeTo=round(row.endTime+delta);
      }
      local[key].push(view);
      windows++;
    }
    for (const row of source.tracks[name].gestures) {
      const view=window({...row,startTime:row.time},clip,delta);
      if (!view) continue;
      const mixers=Object.fromEntries(Object.entries(row.mixers).map(([key,points])=>
        [key,points.map(([at,value])=>[round(at+delta),value])]));
      track.gestures.push({...view,time:view.startTime,mixers});
      windows++;
    }
    return windows;
  }
  function firstFrom(notes,from) {
    let low=0, high=notes.length;
    while (low<high) {
      const mid=(low+high)>>>1;
      if (F.onset(notes[mid])<from-epsilon) low=mid+1;
      else high=mid;
    }
    return low;
  }
  function realized(timeline,world) {
    const {clips,names,tracks:base,uses,clock,tempoMap,endFade,room,host}=timeline.performerSpec;
    const tracks=Object.fromEntries(names.map(name=>[name,{...base[name],gestures:[]}]));
    const perTrack=Object.fromEntries(names.map(name=>[name,Object.fromEntries(laneKeys.map(key=>[key,[]]))]));
    const events=Object.fromEntries(names.map(name=>[name,[]])), indexes=new Map();
    let size=0, automationSize=0;
    for (const clip of clips) {
      const scope=uses.get(clip.source);
      if (!scope) continue;
      const source=timeline.compiled[clip.source], delta=clip.at-clip.from;
      const additions=world?.additions.get(clip);
      for (const name of scope) {
        automationSize+=automation(clip,source,name,tracks[name],perTrack[name],delta);
        check(automationSize<=65536,'Persistent performers exceed their automation budget');
        const level=clip.gain*source.gain*(clip.layers[name] ?? 1);
        if (!level) continue;
        const key=clip.source+'/'+name;
        if (!indexes.has(key)) indexes.set(key,source.events[name].slice().sort((a,b)=>F.onset(a)-F.onset(b)));
        const original=indexes.get(key), output=events[name];
        function add(raw) {
          const at=F.onset(raw);
          if (!raw.velocity || at<clip.from-epsilon || at>=clip.to-epsilon) return;
          check(++size<=65536,'Persistent performers exceed their note budget');
          const {choke,...note}=raw;
          note.time=round(raw.time+delta);
          if (raw.start!==undefined) note.start=round(Math.max(clip.at,at+delta));
          if (choke<clip.to-epsilon) note.choke=round(choke+delta);
          if (level!==1) note.renderGain=level;
          if (clip.fadeIn>0 && at-clip.from<clip.fadeIn)
            note.renderFade={at:clip.at,duration:clip.fadeIn};
          output.push(note);
        }
        for (let i=firstFrom(original,clip.from);i<original.length && F.onset(original[i])<clip.to-epsilon;i++)
          add(original[i]);
        for (const note of additions?.[name] ?? []) add({...note,roundRobin:output.length});
      }
    }
    for (const name of names) {
      const rows=perTrack[name];
      events[name].sort((a,b)=>F.onset(a)-F.onset(b));
      events[name]=events[name].filter(cutAt(rows.cuts));
    }
    A.applyChokes(tracks,events);
    const edges=[...new Set(names.flatMap(name=>perTrack[name].cuts.flatMap(row=>[row.startTime,row.endTime])))].sort((a,b)=>a-b);
    const readers=names.map(name=>Q.cursor(perTrack[name].cuts));
    const roomCuts=edges.slice(0,-1).flatMap((startTime,i)=>readers.map(at=>at?.(startTime)).every(Boolean) ?
      [{startTime,endTime:edges[i+1]}] : []);
    return {tracks,events,room,cue:{perTrack,roomCuts},clock,host,
      end:timeline.duration,gain:1,arrangement:{score:{tempoMap,endFade}}};
  }
  function render(timeline,world,{start,end,sampleRate}) {
    const score=realized(timeline,world), names=timeline.performerSpec.names;
    const output=A.renderCompiled(score,{start,end,sampleRate,stems:true},false,timeline.duration);
    const carried=Object.fromEntries(names.map(name=>{
      let next=0, sounding=[];
      const notes=score.events[name];
      const boundaries=timeline.markers.map(({time})=>{
        while (next<notes.length && F.onset(notes[next])<time-epsilon) sounding.push(notes[next++]);
        sounding=sounding.filter(note=>Math.min(note.choke ?? Infinity,note.time+note.gate)>time+epsilon);
        return {voices:sounding.length,pitches:[...new Set(sounding.map(note=>note.midi))].sort((a,b)=>a-b)};
      });
      return [name,{notes:notes.length,boundaries}];
    }));
    const joins=timeline.markers.map(({time,from,to},i)=>({time,from,to,
      held:Object.fromEntries(names.map(name=>[name,carried[name].boundaries[i]]))}));
    const lanes=Object.fromEntries(names.map(name=>[name,{notes:carried[name].notes,
      ...(output.report.instruments?.[name] && {instrument:output.report.instruments[name]})}]));
    return {stems:output.stems,report:{lanes,joins,roomSource:timeline.performerSpec.roomSource}};
  }
  P.musicPersistentPerformers=Object.freeze({prepare,render});
})(KIT.procedural);
