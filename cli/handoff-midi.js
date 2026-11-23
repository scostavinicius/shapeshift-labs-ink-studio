/* Standard MIDI and REAPER consume the same performed event timeline. */
const ppq=960;
const byte=value=>Math.max(0,Math.min(127,Math.round(value*127)));

function compile(plan) {
  let beat=0;
  const tempo=plan.tempo.map((row,index,all)=>{
    if (index) beat+=(row.seconds-all[index-1].seconds)*all[index-1].tempo/60;
    return {...row,beat,tick:Math.round(beat*ppq)};
  });
  function tick(sample) {
    const seconds=sample/plan.sampleRate;
    const at=tempo.findLast(row=>row.seconds<=seconds) ?? tempo[0];
    return Math.round((at.beat+(seconds-at.seconds)*at.tempo/60)*ppq);
  }
  const notices=[], tracks=Object.fromEntries(Object.entries(plan.tracks).map(([name,track])=>{
    const mpe=track.notes.some(note=>note.expression.length), messages=[], active=new Map();
    const channelEnd=Array(16).fill(0), initialized=new Set();
    let overflow=0, pitchClamps=0;
    const push=(at,order,...data)=>messages.push({tick:at,order,data});
    const rpn=(channel,at,which,amount)=>{
      for (const [controller,value] of [[101,0],[100,which],[6,amount],[38,0],[101,127],[100,127]]) {
        push(at,-3,0xb0+channel,controller,value);
      }
    };
    if (mpe) rpn(0,0,6,15);
    const noteEnd=track.notes.reduce((max,note)=>Math.max(max,tick(note.endSample)),tick(plan.scoreFrames));
    for (const note of track.notes) {
      const at=tick(note.startSample), off=Math.max(at+1,tick(note.endSample));
      let channel=0;
      if (mpe) {
        channel=channelEnd.findIndex((end,index)=>index>0 && end<=at);
        if (channel===-1) {channel=0;overflow++;}
        else {
          channelEnd[channel]=off;
          if (!initialized.has(channel)) {
            initialized.add(channel);
            rpn(channel,0,0,48);
          }
        }
      }
      if (!mpe || channel===0) {
        let taken=active.get(note.midi);
        if (!taken) {taken=Array(16).fill(0);active.set(note.midi,taken);}
        if (!mpe) channel=taken.findIndex(end=>end<=at);
        if (channel<0 || taken[channel]>at) throw new RangeError('MIDI export exceeds its simultaneous unison channels on '+name);
        taken[channel]=off;
      }
      if (mpe && channel>0) {
        // A member channel is reused only after its previous note-off.
        push(at,1,0xe0+channel,0,64);
        push(at,1,0xd0+channel,0);
        for (const [controller,value] of [[1,0],[11,127],[74,64]]) push(at,1,0xb0+channel,controller,value);
        const initial={volume:1,breath:1};
        for (const event of note.expression.slice().sort((a,b)=>a.sample-b.sample || a.type-b.type)) {
          const {type,value}=event, position=Math.min(off-1,tick(event.sample));
          if (type===2) {
            if (Math.abs(value)>48) pitchClamps++;
            const bend=Math.max(0,Math.min(16383,Math.round(8192+8192*value/48)));
            push(position,2,0xe0+channel,bend&127,bend>>7);
          } else if (type===6) push(position,2,0xd0+channel,byte(value));
          else if (type===0 || type===4) {
            initial[type===0 ? 'volume' : 'breath']=value;
            push(position,2,0xb0+channel,11,byte(initial.volume*initial.breath));
          } else push(position,2,0xb0+channel,type===3 ? 1 : 74,byte(value));
        }
      }
      push(at,3,0x90+channel,note.midi,Math.max(1,byte(note.velocity)));
      push(off,0,0x80+channel,note.midi,0);
    }
    if (overflow || pitchClamps) notices.push({track:name,mpeFallbackNotes:overflow,pitchBendClamps:pitchClamps});
    return [name,{messages:messages.sort((a,b)=>a.tick-b.tick || a.order-b.order),
      end:Math.max(noteEnd,messages.reduce((max,row)=>Math.max(max,row.tick),0)),mpe}];
  }));
  return {ppq,tempo,tick,tracks,notices};
}
function delta(n) {
  if (!Number.isInteger(n) || n<0 || n>0xfffffff) throw new RangeError('MIDI time exceeds its variable-length range');
  const bytes=[n&127];
  while ((n>>=7)) bytes.unshift((n&127)|128);
  return bytes;
}
function meta(type,data) {return [255,type,...delta(data.length),...data];}
function chunk(name,message) {
  const bytes=Buffer.alloc(8+message.length);
  bytes.write(name,0,'ascii');
  bytes.writeUInt32BE(message.length,4);
  Buffer.from(message).copy(bytes,8);
  return bytes;
}
function sequence(title,events,end) {
  const parts=[Buffer.from([0,...meta(3,Buffer.from(title,'utf8'))])];
  let prior=0;
  for (const {tick,data} of events) {
    parts.push(Buffer.from([...delta(tick-prior),...data]));
    prior=tick;
  }
  parts.push(Buffer.from([...delta(Math.max(0,end-prior)),255,47,0]));
  return chunk('MTrk',Buffer.concat(parts));
}
function encode(plan,midi) {
  const conductor=[{tick:0,data:meta(88,[plan.beatsPerBar,2,24,8])},...midi.tempo.map(row=>{
    const rate=Math.min(0xffffff,Math.round(60000000/row.tempo));
    return {tick:row.tick,data:meta(81,[(rate>>16)&255,(rate>>8)&255,rate&255])};
  }),...plan.markers.map(({id,seconds})=>({tick:midi.tick(seconds*plan.sampleRate),data:meta(6,Buffer.from(id,'utf8'))}))]
    .sort((a,b)=>a.tick-b.tick);
  const tracks=Object.entries(midi.tracks), header=Buffer.alloc(6);
  header.writeUInt16BE(1,0);
  header.writeUInt16BE(tracks.length+1,2);
  header.writeUInt16BE(midi.ppq,4);
  return Buffer.concat([chunk('MThd',header),sequence(plan.id,conductor,midi.tick(plan.scoreFrames)),
    ...tracks.map(([name,{messages,end}])=>sequence(name,messages,end))]);
}
module.exports={compile,encode};
