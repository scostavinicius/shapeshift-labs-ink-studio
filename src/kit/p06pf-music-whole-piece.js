/* Compose complete native productions from a shared identity and competing form plans. */
(function (P) {
  const A=P.musicProduction,F=P.musicWholeForm,{check,assetNames}=P.musicInstruments;
  const {round,draw,pc}=F;
  const roles={lead:'lead',bass:'bass',keys:'pad',kick:'percussion',contact:'percussion'};
  const scale=(steps,index)=>steps[(index%7+7)%7]+12*Math.floor(index/7);
  const oct=(pitch,center)=>pitch+12*Math.round((center-pitch)/12);
  const feel={
    free:{kick:[[]],contact:[[2.77],[],[1.84,3.38],[]]},
    broken:{kick:[[0,2.48],[0,1.77,3.38],[0,2.54],[.22,1.58,2.91]],
      contact:[[1.04,2.77,3.06],[1.03,2.56,3.04],[1.06,2.69,3.05],[.68,1.13,3.10,3.71]]},
    half:{kick:[[0],[.04,3.56],[0],[]],contact:[[2.06],[1.78,2.09],[2.08,3.17],[2.06]]},
    drive:{kick:[[0,1.52,2.52],[0,1.77,2.56,3.51],[0,2.08,2.74],[0,1.47,2.52,3.28]],
      contact:[[.53,1.03,2.64,3.04],[.53,1.04,1.77,3.06],[.53,1.03,2.52,3.05],[.59,1.04,2.26,3.08,3.65]]},
    double:{kick:[[0,.82,1.53,2.50,3.53],[0,1.02,1.74,2.52,3.60]],
      contact:[[.49,1.04,1.53,2.02,2.59,3.03,3.52],[.39,.71,1.09,1.75,2.08,2.55,3.09,3.73]]}
  };

  function instruments(brief) {
    const stock=A.instrumentPresets;
    const palette=brief.palette;
    const drum={type:'drum',kind:'kick',tune:47,decay:.245,click:.105,sweep:71};
    if (palette==='electric') return {patches:{lead:stock['glass-reed'],bass:stock['coast-bass'],
      keys:{type:'fm',ratio:1.501,index:1.93,indexDecay:.46,body:.16,width:13,grain:.065,
        env:{attack:.041,decay:.57,sustain:.26,release:.33}},
      kick:drum,contact:{type:'drum',kind:'rim',tune:543,click:.36,color:.44,decay:.135,
        articulations:{ghost:{decay:.072,click:.27,tune:472},drag:{kind:'brush',decay:.16,color:.65}}}},assets:{}};
    const parts=['cinder-flute','copperline-bass','rivet-box'].map(name=>A.loadInstrumentPack(name,{seed:brief.seed}));
    const [flute,bass,metal]=parts, pads=metal.kit.pads;
    const samples=(pad,art,index=0)=>pads[pad].articulations[art][index].takes.map(take=>take.asset);
    const patches={
      lead:flute.patches[flute.id],bass:bass.patches[bass.id],keys:stock['smoked-tines'],kick:drum,
      contact:{type:'sample',performance:{},zones:[
        {samples:samples('latch','default',1),gain:-3},
        {articulation:'ghost',samples:samples('spring','ghost'),gain:-8},
        {articulation:'drag',samples:samples('spring','drag'),gain:-5},
        {articulation:'rim',samples:samples('plate','rim'),gain:-5}
      ]}
    };
    const bank=Object.assign({},...parts.map(row=>row.assets)), names=[...new Set(Object.values(patches).flatMap(assetNames))];
    return {patches,assets:Object.fromEntries(names.map(name=>[name,bank[name]]))};
  }

  function harmony(brief) {
    const {root,steps}=brief;
    const qualities={'0,4,7,11':'major7','0,3,7,10':'minor7','0,4,7,10':'dominant7','0,3,6,10':'halfDiminished7'};
    const chords=Array.from({length:7},(_,degree)=>{
      const base=root-12+steps[degree], shape=[0,2,4,6].map(n=>scale(steps,degree+n)-steps[degree]);
      return {id:'degree-'+(degree+1),root:base,quality:qualities[shape.join()] ?? 'unison',notes:shape.map(n=>base+n)};
    });
    chords.push({id:'suspended-five',root:root-5,quality:'sus4',notes:[0,5,7,10].map(n=>root-5+n)});
    return chords;
  }

  function progressions(plan,chords,seed) {
    return plan.sections.map(section=>{
      const {id,bars,pulse,from,chords:degrees}=section;
      const step=['free','half'].includes(pulse) ? 2 : 1;
      const rotate=Math.floor(draw(seed,plan.id,id,'turn')*Math.max(1,degrees.length-1));
      return Array.from({length:bars},(_,bar)=>{
        const index=Math.floor(bar/step);
        const terminal=id===plan.sections.at(-1).id && bar>=bars-(plan.ending==='cut' ? 1 : 2);
        let degree=degrees[(index+(index>=degrees.length ? rotate : 0))%degrees.length];
        if (terminal) degree=plan.ending==='suspend' ? 7 : 0;
        return {bar,beat:from+bar*4,...chords[degree]};
      });
    });
  }

  function theme(spec,plan) {
    const hook=spec.hook, low=Math.min(...hook.events.map(row=>row.midi)), high=Math.max(...hook.events.map(row=>row.midi));
    function shift(center) {
      const wanted=12*Math.round((center-(low+high)/2)/12);
      return 12*Math.max(Math.ceil(Math.max(-60,-low)/12),Math.min(Math.floor(Math.min(60,127-high)/12),wanted/12));
    }
    const appearances=[];
    const place=(id,section,beat,stage,part,{fragment,stretch=1,level=1,transpose=shift(part==='bass' ? 43 : 73),
      pitch=part==='contact' ? 'rhythm' : 'original',gate=1}={})=>{
      appearances.push({id,theme:'hook',section,beat,stage,...(fragment && {fragment}),
        targets:[{part,pitch,transpose,stretch,level,gate}]});
    };
    if (plan.id==='afterimage') {
      place('first-hook','exposure',.3,'statement','lead',{level:.84});
      place('answer-memory','stride',4.41,'development','lead',{fragment:'tail',stretch:.82,level:.79});
      place('bass-memory','drift',.64,'development','bass',{fragment:'head',stretch:1.38,level:.87});
      place('return-hook','refraction',.18,'statement','lead');
      const reprise=plan.sections.find(row=>row.id==='refraction');
      if (reprise.bars>=6) place('return-question','refraction',12.4,'development','lead',{fragment:'head',stretch:1.24,level:.80});
      place('coda-memory','ember',.14,'fragment','lead',{fragment:'head',stretch:1.22,level:.52});
    } else if (plan.id==='withheld') {
      place('rhythm-clue','contact',.45,'fragment','contact',{fragment:'head',level:.68,gate:.43});
      place('second-clue','pressure',4.43,'development','contact',{fragment:'head',stretch:1.36,level:.70,gate:.44});
      place('low-clue','compression',4.20,'development','bass',{fragment:'tail',stretch:1.27,level:.79});
      place('first-hook','reveal',.12,'statement','lead',{level:1.08});
      place('return-hook','lock',.08,'statement','lead',{level:1.12});
    } else {
      place('first-hook','anchor',.36,'statement','bass',{level:.92,gate:.88});
      place('lead-handoff','trade',.20,'statement','lead',{level:.95});
      place('call-memory','echo',.45,'development','lead',{fragment:'tail',level:.79});
      place('return-hook','crossing',.15,'statement','lead',{level:1.04});
      appearances.at(-1).targets.push({part:'bass',pitch:'original',transpose:shift(43),offset:hook.length,
        stretch:1,gate:.86,level:.69});
      place('held-question','question',.95,'fragment','lead',{fragment:'head',stretch:1.52,level:.63});
    }
    return {themes:{hook:{motif:hook,root:spec.root,fragments:{head:hook.events.slice(0,3).map(row=>row.id),
      tail:hook.events.slice(-2).map(row=>row.id)}}},appearances};
  }

  function timed(notes,note,until) {
    const duration=round(Math.min(note.duration,until-note.beat));
    if (duration<.006) return;
    notes.push({...note,beat:round(note.beat),duration,velocity:round(Math.max(.04,Math.min(.99,note.velocity)))});
  }

  function percussion(notes,section,local,bar,seed,limit) {
    const grid=feel[section.pulse];
    const endingPad=section.melody==='ending' && section.pulse==='free', float=section.id==='vacuum';
    if (endingPad || float) return;
    for (const part of ['kick','contact']) {
      if (section.id==='exposure' && bar<2 || section.id==='breath') continue;
      const figures=grid[part], pattern=figures[(bar+Math.floor(draw(seed,section.id,part)*figures.length))%figures.length];
      for (const [i,offset] of pattern.entries()) {
        const main=part==='kick' || i%2===1, random=draw(seed,section.id,bar,part,i);
        const articulation=main ? undefined : random>.82 ? 'drag' : 'ghost';
        const duration=part==='kick' ? .12 : .037;
        const beat=local+offset+(main || section.pulse==='free' ? 0 : .012+random*.021);
        const velocity=(main ? .61 : .34)+(part==='kick' && i===0 ? .15 : 0)+random*.12-
          (section.pulse==='half' ? .09 : 0);
        const next=pattern[i+1] ?? 4;
        timed(notes[part],{beat,duration,velocity,...(articulation && {play:{articulation}})},Math.min(limit,local+next));
      }
    }
  }

  function bassLine(notes,section,chord,t,bar,seed,limit,root) {
    const low=oct(chord.root,root-24), fifth=oct(chord.notes[2],low+5);
    const warm=draw(seed,section.id,bar,'bass')>.48;
    const type=section.pulse;
    const sets={
      free:[[.17,2.52,low,.49]],
      half:[[.10,1.67,low,.71],[2.54,.73,warm ? fifth : low,.52]],
      broken:warm ? [[.02,.98,low,.80],[1.49,.43,fifth,.60],[2.18,.87,low,.71],[3.62,.27,low+12,.49]] :
        [[.05,1.35,low,.74],[1.72,.42,fifth,.62],[2.54,.99,low,.70]],
      drive:[[.015,.91,low,.83],[1.53,.62,fifth,.68],[2.34,.89,low,.80],[3.57,.26,low+12,.57]],
      double:[[.021,.72,low,.86],[.88,.55,low,.66],[1.54,.62,fifth,.71],[2.39,.66,low,.82],[3.19,.46,warm ? fifth : low+12,.57]]
    };
    if (section.id==='pressure' && bar<2) {
      timed(notes,{beat:t+.14,duration:3.47,midi:oct(root,root-24),velocity:.57},limit);
      return;
    }
    const pattern=sets[type];
    for (const [i,[at,gate,midi,velocity]] of pattern.entries()) timed(notes,
      {beat:t+at,duration:gate,midi,velocity:velocity-(section.melody==='ending' && type==='free' ? .14 : 0)},
      Math.min(limit,t+(pattern[i+1]?.[0] ?? 4)));
  }

  function outline(notes,section,chord,t,bar,seed,root,limit) {
    if (section.melody==='none' || section.melody==='ending') return;
    const lift=section.pulse==='drive' ? 76 : 69;
    const range=[chord.notes[1],chord.notes[2],chord.notes[3]].map(note=>oct(note,lift));
    const random=draw(seed,section.id,bar,'melody');
    if (section.melody==='sustained') {
      if (bar%2===0) timed(notes,{beat:t+.73,duration:1.88+random*.45,midi:oct(chord.notes[2],root+7),velocity:.49+random*.14,
        play:{curves:{gainDb:[[0,-7],[.37,-1],[1,-5]]}}},limit);
      return;
    }
    if (bar%4===3 && random<.48) return;
    const first=range[Math.floor(random*3)], second=oct(chord.notes[bar%2 ? 1 : 2],first-2);
    timed(notes,{beat:t+(bar%2 ? 1.58 : .69),duration:bar%2 ? .59 : .82,midi:first,velocity:.58+random*.145},limit);
    if (random>.20) timed(notes,{beat:t+(bar%2 ? 2.41 : 1.74),duration:bar%2 ? .91 : .56,midi:second,
      velocity:.47+random*.13,play:{brightness:.48+random*.25}},limit);
    if (bar%4===2 && section.pulse==='drive') timed(notes,{beat:t+3.08,duration:.43,midi:oct(chord.notes[0],first+5),
      velocity:.69},limit);
  }

  function voicing(chord,previous) {
    const steps=chord.notes.slice(1).map(pc);
    const pool=Array.from({length:28},(_,n)=>49+n).filter(note=>steps.includes(pc(note)));
    let best=Infinity, answer;
    for (const a of pool) for (const b of pool) for (const c of pool) {
      if (b-a<3 || c-b<3 || c-a>21 || pc(a)===pc(b) || pc(a)===pc(c) || pc(b)===pc(c)) continue;
      const cost=Math.abs(a-previous[0])+Math.abs(b-previous[1])+Math.abs(c-previous[2])+
        .085*(Math.abs(a-54)+Math.abs(b-61)+Math.abs(c-67));
      if (cost<best) {answer=[a,b,c];best=cost;}
    }
    return answer ?? chord.notes.slice(1);
  }

  function arrangeMaterial(spec,plan,changes) {
    const motifs={}, clips=[], sections=[];
    const ending=plan.sections.at(-1);
    const cut=plan.ending==='cut' ? ending.to-1.55 : undefined;
    let previous=[53,60,66];
    for (const [index,section] of plan.sections.entries()) {
      const notes={lead:[],bass:[],kick:[],contact:[]}, voices=[[],[],[]];
      const length=section.to-section.from;
      const stop=section===ending && cut!==undefined ? round(cut-section.from-.78) : length;
      for (const [bar,chord] of changes[index].entries()) {
        const t=bar*4;
        const limit=Math.min(t+4,stop);
        if (section.roles.bass && !(section===ending && section.pulse==='free' && bar>=section.bars-2))
          bassLine(notes.bass,section,chord,t,bar,spec.seed,limit,spec.root);
        if (section.roles.lead) outline(notes.lead,section,chord,t,bar,spec.seed,spec.root,limit);
        percussion(notes,section,t,bar,spec.seed,limit);
        if (!section.roles.keys || t>=stop || (section.id==='exposure' && bar<2) ||
            (section.id==='vacuum' && bar>=section.bars-1) ||
            (section===ending && plan.ending==='dissolve' && bar===section.bars-1)) continue;
        const same=bar>0 && changes[index][bar-1].id===chord.id;
        if (same && bar%2) continue;
        const extended=changes[index][bar+1]?.id===chord.id && bar%2===0;
        const breathe=section.pulse==='free' || section.pulse==='half';
        let gate=breathe ? (extended ? 6.37 : 3.23) : (extended ? 4.3 : 2.22);
        if (section.id==='vacuum') gate=Math.min(gate,length-4-t-.2);
        previous=voicing(chord,previous);
        const weight=section.id==='vacuum' ? 1 : previous.length;
        for (let j=0;j<weight;j++) {
          const offset=.11+j*.087+draw(spec.seed,section.id,bar,j)*.07;
          const fade=section===ending && plan.ending==='dissolve' ? 1-.45*bar/section.bars : 1;
          timed(voices[j],{beat:t+offset,duration:gate-j*.17,midi:previous[j],velocity:(.48-.061*j+.06*draw(spec.seed,section.id,bar,j,'keys'))*fade},
            Math.min(stop,section.id==='vacuum' ? length-4 : length));
        }
      }
      if (section===ending) {
        const final=changes[index].at(-1), epic=oct(final.root,spec.root);
        if (plan.ending==='cut') {
          const beat=round(cut-section.from-.66), duration=.65;
          for (const [part,midi,velocity] of [['lead',epic,.86],['bass',oct(epic,spec.root-24),.88],
            ['kick',undefined,.92],['contact',undefined,.82]]) {
            timed(notes[part],{beat,duration,midi,velocity},cut-section.from);
          }
          previous=voicing(final,previous);
          for (const [i,midi] of previous.entries())
            timed(voices[i],{beat,duration,midi,velocity:.68-.065*i},cut-section.from);
        } else {
          const dissolves=plan.ending==='dissolve', beat=length-(dissolves ? 6.65 : 4.81);
          const midi=dissolves ? spec.root : oct(final.notes[1],spec.root+6);
          timed(notes.lead,{beat,duration:dissolves ? 1.46 : 2.85,midi,velocity:dissolves ? .34 : .58,
            play:{curves:{gainDb:[[0,-4],[.38,0],[1,-8]],damping:[[0,.38],[1,.82]]}}},length);
        }
      }
      const localParts={};
      for (const [part,rows] of Object.entries(notes)) if (rows.length) {
        const name=part+'-'+section.id;
        motifs[name]={length,events:rows.map((row,i)=>({id:'event-'+i,...row}))};
        localParts[part]={motif:name};
      }
      if (voices.some(row=>row.length)) clips.push({id:'keys-'+section.id,beat:section.from,length,
        voices:voices.flatMap((row,i)=>row.length ? [{id:'inner-'+i,
          notes:row.map((note,j)=>({id:'chord-'+j,...note}))}] : [])});
      sections.push({id:section.id,bars:section.bars,localParts});
    }
    return {motifs,clips,sections,cut};
  }

  function composition(spec,plan,bank) {
    const chords=harmony(spec), progress=progressions(plan,chords,spec.seed), material=arrangeMaterial(spec,plan,progress);
    const groups=[{id:'piece',label:spec.title,from:0,to:plan.bars*4},
      ...plan.sections.map(({id,label,from,to})=>({id,label,from,to,parent:'piece'}))];
    const entries=[];
    for (const row of progress.flat()) if (row.id!==entries.at(-1)?.harmony)
      entries.push({id:'change-'+entries.length,time:{beat:row.beat},harmony:row.id});
    const source={arrangement:{score:{key:{root:spec.root,mode:spec.mode},tempoMap:plan.map,endFade:.09,
      harmonies:Object.fromEntries(chords.map(({id,...chord})=>[id,chord])),changes:entries},
      parts:Object.fromEntries(Object.entries(roles).map(([name,role])=>[name,{role}])),motifs:material.motifs,
      sections:material.sections,seed:spec.seed},
      patches:bank.patches,seed:spec.seed,gain:-1,
      tracks:{lead:{patch:'lead',gain:-8.1,pan:-.06,send:.32,highpass:90},bass:{patch:'bass',gain:-10.3,send:.075},
        keys:{patch:'keys',gain:-14.8,pan:-.22,send:.45,clips:material.clips,highpass:120},
        kick:{patch:'kick',gain:-12.2,send:.02},contact:{patch:'contact',gain:-13.9,pan:.24,send:.22}},
      room:{gain:-12,size:1.38,decay:1.25,damping:.62},
      cueMap:{groups,room:plan.sections.filter(row=>['exposure','crossing','refraction','reveal','ember'].includes(row.id))
        .map(({id,from,to})=>({from,to,parts:['lead','keys'],send:id==='ember' ? [.43,.77] : [.22,.48]})),
        ...(material.cut!==undefined && {silence:[{from:material.cut,to:plan.bars*4,mode:'cut'}]})}};
    const developed=A.developThemes(source,theme(spec,plan),bank.assets);
    const performed=A.inspect(developed.production,bank.assets);
    const evidence=developed.themeMap.appearances.map(({id,stage,section,tracks})=>({id,stage,section,
      tracks:tracks.map(({part,notes,count})=>({part,notes:notes.length,count})),
      time:Math.min(...tracks.flatMap(row=>row.notes.map(note=>note.time))),
      beat:Math.min(...tracks.flatMap(row=>row.notes.map(note=>note.beat)))}));
    check(evidence.every(row=>row.tracks.every(track=>track.notes===track.count)),
      'A generated theme appearance lost a note in '+plan.id);
    const marks=evidence.map(row=>({id:row.id,beat:row.beat,kind:row.stage,parts:row.tracks.map(track=>track.part)}));
    const firstKick=performed.events.kick[0];
    check(firstKick,'A whole-piece form must make its pulse audible');
    marks.push({id:'first-pulse',beat:firstKick.beat,kind:'pulse',parts:['kick']});
    if (material.cut!==undefined) marks.push({id:'stop',beat:material.cut,kind:'cut'});
    const production={...developed.production,cueMap:{...developed.production.cueMap,landmarks:marks}};
    const bars=plan.sections.map(({id,label,pulse,bpm,from,to},i)=>{
      const observed=performed.cueMap.groups.find(row=>row.id===id);
      const {startTime,endTime,tracks}=observed;
      return {id,label,from,to,startTime,endTime,pulse,bpm,chords:[...new Set(progress[i].map(row=>row.id))],
        attacks:Object.fromEntries(Object.entries(tracks).map(([name,{onsets}])=>[name,onsets])),
        withheld:Object.keys(tracks).filter(name=>tracks[name].onsets===0)};
    });
    const end=performed.duration;
    const finalEvents=Object.values(performed.events).flat();
    const lastAttack=Math.max(...finalEvents.map(row=>row.time));
    const cutAt=performed.cueMap.roomCuts[0]?.startTime;
    const firstHook=evidence.find(row=>row.id==='first-hook'), reprise=evidence.find(row=>row.id==='return-hook');
    const compare=(id,at,before,after)=>({id,at,from:Math.max(0,at-before),to:Math.min(end,at+after)});
    const listen=[compare('first-pulse',firstKick.time,2,5),compare('first-hook',firstHook.time,1,7),
      compare('return',reprise.time,1,7),compare('ending',cutAt ?? lastAttack,5,5)];
    return {id:plan.id,label:plan.label,idea:plan.idea,production,themeMap:developed.themeMap,
      report:{duration:end,bars:plan.bars,sections:bars,appearances:evidence,firstHook,firstEntries:
        Object.fromEntries(Object.entries(performed.events).map(([role,notes])=>[role,notes[0]?.time ?? null])),
        firstPulse:{beat:firstKick.beat,time:firstKick.time},return:reprise,listen,
        ending:{kind:plan.ending,harmony:entries.at(-1).harmony,lastAttack,...(cutAt!==undefined && {cutAt})}}};
  }

  function composeWholePiece(raw={}) {
    const spec=F.brief(raw), bank=instruments(spec);
    const candidates=spec.forms.map(id=>composition(spec,F.arrange(id,spec),bank));
    const {title,goal,seed,duration,tempo,root,mode,palette,hook}=spec;
    const report={title,goal,seed,duration,tempo,key:{root,mode},palette,hook,
      candidates:candidates.map(({id,label,idea,report})=>({id,label,idea,...report}))};
    return {value:P.data.freeze({format:'ink-studio/whole-piece',version:1,report,candidates}),assets:bank.assets};
  }

  P.musicProduction=Object.freeze({...A,wholePieceForms:F.publicForms,composeWholePiece});
})(KIT.procedural);
