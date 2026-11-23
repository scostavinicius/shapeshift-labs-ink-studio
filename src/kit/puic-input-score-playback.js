/* Read an edited score into native timed events, recordings and gesture controls. */
(function(K){
  const W=K.world,P=K.procedural,T=P.takeTime,B=W.inputScoreData,{check,id,record,own,copy}=W.data;
  const {fields,finite}=W.boundarySignals,{freeze}=P.data;
  const {format,planFormat,point,stamp,header,channelId,zero,maxChannels,maxControls}=B;
  const lerp=(a,b,t)=>t===0||a===b?a:t===1?b:a*(1-t)+b*t;

  function prepare(asset){
    header(asset);
    let duration=point(asset.duration,undefined,'input duration');
    const list=B.events(asset.events);
    function extendTo(at){if(T.compare(at,duration)>0)duration=at;}
    check(Object.keys(asset.curves).length<=maxChannels&&Object.keys(asset.curves).every(channelId),'Invalid editable input curves');
    let count=0;
    const curves=new Map(Object.entries(asset.curves).map(([name,row])=>{
      check(fields(row,['initial','interpolation','keys'])&&finite(row.initial)&&['step','linear'].includes(row.interpolation)&&
        Array.isArray(row.keys)&&(count+=row.keys.length)<=maxControls,'Invalid editable input curve '+name);
      const keys=Array.from(row.keys,key=>{
        check(fields(key,['time','timecode','value','event','causes'])&&finite(key.value),'Invalid input curve key on '+name);
        return {at:point(key.time,key.timecode,'curve key'),value:key.value};
      });
      check(keys.every((row,i)=>!i||T.compare(row.at,keys[i-1].at)>0),'Curve keys need strictly increasing times on '+name);
      if(keys.length)extendTo(keys.at(-1).at);
      return [name,{initial:row.initial,interpolation:row.interpolation,keys}];
    }));
    const initial=P.mediaGraph.recording({initial:asset.initial,events:[]}).initial;
    const clock=(at,label='input sample')=>point(undefined,at,label);
    function upper(rows,at,aligned=false){
      let low=0,high=rows.length;
      while(low<high){
        const mid=(low+high)>>>1;
        if(T.compare(rows[mid].at,at)<=0||aligned&&T.seconds(rows[mid].at)===T.seconds(at))low=mid+1;
        else high=mid;
      }
      return low;
    }

    function edge(row,at,phase,order){
      const timing=stamp(at), payload={id:row.id,source:row.source,channel:row.channel,kind:row.kind,phase,value:row.value,
        ...(timing.timecode&&{timecode:timing.timecode}),...(row.controls&&{controls:row.controls}),
        ...(row.origin!==undefined&&{origin:row.origin}),
        ...(row.end!==undefined&&{span:{time:row.time,end:row.end,...(row.timecode&&{timecode:row.timecode}),
          ...(row.endTimecode&&{endTimecode:row.endTimecode})}})};
      return {at,phase,order,record:W.timedEvents.at(timing.time,payload)};
    }
    const edges=list.flatMap(({row,start,end},order)=>end?[edge(row,start,'start',order),edge(row,end,'end',order)]:
      [edge(row,start,'point',order)]).sort((a,b)=>T.compare(a.at,b.at)||Number(b.phase==='end')-Number(a.phase==='end')||
        a.order-b.order);
    if(edges.length)extendTo(edges.at(-1).at);
    const seconds=T.seconds(duration);

    function level(row,at,aligned){
      const {initial,interpolation,keys}=row, i=upper(keys,at,aligned);
      const left=keys[i-1]??{at:zero,value:initial}, right=keys[i];
      if(interpolation!=='linear'||!right||T.compare(at,left.at)<=0)return left.value;
      return lerp(left.value,right.value,T.seconds(T.div(T.sub(at,left.at),T.sub(right.at,left.at))));
    }
    function sample(at=0,names=[...curves.keys()]){
      const time=clock(at);
      check(Array.isArray(names)&&names.length<=maxChannels&&Array.from(names).every(name=>curves.has(name)),
        'Unknown input curve selection');
      return Object.fromEntries(names.map(name=>[name,level(curves.get(name),time,typeof at==='number')]));
    }
    function events({after,through=seconds}={}){
      const stop=clock(through), end=upper(edges,stop,typeof through==='number');
      const start=after===undefined?0:upper(edges,clock(after),typeof after==='number');
      check(after===undefined||T.compare(clock(after),stop)<=0,'Input event window needs ordered times');
      return edges.slice(start,end).map(row=>row.record);
    }
    function recording(){
      return P.mediaGraph.recording({initial,events:edges.map(({record:row,phase,at})=>({
        ...stamp(at),channel:row.channel,
        ...(row.kind==='set'&&phase==='point'?{kind:'set',value:row.value}:{kind:'pulse',value:{
          id:row.id,kind:row.kind,source:row.source,phase,value:row.value
        }})
      }))});
    }

    function gestures(config){
      check(fields(config,['id','revision','rate','until','bindings'])&&record(config.bindings)&&
        Object.keys(config.bindings).length>0&&Object.keys(config.bindings).length<=64&&Object.keys(config.bindings).every(id),
      'Gesture export needs a table of named channel bindings');
      const {rate=240,until,bindings}=config;
      check(Number.isSafeInteger(rate)&&rate>=1&&rate<=192000,'Invalid exported gesture clock');
      const end=until??(Math.ceil(seconds*rate)+1)/rate;
      check(finite(end)&&end>0&&T.compare(clock(end,'gesture end'),duration)>=0,'Gesture export ends before the input score');
      const channels={}, rows=[];
      for(const [name,binding] of Object.entries(bindings)){
        check(fields(binding,['curve','quantity','limits'])&&curves.has(binding.curve),'Unknown gesture curve on '+name);
        const row=curves.get(binding.curve), keys=new Map([[0,row.initial]]);
        for(const key of row.keys){
          const time=T.seconds(key.at);
          check(time<=end,'Gesture export ends before a key on '+name);
          keys.set(time/end,key.value);
        }
        check(keys.size<=512,'Gesture export needs at most 512 keys per channel on '+name);
        const {quantity,limits}=binding;
        channels[name]={type:'number',base:row.initial,...(quantity!==undefined&&{quantity:copy(quantity)}),
          ...(limits!==undefined&&{limits:copy(limits)})};
        rows.push({id:name,channel:name,start:0,end,target:{
          keys:[...keys].map(([at,value])=>({at,value})),interpolation:row.interpolation
        }});
      }
      const score={format:W.gestureScores.format,version:1,id:config.id??asset.id,revision:config.revision??asset.revision,
        rate,channels,gestures:rows};
      W.gestureScores.prepare(score);
      return freeze(score);
    }

    return Object.freeze({sample,events,recording,gestures,has:name=>curves.has(name),
      edgeCount:edges.length, through:at=>upper(edges,clock(at),typeof at==='number'),
      slice:(from,to)=>edges.slice(from,to).map(row=>row.record)});
  }

  W.inputCompilers=Object.freeze({format,planFormat,compile:B.compile,edit:B.edit,prepare,
    decodeMIDI:bytes=>W.midiFiles.decode(bytes,{performance:true})});

  W.runtime.register('input-score',config=>{
    check(fields(config,['score','bindings']),'Input-score system needs config.score and optional bindings');
    const session=prepare(config.score), bindings=config.bindings??{};
    check(record(bindings)&&Object.keys(bindings).length<=64&&Object.entries(bindings).every(([name,row])=>
      id(name)&&name!=='events'&&fields(row,['curve','quantity'])&&session.has(row.curve)),'Invalid input-score port bindings');
    const specs=Object.entries(bindings);
    const outputs={events:'event',...Object.fromEntries(specs.map(([name,{quantity}])=>[
      name,{type:'number',...(quantity!==undefined&&{quantity:K.quantities.normalize(quantity,'Input score port '+name)})}
    ]))};
    const curves=Array.from(new Set(specs.map(([,row])=>row.curve)));
    function valid(saved){
      const {time,from,to}=saved??{};
      check(fields(saved,['time','from','to'])&&finite(time)&&time>=0&&Number.isSafeInteger(from)&&Number.isSafeInteger(to)&&
        from>=0&&from<=to&&to-from<=W.rates.maxEvents&&to<=session.edgeCount&&
        (time===0&&to===0||to===session.through(time)),'Invalid input-score checkpoint');
    }
    return {
      outputs,initial:()=>({time:0,from:0,to:0}),validateState:valid,
      step(state,{time}){
        const to=session.through(time), from=state.to;
        check(time>=state.time&&to>=from&&to-from<=W.rates.maxEvents,'Input-score step exceeds its event or clock budget');
        return {time,from,to};
      },
      output({time,from,to}){
        const sampled=session.sample(time,curves);
        return {events:session.slice(from,to),...Object.fromEntries(specs.map(([name,{curve}])=>[name,sampled[curve]]))};
      }
    };
  });

  P.graph.operations=Object.freeze({...P.graph.operations,'input.compile':Object.freeze({
    cacheVersion:1,description:'Convert text, IPA, MIDI bytes, recorded controls and cues into editable events and scalar curves.',
    inputs:{plan:{type:'record',description:'An Ink input compile plan with inline sources.'}},
    outputs:{value:'record',recording:'record'},
    run({plan}){
      const value=B.compile(plan);
      return {value,recording:prepare(value).recording()};
    }
  })});
})(KIT);
