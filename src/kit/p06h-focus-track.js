/* One musical cue track for subject contrast and post-insert mix perspective. */
(function (P) {
  const T=P.takeTime, {fields,record,finite,id,check}=P.musicInstruments;
  const minGainDb=-60, maxGainDb=12;

  function prepare(source) {
    if (source === undefined || source === false) return null;
    check(fields(source,['id','map','subjects','cues']) && id(source.id) && record(source.subjects) &&
      Object.keys(source.subjects).length<=48 && Array.isArray(source.cues) && source.cues.length>0 &&
      source.cues.length<=128,'Invalid shared focus track');
    const clock=P.musicTiming.compile(source.map), strips=new Set(), subjects=new Map();
    for (const [name,row] of Object.entries(source.subjects)) {
      check(id(name) && fields(row,['picture','mix']) && (row.picture !== undefined || row.mix !== undefined),
        'Invalid focus subject '+name);
      const {picture,mix={}}=row;
      let visual;
      if (picture !== undefined) {
        check(fields(picture,['select','contrast','pivot']) && finite(picture.contrast,0,4) &&
          finite(picture.pivot ?? .5,0,1),'Invalid picture contrast for focus subject '+name);
        const select=TargetSelectors.prepare(picture.select);
        check(!('medium' in select || 'mediumKind' in select),'Focus picture selectors need a scene subject');
        visual={select,contrast:picture.contrast,pivot:picture.pivot ?? .5};
      }
      check(record(mix) && Object.keys(mix).length<=48,'Invalid mixer strip table for focus subject '+name);
      for (const [strip,value] of Object.entries(mix)) {
        check(id(strip) && finite(value,minGainDb,maxGainDb),'Invalid focus gain in dB for strip '+strip);
        strips.add(strip);
      }
      subjects.set(name,{id:name,picture:visual,mix:new Map(Object.entries(mix))});
    }
    let previous=null;
    const cues=Array.from(source.cues,row=>{
      check(fields(row,['beat','subject','fade']) && finite(row.beat,0,1e6) &&
        finite(row.fade ?? 0,0,1e6) && (row.subject===null || subjects.has(row.subject)),
      'Focus cues need a beat, a known subject (or null), and an optional fade in beats');
      const exact=clock.resolve({beat:row.beat});
      const extent=T.add(T.read(row.beat),T.read(row.fade ?? 0));
      const exactEnd=clock.resolve({beat:T.pack(extent)});
      const start=T.seconds(exact), end=T.seconds(exactEnd);
      check(finite(start,0,3600) && finite(end,start,3600) &&
        (!previous || T.compare(previous.exact,exact)<0 && T.compare(previous.exactEnd,exact)<=0),
      'Focus cues need increasing times within one hour and fades that finish by the next cue');
      const cue={start,end,exact,exactEnd,from:previous?.to,to:subjects.get(row.subject)};
      previous=cue;
      return cue;
    });
    return {id:source.id,cues,strips:[...strips]};
  }

  function at(track,seconds) {
    if (seconds<track.cues[0].start) return {weight:1};
    let left=0,right=track.cues.length;
    while (left+1<right) {
      const mid=(left+right)>>>1;
      if (track.cues[mid].start<=seconds) left=mid;
      else right=mid;
    }
    const {from,to,start,end}=track.cues[left];
    return {from,to,weight:seconds>=end ? 1 : (seconds-start)/(end-start)};
  }

  function picture(state) {
    return [[state.from?.picture,1-state.weight],[state.to?.picture,state.weight]].flatMap(([grade,weight])=>
      grade && grade.contrast!==1 && weight>0 ? [{...grade,amount:(grade.contrast-1)*weight}] : []);
  }

  function mixLane(track,strip,rate) {
    const gain=subject=>subject?.mix.get(strip) ?? 0;
    if (!track.cues.some(({to})=>gain(to)!==0)) return undefined;
    const sampleRate=T.read(rate), boundaries=new Set([0]);
    function bracket(time) {
      const [n,d]=T.mul(time,sampleRate), first=T.index((n+d-1n)/d);
      if (first>0) boundaries.add(first-1);
      boundaries.add(first);
    }
    for (const cue of track.cues) {
      if (gain(cue.from)===gain(cue.to)) continue;
      bracket(cue.exact);
      bracket(cue.exactEnd);
    }
    // Neighbors around each corner retain both instantaneous cuts and sub-sample fades.
    const points=[...boundaries].sort((a,b)=>a-b).map(sample=>{
      const {from,to,weight}=at(track,sample/rate);
      const a=gain(from), b=gain(to);
      const value=Math.max(minGainDb,Math.min(maxGainDb,a+(b-a)*weight));
      return {at:sample,value};
    });
    return {unit:'samples',curve:'linear',points};
  }

  P.focusTrack=Object.freeze({prepare,at,picture,mixLane});
})(KIT.procedural);
