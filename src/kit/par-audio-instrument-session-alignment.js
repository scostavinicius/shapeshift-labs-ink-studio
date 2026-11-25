/* Nondestructive clock and polarity estimates from shared recording transients. */
(function (P) {
  const S=P.mediaGraphSupport,{check,fields,record,integer,finite}=P.musicInstruments;
  const frameCount=({pcm})=>pcm.samples.length/pcm.channels;
  const covers=(mic,take,offset)=>take.fromSample+offset>=0 && take.toSample+offset<=frameCount(mic);
  const emphasize=({pcm:{samples,channels}},channel)=>at=>
    (samples[at*channels+channel] ?? 0)-.96*(samples[(at-1)*channels+channel] ?? 0);

  function onset(read,from,to,rate) {
    const step=Math.max(1,Math.round(rate*.003)),powers=[];
    let peak=0;
    for (let at=from;at<to;at+=step) {
      const end=Math.min(to,at+step);
      let sum=0;
      for (let i=at;i<end;i++) sum+=read(i)**2;
      const power=sum/(end-at);
      powers.push(power);
      peak=Math.max(peak,power);
    }
    const first=powers.findIndex(power=>power>=Math.max(1e-9,peak*.035));
    return first<0 ? null : from+step*first;
  }

  function align(session,assets,options={}) {
    const {clock,median,round}=S.instrumentSessionAnalysis;
    const {rate,perspective,mics,takes}=clock(session,assets,{allowIncomplete:true});
    const {reference=perspective,maxShiftMs=80,windowMs=24,minCorrelation=.3,
      correctPolarity=true,retainDelaySamples={},channels={},syncSamples}=options ?? {};
    check(fields(options,['reference','maxShiftMs','windowMs','minCorrelation','correctPolarity',
      'retainDelaySamples','channels','syncSamples']) && Object.keys(mics).length>=2 && Object.hasOwn(mics,reference) &&
      finite(maxShiftMs,1,250) && finite(windowMs,8,40) && finite(minCorrelation,.15,.95) &&
      typeof correctPolarity==='boolean' && record(retainDelaySamples) &&
      Object.entries(retainDelaySamples).every(([name,n])=>name!==reference && Object.hasOwn(mics,name) &&
        integer(n,-Math.round(rate*.05),Math.round(rate*.05))) && record(channels) &&
      Object.entries(channels).every(([name,ch])=>Object.hasOwn(mics,name) && integer(ch,0,mics[name].pcm.channels-1)) &&
      (syncSamples===undefined || Array.isArray(syncSamples) && integer(syncSamples.length,1,16) &&
        Array.from(syncSamples).every((n,i)=>integer(n,0,32e6) && (!i || n>syncSamples[i-1]))),
    'Choose a reference mic, bounded alignment settings and optional ordered slate samples');
    const ref=mics[reference], refRead=emphasize(ref,channels[reference] ?? 0), radius=Math.round(maxShiftMs*rate/1000);
    const width=Math.round(windowMs*rate/1000),lead=Math.round(rate*.003), length=2*radius+width;
    const fftSize=2**Math.ceil(Math.log2(length)), {transform}=S.fftSetup({sampleRate:rate},{size:fftSize},fftSize,1);
    const sorted=takes.slice().sort((a,b)=>a.fromSample-b.fromSample), count=Math.min(12,sorted.length);
    const candidates=syncSamples ? syncSamples.map((sample,i)=>({id:'slate-'+(i+1),fromSample:Math.max(0,sample-lead),
      toSample:sample+width,onsetSample:sample})) :
      Array.from({length:count},(_,i)=>sorted[count===1 ? 0 : Math.round(i*(sorted.length-1)/(count-1))]);
    const re=new Float64Array(fftSize), im=new Float64Array(fftSize),
      prefix=new Float64Array(length+1), correlations=new Float64Array(2*radius+1);
    const guard=Math.max(2,Math.round(rate*.0007)),tolerance=Math.max(1,Math.round(rate*.0002));
    const probes=candidates.map(take=>{
      const {id,fromSample,toSample,onsetSample}=take;
      const start=Math.max(0,fromSample+ref.offset),end=Math.min(frameCount(ref),toSample+ref.offset);
      const attack=onsetSample===undefined ? onset(refRead,start,end,rate) : onsetSample+ref.offset;
      if (attack===null || end-start<width/2 || attack<start || attack>=end) return {id};
      const anchor=Math.max(start,attack-lead),span=Math.min(width,end-anchor);
      const a=new Float64Array(fftSize),b=new Float64Array(fftSize);
      let energy=0;
      for (let i=0;i<span;i++) {
        a[i]=refRead(anchor+i);
        energy+=a[i]**2;
      }
      if (span<width/2 || energy<1e-8) return {id};
      transform(a,b,0,1,-1);
      return {id,start:anchor-ref.offset,span,energy,a,b};
    });
    function measure(probe,mic,channel) {
      const {id,start,span,energy,a,b}=probe;
      if (!a) return {id,status:'quiet-reference'};
      const read=emphasize(mic,channel),begin=start+mic.offset-radius,spanLength=2*radius+span;
      re.fill(0);im.fill(0);
      for (let i=0;i<spanLength;i++) {
        re[i]=read(begin+i);
        prefix[i+1]=prefix[i]+re[i]**2;
      }
      transform(re,im,0,1,-1);
      for (let i=0;i<fftSize;i++) {
        const x=re[i],y=im[i];
        re[i]=a[i]*x+b[i]*y;
        im[i]=a[i]*y-b[i]*x;
      }
      transform(re,im,0,1,1);
      let best=0;
      for (let i=0;i<correlations.length;i++) {
        const local=prefix[i+span]-prefix[i], offset=begin+i;
        const score=offset>=0 && offset+span<=frameCount(mic) && local>=1e-8 ?
          re[i]/(fftSize*Math.sqrt(energy*local)) : 0;
        correlations[i]=score;
        if (Math.abs(score)>Math.abs(correlations[best])) best=i;
      }
      const signed=correlations[best], strength=Math.abs(signed);
      let runnerUp=0;
      for (let i=0;i<correlations.length;i++) if (Math.abs(i-best)>guard)
        runnerUp=Math.max(runnerUp,Math.abs(correlations[i]));
      const status=strength<minCorrelation ? 'weak' : strength-runnerUp<.035 ? 'ambiguous' : 'matched';
      return {id,status,offsetSamples:mic.offset+best-radius,polarity:signed<0 ? -ref.polarity : ref.polarity,
        correlation:round(Math.min(1,strength),6),separation:round(strength-runnerUp,6)};
    }
    const result=P.data.clone(session),rows={};
    for (const [name,mic] of Object.entries(mics)) {
      const channel=channels[name] ?? 0,retain=retainDelaySamples[name] ?? 0;
      const evidence=name===reference ? [] : probes.map(probe=>measure(probe,mic,channel));
      const matches=evidence.filter(row=>row.status==='matched');
      const center=matches.length ? median(matches.map(row=>row.offsetSamples)) : mic.offset;
      const coherent=matches.filter(row=>Math.abs(row.offsetSamples-center)<=tolerance);
      const negative=coherent.filter(row=>row.polarity===-1).length;
      const mixedPolarity=Math.max(negative,coherent.length-negative)*4<coherent.length*3;
      const measured=coherent.length ? median(coherent.map(row=>row.offsetSamples)) : null;
      const offset=measured===null ? mic.offset : measured-retain;
      const polarity=correctPolarity ? negative*2>coherent.length ? -1 : 1 : mic.polarity;
      let status='reference';
      if (name!==reference) {
        status=coherent.length<Math.ceil(probes.length/2) || coherent.length*2<=matches.length || correctPolarity && mixedPolarity ?
          matches.length ? 'inconsistent' : 'unresolved' : 'aligned';
      }
      if ((status==='aligned' || status==='reference') && (!integer(offset,-rate*10,rate*10) ||
          !takes.every(take=>covers(mic,take,offset)))) status='incomplete';
      if (status==='aligned') {
        result.perspectives[name].offsetSamples=offset;
        if (polarity!==1 || result.perspectives[name].polarity!==undefined) result.perspectives[name].polarity=polarity;
      }
      rows[name]={status,channel,inputOffsetSamples:mic.offset,measuredOffsetSamples:measured,
        offsetSamples:status==='aligned' ? offset : mic.offset,
        polarity:status==='aligned' ? polarity : mic.polarity,retainedDelaySamples:status==='aligned' ? retain : 0,
        votes:coherent.length,evidence};
    }
    return {value:result,report:{reference,sampleRate:rate,method:syncSamples ? 'slate' : 'take-attacks',
      searchSamples:radius,toleranceSamples:tolerance,perspectives:rows}};
  }
  S.alignInstrumentSession=align;
})(KIT.procedural);
