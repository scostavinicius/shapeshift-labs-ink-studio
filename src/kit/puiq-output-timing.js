/* Keep sample addresses, units, and event occurrence times at graph boundaries. */
(function(K){
  const W=K.world,P=K.procedural,T=P.takeTime,G=W.outputGeometry;
  const {check,record,own,copy}=W.data,{fields}=W.boundarySignals;
  const {pack}=W.soundMeasurements;
  const formats={trace:'ink-studio/sample-trace',events:'ink-studio/event-log'};
  const int=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
  const list=value=>Array.isArray(value)||ArrayBuffer.isView(value)&&typeof value.length==='number';

  function trace(source,options={}){
    check(fields(options,['path','measure','track','unit']),'Invalid simulation trace output options');
    const data=G.select(source,options.path), {format,version,info}=data;
    let {sampleRate,startSample=0,frames,channels}=data;
    if([W.waveNetworks.traceFormat,W.resonantModes.traceFormat,W.contactExciters.traceFormat,W.virtualSensors.reportFormat].includes(format)){
      check(version===1&&int(data.start,0,Number.MAX_SAFE_INTEGER)&&int(data.end,data.start,Number.MAX_SAFE_INTEGER),
        'Native trace needs a version 1 sample range');
      sampleRate=info?.sampleRate??sampleRate;
      startSample=data.start;
      frames=data.end-data.start;
      if(format===W.waveNetworks.traceFormat){
        const measure=options.measure??'pressure';
        check(['pressure','flow'].includes(measure)&&options.track===undefined,'Choose wave pressure or flow');
        channels=channelMap(data[measure],()=>measure==='pressure'?'Pa':'m^3/s');
      }else if(format===W.resonantModes.traceFormat){
        check(options.measure===undefined&&options.track===undefined,'Modal traces publish their named displacement pickups');
        channels=channelMap(data.pickups,()=>options.unit??'model-unit');
      }else if(format===W.virtualSensors.reportFormat){
        check(data.kind==='wave'&&options.measure===undefined&&options.track===undefined,'Select a sample-rate wave sensor report');
        channels=channelMap(data.readings,name=>data.rig?.sensors?.[name]?.quantity?.unit);
      }else{
        const measure=options.measure??'force', units={force:'N',impulse:'N*s',point:'m',slip:'m/s'};
        check(own(units,measure)&&own(data.tracks,options.track)&&frames<=2000000,'Choose a contact track and vector measure');
        const raw=data.tracks[options.track][measure];
        check(list(raw)&&raw.length===3*frames,'Contact trace vector is misaligned');
        channels=Object.fromEntries(['x','y','z'].map((axis,i)=>[axis,{unit:units[measure],
          samples:Float64Array.from({length:frames},(_,sample)=>raw[sample*3+i])}]));
      }
    }else if(format===undefined&&Number.isSafeInteger(channels)&&list(data.samples)){
      const pcm=P.mediaGraph.audio(data);
      check(pcm.sampleRate<=192000&&pcm.samples.length<=8000000&&options.measure===undefined&&options.track===undefined,
        'Audio traces need at most 8 million samples and a clock up to 192 kHz');
      frames=pcm.samples.length/pcm.channels;
      channels=Object.fromEntries(Array.from({length:pcm.channels},(_,channel)=>['ch'+(channel+1),{
        unit:options.unit??'FS',samples:Float64Array.from({length:frames},(_,i)=>pcm.samples[i*pcm.channels+channel])
      }]));
    }else{
      check((format===undefined||format===formats.trace&&version===1)&&options.measure===undefined&&options.track===undefined,
        'Expected a native or authored integer-sample trace');
      check(record(channels)&&Object.keys(channels).length<=64,'Expected named sample trace channels');
      channels=Object.fromEntries(Object.entries(channels).map(([name,value])=>
        [name,list(value)?{samples:value,unit:options.unit??'1'}:value]));
      frames??=Object.values(channels)[0]?.samples?.length;
    }
    const value={format:formats.trace,version:1,sampleRate,startSample,frames,channels};
    G.validate('trace',value,'Simulation trace needs aligned finite channels, units and a bounded integer sample clock');
    return {...value,channels:Object.fromEntries(Object.entries(channels).map(([name,{unit,samples}])=>
      [name,{unit,samples:Float64Array.from(samples)}]))};
  }

  function channelMap(input,unit){
    check(record(input)&&Object.keys(input).length<=64,'Native trace needs bounded named channels');
    return Object.fromEntries(Object.entries(input).map(([name,samples])=>[name,{unit:unit(name),samples}]));
  }

  function traceWindow(value,options={}){
    G.validate('trace',value);
    check(fields(options,['from','to']),'Invalid trace window options');
    const {from=value.startSample,to=value.startSample+value.frames}=options;
    check(int(from,value.startSample,value.startSample+value.frames)&&int(to,from,value.startSample+value.frames),
      'Trace window must lie within the native sample range');
    return {...value,startSample:from,frames:to-from,channels:Object.fromEntries(Object.entries(value.channels).map(([name,row])=>
      [name,{unit:row.unit,samples:Float64Array.from(row.samples.slice(from-value.startSample,to-value.startSample))}]))};
  }

  function audio(source,options={}){
    check(fields(options,['path','channels','gain','startSample']),'Invalid simulation audio output options');
    const raw=G.select(source,options.path);
    let value, startSample=options.startSample??raw.startSample??0;
    if(raw.format===formats.trace){
      G.validate('trace',raw);
      const {channels=Object.keys(raw.channels),gain}=options;
      check(Number.isFinite(gain)&&Array.isArray(channels)&&channels.length>=1&&channels.length<=8&&
        new Set(channels).size===channels.length&&Array.from(channels).every(name=>own(raw.channels,name)),
      'Trace audio needs an explicit finite gain and one to eight named channels');
      const channelsData=channels.map(name=>raw.channels[name].samples);
      const samples=new Float64Array(raw.frames*channels.length);
      for(let i=0,at=0;i<raw.frames;i++)for(const channel of channelsData)samples[at++]=gain*channel[i];
      value={sampleRate:raw.sampleRate,channels:channels.length,samples};
    }else{
      check(options.channels===undefined&&options.gain===undefined,'Channel selection and gain apply to a trace');
      const pcm=P.mediaGraph.audio(raw.audio??raw);
      startSample=options.startSample??raw.startSample??0;
      value={...pcm,samples:pcm.samples.slice()};
    }
    G.validate('audio',value,'Simulation audio exceeded normalized PCM. Adjust its explicit trace gain.');
    const frames=value.samples.length/value.channels;
    check(int(startSample,0,Number.MAX_SAFE_INTEGER-frames),'Invalid simulation audio sample origin');
    return {value,report:{sampleRate:value.sampleRate,channels:value.channels,frames,startSample,endSample:startSample+frames}};
  }

  function occurrence(event,period,sampleRate){
    const time=W.timedEvents.timeOf(event), stamp=event.timing;
    if(time!==undefined&&stamp.sample!==undefined&&sampleRate!==undefined)
      return T.div(T.add(T.read(stamp.sample),T.read(stamp.fraction??0)),T.read(sampleRate));
    if(time!==undefined)return T.read(time);
    if(event.timecode!==undefined)return T.read(event.timecode);
    if(period&&int(event.tick,0,Number.MAX_SAFE_INTEGER))return T.mul(T.read(event.tick),period);
    const authored=event.time??event.at;
    check(authored!==undefined,'Event needs an occurrence time or a tick with an explicit period');
    return T.read(authored);
  }

  const safe=BigInt(Number.MAX_SAFE_INTEGER);
  function address([numerator,denominator]){
    if(numerator<=safe&&denominator<=safe)return {at:pack([numerator,denominator])};
    return {at:T.seconds([numerator,denominator]),
      exact:{numerator:String(numerator),denominator:String(denominator)}};
  }
  const eventTime=row=>row.exact===undefined?T.read(row.at):[BigInt(row.exact.numerator),BigInt(row.exact.denominator)];

  function events(source,options={}){
    check(fields(options,['path','dt','sampleRate']),'Invalid simulation event log options');
    const raw=G.select(source,options.path), {dt=raw.dt,sampleRate=raw.info?.sampleRate??raw.sampleRate}=options;
    const period=dt===undefined?undefined:typeof dt==='number'?T.period(dt):T.read(dt);
    check((period===undefined||T.compare(period,[0n,1n])>0)&&
      (sampleRate===undefined||int(sampleRate,1,192000)),'Invalid event log clock');
    const normalized=raw.format===formats.events;
    if(normalized)G.validate('eventLog',raw);
    const rows=normalized?raw.entries:Array.isArray(raw)?raw:raw.events;
    check(Array.isArray(rows)&&rows.length<=100000,'Expected a bounded event array or native event report');
    const timed=Array.from(rows,row=>{
      const event=normalized?row.event:row;
      check(record(event),'Simulation events need record payloads');
      const at=normalized?eventTime(row):occurrence(event,period,sampleRate);
      check(T.compare(at,[0n,1n])>=0,'Event occurrence precedes the simulation origin');
      return {at,event};
    });
    timed.sort((a,b)=>T.compare(a.at,b.at));
    const value={format:formats.events,version:1,dropped:raw.dropped??0,
      entries:timed.map(({at,event})=>({...address(at),event:copy(event)}))};
    return G.validate('eventLog',value);
  }

  function eventWindow(source,from,to){
    G.validate('eventLog',source);
    const a=T.read(from), b=T.read(to);
    check(T.compare(a,[0n,1n])>=0&&T.compare(a,b)<=0,'Event window needs increasing nonnegative times');
    return {...source,entries:source.entries.filter(row=>{
      const point=eventTime(row);
      return T.compare(point,a)>=0&&T.compare(point,b)<0;
    })};
  }

  W.outputTiming=Object.freeze({trace,traceWindow,audio,events,eventWindow,eventTime});
})(KIT);
