/* Propose a playable root from voiced YIN frames and mark source gestures. */
(function (P) {
  const A=P.mediaGraph,S=P.mediaGraphSupport,{fields,finite,integer,check}=P.musicInstruments;
  const midi=hz=>69+12*Math.log2(hz/440);
  const round=(n,d=3)=>Number(n.toFixed(d));
  function input(source) {
    const pcm=A.audio(source);
    check(pcm.channels<=2 && integer(pcm.sampleRate,8000,96000) && pcm.samples.length>0 &&
      pcm.samples.length/pcm.channels<=pcm.sampleRate*15,'Use a mono or stereo slice up to 15 seconds at 8 to 96 kHz');
    return pcm;
  }

  function yin(signal,first,width,min,max,threshold,diff) {
    let total=0;
    diff[0]=1;
    for (let lag=1;lag<=max+1;lag++) {
      let error=0;
      for (let i=0;i<width;i++) {
        const delta=signal[first+i]-signal[first+i+lag];
        error+=delta*delta;
      }
      total+=error;
      diff[lag]=total>1e-20 ? error*lag/total : 1;
    }
    let period=0, error=1, limit=max;
    for (let lag=min;lag<=limit;lag++) {
      const a=diff[lag-1],b=diff[lag],c=diff[lag+1],curve=a-2*b+c;
      if (b>=threshold || b>a || b>c || curve<=0) continue;
      const fraction=Math.max(-.5,Math.min(.5,.5*(a-c)/curve));
      const residual=Math.max(0,b+.5*(c-a)*fraction+.5*curve*fraction*fraction);
      if (!period) limit=Math.min(max,Math.floor(lag*1.8));
      // A narrow vowel can create a nearby shallow dip. Favor a substantially
      // clearer period without exchanging a convincing cycle for its multiples.
      if (!period || residual+.028<error && residual<error*.68) {
        period=lag+fraction;
        error=residual;
      }
    }
    return period ? {period,confidence:1-error} : null;
  }

  function analyzeTake(source,settings) {
    const {sampleRate,channels,samples}=input(source), frames=samples.length/channels;
    check(fields(settings,['lowHz','highHz','threshold','detect','attackMs','probeRate','windowMs','hopMs']) &&
      finite(settings.lowHz ?? 55,35,4000) && finite(settings.highHz ?? 1100,300,8000) &&
      finite(settings.probeRate ?? 8000,8000,24000) && finite(settings.windowMs ?? 30,8,80) &&
      finite(settings.hopMs ?? 18,4,50) &&
      finite(settings.threshold ?? .18,.04,.3) && finite(settings.attackMs ?? 32,0,180),
    'Invalid pitch analysis or attack settings');
    const {lowHz=55,highHz=1100,threshold=.18,attackMs=32,probeRate=8000,windowMs=30,hopMs=18}=settings;
    const stride=Math.max(1,Math.floor(sampleRate/probeRate)), rate=sampleRate/stride;
    check(highHz>lowHz && highHz<=rate*.4,'Pitch bounds need to fit the analysis sampling rate');
    const probeLength=Math.floor(frames/stride), mono=new Float64Array(probeLength), power=new Float64Array(probeLength+1);
    let channel=0, peak=0, level=0;
    if (channels===2) {
      const peaks=[0,0];
      for (let i=0;i<samples.length;i++) peaks[i%2]+=samples[i]*samples[i];
      if (peaks[1]>peaks[0]) channel=1;
    }
    for (let i=0;i<frames;i++) {
      const x=samples[i*channels+channel];
      peak=Math.max(peak,Math.abs(x));
      if (i<probeLength*stride) mono[Math.floor(i/stride)]+=x/stride;
    }
    for (let i=0;i<probeLength;i++) power[i+1]=power[i]+mono[i]**2;
    const min=Math.max(2,Math.floor(rate/highHz)), max=Math.ceil(rate/lowHz);
    const width=Math.max(max*2,Math.round(rate*windowMs/1000)), diff=new Float64Array(max+2);
    const hop=Math.max(Math.round(rate*hopMs/1000),Math.ceil(probeLength/224));
    const active=[], voiced=[], noisy=[], ratio=threshold;
    for (let at=0;at<probeLength;at+=hop) {
      const end=Math.min(probeLength,at+hop);
      const rms=Math.sqrt(Math.max(0,power[end]-power[at])/(end-at));
      level=Math.max(level,rms);
      if (rms<Math.max(.0015,peak*.075)) continue;
      const sample=at*stride, until=end===probeLength ? frames : end*stride;
      active.push({fromSample:sample,toSample:until});
      const start=Math.min(Math.max(0,Math.round(at+hop/2-width/2-max/3)),probeLength-width-max-1);
      const guess=start>=0 ? yin(mono,start,width,min,max,ratio,diff) : null;
      if (guess && finite(rate/guess.period,lowHz,highHz)) {
        const hz=rate/guess.period;
        voiced.push({sample:Math.min(frames-1,sample+Math.floor((end-at)*stride/2)),hz,midi:midi(hz),
          confidence:guess.confidence,weight:rms*guess.confidence});
      } else {
        const old=noisy.at(-1);
        if (old?.toSample===sample) old.toSample=until;
        else noisy.push({fromSample:sample,toSample:until});
      }
    }
    const total=voiced.reduce((sum,row)=>sum+row.weight,0), voicedFraction=voiced.length/Math.max(1,active.length);
    let root=null;
    if (voiced.length && voicedFraction>=.20) {
      const sorted=[...voiced].sort((a,b)=>a.midi-b.midi), deviation=sorted.at(-1).midi-sorted[0].midi;
      let middle=0;
      const candidate=sorted.find(row=>(middle+=row.weight)>=total/2);
      const agreement=sorted.reduce((sum,row)=>sum+(Math.abs(row.midi-candidate.midi)<=.65 ? row.weight : 0),0)/total;
      const periodicity=sorted.reduce((sum,row)=>sum+row.confidence*row.weight,0)/total;
      root={hz:round(candidate.hz),midi:round(candidate.midi),suggestedNote:Math.round(candidate.midi),
        confidence:round(periodicity*Math.sqrt(agreement*voicedFraction)),spreadCents:round(100*deviation,1)};
    }
    const {events}=A.detectTransients(source,settings.detect ?? {});
    const firstActive=active[0]?.fromSample ?? 0;
    const protectedFrames=peak>0 ? Math.min(frames,firstActive+Math.round(sampleRate*attackMs/1000)) : 0;
    return {sampleRate,channels,frames,root,voicedFraction:round(voicedFraction),peak,peakRms:level,protectedFrames,
      pitchTrack:voiced.map(({sample,hz,confidence})=>({sample,hz:round(hz),confidence:round(confidence)})),
      attacks:events.map(({id,detected})=>({id,sample:detected.sample,strength:detected.strength})),noisy};
  }

  function bank(assets,options={}) {
    const {record,id}=P.musicInstruments;
    check(record(assets) && integer(Object.keys(assets).length,1,24) && Object.keys(assets).every(id),
      'A sample instrument needs one to 24 named takes');
    let total=0;
    const takes=Object.fromEntries(Object.entries(assets).map(([name,raw])=>{
      const pcm=input(raw);
      total+=pcm.samples.length/pcm.channels/pcm.sampleRate;
      check(total<=90,'Sample bank analysis exceeds 90 seconds of source audio');
      return [name,analyzeTake(pcm,options)];
    }));
    return {takes};
  }

  Object.assign(S,{instrumentAudio:input,analyzeInstrumentBank:bank});
  A.yinPitchLag=yin;
})(KIT.procedural);
