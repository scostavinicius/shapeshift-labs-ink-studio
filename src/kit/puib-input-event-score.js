/* Versioned editable input events and derived scalar control curves. */
(function(K){
  const W=K.world,P=K.procedural,T=P.takeTime,{check,id,record,copy,own}=W.data;
  const {fields,finite}=W.boundarySignals,{freeze,hash}=P.data;
  const format='ink-studio/input-score',planFormat='ink-studio/input-compile-plan';
  const maxEvents=48000,maxChannels=1024,maxControls=100000,maxTime=1e9,zero=T.read(0);
  const channelId=name=>typeof name==='string'&&/^[a-z][\w.:-]{0,95}$/i.test(name)&&id(name.replaceAll(':','-'));
  const revision=n=>Number.isSafeInteger(n)&&n>0;

  function point(raw,exact,label){
    const time=T.read(exact??raw), seconds=T.seconds(time);
    check(seconds>=0&&seconds<=maxTime&&(exact===undefined||raw===undefined||raw===seconds),'Invalid '+label+' time');
    return time;
  }
  function stamp(time,key='time',keycode='timecode'){
    const seconds=T.seconds(time);
    check(seconds>=0&&seconds<=maxTime,'Input event lies outside the portable time range');
    if(T.compare(T.read(seconds),time)===0)return {[key]:seconds};
    const [numerator,denominator]=time.map(T.index);
    return {[key]:seconds,[keycode]:{numerator,denominator}};
  }
  function controls(value={}){
    check(record(value)&&Object.keys(value).length<=64&&Object.entries(value).every(([name,num])=>channelId(name)&&finite(num)),
      'Input controls need finite numbers on named lanes');
    return {...value};
  }
  function lane(raw){
    check(fields(raw,['initial','interpolation'])&&(raw.initial===undefined||finite(raw.initial))&&
      ['step','linear'].includes(raw.interpolation??'step'),'Invalid input curve settings');
    return {initial:raw.initial??0,interpolation:raw.interpolation??'step'};
  }

  function event(row){
    check(fields(row,['id','kind','channel','source','time','timecode','end','endTimecode','value','controls','origin'])&&
      id(row.id)&&id(row.kind)&&channelId(row.channel)&&id(row.source)&&own(row,'value'),'Invalid editable input event');
    const start=point(row.time,row.timecode,'input'), end=row.end===undefined&&row.endTimecode===undefined?null:
      point(row.end,row.endTimecode,'input end');
    check(end===null||T.compare(end,start)>0,'Input event '+row.id+' must end after it starts');
    const values=row.controls===undefined?undefined:controls(row.controls);
    return {start,end,row:{id:row.id,kind:row.kind,channel:row.channel,source:row.source,...stamp(start),
      ...(end&&stamp(end,'end','endTimecode')),value:copy(row.value),...(values&&{controls:values}),...(row.origin!==undefined&&{origin:copy(row.origin)})}};
  }
  function events(rows){
    check(Array.isArray(rows)&&rows.length<=maxEvents,'Input score exceeds its event budget');
    const list=Array.from(rows,event).sort((a,b)=>T.compare(a.start,b.start));
    check(new Set(list.map(({row})=>row.id)).size===list.length,'Duplicate editable input event ID');
    check(new Set(list.map(({row})=>row.channel)).size<=maxChannels,'Input score exceeds its channel budget');
    return list;
  }

  function eventControls(row,end){
    if(row.controls!==undefined)return row.controls;
    if(row.kind==='set')return W.inputSourceAdapters.numeric(row.channel,row.value);
    if(row.kind==='note'&&end&&finite(row.value?.velocity))return {[row.channel]:row.value.velocity};
    return {};
  }

  function buildCurves(list,definitions){
    check(record(definitions)&&Object.keys(definitions).length<=maxChannels&&Object.keys(definitions).every(channelId),
      'Invalid input curve table');
    const compiled=new Map(Object.entries(definitions).map(([name,raw])=>[name,{profile:lane(raw),edges:[]}]));
    let work=0;
    for(const [order,{row,start,end}] of list.entries())for(const [name,value] of Object.entries(eventControls(row,end))){
      if(!compiled.has(name)){
        check(compiled.size<maxChannels,'Input score exceeds its curve lane budget');
        compiled.set(name,{profile:lane({}),edges:[]});
      }
      const {edges}=compiled.get(name);
      edges.push({time:start,order,id:row.id,kind:end?'on':'set',value});
      if(end)edges.push({time:end,order,id:row.id,kind:'off'});
      work+=end?2:1;
      check(work<=maxControls,'Input score exceeds its curve edge budget');
    }
    return Object.fromEntries([...compiled].map(([name,{profile,edges}])=>{
      edges.sort((a,b)=>T.compare(a.time,b.time)||a.order-b.order);
      const active=new Map(), keys=[];
      let held=profile.initial, heldEvent;
      for(let i=0;i<edges.length;){
        const {time}=edges[i];
        let j=i+1;
        while(j<edges.length&&T.compare(edges[j].time,time)===0)j++;
        const causes=[];
        for(let k=i;k<j;k++){
          const edge=edges[k];
          if(edge.kind==='off')active.delete(edge.order);
          else if(edge.kind==='on')active.set(edge.order,edge);
          else{held=edge.value;heldEvent=edge.id;}
          causes.push(edge.id);
        }
        check(active.size<=256,'Input curve exceeds its overlapping span budget on '+name);
        let winner;
        for(const edge of active.values())winner=edge;
        keys.push({...stamp(time),value:winner?.value??held,
          ...((winner?.id??heldEvent)&&{event:winner?.id??heldEvent}),causes});
        i=j;
      }
      return [name,{...profile,keys}];
    }));
  }

  function assemble({id,revision,initial,lanes,duration,sources,warnings},raw){
    const list=events(raw);
    const baseline=P.mediaGraph.recording({initial,events:[]}).initial;
    check(new Set([...Object.keys(baseline),...list.map(({row})=>row.channel)]).size<=maxChannels,
      'Input score exceeds its combined channel budget');
    const seed=point(duration,undefined,'input duration');
    let stop=seed;
    for(const entry of list)if(T.compare(entry.end??entry.start,stop)>0)stop=entry.end??entry.start;
    return freeze({format,version:1,id,revision,duration:T.seconds(stop),initial:baseline,
      lanes:copy(lanes),sources:copy(sources),warnings:copy(warnings),events:list.map(({row})=>row),curves:buildCurves(list,lanes)});
  }

  function compile(plan){
    check(fields(plan,['format','version','id','revision','sources','lanes','duration'])&&plan.format===planFormat&&
      plan.version===1&&id(plan.id)&&revision(plan.revision??1)&&record(plan.sources)&&
      Object.keys(plan.sources).length>=1&&Object.keys(plan.sources).length<=64,'Expected a version 1 input compile plan');
    const {lanes={},duration=0}=plan;
    check(record(lanes)&&Object.keys(lanes).length<=maxChannels&&Object.keys(lanes).every(channelId),'Invalid input curve settings');
    const definitions=Object.fromEntries(Object.entries(lanes).map(([name,raw])=>[name,lane(raw)]));
    const rows=[],initial={},warnings=[],sources={};
    let stop=point(duration,undefined,'input duration');
    for(const [name,source] of Object.entries(plan.sources)){
      const kind=source?.kind, keying=new Set();
      check(channelId(name)&&name.length<=48&&id(name)&&record(source)&&['text','ipa','midi','controller','cues'].includes(kind),
        'Invalid input source '+name);
      const shift=point(undefined,source.offset??0,'source offset');
      const offset=time=>shift[0]===0n?time:T.add(shift,time);
      function eventId(key){
        const joined=name+'.'+key;
        return id(joined)?joined:name+'.'+hash(key).toString(16);
      }
      const emit={
        name,id:eventId,channelId,atZero:shift[0]===0n,
        add({key,kind,channel,start,end,value,controls,origin}){
          const id=eventId(key);
          check(!keying.has(id)&&rows.length<maxEvents,'Duplicate input event or event budget exceeded on '+name);
          keying.add(id);
          rows.push({id,source:name,kind,channel,...stamp(offset(start)),...(end&&stamp(offset(end),'end','endTimecode')),
            value,...(controls&&{controls}),...(origin!==undefined&&{origin})});
        },
        initial(channel,value,values){
          check(channelId(channel)&&!own(initial,channel)&&Object.keys(initial).length<maxChannels,'Invalid initial input channel '+channel);
          initial[channel]=value;
          for(const [key,num] of Object.entries(controls(values))){
            if(!own(lanes,key))definitions[key]={initial:num,interpolation:'step'};
            else if(lanes[key].initial===undefined)definitions[key].initial=num;
          }
        },
        warn(warning){if(warnings.length<512)warnings.push({source:name,...warning});}
      };
      const extent=offset((kind==='text'||kind==='ipa'?W.inputPhonemes.compile:W.inputSourceAdapters[kind])(source,emit));
      if(T.compare(extent,stop)>0)stop=extent;
      sources[name]={kind,...stamp(shift,'offset','offsetTimecode'),importedEvents:keying.size};
    }
    return assemble({id:plan.id,revision:plan.revision??1,duration:T.seconds(stop),initial,lanes:definitions,sources,warnings},rows);
  }

  function header(asset){
    check(asset?.format===format&&asset.version===1&&id(asset.id)&&revision(asset.revision)&&
      record(asset.initial)&&record(asset.lanes)&&record(asset.sources)&&record(asset.curves)&&
      Array.isArray(asset.warnings),'Expected a version 1 editable input score');
  }

  function edit(asset,patches=[]){
    header(asset);
    check(Array.isArray(patches)&&patches.length<=maxEvents&&revision(asset.revision+1),'Expected a bounded input score edit list');
    const rows=new Map(events(asset.events).map(({row})=>[row.id,row]));
    for(const edit of patches){
      check(record(edit)&&id(edit.id),'Input score edits need a stable event ID');
      const {op,id:target}=edit, previous=rows.get(target);
      if(op==='add'&&!previous&&fields(edit,['op','id','event'])&&record(edit.event)){
        rows.set(target,event({...edit.event,id:target}).row);
      }else if(op==='delete'&&previous&&fields(edit,['op','id'])){
        rows.delete(target);
      }else if(op==='set'&&previous&&fields(edit,['op','id','patch'])&&
        fields(edit.patch,['time','timecode','end','endTimecode','channel','kind','value','controls'])){
        const merged={...previous};
        const {patch}=edit;
        if(own(patch,'time')||own(patch,'timecode')){delete merged.time;delete merged.timecode;}
        if(own(patch,'end')||own(patch,'endTimecode')){delete merged.end;delete merged.endTimecode;}
        Object.assign(merged,patch);
        if(merged.end===null){delete merged.end;delete merged.endTimecode;}
        rows.set(target,event(merged).row);
      }else if(op==='move'&&previous&&fields(edit,['op','id','time','timecode'])){
        const current=event(previous), at=point(edit.time,edit.timecode,'edited input'), delta=T.sub(at,current.start);
        const {time,timecode,end,endTimecode,...payload}=current.row;
        rows.set(target,event({...payload,...stamp(at),...(current.end&&stamp(T.add(current.end,delta),'end','endTimecode'))}).row);
      }else throw RangeError('Invalid input edit '+op+' on '+target);
      check(rows.size<=maxEvents,'Input edits exceed the event budget');
    }
    return assemble({...asset,revision:asset.revision+1},[...rows.values()]);
  }

  W.inputScoreData=Object.freeze({format,planFormat,maxChannels,maxControls,zero,channelId,point,stamp,events,header,compile,edit,lane});
})(KIT);
