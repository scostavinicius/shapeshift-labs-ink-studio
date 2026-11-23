/* Lower MIDI files, controller captures and cue tracks to shared input rows. */
(function(K){
  const W=K.world,P=K.procedural,T=P.takeTime,A=P.mediaGraph;
  const {check,id,record}=W.data,{fields}=W.boundarySignals;
  const integer=(n,lo,hi)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;
  const zero=T.read(0);

  function midiClock(division,tempos){
    const denominator=1000000n*BigInt(division);
    const rows=[{tick:0,elapsed:0n,micros:500000}];
    for(const {tick,micros} of tempos.slice().sort((a,b)=>a.tick-b.tick||a.order-b.order)){
      const prior=rows.at(-1), elapsed=prior.elapsed+BigInt(tick-prior.tick)*BigInt(prior.micros);
      const row={tick,micros,elapsed};
      if(tick===prior.tick)rows[rows.length-1]=row;
      else rows.push(row);
    }
    return tick=>{
      let lo=1,hi=rows.length;
      while(lo<hi){
        const at=(lo+hi)>>>1;
        if(rows[at].tick<=tick)lo=at+1;
        else hi=at;
      }
      const row=rows[lo-1];
      return T.div([row.elapsed+BigInt(tick-row.tick)*BigInt(row.micros),1n],[denominator,1n]);
    };
  }

  function midi(source,emit){
    check(fields(source,['kind','offset','bytes','tracks','channels']),'Invalid MIDI input source');
    const bytes=source.bytes,trackList=source.tracks,channelList=source.channels;
    const select=(list,max,limit,min,label)=>{
      if(list===undefined)return null;
      check(Array.isArray(list)&&integer(list.length,1,limit)&&Array.from(list).every(n=>integer(n,min,max))&&
        new Set(list).size===list.length,'Invalid MIDI '+label+' filter');
      return new Set(list);
    };
    check(bytes instanceof Uint8Array||Array.isArray(bytes)&&bytes.length<=W.midiFiles.maxBytes&&
      Array.from(bytes).every(n=>integer(n,0,255)),'MIDI input needs Standard MIDI File bytes');
    const {ppq,notes,channelEvents,tempos,trackEnds,warnings}=W.midiFiles.decode(
      bytes instanceof Uint8Array?bytes:Uint8Array.from(bytes),{performance:true});
    const tracks=select(trackList,trackEnds.length-1,256,0,'track'), channels=select(channelList,16,16,1,'channel');
    const accepted=row=>(!tracks||tracks.has(row.track))&&(!channels||channels.has(row.channel));
    const time=midiClock(ppq,tempos);
    const rows=[
      ...notes.filter(accepted).map(row=>({kind:'note',row})),
      ...channelEvents.filter(accepted).map(row=>({kind:'controller',row})),
      ...tempos.map(row=>({kind:'tempo',row}))
    ].sort((a,b)=>a.row.order-b.row.order);
    let end=zero,unclosed=0;
    for(const {kind,row} of rows){
      const {track,tick,order,channel}=row, start=time(tick), key=String(order);
      const point={key,kind,start};
      const coordinate={track,tick,ppq,...(channel!==undefined&&{channel})};
      if(kind==='tempo'){
        emit.add({...point,channel:emit.name+':tempo',value:{...coordinate,microsPerBeat:row.micros}});
      }else{
        const prefix=emit.name+':t'+track+':ch'+channel+':';
        if(kind==='note'){
          const {pitch,velocity,releaseVelocity}=row, closed=row.endTick!==undefined, last=row.endTick??trackEnds[track];
          if(!closed)unclosed++;
          const span=last>tick?time(last):undefined, lane=prefix+'note'+pitch;
          emit.add({...point,channel:lane,value:{...coordinate,pitch,velocity,endTick:last,closed,
            ...(releaseVelocity!==undefined&&{releaseVelocity})},...(span&&{end:span})});
          if(span&&T.compare(span,end)>0)end=span;
        }else{
          const {type,first,second}=row;
          const label=type===10?'pressure'+first:type===11?'cc'+first:type===12?'program':type===13?'pressure':'bend';
          const value=type===14?((second<<7)+first-8192)/8192:type===12?first:(second??first)/127;
          const lane=prefix+label;
          emit.add({...point,kind:'set',channel:lane,value,origin:{...coordinate,message:label,first,...(second!==undefined&&{second})}});
        }
      }
      if(T.compare(start,end)>0)end=start;
    }
    for(const warning of warnings)if(accepted(warning))emit.warn(warning);
    if(unclosed)emit.warn({code:'unclosed-midi-note',count:unclosed});
    // Keep the trailing silence of selected tracks.
    for(const [track,tick] of trackEnds.entries())if(!tracks||tracks.has(track)){
      const stop=time(tick);
      if(T.compare(stop,end)>0)end=stop;
    }
    return end;
  }

  function numeric(channel,value){
    if(typeof value==='boolean'||Number.isFinite(value))return {[channel]:Number(value)};
    if(Array.isArray(value)&&(value.length===2||value.length===3)&&value.every(Number.isFinite))
      return Object.fromEntries(value.map((component,i)=>[channel+'.'+'xyz'[i],component]));
    return {};
  }

  function controller(source,emit){
    check(fields(source,['kind','offset','recording','channels']),'Invalid controller input source');
    const {channels}=source;
    check(channels===undefined||Array.isArray(channels)&&channels.length>0&&channels.length<=1024&&
      new Set(channels).size===channels.length&&Array.from(channels).every(emit.channelId),'Invalid controller channel filter');
    const selected=channels===undefined?null:new Set(channels);
    const recording=A.recording(source.recording);
    function use(channel){return !selected||selected.has(channel);}
    for(const [i,[name,value]] of Object.entries(recording.initial).entries()){
      if(!use(name))continue;
      const channel=emit.name+':'+name, controls=numeric(channel,value);
      if(emit.atZero)emit.initial(channel,value,controls);
      else emit.add({key:'initial-'+i,kind:'set',channel,start:zero,value});
    }
    let last=zero;
    for(const [i,row] of recording.events.entries()){
      if(!use(row.channel))continue;
      const {kind,value}=row, channel=emit.name+':'+row.channel, start=T.read(row.timecode??row.time);
      emit.add({key:String(i),kind,channel,start,value,origin:{recordingIndex:i}});
      last=start;
    }
    return last;
  }

  function cues(source,emit){
    check(fields(source,['kind','offset','items','track','tempoMap','channel'])&&
      (source.items===undefined)!==(source.track===undefined),'Cue input needs a cue list or a musical event track');
    const {channel=emit.name+':cue',tempoMap}=source;
    const timing=tempoMap===undefined?null:P.musicTiming.compile(tempoMap);
    const point=raw=>{
      if(record(raw)&&['beat','bar','phrase'].some(key=>Object.hasOwn(raw,key))){
        check(timing,'Beat-addressed cues need a tempo map');
        return timing.resolve(raw);
      }
      return T.read(raw);
    };
    const rows=source.track===undefined?source.items:A.musicalEventTrack(source.track).events.map(row=>({
      id:row.id,time:row.timecode??row.time,label:row.name,...(row.detected&&{value:row.detected})
    }));
    check(Array.isArray(rows)&&rows.length<=8192,'Invalid or oversized cue list');
    let last=zero;
    for(const row of rows){
      check(fields(row,['id','time','end','label','value','channel','controls'])&&id(row.id)&&
        (row.label===undefined||typeof row.label==='string'&&row.label.length<=256),'Invalid cue event');
      const start=point(row.time), end=row.end===undefined?undefined:point(row.end);
      emit.add({key:row.id,kind:'cue',channel:row.channel??channel,start,end,controls:row.controls,
        value:{...(row.label!==undefined&&{label:row.label}),...(row.value!==undefined&&{data:row.value})}});
      if(T.compare(end??start,last)>0)last=end??start;
    }
    return last;
  }

  W.inputSourceAdapters=Object.freeze({midi,controller,cues,numeric});
})(KIT);
