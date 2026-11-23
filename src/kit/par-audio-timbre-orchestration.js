/* Route measured gesture components to conventional editable production takes. */
(function (P) {
  const A=P.mediaGraph,S=P.mediaGraphSupport;
  const {check,fields,id,record,integer,finite}=P.musicInstruments;
  const roles=['contour','attacks','tail'], format='ink-studio/timbre-orchestration';
  const round=n=>Number(n.toFixed(8));
  function plan(input,source,options,assets={}) {
    const J=S.timbreGesture,K=P.musicProduction, pcm=S.instrumentAudio(input);
    check(fields(options,['profile','analysis','projection','placements','takes','seed','sampleRate','tailSeconds']) &&
      !(options.profile && options.analysis) && Array.isArray(options.placements) && integer(options.placements.length,1,24) &&
      Array.isArray(options.takes) && integer(options.takes.length,1,8) &&
      integer(options.sampleRate ?? 24000,8000,48000) && Number.isSafeInteger(options.seed ?? 0) &&
      finite(options.tailSeconds ?? 3,.15,16),'Invalid timbre orchestration request');
    const {sampleRate=24000,seed=0,tailSeconds=3}=options;
    const profile=options.profile===undefined ? J.extract(pcm,options.analysis) : J.validate(options.profile);
    const layout=J.shape(pcm);
    check(Object.keys(layout).every(key=>layout[key]===profile.source[key]),'Timbre profile needs the original audio layout');
    const projection=J.project(profile,options.projection), base=K.compile(source,assets);
    const placements=Array.from(options.placements,(row,index)=>{
      check(fields(row,['id','section','beat','stretch','transpose','level','roles']) && id(row.id ?? 'appear-'+index) &&
        base.arrangement.sections.some(section=>section.id===row.section) && finite(row.beat ?? 0,0,256) &&
        finite(row.stretch ?? 1,.0625,4) && integer(row.transpose ?? 0,-36,36) && finite(row.level ?? 1,.01,2) &&
        (row.roles===undefined || Array.isArray(row.roles) && integer(row.roles.length,1,3) &&
          new Set(row.roles).size===row.roles.length && Array.from(row.roles).every(role=>roles.includes(role))),
      'Invalid gesture placement');
      return {id:row.id ?? 'appear-'+index,section:row.section,beat:row.beat ?? 0,
        stretch:row.stretch ?? 1,transpose:row.transpose ?? 0,level:row.level ?? 1,roles:row.roles ?? roles};
    });
    check(new Set(placements.map(row=>row.id)).size===placements.length,'Timbre placements need different IDs');
    const derived={}, palettes=new Map(), stem='gesture-'+P.data.hash(profile.id,seed).toString(36);
    let attackPatch,tailPatch;
    function put(key,pcm) {
      if (Object.hasOwn(assets,key)) {
        const previous=assets[key];
        check(previous.sampleRate===pcm.sampleRate && previous.channels===pcm.channels &&
          previous.samples.length===pcm.samples.length && pcm.samples.every((value,i)=>value===previous.samples[i]),
        'Timbre material overlaps a different asset '+key);
        return key;
      }
      derived[key]=pcm;
      return key;
    }
    function attack() {
      if (attackPatch) return attackPatch;
      attackPatch={type:'sample',zones:projection.attacks.map(row=>{
        const {fromSample,toSample}=row.range;
        const value={...pcm,samples:pcm.samples.slice(fromSample*pcm.channels,toSample*pcm.channels)};
        return {samples:[put(stem+'-'+row.id,value)],articulation:row.id};
      })};
      return attackPatch;
    }
    function trail() {
      if (tailPatch) return tailPatch;
      const target=projection.motifs.tail.events[0].midi;
      const sourceMidi=profile.tail.midi ?? profile.pitchTrack.at(-1)?.midi ?? target;
      // Pitch the grains near their intended register before the sampler plays them.
      const semitones=Math.max(-36,Math.min(36,target-sourceMidi)), shifted=sourceMidi+semitones;
      const root=Math.max(0,Math.min(127,Math.round(shifted)));
      const value=S.stretchMotifTexture(pcm,sampleRate,{range:projection.tail,frames:Math.round(sampleRate*tailSeconds),
        grains:{grainMs:121,density:39,semitones,sprayMs:17,spread:.70,reverse:.08,jitterCents:32,seed:seed|0}});
      const peak=value.samples.reduce((p,x)=>Math.max(p,Math.abs(x)),0);
      const audio=peak>.0001 ? {...value,samples:value.samples.map(x=>.78*x/peak)} : value;
      tailPatch={type:'sample',env:{attack:.07,decay:.58,sustain:.83,release:.31},zones:[
        {samples:[put(stem+'-tail',audio)],root,tune:100*(root-shifted),oneShot:false}]};
      return tailPatch;
    }
    function palette(name) {
      if (!palettes.has(name)) {
        const next=A.timbrePalettes.load(name,{sampleRate,seed});
        for (const [id,pcm] of Object.entries(next.assets)) put(id,pcm);
        palettes.set(name,next);
      }
      return palettes.get(name);
    }
    const takes=[], variants=[], ids=new Set();
    for (const raw of options.takes) {
      check(fields(raw,['id','palette',...roles]) && id(raw.id) && !ids.has(raw.id) &&
        (raw.palette===undefined || A.timbrePalettes.names.includes(raw.palette)) && roles.some(role=>raw[role]!==undefined),
      'Each orchestration needs an ID and at least one role');
      ids.add(raw.id);
      const patchIds=new Set(), patches={}, tracks={}, routes=[], themes={};
      for (const role of roles) {
        const route=raw[role];
        if (route===undefined) continue;
        check(fields(route,['part','patch','material','transpose','gain','pan','level']) && id(route.part) &&
          Object.hasOwn(base.tracks,route.part) && !base.tracks[route.part].clips &&
          ((base.arrangement.parts[route.part].role==='percussion')===(role==='attacks')) &&
          (route.patch===undefined || record(route.patch)) &&
          (route.material===undefined || route.material==='source' && role!=='contour' && route.patch===undefined) &&
          integer(route.transpose ?? 0,-36,36) && finite(route.level ?? 1,.01,2) &&
          (route.gain===undefined || finite(route.gain,-60,18)) && (route.pan===undefined || finite(route.pan,-1,1)),
        'Choose a compatible note-driven production track and material for '+role);
        if (!projection.motifs[role]) continue;
        check(!routes.some(row=>row.part===route.part),'Use a different production part for each gesture component');
        let patch=route.patch;
        if (route.material==='source') patch=role==='attacks' ? attack() : trail();
        else if (!patch && raw.palette) patch=palette(raw.palette).patches[role];
        const patchId='orchestration-'+role+'-'+P.data.hash([raw.id,route.part].join('/')).toString(36);
        if (patch) {
          check(!Object.hasOwn(source.patches,patchId) && !patchIds.has(patchId),'Generated timbre patch ID collides with the production');
          patchIds.add(patchId);
          patches[patchId]=patch;
        }
        if (patch || route.pan!==undefined || route.gain!==undefined) tracks[route.part]={
          ...(patch && {patch:patchId}),...(route.pan!==undefined && {pan:route.pan}),
          ...(route.gain!==undefined && {gain:route.gain})};
        let motif=projection.motifs[role];
        if (role==='attacks' && route.material==='source')
          motif={...motif,events:motif.events.map(row=>({...row,play:{...row.play,articulation:row.id}}))};
        themes[role]={motif,root:projection.root};
        routes.push({role,part:route.part,transpose:route.transpose ?? 0,level:route.level ?? 1,
          material:route.material ?? (route.patch ? 'authored-patch' : raw.palette ?? 'track-patch')});
      }
      const appearances=placements.flatMap((place,i)=>routes.filter(row=>place.roles.includes(row.role))
        .map(row=>({id:'timbre-'+i+'-'+row.role,theme:row.role,section:place.section,beat:place.beat,stage:'statement',
          targets:[{part:row.part,pitch:row.role==='attacks' ? 'rhythm' : 'original',
            ...(row.role!=='attacks' && {transpose:row.transpose+place.transpose}),stretch:place.stretch,
            level:Math.max(.001,Math.min(2,round(row.level*place.level)))}]})));
      check(appearances.length>0,'This orchestration has no measured gesture material to place');
      const bank={...assets,...derived};
      const instrumented=Object.keys(tracks).length ? K.revise(source,{tracks,patches},bank) : source;
      const voiced=K.developThemes(instrumented,{themes,appearances},bank);
      variants.push({id:raw.id,tracks,patches,edits:voiced.revision.edits});
      takes.push({id:raw.id,routes,omitted:roles.filter(role=>raw[role] && !projection.motifs[role]),
        appearances:voiced.themeMap.appearances.map(row=>({
          placement:placements[Number(row.id.split('-')[1])].id,section:row.section,role:row.theme,tracks:row.tracks
        }))});
    }
    return {format,version:1,profile,projection,variants:P.data.freeze(P.data.clone(variants)),assets:derived,report:{takes}};
  }
  function audition(input,source,settings,assets={},options={}) {
    const planned=plan(input,source,settings,assets);
    const {takes,report}=P.musicProduction.audition(source,planned.variants,{...assets,...planned.assets},options);
    return {plan:planned,takes,report};
  }
  A.timbreComposition=Object.freeze({extract:(...args)=>S.timbreGesture.extract(...args),
    project:(...args)=>S.timbreGesture.project(...args),compare:(...args)=>S.timbreGesture.compare(...args),plan,audition});
})(KIT.procedural);
