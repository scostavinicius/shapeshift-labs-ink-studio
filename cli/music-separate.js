const fs=require('node:fs'), path=require('node:path');
const WAV=require('./wav.js'), {write,json}=require('./asset-files.js');

module.exports=function separate([input,settings,...extra],opt,kit){
  if(!input||extra.length||typeof opt.out!=='string'||Object.keys(opt).some(key=>key!=='out'))
    throw new TypeError('Use music separate <recording.wav> [settings.json] --out directory');
  const folder=path.resolve(opt.out), source=fs.realpathSync(input);
  const names={harmonic:'harmonic.wav',percussive:'percussive.wav'};
  const outputs=[...Object.values(names),'project.json','report.json'];
  const target=fs.existsSync(folder)?fs.realpathSync(folder):folder;
  if(outputs.some(name=>path.join(target,name)===source))
    throw new RangeError('Choose an output directory that preserves the original recording');
  const config=settings===undefined?{}:JSON.parse(fs.readFileSync(settings,'utf8'));
  const {value,assets,report}=kit.KIT.procedural.mediaGraph.harmonicPercussive.session(WAV.read(source),config);
  for(const [key,pcm] of Object.entries(assets))write(path.join(folder,names[key]),WAV.encode(pcm,{encoding:'float32'}));
  const project=path.join(folder,'project.json'), evidence=path.join(folder,'report.json');
  json(project,{session:value,assets:names});
  json(evidence,report);
  const result={project,report:evidence,harmonic:path.join(folder,names.harmonic),
    percussive:path.join(folder,names.percussive),movableHits:report.hits.length};
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  return result;
};
