/* Turn authored telemetry and native solver observations into dated scalar measurements. */
(function (K) {
  const W=K.world,P=K.procedural,T=P.takeTime,{check,id,own,record,selector,read}=W.data;
  const {fields}=W.boundarySignals;
  const format='ink-studio/sound-measurements', maxPoints=20000;
  const integer=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
  const list=value=>Array.isArray(value)||ArrayBuffer.isView(value)&&Number.isInteger(value.length);
  const unit=value=>typeof value==='string'&&value.length>0&&value.length<=64;
  const pack=([n,d])=>d===1n?T.index(n):{numerator:T.index(n),denominator:T.index(d)};

  function projection(project){
    if(project===undefined||project==='scalar')return value=>Number.isFinite(value)?value:null;
    if(project==='magnitude')return value=>list(value)&&integer(value.length,2,4)&&
      Array.from(value).every(Number.isFinite)?Math.hypot(...value):null;
    if(integer(project,0,3))return value=>list(value)&&Number.isFinite(value[project])?value[project]:null;
    check(Array.isArray(project)&&integer(project.length,2,4)&&Array.from(project).every(Number.isFinite)&&
      Number.isFinite(Math.hypot(...project))&&Math.hypot(...project)>0,'Use a scalar, magnitude, component or projection axis');
    const length=Math.hypot(...project), axis=project.map(n=>n/length);
    return value=>list(value)&&value.length===axis.length&&Array.from(value).every(Number.isFinite)?
      axis.reduce((sum,n,i)=>sum+n*value[i],0):null;
  }

  function series(unitName,points){
    return {format,version:1,unit:unitName,points};
  }

  function entries(points,label){
    check(Array.isArray(points)&&integer(points.length,1,maxPoints),'Invalid '+label+' length');
    let previous;
    return Array.from(points,row=>{
      check(record(row)&&(row.cut===undefined||typeof row.cut==='boolean'),'Invalid '+label+' point');
      const at=T.read(row.at);
      check(T.compare(at,[0n,1n])>=0&&T.compare(at,[3600n,1n])<=0&&(!previous||T.compare(at,previous)>0),
        label+' needs increasing timestamps within one hour');
      previous=at;
      return {row,at};
    });
  }

  function inspect(source){
    check(fields(source,['format','version','unit','points'])&&source.format===format&&source.version===1&&unit(source.unit),
      'Expected version 1 sound measurements with an explicit unit');
    return entries(source.points,'Sound measurements').map(({row,at})=>{
      check(fields(row,['at','value','cut','detail'])&&(row.value===null||Number.isFinite(row.value))&&
        (row.detail===undefined||record(row.detail)), 'Sound measurements need finite values or null');
      return {row,at};
    });
  }

  function rows(source,options){
    check(fields(options,['unit','path','project','rate','wrap'])&&unit(options.unit)&&
      (options.rate===undefined||typeof options.rate==='boolean')&&
      (options.wrap===undefined||options.rate===true&&Number.isFinite(options.wrap)&&options.wrap>0),
    'Invalid telemetry measurement options');
    const {unit:unitName,rate=false,wrap}=options, pick=projection(options.project);
    const path=options.path===undefined?null:selector(options.path);
    let previous;
    const points=entries(source,'Telemetry').map(({row,at})=>{
      const projected=pick(path?read(row,path):row.value);
      const raw=Number.isFinite(projected)?projected:null;
      let value=raw;
      if(rate){
        value=null;
        if(!row.cut&&raw!==null&&previous){
          let delta=raw-previous.value;
          if(wrap!==undefined)delta-=wrap*Math.floor(delta/wrap+.5);
          value=delta/T.seconds(T.sub(at,previous.at));
          check(Number.isFinite(value),'Measured rate exceeds the numeric range');
        }
        previous=raw===null?null:{at,value:raw};
      }
      return {at:row.at,value,...(row.cut&&{cut:true}),
        ...((rate||row.detail!==undefined)&&{detail:{...row.detail,...(rate&&{raw})}})};
    });
    const track=series(unitName+(rate?'/s':''),points);
    inspect(track);
    return track;
  }

  function sensor(report,name){
    const metadata=own(report?.rig?.sensors,name)?report.rig.sensors[name]:undefined;
    check(report?.format===W.virtualSensors.reportFormat&&report.version===1&&report.kind==='world'&&
      unit(metadata?.quantity?.unit)&&Array.isArray(report.frames)&&integer(report.frames.length,1,maxPoints),
    'Expected a named world sensor in a native report');
    const cadence=report.dt===undefined?null:T.period(report.dt);
    const track=series(metadata.quantity.unit,report.frames.map(frame=>{
      const reading=own(frame.sensors,name)?frame.sensors[name]:undefined;
      return {at:cadence?pack(T.mul(T.read(frame.tick),cadence)):frame.time,value:reading?.valid&&Number.isFinite(reading.value)?reading.value:null,
        detail:{sensor:name,tick:frame.tick,status:reading?.status??'missing'}};
    }));
    inspect(track);
    return track;
  }

  function contacts(trace,options){
    const units={slip:'m/s',force:'N',impulse:'N*s',point:'m'};
    check(fields(options,['track','field','project','windowSamples','reduce'])&&id(options.track),
      'Select a track from a native contact trace');
    const {track,field='slip',project='magnitude',windowSamples,reduce='rms'}=options;
    const {start,end}=trace??{}, sampleRate=trace?.info?.sampleRate;
    check(trace?.format===W.contactExciters.traceFormat&&trace.version===1&&own(units,field)&&
      ['rms','peak','mean'].includes(reduce)&&integer(windowSamples,1,192000)&&integer(sampleRate,1000,192000)&&
      integer(start,0,3600*sampleRate)&&integer(end,start+1,3600*sampleRate)&&
      Math.ceil((end-start)/windowSamples)+1<=maxPoints&&end-start<=2000000&&own(trace.tracks,track),
    'Invalid contact field, window size or trace range');
    const values=trace.tracks[track][field], active=trace.tracks[track].active, pick=projection(project);
    check(list(values)&&values.length===(end-start)*3&&list(active)&&active.length===end-start,
      'Contact trace samples are misaligned');
    const value=new Float64Array(3), points=[{at:pack([BigInt(start),BigInt(sampleRate)]),value:null}];
    for(let from=0;from<active.length;from+=windowSamples){
      const to=Math.min(active.length,from+windowSamples);
      let sum=0,peak=0,count=0;
      for(let i=from;i<to;i++){
        check(active[i]===0||active[i]===1,'Invalid contact active flag');
        if(!active[i])continue;
        for(let k=0;k<3;k++)value[k]=values[i*3+k];
        const level=pick(value);
        check(Number.isFinite(level),'Invalid contact vector or projection');
        sum+=reduce==='rms'?level*level:level;
        peak=Math.max(peak,Math.abs(level));
        count++;
      }
      points.push({at:pack([BigInt(start+to),BigInt(sampleRate)]),
        value:count?(reduce==='rms'?Math.sqrt(sum/count):reduce==='peak'?peak:sum/count):null,
        detail:{track,field,project,reduce,fromSample:start+from,endSample:start+to,activeSamples:count}});
    }
    const result=series(units[field],points);
    inspect(result);
    return result;
  }

  function world(runtime,measures,{steps,every=1}={}){
    check(integer(steps,0,200000)&&integer(every,1,200000)&&Math.ceil(steps/every)<maxPoints&&record(measures)&&
      integer(Object.keys(measures).length,1,32)&&Object.keys(measures).every(id),'Invalid world sound measurement schedule');
    const initial=runtime.view(), cadence=T.period(initial.world.dt), query=runtime.query();
    const composition=runtime.composition();
    const tracks=Object.entries(measures).map(([name,measure])=>{
      check(fields(measure,['signal','field','at','args','path','unit','project','rate','wrap'])&&
        (typeof measure.signal==='string')!==(typeof measure.field==='string'),
      'Select one world signal or field for '+name);
      const {signal,field,at,args,path,...options}=measure, pick=path===undefined?null:selector(path);
      if(signal!==undefined){
        const [system,port]=W.data.endpoint(signal);
        const output=composition.systems[system]?.writes.outputs[port];
        check(output&&at===undefined&&args===undefined,'Unknown world output '+signal);
        options.unit??=output.quantity?.unit;
      }else check(query.field(field),'Unknown world sound field '+field);
      check(unit(options.unit),'World sound measurement '+name+' needs an explicit unit');
      const location={...(signal!==undefined?{signal}:{field}),...(path!==undefined&&{path})};
      return {name,options,location,points:[],get(frame){
        if(signal!==undefined){
          const value=frame.signals[signal];
          return pick?read(value,pick):value;
        }
        const datum=runtime.query().probe(field,at,args);
        if(datum.status!=='ok')return null;
        return pick?read(datum.value,pick):datum.value;
      }};
    });
    check(initial.tick+steps<=W.runtime.maxTick&&
      T.compare(T.mul(T.read(initial.tick+steps),cadence),[3600n,1n])<=0&&steps*tracks.length<=2000000,
      'World sound capture exceeds its work or time range');
    for(let offset=0;offset<=steps;offset++){
      if(offset)runtime.step();
      if(offset%every&&offset!==steps)continue;
      const frame=runtime.view(), at=pack(T.mul(T.read(frame.tick),cadence));
      for(const track of tracks)track.points.push({at,value:track.get(frame),detail:{...track.location,tick:frame.tick}});
    }
    return Object.fromEntries(tracks.map(({name,points,options})=>[name,rows(points,options)]));
  }

  W.soundMeasurements=Object.freeze({format,maxPoints,projection,series,inspect,rows,sensor,contacts,world,pack});
})(KIT);
