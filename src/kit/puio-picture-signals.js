/* Sample sound, native traces and committed world state on the picture clock. */
(function(K){
  const P=K.procedural,W=K.world,T=P.takeTime,S=W.soundMeasurements;
  const {check,own,id,record,selector,read}=W.data,{fields}=W.boundarySignals;
  const stats=['mean','peak','rms','first','last','min','max'];
  const integer=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
  const range=value=>Array.isArray(value)&&value.length===2&&value.every(Number.isFinite)&&
    Number.isFinite(value[1]-value[0]);
  const index=(time,rate)=>T.index(T.roundDown(T.mul(time,[BigInt(rate),1n])));

  function spans(frame,rate,window){
    const {start,end}=T.requireFrame(frame);
    const a=window==='previous'?T.sub(start,T.sub(end,start)):start;
    return [index(a,rate),index(window==='previous'?start:end,rate)];
  }

  function pcm(raw){
    const {audio, startSample=0}=raw??{};
    check(P.graphTypes.validator('audio')(audio)&&integer(audio.sampleRate,1,192000)&&integer(audio.channels,1,8)&&
      integer(startSample,0,Number.MAX_SAFE_INTEGER)&&Number.isSafeInteger(startSample+audio.samples.length/audio.channels),
    'Picture audio needs bounded normalized PCM and an integer sample origin');
    return {audio,startSample};
  }

  function sampleAudio({audio,startSample},channel){
    check(channel==='all'||channel==='mix'||integer(channel,0,audio.channels-1),'Invalid picture audio channel');
    const {samples,channels,sampleRate}=audio;
    const mix=channel==='mix', all=channel==='all';
    return {sampleRate,startSample,frames:samples.length/channels,components:all?channels:1,unit:'PCM',
      at(i,c){
        if(!mix)return samples[i*channels+(all?c:channel)];
        let sum=0;
        for(let j=0;j<channels;j++)sum+=samples[i*channels+j];
        return sum/channels;
      }};
  }

  function samplePhysical(raw){
    const {track,convert}=W.physicalSignals.inspect(raw);
    return {sampleRate:track.sampleRate,startSample:track.startSample,frames:track.samples.length,components:1,
      unit:W.physicalSignals.units[track.kind],at:i=>convert(track.samples[i])};
  }

  function reduce(track,start,end,stat,zeroPad){
    const {startSample,frames,components,at}=track, first=Math.max(start,startSample), last=Math.min(end,startSample+frames);
    const used=Math.max(0,last-first), count=zeroPad?end-start:used;
    check(count*components<=2000000,'Picture signal window exceeds its sample budget');
    if(!count)return {raw:null,used};
    if(stat==='first'||stat==='last'){
      const sample=stat==='first'?(zeroPad?start:first):(zeroPad?end:last)-1;
      return {raw:sample<first||sample>=last?0:at(sample-startSample,0),used};
    }
    let sum=0,min=Infinity,max=-Infinity,peak=0;
    for(let i=first;i<last;i++)for(let c=0;c<components;c++){
      const v=at(i-startSample,c);
      sum+=stat==='rms'?v*v:v;
      min=Math.min(min,v);
      max=Math.max(max,v);
      peak=Math.max(peak,Math.abs(v));
    }
    if(used<count){min=Math.min(0,min);max=Math.max(0,max);}
    const mean=sum/(count*components);
    return {raw:stat==='min'?min:stat==='max'?max:stat==='peak'?peak:stat==='rms'?Math.sqrt(mean):mean,used};
  }

  function sampleTrace(trace,channel){
    const names=Object.keys(trace.channels), name=channel??(names.length===1?names[0]:undefined);
    check(own(trace.channels,name),'Select a known picture trace channel');
    const {samples,unit}=trace.channels[name],{sampleRate,startSample,frames}=trace;
    return {sampleRate,startSample,frames,components:1,unit,at:i=>samples[i]};
  }

  function prepare(bindings,{audio={},signals={},traces={}}={}){
    check(record(bindings)&&Object.keys(bindings).length<=64&&Object.keys(bindings).every(id)&&record(audio)&&record(signals)&&record(traces),
      'Picture signals need named bindings and source tables');
    const validatedAudio=new Map(), physical=new Map(), validatedTraces=new Map();
    const rules=Object.entries(bindings).map(([name,binding])=>{
      check(fields(binding,['source','input','output','shape','exponent','fallback'])&&record(binding.source)&&
        range(binding.input)&&binding.input[0]<binding.input[1]&&range(binding.output),
      'Picture control '+name+' needs a source and finite mapping endpoints');
      const {source,input,output,shape='linear',exponent=2,fallback=output[0]}=binding;
      check(['linear','smoothstep','power'].includes(shape)&&Number.isFinite(exponent)&&exponent>=.05&&
        exponent<=20&&(binding.exponent===undefined||shape==='power')&&Number.isFinite(fallback),'Invalid picture control '+name);
      let measure;
      if(['audio','physical','trace'].includes(source.kind)){
        const audible=source.kind==='audio', sampled=source.kind==='trace';
        check(fields(source,['kind','name','stat','window',...(audible||sampled?['channel']:[])])&&id(source.name),
          'Choose a named audio bus, physical track or native trace for '+name);
        const {stat='rms',window='frame',channel=audible?(['first','last'].includes(stat)?'mix':'all'):undefined}=source;
        check(stats.includes(stat)&&['frame','previous'].includes(window)&&
          (!audible||!['first','last'].includes(stat)||channel!=='all'),
        'Invalid picture signal statistic, window or channel on '+name);
        let track;
        if(audible){
          check(own(audio,source.name),'Unknown picture audio bus '+source.name);
          if(!validatedAudio.has(source.name))validatedAudio.set(source.name,pcm(audio[source.name]));
          track=sampleAudio(validatedAudio.get(source.name),channel);
        }else if(sampled){
          check(own(traces,source.name),'Unknown picture trace '+source.name);
          if(!validatedTraces.has(source.name))
            validatedTraces.set(source.name,W.outputGeometry.validate('trace',traces[source.name]));
          track=sampleTrace(validatedTraces.get(source.name),channel);
        }else{
          check(own(signals,source.name),'Unknown picture physical track '+source.name);
          if(!physical.has(source.name))physical.set(source.name,samplePhysical(signals[source.name]));
          track=physical.get(source.name);
        }
        measure=frame=>{
          const [firstSample,endSample]=spans(frame,track.sampleRate,window);
          const {raw,used}=reduce(track,firstSample,endSample,stat,audible);
          return {raw,unit:track.unit,sampleRate:track.sampleRate,firstSample,endSample,used,stat,window,
            ...(channel!==undefined&&{channel})};
        };
      }else{
        check(fields(source,['kind','signal','field','at','args','path','project'])&&source.kind==='world'&&
          (typeof source.signal==='string')!==(typeof source.field==='string')&&
          (source.signal===undefined||source.at===undefined&&source.args===undefined),'Choose a world port or field for '+name);
        const path=source.path===undefined?null:selector(source.path), pick=S.projection(source.project);
        if(source.signal!==undefined)W.data.endpoint(source.signal);
        measure=(frame,sample)=>{
          check(sample?.world&&sample?.query,'Picture world controls need a committed take world');
          let value;
          if(source.signal!==undefined){
            check(own(sample.world.signals,source.signal),'Unknown picture world signal '+source.signal);
            value=sample.world.signals[source.signal];
          }else{
            check(sample.query.field(source.field),'Unknown picture world field '+source.field);
            const probe=sample.query.probe(source.field,source.at,source.args);
            if(probe.status==='ok')value=probe.value;
          }
          const raw=pick(path?read(value,path):value);
          return {raw:Number.isFinite(raw)?raw:null,tick:sample.world.tick};
        };
      }
      return {name,source,input,output,shape,exponent,fallback,measure};
    });
    function sample(frame,world){
      T.requireFrame(frame);
      const entries=rules.map(({name,source,input,output,shape,exponent,fallback,measure})=>{
        const evidence=measure(frame,world);
        check(evidence.raw===null||Number.isFinite(evidence.raw),'Picture measurement exceeds the numeric range on '+name);
        const value=evidence.raw===null?fallback:W.motionSound.mapRange(evidence.raw,input,output,shape,exponent);
        return [name,{...evidence,value,source}];
      });
      return {values:Object.fromEntries(entries.map(([name,{value}])=>[name,value])),report:Object.fromEntries(entries)};
    }
    return Object.freeze({sample});
  }

  function bind(template,controls,targets){
    check(record(template)&&record(controls)&&Array.isArray(targets)&&targets.length<=128,'Picture bindings need a record and target paths');
    const value=P.data.clone(template), used=new Set();
    for(const row of targets){
      check(fields(row,['control','path'])&&id(row.control)&&own(controls,row.control)&&Number.isFinite(controls[row.control]),
        'Picture target needs a named finite control');
      const path=selector(row.path), key=JSON.stringify(path.map(String));
      check(!used.has(key),'Duplicate picture target '+row.path);
      used.add(key);
      let parent=value;
      for(let i=0;i<path.length-1;i++){
        const name=path[i];
        check(own(parent,name)&&(!Array.isArray(parent)||/^(0|[1-9][0-9]*)$/.test(name)),
          'Unknown picture target '+row.path);
        parent=parent[name];
      }
      const leaf=path.at(-1);
      check(own(parent,leaf)&&(!Array.isArray(parent)||/^(0|[1-9][0-9]*)$/.test(leaf))&&
        (parent[leaf]===null||Number.isFinite(parent[leaf])),'Picture target needs an existing numeric field '+row.path);
      parent[leaf]=controls[row.control];
    }
    return value;
  }

  W.pictureSignals=Object.freeze({prepare,bind,pcm});
  P.graph.operations=Object.freeze({...P.graph.operations,'scene.bindControls':Object.freeze({
    description:'Route named picture controls into numeric cutaway, geometry or render options.',
    cacheVersion:1,inputs:{template:'record',controls:'record',targets:'array<record>'},outputs:{value:'record'},
    run({template,controls,targets}){return {value:bind(template,controls,targets)};}
  })});
})(KIT);
