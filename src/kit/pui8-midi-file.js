/* Dependency-free Standard MIDI File reader shared by importers. */
(function(host){
  const maxBytes=8*1024*1024, maxNotes=16384;
  const check=(ok,message)=>{if(!ok)throw new RangeError(message);};

  function decode(data,{performance=false}={}){
    check(data instanceof Uint8Array&&data.length>=14&&data.length<=maxBytes,'Expected a bounded Standard MIDI File');
    const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
    const tag=at=>String.fromCharCode(data[at],data[at+1],data[at+2],data[at+3]);
    check(tag(0)==='MThd','Expected a Standard MIDI File header');
    const header=view.getUint32(4), format=view.getUint16(8), tracks=view.getUint16(10), ppq=view.getUint16(12);
    check(header>=6&&8+header<=data.length&&[0,1].includes(format)&&tracks>=1&&tracks<=256&&
      (format!==0||tracks===1)&&ppq>0&&ppq<32768,'Use MIDI format 0 or 1 with a PPQ division');
    let position=8+header,chunks=0,track=0,messages=0;
    const notes=[],channelEvents=[],tempos=[],trackEnds=[],warnings=[];
    while(track<tracks){
      check(position+8<=data.length&&++chunks<=512,'Truncated MIDI chunk table');
      const name=tag(position),end=position+8+view.getUint32(position+4);
      position+=8;
      check(end<=data.length,'MIDI track extends past the file');
      if(name!=='MTrk'){position=end;continue;}
      let tick=0,running;
      const active=new Map();
      function byte(){
        check(position<end,'Truncated MIDI message');
        return data[position++];
      }
      function variable(){
        let value=0;
        for(let i=0;i<4;i++){
          const next=byte();
          value=value*128+(next&127);
          if(!(next&128))return value;
        }
        throw new RangeError('Invalid MIDI variable-length value');
      }
      function parameter(){
        const next=byte();
        check(next<128,'MIDI channel parameters need seven-bit data');
        return next;
      }
      while(position<end){
        check(++messages<=1000000,'MIDI file exceeds its message budget');
        tick+=variable();
        const next=byte(),status=next>=128?next:running;
        check(status!==undefined,'MIDI running status has no channel message');
        if(next<128)position--;
        if(status>=128&&status<240){
          running=status;
          const type=status>>4,channel=(status&15)+1,first=parameter();
          const second=type===12||type===13?undefined:parameter();
          if(type!==8&&type!==9){
            if(performance){
              check(channelEvents.length<32768,'MIDI file exceeds its channel event budget');
              channelEvents.push({track,tick,channel,type,first,...(second!==undefined&&{second}),order:messages});
            }
            continue;
          }
          const key=channel*128+first;
          if(type===9&&second){
            check(notes.length<maxNotes,'MIDI file exceeds its note budget');
            const row={track,channel,pitch:first,beat:tick/ppq,velocity:second/127,
              ...(performance&&{tick,order:messages})};
            notes.push(row);
            const queue=active.get(key)??{rows:[],read:0};
            queue.rows.push([row,tick]);active.set(key,queue);
          }else{
            const queue=active.get(key);
            if(!queue){
              if(performance&&warnings.length<128)warnings.push({code:'unmatched-midi-release',track,channel,pitch:first,tick});
              continue;
            }
            const [row,start]=queue.rows[queue.read++];
            if(tick>start)row.durationBeats=(tick-start)/ppq;
            if(performance){row.endTick=tick;row.releaseVelocity=second/127;}
            if(queue.read===queue.rows.length)active.delete(key);
          }
          continue;
        }
        running=undefined;
        check([240,247,255].includes(status),'Unsupported MIDI system message');
        const type=status===255?byte():null,size=variable();
        check(position+size<=end,'Truncated MIDI system or meta event');
        if(type===47){
          check(size===0,'Invalid MIDI end of track');
          break;
        }
        if(type===81&&performance){
          check(size===3&&tempos.length<4096,'Invalid MIDI tempo or tempo budget exceeded');
          const micros=data[position]*65536+data[position+1]*256+data[position+2];
          check(micros>0,'MIDI tempo must be positive');
          tempos.push({track,tick,micros,order:messages});
        }
        position+=size;
      }
      if(performance)trackEnds.push(tick);
      position=end;track++;
    }
    return {notes:notes.sort((a,b)=>a.beat-b.beat),ppq,format,tracks,
      ...(performance&&{channelEvents,tempos,trackEnds,warnings})};
  }

  host.midiFiles=Object.freeze({decode,maxBytes});
})(typeof KIT==='undefined'?module.exports:KIT.world);
