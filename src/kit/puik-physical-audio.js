/* Route calibrated physical pickups into aligned source, propagation and mix buses. */
(function (K) {
  const W=K.world, P=K.procedural, S=W.physicalSignals, {check,id,own,record}=W.data;
  const {fields}=W.boundarySignals;
  const format='ink-studio/physical-audio-plan', reportFormat='ink-studio/physical-audio-report';
  const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
  const finite=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
  const conversions=Object.freeze({
    direct:{pressure:'Pa','radiated-pressure':'Pa',displacement:'m',velocity:'m/s',
      acceleration:'m/s^2','volume-flow':'m^3/s'},
    velocity:{displacement:'m/s',velocity:'m/s'},
    acceleration:{displacement:'m/s^2',velocity:'m/s^2',acceleration:'m/s^2'},
    'flow-derivative':{'volume-flow':'m^3/s^2'}
  });

  function rows(value,label,min,max){
    check(record(value)&&integer(Object.keys(value).length,min,max)&&Object.keys(value).every(id),
      'Invalid physical audio '+label);
    return Object.entries(value);
  }

  function plan(raw){
    check(fields(raw,['format','version','id','sampleRate','startSample','frames','channels','sources','paths','mix','monitorGain'])&&
      raw.format===format&&raw.version===1&&id(raw.id),'Expected a version 1 physical audio plan');
    const {sampleRate,startSample=0,frames,channels=2,monitorGain=1}=raw;
    const endSample=startSample+frames;
    check(integer(sampleRate,1000,192000)&&integer(startSample,0,Number.MAX_SAFE_INTEGER)&&
      integer(endSample,1,Number.MAX_SAFE_INTEGER)&&integer(frames,1,S.maxFrames)&&
      (channels===1||channels===2)&&finite(monitorGain,0,1e9),'Invalid physical audio clock or monitoring gain');
    const sources=rows(raw.sources,'sources',1,32).map(([name,source])=>{
      check(fields(source,['signal','pickup','pcmPerUnit','offsetSamples','pan']),'Invalid physical audio source '+name);
      const {signal,pickup='direct',pcmPerUnit,offsetSamples=0,pan=0}=source;
      check(id(signal)&&own(conversions,pickup)&&finite(pcmPerUnit,-1e9,1e9)&&
        integer(offsetSamples,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER)&&finite(pan,-1,1),
      'Source '+name+' needs a signal, pickup and explicit PCM calibration');
      return {name,signal,pickup,pcmPerUnit,offsetSamples,pan};
    });
    const byName=Object.fromEntries(sources.map(source=>[source.name,source]));
    const paths=rows(raw.paths??{},'paths',0,64).map(([name,path])=>{
      check(fields(path,['source','gain','delaySamples','delaySeconds','pan','acoustic'])&&own(byName,path.source),
        'Invalid propagation path '+name);
      const {source,gain=1,delaySamples,delaySeconds,pan=byName[source].pan,acoustic}=path;
      check(finite(gain,-16,16)&&finite(pan,-1,1)&&(delaySamples===undefined||delaySeconds===undefined)&&
        (delaySamples===undefined||finite(delaySamples,0,60*sampleRate))&&
        (delaySeconds===undefined||finite(delaySeconds,0,60)), 'Invalid propagation gain, pan or delay '+name);
      if(acoustic!==undefined)check(record(acoustic)&&typeof acoustic.audible==='boolean'&&
        (!acoustic.audible||(finite(acoustic.gain,0,16)&&finite(acoustic.delaySeconds,0,60))),
      'Use an audible or blocked world acoustics result for '+name);
      return {name,source,pan,gain:gain*(acoustic===undefined?1:acoustic.audible?acoustic.gain:0),
        delaySamples:(delaySamples??(delaySeconds??0)*sampleRate)+(acoustic?.audible?acoustic.delaySeconds*sampleRate:0)};
    });
    const mix=raw.mix??{};
    check(fields(mix,['dry','wet']),'Invalid physical audio mix');
    const {dry=paths.length?0:1,wet=1}=mix;
    check(finite(dry,-16,16)&&finite(wet,-16,16),'Physical audio mix weights must be finite and within [-16, 16]');
    check(frames*channels*(4+sources.length+paths.length)<=16000000,'Physical audio exceeds its stem memory budget');
    return {id:raw.id,sampleRate,startSample,endSample,frames,channels,monitorGain,sources,paths,dry,wet};
  }

  function derivativeOrder(kind,pickup){
    if(pickup==='direct'||pickup===kind)return 0;
    return kind==='displacement'&&pickup==='acceleration'?2:1;
  }

  function prepare(settings,signals){
    const {sampleRate,frames,paths,sources}=settings;
    check(record(signals),'Provide physical signals by name');
    const inputs=sources.map(spec=>{
      check(own(signals,spec.signal),'Missing physical signal '+spec.signal);
      const {track,convert}=S.inspect(signals[spec.signal]);
      const unit=conversions[spec.pickup][track.kind];
      check(unit,'Pickup '+spec.pickup+' cannot read '+track.kind+' on '+spec.name);
      const step=track.sampleRate/sampleRate;
      check(step<=16,'Physical audio downsampling ratio exceeds 16:1 on '+spec.name);
      const cost=track.sampleRate===sampleRate?2:4*Math.min(48,Math.ceil(8/(step>1?.94/step:1)));
      return {spec,track,convert,unit,step,cost,order:derivativeOrder(track.kind,spec.pickup)};
    });
    const costs=Object.fromEntries(inputs.map(({spec,cost})=>[spec.name,cost]));
    const work=inputs.reduce((sum,{track,cost})=>sum+track.samples.length+frames*cost,0)+
      paths.reduce((sum,path)=>sum+frames*costs[path.source]*(Number.isInteger(path.delaySamples)?1:2),0);
    check(work<=240000000,'Physical audio exceeds its resampling work budget');
    return inputs.map(input=>{
      const {spec,track,convert,step,order}=input, scale=spec.pcmPerUnit;
      let value=convert(track.previous??track.samples[0]);
      let velocity=track.beforePrevious===undefined?0:(value-convert(track.beforePrevious))*track.sampleRate;
      const pcm=Float64Array.from(track.samples,raw=>{
        const next=convert(raw), speed=(next-value)*track.sampleRate;
        const result=(order===0?next:order===1?speed:(speed-velocity)*track.sampleRate)*scale;
        value=next;
        velocity=speed;
        if(!Number.isFinite(result))throw Error('Physical audio calibration overflow on '+spec.name);
        return result;
      });
      const {read}=P.mediaGraph.pcmReader({samples:pcm,channels:1},0,pcm.length,step);
      return {...input,read};
    });
  }

  // BigInt positions the read on the take. The hot loop advances a small integer phase.
  function reader(input,settings,delay){
    const {track,spec,read}=input, {sampleRate,startSample}=settings;
    const divisor=BigInt(sampleRate), step=track.sampleRate;
    const numerator=(BigInt(startSample)-BigInt(spec.offsetSamples)-BigInt(delay))*BigInt(step)-
      BigInt(track.startSample)*divisor;
    const remainder=((numerator%divisor)+divisor)%divisor;
    let index=Number((numerator-remainder)/divisor), phase=Number(remainder);
    if(index>=track.samples.length||index < -Math.ceil(settings.frames*step/sampleRate))return ()=>0;
    const output=new Float64Array(2);
    return ()=>{
      let sample=0;
      if(index>=0&&index<track.samples.length){
        read(index+phase/sampleRate,output);
        sample=output[0];
      }
      phase+=step;
      index+=Math.floor(phase/sampleRate);
      phase%=sampleRate;
      return sample;
    };
  }

  function stem(input,settings,bus,{delaySamples=0,gain=1,pan=input.spec.pan}={}){
    const {frames,channels}=settings, buffer=new Float64Array(frames*channels);
    if(gain===0)return buffer;
    const whole=Math.floor(delaySamples), fraction=delaySamples-whole;
    const read=reader(input,settings,whole), prior=fraction&&reader(input,settings,whole+1);
    const left=channels===1?gain:gain*(1-Math.max(0,pan)), right=gain*(1+Math.min(0,pan));
    for(let i=0,at=0;i<frames;i++){
      const value=read()*(1-fraction)+(prior?prior()*fraction:0);
      bus[at]+=buffer[at]=value*left;
      at++;
      if(channels===2){
        bus[at]+=buffer[at]=value*right;
        at++;
      }
    }
    return buffer;
  }

  function render(raw,signals){
    const settings=plan(raw), inputs=prepare(settings,signals);
    const {id,sampleRate,channels,startSample,endSample,frames,monitorGain,dry,wet}=settings;
    const source=new Float64Array(frames*channels), propagation=new Float64Array(source.length);
    const byName=Object.fromEntries(inputs.map(input=>[input.spec.name,input]));
    const sources=Object.fromEntries(inputs.map(input=>[input.spec.name,stem(input,settings,source)]));
    const paths=Object.fromEntries(settings.paths.map(path=>[path.name,stem(byName[path.source],settings,propagation,path)]));
    const mix=Float64Array.from(source,(drySample,i)=>dry*drySample+wet*propagation[i]);
    function audio(samples,name){
      let peak=0;
      for(let i=0;i<samples.length;i++){
        const value=samples[i]*monitorGain;
        if(!Number.isFinite(value)||Math.abs(value)>1)
          throw Error('Physical audio stem '+name+' exceeds normalized PCM. Reduce the common monitorGain.');
        samples[i]=value;
        peak=Math.max(peak,Math.abs(value));
      }
      return {value:{samples,channels,sampleRate},peak};
    }
    const buses={source:audio(source,'source'),propagation:audio(propagation,'propagation'),mix:audio(mix,'mix')};
    const sourceAudio=Object.fromEntries(inputs.map(({spec,track,unit})=>[spec.name,{
      ...audio(sources[spec.name],'source/'+spec.name),signal:spec.signal,pickup:spec.pickup,inputKind:track.kind,
      pickupUnit:unit,pcmPerUnit:spec.pcmPerUnit,offsetSamples:spec.offsetSamples,pan:spec.pan,
      inputRate:track.sampleRate,inputStartSample:track.startSample,inputEndSample:track.startSample+track.samples.length
    }]));
    const pathAudio=Object.fromEntries(settings.paths.map(({name,...path})=>[name,{
      ...audio(paths[name],'path/'+name),...path
    }]));
    const withoutAudio=record=>Object.fromEntries(Object.entries(record).map(([name,{value,...data}])=>[name,data]));
    const buffers=record=>Object.fromEntries(Object.entries(record).map(([name,{value}])=>[name,value]));
    const report={format:reportFormat,version:1,id,sampleRate,channels,startSample,endSample,frames,monitorGain,
      mix:{dry,wet},peaks:Object.fromEntries(Object.entries(buses).map(([name,{peak}])=>[name,peak])),
      sources:withoutAudio(sourceAudio),paths:withoutAudio(pathAudio)};
    return {...buffers(buses),value:buses.mix.value,sources:buffers(sourceAudio),paths:buffers(pathAudio),report};
  }

  W.physicalAudio=Object.freeze({format,reportFormat,render});
  P.graph.operations=Object.freeze({...P.graph.operations,'audio.physical':Object.freeze({
    cacheVersion:1,description:'Render calibrated physical source, propagation and mix stems on one integer sample clock.',
    inputs:{plan:'record',signals:'record'},outputs:{value:'audio',source:'audio',propagation:'audio',mix:'audio',
      sources:'record',paths:'record',report:'record'},
    run({plan,signals}){return render(plan,signals);}
  })});
})(KIT);
