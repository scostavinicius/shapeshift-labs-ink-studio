const fs=require('node:fs'),path=require('node:path');
const {openGestureBank}=require('./gesture-bank.js');
const {json,write}=require('./asset-files.js');
const WAV=require('./wav.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

module.exports=function command([mode,directory,file],opt,kit) {
  if (!directory) throw new TypeError('Pass a sample library directory');
  const bank=openGestureBank(directory,{kit});
  const settings=()=>file ? read(file) : undefined;
  let value;
  if (mode==='inspect') value=bank.inspect(file);
  else if (mode==='ingest') value=bank.ingest(settings());
  else if (mode==='generate') value=bank.generate(settings());
  else if (mode==='keep') {
    const {id,perspective,sample}=settings() ?? {};
    value=bank.keep(id,perspective,sample);
  } else if (mode==='search') {
    value=bank.search(file && path.extname(file).toLowerCase()!=='.json' ? {phrase:file} : settings());
  } else if (mode==='audition') {
    if (typeof opt.out!=='string') throw new TypeError('Use --out with an audio output directory');
    const {clips,options}=settings() ?? {}, result=bank.audition(clips,options);
    const directory=path.resolve(opt.out), audio=path.join(directory,'audition.wav'), report=path.join(directory,'report.json');
    write(audio,WAV.encode(result.value,{encoding:'float64'}));
    json(report,{...result.report,audio});
    value={audio,report};
  } else throw new TypeError('Use music gestures ingest, generate, inspect, search, audition or keep');
  if (typeof opt.out==='string' && mode!=='audition') json(path.resolve(opt.out),value);
  else process.stdout.write(JSON.stringify(value,null,2)+'\n');
  return value;
};
