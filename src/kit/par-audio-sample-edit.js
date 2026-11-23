/* Nondestructive source markers, clips and overlapping joins on the PCM grid. */
(function (P) {
  const A = P.mediaGraph, {plain, int} = P.mediaGraphSupport, {id} = P.musicInstruments;
  const format = 'ink-studio/sample-edit', maxMarkers = 4096, maxClips = 512;
  const kinds = ['slice','attack','body','tail'], curves = ['linear','equal-power'];
  const only = (row, keys) => plain(row) && Object.keys(row).every(key => keys.includes(key));
  const check = (value,message) => {if (!value) throw new RangeError(message);};
  const text = value => typeof value==='string' && value.trim().length>0 && value.length<=128;
  const frameOrder = (a,b) => a.at-b.at;

  function marker(row, frames) {
    check(only(row,['id','at','kind','label','strength']) && id(row.id) && row.id!=='leading' &&
      int(row.at,0,frames-1) && kinds.includes(row.kind ?? 'slice') &&
      (row.label===undefined || text(row.label)) &&
      (row.strength===undefined || Number.isFinite(row.strength) && row.strength>=0),
      'Invalid sample marker');
    const {id:key,at,kind='slice',label,strength} = row;
    return {id:key,at,kind,...(label!==undefined && {label}),...(strength!==undefined && {strength})};
  }

  function clip(row, frames) {
    check(only(row,['id','from','to','reverse','slice']) && id(row.id) &&
      int(row.from,0,frames-1) && int(row.to,row.from+1,frames) &&
      (row.reverse===undefined || typeof row.reverse==='boolean') &&
      (row.slice===undefined || id(row.slice)), 'Invalid sample clip range');
    const {id:key,from,to,reverse=false,slice} = row;
    return {id:key,from,to,reverse,...(slice!==undefined && {slice})};
  }

  function sourceInfo(row) {
    check(only(row,['id','asset','sampleRate','channels','frames']) && id(row.id) &&
      int(row.sampleRate,1,768000) && int(row.channels,1,64) && int(row.frames,1,32e6/row.channels) &&
      (row.asset===undefined || typeof row.asset==='string' && /^[a-f0-9]{64}$/.test(row.asset)),
      'Invalid sample edit source');
    const {id:key,sampleRate,channels,frames,asset}=row;
    return {id:key,sampleRate,channels,frames,...(asset!==undefined && {asset})};
  }
  const length = row => row.to-row.from;
  const adjacent = (clips, left, right) => {
    const index = clips.findIndex(row=>row.id===left);
    check(index>=0 && clips[index+1]?.id===right,'A join needs adjacent clips in playback order');
    return index;
  };
  function document(raw) {
    check(only(raw,['format','version','source','markers','clips','joins']) && raw.format===format && raw.version===1 &&
      Array.isArray(raw.markers) && raw.markers.length<=maxMarkers &&
      Array.isArray(raw.clips) && raw.clips.length>=1 && raw.clips.length<=maxClips &&
      Array.isArray(raw.joins) && raw.joins.length<raw.clips.length,'Invalid sample edit document');
    const source=sourceInfo(raw.source), {frames,channels}=source;
    const markers=Array.from(raw.markers,row=>marker(row,frames)).sort(frameOrder);
    const clips=Array.from(raw.clips,row=>clip(row,frames));
    check(new Set(markers.map(row=>row.id)).size===markers.length &&
      markers.every((row,i)=>i===0 || row.at!==markers[i-1].at),'Markers need unique IDs and source frames');
    check(new Set(clips.map(row=>row.id)).size===clips.length,'Clip IDs must be unique');
    const incoming=new Map(), outgoing=new Map();
    const joins=Array.from(raw.joins,row=>{
      check(only(row,['left','right','frames','curve']) && curves.includes(row.curve ?? 'linear') &&
        int(row.frames,1,frames) && !incoming.has(row.right),'Invalid sample crossfade');
      adjacent(clips,row.left,row.right);
      incoming.set(row.right,row.frames);
      outgoing.set(row.left,row.frames);
      return {left:row.left,right:row.right,frames:row.frames,curve:row.curve ?? 'linear'};
    });
    check(clips.every(row=>(incoming.get(row.id) ?? 0)+(outgoing.get(row.id) ?? 0)<=length(row)),
      'Crossfades overlap or exceed a clip');
    check(clips.reduce((sum,row)=>sum+length(row)-(incoming.get(row.id) ?? 0),0)*channels<=32e6,
      'Sample edit exceeds the output PCM budget');
    return {format,version:1,source,markers,clips,joins};
  }

  function create(input, options={}) {
    check(only(options,['source','detect']) && only(options.source ?? {},['id','asset']) &&
      (options.detect===undefined || plain(options.detect)),'Invalid sample slice options');
    const {sampleRate,channels,samples}=A.audio(input), frames=samples.length/channels;
    const source=sourceInfo({id:'recording',...options.source,sampleRate,channels,frames});
    const markers=options.detect===undefined ? [] : A.detectTransients(input,options.detect).events.map(row=>({
      id:row.id,at:row.detected.sample,kind:'attack',strength:row.detected.strength
    }));
    return P.data.freeze(document({format,version:1,source,markers,clips:[{id:'original',from:0,to:frames}],joins:[]}));
  }

  function regions(markers, frames) {
    const ordered=[...markers].sort(frameOrder);
    if (ordered[0]?.at!==0) ordered.unshift({id:'leading',at:0,kind:'slice'});
    return ordered.map(({at:from,...meta},i)=>({...meta,from,to:ordered[i+1]?.at ?? frames}));
  }
  function edit(previous, operations=[]) {
    const next=document(previous), {frames}=next.source;
    check(Array.isArray(operations) && operations.length<=512,'Sample edit needs up to 512 operations');
    const markers=new Map(next.markers.map(row=>[row.id,row]));
    function namedMarker(key) {
      check(markers.has(key),'Unknown sample marker '+key);
      return markers.get(key);
    }
    function add(row) {
      check(!markers.has(row.id) && markers.size<maxMarkers,'Sample marker already exists or exceeds the marker budget');
      markers.set(row.id,marker(row,frames));
    }
    function namedClip(key) {
      const row=next.clips.find(clip=>clip.id===key);
      check(row,'Unknown sample clip '+key);
      return row;
    }
    for (const op of operations) {
      switch (op?.op) {
        case 'add':
          check(only(op,['op','id','at','kind','label']),'Invalid add marker edit');
          { const {op:action,...row}=op; add(row); }
          break;
        case 'move':
          check(only(op,['op','id','at']) && int(op.at,0,frames-1),'Invalid move marker edit');
          namedMarker(op.id).at=op.at;
          break;
        case 'delete':
          check(only(op,['op','id']) && markers.delete(op.id),'Unknown marker to delete');
          break;
        case 'splitHit': {
          check(only(op,['op','id','body','tail','bodyId','tailId']),'Invalid hit split');
          const hit=namedMarker(op.id), end=Math.min(frames,...Array.from(markers.values())
            .filter(row=>row.at>hit.at).map(row=>row.at));
          const span=end-hit.at;
          const body=op.body ?? hit.at+Math.max(1,Math.min(Math.round(.012*next.source.sampleRate),Math.floor(span/3)));
          const tail=op.tail ?? hit.at+Math.max(body-hit.at+1,Math.floor(span*.7));
          check(int(body,hit.at+1,end-2) && int(tail,body+1,end-1),'Attack, body and tail need three nonempty ranges');
          hit.kind='attack';
          add({id:op.bodyId ?? hit.id.slice(0,43)+'-body',at:body,kind:'body'});
          add({id:op.tailId ?? hit.id.slice(0,43)+'-tail',at:tail,kind:'tail'});
          break;
        }
        case 'assemble': {
          check(only(op,['op','clips']) && Array.isArray(op.clips) && op.clips.length>=1 && op.clips.length<=maxClips,
            'Assembly needs one to 512 clips');
          const slices=new Map(regions(markers.values(),frames).map(row=>[row.id,row]));
          next.clips=Array.from(op.clips,row=>{
            if (only(row,['id','slice','reverse']) && row.slice!==undefined) {
              const slice=slices.get(row.slice);
              check(slice,'Unknown source slice '+row.slice);
              return clip({...row,from:slice.from,to:slice.to},frames);
            }
            return clip(row,frames);
          });
          next.joins=[];
          break;
        }
        case 'trim': {
          check(only(op,['op','id','head','tail']),'Invalid clip trim');
          const row=namedClip(op.id), {head=0,tail=0}=op;
          check(int(head,0,length(row)-1) && int(tail,0,length(row)-head-1),'Trim must leave a nonempty clip');
          row.from+=row.reverse ? tail : head;
          row.to-=row.reverse ? head : tail;
          break;
        }
        case 'slip': {
          check(only(op,['op','id','frames']),'Invalid clip slip');
          const row=namedClip(op.id);
          check(int(op.frames,-row.from,frames-row.to),'Slip moves the clip outside its source');
          row.from+=op.frames;
          row.to+=op.frames;
          break;
        }
        case 'reverse':
          check(only(op,['op','id']),'Invalid clip reverse');
          { const row=namedClip(op.id); row.reverse=!row.reverse; }
          break;
        case 'crossfade':
          check(only(op,['op','left','right','frames','curve']) && int(op.frames,0,frames) &&
            curves.includes(op.curve ?? 'linear'),'Invalid crossfade edit');
          adjacent(next.clips,op.left,op.right);
          next.joins=next.joins.filter(row=>row.left!==op.left || row.right!==op.right);
          if (op.frames) next.joins.push({left:op.left,right:op.right,frames:op.frames,curve:op.curve ?? 'linear'});
          break;
        default: throw new RangeError('Unknown sample edit operation');
      }
    }
    next.markers=[...markers.values()];
    return P.data.freeze(document(next));
  }

  function open(input, raw) {
    const audio=A.audio(input), doc=document(raw);
    const {sampleRate,channels,frames}=doc.source;
    check(audio.sampleRate===sampleRate && audio.channels===channels && audio.samples.length===frames*channels,
      'PCM does not match the sample edit source');
    return {audio,doc};
  }
  function layout(clips, joins) {
    const edges=new Map(joins.map(row=>[row.right,row]));
    let end=0;
    const rows=clips.map(row=>{
      const fade=edges.get(row.id), start=end-(fade?.frames ?? 0);
      end=start+length(row);
      return {...row,start,end,fade};
    });
    return {rows,end};
  }
  const fadeWeight = (u, curve, incoming) => curve==='equal-power' ?
    (incoming ? Math.sin(u*Math.PI/2) : Math.cos(u*Math.PI/2)) : (incoming ? u : 1-u);
  const sampleIndex = (row, offset, channels) => (row.reverse ? row.to-1-offset : row.from+offset)*channels;
  function gainFor({samples,channels}, plan) {
    let peak=1;
    for (let index=1;index<plan.rows.length;index++) {
      const right=plan.rows[index], left=plan.rows[index-1], fade=right.fade;
      if (fade?.curve!=='equal-power') continue;
      for (let i=0;i<fade.frames;i++) {
        const u=(i+1)/(fade.frames+1), a=fadeWeight(u,fade.curve,false), b=fadeWeight(u,fade.curve,true);
        const source=sampleIndex(left,length(left)-fade.frames+i,channels), dest=sampleIndex(right,i,channels);
        for (let channel=0;channel<channels;channel++)
          peak=Math.max(peak,Math.abs(samples[source+channel]*a+samples[dest+channel]*b));
      }
    }
    return 1/peak;
  }
  function window(audio, plan, first, last, gain=1) {
    const {sampleRate,channels,samples}=audio;
    check(int(first,0,plan.end-1) && int(last,first+1,plan.end),'Sample render is outside the playback range');
    check((last-first)*channels<=32e6,'Sample audition exceeds the output PCM budget');
    const output=new Float64Array((last-first)*channels);
    for (let index=0;index<plan.rows.length;index++) {
      const row=plan.rows[index], incoming=row.fade, outgoing=plan.rows[index+1]?.fade;
      for (let frame=Math.max(first,row.start);frame<Math.min(last,row.end);frame++) {
        const offset=frame-row.start, source=sampleIndex(row,offset,channels);
        const remaining=row.end-frame, dest=(frame-first)*channels;
        let weight=1;
        if (incoming && offset<incoming.frames) weight=fadeWeight((offset+1)/(incoming.frames+1),incoming.curve,true);
        if (outgoing && remaining<=outgoing.frames)
          weight=fadeWeight((outgoing.frames-remaining+1)/(outgoing.frames+1),outgoing.curve,false);
        for (let channel=0;channel<channels;channel++) output[dest+channel]+=samples[source+channel]*weight;
      }
    }
    if (gain<1) for (let i=0;i<output.length;i++) output[i]=Math.max(-1,Math.min(1,output[i]*gain));
    return {sampleRate,channels,samples:output};
  }
  function render(input, raw, options={}) {
    check(only(options,['firstSample','endSample','slice']),'Invalid sample render options');
    const {audio,doc}=open(input,raw);
    const slices=regions(doc.markers,doc.source.frames);
    const slice=options.slice===undefined ? undefined : slices.find(row=>row.id===options.slice);
    check(options.slice===undefined || slice,'Unknown sample slice '+options.slice);
    const plan=slice ? layout([slice],[]) : layout(doc.clips,doc.joins);
    const {firstSample=0,endSample=plan.end}=options;
    const gain=gainFor(audio,plan), value=window(audio,plan,firstSample,endSample,gain);
    return {value,report:{source:doc.source,firstSample,endSample,gain,slices,
      clips:plan.rows.map(({fade,...row})=>row),
      joins:plan.rows.filter(row=>row.fade).map(row=>({...row.fade,at:row.start}))}};
  }
  function audition(input, raw, options={}) {
    check(only(options,['marker','left','right','before','after']) &&
      (options.marker!==undefined ? options.left===undefined && options.right===undefined :
        id(options.left) && id(options.right)),'Choose a source marker or an adjacent clip join');
    const {audio,doc}=open(input,raw), {sampleRate,frames}=doc.source;
    const {before=Math.round(.2*sampleRate),after=Math.round(.35*sampleRate)}=options;
    check(int(before,0,2*sampleRate) && int(after,0,2*sampleRate) && before+after>0,
      'Audition handles need a nonempty range of up to two seconds on each side');
    function around(plan, at, overlap=0, gain=1) {
      const firstSample=Math.max(0,at-before), endSample=Math.min(plan.end,at+overlap+after);
      return {value:window(audio,plan,firstSample,endSample,gain),firstSample,endSample,center:at-firstSample};
    }
    if (options.marker!==undefined) {
      const cut=doc.markers.find(row=>row.id===options.marker);
      check(cut,'Unknown audition marker '+options.marker);
      const {value,...report}=around(layout([{from:0,to:frames}],[]),cut.at);
      return {value,report:{...report,marker:cut.id,source:doc.source}};
    }
    const {left,right}=options, index=adjacent(doc.clips,left,right);
    const plan=layout(doc.clips,doc.joins), row=plan.rows[index+1], overlap=row.fade?.frames ?? 0;
    const dryPlan=layout(doc.clips,doc.joins.filter(join=>join.right!==right));
    const gain=gainFor(audio,plan);
    const {value,...edited}=around(plan,row.start,overlap,gain);
    const {value:hardCut,...dry}=around(dryPlan,dryPlan.rows[index+1].start,0,gain);
    return {value,hardCut,report:{edited,dry,gain,source:doc.source,left,right,overlap,curve:row.fade?.curve ?? null}};
  }

  A.sampleEdit=Object.freeze({create,edit,render,audition,validate:raw=>P.data.freeze(document(raw))});
})(KIT.procedural);
