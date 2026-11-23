const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const WAV=require('./wav.js'),{write,json,publishJson}=require('./asset-files.js');
const {openSampleLibrary}=require('./sample-library.js');
const {resolveSampleAssets}=require('./music-sample-assets.js');
const {readAudioPrint}=require('./audio-print.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const text=(value,max=512)=>typeof value==='string' && value.trim().length>0 && value.length<=max;

function pin(folder,name,audio) {
  const bytes=WAV.encode(audio,{encoding:'float64'}), sha256=createHash('sha256').update(bytes).digest('hex');
  const wav='sources/'+name+'-'+sha256+'.wav', file=path.join(folder,wav);
  if (!fs.existsSync(file)) write(file,bytes);
  else if (fs.statSync(file).size!==bytes.length || !fs.readFileSync(file).equals(bytes))
    throw new RangeError('Kept sample motif already has a different '+name);
  return {wav,sha256};
}

module.exports=function command([mode,file,settingsFile],opt,kit) {
  const P=kit.KIT.procedural,{fields,check,id}=P.musicInstruments,A=P.mediaGraph,J=A.sampleMotif;
  check(['plan','audition','keep','render'].includes(mode) && text(file) &&
    (mode==='plan' || typeof opt.out==='string') && (!['keep','render'].includes(mode) || text(settingsFile)),
  'Use music motif plan, audition, keep or render with a recipe and the applicable settings or selection');
  const recipe=read(file), at=name=>path.resolve(path.dirname(path.resolve(file)),name);
  check(fields(recipe,['source','score','settings','library','plan','provenance']) && recipe.source!==undefined &&
    recipe.score!==undefined && (recipe.library===undefined || text(recipe.library)) &&
    (recipe.plan===undefined || text(recipe.plan)) && !(recipe.plan!==undefined && recipe.settings!==undefined) &&
    (recipe.provenance===undefined || fields(recipe.provenance,['role','source','score','note','license'])),
  'A sample motif recipe needs a recording, score and either settings or a saved plan');
  const library=recipe.library && openSampleLibrary(at(recipe.library),{kit});
  const {assets:{source,score},sources}=resolveSampleAssets({source:recipe.source,score:recipe.score},file,library,kit,{allowWav:true});
  const settings=settingsFile ? read(settingsFile) : undefined;
  const folder=typeof opt.out==='string' ? path.resolve(opt.out) : undefined;
  const selection=['keep','render'].includes(mode);
  if (selection) check(fields(settings,mode==='keep' ? ['role','plan','sample','note'] : ['role','plan']) &&
    id(settings.role) && (settings.plan===undefined || text(settings.plan)) &&
    (settings.note===undefined || text(settings.note)) &&
    (settings.sample===undefined || fields(settings.sample,['id','label','material','articulation','tags','license'])),
  'Choose one role and optional saved plan, catalog metadata and note');
  const planFile=selection && settings.plan;
  const plan=planFile ? read(path.resolve(path.dirname(path.resolve(settingsFile)),planFile)) :
    recipe.plan ? read(at(recipe.plan)) : J.plan(source,score,recipe.settings);
  function output(result) {
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    return result;
  }
  if (mode==='plan') {
    if (folder) json(folder,plan);
    else output(plan);
    return plan;
  }
  const save=(name,audio)=>{
    const target=path.join(folder,name);
    write(target,WAV.encode(audio,{encoding:'pcm24'}));
    return target;
  };
  const reportFile=path.join(folder,'report.json');
  if (mode==='audition') {
    const result=J.audition(plan,source,score,settings);
    const editable=path.join(folder,'plan.json');
    json(editable,plan);
    json(reportFile,{...result.report,sources,provenance:recipe.provenance});
    return output({audio:save('audition.wav',result.value),report:reportFile,plan:editable});
  }
  const result=J.render(plan,source,score,settings.role);
  let kept, provenance=recipe.provenance;
  if (mode==='keep') {
    const input=sources.source;
    const entry=input.print ? readAudioPrint(at(input.print),kit).entry(input.take) : input.id && library.get(input.id).entry;
    const sample={id:'motif-material',label:settings.role+' motif material',license:entry?.license ?? provenance?.license,
      ...settings.sample};
    provenance={role:settings.role,source:provenance?.source ?? input,score:provenance?.score ?? sources.score,
      ...(settings.note && {note:settings.note}),...(sample.license && {license:sample.license})};
    const capture=A.sampleCatalog.capture(result.material,{sample,source:{
      kind:'graph',name:'music.renderSampleMotif',reference:'project.json'
    }});
    const project=path.join(folder,'project.json'), planPath=path.join(folder,'plan.json');
    const snapshot={source:pin(folder,'recording',source),score:pin(folder,'score',score),plan:'plan.json',provenance};
    const conflict='Choose a new folder for a different kept sample motif';
    publishJson(project,snapshot,conflict);
    publishJson(planPath,plan,conflict);
    const catalogDir=path.join(folder,'library'), catalog=openSampleLibrary(catalogDir,{kit});
    const stored=catalog.add(capture);
    const kitPath=path.join(folder,'kit.json'), performance=path.join(folder,'performance.json');
    const choice=path.join(folder,'selection.json');
    publishJson(kitPath,{kit:result.role.kit,assets:{material:{sample:stored.entry.id,asset:stored.entry.asset}}},conflict);
    publishJson(performance,result.role.performance,conflict);
    publishJson(choice,{role:settings.role},conflict);
    kept={project,plan:planPath,selection:choice,kit:kitPath,performance,library:catalogDir,material:stored.file};
  }
  json(reportFile,{...result.report,sources,provenance});
  return output({audio:save('mix.wav',result.value),stem:save('role.wav',result.stem),report:reportFile,...kept});
};
