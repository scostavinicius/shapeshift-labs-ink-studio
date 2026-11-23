/* Compose sample phrases on the exact beat grid, then emit ordinary editable pad hits. */
(function (P) {
  const A=P.mediaGraph, T=P.takeTime, E=P.mediaGraphSupport.padEvent;
  const {fields,record,finite,integer,id,check,clamp,hash}=P.musicInstruments;
  const {add,sub,mul,compare}=T, zero=T.read(0), limit=512;
  const encode=([n,d])=>d===1n ? T.index(n) : {numerator:T.index(n),denominator:T.index(d)};
  function beat(value,lo,hi,label) {
    const result=T.read(value);
    check(finite(T.seconds(result),lo,hi),'Invalid '+label);
    return result;
  }
  function span(value,label) {
    return beat(value,1/1024,limit,label);
  }
  function table(rows,max,what) {
    check(record(rows) && Object.keys(rows).length<=max && Object.keys(rows).every(id),'Invalid '+what);
    return Object.entries(rows);
  }
  function list(rows,min,max,what) {
    check(Array.isArray(rows) && integer(rows.length,min,max),'Invalid '+what);
    return Array.from(rows);
  }
  function unique(rows) {
    check(new Set(rows.map(row=>row?.id)).size===rows.length,'Slice steps need distinct IDs');
    return rows;
  }
  function controls(play) {
    if (play===undefined) return undefined;
    E.trigger({pad:'slice',play});
    check(play.sample===undefined && play.layer===undefined && play.gate===undefined,
      'Choose the take with a slice binding and set gate in beats on the phrase');
    return play;
  }
  function playOver(base,patch) {
    if (!patch) return base;
    return {...base,...patch,...((base?.sends || patch.sends) && {sends:{...base?.sends,...patch.sends}})};
  }
  function compose(source) {
    check(fields(source,['id','slices','patterns','output','render','tail']) && id(source.id) &&
      id(source.output) && fields(source.render ?? {},['map','sampleRate','duration','stems']),
    'Expected a named slice composition, pattern bank and output');
    const slices=new Map(table(source.slices,512,'slice bindings'));
    for (const [name,row] of slices) {
      check(fields(row,['pad','note','articulation','play']) && id(row.pad) && id(row.play?.sample) &&
        row.play.gate===undefined,'Slice '+name+' needs a pad and a locked sample take');
      E.trigger(row);
    }
    const patterns=new Map(table(source.patterns,128,'named slice patterns'));
    const visiting=new Set(), resolved=new Map();
    let work=0;
    function charge(count) {
      work+=count;
      check(work<=200000,'Slice composition exceeds its expansion budget');
    }
    function place(rows,items,offset,path,length) {
      charge(items.length);
      for (const row of items) {
        const at=add(offset,row.at);
        if (compare(at,zero)<0 || length && compare(at,length)>=0) continue;
        rows.push({...row,at,path:path+'/'+row.path});
      }
      check(rows.length<=E.maxEvents,'Slice composition exceeds its hit budget');
    }
    function readPhrase(name,node) {
      check(fields(node,['op','length','hits']),'Invalid slice phrase');
      const length=span(node.length,'phrase length');
      const hits=unique(list(node.hits,0,1024,'phrase hits')).map(row=>{
        check(fields(row,['id','slice','beat','gate','velocity','note','play']) &&
          id(row.id) && slices.has(row.slice),'A phrase hit needs an ID and a known slice');
        E.trigger({pad:'slice',note:row.note,velocity:row.velocity});
        const at=beat(row.beat,0,limit,'hit beat');
        check(compare(at,length)<0,'Slice hit exceeds its phrase');
        return {at,slice:row.slice,gate:row.gate===undefined ? null : span(row.gate,'hit gate'),
          velocity:row.velocity ?? .8,note:row.note,play:controls(row.play),path:name+'/'+row.id,
          phrase:name,hit:row.id};
      });
      charge(hits.length);
      return {length,hits};
    }
    function repeat(name,node,additive) {
      check(fields(node,additive ? ['op','source','counts'] : ['op','source','length','period','phase']),
        'Invalid slice repetition');
      const pattern=resolve(node.source), rows=[];
      const counts=additive ? list(node.counts,1,4096,'additive counts') : null;
      if (counts) check(counts.every(n=>integer(n,0,pattern.hits.length)),'Additive counts exceed the available hits');
      const period=node.period===undefined ? pattern.length : span(node.period,'loop period');
      const phase=beat(node.phase ?? 0,-limit,limit,'loop phase');
      const length=counts ? mul(period,T.read(counts.length)) : span(node.length,'loop length');
      const cycles=counts?.length ?? Math.max(0,T.index(T.roundDown(T.div(sub(length,phase),period)))+1);
      check(cycles<=4096 && T.seconds(length)<=limit,'Slice repetition exceeds its cycle or length budget');
      for (let i=0;i<cycles;i++) {
        const at=add(phase,mul(period,T.read(i)));
        if (compare(at,length)>=0) break;
        const hits=counts ? pattern.hits.slice(0,counts[i]) : pattern.hits;
        place(rows,hits,at,name+'/'+i,length);
      }
      return {length,hits:rows};
    }
    function cut(name,node) {
      check(fields(node,['op','source','length','slots']),'Invalid slice cut-up');
      const pattern=resolve(node.source), length=span(node.length,'cut-up length');
      const slots=unique(list(node.slots,0,1024,'cut-up slots'));
      const names=new Map();
      for (const hit of pattern.hits) names.set(hit.hit,names.has(hit.hit) ? null : hit);
      const hits=slots.map(row=>{
        check(fields(row,['id','pick','beat','gate']) && id(row.id),'Invalid cut-up slot');
        const from=id(row.pick) ? names.get(row.pick) : pattern.hits[row.pick];
        check(from && (id(row.pick) || integer(row.pick,0,pattern.hits.length-1)),
          'A cut-up slot needs an existing hit index or unambiguous hit ID');
        const at=beat(row.beat,0,limit,'cut-up beat');
        check(compare(at,length)<0,'Cut-up hit exceeds its phrase');
        return {...from,at,gate:row.gate===undefined ? from.gate : span(row.gate,'cut-up gate'),
          path:name+'/'+row.id+'/'+from.path};
      });
      charge(hits.length);
      return {length,hits};
    }
    function voice(name,node) {
      check(fields(node,['op','source','slices','notes','gate','gain','play']) &&
        finite(node.gain ?? 1,0,2),'Invalid slice voicing');
      const pattern=resolve(node.source), swaps=new Map(table(node.slices ?? {},512,'slice substitutions'));
      for (const [from,to] of swaps) check(slices.has(from) && slices.has(to),'Unknown slice in voicing');
      const notes=node.notes===undefined ? [] : list(node.notes,1,512,'voicing notes');
      for (const note of notes) P.musicHarmony.midi(note);
      const gate=node.gate===undefined ? null : span(node.gate,'voicing gate'), play=controls(node.play);
      charge(pattern.hits.length);
      const hits=pattern.hits.map((row,i)=>({...row,path:name+'/'+row.path,
        slice:swaps.get(row.slice) ?? row.slice,note:notes.length ? notes[i%notes.length] : row.note,
        gate:gate ?? row.gate,velocity:clamp(row.velocity*(node.gain ?? 1)),play:playOver(row.play,play)}));
      return {length:pattern.length,hits};
    }
    function combine(name,node,sequence) {
      check(fields(node,sequence ? ['op','sources','gap'] : ['op','layers']),'Invalid slice combination');
      const parts=sequence ? list(node.sources,1,128,'sequence sources').map((source,i)=>[i,{source}]) :
        table(node.layers,128,'stack layers');
      const gap=beat(node.gap ?? 0,0,64,'sequence gap'), hits=[];
      let length=zero;
      check(parts.length,'A slice combination needs at least one part');
      for (const [i,row] of parts) {
        check(fields(row,['source','at']),'Invalid slice stack layer');
        const child=resolve(row.source);
        const at=sequence ? (i===0 ? zero : add(length,gap)) : beat(row.at ?? 0,0,limit,'stack offset');
        const end=add(at,child.length);
        place(hits,child.hits,at,name+'/'+i);
        if (compare(end,length)>0) length=end;
      }
      return {length,hits};
    }
    function resolve(name) {
      if (resolved.has(name)) return resolved.get(name);
      const node=patterns.get(name);
      check(record(node) && !visiting.has(name) && visiting.size<24,'Unknown, cyclic or too deeply nested slice pattern '+name);
      visiting.add(name);
      let value;
      switch (node.op) {
        case 'phrase': value=readPhrase(name,node); break;
        case 'loop': value=repeat(name,node,false); break;
        case 'additive': value=repeat(name,node,true); break;
        case 'cut': value=cut(name,node); break;
        case 'voice': value=voice(name,node); break;
        case 'sequence': value=combine(name,node,true); break;
        case 'stack': value=combine(name,node,false); break;
        default: throw new RangeError('Unknown slice pattern operation '+node.op);
      }
      check(T.seconds(value.length)<=limit,'Slice pattern exceeds its length budget');
      value.hits.sort((a,b)=>compare(a.at,b.at));
      visiting.delete(name);
      resolved.set(name,value);
      return value;
    }
    const score=resolve(source.output), render={...source.render}, clock=P.musicTiming.compile(render.map);
    const length=encode(score.length), tail=beat(source.tail ?? 0,0,120,'composition tail in seconds');
    render.duration ??=encode(add(clock.resolve({beat:length}),tail));
    const report=[];
    const events=score.hits.map(row=>{
      const {pad,note,articulation,play}=slices.get(row.slice);
      const key='sc-'+(hash([row.path])>>>0).toString(36)+'-'+(hash([...row.path].reverse())>>>0).toString(36);
      const position=encode(row.at), pitch=row.note ?? note;
      report.push({id:key,beat:position,slice:row.slice,phrase:row.phrase,hit:row.hit,path:row.path,
        pad,sample:play.sample,...(row.gate && {gate:encode(row.gate)}),...(pitch!==undefined && {note:pitch})});
      return {id:key,pad,time:{beat:position},velocity:row.velocity,
        ...(articulation!==undefined && {articulation}),...(pitch!==undefined && {note:pitch}),
        ...(row.gate && {until:{beat:encode(add(row.at,row.gate))}}),
        play:{...playOver(play,row.play),...(row.gate && {gate:true})}};
    });
    const value=A.padPattern.validate({events,options:render});
    return {value,...value,report:P.data.freeze({id:source.id,output:source.output,length,events:report})};
  }
  A.sliceComposition=Object.freeze({compose});
})(KIT.procedural);
