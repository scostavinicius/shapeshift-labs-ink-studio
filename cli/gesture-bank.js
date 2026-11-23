/* Stable session/take/slice addresses over the existing content-addressed sample library. */
const fs=require('node:fs'), path=require('node:path'), {isDeepStrictEqual}=require('node:util');
const {openSampleLibrary}=require('./sample-library.js');
const {publishJson}=require('./asset-files.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const text=value=>typeof value==='string' && value.trim().length>0 && value.length<=512;
const format='ink-studio/gesture-bank';
const version=1;

function openGestureBank(directory,{kit=require('../index.js').load()}={}) {
  const {mediaGraph:A,musicInstruments:{fields,record,id,integer,check}}=kit.KIT.procedural;
  const library=openSampleLibrary(directory,{kit}), root=path.resolve(directory,'gestures');
  const ownId=value=>id(value) && value===value.toLowerCase();
  const tagList=values=>Array.isArray(values) && values.length<=32 && Array.from(values).every(text);
  const label=(value,fallback)=>value ?? fallback;
  const validLabel=value=>value===undefined || text(value);
  const wrap=(type,data)=>({format,version,type,...data});
  const folder=(session,take)=>path.join(root,session,take);
  const sessionFile=session=>path.join(root,session,'session.json');
  const takeFile=(session,take)=>path.join(folder(session,take),'take.json');
  const sliceFile=(session,take,slice)=>path.join(folder(session,take),'slices',slice+'.json');
  const conflict='Gesture ID already exists with different content or metadata';

  function saved(file,type,identity) {
    if (!fs.existsSync(file)) throw new RangeError('Unknown gesture '+type+' '+identity);
    const row=read(file);
    check(row.format===format && row.version===version && row.type===type && row.id===identity,
      'Invalid gesture '+type+' manifest');
    return row;
  }
  function directories(dir) {
    return fs.existsSync(dir) ? fs.readdirSync(dir,{withFileTypes:true}).filter(row=>row.isDirectory() && ownId(row.name))
      .map(row=>row.name).sort() : [];
  }
  function sliceIds(session,take) {
    const dir=path.join(folder(session,take),'slices');
    return fs.existsSync(dir) ? fs.readdirSync(dir,{withFileTypes:true}).filter(row=>row.isFile() &&
      row.name.endsWith('.json') && ownId(row.name.slice(0,-5))).map(row=>row.name.slice(0,-5)).sort() : [];
  }
  function address(str) {
    const parts=typeof str==='string' ? str.split('/') : [];
    check(parts.length===3 && parts.every(ownId),'Use a gesture address session/take/slice');
    return parts;
  }
  function takeInfo(session,take) {
    return saved(takeFile(session,take),'take',take);
  }
  function sliceInfo(session,take,slice) {
    return saved(sliceFile(session,take,slice),'slice',session+'/'+take+'/'+slice);
  }
  function range(from,to,mic) {
    const firstSample=from+mic.offsetSamples, endSample=to+mic.offsetSamples;
    check(integer(firstSample,0,mic.frames-1) && integer(endSample,firstSample+1,mic.frames),
      'Gesture slice falls outside an aligned perspective');
    return {firstSample,endSample};
  }
  function crop(value,bounds) {
    const {sampleRate,channels,samples}=value;
    return {sampleRate,channels,samples:samples.slice(bounds.firstSample*channels,bounds.endSample*channels)};
  }

  function ingest(recipe,generated) {
    check(fields(recipe,['session','take','slices']) && fields(recipe.session,['id','label']) &&
      ownId(recipe.session.id) && validLabel(recipe.session.label) &&
      fields(recipe.take,['id','label','perspectives']) && ownId(recipe.take.id) && validLabel(recipe.take.label) &&
      record(recipe.take.perspectives) && integer(Object.keys(recipe.take.perspectives).length,1,16) &&
      Array.isArray(recipe.slices) && integer(recipe.slices.length,0,256),'Invalid gesture session, take or slices');
    const session=recipe.session.id,take=recipe.take.id;
    const sessionRow=wrap('session',{id:session,label:label(recipe.session.label,session)});
    const originals=new Map();
    const perspectives=Object.fromEntries(Object.entries(recipe.take.perspectives).sort(([a],[b])=>a<b ? -1 : 1).map(([name,mic])=>{
      check(ownId(name) && fields(mic,['sample','offsetSamples']) && id(mic.sample) &&
        integer(mic.offsetSamples ?? 0,-32e6,32e6),'Invalid perspective or alignment offset');
      const original=library.get(mic.sample).entry;
      check(integer(original.sampleRate,8000,96000) && original.channels<=2,'A gesture perspective needs mono or stereo audio at 8 to 96 kHz');
      originals.set(name,original);
      return [name,{sample:original.id,asset:original.asset,offsetSamples:mic.offsetSamples ?? 0,
        frames:original.frames,sampleRate:original.sampleRate,originalFirstSample:original.source.firstSample}];
    }));
    const sampleRate=Object.values(perspectives)[0].sampleRate;
    check(Object.values(perspectives).every(mic=>mic.sampleRate===sampleRate),'Aligned perspectives must share one sample rate');
    const existingTake=fs.existsSync(takeFile(session,take)) ? takeInfo(session,take) : undefined;
    const synthesis=generated ?? existingTake?.synthesis, origin=synthesis ? 'procedural' : 'recording';
    const takeRow=wrap('take',{id:take,label:label(recipe.take.label,take),sampleRate,perspectives,origin,
      ...(synthesis && {synthesis})});
    const seen=new Set();
    const pending=Array.from(recipe.slices,raw=>{
      check(fields(raw,['id','label','fromSample','toSample','analyze','material','articulation','tags']) &&
        ownId(raw.id) && !seen.has(raw.id) && [raw.label,raw.material,raw.articulation].every(validLabel) &&
        (raw.tags===undefined || tagList(raw.tags)) && integer(raw.fromSample,0,32e6-1) &&
        integer(raw.toSample,raw.fromSample+1,Math.min(32e6,raw.fromSample+sampleRate*15)) &&
        typeof raw.analyze==='string' && Object.hasOwn(perspectives,raw.analyze),'Invalid gesture slice, analysis perspective or clock range');
      seen.add(raw.id);
      for (const mic of Object.values(perspectives)) range(raw.fromSample,raw.toSample,mic);
      const {fromSample,toSample,analyze}=raw, original=originals.get(analyze);
      const {material=original.material,articulation=original.articulation,tags=original.tags}=raw;
      const row=wrap('slice',{id:session+'/'+take+'/'+raw.id,session,take,slice:raw.id,label:label(raw.label,raw.id),
        fromSample,toSample,analyze,sampleRate,origin,perspectives:Object.keys(perspectives),license:original.license.id,
        ...(material!==undefined && {material}),...(articulation!==undefined && {articulation}),tags:[...new Set(tags)]});
      return {row,file:sliceFile(session,take,raw.id)};
    });
    const newSeconds=pending.filter(item=>!fs.existsSync(item.file))
      .reduce((sum,{row})=>sum+(row.toSample-row.fromSample)/sampleRate,0);
    check(newSeconds<=180,'Index up to 180 new seconds of slices per submission');
    const records=[{row:sessionRow,file:sessionFile(session)},{row:takeRow,file:takeFile(session,take)}];
    function existing({row,file}) {
      if (!fs.existsSync(file)) return false;
      const {descriptors,...data}=read(file);
      check(isDeepStrictEqual(data,row),conflict);
      return true;
    }
    records.forEach(existing);
    const additions=pending.filter(item=>!existing(item));
    // Load one original at a time while indexing slices from long takes.
    for (const [name,mic] of Object.entries(perspectives)) {
      const slices=additions.filter(({row})=>row.analyze===name);
      if (!slices.length) continue;
      const {value}=library.load(mic.sample);
      for (const {row} of slices) row.descriptors=A.gestureBank.describe(crop(value,range(row.fromSample,row.toSample,mic)));
    }
    for (const {file,row} of [...records,...additions]) publishJson(file,row,conflict);
    return {session:sessionRow,take:takeRow,slices:pending.map(({row})=>sliceInfo(session,take,row.slice))};
  }

  function resolve(str,perspective) {
    const [session,take,slice]=address(str), row=sliceInfo(session,take,slice), takeRow=takeInfo(session,take);
    const mic=perspective ?? row.analyze;
    check(ownId(mic) && Object.hasOwn(takeRow.perspectives,mic),'Unknown gesture perspective '+mic);
    const original=takeRow.perspectives[mic], bounds=range(row.fromSample,row.toSample,original);
    return {row,mic,original,bounds};
  }
  function load(str,perspective) {
    const {row,mic,original,bounds}=resolve(str,perspective);
    const {value,entry}=library.load(original.sample);
    check(entry.asset===original.asset,'Gesture original audio hash changed');
    return {value:crop(value,bounds),row,mic,original:entry,bounds};
  }
  function keep(str,perspective,sample) {
    check(fields(sample,['id','label','pitch','tags']) && id(sample.id),'Choose a catalog sample ID for the kept gesture');
    const {row,mic,original,bounds}=resolve(str,perspective);
    const {value,entry}=library.load(original.sample);
    check(entry.asset===original.asset,'Gesture original audio hash changed');
    return library.add(A.sampleCatalog.capture(value,{...bounds,
      sample:{id:sample.id,label:sample.label ?? row.label,...((row.material ?? entry.material) && {material:row.material ?? entry.material}),
        ...((row.articulation ?? entry.articulation) && {articulation:row.articulation ?? entry.articulation}),
        ...(sample.pitch!==undefined && {pitch:sample.pitch}),tags:sample.tags ?? [...new Set([...row.tags,...entry.tags])].slice(0,32),
        license:entry.license},
      source:{...entry.source,reference:'gesture-bank/'+row.id+'/'+mic}
    }));
  }
  function generate(recipe) {
    check(fields(recipe,['session','id','label','samplePrefix','material','articulation','tags','license','synthesis']) &&
      fields(recipe.session,['id','label']) && ownId(recipe.session.id) && validLabel(recipe.session.label) &&
      ownId(recipe.id) && id(recipe.samplePrefix) && [recipe.label,recipe.material,recipe.articulation].every(validLabel) &&
      tagList(recipe.tags ?? []),'Invalid generated gesture recipe');
    const {value,perspectives,report}=A.synthesizeGesture(recipe.synthesis);
    const take={}, samples=[];
    const name=label(recipe.label,recipe.id), articulation=recipe.articulation ?? report.model;
    for (const [mic,pcm] of Object.entries(perspectives)) {
      const sample=recipe.samplePrefix+'-'+mic;
      samples.push(A.sampleCatalog.capture(pcm,{sample:{id:sample,label:name+' / '+mic,articulation,
        ...(recipe.material!==undefined && {material:recipe.material}),license:recipe.license ?? {id:'CC0-1.0'},
        tags:recipe.tags ?? []},source:{kind:'graph',name:'audio.synthesizeGesture',
        reference:'gesture-bank/'+recipe.session.id+'/'+recipe.id+'/'+mic}}));
      take[mic]={sample,offsetSamples:0};
    }
    library.addBatch(samples);
    return ingest({session:recipe.session,take:{id:recipe.id,label:name,perspectives:take},slices:[{
      id:'gesture',label:name,fromSample:0,toSample:value.samples.length,analyze:'direct',
      material:recipe.material,articulation,tags:recipe.tags
    }]},report);
  }

  function inspect(session) {
    if (session!==undefined) check(ownId(session),'Invalid gesture session ID');
    const names=session===undefined ? directories(root).filter(name=>fs.existsSync(sessionFile(name))) : [session];
    return names.map(name=>{
      const row=saved(sessionFile(name),'session',name);
      const takes=directories(path.join(root,name)).filter(take=>fs.existsSync(takeFile(name,take)))
        .map(take=>({...takeInfo(name,take),slices:sliceIds(name,take)}));
      return {...row,takes};
    });
  }

  return Object.freeze({
    ingest:recipe=>ingest(recipe),generate,inspect,keep,load,get:str=>sliceInfo(...address(str)),
    search(options) {
      const entries=[];
      for (const session of inspect()) for (const take of session.takes) for (const slice of take.slices) {
        check(entries.length<16384,'Gesture search supports up to 16384 slices');
        entries.push(sliceInfo(session.id,take.id,slice));
      }
      return A.gestureBank.search(entries,options);
    },
    audition(request,options) {
      check(Array.isArray(request) && integer(request.length,1,32),'Audition one to 32 gesture slices');
      const clipsByOriginal=new Map();
      const references=request.map(raw=>{
        const item=typeof raw==='string' ? {id:raw} : raw;
        check(fields(item,['id','perspective']),'Invalid gesture audition selection');
        return resolve(item.id,item.perspective);
      });
      const seconds=references.reduce((sum,{row})=>sum+(row.toSample-row.fromSample)/row.sampleRate,0);
      check(seconds<=90,'Gesture audition exceeds 90 seconds of clips');
      references.forEach(({original},index)=>{
        if (!clipsByOriginal.has(original.sample)) clipsByOriginal.set(original.sample,[]);
        clipsByOriginal.get(original.sample).push(index);
      });
      const rows=new Array(references.length);
      for (const [sample,indices] of clipsByOriginal) {
        const {value,entry}=library.load(sample);
        for (const index of indices) {
          const {row,mic,original,bounds}=references[index];
          check(entry.asset===original.asset,'Gesture original audio hash changed');
          rows[index]={id:row.id+'/'+mic,value:crop(value,bounds)};
        }
      }
      const result=A.gestureBank.audition(rows,options);
      result.report.clips.forEach((clip,i)=>{
        const {row,mic,original,bounds}=references[i];
        Object.assign(clip,{gesture:row.id,perspective:mic,takeFromSample:row.fromSample,takeToSample:row.toSample,
          source:original.sample,sourceRate:original.sampleRate,sourceFirstSample:bounds.firstSample,sourceEndSample:bounds.endSample,
          absoluteFirstSample:original.originalFirstSample+bounds.firstSample,
          absoluteEndSample:original.originalFirstSample+bounds.endSample});
      });
      return result;
    }
  });
}

module.exports={openGestureBank};
