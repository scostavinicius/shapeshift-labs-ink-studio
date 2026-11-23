/* Keep convolution returns running while listener movement changes their feeds. */
const assetName=value=>typeof value==='string'&&/^[A-Za-z0-9_][A-Za-z0-9._/-]{0,127}$/.test(value);
const unit=n=>Number.isFinite(n)&&n>=0&&n<=1;

export function validateRoomResponse(room){
  if(room===undefined)return;
  if(!room||!Array.isArray(room.assets)||room.assets.length<1||room.assets.length>8||
    !Array.from(room.assets).every(assetName)||new Set(room.assets).size!==room.assets.length||!unit(room.smoothing)||
    !Array.isArray(room.sends)||room.sends.length>room.assets.length||!Array.from(room.sends).every(send=>
      send&&room.assets.includes(send.asset)&&unit(send.gain))||new Set(room.sends.map(send=>send.asset)).size!==room.sends.length)
    throw new TypeError('Invalid spatial audio room response frame');
}

export function createRoomResponse(context,destination,asset){
  const responses=new Map();
  let input;
  function volume(row,target,smoothing,at){
    const param=row.send.gain, prior=row.automation;
    if(prior?.target===target&&prior.smoothing===smoothing)return;
    const level=prior?.smoothing ? prior.target+(prior.level-prior.target)*Math.exp((prior.at-at)/prior.smoothing) : prior?.target;
    param.cancelScheduledValues(at);
    if(prior&&smoothing){
      param.setValueAtTime(level,at);
      param.setTargetAtTime(target,at,smoothing);
    }else param.setValueAtTime(target,at);
    row.automation={target,smoothing,at,level:level??target};
  }
  function add(id){
    const send=context.createGain(), convolver=context.createConvolver(), row={send,convolver};
    // A changing input channel layout can reset convolution history.
    convolver.channelCount=2;
    convolver.channelCountMode='explicit';
    convolver.normalize=false;
    send.connect(convolver);
    convolver.connect(destination);
    input.connect(send);
    responses.set(id,row);
    row.pending=asset(id).then(buffer=>{
      if(responses.get(id)!==row)return;
      if(![1,2].includes(buffer.numberOfChannels)||buffer.sampleRate!==context.sampleRate||
        buffer.length>Math.min(context.sampleRate*8,262144))
        throw new RangeError('Room response needs a bounded mono or stereo AudioBuffer at the context sample rate: '+id);
      convolver.buffer=buffer;
    }).catch(error=>{
      if(responses.get(id)!==row)return;
      remove(id,row);
      throw error;
    });
    return row;
  }
  function remove(id,{send,convolver}){
    responses.delete(id);
    input.disconnect(send);
    send.disconnect();
    convolver.disconnect();
  }
  function update(room){
    const ids=room?.assets??[], at=context.currentTime;
    if(!input&&ids.length){
      if(typeof context.createConvolver!=='function')throw new TypeError('Room response requires a Web Audio ConvolverNode');
      input=context.createGain();
      input.channelCount=2;
      input.channelCountMode='explicit';
    }
    if(new Set([...responses.keys(),...ids]).size>8)
      throw new RangeError('Reset spatial audio before loading more than eight room response assets');
    const pending=[];
    for(const id of ids)pending.push((responses.get(id)??add(id)).pending);
    for(const [id,row] of responses)
      volume(row,room?.sends.find(send=>send.asset===id)?.gain??0,room?.smoothing??.035,at);
    return pending.length ? Promise.all(pending) : undefined;
  }
  return {
    get input(){return input;},
    update,
    reset(){for(const [id,row] of responses)remove(id,row);}
  };
}
