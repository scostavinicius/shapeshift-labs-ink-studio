/* Play one measured sound across several score voices with shared-time handoffs. */
(function (P) {
  const A=P.mediaGraph,S=P.mediaGraphSupport,I=P.musicInstruments,H=P.musicHarmony;
  const {fields,finite,integer,id,check,clamp}=I;
  const format='ink-studio/timbre-evolution', phases=['attack','body','decay'];
  const round=(n,digits=9)=>Number(n.toFixed(digits));
  const eps=1e-8;

  function interpolate(rows,x,read,maxGap=Infinity) {
    if (!rows.length) return null;
    const i=rows.findIndex(row=>row.sample>=x);
    if (i===0) return read(rows[0]);
    if (i<0) return read(rows.at(-1));
    const a=rows[i-1], b=rows[i], span=b.sample-a.sample;
    if (x===b.sample) return read(b);
    const first=read(a);
    return span>maxGap ? first : first+(read(b)-first)*(x-a.sample)/span;
  }

  function texture(audio,gesture) {
    const {sampleRate,channels,samples}=audio, {active,pitchTrack}=gesture;
    const size=2**Math.round(Math.log2(sampleRate*.034)), plan=S.fftSetup(audio,{size},size,1), step=sampleRate/size;
    const real=new Float64Array(size), imag=new Float64Array(size), bins=new Float64Array(size/2+1);
    const lo=Math.ceil(330/step), hi=Math.min(bins.length-1,Math.floor(10500/step));
    const probe=(i,c)=>samples[i*channels+c] ?? 0;
    const span=active.toSample-active.fromSample;
    const count=Math.max(2,Math.min(65,span,1+Math.ceil(span/(sampleRate*.018))));
    const start=active.fromSample, end=active.toSample-1;
    if (end===start) return [{sample:start,roughness:0}];
    return Array.from({length:count},(_,i)=>{
      const sample=start+Math.round(i*(end-start)/(count-1));
      let energy=0, logarithm=0;
      const powers=new Float64Array(hi-lo+1);
      for (let c=0;c<channels;c++) {
        S.spectrumFrom(probe,c,sample-size/2,plan,real,imag,bins);
        for (let k=lo;k<=hi;k++) powers[k-lo]+=bins[k]**2/channels;
      }
      for (const power of powers) {
        energy+=power;
        logarithm+=Math.log(power+1e-12);
      }
      const average=energy/powers.length;
      const flatness=average>1e-11 ? Math.exp(logarithm/powers.length)/(average+1e-12) : 0;
      const periodicity=pitchTrack.reduce((best,row)=>{
        const near=clamp(1-Math.abs(row.sample-sample)/(sampleRate*.043));
        return Math.max(best,near*row.confidence);
      },0);
      // Flatness is a broadband texture proxy. Nearby periodic evidence
      // reduces it where a stable pitched gesture is still present.
      const roughness=clamp(Math.sqrt(flatness*1.65)*(1-.68*periodicity));
      return {sample,roughness:round(roughness,6)};
    });
  }

  function analyze(source,settings={}) {
    const pcm=S.instrumentAudio(source), gesture=S.timbreGesture.extract(pcm,settings);
    check(gesture.active.toSample-gesture.active.fromSample>=pcm.sampleRate*.015,
      'An evolving gesture needs at least 15 ms of active sound');
    return P.data.freeze({format,version:1,gesture,texture:texture(pcm,gesture)});
  }

  function validate(profile) {
    check(fields(profile,['format','version','gesture','texture']) && profile.format===format && profile.version===1,
      'Expected an evolving timbre profile');
    const gesture=S.timbreGesture.validate(profile.gesture), {fromSample,toSample}=gesture.active;
    check((toSample-fromSample)/gesture.source.sampleRate>=.015 &&
      Array.isArray(profile.texture) && integer(profile.texture.length,2,65) &&
      profile.texture[0]?.sample===fromSample && profile.texture.at(-1)?.sample===toSample-1 &&
      Array.from(profile.texture).every((row,i)=>fields(row,['sample','roughness']) &&
        integer(row.sample,fromSample,toSample-1) && (!i || row.sample>profile.texture[i-1].sample) &&
        finite(row.roughness,0,1)),'Invalid evolving texture profile');
    return profile;
  }

  function windows(gesture,spec={}) {
    check(fields(spec,['bodySample','decaySample','overlap','shape']) &&
      ['linear','equal-power'].includes(spec.shape ?? 'equal-power'),'Invalid timbre handoff settings');
    const {fromSample:start,toSample:end}=gesture.active, span=end-start;
    const clampSample=(value,lo,hi)=>Math.max(start+Math.ceil(lo*span),Math.min(start+Math.floor(hi*span),value));
    const body=spec.bodySample ?? clampSample(gesture.attacks[0].range.toSample,.12,.30);
    const decay=spec.decaySample ?? clampSample(gesture.tail.fromSample,.54,.85);
    check(integer(body,start+1,end-2) && integer(decay,body+1,end-1),'Timbre phase markers must increase inside the active sound');
    const a=(body-start)/span, b=(decay-start)/span;
    const overlap=spec.overlap ?? [Math.min(.13,a*.9,(b-a)*.8),Math.min(.20,(1-b)*.9,(b-a)*.8)];
    check(Array.isArray(overlap) && overlap.length===2 && Array.from(overlap).every(value=>finite(value,0,.5)),
      'Give one overlap fraction for each timbre handoff');
    const [halfA,halfB]=overlap.map(value=>value*.5);
    const fades=[[a-halfA,a+halfA],[b-halfB,b+halfB]];
    check(fades[0][0]>=0 && fades[1][1]<=1 && fades[0][1]<=fades[1][0],
      'Timbre handoffs must stay inside the gesture and have disjoint overlap');
    const knots=Array.from({length:12},(_,i)=>i/11);
    for (const [first,last] of fades) for (let i=0;i<=8;i++) knots.push(first+(last-first)*i/8);
    return {body,decay,knots,shape:spec.shape ?? 'equal-power',fades,
      stages:[[0,fades[0][1]],[fades[0][0],fades[1][1]],[fades[1][0],1]]};
  }

  function settingsFor(raw,base) {
    check(fields(raw,phases) && phases.every(name=>Object.hasOwn(raw,name)),
      'Route attack, body and decay to production tracks');
    return phases.map(name=>{
      const row=raw[name];
      check(fields(row,['part','carry','transpose','pitchAnchor','roughnessTarget','articulation','levelDb']) &&
        id(row.part) && Object.hasOwn(base.tracks,row.part) &&
        fields(row.carry ?? {},['pitch','roughness','envelope']) && Object.values(row.carry ?? {}).every(value=>finite(value,0,1)) &&
        integer(row.transpose ?? 0,-36,36) && ['tonic','entry'].includes(row.pitchAnchor ?? 'tonic') &&
        ['roughness',...P.musicNoteExpression.names].includes(row.roughnessTarget ?? 'roughness') &&
        (row.articulation===undefined || id(row.articulation)) && finite(row.levelDb ?? 0,-36,9),
      'Invalid timbre route for '+name);
      return {name,part:row.part,carry:{pitch:1,roughness:1,envelope:1,...row.carry},transpose:row.transpose ?? 0,
        pitchAnchor:row.pitchAnchor ?? 'tonic',roughnessTarget:row.roughnessTarget ?? 'roughness',
        levelDb:row.levelDb ?? 0,...(row.articulation!==undefined && {articulation:row.articulation})};
    });
  }

  function raisedCosine(fraction,rising,shape) {
    fraction=clamp(fraction);
    if (!rising) fraction=1-fraction;
    if (!fraction || fraction===1 || shape==='linear') return fraction;
    return Math.sin(Math.PI*.5*fraction);
  }

  function automation(route,index,placement,layout,model,pitch) {
    const [from,to]=layout.stages[index], previous=layout.fades[index-1], next=layout.fades[index];
    const inside=[from,to,...layout.knots.filter(phase=>phase>from && phase<to)];
    if (next && next[0]===next[1]) inside.push(to-Math.min(.002,(to-from)*.05));
    const positions=[...new Set(inside.map(x=>round(clamp((x-from)/(to-from)))))].sort((a,b)=>a-b);
    const progress=positions.map(x=>from+(to-from)*x);
    const entry=route.pitchAnchor==='entry' ? model.pitch(from) : 0;
    const target=progress.map(phase=>pitch+placement.transpose+route.transpose+entry+
      (model.pitch(phase)-entry)*route.carry.pitch);
    const pitches=target.map(value=>Math.max(0,Math.min(127,value)));
    const low=Math.min(...pitches), high=Math.max(...pitches);
    const midi=Math.round((low+high)*.5);
    const pitchClipped=pitches.some((value,i)=>value!==target[i] || Math.abs(value-midi)>12+eps);
    const amplitude=progress.map(phase=>{
      const fade=(edge,rising)=>{
        if (!edge) return 1;
        if (edge[0]===edge[1]) return rising || phase<edge[0]-eps ? 1 : 0;
        return raisedCosine((phase-edge[0])/(edge[1]-edge[0]),rising,layout.shape);
      };
      const envelope=route.carry.envelope>0 ? Math.pow(model.level(phase),route.carry.envelope) : 1;
      return round(fade(previous,true)*fade(next,false)*envelope,6);
    });
    const pair=values=>positions.map((phase,i)=>[phase,values[i]]);
    const curves={amplitude:pair(amplitude)};
    if (route.levelDb) curves.gainDb=[[0,route.levelDb]];
    if (pitches.some(value=>Math.abs(value-midi)>eps))
      curves.pitchCents=pair(pitches.map(value=>round(Math.max(-1200,Math.min(1200,(value-midi)*100)),4)));
    if (route.carry.roughness>0) curves[route.roughnessTarget]=pair(progress.map(phase=>
      round(route.carry.roughness*model.roughness(phase),6)));
    return {midi,pitchClipped,play:{curves,...(route.articulation!==undefined && {articulation:route.articulation})}};
  }

  function plan(input,source,settings,assets={}) {
    const profile=validate(input), {gesture}=profile, K=P.musicProduction, base=K.compile(source,assets);
    check(fields(settings,['id','placements','routes','handoffs','tonic','intervalScale']) &&
      id(settings.id ?? 'evolution') && finite(settings.intervalScale ?? 1,0,3) &&
      Array.isArray(settings.placements) && integer(settings.placements.length,1,24),
    'Invalid evolving orchestration settings');
    const name=settings.id ?? 'evolution', layout=windows(gesture,settings.handoffs), routes=settingsFor(settings.routes,base);
    const {active,timeline,source:{sampleRate},peakRms}=gesture, span=active.toSample-active.fromSample;
    const pitchTrack=gesture.pitchTrack.filter((row,i,track)=>[track[i-1],track[i+1]].some(other=>
      other && Math.abs(row.sample-other.sample)<=sampleRate*.055 && Math.abs(row.midi-other.midi)<=4));
    const sampleAt=phase=>Math.min(active.toSample-1,active.fromSample+phase*span);
    const origin=pitchTrack[0]?.midi ?? null;
    const tonic=H.midi(settings.tonic ?? (origin===null ? 60 : Math.min(127,Math.round(origin))));
    const level=timeline.map(row=>({sample:(row.fromSample+row.toSample)*.5,rms:row.rms}));
    const model={
      pitch:phase=>origin===null ? 0 : (interpolate(pitchTrack,sampleAt(phase),row=>row.midi,sampleRate*.14)-origin)*
        (settings.intervalScale ?? 1),
      level:phase=>clamp(interpolate(level,sampleAt(phase),row=>row.rms)/peakRms),
      roughness:phase=>clamp(interpolate(profile.texture,sampleAt(phase),row=>row.roughness))
    };
    const trackClips=new Map(), {clock}=base, seen=new Set();
    const placements=Array.from(settings.placements,(row,i)=>{
      check(fields(row,['id','section','beat','length','transpose','velocity']) && id(row.id ?? 'play-'+i) &&
        id(row.section) && finite(row.beat ?? 0,0,256) && finite(row.length,.0625,256) &&
        integer(row.transpose ?? 0,-36,36) && finite(row.velocity ?? .8,.02,1),'Invalid evolving gesture placement');
      const key=row.id ?? 'play-'+i, section=base.arrangement.sections.find(section=>section.id===row.section);
      const beat=round((section?.beat ?? 0)+(row.beat ?? 0)), end=round(beat+row.length);
      check(section && !seen.has(key) && end<=section.end+eps,'Evolving placements need unique IDs and must fit their section');
      seen.add(key);
      const startTime=clock.timeAt({beat}), endTime=clock.timeAt({beat:end});
      const phaseBeat=phase=>phase===0 ? beat : phase===1 ? end :
        round(clock.sample(startTime+(endTime-startTime)*phase).beat);
      const clipId=name.slice(0,30)+'-'+P.data.hash(key).toString(36), clips=new Map();
      const stages=routes.map((route,index)=>{
        const [from,to]=layout.stages[index], at=phaseBeat(from), stop=phaseBeat(to);
        check(stop-at>=.00002 && (to-from)*(endTime-startTime)>=.002,
          'An orchestration stage is too short to play at this tempo');
        const {midi,play,pitchClipped}=automation(route,index,{transpose:row.transpose ?? 0},layout,model,tonic);
        const note={id:route.name,beat:round(at-beat),duration:round(stop-at),midi,velocity:row.velocity ?? .8,play};
        if (!clips.has(route.part)) clips.set(route.part,[]);
        clips.get(route.part).push({id:route.name,notes:[note]});
        return {stage:route.name,part:route.part,clip:clipId,note:note.id,beat:at,endBeat:stop,midi,pitchClipped};
      });
      for (const [part,voices] of clips) {
        if (!trackClips.has(part)) trackClips.set(part,[]);
        trackClips.get(part).push({id:clipId,beat,length:round(end-beat),mode:'layer',voices});
      }
      return {id:key,section:row.section,beat,endBeat:end,stages,
        handoffs:layout.fades.map(([from,to])=>({beat:phaseBeat(from),endBeat:phaseBeat(to)}))};
    });
    const tracks=Object.fromEntries([...trackClips].map(([part,clips])=>[part,{clips:[...source.tracks[part].clips ?? [],...clips]}]));
    const revision={id:name,tracks};
    const production=K.revise(source,revision,assets);
    return {value:production,revision,report:{id:name,tonic,source:gesture.source,active:gesture.active,
      hasPitch:origin!==null,bodySample:layout.body,decaySample:layout.decay,crossfade:layout.shape,routes,placements}};
  }

  A.timbreEvolution=Object.freeze({analyze,plan});
})(KIT.procedural);
