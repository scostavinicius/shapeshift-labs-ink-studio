/* Read a donor performance against its score and fit its contour to another melody. */
(function (P) {
  const F=P.musicPhrasePerformance,{check,fields,id,finite}=P.musicInstruments;
  const epsilon=1e-8, minimumGate=.001, round=n=>Number(n.toFixed(9));
  const bounded=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
  const onset=note=>note.start ?? note.time, keyUp=note=>note.time+note.gate;
  const end=note=>Math.min(note.choke ?? Infinity,keyUp(note));
  const span=(from,to)=>finite(from,0,65536) && finite(to,from+.0001,65536);
  const inRange=(note,{from,to})=>note.beat>=from-epsilon && note.beat<to-epsilon;
  const fromBeat=(clock,beat)=>clock.timeAt({beat:Math.max(0,beat)});

  function validateSource(raw) {
    check(fields(raw,['lane','take','from','to','reference','grid']) && id(raw.lane) && id(raw.take) &&
      span(raw.from,raw.to) && (raw.reference===undefined || id(raw.reference) && raw.reference!==raw.take) &&
      (raw.grid===undefined || raw.reference===undefined && finite(raw.grid,1/32,2)),
    'Choose a played donor range and a written reference or a beat grid');
  }
  function melody(score,lane,range) {
    const track=score?.tracks[lane];
    check(track && !track.external && !track.pad && score.arrangement.parts[lane].role!=='percussion' &&
      fromBeat(score.clock,range.to)<=score.end+epsilon,'Borrowing needs a native melodic score lane and an in-bounds range');
    const notes=score.events[lane].filter(note=>inRange(note,range)).sort((a,b)=>a.beat-b.beat);
    check(notes.length && notes.length<=64 && notes.every((note,i)=>!note.retrigger &&
      (note.play.retrigger ?? 1)===1 && (!i || note.beat>notes[i-1].beat+epsilon)),
    'Choose one to 64 single melodic attacks in each borrowing range');
    return notes;
  }
  function breathKnots(notes,clock,source,target) {
    const points=new Map();
    for (const [i,note] of notes.entries()) {
      const first=onset(note), length=keyUp(note)-first;
      const knots=note.phrase?.lanes.breath ?? note.play.curves?.breath?.map(([at,value])=>[at*length,value]) ??
        (note.play.breath===undefined ? null : [[0,note.play.breath]]);
      if (!knots) continue;
      const stop=Math.max(0,Math.min(length,notes[i+1] ? onset(notes[i+1])-first : length));
      for (const [at,value] of [[0,F.sample(knots,0)],...knots.filter(([at])=>at>0 && at<stop),[stop,F.sample(knots,stop)]]) {
        const beat=round(bounded(clock.sample(first+at).beat,source.from,source.to));
        points.set(beat,value);
      }
    }
    if (!points.size) return null;
    const sorted=[...points].sort(([a],[b])=>a-b);
    const result=[[source.from,sorted[0][1]],...sorted.filter(([beat])=>beat>source.from+epsilon && beat<source.to-epsilon),
      [source.to,sorted.at(-1)[1]]].map(([beat,value])=>[
      bounded(round(target.from+(target.to-target.from)*(beat-source.from)/(source.to-source.from)),target.from,target.to),value
    ]).filter(([beat],i,rows)=>!i || beat>rows[i-1][0]+epsilon);
    return simplify(result).map(([beat,value],i)=>({id:'breath-'+(i+1),beat,value:round(value)}));
  }
  function simplify(points) {
    if (points.length<=192) return points;
    const kept=[0,points.length-1];
    while (kept.length<192) {
      let worst=.001,index=-1,slot;
      for (let span=1;span<kept.length;span++) {
        const [from,a]=points[kept[span-1]],[to,b]=points[kept[span]];
        for (let i=kept[span-1]+1;i<kept[span];i++) {
          const [at,value]=points[i],error=Math.abs(value-(a+(b-a)*(at-from)/(to-from)));
          if (error>worst) {worst=error;index=i;slot=span;}
        }
      }
      if (index<0) break;
      kept.splice(slot,0,index);
    }
    return kept.map(i=>points[i]);
  }

  function draft(id,source,played,written,lane,target,score,{timing=1,accent=1,breath=true}) {
    validateSource(source);
    check(span(target.from,target.to) && finite(timing,0,1) && finite(accent,0,1) && typeof breath==='boolean',
      'Choose target beats and bounded timing, accent and breath settings');
    const donor=melody(played,source.lane,source), arrival=played.clock;
    const baseline=source.grid===undefined ? melody(written,source.lane,source) : null;
    check(!baseline || donor.length===baseline.length && donor.every((note,i)=>note.midi===baseline[i].midi),
      'Donor take and written reference need the same pitch sequence. Use a beat grid for an improvised donor');
    const mean=donor.reduce((sum,note)=>sum+note.velocity,0)/donor.length;
    const offsets=[],accents=[];
    for (const [i,note] of donor.entries()) {
      const reference=baseline?.[i], beat=reference?.beat ?? note.beat;
      const playedBeat=arrival.sample(onset(note)).beat;
      const ideal=reference ? written.clock.sample(onset(reference)).beat :
        source.from+Math.round((playedBeat-source.from)/source.grid)*source.grid;
      offsets.push([beat,playedBeat-ideal]);
      accents.push([beat,Math.log(bounded(note.velocity/(reference?.velocity ?? mean),.02,2))]);
    }
    const destination=melody(score,lane,target),track=score.tracks[lane], clock=score.clock;
    const keys=new Map();
    for (const row of [...(track.clips?.notes ?? []),...(track.clips?.extra ?? [])]) {
      const key=F.noteKey(row);
      keys.set(key,(keys.get(key) ?? 0)+1);
    }
    const first=fromBeat(clock,target.from), last=fromBeat(clock,target.to);
    check(new Set(destination.map(note=>note.voice)).size===1 &&
      destination.every(note=>note.clip && keys.get(F.noteKey(note))===1 &&
        onset(note)>=first-epsilon && end(note)<=last+epsilon),
    'Choose one addressed destination clip voice and cover its performed notes through key-up');
    const notes=destination.map(({clip,voice,note,beat})=>{
      const from=source.from+(source.to-source.from)*(beat-target.from)/(target.to-target.from);
      const offset=F.sample(offsets,from)*timing;
      const seconds=fromBeat(clock,beat+offset)-fromBeat(clock,beat);
      return {clip,voice,note,delay:round(bounded(seconds,-.125,.125)),
        accent:round(Math.exp(F.sample(accents,from)*accent)),fit:true};
    });
    const trace=breath && breathKnots(donor,arrival,source,target);
    const drivers=trace ? {breath:trace} : {unity:[{id:'flat',beat:target.from,value:1}]};
    const mapping=trace ? {breath:{base:0,from:{breath:1}}} : {amplitude:{base:0,from:{unity:1}}};
    return {id,...target,drivers,mapping,notes,borrowed:source};
  }

  function apply(phrases,events,clips,clock,cue,anchor) {
    const windows=new Map((clips ?? []).map(({id,beat,length})=>
      [id,[fromBeat(clock,beat),fromBeat(clock,beat+length)]]));
    const boundaries=[...(cue?.silence ?? []),...(cue?.cuts ?? [])];
    const voices=new Map();
    for (const note of events) {
      const voice=note.voice, rows=voices.get(voice) ?? [];
      rows.push({note,start:onset(note),off:end(note)});
      voices.set(voice,rows);
    }
    for (const rows of voices.values()) {
      rows.sort((a,b)=>a.start-b.start);
      for (const [i,{note,start,off}] of rows.entries()) {
        const phrase=F.at(phrases,note.beat), settings=phrase?.overrides.get(F.noteKey(note));
        if (!settings?.fit) continue;
        const velocity=bounded(note.velocity*(settings.accent ?? 1),0,1);
        if (velocity!==note.velocity) {
          note.zoneVelocity=note.zoneVelocity ?? note.velocity;
          note.velocity=velocity;
        }
        const prior=rows[i-1], next=rows[i+1], lead=note.time-start;
        if (!settings.delay || note.ties || note.connected || next?.note.connected ||
            (note.play.retrigger ?? 1)>1 || anchor?.(note.beat)) continue;
        const [from,to]=windows.get(note.clip) ?? [phrase.from,phrase.to];
        const guard=Math.min(.035,note.gate*.3);
        let lower=Math.max(phrase.from,from,start-guard,prior?.off ?? 0);
        let upper=Math.min(phrase.to,to,off-lead-minimumGate,start+guard,(next?.start ?? Infinity)-minimumGate);
        for (const {startTime,endTime} of boundaries) {
          if (endTime<=start) lower=Math.max(lower,endTime);
          else if (startTime>=start) upper=Math.min(upper,startTime-minimumGate);
          else {lower=start;upper=start;break;}
        }
        // An existing overlap or a short note can restrict either direction to zero.
        const shift=round(bounded(settings.delay,Math.min(0,lower-start),Math.max(0,upper-start)));
        if (!shift) continue;
        const stop=keyUp(note);
        note.time=round(note.time+shift);
        note.gate=round(stop-note.time);
        if (note.start!==undefined) note.start=round(start+shift);
      }
    }
    events.sort((a,b)=>a.time-b.time);
  }
  P.musicPhraseContour=Object.freeze({validateSource,draft,apply});
})(KIT.procedural);
