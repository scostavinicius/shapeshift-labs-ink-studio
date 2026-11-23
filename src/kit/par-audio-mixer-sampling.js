/* Granular scanning and independent low-rate sampling, quantization and replay clocks. */
(function (P) {
  const S=P.mediaGraphSupport,{fields,finite,integer,check,hash}=P.musicInstruments, tau=2*Math.PI;
  const at=(input,frame,channel)=>input[2*frame+channel] ?? 0;
  function read(input,position,channel,wrap) {
    const frames=input.length/2, frame=Math.floor(position), u=position-frame;
    const index=wrap ? ((frame%frames)+frames)%frames : frame;
    const next=wrap && index+1===frames ? 0 : index+1;
    const a=at(input,index,channel);
    return a+(at(input,next,channel)-a)*u;
  }
  const random=(seed,index,axis)=>(hash([seed,index,axis])>>>0)/4294967296;
  function granular(raw,rate,time) {
    check(fields(raw,['type','wet','grainMs','density','scanRate','start','semitones','sprayMs',
      'jitterCents','reverse','spread','wrap','seed','extendSeconds']),'Unknown granular parameter');
    const {grainMs=105,density=24,sprayMs=12,jitterCents=8,reverse=0,spread=.25,wrap=false,seed=0,extendSeconds=0}=raw;
    check(finite(grainMs,8,500) && finite(density,2,100) && finite(sprayMs,0,500) &&
      finite(jitterCents,0,600) && finite(reverse,0,1) && finite(spread,0,1) &&
      typeof wrap==='boolean' && integer(seed,-2147483648,2147483647) && finite(extendSeconds,0,30),
      'Invalid grain shape, density, randomization or extension');
    const start=time.frame(time.position(raw.start ?? {samples:0}));
    check(integer(start,0,rate*3600),'Invalid granular source start');
    const scan=time.lane(raw.scanRate,1,-4,4,'grain scan rate'), pitch=time.lane(raw.semitones,0,-36,36,'grain pitch');
    const length=Math.round(grainMs*rate/1000), half=Math.floor(length/2), hop=rate/density;
    const tail=half+Math.round(extendSeconds*rate);
    function block(input,output) {
      const rateAt=scan.reader(), pitchAt=pitch.reader(), end=output.length/2;
      const norm=new Float64Array(end), window=Float64Array.from({length},(_,i)=>.5-.5*Math.cos(tau*i/(length-1)));
      const circular=wrap && input.length>0, frames=input.length/2;
      let source=start,last=0,previous=rateAt(0), grains=0;
      for (let grain=0;Math.round(grain*hop)-half<end;grain++) {
        const center=Math.round(grain*hop), now=rateAt(center), begin=center-half;
        source+=(center-last)*(now+previous)*.5;
        last=center; previous=now;
        const origin=source+(random(seed,grain,0)*2-1)*sprayMs*rate/1000;
        const direction=random(seed,grain,1)<reverse ? -1 : 1;
        const cents=(random(seed,grain,2)*2-1)*jitterCents;
        const speed=direction*2**((pitchAt(center)+cents/100)/12);
        const pan=(random(seed,grain,3)*2-1)*spread, left=Math.sqrt(1-pan), right=Math.sqrt(1+pan);
        const reach=half*Math.abs(speed)+Math.abs(speed)+1;
        if (!circular && (origin+reach<0 || origin-reach>=frames)) continue;
        for (let i=Math.max(0,-begin);i<Math.min(length,end-begin);i++) {
          const t=begin+i, at=origin+(i-half)*speed, gain=window[i];
          norm[t]+=gain;
          output[2*t]+=gain*left*read(input,at,0,circular);
          output[2*t+1]+=gain*right*read(input,at,1,circular);
        }
        grains++;
      }
      for (let i=0;i<end;i++) {
        const weight=Math.max(1,norm[i]);
        output[2*i]/=weight; output[2*i+1]/=weight;
      }
      return {grains,grainFrames:length,seed};
    }
    return {latency:0,tail,cost:8+10*Math.max(1,length/hop),extra:1,block};
  }
  function retro(raw,rate,time) {
    check(fields(raw,['type','wet','rateHz','bits','interpolation','retriggers']),'Unknown retro sampler parameter');
    const {bits=0,interpolation='hold',retriggers=[]}=raw;
    check((bits===0 || integer(bits,2,24)) && ['hold','linear','cubic'].includes(interpolation) &&
      Array.isArray(retriggers) && retriggers.length<=128,'Invalid retro bit depth, interpolation or retriggers');
    const downsample=time.lane(raw.rateHz,rate,100,rate,'retro sample rate'), events=[];
    for (const row of retriggers) {
      check(fields(row,['at','from','length','every','count']) && integer(row.count ?? 1,1,256) &&
        (row.every!==undefined || (row.count ?? 1)===1),'Invalid retro retrigger');
      const anchor=time.position(row.at), from=time.frame(time.position(row.from)), count=row.count ?? 1;
      for (let i=0;i<count;i++) {
        const start=i===0 ? anchor : time.offset(anchor,row.every,i);
        const at=time.frame(start), end=time.frame(time.offset(start,row.length));
        check(integer(at,0,rate*3600) && integer(from,0,at) && integer(end,at+1,Math.min(rate*3600,at+rate*8)) &&
          events.length<4096,'Retriggers need a prior source and a window of up to eight seconds');
        events.push({at,end,from});
      }
    }
    events.sort((a,b)=>a.at-b.at);
    check(events.every((row,i)=>i===0 || row.at>events[i-1].at),'Retro retriggers must start at distinct samples');
    const native=downsample.min===rate, step=Math.ceil(rate/downsample.min);
    const horizon=native || interpolation==='hold' ? 0 : (interpolation==='linear' ? step : 2*step)+1;
    const tail=native ? 0 : step, bitsScale=bits ? 2**(bits-1) : 0;
    function block(input,output) {
      const hz=downsample.reader();
      let index=-1;
      function quantize(value) {
        return bitsScale ? Math.min(bitsScale-1,Math.max(-bitsScale,Math.round(value*bitsScale)))/bitsScale : value;
      }
      function capture(point,row) {
        while (index+1<events.length && events[index+1].at<=point) index++;
        const hit=events[index], at=hit && point<hit.end ? hit.from+point-hit.at : point;
        row.point=point; row.l=quantize(read(input,at,0,false)); row.r=quantize(read(input,at,1,false));
      }
      function next(from,to) {capture(from.point+rate/hz(from.point),to);}
      let past={point:-1,l:0,r:0}, current={}, forward={}, future={};
      capture(0,current); next(current,forward); next(forward,future);
      for (let frame=0;frame<output.length/2;frame++) {
        if (frame>=forward.point-1e-10) {
          const reuse=past;
          past=current; current=forward; forward=future; future=reuse;
          next(forward,future);
        }
        const u=Math.max(0,(frame-current.point)/(forward.point-current.point));
        if (interpolation==='hold' || u===0) {
          output[2*frame]=current.l; output[2*frame+1]=current.r;
        } else if (interpolation==='linear') {
          output[2*frame]=current.l+(forward.l-current.l)*u;
          output[2*frame+1]=current.r+(forward.r-current.r)*u;
        } else {
          output[2*frame]=S.soundCubic(past.l,current.l,forward.l,future.l,u);
          output[2*frame+1]=S.soundCubic(past.r,current.r,forward.r,future.r,u);
        }
      }
      return {bits,interpolation,retriggers:events.length,minimumHz:downsample.min,maximumHz:downsample.max};
    }
    return {latency:horizon,tail,planEnd:inputEnd=>Math.max(inputEnd,
      ...events.filter(row=>row.from<inputEnd).map(row=>row.end))+tail,cost:18,block};
  }
  S.granularPlayback=granular;
  S.retroSampler=retro;
})(KIT.procedural);
