/* Extract and project a recording's pitch contour, attacks and decay. */
(function (P) {
  const A=P.mediaGraph,S=P.mediaGraphSupport,H=P.musicHarmony, M=P.musicMotif;
  const {check,fields,finite,id,integer,clamp}=P.musicInstruments;
  const format='ink-studio/timbre-gesture', round=n=>Number(n.toFixed(6));
  const shape=audio=>({sampleRate:audio.sampleRate,channels:audio.channels,frames:audio.samples.length/audio.channels});
  const midi=hz=>69+12*Math.log2(hz/440);
  const average=values=>values.reduce((sum,x)=>sum+x,0)/values.length;
  const range=(fromSample,toSample)=>({fromSample,toSample});

  function extract(input,settings={}) {
    const audio=S.instrumentAudio(input), source=shape(audio), {frames,sampleRate,channels}=source;
    check(fields(settings,['id','pitch','detect','floorDb','confidence','tailSample']) &&
      id(settings.id ?? 'gesture') && fields(settings.pitch ?? {},['lowHz','highHz','probeRate','windowMs','hopMs','threshold']) &&
      finite(settings.floorDb ?? -27,-50,-9) && finite(settings.confidence ?? .72,.5,.99),
    'Invalid timbre extraction settings');
    const {pitch={},detect={},id:name='gesture',floorDb=-27,confidence=.72,tailSample}=settings;
    const hop=Math.max(1,Math.round(sampleRate*.006),Math.ceil(frames/256));
    const timeline=[], low=new Float64Array(channels), weight=1-Math.exp(-2*Math.PI*1500/sampleRate);
    let highLevel=0;
    for (let from=0;from<frames;from+=hop) {
      const to=Math.min(frames,from+hop);
      let power=0,high=0;
      for (let i=from*channels;i<to*channels;i++) {
        const x=audio.samples[i], channel=i%channels;
        low[channel]+=(x-low[channel])*weight;
        power+=x*x;
        high+=(x-low[channel])**2;
      }
      const rms=Math.sqrt(power/((to-from)*channels));
      timeline.push({...range(from,to),rms:round(rms),brightness:round(clamp(Math.sqrt(high/(power || 1))))});
      highLevel=Math.max(highLevel,rms);
    }
    check(highLevel>1e-6,'Timbre analysis needs an audible recording');
    const threshold=highLevel*10**(floorDb/20);
    const active=timeline.filter(row=>row.rms>=threshold);
    check(active.length,'No audible source range');
    const from=active[0].fromSample,to=active.at(-1).toSample;
    const probeRate=pitch.probeRate ?? 24000;
    const defaults={lowHz:70,highHz:Math.min(4800,sampleRate*.4,probeRate*.4),probeRate,windowMs:15,hopMs:6};
    const {takes:{source:analysis}}=S.analyzeInstrumentBank({source:audio},{...defaults,...pitch,
      detect:{minGap:.041,minStrength:.017,sensitivity:1.45,...detect}});
    const adjacent=analysis.pitchTrack.filter(row=>row.sample>=from && row.sample<to && row.confidence>=confidence);
    const pitchTrack=adjacent.map((row,i)=>{
      const local=adjacent.slice(Math.max(0,i-1),i+2)
        .filter(other=>Math.abs(other.sample-row.sample)<=sampleRate*.11).map(other=>midi(other.hz)).sort((a,b)=>a-b);
      return {sample:row.sample,midi:round(local[local.length>>1]),confidence:row.confidence};
    }).filter((row,i,all)=>all.some((other,j)=>i!==j && Math.abs(row.sample-other.sample)<=sampleRate*.13));
    const byStrength=analysis.attacks.filter(row=>row.sample>=Math.max(0,from-hop) && row.sample<to-1)
      .sort((a,b)=>b.strength-a.strength || a.sample-b.sample).slice(0,24).sort((a,b)=>a.sample-b.sample);
    if (!byStrength.length || byStrength[0].sample-from>Math.round(.035*sampleRate))
      byStrength.unshift({id:'hit-'+from,sample:from,strength:0});
    const max=Math.max(...byStrength.map(row=>row.strength),1e-6);
    const attacks=byStrength.map(({id,sample,strength},i)=>{
      const start=Math.max(0,sample), end=Math.min(to,byStrength[i+1]?.sample ?? to,
        start+Math.round(sampleRate*.063));
      return {id,sample:start,strength:round(strength/max),range:range(start,Math.max(start+1,end))};
    });
    const earliest=Math.max(from,attacks.at(-1).sample), peakAfter=timeline.filter(row=>row.toSample>earliest && row.fromSample<to)
      .reduce((best,row)=>!best || row.rms>best.rms ? row : best,null);
    const target=earliest+Math.round((to-earliest)*.51);
    const faded=timeline.find(row=>row.fromSample>=Math.max(target,peakAfter?.fromSample ?? target) &&
      row.fromSample<to-hop && row.rms<.68*(peakAfter?.rms ?? highLevel));
    const tailFrom=tailSample ?? Math.min(to-1,Math.max(from,faded?.fromSample ?? target));
    check(integer(tailFrom,from,to-1),'Tail sample must sit inside the active recording');
    const pitchAtTail=pitchTrack.filter(row=>row.sample>=tailFrom);
    const tail={...range(tailFrom,to),midi:pitchAtTail.length>=2 ? round(average(pitchAtTail.map(row=>row.midi))) : null};
    return P.data.freeze({format,version:1,id:name,source,active:range(from,to),peakRms:round(highLevel),
      pitchTrack,attacks,tail,timeline});
  }
  function validate(profile) {
    const {source:raw,active,attacks,tail,timeline,pitchTrack}=profile ?? {};
    check(fields(profile,['format','version','id','source','active','peakRms','pitchTrack','attacks','tail','timeline']) &&
      profile.format===format && profile.version===1 && id(profile.id) &&
      fields(raw,['sampleRate','channels','frames']) && integer(raw.sampleRate,8000,96000) && integer(raw.channels,1,2) &&
      integer(raw.frames,1,15*raw.sampleRate) && finite(profile.peakRms,1e-6,1),'Invalid timbre gesture profile');
    const window=(row,extra=[])=>fields(row,['fromSample','toSample',...extra]) &&
      integer(row.fromSample,0,raw.frames-1) && integer(row.toSample,row.fromSample+1,raw.frames);
    const ordered=(rows,key)=>rows.every((row,i)=>!i || row[key]>rows[i-1][key]);
    check(window(active) && window(tail,['midi']) && tail.fromSample>=active.fromSample && tail.toSample===active.toSample &&
      (tail.midi===null || finite(tail.midi,0,160)) && Array.isArray(timeline) && integer(timeline.length,1,256) &&
      Array.from(timeline).every(row=>window(row,['rms','brightness']) && finite(row.rms,0,1) && finite(row.brightness,0,1)) &&
      ordered(timeline,'fromSample') && Array.isArray(attacks) && integer(attacks.length,1,25) &&
      Array.from(attacks).every(row=>fields(row,['id','sample','strength','range']) && id(row.id) &&
        integer(row.sample,0,active.toSample-1) && finite(row.strength,0,1) && window(row.range) &&
        row.range.fromSample===row.sample) && ordered(attacks,'sample') &&
      new Set(attacks.map(row=>row.id)).size===attacks.length && Array.isArray(pitchTrack) && pitchTrack.length<=224 &&
      Array.from(pitchTrack).every(row=>fields(row,['sample','midi','confidence']) && integer(row.sample,active.fromSample,active.toSample-1) &&
        finite(row.midi,0,160) && finite(row.confidence,0,1)) && ordered(pitchTrack,'sample'),
    'Invalid measured timbre envelope, attacks or pitch path');
    return profile;
  }
  const levelAt=(profile,sample)=>profile.timeline.find(row=>row.toSample>sample) ?? profile.timeline.at(-1);
  function curves(profile,from,to) {
    const samples=[0,.25,.57,1].map(p=>levelAt(profile,from+p*(to-from)));
    const reference=Math.max(...samples.map(row=>row.rms),1e-6);
    const pair=(values,fn)=>values.map((row,i)=>[[0,.25,.57,1][i],round(fn(row))]);
    return {gainDb:pair(samples,row=>Math.max(-22,20*Math.log10(Math.max(row.rms,1e-8)/reference))),
      cutoffHz:pair(samples,row=>950+7900*row.brightness)};
  }
  function project(input,settings={}) {
    const profile=validate(input), {active,source,attacks,pitchTrack,tail}=profile,{sampleRate}=source;
    const span=active.toSample-active.fromSample;
    check(fields(settings,['beats','tonic','scale','grid','pitchStep','minNoteMs','intervalScale','tailBeats','bend']) &&
      finite(settings.beats ?? 2,.125,64) && finite(settings.pitchStep ?? .85,.35,12) &&
      finite(settings.minNoteMs ?? 18,4,500) && finite(settings.intervalScale ?? 1,.15,3) &&
      finite(settings.tailBeats ?? 1,.0625,16) && finite(settings.grid ?? 0,0,4) &&
      (settings.bend===undefined || typeof settings.bend==='boolean'),'Invalid timbre-to-score projection settings');
    const {beats=2,tonic='C4',scale,grid=0,pitchStep=.85,minNoteMs=18,intervalScale=1,tailBeats=1,bend=true}=settings;
    const root=H.midi(tonic), degrees=scale===undefined ? null : H.scaleSteps(scale);
    const position=sample=>Math.max(0,Math.min(beats,beats*(sample-active.fromSample)/span));
    const at=sample=>{
      const raw=position(sample);
      return round(grid ? Math.min(beats-.00001,Math.round(raw/grid)*grid) : raw);
    };
    const anchors=pitchTrack.slice(0,Math.min(3,pitchTrack.length)).map(row=>row.midi).sort((a,b)=>a-b);
    const origin=anchors.length ? anchors[anchors.length>>1] : null;
    const nearest=value=>{
      const number=Math.min(127,Math.max(0,value));
      return degrees ? Array.from({length:128},(_,i)=>i).filter(i=>degrees.includes(((i-root)%12+12)%12))
        .reduce((best,i)=>Math.abs(i-number)<Math.abs(best-number) ? i : best) : Math.round(number);
    };
    const tailMidi=tail.midi===null || origin===null ? root : nearest(root+(tail.midi-origin)*intervalScale);
    const reference=pitchTrack.map(row=>({...row,value:root+(row.midi-origin)*intervalScale}));
    const clusters=[], window=Math.round(sampleRate*minNoteMs/1000);
    for (const point of reference) {
      const group=clusters.at(-1), prior=group?.at(-1);
      const gap=prior && point.sample-prior.sample>Math.max(window*1.6,sampleRate*.045);
      const change=group && point.sample-group[0].sample>=window && Math.abs(point.value-group[0].value)>=pitchStep;
      if (!prior || gap || change) clusters.push([point]);
      else group.push(point);
    }
    const pitches=[];
    for (const [i,rows] of clusters.entries()) {
      const first=rows[0], final=rows.at(-1);
      const from=Math.max(active.fromSample,first.sample-Math.round(sampleRate*.004));
      const to=Math.min(active.toSample,clusters[i+1]?.[0].sample-Math.round(sampleRate*.004) || active.toSample,
        Math.max(final.sample+Math.round(sampleRate*.006),from+window));
      const start=at(from), stop=round(position(to));
      const previous=pitches.at(-1), note=nearest(average(rows.map(row=>row.value)));
      if (stop-start<.005 || previous && start<previous.beat+previous.duration-1e-9) continue;
      const play=curves(profile,from,to);
      if (bend) play.pitchCents=[rows[0],rows[rows.length>>1],rows.at(-1)].map((row,j)=>
        [[0,.5,1][j],round(Math.max(-95,Math.min(95,(row.value-note)*100)))]);
      const velocity=round(.43+.51*clamp(levelAt(profile,first.sample).rms/profile.peakRms));
      pitches.push({id:'pitch-'+first.sample,beat:start,duration:Math.min(round(stop-start),beats-start),
        midi:note,velocity,play:{curves:play}});
    }
    const hits=[];
    for (const [i,row] of attacks.entries()) {
      const start=at(row.sample), next=attacks[i+1] ? at(attacks[i+1].sample) : beats;
      if (next-start<.00001) continue;
      hits.push({id:row.id,beat:start,duration:round(Math.min(.19,(next-start)*.72)),
        velocity:round(.57+.34*Math.sqrt(row.strength))});
    }
    check(hits.length,'Attack quantization exceeds the projected phrase');
    const trail=at(tail.fromSample), total=Math.max(beats,trail+tailBeats);
    const chosen=pitches.length<=64 ? pitches : Array.from({length:64},(_,i)=>pitches[Math.round(i*(pitches.length-1)/63)]);
    const motifs={contour:chosen.length ? M.motif({length:beats,events:chosen}) : null,
      attacks:M.motif({length:beats,events:hits}),
      tail:M.motif({length:total,events:[{id:'tail-'+tail.fromSample,beat:trail,duration:tailBeats,midi:tailMidi,
        velocity:.73,play:{curves:curves(profile,tail.fromSample,tail.toSample)}}]})};
    return P.data.freeze({id:profile.id,beats,total,root,source,origin,tail:range(tail.fromSample,tail.toSample),
      attacks:attacks.filter(row=>hits.some(hit=>hit.id===row.id)),motifs});
  }
  function compare(target,candidates,options={}) {
    const source=validate(target);
    check(fields(options,['gain','brightness']) && finite(options.gain ?? 1,0,8) &&
      finite(options.brightness ?? 1,0,8) && (options.gain ?? 1)+(options.brightness ?? 1)>0 &&
      Array.isArray(candidates) && integer(candidates.length,1,32),'Invalid gesture matching options');
    const phases=['attack','body','tail'];
    const marks=profile=>{
      const {active,tail,attacks}=profile;
      const start=active.fromSample,end=active.toSample;
      const edge=Math.min(tail.fromSample,attacks[0].range.toSample,start+(end-start)*.28);
      return [[start,edge],[edge,tail.fromSample],[tail.fromSample,end]].map(([a,b])=>
        [0,.25,.5,.75,1].map(fraction=>{
          const row=levelAt(profile,a+(b-a)*fraction);
          return [clamp(row.rms/profile.peakRms),row.brightness];
        }));
    };
    const wanted=marks(source), gains=[options.gain ?? 1,options.brightness ?? 1], total=gains[0]+gains[1];
    const rows=Array.from(candidates,profile=>{
      const actual=marks(validate(profile));
      const distances=actual.map((values,i)=>round(average(values.map((row,j)=>
        Math.sqrt((gains[0]*(row[0]-wanted[i][j][0])**2+gains[1]*(row[1]-wanted[i][j][1])**2)/total)))));
      return {id:profile.id,distance:round(average(distances)),
        phases:Object.fromEntries(phases.map((name,i)=>[name,distances[i]]))};
    });
    check(new Set(rows.map(row=>row.id)).size===rows.length,'Candidate profile IDs must be unique');
    return rows.sort((a,b)=>a.distance-b.distance || a.id.localeCompare(b.id));
  }
  S.timbreGesture=Object.freeze({extract,project,compare,validate,shape});
})(KIT.procedural);
