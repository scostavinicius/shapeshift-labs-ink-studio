/* Sequence production notes into an offline external instrument. */
(function (P) {
  const S=P.mediaGraphSupport, {fields,record,id,check,clamp,db}=P.musicInstruments;
  const limits={tuning:2,volume:0,vibrato:3,breath:4,brightness:5,pressure:6};
  const frame=(time,rate)=>Math.max(0,Math.ceil(time*rate-1e-7));
  const maxEvents=2000000;

  function patch(raw) {
    const {type,plugin,identity,state,parameters={}}=raw;
    check(fields(raw,['type','plugin','identity','state','parameters']) && id(plugin) &&
      (identity===undefined || typeof identity==='string' && identity.length<=256) &&
      (state===undefined || typeof state==='string' && state.length<=6e6) &&
      record(parameters) && Object.keys(parameters).length<=64,'Invalid CLAP instrument patch or parameter table');
    return {type,adapter:'clap',plugin,state,identity,parameters};
  }
  function value(points,phase,fallback) {
    if (!points) return fallback;
    const index=points.findIndex(point=>point[0]>phase);
    if (index===0) return points[0][1];
    if (index===-1) return points.at(-1)[1];
    const [[a,v],[b,w]]=points.slice(index-1,index+1);
    return v+(w-v)*(phase-a)/(b-a);
  }
  function expression(note,gate) {
    const play=note.play ?? {}, curves=play.curves ?? {};
    const tuning=12*Math.log2(note.frequency/(440*2**((note.midi-69)/12)))+(play.bend ?? 0)/100;
    const glide=play.glide>0 && note.fromFrequency>0 ? 12*Math.log2(note.fromFrequency/note.frequency) : 0;
    const pitch=curves.pitchCents || Math.abs(tuning)>1e-7 || glide!==0;
    const placement=note.renderGain ?? 1, fade=note.renderFade;
    const onset=note.start ?? note.time;
    const volume=curves.gainDb || curves.amplitude || placement!==1 || fade;
    const channels=[];
    if (pitch) channels.push(['tuning',phase=>Math.max(-120,Math.min(120,tuning+
      value(curves.pitchCents,phase,0)/100+(glide ? glide*(1-clamp(phase*gate/play.glide)) : 0))),
      [curves.pitchCents],glide ? [play.glide/gate] : []]);
    if (volume) {
      const gain=phase=>{
        const attack=fade ? Math.sin(Math.PI*.5*clamp((onset+phase*gate-fade.at)/fade.duration)) : 1;
        return Math.max(.000001,Math.min(4,placement*attack*
          db(value(curves.gainDb,phase,0))*value(curves.amplitude,phase,1)));
      };
      channels.push(['volume',gain,[curves.gainDb,curves.amplitude],
        fade ? [clamp((fade.at+fade.duration-onset)/gate)] : []]);
    }
    if (play.vibrato) channels.push(['vibrato',()=>play.vibrato/100,[],[]]);
    for (const name of ['breath','brightness','pressure']) if (curves[name] || play[name]!==undefined)
      channels.push([name,phase=>value(curves[name],phase,play[name]),[curves[name]],[]]);
    return channels;
  }
  function controls(note,lanes,first,stop,rate,stride,add) {
    const onset=note.start ?? note.time, gate=note.time+note.gate-onset;
    for (const [name,read,curves,extra] of lanes) {
      const offsets=new Set([first]);
      const knotTimes=curves.flatMap(curve=>(curve ?? []).map(([at])=>at)).concat(extra);
      for (const phase of knotTimes) {
        const at=frame(onset+phase*gate,rate);
        if (at>=first && at<stop) offsets.add(at);
      }
      if (knotTimes.some(phase=>phase>0)) {
        const last=Math.min(stop,frame(onset+Math.max(...knotTimes)*gate,rate)+1);
        for (let at=first+stride;at<last;at+=stride) offsets.add(at);
        if (last>first) offsets.add(last-1);
      }
      let previous;
      for (const at of [...offsets].sort((a,b)=>a-b)) {
        const v=read(clamp((at/rate-onset)/gate));
        if (v!==previous) add(at,limits[name],v);
        previous=v;
      }
    }
  }
  function expressionEvents(note,first,stop,rate,step,add) {
    const gate=note.time+note.gate-(note.start ?? note.time);
    controls(note,expression(note,gate),first,stop,rate,Math.max(1,Math.round(rate*step)),add);
  }
  function events(notes,{sampleRate:rate,end,gateEnd,stop,tails,tail,dialect}) {
    const result=[], active=new Map();
    const add=(sample,id,key,type,value)=>{
      if (sample>=stop) return;
      check(result.length<maxEvents,'CLAP instrument exceeds its note event budget');
      result.push({sample,id,key,type,value});
    };
    const stride=Math.max(1,Math.round(rate*.005));
    for (const [id,note] of notes.entries()) {
      const onset=note.start ?? note.time;
      if (onset>=end || !note.velocity) continue;
      const first=frame(onset,rate);
      if (first>=stop) continue;
      const release=Math.min(gateEnd,note.time+note.gate);
      if (release<=onset) continue;
      const off=Math.max(first+1,frame(release,rate));
      const voicedGate=note.time+note.gate-onset;
      const naturalEnd=Math.min(release+tail/rate,note.choke ?? Infinity);
      const shortened=tails?.length ? P.musicCueMap.tailLimit(tails,note.time+note.gate,naturalEnd) : null;
      const choke=note.choke===undefined && !shortened ? Infinity :
        Math.max(first+1,frame(Math.min(note.choke ?? Infinity,shortened?.stop ?? Infinity),rate));
      const offAt=Math.min(off,choke);
      const lanes=expression(note,voicedGate);
      if (dialect==='midi') {
        check(!lanes.length,'Native CLAP note expression requires a plugin with a CLAP note input');
        check((active.get(note.midi) ?? 0)<=first,'Overlapping unisons require a CLAP note input with note IDs');
        active.set(note.midi,offAt);
      }
      add(first,id,note.midi,-3,note.velocity);
      if (off<choke) add(off,id,note.midi,-2,0);
      if (choke<Infinity) add(choke,id,note.midi,-1,0);
      if (dialect==='clap') controls(note,lanes,first,Math.min(offAt,stop),rate,stride,
        (sample,type,value)=>add(sample,id,note.midi,type,value));
    }
    const priority=type=>type===-3 ? 1 : type<0 ? 0 : 2;
    return result.sort((a,b)=>a.sample-b.sample || priority(a.type)-priority(b.type) || a.id-b.id || a.type-b.type);
  }
  function transport(clock,map,rate,stop) {
    const sample=clock.sample(0), whole=Math.floor(sample.beat), fraction=sample.beat-whole;
    const performed=whole+(fraction<.5 ? 2*fraction*sample.swing :
      sample.swing+2*(fraction-.5)*(1-sample.swing));
    const meter=map.beatsPerBar ?? 4, changes=[{sample:0,beat:performed,tempo:sample.tempo}];
    for (const {beat} of map.changes ?? []) {
      const row=clock.forPosition({beat}), at=frame(row.time,rate);
      if (at>0 && at<stop && row.tempo!==changes.at(-1).tempo)
        changes.push({sample:at,beat:beat+(at/rate-row.time)*row.tempo/60,tempo:row.tempo});
    }
    return {meter,changes};
  }
  function render(music,patch,notes,options) {
    const {sampleRate,stop}=options;
    const map=music.arrangement.score.tempoMap ?? {};
    const time=S.mixerTime(sampleRate,map);
    const device=S.externalAudioDevice(patch,sampleRate,time,music.host,'instrument');
    const scheduled=events(notes,{...options,tail:device.tail,dialect:device.notes});
    const pcm=device.render({frames:stop,notes:scheduled,transport:transport(music.clock,map,sampleRate,stop)});
    return {pcm,info:{plugin:patch.plugin,identity:device.identity,noteDialect:device.notes,
      latencySamples:device.latency,tailFrames:device.tail,noteEvents:scheduled.length}};
  }
  P.musicClap=Object.freeze({patch,events,render,expressionEvents});
})(KIT.procedural);
