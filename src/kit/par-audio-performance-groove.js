/* Measure amplitude and audible envelopes around sample-aligned transient cues. */
(function (P) {
  const A=P.mediaGraph;
  const {fields,record,finite,id,check}=P.musicInstruments;
  function observe(audio,lane,detect,gate) {
    const {samples,channels,sampleRate}=audio, size=samples.length/channels;
    const block=Math.max(1,Math.round(sampleRate*.003));
    function rms(first,end) {
      let sum=0;
      for (let cursor=first*channels;cursor<end*channels;cursor++) sum+=samples[cursor]**2;
      return Math.sqrt(sum/Math.max(1,(end-first)*channels));
    }
    const {events}=A.detectTransients(audio,detect);
    const onsets=events.map(({detected})=>detected.sample).filter(start=>{
      // Abrupt cutoffs can add spectral energy while waveform energy falls.
      const before=rms(Math.max(0,start-3*block),start), after=rms(start,Math.min(size,start+3*block));
      return after>0 && (before<=gate.floor || after>=.65*before);
    });
    return onsets.map((start,i)=>{
      const end=Math.min(onsets[i+1] ?? size,start+Math.ceil(gate.max*sampleRate));
      let peak=0;
      const envelope=[];
      for (let at=start;at<end;at+=block) {
        const level=rms(at,Math.min(at+block,end));
        envelope.push(level);
        if (at-start<.035*sampleRate) peak=Math.max(peak,level);
      }
      const threshold=Math.max(gate.floor,peak*gate.relative);
      const hold=Math.ceil(gate.hold*sampleRate/block);
      let quiet=0, last=end;
      if (peak>gate.floor) for (const [j,power] of envelope.entries()) {
        quiet=power>=threshold ? 0 : quiet+1;
        if (quiet>=hold) {last=start+(j+1-quiet)*block;break;}
      }
      return {lane,time:{numerator:start,denominator:sampleRate},velocity:Math.max(1e-7,peak),
        ...(last>start && peak>gate.floor && {duration:{numerator:last-start,denominator:sampleRate}})};
    });
  }
  function extract(sources,settings={}) {
    check(record(sources) && Object.keys(sources).length>=1 && Object.keys(sources).length<=32 &&
      Object.keys(sources).every(id) && fields(settings,['grid','detect','gate']) &&
      record(settings.detect ?? {}) && fields(settings.gate ?? {},['relative','floor','hold','max']),
    'Audio groove extraction needs named audio lanes and valid analysis settings');
    const gate={relative:.13,floor:.005,hold:.018,max:.7,...settings.gate};
    check(finite(gate.relative,.01,.95) && finite(gate.floor,0,.5) && finite(gate.hold,.003,.5) &&
      finite(gate.max,.02,10) && gate.hold<=gate.max,'Invalid audible-length measurement settings');
    const notes=[];
    let samples=0;
    for (const [key,input] of Object.entries(sources)) {
      const tagged=record(input) && Object.hasOwn(input,'audio');
      const lane=tagged ? input.lane ?? key : key, articulation=tagged ? input.articulation : undefined;
      check(!tagged || fields(input,['audio','lane','articulation']) && id(lane) &&
        (articulation===undefined || id(articulation)),'Invalid audio performance lane or articulation');
      const audio=A.audio(tagged ? input.audio : input);
      samples+=audio.samples.length;
      check(samples<=32e6,'Audio groove source exceeds its sample budget');
      notes.push(...observe(audio,lane,settings.detect,gate).map(row=>
        articulation===undefined ? row : {...row,articulation}));
      check(notes.length<=16384,'Groove extraction exceeds its note budget');
    }
    const result=P.performanceGroove.fit(notes,settings.grid);
    return {...result,report:{...result.report,gate,source:'audio'}};
  }
  A.extractGroove=extract;
})(KIT.procedural);
