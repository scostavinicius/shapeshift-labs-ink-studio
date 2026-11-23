/* Bounded search over identifiable lines, with phrasing choices separate from pitch costs. */
(function (P) {
  const A=P.musicProduction, H=P.musicHarmony, N=P.musicNoteClips;
  const {fields,finite,id,check,clamp,hash,hz}=P.musicInstruments;
  const eps=1e-8, round=n=>Number(n.toFixed(9)), pc=n=>n%12;
  const profiles=['connected','suspensions','counterline'];
  const spacing=[0,1,.65,.22,.16,.1,.83,.05,.23,.26,.63,.9];
  const covered=(start,end,time)=>start<=time+eps && time<end-eps;
  const series=(raw,max,label)=>{
    check(Array.isArray(raw) && raw.length<=max,'Invalid voice-leading '+label);
    return raw;
  };

  function preferences(raw={}) {
    check(fields(raw,['motion','tension','dissonance','ties','delay']) &&
      (raw.ties===undefined || typeof raw.ties==='boolean'),'Invalid voicing preferences');
    const {motion=1,tension=.12,dissonance=.2,ties=true,delay=.48}=raw;
    check(finite(motion,0,4) && [tension,dissonance].every(n=>finite(n,0,1)) &&
      finite(delay,.125,2),'Invalid voice motion, dissonance, tension or resolution delay');
    return {motion,tension,dissonance,ties,delay};
  }

  function phrase(input,music) {
    check(fields(input,['track','melody','bass','from','to','voices','pedals','suspensions','preferences']) &&
      new Set([input.track,input.melody,input.bass]).size===3 &&
      [input.track,input.melody,input.bass].every(name=>id(name) && Object.hasOwn(music.tracks,name) &&
        music.arrangement.parts[name].role!=='percussion'),'Choose distinct pitched target, melody and bass tracks');
    const {from=0,to=music.arrangement.sections.at(-1).end}=input;
    check(finite(from,0,65536) && finite(to,from+.125,Math.min(from+128,music.arrangement.sections.at(-1).end)),
      'Voice leading needs a cue window of up to 128 beats');
    const voices=Array.from(series(input.voices,3,'voices'),row=>{
      check(fields(row,['id','low','high','anchor','velocity']) && id(row.id),'Name each inner voice and give its range');
      const low=H.midi(row.low), high=H.midi(row.high);
      const anchor=row.anchor===undefined ? Math.round((low+high)/2) : H.midi(row.anchor);
      const velocity=row.velocity ?? .58;
      check(high>=low && high-low<=24 && anchor>=low && anchor<=high && finite(velocity,.05,1),
        'Use a voice range of at most two octaves, an in-range anchor and an audible velocity');
      return {id:row.id,low,high,anchor,velocity};
    });
    const index=new Map(voices.map((row,i)=>[row.id,i]));
    check(voices.length && index.size===voices.length,'Choose one to three uniquely named, low-to-high inner voices');
    const at=beat=>music.clock.timeAt({beat}), beat=time=>round(music.clock.sample(time).beat);
    const harmonies=music.program.events.map(row=>{
      const chord=music.arrangement.score.harmonies[row.harmony];
      const tones=chord.notes ? chord.notes.filter(note=>note!==null).map(H.midi) : H.chord(row.root,row.quality);
      return {beat:beat(row.time),id:row.id,label:row.harmony,tones:new Set((tones.length ? tones : [H.midi(row.root)]).map(pc))};
    });
    check(harmonies.some(row=>row.beat<=from+eps),'Voice leading needs a sounding starting harmony');
    const boundaries=[from,to,...harmonies.filter(row=>row.beat>from+eps && row.beat<to-eps).map(row=>row.beat)];
    const fixed=voices.map(()=>[]), resolutions=[];
    function force(name,pitch,start,end,kind) {
      const voice=index.get(name), midi=H.midi(pitch);
      check(voice!==undefined && finite(start,from,to) && finite(end,start+eps,to) &&
        midi>=voices[voice].low && midi<=voices[voice].high,'Forced voicing lies outside its voice or window');
      fixed[voice].push({start,end,midi,kind});
    }
    for (const row of series(input.pedals ?? [],24,'pedals')) {
      check(fields(row,['voice','from','to','midi']),'Invalid pedal');
      force(row.voice,row.midi,row.from,row.to,'pedal');
      boundaries.push(row.from,row.to);
    }
    for (const row of series(input.suspensions ?? [],24,'suspensions')) {
      check(fields(row,['voice','at','delay','hold','resolve']) && finite(row.at,from+eps,to) &&
        finite(row.delay,.125,2),'A suspension needs a chord change, held pitch, delay and destination');
      const pivot=harmonies.find(change=>Math.abs(change.beat-row.at)<eps);
      check(pivot,'A suspension must start at a chord change');
      const prepare=Math.max(from,harmonies.findLast(change=>change.beat<row.at-eps)?.beat ?? from);
      const resolution=round(row.at+row.delay);
      const stop=harmonies.find(change=>change.beat>row.at+eps)?.beat ?? to;
      const held=H.midi(row.hold), target=H.midi(row.resolve);
      check(held!==target && pivot.tones.has(pc(target)) &&
        finite(resolution,row.at+eps,Math.min(stop,to)-eps),'Suspension resolution needs a new chord tone before the next change');
      force(row.voice,held,prepare,resolution,'suspension');
      force(row.voice,target,resolution,Math.min(stop,to),'resolution');
      boundaries.push(prepare,resolution,Math.min(stop,to));
      resolutions.push({voice:row.voice,beat:row.at,until:resolution,hold:held,resolve:target});
    }
    for (const spans of fixed) {
      spans.sort((a,b)=>a.start-b.start);
      check(spans.every((row,i)=>!i || row.start>=spans[i-1].end-eps),'Pedals and resolutions on one voice overlap');
    }
    function sounding(name) {
      return music.events[name].flatMap(note=>{
        if (note.velocity<=0 || music.tracks[name].play.prepare(note,48000,note.gate).duration<=0) return [];
        const finish=Math.min(note.time+note.gate,note.choke ?? Infinity);
        return finish>at(from) && note.time<at(to) ? [{start:Math.max(from,beat(note.time)),
          end:Math.min(to,beat(finish)),midi:note.midi}] : [];
      });
    }
    const melody=sounding(input.melody), bass=sounding(input.bass);
    check(melody.length+bass.length<=1024,'Voice leading needs a window with at most 1024 outer notes');
    const gaps=[];
    let end=from;
    for (const row of [...melody,{start:to,end:to}]) {
      if (row.start-end>=.3) {
        const a=round(end+Math.min(.11,(row.start-end)*.18)), b=round(row.start-Math.min(.085,(row.start-end)*.12));
        gaps.push([a,b]);
      }
      end=Math.max(end,row.end);
    }
    return {from,to,voices,fixed,boundaries,harmonies,melody,bass,gaps,resolutions,prefs:preferences(input.preferences)};
  }

  function intervals(phrase,profile) {
    const {boundaries,gaps,melody,bass,fixed,harmonies}=phrase;
    const answers=profile==='counterline' ? gaps.flatMap(([a,b])=>
      b-a>.8 ? [a,round(a+(b-a)*.48),b] : [a,b]) : [];
    const edges=[...new Set(boundaries.concat(answers).map(round))].sort((a,b)=>a-b);
    check(edges.length<=129,'Voice leading exceeds its phrase event budget');
    const top=phrase.voices.length-1;
    return edges.slice(0,-1).map((from,i)=>{
      const to=edges[i+1], middle=(from+to)/2;
      const near=(rows,high)=>{
        const pitches=rows.filter(note=>covered(note.start,note.end,middle)).map(note=>note.midi);
        return pitches.length ? (high ? Math.max(...pitches) : Math.min(...pitches)) : null;
      };
      const held=fixed.map(spans=>spans.find(row=>covered(row.start,row.end,middle)) ?? null);
      const gap=gaps.some(([a,b])=>covered(a,b,middle));
      return {from,to,chord:harmonies.findLast(row=>row.beat<=from+eps),held,
        melody:near(melody,false),bass:near(bass,true),gap,
        active:phrase.voices.map((_,j)=>profile!=='counterline' || j!==top || gap || held[j]!==null)};
    });
  }

  function dissonance() {
    const cache=new Map();
    return (a,b)=>{
      const key=Math.min(a,b)*128+Math.max(a,b);
      if (!cache.has(key)) {
        const spectrum=note=>[[hz(note),1],[2*hz(note),.26],[3*hz(note),.13]];
        const spectral=H.roughness([spectrum(a),spectrum(b)]);
        cache.set(key,.72*spacing[pc(Math.abs(a-b))]+.28*spectral);
      }
      return cache.get(key);
    };
  }

  function vertical(chord,pitches,outer,roughness) {
    let foreign=0, rough=0, pairs=0;
    for (const [i,pitch] of pitches.entries()) {
      foreign+=Number(!chord.tones.has(pc(pitch)));
      for (const other of outer) {
        rough+=roughness(pitch,other);
        pairs++;
      }
      for (let j=0;j<i;j++) {
        rough+=roughness(pitch,pitches[j]);
        pairs++;
      }
    }
    return {tension:foreign/Math.max(1,pitches.length),dissonance:rough/Math.max(1,pairs)};
  }

  function choices(phrase,region,roughness,profile) {
    const {voices,prefs}=phrase, options=[];
    const outer=[region.bass,region.melody].filter(note=>note!==null);
    function rank(midi) {
      const audible=midi.filter((_,i)=>region.active[i]);
      let slot=0, doublings=0;
      for (const [i,pitch] of audible.entries()) {
        doublings+=audible.slice(0,i).filter(note=>pc(note)===pc(pitch)).length;
        if (region.bass!==null) slot+=Math.max(0,region.bass+2-pitch)*.42;
        if (region.melody!==null) slot+=Math.max(0,pitch-region.melody+2)*.63;
      }
      const {tension,dissonance}=vertical(region.chord,audible,outer,roughness);
      const placement=midi.reduce((sum,pitch,i)=>sum+Math.abs(pitch-voices[i].anchor)*.035,0);
      const cost=slot+doublings*.36+placement+Math.abs(tension-prefs.tension)*2.8+
        Math.abs(dissonance-prefs.dissonance)*(profile==='connected'?1.65:2.1);
      options.push({midi:midi.slice(),cost,tie:hash([region.from,midi])});
    }
    function enumerate(pitches) {
      const i=pitches.length;
      if (i===voices.length) {rank(pitches);return;}
      const {low,high}=voices[i], held=region.held[i]?.midi;
      for (let pitch=held ?? low;pitch<=(held ?? high);pitch++) {
        if (i && pitch<=pitches[i-1]) continue;
        pitches.push(pitch);
        enumerate(pitches);
        pitches.pop();
      }
    }
    enumerate([]);
    check(options.length,'Inner voice ranges and forced notes cannot stay in voice order');
    return options.sort((a,b)=>a.cost-b.cost || a.tie-b.tie).slice(0,44);
  }

  function suspension(previous,current,left,right,delay) {
    if (left.chord.id===right.chord.id || right.to-right.from<=delay+.07) return -1;
    return previous.findLastIndex((pitch,i)=>{
      const dest=current[i], step=Math.abs(dest-pitch);
      return !left.held[i] && !right.held[i] && left.chord.tones.has(pc(pitch)) && !right.chord.tones.has(pc(pitch)) &&
        right.chord.tones.has(pc(dest)) && step>=1 && step<=2 &&
        pitch>(current[i-1] ?? -Infinity) && pitch<(current[i+1] ?? Infinity);
    });
  }

  function search(phrase,profile,roughness) {
    const regions=intervals(phrase,profile), {prefs}=phrase;
    let previous=[];
    for (const [i,region] of regions.entries()) {
      const candidates=choices(phrase,region,roughness,profile);
      const states=[];
      for (const node of candidates) {
        if (!i) {states.push({node,score:node.cost,prev:null,delay:-1});continue;}
        const before=regions[i-1];
        const leftMotion=region.bass!==null && before.bass!==null ? region.bass-before.bass :
          region.melody!==null && before.melody!==null ? region.melody-before.melody : 0;
        const links=previous.map(prev=>{
          const left=prev.node.midi,right=node.midi,step=right.map((pitch,k)=>pitch-left[k]);
          const delay=profile==='suspensions' ? suspension(left,right,before,region,prefs.delay) : -1;
          const move=step.reduce((sum,d)=>sum+Math.abs(d)*.25+Math.max(0,Math.abs(d)-5)*.19,0);
          const common=step.filter((d,k)=>!d && region.active[k] && before.active[k]).length;
          const contrary=profile==='counterline' && region.gap ?
            (step.at(-1)*leftMotion>0 ? .75 : step.at(-1)===0 ? .36 : 0) : 0;
          const score=prev.score+node.cost+prefs.motion*move-common*(profile==='connected'?.36:.15)+contrary-
            (delay<0 ? 0 : 2.7);
          return {node,score,prev,delay};
        });
        links.sort((a,b)=>a.score-b.score);
        states.push(...links.slice(0,2));
      }
      previous=states.sort((a,b)=>a.score-b.score || a.node.tie-b.node.tie).slice(0,48);
    }
    return {regions,paths:previous};
  }

  function realize(phrase,profile,result,path) {
    const units=[];
    const notes=phrase.voices.map(()=>[]), delayed=[];
    const {prefs,voices,from,to}=phrase;
    for (let at=path;at;at=at.prev) units.unshift(at);
    const add=(voice,start,stop,midi,forced)=>{
      if (stop-start<1e-5) return;
      const list=notes[voice], prev=list.at(-1);
      const tie=(prefs.ties || forced) && prev && prev.midi===midi &&
        Math.abs(prev.beat+prev.duration-(start-from))<eps;
      list.push({id:'n'+list.length,beat:round(start-from),duration:round(stop-start),midi,
        velocity:voices[voice].velocity,...(tie && {tie:true})});
    };
    for (const [index,{node,delay}] of units.entries()) {
      const row=result.regions[index];
      for (const [i,pitch] of node.midi.entries()) {
        if (!row.active[i]) continue;
        const held=row.held[i], isAnswer=profile==='counterline' && i===voices.length-1 && !held;
        const start=delay===i ? round(row.from+prefs.delay) : row.from;
        if (delay===i) {
          const hold=units[index-1].node.midi[i];
          add(i,row.from,start,hold,true);
          delayed.push({voice:voices[i].id,beat:row.from,until:start,hold,resolve:pitch});
        }
        const stop=isAnswer ? row.from+(row.to-row.from)*.81 : row.to;
        add(i,start,stop,pitch,Boolean(held));
      }
    }
    const clip=N.clip({id:'voicing-'+profile+'-'+hash([from,to]).toString(36),beat:from,length:round(to-from),
      voices:voices.map((voice,i)=>({id:voice.id,notes:notes[i]}))});
    const metrics={
      movement:notes.reduce((sum,rows)=>sum+rows.slice(1).reduce((total,n,j)=>total+Math.abs(n.midi-rows[j].midi),0),0),
      ties:notes.flat().filter(row=>row.tie).length,delayed:[...phrase.resolutions,...delayed],
      answerNotes:profile==='counterline' ? notes.at(-1).filter(note=>phrase.gaps.some(([a,b])=>
        note.beat+from>=a-eps && note.beat+from+note.duration<=b+eps)).length : 0
    };
    return {clip,metrics};
  }

  function measure(phrase,clip,roughness) {
    const {from,to,harmonies,melody,bass}=phrase;
    const notes=clip.voices.flatMap(voice=>voice.notes.map(note=>({start:from+note.beat,
      end:from+note.beat+note.duration,midi:note.midi})));
    const cuts=[...new Set([from,to,...harmonies.map(chord=>chord.beat),
      ...notes.concat(melody,bass).flatMap(note=>[note.start,note.end])].filter(beat=>beat>=from && beat<=to)
      .map(round))].sort((a,b)=>a-b);
    let duration=0,tension=0,dissonance=0;
    for (let i=1;i<cuts.length;i++) {
      const span=cuts[i]-cuts[i-1], time=(cuts[i]+cuts[i-1])/2;
      const sounding=rows=>rows.filter(row=>covered(row.start,row.end,time)).map(row=>row.midi);
      const pitches=sounding(notes);
      if (!pitches.length) continue;
      const chord=harmonies.findLast(row=>row.beat<=time+eps);
      const at=vertical(chord,pitches,[...sounding(melody),...sounding(bass)],roughness);
      duration+=span;
      tension+=span*at.tension;
      dissonance+=span*at.dissonance;
    }
    return {tension:duration ? round(tension/duration) : 0,dissonance:duration ? round(dissonance/duration) : 0};
  }

  function voiceLead(source,input,assets={}) {
    const production=P.musicProduction, music=production.compile(source,assets), plan=phrase(input,music);
    check(!Object.hasOwn(P.musicComposer.locks(music.arrangement),input.track),'The target inner track is pinned');
    const {from,to}=plan, locked=[input.melody,input.bass];
    const retained=(source.tracks[input.track].clips ?? []).filter(row=>
      Math.abs(row.beat-from)>eps || Math.abs(row.beat+row.length-to)>eps);
    check(retained.every(row=>row.beat+row.length<=from+eps || row.beat>=to-eps),
      'The search window partly overlaps an existing note clip');
    const roughness=dissonance(), signatures=new Set(), variants=[], blocked=[];
    for (const profile of profiles) {
      const result=search(plan,profile,roughness);
      let chosen;
      for (const path of result.paths) {
        const candidate=realize(plan,profile,result,path);
        const signature=JSON.stringify(candidate.clip.voices.map(voice=>voice.notes.map(note=>
          [note.beat,note.duration,note.midi,Boolean(note.tie)])));
        if (signatures.has(signature)) continue;
        signatures.add(signature);
        chosen=candidate;
        break;
      }
      if (!chosen) {blocked.push(profile);continue;}
      const revision={id:profile,tracks:{[input.track]:{clips:[...retained,chosen.clip]}}};
      const performed=production.compile(production.revise(source,revision,assets),assets);
      check(locked.every(name=>JSON.stringify(music.events[name])===JSON.stringify(performed.events[name])),
        'A voicing take changed a locked outer performance');
      variants.push({id:profile,revision,clip:chosen.clip,
        metrics:{...chosen.metrics,...measure(plan,chosen.clip,roughness)}});
    }
    return P.data.freeze({variants,report:{track:input.track,locked,from,to,preferences:plan.prefs,
      gaps:plan.gaps.map(([from,to])=>({from,to})),blocked}});
  }
  P.musicProduction=Object.freeze({...A,voiceLead});
})(KIT.procedural);
