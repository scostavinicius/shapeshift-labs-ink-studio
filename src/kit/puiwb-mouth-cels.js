/* Compile and play editable mouth exposures on the character's pixel grid. */
(function(K){
  const P=K.procedural,W=K.world,T=P.takeTime,A=W.mouthAlignment;
  const {fields,record,finite,integer,id,check}=P.musicInstruments;
  const format='ink-studio/mouth-cels', planFormat='ink-studio/mouth-cel-plan';
  const shapes=['seal','teeth','tongue','hiss','round','spread','open','narrow'];
  const ceil=([n,d])=>T.index((n+d-1n)/d);
  const tuple=(value,min,max)=>Array.isArray(value) && value.length===2 &&
    Array.from(value).every(n=>integer(n,min,max));
  function readGrid(row){
    check(fields(row,['grid','origin','size']) && tuple(row.grid,1,4096) &&
      tuple(row.origin,0,4095) && tuple(row.size,1,256) && row.grid[0]*row.grid[1]<=2e6 &&
      row.origin.every((n,i)=>n+row.size[i]<=row.grid[i]),'Mouth patch must fit the native character grid');
    return {grid:row.grid.slice(),origin:row.origin.slice(),size:row.size.slice()};
  }
  function getRate(fps){
    const fpsRate=T.read(fps);
    check(finite(T.seconds(fpsRate),1,120),'Mouth cels need a rate from 1 to 120 fps');
    return fpsRate;
  }
  function inventory(poses,rest){
    check(Array.isArray(poses) && integer(poses.length,1,48) && Array.from(poses).every(id) &&
      new Set(poses).size===poses.length && poses.includes(rest),'Mouth rig needs unique named cels and a rest cel');
    return new Set(poses);
  }
  function mapping(raw,validKey,bank,label){
    check(record(raw) && Object.keys(raw).length<=160 && Object.entries(raw).every(([key,value])=>
      validKey(key)&&bank.has(value)),'Invalid mouth '+label);
    return new Map(Object.entries(raw).map(([key,value])=>[key.normalize('NFC'),value]));
  }

  function build(plan,source){
    check(fields(plan,['format','version','id','fps','rig','utterances','channel','accentDb']) &&
      plan.format===planFormat && plan.version===1 && id(plan.id) &&
      fields(plan.rig,['grid','origin','size','rest','poses','bindings','phones','accents']) &&
      Array.isArray(plan.utterances) && integer(plan.utterances.length,1,32),'Expected a version 1 mouth cel plan');
    const fps=getRate(plan.fps??12), {rig,channel=0,accentDb=2}=plan;
    const layout=readGrid({grid:rig.grid,origin:rig.origin,size:rig.size}), {rest,poses}=rig;
    const bank=inventory(poses,rest);
    const bindings=mapping(rig.bindings??{},name=>shapes.includes(name),bank,'articulation bindings');
    const overrides=mapping(rig.phones??{},name=>name.length>=1&&name.length<=32,bank,'IPA overrides');
    const accents=mapping(rig.accents??{},name=>bank.has(name),bank,'accent cels');
    const audio=P.mediaGraph.audio(source), {sampleRate,channels,samples}=audio, sampleCount=samples.length/channels;
    check(integer(sampleRate,8000,96000) && integer(channels,1,2) && integer(channel,0,channels-1) &&
      integer(sampleCount,1,120*sampleRate) && finite(accentDb,-12,30),'Mouth cels need bounded mono or stereo PCM and a valid channel');
    const frames=ceil(T.mul(T.div(T.read(sampleCount),T.read(sampleRate)),fps));
    let previous=0;
    const phones=[], warnings=[], names=new Set();
    for(const utterance of plan.utterances){
      check(fields(utterance,['id','speech','fromSample','toSample']) && id(utterance.id) && !names.has(utterance.id) &&
        fields(utterance.speech,['kind','text','lexicon','symbols','fallback']) &&
        ['ipa','text'].includes(utterance.speech.kind),'Mouth utterances need a unique ID and IPA or transcript');
      const {fromSample=0,toSample=sampleCount}=utterance;
      check(integer(fromSample,previous,sampleCount-1) && integer(toSample,fromSample+1,Math.min(sampleCount,fromSample+20*sampleRate)),
        'Mouth utterances need ordered, nonoverlapping sample windows up to 20 seconds');
      names.add(utterance.id);
      previous=toSample;
      const {units,warnings:pronunciation}=A.pronounce(utterance.speech);
      warnings.push(...pronunciation.map(({source,...warning})=>({...warning,utterance:utterance.id})));
      const performance=A.scan(audio,fromSample,toSample,channel);
      if(!performance){
        warnings.push({code:'no-voice',utterance:utterance.id});
        continue;
      }
      const alignment=A.align(units,performance);
      if(!alignment){
        warnings.push({code:'short-for-pronunciation',utterance:utterance.id});
        continue;
      }
      for(const row of alignment){
        const {unit,start,end,rmsDbFS,relativeDb,stretch}=row;
        if(start===end)continue;
        const from=performance.origin+start*performance.hop, to=Math.min(toSample,performance.origin+end*performance.hop);
        const defaultPose=bindings.get(unit.shape)??(bank.has(unit.shape) ? unit.shape : undefined);
        const base=unit.pause ? rest : overrides.get(unit.symbol)??defaultPose??(bank.has('narrow') ? 'narrow' : rest);
        const expressive=!unit.pause&&unit.acoustic==='vowel' &&
          (unit.stress==='primary' || relativeDb>=accentDb || stretch>=1.58 && relativeDb>=-7);
        phones.push({id:'phone-'+phones.length,utterance:utterance.id,symbol:unit.symbol??null,
          shape:unit.shape??'rest',fromSample:from,toSample:to,pose:expressive ? accents.get(base)??base : base,
          ...(unit.stress && {stress:unit.stress}), ...(unit.sourceSpan && {sourceSpan:unit.sourceSpan}),
          ...(unit.word && {word:unit.word}),rmsDbFS,relativeDb,emphasis:expressive,exposed:false});
      }
    }

    const holds=[], samplesPerFrame=T.div(T.read(sampleRate),fps);
    const edges=Array.from({length:frames+1},(_,frame)=>
      Math.min(sampleCount,ceil(T.mul(T.read(frame),samplesPerFrame))));
    const choices=new Int32Array(frames).fill(-1), counts=new Uint16Array(phones.length);
    const overlap=(phone,frame)=>Math.min(edges[frame+1],phone.toSample)-Math.max(edges[frame],phone.fromSample);
    const consonant=phone=>phone.shape==='seal'||phone.shape==='teeth'||phone.shape==='tongue';
    let at=0;
    for(let frame=0;frame<frames;frame++){
      const from=edges[frame],to=edges[frame+1];
      while(at<phones.length && phones[at].toSample<=from)at++;
      let covered=0,best=0,winning=-1;
      for(let i=at;i<phones.length && phones[i].fromSample<to;i++){
        const phone=phones[i];
        if(phone.pose===rest)continue;
        const duration=overlap(phone,frame), weight=consonant(phone) ? 1.35 : phone.emphasis ? 1.2 : 1;
        covered+=duration;
        if(weight*duration>best){best=weight*duration;winning=i;}
      }
      if(winning>=0 && best>=Math.max((to-from-covered)*.76,(to-from)*.21)){
        choices[frame]=winning;
        counts[winning]++;
      }
    }
    // Preserve short readable cels where a neighboring phone has frames to spare.
    const priority=phones.map((phone,i)=>({i,rank:phone.emphasis||consonant(phone) ? 1 : 0}))
      .sort((a,b)=>b.rank-a.rank);
    const frameAt=sample=>T.index(T.roundDown(T.div(T.read(sample),samplesPerFrame)));
    for(const {i} of priority){
      const phone=phones[i];
      if(counts[i] || phone.pose===rest)continue;
      let chosen=-1, best=0;
      for(let f=frameAt(phone.fromSample);f<=frameAt(phone.toSample-1);f++){
        const current=choices[f], portion=overlap(phone,f)/(edges[f+1]-edges[f]);
        if(current>=0 && counts[current]>1 && portion>=.3 && portion>=best){chosen=f;best=portion;}
      }
      if(chosen<0)continue;
      counts[choices[chosen]]--;
      choices[chosen]=i;
      counts[i]++;
    }
    for(let frame=0;frame<frames;frame++){
      const winning=phones[choices[frame]], pose=winning?.pose??rest;
      let hold=holds.at(-1);
      if(!hold || hold.pose!==pose){
        hold={id:'hold-'+holds.length,from:frame,to:frame,pose,approval:'proposed',phones:[]};
        holds.push(hold);
      }
      hold.to=frame+1;
      if(winning){
        if(!winning.exposed)hold.phones.push(winning.id);
        winning.exposed=true;
      }
    }
    return {format,version:1,id:plan.id,fps:T.pack(fps),frames,rig:{...layout,rest,poses:poses.slice()},
      audio:{sampleRate,frames:sampleCount,channel},holds,phones,warnings};
  }

  function open(sheet,{approvedOnly=false}={}){
    check(fields(sheet,['format','version','id','fps','frames','rig','audio','holds','phones','warnings']) &&
      sheet.format===format && sheet.version===1 && id(sheet.id) && integer(sheet.frames,1,14400) &&
      fields(sheet.rig,['grid','origin','size','rest','poses']) && Array.isArray(sheet.holds) &&
      integer(sheet.holds.length,1,sheet.frames) && typeof approvedOnly==='boolean','Expected a version 1 editable mouth cel sheet');
    const {rest,poses,grid,origin,size}=sheet.rig, rate=getRate(sheet.fps), frameCount=sheet.frames;
    const layout=readGrid({grid,origin,size}), bank=inventory(poses,rest), used=new Set();
    let next=0;
    const holds=Array.from(sheet.holds,row=>{
      check(fields(row,['id','from','to','pose','approval','phones']) && id(row.id) && !used.has(row.id) &&
        row.from===next && integer(row.to,next+1,sheet.frames) && bank.has(row.pose) &&
        ['proposed','approved'].includes(row.approval) && Array.isArray(row.phones) && row.phones.length<=1024 &&
        Array.from(row.phones).every(id),'Mouth holds need contiguous frame bounds, valid cels and approval states');
      check(!approvedOnly || row.approval==='approved','Mouth hold '+row.id+' needs animator approval');
      used.add(row.id);
      next=row.to;
      return Object.freeze({...row,phones:Object.freeze(row.phones.slice())});
    });
    check(next===sheet.frames,'Mouth holds must cover the entire take');
    function frame(number){
      check(Number.isSafeInteger(number),'Mouth cel needs an integer frame');
      if(number<0 || number>=frameCount)return {pose:rest,approval:'outside'};
      let lo=0,hi=holds.length-1;
      while(lo<hi){
        const mid=(lo+hi)>>>1;
        if(holds[mid].to<=number)lo=mid+1;
        else hi=mid;
      }
      return holds[lo];
    }
    function sample(time){
      const exact=T.read(time);
      return frame(T.index(T.roundDown(T.mul(exact,rate))));
    }
    function draw(face,cel){
      const {grid,origin,size}=layout;
      check(face?.width===grid[0] && face?.height===grid[1] && cel?.width===size[0] && cel?.height===size[1],
        'Face and mouth cel rasters must match the authored native pixel dimensions');
      return P.raster.blend(face,cel,{x:origin[0],y:origin[1]});
    }
    return Object.freeze({frame,sample,draw});
  }

  W.mouthCels=Object.freeze({format,planFormat,build,open});
  P.graph.operations=Object.freeze({...P.graph.operations,'raster.mouthCels':{
    description:'Composite an editable mouth exposure on the character’s native pixel grid.',
    inputs:{sheet:'record',face:'raster',cels:'record',approvedOnly:{type:'boolean',default:false}},
    outputs:{value:'raster',hold:'record'},
    time:true,
    instantiate(){
      let adapter, source, requireApproval;
      return ({sheet,face,cels,approvedOnly},{time,take})=>{
        if(sheet!==source || approvedOnly!==requireApproval){
          adapter=open(sheet,{approvedOnly});source=sheet;requireApproval=approvedOnly;
        }
        const hold=adapter.sample(take===undefined ? time : T.pack(T.requireFrame(take).start));
        check(Object.hasOwn(cels,hold.pose),'Missing native mouth cel '+hold.pose);
        return {value:adapter.draw(face,cels[hold.pose]),hold};
      };
    }
  }});
})(KIT);
