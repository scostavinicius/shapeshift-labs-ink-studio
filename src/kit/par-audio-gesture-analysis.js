/* Acoustic coordinates for a corpus of short, nondestructive audio gestures. */
(function (P) {
  const A=P.mediaGraph,S=P.mediaGraphSupport,{fields,finite,integer,record,check,db}=P.musicInstruments;
  const clamp=n=>Math.min(1,Math.max(0,n));
  const round=n=>Number(n.toFixed(5));
  const coordinates={
    duration:[0,15,.5], pitchMotion:[-48,48,5], tailRoughness:[0,1,.5],
    voicedFraction:[0,1,.6], brightness:[0,1,.4], tailLevel:[-120,24,24], attackRate:[0,1000,12]
  };
  const version=1;
  const descriptorFields=['version',...Object.keys(coordinates),'root','peak','rms'];
  const med=rows=>[...rows].sort((a,b)=>a-b)[rows.length>>1];
  const text=value=>typeof value==='string' && value.trim().length>0 && value.length<=512;

  function measure({samples,channels,sampleRate},from=0,to=samples.length/channels) {
    let power=0,highPower=0,peak=0;
    const low=new Float64Array(channels), weight=1-Math.exp(-2*Math.PI*1600/sampleRate);
    for (let i=from;i<to;i++) for (let c=0;c<channels;c++) {
      const x=samples[i*channels+c];
      low[c]+=weight*(x-low[c]);
      power+=x*x;
      highPower+=(x-low[c])**2;
      peak=Math.max(peak,Math.abs(x));
    }
    return {rms:Math.sqrt(power/((to-from)*channels)),peak,brightness:clamp(Math.sqrt(highPower/(power || 1)))};
  }

  function describe(source) {
    const pcm=S.instrumentAudio(source), {sampleRate,channels,samples}=pcm, frames=samples.length/channels;
    const full=measure(pcm);
    const analysis=full.peak && full.peak!==1 ? {...pcm,samples:Float64Array.from(samples,x=>x/full.peak)} : pcm;
    const {takes:{slice:{pitchTrack,root,voicedFraction,noisy,attacks}}}=S.analyzeInstrumentBank({slice:analysis});
    const third=Math.max(1,Math.floor(pitchTrack.length/3));
    const span=(pitchTrack.at(-1)?.sample ?? 0)-(pitchTrack[0]?.sample ?? 0);
    const motion=pitchTrack.length>=4 && span>=Math.min(sampleRate*.12,frames*.35) ?
      12*Math.log2(med(pitchTrack.slice(-third).map(row=>row.hz))/med(pitchTrack.slice(0,third).map(row=>row.hz))) : null;
    const tailAt=Math.floor(frames*2/3);
    const tail=measure(pcm,tailAt);
    const noisyTail=noisy.reduce((sum,range)=>sum+Math.max(0,range.toSample-Math.max(tailAt,range.fromSample)),0);
    return {version,duration:frames/sampleRate,pitchMotion:motion===null ? null : round(Math.max(-48,Math.min(48,motion))),
      tailRoughness:round(clamp(.8*noisyTail/(frames-tailAt)+.2*tail.brightness)),voicedFraction,
      brightness:round(full.brightness),tailLevel:round(Math.max(-120,Math.min(24,20*Math.log10(tail.rms/(full.rms || 1))))),
      attackRate:round(Math.min(1000,attacks.length*sampleRate/frames)),root,peak:full.peak,rms:full.rms};
  }

  // A deliberately small vocabulary. Unknown language should lead to an explicit query.
  function phrase(source) {
    check(text(source),'Enter a descriptor query or a JSON search');
    const targets={}, filters={};
    let words=source.toLowerCase().replace(/[.,]/g,' ');
    function use(pattern, apply) {
      const matches=Array.from(words.matchAll(pattern));
      check(matches.length<=1,'A gesture phrase can set each descriptor or articulation once');
      if (matches.length) {
        apply(matches[0][1]);
        words=words.replace(pattern,' ');
      }
    }
    use(/\b(short|long)\b/g,word=>{targets.duration={value:word==='short' ? .45 : 2,weight:1};});
    use(/\b(rising|falling|steady) pitch\b/g,word=>{
      targets.pitchMotion={value:{rising:4,falling:-4,steady:0}[word],weight:2};
    });
    use(/\b(rough|smooth) tail\b/g,word=>{targets.tailRoughness={value:word==='rough' ? .85 : .05,weight:1.5};});
    use(/\b(breath|scrape|metal)\b/g,word=>{filters.articulation=word;});
    check(!words.replace(/\b(a|an|the|with|and|find)\b/g,'').trim() &&
      (Object.keys(targets).length || Object.keys(filters).length),'Unknown gesture query terms. Use JSON descriptor targets and filters.');
    return {targets,filters};
  }

  function search(entries,options={}) {
    check(Array.isArray(entries) && entries.length<=16384,'Gesture search supports up to 16384 slices');
    const filterNames=['session','take','material','articulation','tag','perspective','origin','license'];
    check(fields(options,['phrase','filters','targets','offset','limit']) &&
      (options.phrase===undefined || typeof options.phrase==='string') &&
      fields(options.filters ?? {},filterNames) && fields(options.targets ?? {},Object.keys(coordinates)) &&
      integer(options.limit ?? 12,1,100) && integer(options.offset ?? 0,0,16384),'Invalid gesture search options');
    const shorthand=options.phrase===undefined ? {targets:{},filters:{}} : phrase(options.phrase);
    const filters={...shorthand.filters,...options.filters}, targets={...shorthand.targets,...options.targets};
    check(Object.values(filters).every(text),'Invalid gesture search filter');
    const weights=Object.entries(targets).map(([key,setting])=>{
      const [lo,hi,scale]=coordinates[key];
      const plan=typeof setting==='number' ? {value:setting} : setting;
      check(fields(plan,['value','weight','tolerance']) && finite(plan.value,lo,hi) &&
        finite(plan.weight ?? 1,.01,100) && finite(plan.tolerance ?? scale,.0001,1000),'Invalid target for '+key);
      return [key,plan.value,plan.weight ?? 1,plan.tolerance ?? scale];
    });
    const totalWeight=weights.reduce((sum,row)=>sum+row[2],0);
    const fold=value=>String(value ?? '').trim().toLowerCase();
    const ids=new Set(), items=[];
    for (const entry of entries) {
      const d=entry?.descriptors;
      check(record(entry) && text(entry.id) && !ids.has(entry.id) && fields(d,descriptorFields) && d.version===version &&
        [entry.tags,entry.perspectives].every(values=>values===undefined || Array.isArray(values) && values.every(text)) &&
        Object.entries(coordinates).every(([key,[lo,hi]])=>key==='pitchMotion' && d[key]===null || finite(d[key],lo,hi)),
      'Invalid or duplicate acoustic index entry');
      ids.add(entry.id);
      if (Object.entries(filters).some(([key,value])=>{
        if (key==='tag') return !entry.tags?.some(tag=>fold(tag)===fold(value));
        if (key==='perspective') return !entry.perspectives?.some(mic=>fold(mic)===fold(value));
        return fold(entry[key])!==fold(value);
      })) continue;
      const distances=Object.fromEntries(weights.map(([key,target,weight,tolerance])=>
        [key,round(weight*(d[key]===null ? 1 : clamp(Math.abs(d[key]-target)/tolerance)))]));
      const distance=totalWeight ? round(Object.values(distances).reduce((sum,value)=>sum+value,0)/totalWeight) : 0;
      items.push({...entry,distance,distances});
    }
    items.sort((a,b)=>a.distance-b.distance || (a.id<b.id ? -1 : a.id>b.id ? 1 : 0));
    const {offset=0,limit=12}=options;
    return {total:items.length,items:items.slice(offset,offset+limit),query:{filters,targets:Object.fromEntries(
      weights.map(([key,value,weight,tolerance])=>[key,{value,weight,tolerance}]))}};
  }

  function audition(rows,options={}) {
    check(Array.isArray(rows) && integer(rows.length,1,32) &&
      fields(options,['sampleRate','targetRmsDb','peakDb','gapSeconds','maxGainDb','levelMatch']), 'Invalid gesture audition');
    const {sampleRate=rows[0]?.value?.sampleRate,targetRmsDb=-23,peakDb=-3,gapSeconds=.28,maxGainDb=24,levelMatch='individual'}=options;
    check(integer(sampleRate,8000,96000) && finite(targetRmsDb,-48,-10) && finite(peakDb,-12,-1) &&
      finite(gapSeconds,0,2) && finite(maxGainDb,0,36) && ['individual','shared'].includes(levelMatch),
      'Invalid gesture audition levels or clock');
    const gap=Math.round(gapSeconds*sampleRate);
    let length=0,work=0;
    const clips=rows.map(row=>{
      check(fields(row,['id','value']) && text(row.id),'Audition clip needs an ID and audio');
      const source=S.instrumentAudio(row.value), frames=source.samples.length/source.channels;
      const step=source.sampleRate/sampleRate, count=Math.max(1,Math.round(frames/step));
      const reader=S.pcmReader(source,0,frames,step), startSample=length;
      length+=count+gap;
      work+=count*reader.cost;
      check(length<=90*sampleRate+gap && work<=100e6,'Gesture audition exceeds the playback budget');
      const samples=new Float64Array(count*2), pair=[0,0];
      for (let i=0;i<count;i++) {
        reader.read(i*step,pair);
        samples[i*2]=pair[0];
        samples[i*2+1]=pair[1];
      }
      const {peak,rms}=measure({sampleRate,channels:2,samples});
      const gain=rms ? Math.min(db(maxGainDb),db(targetRmsDb)/rms,db(peakDb)/peak) : 1;
      return {samples,report:{id:row.id,startSample,endSample:startSample+count,gain,peak,rms}};
    });
    const samples=new Float64Array((length-gap)*2);
    const activeGains=clips.filter(row=>row.report.rms>0).map(row=>row.report.gain);
    const sharedGain=levelMatch==='shared' ? (activeGains.length ? Math.min(...activeGains) : 1) : undefined;
    const reports=clips.map(clip=>{
      const {startSample,peak,rms}=clip.report, gain=sharedGain ?? clip.report.gain;
      for (let i=0;i<clip.samples.length;i++) samples[2*startSample+i]=clip.samples[i]*gain;
      return {...clip.report,gain,peak:peak*gain,rms:rms*gain};
    });
    return {value:{sampleRate,channels:2,samples},report:{sampleRate,targetRmsDb,peakDb,gapSamples:gap,
      ...(sharedGain!==undefined && {sharedGain}),clips:reports}};
  }

  A.gestureBank=Object.freeze({describe,search,audition});
})(KIT.procedural);
