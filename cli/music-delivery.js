const fs=require('node:fs'),path=require('node:path');
const {delivery,deliveryClock}=require('./audio-delivery.js');
const {readAssets}=require('./music-mixer.js');
const {readSceneAudio}=require('./scene-audio.js');
const {readExportWorld}=require('./scene-export-world.js');
const {withTakeSource}=require('./project-bundle.js');

module.exports=function deliverCommand([file],opt,kit) {
  if (!file || typeof opt.out!=='string' || opt.strict!==undefined && opt.strict!==true)
    throw new TypeError('Use music deliver recipe.json --out directory [--strict]');
  const P=kit.KIT.procedural,T=P.takeTime,{fields,record,check}=P.musicInstruments;
  const input=path.resolve(file), folder=path.dirname(input), target=path.resolve(opt.out);
  const recipe=JSON.parse(fs.readFileSync(input,'utf8'));
  check(fields(recipe,['delivery','assets','mixer','soundtrack','take']) && record(recipe.delivery) &&
    (recipe.mixer!==undefined ? record(recipe.mixer) && recipe.soundtrack===undefined && recipe.take===undefined :
      recipe.assets===undefined && [recipe.soundtrack,recipe.take].some(value=>value!==undefined)),
  'Delivery needs a mixer and its WAV table or a scene soundtrack and optional take');
  const reference=value=>typeof value==='string' && value.trim();
  check([recipe.take,recipe.soundtrack].every(value=>value===undefined || reference(value)),
    'Soundtrack and take references must be file paths');
  function prepare(source) {
    if (recipe.mixer!==undefined) {
      const {mixer,delivery:settings}=recipe;
      const clock=deliveryClock(P,mixer.sampleRate ?? 48000,mixer.map,settings.fps);
      return {P,settings,mixer,assets:readAssets(recipe.assets ?? {},input,P),clock};
    }
    const native=source && readExportWorld(source,kit);
    if (source && !native) throw new TypeError('Delivery take must use a native world');
    const filename=recipe.soundtrack===undefined ? native?.audio : path.resolve(folder,recipe.soundtrack);
    if (!filename) throw new TypeError('Point delivery at a soundtrack with scene post routing');
    const stage=readSceneAudio(filename,{kit}), fps=recipe.delivery.fps ?? native?.fps;
    const settings={...recipe.delivery,...(fps!==undefined && {fps})};
    const clock=deliveryClock(P,stage.sampleRate,stage.tempoMap,fps);
    const end=settings.to===undefined ? native?.runtime().timeline?.duration : undefined;
    if (settings.to===undefined && !(end>0)) throw new TypeError('Give scene delivery a to address or a take timeline');
    const stop=clock.at(settings.to ?? {seconds:end});
    const sequence={startPoint:T.read(0),endPoint:T.div(T.read(stop),T.read(stage.sampleRate))};
    return {P,settings,...stage.prepareDelivery(sequence,{runtime:native?.runtime}),clock};
  }
  function publish(context) {
    const parent=path.dirname(target);
    fs.mkdirSync(parent,{recursive:true});
    const staging=fs.mkdtempSync(path.join(parent,'.ink-delivery-'));
    try {
      const bundle=delivery(context,staging);
      if (fs.existsSync(target)) {
        // Stage the complete render before touching an existing delivery.
        const names=[...Object.keys(bundle.files),bundle.cueSheet.json,bundle.cueSheet.csv,
          bundle.interchange,bundle.quality,'delivery.json'];
        for (const name of names) fs.mkdirSync(path.dirname(path.join(target,name)),{recursive:true});
        for (const name of names) fs.renameSync(path.join(staging,name),path.join(target,name));
      } else fs.renameSync(staging,target);
      const result={manifest:path.join(target,'delivery.json'),quality:path.join(target,bundle.quality),
        passed:bundle.qualityPassed};
      process.stdout.write(JSON.stringify(result)+'\n');
      if (opt.strict && !result.passed) process.exitCode=1;
      return result;
    } finally {fs.rmSync(staging,{recursive:true,force:true});}
  }
  const run=source=>publish(prepare(source));
  return recipe.take===undefined ? run() : withTakeSource(path.resolve(folder,recipe.take),run);
};
