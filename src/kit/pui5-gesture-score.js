/* Compile overlapping timed targets into per-channel windows on the score clock. */
(function(K){
  const W=K.world,P=K.procedural,{check,copy,id,own,record}=W.data;
  const {fields,finite,nonnegative,positive,tape}=W.boundarySignals;
  const format='ink-studio/gesture-score', traceFormat='ink-studio/gesture-score-trace';
  const maxTick=1e12;
  const integer=(value,lo,hi)=>Number.isSafeInteger(value)&&value>=lo&&value<=hi;
  const shapes={number:1,vec3:3};
  const compare=(a,b)=>a<b?-1:a>b?1:0;
  const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
  const mix=(a,b,x)=>a===b||x===0?a:x===1?b:a*(1-x)+b*x;
  const pack=(track,values,at=0)=>track.size===1?values[at]:Array.from(values.slice(at,at+track.size));
  const smooth=x=>x*x*(3-2*x);

  function vector(value,size,label,scalar=false){
    if(size===1||scalar&&finite(value)){
      check(finite(value),'Expected a finite '+label);
      return Array(size).fill(value);
    }
    check(Array.isArray(value)&&value.length===size&&Array.from(value).every(finite),'Invalid '+label+' vector');
    return value.slice();
  }

  function channel(name,entry,rate){
    check(fields(entry,['type','base','quantity','limits'])&&own(shapes,entry.type),'Invalid gesture channel '+name);
    const {type,quantity,limits={}}=entry, size=shapes[type];
    const base=vector(entry.base,size,name+' base');
    check(fields(limits,['min','max','maxSpeed','maxAcceleration']),'Invalid gesture limits on '+name);
    const optional=key=>limits[key]===undefined?null:vector(limits[key],size,name+' '+key,true);
    const min=optional('min'), max=optional('max'), speed=optional('maxSpeed'), acceleration=optional('maxAcceleration');
    check(base.every((n,i)=>(min===null||n>=min[i])&&(max===null||n<=max[i]))&&
      (!speed||speed.every(n=>positive(n)&&n/rate>0))&&
      (!acceleration||speed&&acceleration.every(positive)), 'Invalid range or motion limits on '+name);
    const step=speed?.map(n=>n/rate);
    const alpha=speed?.map((n,i)=>acceleration?Math.min(1,.5*(acceleration[i]/rate/n)):1);
    check(!alpha||alpha.every(positive),'Gesture acceleration is below numeric resolution on '+name);
    const units=K.quantities.normalize(quantity,'Gesture channel '+name);
    if(units?.sampleRate!==undefined)check(K.quantities.equalRate(units.sampleRate,rate),
      'Gesture quantity sample rate must match the score clock on '+name);
    return {name,type,size,base,min,max,speed,acceleration,step,alpha,quantity:units,items:[]};
  }

  function compileTarget(track,target){
    if(finite(target)||Array.isArray(target)){
      const value=vector(target,track.size,track.name+' target');
      return () => value;
    }
    check(fields(target,['keys','interpolation'])&&Array.isArray(target.keys)&&
      integer(target.keys.length,1,512),'Invalid keyframed gesture target on '+track.name);
    const rows=Array.from(target.keys,row=>{
      check(fields(row,['at','value'])&&nonnegative(row.at)&&row.at<=1,'Gesture target keys use a fraction from zero to one');
      return {time:row.at,value:vector(row.value,track.size,track.name+' target key')};
    });
    const components=Array.from({length:track.size},(_,i)=>tape({keys:rows.map(({time,value})=>({time,value:value[i]})),
      interpolation:target.interpolation??'linear'}));
    return (u,buffer)=>{
      for(let i=0;i<track.size;i++)buffer[i]=components[i].value(u);
      return buffer;
    };
  }

  function windows(items){
    const changes=new Map(), active=new Set(), rows=[];
    function event(time){
      if(!changes.has(time))changes.set(time,{begin:[],end:[]});
      return changes.get(time);
    }
    for(const row of items){
      event(row.first).begin.push(row);
      event(row.last).end.push(row);
    }
    let overlap=0;
    for(const time of [...changes.keys()].sort((a,b)=>a-b)){
      const {begin,end}=changes.get(time);
      for(const row of end)active.delete(row);
      for(const row of begin)active.add(row);
      overlap=Math.max(overlap,active.size);
      check(overlap<=64,'A gesture channel exceeds 64 overlapping envelopes');
      rows.push({time,active:[...active].sort((a,b)=>a.priority-b.priority||compare(a.id,b.id))});
    }
    return {rows,overlap};
  }

  function activeAt(rows,time){
    let lo=0,hi=rows.length;
    while(lo<hi){
      const i=(lo+hi)>>>1;
      if(rows[i].time<=time)lo=i+1;
      else hi=i;
    }
    return rows[lo-1]?.active;
  }

  function weight(row,time){
    const fraction=time<row.start?1-(row.start-time)/row.leadIn:time>=row.end?1-(time-row.end)/row.release:1;
    const phase=clamp(fraction,0,1);
    return row.weight*(row.curve==='linear'?phase:smooth(phase));
  }

  function workspace(){
    return {value:new Float64Array(3),mean:new Float64Array(3),offset:new Float64Array(3),key:new Float64Array(3)};
  }

  function evaluate(track,time,work,contributors){
    const {value,mean,offset,key}=work, {size,base,rows}=track;
    value.set(base);
    const active=activeAt(rows,time);
    if(!active?.length)return value;
    let total=0, priority=active[0].priority;
    mean.fill(0);offset.fill(0);
    function apply(){
      const coverage=Math.min(1,total);
      for(let i=0;i<size;i++)value[i]=mix(value[i],mean[i],coverage)+offset[i];
    }
    for(const row of active){
      if(row.priority!==priority){apply();mean.fill(0);offset.fill(0);total=0;priority=row.priority;}
      const gain=weight(row,time);
      if(gain===0)continue;
      const target=row.read(clamp((time-row.start)/(row.end-row.start),0,1),key);
      if(row.blend==='add'){
        for(let i=0;i<size;i++)offset[i]+=target[i]*gain;
      }else{
        total+=gain;
        for(let i=0;i<size;i++)mean[i]=mix(mean[i],target[i],gain/total);
      }
      if(contributors)contributors.push({id:row.id,priority:row.priority,blend:row.blend,weight:gain,
        phase:time<row.start?'lead-in':time>=row.end?'release':'hold',target:pack(track,target)});
    }
    apply();
    for(let i=0;i<size;i++)check(finite(value[i]),'Gesture mix exceeded numeric range on '+track.name);
    return value;
  }

  function compile(asset){
    check(fields(asset,['format','version','id','revision','rate','channels','gestures'])&&asset.format===format&&
      asset.version===1&&id(asset.id)&&integer(asset.revision,1,Number.MAX_SAFE_INTEGER)&&integer(asset.rate,1,192000)&&
      record(asset.channels)&&integer(Object.keys(asset.channels).length,1,64)&&Object.keys(asset.channels).every(id)&&
      Array.isArray(asset.gestures)&&asset.gestures.length<=1024,'Expected a version 1 gesture score');
    const {rate,channels,gestures}=asset, tracks=Object.entries(channels).map(([name,entry])=>channel(name,entry,rate));
    const names=new Map(tracks.map(track=>[track.name,track])), used=new Set(), limit=maxTick/rate;
    let end=0, keyCount=0, targetCount=0;
    for(const row of gestures){
      const {id:name,channel:lane,start,end:stop,leadIn=0,release=0,priority=0,weight=1,blend='replace',
        curve='smooth',target,targets}=row??{};
      const last=stop+release, first=Math.max(0,start-leadIn);
      check(fields(row,['id','channel','start','end','leadIn','release','priority','weight','blend','curve','target','targets'])&&
        id(name)&&!used.has(name)&&nonnegative(start)&&positive(stop)&&stop>start&&
        nonnegative(leadIn)&&nonnegative(release)&&(leadIn===0||start-leadIn<start)&&(release===0||last>stop)&&
        finite(last)&&last<=limit&&integer(priority,-1024,1024)&&nonnegative(weight)&&weight<=1&&
        ['replace','add'].includes(blend)&&['smooth','linear'].includes(curve),'Invalid or repeated gesture '+name);
      check(targets===undefined?names.has(lane)&&target!==undefined:
        lane===undefined&&target===undefined&&record(targets)&&integer(Object.keys(targets).length,1,tracks.length)&&
        Object.keys(targets).every(channel=>names.has(channel)), 'Gesture '+name+' needs named targets on declared channels');
      used.add(name);
      for(const [channel,definition] of targets===undefined?[[lane,target]]:Object.entries(targets)){
        check(++targetCount<=4096,'Gesture score exceeds its channel target budget');
        const track=names.get(channel);
        if(Array.isArray(definition?.keys))keyCount+=definition.keys.length;
        check(keyCount<=16384,'Gesture score exceeds its total target key budget');
        const read=compileTarget(track,definition);
        if(weight>0)track.items.push({id:name,first,last,start,end:stop,leadIn,release,priority,weight,blend,curve,read});
      }
      end=Math.max(end,last);
    }
    let size=0, work=0, sampleWork=0;
    const limited=[];
    for(const track of tracks){
      const {rows,overlap}=windows(track.items);
      track.rows=rows;
      sampleWork+=1+overlap;
      delete track.items;
      if(track.speed){
        track.state=size;
        size+=track.size;
        work+=track.size*(1+overlap);
        limited.push(track);
      }
    }
    const identity=P.data.freeze({id:asset.id,revision:asset.revision,rate,signature:P.data.hash(JSON.stringify(asset))});
    const info=P.data.freeze({identity,duration:end,channels:Object.fromEntries(tracks.map(track=>{
      const {name,type,base,quantity,min,max,speed,acceleration}=track;
      const limits=Object.fromEntries(Object.entries({min,max,maxSpeed:speed,maxAcceleration:acceleration})
        .filter(([,values])=>values!==null).map(([key,values])=>[key,pack(track,values)]));
      return [name,{type,base:pack(track,base),limits,...(quantity&&{quantity:copy(quantity)})}];
    }))});
    return {tracks,limited,size,work,sampleWork,info};
  }

  W.gestureScoreData=Object.freeze({format,traceFormat,maxTick,integer,compile,workspace,evaluate,pack,clamp,mix});
})(KIT);
