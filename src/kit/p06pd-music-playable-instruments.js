/* Playable stock instruments, with original seeded exciters and prepared-metal takes. */
(function (P) {
  const A=P.musicProduction,{check,fields,integer}=P.musicInstruments;
  const library=P.data.freeze({
    'cinder-flute':{name:'Cinder Flute',kind:'patch',range:[55,89],
      articulations:['air','whisper','tongue','up','down','exhale'],
      controls:['breath','pressure','contact','damping'],
      playing:'Leave a small gap for tonguing, or connect notes within a fifth to slide between them. Whisper is selected by soft velocity.'},
    'rivet-box':{name:'Rivet Box',kind:'kit',
      pads:{anvil:{midi:36,articulations:['default','muted']},latch:{midi:38,articulations:['default','ghost','flam']},
        spring:{midi:42,articulations:['default','ghost','drag']},plate:{midi:49,articulations:['default','felt','rim','damp']},
        scrape:{midi:54,articulations:['default']}},
      playing:'Play a felt-to-bar crescendo on the plate, then either grab it with damp or move into a gated scrape. Leave some space to hear the hand-off release.'},
    'copperline-bass':{name:'Copperline Bass',kind:'patch',range:[28,67],
      articulations:['finger','soft','rake','slide-up','slide-down','mute','ghost','lift'],
      controls:['pressure','contact','damping'],
      playing:'Alternate fingertip attacks with palm mutes, hammer or slide into nearby pitches, then leave space for the fret-lift release.'}
  });
  const mod=(base,by,from)=>({base,...(by && {by}),...(from && {from})});
  const node=(type,input,settings)=>({type,input,...settings});
  const mix=(...inputs)=>({type:'mix',inputs});
  const gain=(input,amount)=>node('gain',input,{amount});
  const filter=(input,mode,cutoff,resonance)=>node('filter',input,{mode,cutoff,resonance});
  const env=(attack,decay,sustain,release)=>({type:'envelope',env:{attack,decay,sustain,release}});
  const sample=samples=>({type:'sample',zones:[{samples}]});

  function flute({bake}) {
    const air=bake('inhale','breath',.108,{pitchStart:339,pitchEnd:510,voice:.02,roughTail:.74,throat:1240});
    const tongue=[
      bake('tongue-a','scrape',.074,{speed:.76,pressure:.77,body:715,grain:.64}),
      bake('tongue-b','scrape',.068,{speed:.86,pressure:.69,body:813,grain:.81})
    ];
    const tails=[
      bake('exhale-a','breath',.241,{pitchStart:416,pitchEnd:285,voice:.12,throat:1540,roughTail:.93}),
      bake('exhale-b','breath',.199,{pitchStart:277,pitchEnd:196,voice:.08,throat:1310,roughTail:.89})
    ];
    const bodyModes=[
      {ratio:1,gain:1.1,shape:1},{ratio:2.002,gain:.51,decay:.86,shape:2},
      {ratio:3.006,gain:.26,decay:.61,shape:3},{ratio:4.018,gain:.13,decay:.47,shape:4},
      {ratio:5.89,gain:.10,decay:.32,shape:5}
    ];
    return {type:'graph',tail:.30,output:{left:'center',right:'right'},
      controls:{breath:.58,pressure:.42,damping:.27,contact:.23},
      nodes:{
        hiss:{type:'noise'},airway:filter('hiss','bandpass',mod(1230,{contact:3490,breath:1010}),1.12),
        jet:gain('airway',mod(.038,{breath:.42,pressure:.042})),
        tap:sample([air]),entry:gain('tap',.14),
        breathShape:env(.056,.51,.83,.17),
        flow:gain('jet',mod(0,null,{breathShape:1})),
        excite:mix('flow','entry'),
        tube:node('resonator','excite',{decay:mod(.45,{damping:-.37,breath:.29}),modes:bodyModes}),
        ripple:{type:'oscillator',hz:4.8,phase:.13},
        reedEdge:{type:'oscillator',wave:'sine',ratio:2.001},
        reed:{type:'oscillator',wave:'sine',phaseInput:'reedEdge',index:mod(.018,{breath:.079,pressure:.065})},
        voiced:gain('reed',mod(.06,{breath:.23,pressure:.32}, {ripple:.012})),
        sing:gain('voiced',mod(0,null,{breathShape:1})),
        raw:mix('tube','sing','entry'),
        center:filter('raw','lowpass',mod(1120,{pressure:2350,contact:1100,breath:2200}),1.2),
        cavity:node('delay','center',{seconds:.0045,gain:.77}),
        side:gain('cavity',.16),right:mix('center','side'),
        off:sample(tails),offTone:filter('off','bandpass',1920,1.02),endAir:gain('offTone',.37)
      },
      articulations:{
        air:{nodes:{breathShape:env(.067,.44,.84,.17)}},
        whisper:{nodes:{breathShape:env(.087,.37,.69,.16),voiced:{amount:mod(.034,{breath:.08,pressure:.12})},
          jet:{amount:mod(.09,{breath:.49})}}},
        tongue:{tail:.19,nodes:{tap:sample(tongue),entry:{amount:.39},breathShape:env(.015,.20,.58,.096),
          reed:{index:mod(.085,{breath:.086})}}},
        up:{nodes:{entry:{amount:.041},breathShape:env(.021,.36,.86,.16),reed:{index:mod(.029,{breath:.12})}}},
        down:{nodes:{entry:{amount:.024},breathShape:env(.023,.31,.75,.16),
          center:{cutoff:mod(880,{pressure:1460,breath:1330})}}},
        exhale:{output:'endAir',tail:.18}
      },
      performance:{connect:{gap:.088,interval:7,fade:.029},repeatGap:.14,rules:[
        {when:'attack',velocity:[0,.43],articulation:'whisper',attackLead:.061,
          curves:{breath:[[0,.24],[.36,.61],[1,.37]],pressure:[[0,.13],[.6,.27],[1,.18]]}},
        {when:'attack',articulation:'air',attackLead:.048,
          curves:{breath:[[0,.23],[.27,.76],[.71,.86],[1,.47]],contact:[[0,.17],[.61,.31],[1,.28]]}},
        {when:'repeat',articulation:'tongue',attackLead:.009,level:.95,
          curves:{breath:[[0,.78],[.28,.67],[1,.39]],pressure:[[0,.68],[.34,.39],[1,.22]]}},
        {when:'legato',interval:[1,7],articulation:'up',glide:.091,
          curves:{breath:[[0,.54],[.35,.88],[1,.51]],contact:[[0,.24],[.58,.41],[1,.37]]}},
        {when:'legato',interval:[-7,-1],articulation:'down',glide:.125,
          curves:{breath:[[0,.66],[.48,.52],[1,.36]],damping:[[0,.21],[.57,.32],[1,.67]]}},
        {when:'release',articulation:'exhale',level:.66}
      ]}};
  }

  function bass({bake}) {
    const scrape=(id,time,speed,pressure,body,grain)=>bake(id,'scrape',time,{speed,pressure,body,grain});
    const finger=[scrape('pad-a',.069,.43,.77,317,.38),scrape('pad-b',.063,.53,.77,361,.49)];
    const soft=[scrape('soft-a',.069,.33,.36,269,.26),scrape('soft-b',.064,.28,.44,304,.29)];
    const rake=[scrape('rake-a',.093,.81,.81,456,.77),scrape('rake-b',.082,.94,.85,548,.81)];
    const glide=[scrape('fret-a',.121,.73,.61,786,.72),scrape('fret-b',.11,.64,.62,654,.77)];
    const lift=[scrape('lift-a',.103,.42,.53,462,.53),scrape('lift-b',.095,.49,.51,552,.48)];
    const string=[
      {ratio:1,gain:.78,shape:1},{ratio:2.002,gain:.72,decay:.88,shape:2},
      {ratio:3.006,gain:.59,decay:.64,shape:3},{ratio:4.011,gain:.48,decay:.46,shape:4},
      {ratio:5.022,gain:.32,decay:.39,shape:5},{ratio:6.035,gain:.19,decay:.30,shape:6}
    ];
    return {type:'graph',output:'pickup',tail:.26,controls:{contact:.19,pressure:.52,damping:.29},
      nodes:{
        click:sample(finger),touch:gain('click',mod(.06,{pressure:.19})),
        excitation:gain('click',mod(.53,{pressure:.39})),
        wire:node('resonator','excitation',{decay:mod(1.75,{damping:-1.58}),modes:string}),
        fundamental:{type:'oscillator',wave:'sine',phase:.015},
        winding:{type:'oscillator',wave:'sine',ratio:2.002,phase:.09},
        edge:{type:'oscillator',wave:'sine',ratio:3.007,phase:.07},
        bassShape:env(.004,.52,.42,.108),attackShape:env(.003,.13,.11,.066),
        clean:gain('fundamental',mod(0,null,{bassShape:.49})),
        over:gain('winding',mod(.14,{contact:.37})),
        bright:gain('edge',mod(.064,{pressure:.18,contact:.15})),
        overtones:mix('over','bright'),strike:gain('overtones',mod(0,null,{attackShape:.38})),
        raw:mix('clean','strike','wire','touch'),
        neck:filter('raw','lowpass',mod(520,{contact:2040,pressure:1190,damping:-460}),.84),
        pickup:node('drive','neck',{amount:1.37}),
        off:sample(lift),liftTone:filter('off','bandpass',1260,1.06),fretLift:gain('liftTone',.22)
      },
      articulations:{
        finger:{},
        soft:{tail:.22,nodes:{click:sample(soft),bassShape:env(.008,.46,.38,.094),attackShape:env(.005,.091,.062,.054),
          touch:{amount:.075},neck:{cutoff:mod(415,{contact:1100,pressure:780})}}},
        rake:{nodes:{click:sample(rake),touch:{amount:mod(.14,{pressure:.23})},bassShape:env(.004,.33,.41,.083)}},
        'slide-up':{nodes:{click:sample(glide),touch:{amount:.148},bassShape:env(.031,.39,.59,.11),
          attackShape:env(.028,.116,.086,.081)}},
        'slide-down':{nodes:{click:sample(glide.slice().reverse()),touch:{amount:.091},bassShape:env(.027,.35,.45,.10),
          neck:{cutoff:mod(460,{contact:1410,pressure:820})}}},
        mute:{tail:.12,controls:{damping:.89},nodes:{click:sample(soft),bassShape:env(.003,.074,.05,.041),
          attackShape:env(.002,.080,.025,.033),wire:{decay:.15}}},
        ghost:{tail:.105,output:'raw',nodes:{click:sample(rake),touch:{amount:.20},wire:{decay:.09},
          bassShape:env(.003,.037,.009,.015),attackShape:env(.002,.041,.008,.02)}},
        lift:{tail:.094,output:'fretLift'}
      },
      performance:{connect:{gap:.046,interval:9,fade:.025},repeatGap:.16,rules:[
        {when:'attack',velocity:[0,.40],articulation:'soft',attackLead:.004,level:.91},
        {when:'attack',articulation:'finger',attackLead:.004},
        {when:'repeat',velocity:[0,.39],articulation:'soft',level:.90},
        {when:'repeat',articulation:'rake',attackLead:.004,level:.96},
        {when:'legato',interval:[1,9],articulation:'slide-up',glide:.110,
          curves:{contact:[[0,.17],[.42,.31],[1,.24]],pressure:[[0,.30],[.46,.53],[1,.40]]}},
        {when:'legato',interval:[-9,-1],articulation:'slide-down',glide:.127,
          curves:{contact:[[0,.25],[.50,.19],[1,.16]],damping:[[0,.27],[.60,.33],[1,.53]]}},
        {when:'release',articulation:'lift',velocity:[.24,1],level:.76}
      ]}};
  }

  function rivet({bake,blend,sampleRate}) {
    const metal=(id,time,body,hardness,decay,strike)=>bake(id,'metal',time,{body,hardness,decay,strike});
    const friction=(id,time,speed,pressure,body,grain)=>bake(id,'scrape',time,{speed,pressure,body,grain});
    const felt=[metal('felt-a',.57,454,.19,.39,.18),metal('felt-b',.62,461,.23,.43,.22)];
    const plate=[metal('bar-a',1.29,436,.69,1.15,.71),metal('bar-b',1.35,443,.76,1.21,.79)];
    const rim=[metal('rim-a',.58,606,.86,.41,.87),metal('rim-b',.61,617,.82,.45,.84)];
    const touch=[friction('hand-a',.132,.29,.69,790,.44),friction('hand-b',.146,.34,.58,710,.52)];
    const low=[metal('low-a',.39,100,.37,.27,.33),metal('low-b',.39,107,.30,.26,.41)];
    const hard=low.map((name,i)=>blend('hammer-'+i,.51,[[0,1,name],[.0018,.31,
      metal('hammer-edge-'+i,.19,307+i*13,.65,.12,.67+i*.09)]]));
    const cap=[metal('cap-a',.31,582,.56,.18,.72),metal('cap-b',.30,607,.61,.16,.76)];
    const spring=[friction('spring-a',.154,.82,.73,690,.77),friction('spring-b',.164,.74,.69,740,.81)];
    const ghost=[friction('ghost-a',.112,.39,.49,504,.62),friction('ghost-b',.119,.42,.53,564,.61)];
    const clank=cap.map((name,i)=>blend('latch-'+i,.40,[[0,.88,name],[.019+i*.004,.42,spring[i]],[.046,.31,low[i]]]));
    const flam=clank.map((name,i)=>blend('flam-'+i,.43,[[0,.39,cap[1-i]],[.029+i*.004,.94,name]]));
    const drag=spring.map((name,i)=>blend('drag-'+i,.24,[[0,.65,ghost[i]],[.057,.91,name],[.094,.25,cap[1-i]]]));
    const stroke=[
      friction('scrape-a',.89,.63,.84,433,.78),friction('scrape-b',.93,.68,.78,452,.84)
    ];
    const loop={from:Math.round(.152*sampleRate),to:Math.round(.678*sampleRate),crossfade:Math.round(.041*sampleRate)};
    const takes=names=>names.map(asset=>({asset}));
    const layer=(id,names,velocity,gain=0)=>({id,takes:takes(names),gain,...(velocity && {velocity})});
    const hit=(id,names)=>[layer(id,names)];
    const zones=(lo,hi)=>[[0,0,lo,hi],[lo,hi,1,1]];
    const [softV,hardV]=zones(.36,.76);
    return {id:'rivet-box',pads:{
      anvil:{notes:[36,36],gain:-5,pan:-.13,inserts:[{type:'lowpass',hz:4100}],sends:{plateRoom:.09},
        articulations:{default:[layer('heel',low,softV),layer('hammer',hard,hardV)],muted:hit('heel',low)}},
      latch:{notes:[38,38],gain:-9,pan:.11,sends:{plateRoom:.24},
        articulations:{default:[layer('cap',cap,softV),layer('clank',clank,hardV)],ghost:hit('brush',ghost),flam:hit('flam',flam)}},
      spring:{notes:[42,42],gain:-13.5,pan:.42,sends:{plateRoom:.18},
        articulations:{default:[layer('brush',ghost,softV),layer('spring',spring,hardV)],ghost:hit('brush',ghost),drag:hit('drag',drag)}},
      plate:{notes:[49,49],gain:-9.5,pan:-.29,choke:'plate-hand',sends:{plateRoom:.27},
        articulations:{default:[layer('felt',felt,softV,2),layer('bar',plate,hardV,-1.2)],
          felt:hit('felt',felt),rim:hit('rim',rim),damp:hit('hand',touch)}},
      scrape:{notes:[54,54],gated:true,attack:.014,release:.048,gain:-13,pan:-.20,choke:'plate-hand',sends:{plateRoom:.22},
        articulations:{default:[{id:'dragged',takes:stroke.map(asset=>({asset,loop})),releases:takes(touch)}]}}
    },buses:{plateRoom:{gain:-8,pan:.12,inserts:[{type:'lowpass',hz:2200},
      {type:'delay',seconds:.089,feedback:.29,mix:1}]}}};
  }

  function loadInstrumentPack(name,options={}) {
    check(Object.hasOwn(library,name) && fields(options,['sampleRate','seed']) &&
      integer(options.sampleRate ?? 32000,8000,96000) && Number.isSafeInteger(options.seed ?? 0),'Choose a stock instrument and a valid seed and sample rate');
    const {sampleRate=32000,seed=0}=options, assets={};
    function bake(id,model,duration,parameters) {
      const key=name+'-'+id;
      assets[key]=P.mediaGraph.synthesizeGesture({model,sampleRate,seed:P.data.hash(key,seed),duration,parameters}).value;
      return key;
    }
    function blend(id,duration,parts) {
      const samples=new Float64Array(Math.round(duration*sampleRate));
      for (const [delay,gain,name] of parts) {
        const source=assets[name].samples, start=Math.round(delay*sampleRate);
        for (let i=0;i<source.length && start+i<samples.length;i++) samples[start+i]+=source[i]*gain;
      }
      const peak=samples.reduce((max,x)=>Math.max(max,Math.abs(x)),0), scale=peak>.9 ? .9/peak : 1;
      const key=name+'-'+id;
      assets[key]={sampleRate,channels:1,samples:samples.map(x=>x*scale)};
      return key;
    }
    const builder={bake,blend,sampleRate}, guide=library[name];
    const kit=name==='rivet-box' ? rivet(builder) : {};
    const patches=name==='rivet-box' ? {} : {[name]:name==='cinder-flute' ? flute(builder) : bass(builder)};
    return {id:name,guide,patches:P.data.freeze(patches),kit:P.data.freeze(kit),assets};
  }

  P.musicProduction=Object.freeze({...A,instrumentLibrary:library,loadInstrumentPack});
})(KIT.procedural);
