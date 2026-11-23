/* Aligned repair, ridden bypass, and a polarity-exact difference audition. */
(function (P) {
  const A=P.mediaGraph,S=P.mediaGraphSupport,{fields,integer,check,db}=P.musicInstruments;
  function repairDialogue(input,options={}) {
    const source=A.audio(input), {channels,sampleRate,samples}=source, frames=samples.length/channels;
    check(fields(options,['gainDb','declick','hum','deess','spectral','preview']) && channels<=2 &&
      integer(sampleRate,8000,96000) && frames>0 && samples.length<=8e6,'Expected bounded mono or stereo dialogue and repair settings');
    const selection=options.preview ?? {fromSample:0,toSample:frames};
    check(S.repairRange(selection,frames),'Repair preview needs an in-bounds source range');
    const time=S.mixerTime(sampleRate);
    const ride=time.lane(options.gainDb,0,-48,24,'dialogue clip gain'), gain=ride.reader();
    const repaired=Float64Array.from(samples), steps={};
    if (options.declick!==undefined) steps.declick=S.repairClicks(repaired,channels,sampleRate,options.declick);
    if (options.hum!==undefined) steps.hum=S.repairHum(repaired,channels,sampleRate,options.hum);
    if (options.spectral!==undefined) steps.spectral=S.repairSpectrum(repaired,channels,sampleRate,options.spectral);
    const original=new Float64Array(samples.length);
    for (let i=0;i<frames;i++) {
      const scale=db(gain(i));
      for (let ch=0;ch<channels;ch++) {
        const index=i*channels+ch;
        original[index]=samples[index]*scale;
        repaired[index]*=scale;
      }
    }
    if (options.deess!==undefined) {
      check(fields(options.deess,['wet','hz','q','keyHz','keyQ','thresholdDb','ratio','rangeDb','attack','release']),
        'Invalid de-ess settings');
      const processor=S.mixerProcessor({type:'deesser',...options.deess},sampleRate,time);
      const apply=processor.make(), wet=processor.wet.reader(), out=[0,0];
      let power=0;
      for (let i=0;i<frames;i++) {
        const left=repaired[i*channels], right=channels===2 ? repaired[i*2+1] : left;
        apply(left,right,left,right,i,out);
        const u=wet(i), l=(left-out[0])*u, r=(right-out[1])*u;
        power+=l*l+(channels===2 ? r*r : 0);
        repaired[i*channels]-=l;
        if (channels===2) repaired[i*2+1]-=r;
      }
      steps.deess={removedRms:Math.sqrt(power/repaired.length)};
    }
    const {fromSample,toSample}=selection, first=fromSample*channels, last=toSample*channels;
    const delta=new Float64Array(last-first);
    let peak=0,total=0;
    for (let i=0;i<samples.length;i++) {
      const removed=original[i]-repaired[i];
      check(Number.isFinite(removed),'Dialogue repair produced nonfinite audio');
      if (i>=first && i<last) {
        delta[i-first]=removed;
        total+=removed*removed;
      }
      peak=Math.max(peak,Math.abs(original[i]),Math.abs(repaired[i]),Math.abs(removed));
    }
    const headroom=1/Math.max(1,peak);
    function pcm(data) {
      if (headroom<1) for (let i=0;i<data.length;i++) data[i]*=headroom;
      return {sampleRate,channels,samples:data};
    }
    return {value:pcm(repaired.subarray(first,last)),before:pcm(original.subarray(first,last)),removed:pcm(delta),
      report:{sampleRate,channels,sourceFrames:frames,fromSample,toSample,
        gainDb:ride.points,steps,headroom,removedRms:Math.sqrt(total/delta.length)*headroom}};
  }
  A.repairDialogue=repairDialogue;
})(KIT.procedural);
