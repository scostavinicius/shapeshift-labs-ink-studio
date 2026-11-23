const fs=require('node:fs'),path=require('node:path'),WAV=require('./wav.js');
const {write,json}=require('./asset-files.js'),{readAssets}=require('./music-mixer.js');
const {openSampleLibrary}=require('./sample-library.js'),{resolveSampleAssets}=require('./music-sample-assets.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

module.exports=function command([mode,file,settingsFile],opt,kit) {
  const P=kit.KIT.procedural,A=P.mediaGraph,J=A.timbreComposition,{fields,id,check}=P.musicInstruments;
  check(typeof file==='string' && ['analyze','project','match','palette','audition','arrange','evolve'].includes(mode),
    'Use music timbre analyze, project, match, palette, audition, arrange or evolve');
  const output=(value,target)=>{
    if (target) json(target,value);
    else process.stdout.write(JSON.stringify(value,null,2)+'\n');
    return value;
  };
  const settings=settingsFile===undefined ? undefined : read(settingsFile);
  const folder=typeof opt.out==='string' ? path.resolve(opt.out) : undefined;
  const storeAssets=(bank,base)=>Object.fromEntries(Object.entries(bank).map(([name,pcm])=>{
    check(id(name),'Invalid timbre asset name');
    const target='assets/'+name+'.wav';
    write(path.join(base,target),WAV.encode(pcm,{encoding:'float64'}));
    return [name,target];
  }));
  if (mode==='palette') {
    check(folder,'Export the palette to a directory');
    const {id,assets,patches,room}=A.timbrePalettes.load(file,settings);
    const target=path.join(folder,'palette.json');
    json(target,{id,patches,room,assets:storeAssets(assets,folder)});
    return output({palette:target});
  }
  if (mode==='project') return output(J.project(read(file),settings),folder);
  if (mode==='match') {
    check(fields(settings,['profiles','options']),'Supply candidate profiles and optional matching weights');
    return output(J.compare(read(file),settings.profiles,settings.options),folder);
  }
  const recipe=read(file), at=name=>path.resolve(path.dirname(path.resolve(file)),name);
  const library=recipe.library && openSampleLibrary(at(recipe.library),{kit});
  const {assets:{recording},sources}=resolveSampleAssets({recording:recipe.source},file,library,kit,{allowWav:true});
  if (mode==='analyze') {
    check(fields(recipe,['source','analysis','library']),'A timbre analysis recipe needs a source and optional settings');
    return output(J.extract(recording,settings ?? recipe.analysis),folder);
  }
  const keys=['source','production','settings','options','library','assets'];
  check(folder && fields(recipe,mode==='evolve' ? [...keys,'analysis'] : keys) &&
    recipe.production!==undefined && (mode!=='arrange' || fields(settings,['take','note']) && id(settings.take) &&
      (settings.note===undefined || typeof settings.note==='string' && settings.note.length<=1000)),
  'An orchestration needs a production, settings, output directory and optional selection');
  const productionFile=typeof recipe.production==='string' ? at(recipe.production) : file;
  const loaded=typeof recipe.production==='string' ? read(productionFile) : recipe.production;
  const production=loaded.production ?? loaded;
  const bank=recipe.assets===undefined ? readAssets(loaded.assets ?? {},productionFile,P) : readAssets(recipe.assets,file,P);
  if (mode==='evolve') {
    const E=A.timbreEvolution, profile=E.analyze(recording,recipe.analysis);
    const {value,revision,report}=E.plan(profile,production,settings ?? recipe.settings,bank);
    const project=path.join(folder,'production.json'), plan=path.join(folder,'evolution.json');
    const options=recipe.options ?? {};
    const rendered=P.musicProduction.render(value,bank,options);
    const audio=path.join(folder,'mix.wav');
    write(audio,WAV.encode(rendered.value,{encoding:'pcm24'}));
    const stems=Object.fromEntries(Object.entries(rendered.stems).map(([name,pcm])=>{
      const file=path.join(folder,'stems',name+'.wav');
      write(file,WAV.encode(pcm,{encoding:'pcm24'}));
      return [name,file];
    }));
    json(project,{production:value,assets:storeAssets(bank,folder),options});
    json(plan,{profile,revision,report,source:sources.recording});
    return output({project,plan,audio,...(Object.keys(stems).length && {stems})});
  }
  const preview=mode==='audition' ? J.audition(recording,production,recipe.settings,bank,settings ?? recipe.options) : null;
  const plan=preview?.plan ?? J.plan(recording,production,recipe.settings,bank);
  const selected=mode==='arrange' ? plan.variants.find(row=>row.id===settings.take) : null;
  if (mode==='arrange') check(selected,'Unknown timbre orchestration take');
  const files=storeAssets({...bank,...plan.assets},folder);
  const sourceWav='recording.wav';
  write(path.join(folder,sourceWav),WAV.encode(recording,{encoding:'float64'}));
  const {assets:derived,...portable}=plan;
  const planPath=path.join(folder,'plan.json');
  json(planPath,{...portable,source:sources.recording,recording:sourceWav,assets:files,
    ...(selected && {selected:selected.id,note:settings.note})});
  if (selected) {
    const file=path.join(folder,'production.json');
    json(file,{production:P.musicProduction.revise(production,selected,{...bank,...derived}),assets:files});
    return output({project:file,plan:planPath});
  }
  const takes=preview.takes.map(row=>{
    const sub=path.join(folder,row.id), mix=row.id+'/mix.wav', project=row.id+'/production.json';
    write(path.join(folder,mix),WAV.encode(row.value,{encoding:'pcm24'}));
    json(path.join(folder,project),{production:row.production,assets:Object.fromEntries(Object.entries(files)
      .map(([name,ref])=>[name,path.relative(sub,path.join(folder,ref))]))});
    return {id:row.id,mix,project};
  });
  const manifest=path.join(folder,'manifest.json');
  json(manifest,{...preview.report,files:takes});
  return output({manifest,plan:planPath,takes});
};
