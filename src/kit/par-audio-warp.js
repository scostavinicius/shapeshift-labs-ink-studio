/* Sample-clock warp maps, transient placement, overlap-add speech and varispeed. */
(function (P) {
  const A=P.mediaGraph, T=P.takeTime, {plain,int,range}=P.mediaGraphSupport;
  const {id}=P.musicInstruments, budget=16e6;
  const modes=['beats','tones','speech','repitch'];
  const only=(row,keys)=>plain(row) && Object.keys(row).every(key=>keys.includes(key));
  const check=(condition,message)=>{if (!condition) throw new RangeError(message);};
  const nearest=([n,d])=>T.index(T.roundDown([2n * n+d,2n * d]));
  const floor=time=>T.index(T.roundDown(time));
  const number=n=>[BigInt(n),1n];
  const clamp=(n,lo,hi)=>Math.max(lo,Math.min(n,hi));
  const sinc=n=>Math.abs(n)<1e-10 ? 1 : Math.sin(Math.PI*n)/(Math.PI*n);

  function warpMap(audio,settings) {
    const {sampleRate,channels,samples}=audio, frames=samples.length/channels;
    check(only(settings,['mode','targetFrames','tempo','speed','fps','markers','detect']) &&
      modes.includes(settings.mode ?? 'beats') &&
      ['targetFrames','tempo','speed'].filter(key=>settings[key]!==undefined).length<=1 &&
      (settings.detect===undefined || (settings.mode ?? 'beats')==='beats' &&
        (settings.detect===false || plain(settings.detect))),
      'Choose a warp mode and at most one duration control');
    const {tempo,speed,fps,markers=[],targetFrames}=settings;
    const max=Math.floor(budget/channels);
    check(frames>=1 && frames<=max && Array.isArray(markers) && markers.length<=4096 &&
      (tempo===undefined || only(tempo,['from','to']) && range(tempo.from,1,1000) && range(tempo.to,1,1000)) &&
      (speed===undefined || range(speed,.125,8)) && (targetFrames===undefined || int(targetFrames,1,max)),
      'Invalid audio warp length, tempo, speed or marker count');
    const frameRate=fps===undefined ? undefined : T.read(fps);
    check(frameRate===undefined || range(T.seconds(frameRate),1,1000),'Invalid picture frame rate');
    const ids=new Set();
    const pins=Array.from(markers,row=>{
      check(only(row,['id','sourceSample','targetSample','targetTime','targetFrame']) &&
        int(row.sourceSample,0,frames) && (row.id===undefined || id(row.id) && !ids.has(row.id)) &&
        ['targetSample','targetTime','targetFrame'].filter(key=>row[key]!==undefined).length===1,
        'Warp markers need one source sample and one target position');
      if (row.id!==undefined) ids.add(row.id);
      let target=row.targetSample;
      if (row.targetTime!==undefined) {
        const time=T.read(row.targetTime);
        check(range(T.seconds(time),0,max/sampleRate),'Warp marker time is outside the output');
        target=floor(T.mul(time,number(sampleRate)));
      }
      if (row.targetFrame!==undefined) {
        check(frameRate && int(row.targetFrame,0,1e9),'Picture markers need a frame index and fps');
        target=floor(T.div(number(row.targetFrame*sampleRate),frameRate));
      }
      check(int(target,0,max),'Warp marker target is outside the output');
      return {sourceSample:row.sourceSample,targetSample:target,kind:'pin',
        ...(row.id!==undefined && {id:row.id}),...(row.targetFrame!==undefined && {targetFrame:row.targetFrame})};
    }).sort((a,b)=>a.sourceSample-b.sourceSample);
    const endPin=pins.at(-1)?.sourceSample===frames ? pins.at(-1) : undefined;
    const end=targetFrames ?? (tempo ? nearest(T.mul(number(frames),T.div(T.read(tempo.from),T.read(tempo.to)))) :
      speed!==undefined ? nearest(T.div(number(frames),T.read(speed))) : endPin?.targetSample ?? frames);
    check(int(end,1,max) && (!endPin || endPin.targetSample===end) &&
      (pins[0]?.sourceSample!==0 || pins[0].targetSample===0),
      'Warp endpoints must agree with the requested output duration');
    if (pins[0]?.sourceSample!==0) pins.unshift({sourceSample:0,targetSample:0,kind:'boundary'});
    if (!endPin) pins.push({sourceSample:frames,targetSample:end,kind:'boundary'});
    for (let i=1;i<pins.length;i++) {
      const a=pins[i-1], b=pins[i], input=b.sourceSample-a.sourceSample, output=b.targetSample-a.targetSample;
      check(input>0 && output>0,'Warp pins must increase in both source and target time');
      check(range(input/output,.125,8),'Each pinned interval must play between one-eighth and eight times its original speed');
    }
    return {pins,frames,end};
  }

  function intervals(pins) {
    return pins.slice(0,-1).map(({sourceSample:from,targetSample:start},i)=>{
      const {sourceSample:to,targetSample:end}=pins[i+1];
      return {from,to,start,end,rate:(to-from)/(end-start)};
    });
  }
  function addTransients(audio, map, settings) {
    if (settings===false) return map.pins;
    const hits=A.detectTransients(audio,settings).events, result=[map.pins[0]];
    const guard=Math.round(audio.sampleRate*.012);
    let index=0;
    for (const [piece,{from,to,start,end,rate}] of intervals(map.pins).entries()) {
      while (index<hits.length && hits[index].detected.sample<to) {
        const hit=hits[index++], sourceSample=hit.detected.sample;
        const targetSample=start+Math.round((sourceSample-from)/rate);
        // A nearby detector suggestion belongs to the attack already described by the pin.
        if (sourceSample-from>guard && to-sourceSample>guard &&
            targetSample>result.at(-1).targetSample && targetSample<end)
          result.push({sourceSample,targetSample,kind:'transient',strength:hit.detected.strength});
      }
      result.push(map.pins[piece+1]);
    }
    return result;
  }
  function copy({channels,samples}, out, from, start, count) {
    for (let i=0;i<count*channels;i++) out[start*channels+i]=samples[from*channels+i];
  }
  function beats(audio,out,{from,to,start,end}) {
    const {channels,sampleRate}=audio, count=Math.min(to-from,end-start);
    copy(audio,out,from,start,count);
    if (to-from===end-start) return;
    const fade=Math.min(Math.round(sampleRate*.004),Math.floor(count/4));
    for (let i=0;i<fade;i++) for (let c=0;c<channels;c++)
      out[(start+count-fade+i)*channels+c]*=(fade-i-1)/fade;
  }
  function repitch({samples,channels},out,pieces) {
    const frames=samples.length/channels;
    const work=pieces.reduce((sum,row)=>sum+(row.end-row.start)*(row.rate===1 ? channels :
      Math.min(160,20*Math.max(1,row.rate))*(channels+2)),0);
    check(work<=2.8e8,'Varispeed exceeds its filter budget');
    for (const {from,start,end,rate} of pieces) {
      if (rate===1) {copy({samples,channels},out,from,start,end-start);continue;}
      const cutoff=rate>1 ? .94/rate : 1, radius=Math.min(80,Math.ceil(9/cutoff));
      for (let frame=start;frame<end;frame++) {
        const pos=from+(frame-start)*rate, base=Math.floor(pos);
        if (cutoff===1 && pos===base) {copy({samples,channels},out,base,frame,1);continue;}
        let total=0;
        for (let at=Math.max(0,base-radius+1);at<=Math.min(frames-1,base+radius);at++) {
          const x=at-pos, weight=sinc(x*cutoff)*sinc(x/radius)*cutoff;
          total+=weight;
          for (let c=0;c<channels;c++) out[frame*channels+c]+=samples[at*channels+c]*weight;
        }
        for (let c=0;c<channels;c++) out[frame*channels+c]/=total;
      }
    }
  }
  function speech(audio,out,pieces) {
    const {channels,sampleRate,samples}=audio, analyzed=Math.min(2,channels);
    const coarse=Math.max(1,Math.round(sampleRate/4500)), search=Math.max(2,Math.round(sampleRate*.009));
    let work=0;
    function choose(previous,ideal,lo,hi,overlap) {
      let best=ideal, bestScore=-Infinity;
      function measure(at,step) {
        work+=Math.ceil(overlap/step)*analyzed;
        check(work<=1.8e8,'Speech warp exceeds its waveform search budget');
        let p=0,q=0,dot=0;
        for (let i=0;i<overlap;i+=step) for (let c=0;c<analyzed;c++) {
          const a=samples[(previous+i)*channels+c], b=samples[(at+i)*channels+c];
          p+=a*a;q+=b*b;dot+=a*b;
        }
        return (p*q>1e-14 ? dot/Math.sqrt(p*q) : 0)-.028*Math.abs(at-ideal)/search;
      }
      for (let at=lo;at<=hi;at+=coarse) {
        const score=measure(at,coarse);
        if (score>bestScore) {best=at;bestScore=score;}
      }
      const start=Math.max(lo,best-coarse), end=Math.min(hi,best+coarse);
      best=ideal;bestScore=measure(ideal,coarse);
      for (let at=start;at<=end;at++) {
        const score=measure(at,coarse);
        if (score>bestScore) {best=at;bestScore=score;}
      }
      return best;
    }
    for (const piece of pieces) {
      const {from,to,start,end,rate}=piece, size=end-start;
      const hop=Math.min(Math.round(sampleRate*.012),Math.floor((to-from)/3),Math.floor(size/2));
      if (rate===1) {copy(audio,out,from,start,size);continue;}
      if (hop<2) {beats(audio,out,piece);continue;}
      copy(audio,out,from,start,Math.min(size,2*hop));
      let previous=from;
      for (let offset=hop;offset<size;offset+=hop) {
        const count=Math.min(2*hop,size-offset), overlap=Math.min(hop,count);
        const maxSource=to-count, ideal=clamp(Math.round(from+offset*rate),from,maxSource);
        const at=count<=hop ? maxSource :
          choose(previous+hop,ideal,Math.max(from,ideal-search),Math.min(maxSource,ideal+search),overlap);
        for (let i=0;i<overlap;i++) {
          const u=.5-.5*Math.cos(Math.PI*(i+1)/(overlap+1));
          for (let c=0;c<channels;c++) {
            const dst=(start+offset+i)*channels+c;
            out[dst]=out[dst]*(1-u)+samples[(at+i)*channels+c]*u;
          }
        }
        copy(audio,out,at+overlap,start+offset+overlap,count-overlap);
        previous=at;
      }
    }
  }

  function warpAudio(input,settings={}) {
    const audio=A.audio(input), {channels,sampleRate,samples}=audio, mode=settings?.mode ?? 'beats';
    const map=warpMap(audio,settings), neutral=map.pins.every(row=>row.sourceSample===row.targetSample);
    const markers=mode==='beats' ? addTransients(audio,map,settings.detect) : map.pins;
    const pieces=intervals(markers);
    let out, gain=1;
    if (neutral) out=samples.slice();
    else {
      out=new Float64Array(map.end*channels);
      if (mode==='beats') for (const piece of pieces) beats(audio,out,piece);
      if (mode==='repitch') repitch(audio,out,pieces);
      if (mode==='speech') speech(audio,out,pieces);
      if (mode==='tones') A.warpTones(audio,out,pieces);
      let peak=1;
      for (const x of out) {
        if (!Number.isFinite(x)) throw new RangeError('Audio warp produced a nonfinite sample');
        peak=Math.max(peak,Math.abs(x));
      }
      gain=1/peak;
      if (gain<1) for (let i=0;i<out.length;i++) out[i]/=peak;
    }
    return {value:{sampleRate,channels,samples:out},report:{
      mode,sampleRate,sourceFrames:map.frames,targetFrames:map.end,gain,markers,
      ...(settings.tempo!==undefined && {tempo:{...settings.tempo}}),
      ...(settings.fps!==undefined && {fps:settings.fps})
    }};
  }
  A.warpAudio=warpAudio;
})(KIT.procedural);
