/* Search independent musical moves within authored arrangement locks. */
(function (P) {
  const A=P.musicProduction,H=P.musicHarmony,L=P.musicArrangementLocks;
  const {check,fields,id,integer,finite,hash}=P.musicInstruments;
  const {round,same,subtract,inEdit}=L, {pc,intervals}=P.musicCompositionMoves;
  const kinds=['counterline','harmony','orchestration','silence'];
  const eps=1e-7;
  const style=(ctx,key,name)=>(hash([ctx.seed,key,name])>>>0)/4294967296;
  const chordAt=(ctx,beat)=>ctx.chords.findLast(row=>row.beat<=beat+eps);
  const fold=(midi,anchor)=>midi+12*Math.round((anchor-midi)/12);
  const sound=(rows,beat)=>rows.findLast(row=>row.beat<=beat+eps && row.until>beat+eps);
  const nextName=(stem,names)=>{
    let name=stem;
    for (let i=2;names.includes(name);i++) name=stem+'-'+i;
    return name;
  };

  function setup(source,brief,assets) {
    check(fields(brief,['range','locks','fade','seed','kinds','tracks','register','goal']) &&
      Number.isSafeInteger(brief.seed ?? 0) && (brief.goal===undefined || typeof brief.goal==='string' &&
      brief.goal.length<=400), 'Use a locked arrangement brief with an edit range and optional goal and seed');
    const score=A.compile(source,assets), ctx=L.context(source,score,brief);
    const {tracks={},register=['C3','G5'],seed=0,goal='',kinds:requested=kinds}=brief;
    check(fields(tracks,['melody','bass','inner','pulse']) && Object.entries(tracks).every(([role,name])=>
      ctx.names.includes(name) && (role==='pulse' ? ctx.roles[name]==='percussion' : ctx.roles[name]!=='percussion')) &&
      Array.isArray(register) && register.length===2 &&
      Array.isArray(requested) && integer(requested.length,1,kinds.length) &&
      new Set(requested).size===requested.length && Array.from(requested).every(name=>kinds.includes(name)),
    'Choose compatible search roles, kinds and a pitched register');
    const role=kind=>ctx.names.find(name=>ctx.roles[name]===kind);
    const melody=tracks.melody ?? role('lead'), bass=tracks.bass ?? role('bass');
    const inner=tracks.inner ?? ctx.names.find(name=>ctx.roles[name]==='pad' && name!==melody && name!==bass);
    const pulse=tracks.pulse ?? ctx.names.find(name=>ctx.roles[name]==='percussion' && source.patches[source.tracks[name].patch].kind==='kick') ??
      role('percussion');
    const named=[melody,bass,inner,pulse].filter(Boolean);
    check(new Set(named).size===named.length,'Choose separate search roles');
    const [low,high]=register.map(H.midi);
    check(integer(high,low+5,Math.min(119,low+48)),'Choose an inner register spanning 5–48 semitones');
    const chords=score.program.events.map(row=>({...row,beat:round(score.clock.sample(row.time).beat),tones:intervals(row,score)}));
    const lines=Object.fromEntries(ctx.names.map(name=>[name,score.events[name].map(row=>{
      const time=Math.min(score.end,row.time+row.gate,row.choke ?? Infinity);
      return {beat:row.beat,midi:row.midi,until:round(score.clock.sample(time).beat),velocity:row.velocity};
    })]));
    const windows=ctx.windows.flatMap(row=>{
      const out=[];
      for (let from=row.from;from<row.to-eps;from+=128) if (Math.min(row.to,from+128)-from>=.125)
        out.push({from,to:Math.min(row.to,from+128)});
      return out;
    });
    return {...ctx,seed,goal,register:[low,high],requested,
      tracks:Object.fromEntries(Object.entries({melody,bass,inner,pulse}).filter(([,name])=>name!==undefined)),
      chords,lines,searchWindows:windows};
  }
  const unlocked=(ctx,name)=>name && !ctx.locks.tracks[name];
  const editId=(stem,from)=>stem+'-'+hash([from,stem]).toString(36);

  function clip(ctx,track,{from,to},notes,stem,mode) {
    const names=(ctx.source.tracks[track]?.clips ?? []).map(row=>row.id), key=nextName(editId(stem,from),names);
    const voices=new Map();
    for (const {voice='reply',beat,duration,midi,velocity,play} of notes) {
      const local=round(beat-from), gate=round(Math.min(duration,to-beat));
      if (local<0 || gate<.025) continue;
      if (!voices.has(voice)) voices.set(voice,[]);
      const rows=voices.get(voice), i=rows.length, prior=rows.at(-1);
      if (prior && prior.beat+prior.duration>local-eps) prior.duration=round(local-prior.beat);
      rows.push({id:'n'+i,beat:local,duration:gate,midi,velocity,...(play && {play})});
    }
    return P.musicNoteClips.clip({id:key,beat:from,length:round(to-from),mode,
      voices:voices.size ? [...voices].map(([name,rows])=>({id:key+'-'+name,notes:rows.filter(row=>row.duration>=.025)})) :
        [{id:key+'-empty',notes:[]}]});
  }
  function target(ctx,stem) {
    const inner=ctx.tracks.inner;
    if (unlocked(ctx,inner)) return {name:inner,source:ctx.source};
    return addTrack(ctx,stem,A.instrumentPresets['smoked-tines']);
  }
  function addTrack(ctx,stem,patch) {
    const src=ctx.source, parts=src.arrangement?.definition?.parts ?? src.arrangement.parts;
    check(Object.keys(parts).length<8 && ctx.names.length<8,'This arrangement needs a free pitched track');
    const arrangement=P.data.clone(ctx.score.arrangement.definition);
    const name=nextName(stem,Object.keys(arrangement.parts).concat(Object.keys(src.patches),ctx.names));
    arrangement.parts[name]={role:'pad'};
    return {name,source:{...src,arrangement,patches:{...src.patches,[name]:patch},tracks:{...src.tracks,
      [name]:{patch:name,pan:.24,gain:-14.8,send:.19}}}};
  }
  function withClips(source,track,edits) {
    const prior=source.tracks[track], clips=[...prior.clips ?? [],...edits];
    return {...source,tracks:{...source.tracks,[track]:{...prior,clips}}};
  }

  function gaps(ctx,span,profile) {
    const line=ctx.lines[ctx.tracks.melody] ?? [];
    const candidates=[];
    let edge=span.from;
    for (const row of [...line.filter(row=>row.beat<span.to && row.until>span.from),{beat:span.to,until:span.to}]) {
      const gap=Math.min(row.beat,span.to)-edge;
      if (gap>=profile.min) {
        for (let beat=edge+profile.inset;beat<edge+gap-.24;beat+=profile.step)
          candidates.push([beat,Math.min(profile.gate,edge+gap-beat-.085)]);
      }
      edge=Math.max(edge,row.until);
    }
    return candidates;
  }
  function pitch(ctx,beat,anchor,tones) {
    const [low,high]=ctx.register;
    const lead=sound(ctx.lines[ctx.tracks.melody] ?? [],beat)?.midi, bass=sound(ctx.lines[ctx.tracks.bass] ?? [],beat)?.midi;
    let score=Infinity, result;
    for (let midi=low;midi<=high;midi++) {
      if (!tones.includes(pc(midi))) continue;
      const a=lead===undefined ? 5 : Math.abs(midi-lead), b=bass===undefined ? 12 : Math.abs(midi-bass);
      const cost=Math.abs(midi-anchor)+ (a<3 ? 10-a : 0)+(b<4 ? 10-b : 0)+(lead!==undefined && midi>lead ? 4 : 0);
      if (cost<score) {score=cost;result=midi;}
    }
    return result;
  }
  function counterline(ctx,name) {
    const profile=name==='threads' ? {min:.39,inset:.10,step:1.05,gate:.57,velocity:.57} :
      {min:.65,inset:.16,step:1.8,gate:1.18,velocity:.52};
    const {name:part,source}=target(ctx,'counter-voice');
    const clips=[];
    let anchor=(ctx.register[0]+ctx.register[1])/2-4, count=0;
    for (const row of ctx.searchWindows) {
      const hits=gaps(ctx,row,profile).slice(0,128), notes=[];
      for (const [beat,duration] of hits) {
        const active=chordAt(ctx,beat);
        if (!active) continue;
        const midi=pitch(ctx,beat,anchor+(count%3===2 ? 3 : -1),active.tones);
        if (midi===undefined) continue;
        const velocity=round(profile.velocity+style(ctx,beat,name)*.12);
        notes.push({beat,duration,midi,velocity,play:{curves:{gainDb:[[0,-4],[.36,0],[1,-3]]}}});
        anchor=midi;
        count++;
      }
      if (notes.length) clips.push(clip(ctx,part,row,notes,'counter-'+name,'layer'));
    }
    check(count,'No melody gap supports a counterline in this range');
    return {production:withClips(source,part,clips),special:{part,answers:count},
      merit:Math.min(1,count/8)+(name==='threads' ? .06 : 0)};
  }

  function harmonicChoices(ctx,window,styleName) {
    const {from,to}=window, rows=[], meter=ctx.score.arrangement.score.tempoMap?.beatsPerBar ?? 4;
    for (let beat=from;beat<to-eps;beat+=meter) {
      const end=Math.min(beat+meter,to), base=chordAt(ctx,beat);
      if (!base || end-beat<.43) continue;
      const pinnedBass=sound(ctx.lines[ctx.tracks.bass] ?? [],beat+.12)?.midi ?? H.midi(base.root);
      const root=fold(pinnedBass,48), lead=ctx.lines[ctx.tracks.melody] ?? [];
      const choices=['sus2','sus4','minor7','major7','dominant7'].map(quality=>{
        const chord=H.chord(root,quality), tones=chord.map(pc);
        const lengths=lead.filter(note=>note.beat<end && note.until>beat).map(note=>[
          tones.includes(pc(note.midi)),Math.max(0,Math.min(end,note.until)-Math.max(beat,note.beat))*note.velocity]);
        const sum=lengths.reduce((a,[,n])=>a+n,0);
        const fit=sum ? lengths.reduce((a,[yes,n])=>a+(yes ? n : 0),0)/sum : .55;
        const contrast=tones.some(p=>!base.tones.includes(p));
        const bias=styleName==='suspensions' ? quality.startsWith('sus') : quality.endsWith('7');
        return {root,quality,chord,tones,fit,merit:fit+.35*Number(contrast)+.16*Number(bias)+style(ctx,beat,quality)*.07};
      }).sort((a,b)=>b.merit-a.merit);
      rows.push({beat,end,...choices[0]});
    }
    return rows;
  }
  function harmony(ctx,name,nativeGrid) {
    const {name:part,source}=target(ctx,'harmony-voice');
    const input=source.cueMap ?? {}, preserved=(input.harmony ?? []).slice().sort((a,b)=>a.from-b.from);
    const clips=[], lanes=[], additions={}, changed=[];
    let anchor=(ctx.register[0]+ctx.register[1])/2-2;
    for (const window of ctx.searchWindows) {
      const notes=[];
      for (const [i,row] of harmonicChoices(ctx,window,name).entries()) {
        const voices=Array.from(new Set(row.chord.slice(1).map(note=>fold(note,anchor+(name==='suspensions' ? 2 : 0)))))
          .sort((a,b)=>a-b).filter(n=>n>=ctx.register[0] && n<=ctx.register[1]);
        if (!voices.length) continue;
        const beat=row.beat+.10, duration=Math.min(1.95+(i%2)*.85,row.end-beat-.07);
        for (const [voice,midi] of voices.entries()) notes.push({voice:'h'+voice,beat:beat+voice*.057,duration:duration-voice*.044,
          midi,velocity:.59-voice*.063});
        anchor=voices.reduce((a,b)=>a+b,0)/voices.length;
        changed.push({beat:row.beat,to:row.end,root:row.root,quality:row.quality,fit:round(row.fit)});
        if (!nativeGrid) continue;
        const key=nextName(editId('arr-chord',row.beat),Object.keys(ctx.score.arrangement.score.harmonies).concat(Object.keys(additions)));
        const count=Object.keys(source.arrangement?.definition?.parts ?? source.arrangement.parts).length;
        additions[key]={root:row.root,quality:row.quality,notes:row.chord.slice(0,count)};
        for (const range of subtract({from:row.beat,to:row.end},preserved)) if (range.to-range.from>=.125)
          lanes.push({...range,every:Math.min(64,range.to-range.from),chords:[key]});
      }
      if (notes.length) clips.push(clip(ctx,part,window,notes,'harmony-'+name,'attacks'));
    }
    check(changed.length && (!nativeGrid || lanes.length),'No available chord window for this harmony take');
    let production=withClips(source,part,clips);
    if (nativeGrid) {
      const arrangement=P.data.clone(production.arrangement.definition ?? production.arrangement);
      Object.assign(arrangement.score.harmonies,additions);
      production={...production,arrangement,cueMap:{...input,harmony:[...preserved,...lanes]}};
    }
    return {production,special:{part,nativeGrid,chords:changed},
      merit:changed.reduce((a,row)=>a+row.fit,0)/changed.length+(nativeGrid ? .3 : 0)};
  }

  function orchestration(ctx,name) {
    const staged=name==='glass-pairs';
    const patch=staged ? A.instrumentPresets['glass-reed'] : {type:'fm',ratio:2.01,index:1.67,indexDecay:.25,
      body:.13,width:8,color:.42,env:{attack:.022,decay:.6,sustain:.34,release:.32}};
    const {name:part,source}=addTrack(ctx,'answer-layer',patch);
    const inner=ctx.tracks.inner, lowest=ctx.register[0], highest=ctx.register[1];
    const existing=unlocked(ctx,inner) ? [] : null;
    const clips=[];
    for (const span of ctx.searchWindows) {
      const notes=[];
      for (let beat=span.from+.28;beat<span.to-.30;beat+=staged ? 2 : 1.5) {
        const chord=chordAt(ctx,beat);
        if (!chord) continue;
        const center=staged ? (lowest+highest)/2+5 : (lowest+highest)/2-2;
        const n=pitch(ctx,beat,center,chord.tones);
        if (n===undefined) continue;
        notes.push({beat,duration:staged ? 1.39 : .37,midi:n,velocity:staged ? .59 : .66});
        if (staged) {
          const upper=pitch(ctx,beat,n+7,chord.tones.filter(p=>p!==pc(n)));
          if (upper!==undefined) notes.push({voice:'other',beat:beat+.21,duration:1.04,midi:upper,velocity:.42});
        }
      }
      if (!notes.length) continue;
      clips.push(clip(ctx,part,span,notes,'orchestra-'+name,'layer'));
      if (existing) existing.push(clip(ctx,inner,span,[],'handoff-'+name,'attacks'));
    }
    check(clips.length,'No pitched material fits this orchestration');
    let production=withClips(source,part,clips);
    if (existing) production=withClips(production,inner,existing);
    return {production,special:{part,material:staged ? 'breathy dyads' : 'metallic accents',replaces:existing ? inner : null},
      merit:staged ? .82 : .76};
  }

  function silence(ctx,name) {
    const current=ctx.source.cueMap ?? {}, all=ctx.names.filter(part=>unlocked(ctx,part));
    const picked=name==='bare-downbeat' ? all : all.filter(part=>ctx.roles[part]==='percussion');
    check(picked.length,'No unlocked tracks can leave space');
    const gaps=ctx.windows.flatMap(({from,to})=>{
      const span=to-from, start=name==='bare-downbeat' ? from : from+span*.37;
      const end=Math.min(to,start+Math.min(6,span*.55));
      return picked.flatMap(part=>{
        const authored=(current.silence ?? []).filter(row=>!row.parts || row.parts.includes(part)).sort((a,b)=>a.from-b.from);
        return subtract({from:round(start),to:round(end)},authored).filter(row=>row.to-row.from>=.0625)
          .map(row=>({...row,parts:[part],mode:'ring'}));
      });
    });
    const removed=gaps.reduce((n,row)=>n+ctx.score.events[row.parts[0]].filter(note=>note.beat>=row.from && note.beat<row.to).length,0);
    check(removed,'The selected parts already leave space there');
    return {production:{...ctx.source,cueMap:{...current,silence:[...current.silence ?? [],...gaps]}},
      special:{parts:picked,spans:gaps,removed},merit:Math.min(1,removed/5)};
  }

  const choices={
    counterline:[['threads','Short replies fall into the melody’s gaps.',ctx=>counterline(ctx,'threads')],
      ['long-answer','Space the answers farther apart and let them ring.',ctx=>counterline(ctx,'long-answer')]],
    harmony:[['suspensions','Put suspended colors over the same outer lines.',ctx=>harmony(ctx,'suspensions',true)],
      ['sevenths','Move the inner chords through seventh-chord colors.',ctx=>harmony(ctx,'sevenths',true)],
      ['voiced-colors','Play the new upper chords over a preserved chord grid.',ctx=>harmony(ctx,'sevenths',false)]],
    orchestration:[['glass-pairs','Rescore the inner movement as a pair of breathy voices.',ctx=>orchestration(ctx,'glass-pairs')],
      ['metal-dots','Replace the inner texture with sparse metallic accents.',ctx=>orchestration(ctx,'metal-dots')]],
    silence:[['bare-downbeat','Let the locked lines begin the passage exposed.',ctx=>silence(ctx,'bare-downbeat')],
      ['pulse-gap','Drop the pulse later and let it enter again under the same line.',ctx=>silence(ctx,'pulse-gap')]]
  };

  function searchLockedArrangement(source,brief,assets={}) {
    const ctx=setup(source,brief,assets), candidates=[{id:'reference',label:'Original arrangement',production:source}], families=[];
    const scoreKey=(score,name)=>score.events[name]?.filter(note=>inEdit(ctx,note.beat)).map(note=>
      [note.beat,note.midi,note.gate,note.velocity,note.play]) ?? [];
    for (const kind of ctx.requested) {
      const options=choices[kind].map(([id,label,build])=>{
        try {
          const {production,special,merit}=build(ctx), rendered=L.validate(ctx,production,assets);
          const parts=Object.keys(rendered.tracks).filter(name=>!same(scoreKey(ctx.score,name),scoreKey(rendered,name)));
          check(parts.length,'The candidate makes no audible note changes in the window');
          const report={id,label,merit:round(merit),status:'eligible',parts,...special};
          return {report,production};
        } catch (error) {
          if (!(error instanceof RangeError)) throw error;
          return {report:{id,label,status:'blocked',reason:error.message}};
        }
      });
      const winner=options.filter(row=>row.production).sort((a,b)=>b.report.merit-a.report.merit)[0];
      if (winner) {
        winner.report.status='selected';
        candidates.push({id:kind,label:winner.report.label,production:winner.production,evidence:winner.report});
      }
      families.push({kind,candidates:options.map(row=>row.report),...(winner && {winner:winner.report.id})});
    }
    const {range,locks,fade,seed,goal,tracks,register,windows}=ctx;
    const report={range,locks,fade,seed,goal,tracks,register,windows,families,
      preview:{start:Math.max(0,windows[0].start-2),end:Math.min(ctx.score.end,windows.at(-1).end+2)}};
    return P.data.freeze(P.data.clone({format:L.searchFormat,version:1,source,candidates,report}));
  }

  P.musicProduction=Object.freeze({...A,searchLockedArrangement,keepLockedArrangement:L.keep,renderLockedArrangement:L.render});
})(KIT.procedural);
