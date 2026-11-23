/* Locate the first difference across native sample and exact event clocks. */
(function(K){
  const W=K.world,P=K.procedural,T=P.takeTime,A=W.outputAdapters;
  const {check,id,record,own,equal}=W.data,{fields}=W.boundarySignals;
  const reportFormat='ink-studio/aligned-simulation-review-report';
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const finite=Number.isFinite;
  const sampleAt=(time,rate)=>T.index(T.roundDown(T.mul(time,[BigInt(rate),1n])));
  const address=(time)=>({time:T.seconds(time),exact:{numerator:String(time[0]),denominator:String(time[1])}});

  function timeline(clock,from,to){
    const frames=Array.from({length:to-from},(_,i)=>clock.at(from+i));
    const first=T.requireFrame(frames[0]),last=T.requireFrame(frames.at(-1));
    const start=first.start,end=last.end, grids=new Map();
    function grid(rate){
      if(!grids.has(rate))grids.set(rate,[
        ...frames.map(frame=>sampleAt(T.requireFrame(frame).start,rate)),sampleAt(end,rate)
      ]);
      return grids.get(rate);
    }
    function locateSample(sample,rate){
      const slots=grid(rate);
      let low=0,high=slots.length-1;
      while(high-low>1){
        const mid=(low+high)>>>1;
        if(slots[mid]<=sample)low=mid;
        else high=mid;
      }
      const point=T.div(T.read(sample),T.read(rate)), at=T.locate(clock,point);
      return {sample,sampleRate:rate,takeSample:at.sample,frame:from+low,...address(point)};
    }
    function locateEvent(point){
      const at=T.locate(clock,point);
      return {frame:at.frame,takeSample:at.sample,...address(point)};
    }
    return {frames,start,end,grid,locateSample,locateEvent};
  }

  function trackSource(sources,{source},side){
    check(id(source)&&own(sources,source),'Missing review '+side+' source '+source);
    return sources[source];
  }

  function trackPair(name,spec,sources,axis,cache){
    check(fields(spec,['source','channel','trace','tolerance'])&&id(spec.source)&&
      (spec.channel===undefined||id(spec.channel)),'Invalid review trace '+name);
    const {tolerance={}}=spec;
    check(fields(tolerance,['absolute','relative']),'Invalid review sample tolerance for '+name);
    const {absolute=0,relative=0}=tolerance;
    check(finite(absolute)&&absolute>=0&&finite(relative)&&relative>=0,'Review tolerance must be finite and nonnegative');
    const read=side=>{
      const input=trackSource(sources[side],spec,side), key=JSON.stringify([side,spec.source,spec.trace??{}]);
      if(!cache.has(key))cache.set(key,A.trace(input,spec.trace??{}));
      const native=cache.get(key);
      const keys=Object.keys(native.channels), channel=spec.channel??(keys.length===1?keys[0]:undefined);
      check(own(native.channels,channel),'Select a known review channel for '+name+' on '+side);
      return {...native,channels:{[name]:native.channels[channel]}};
    };
    const reference=read('reference'),candidate=read('candidate');
    const rate=reference.sampleRate, unit=reference.channels[name].unit;
    check(rate===candidate.sampleRate&&unit===candidate.channels[name].unit,'Review trace clocks or units differ on '+name);
    const grid=axis.grid(rate), from=grid[0],to=grid.at(-1);
    check(to-from<=2000000,'Review trace window exceeds two million native samples');
    function trim(native){
      const start=Math.max(from,native.startSample), end=Math.min(to,native.startSample+native.frames);
      if(end>start)return A.traceWindow(native,{from:start,to:end});
      const startSample=Math.min(to,Math.max(from,native.startSample));
      return {...native,startSample,frames:0,channels:{[name]:{unit,samples:new Float64Array(0)}}};
    }
    const cropped={reference:trim(reference),candidate:trim(candidate)};
    const a=cropped.reference,b=cropped.candidate, x=a.channels[name].samples,y=b.channels[name].samples;
    let compared=0,changed=0,outsideTolerance=0,gaps=0,maxAbsoluteError=0,first=null;
    for(let sample=from;sample<to;sample++){
      const left=x[sample-a.startSample],right=y[sample-b.startSample];
      if(left===undefined||right===undefined){
        gaps++;
        if(first===null&&left!==right)first={
          kind:'sample',track:name,reason:'sample-coverage',reference:left??null,candidate:right??null,...axis.locateSample(sample,rate)
        };
        continue;
      }
      compared++;
      if(left===right)continue;
      changed++;
      const error=Math.abs(right-left), scale=Math.max(Math.abs(left),Math.abs(right)), allowance=Math.max(absolute,relative*scale);
      maxAbsoluteError=Math.max(maxAbsoluteError,error);
      const allowed=finite(error)?error<=allowance:Math.abs(right/scale-left/scale)<=relative;
      if(!allowed){
        outsideTolerance++;
        first??={kind:'sample',track:name,reason:'sample-value',reference:left,candidate:right,
          error:finite(error)?error:null,tolerance:finite(allowance)?allowance:null,...axis.locateSample(sample,rate)};
      }
    }
    const coverage=trace=>({startSample:trace.startSample,endSample:trace.startSample+trace.frames,frames:trace.frames});
    return {cropped,native:{reference,candidate},report:{sampleRate:rate,unit,from,to,compared,changed,outsideTolerance,gaps,
      maxAbsoluteError:finite(maxAbsoluteError)?maxAbsoluteError:null,tolerance:{absolute,relative},
      reference:coverage(a),candidate:coverage(b),first}};
  }

  function eventPair(name,spec,sources,axis){
    check(fields(spec,['source','options'])&&id(spec.source),'Invalid review event track '+name);
    const eventTime=W.outputTiming.eventTime;
    function read(side){
      const log=A.events(trackSource(sources[side],spec,side),spec.options??{});
      return {...log,entries:log.entries.filter(row=>{
        const point=eventTime(row);
        return T.compare(point,axis.start)>=0&&T.compare(point,axis.end)<0;
      })};
    }
    const reference=read('reference'),candidate=read('candidate'),a=reference.entries,b=candidate.entries;
    let matched=0,first=null;
    for(let i=0;i<Math.max(a.length,b.length);i++){
      const left=a[i],right=b[i], lt=left&&eventTime(left),rt=right&&eventTime(right);
      const ordered=lt&&rt?T.compare(lt,rt):0;
      if(left&&right&&ordered===0&&equal(left.event,right.event)){matched++;continue;}
      const point=ordered>0?rt:lt??rt;
      first={kind:'event',track:name,reason:!left||!right?'event-coverage':ordered?'event-time':'event-payload',
        eventIndex:i,reference:left??null,candidate:right??null,...axis.locateEvent(point)};
      break;
    }
    return {cropped:{reference,candidate},report:{matched,reference:{count:a.length,dropped:reference.dropped},
      candidate:{count:b.length,dropped:candidate.dropped},first}};
  }

  function earlier(a,b){
    if(!a||!b)return a??b??null;
    const fraction=row=>[BigInt(row.exact.numerator),BigInt(row.exact.denominator)];
    return T.compare(fraction(a),fraction(b))<=0?a:b;
  }

  function compare(settings,sources){
    check(fields(settings,['id','clock','from','to','traces','events'])&&id(settings.id)&&
      record(sources)&&record(sources.reference)&&record(sources.candidate),'Review needs an ID and two named source tables');
    const {id:name,clock:clockSettings={},from=0,to,traces={},events={}}=settings;
    check(integer(from,0,999999999)&&integer(to,from+1,1000000000)&&to-from<=3600&&
      [traces,events].every(table=>record(table)&&Object.keys(table).length<=32&&Object.keys(table).every(id))&&
      Object.keys(traces).length+Object.keys(events).length>0,'Review needs a bounded frame range and named trace or event tracks');
    const clock=T.create(clockSettings), axis=timeline(clock,from,to);
    let sampleBudget=0;
    const cache=new Map();
    const compareTrace=Object.fromEntries(Object.entries(traces).map(([key,spec])=>{
      const result=trackPair(key,spec,sources,axis,cache);
      sampleBudget+=result.report.to-result.report.from;
      check(sampleBudget<=4000000,'Review exceeds four million paired sample positions');
      return [key,result];
    }));
    const compareEvents=Object.fromEntries(Object.entries(events).map(([key,spec])=>[key,eventPair(key,spec,sources,axis)]));
    const summary=rows=>Object.fromEntries(Object.entries(rows).map(([key,{report}])=>[key,report]));
    const firstOf=rows=>Object.values(rows).reduce((first,row)=>earlier(first,row.report.first),null);
    const firstSample=firstOf(compareTrace),firstEvent=firstOf(compareEvents),first=earlier(firstEvent,firstSample);
    const incomplete=Object.values(compareTrace).some(row=>row.report.gaps>0||row.report.from===row.report.to)||
      Object.values(compareEvents).some(row=>row.report.reference.dropped||row.report.candidate.dropped);
    const changed=Object.values(compareTrace).some(row=>row.report.changed>0);
    const status=first?'diverged':incomplete?'incomplete':changed?'within-tolerance':'exact';
    const [begin,finish]=[axis.frames[0],axis.frames.at(-1)];
    const report={format:reportFormat,version:1,id:name,status,passed:!first&&!incomplete,incomplete,
      clock:{fps:24,simulationRate:60,cuts:[],...clockSettings,from,to,
        start:address(axis.start),end:address(axis.end),sampleRate:begin.sampleRate,
        startSample:begin.firstSample,endSample:finish.endSample},
      first,firstSample,firstEvent,traces:summary(compareTrace),events:summary(compareEvents)};
    const side=key=>({traces:Object.fromEntries(Object.entries(compareTrace).map(([name,row])=>[name,row.cropped[key]])),
      pictureTraces:Object.fromEntries(Object.entries(compareTrace).map(([name,row])=>[name,row.native[key]])),
      events:Object.fromEntries(Object.entries(compareEvents).map(([name,row])=>[name,row.cropped[key]]))});
    return {report,frames:axis.frames,reference:side('reference'),candidate:side('candidate')};
  }

  W.alignedReview=Object.freeze({compare,reportFormat});
})(KIT);
