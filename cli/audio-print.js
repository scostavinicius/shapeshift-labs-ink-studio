/* Print graph audio once and load the resulting portable, verified take files. */
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const WAV=require('./wav.js');
const {write,json}=require('./asset-files.js');
const {readGraphProject}=require('./graph-project.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const format='ink-studio/audio-print';
const variants=['dry','wet'];
const text=value=>typeof value==='string' && value.trim().length>0;

function printAudio(file,out,library,kit) {
  if (!file || typeof out!=='string') throw new TypeError('Pass a print recipe and --out directory');
  const P=kit.KIT.procedural, {fields,check}=P.musicInstruments;
  const recipe=read(file);
  check(fields(recipe,['graph','taps','sample','range','markers','time','seed','inputs']) && text(recipe.graph),
    'A print recipe needs a graph, sample metadata, and dry and/or wet taps');
  const {graph,taps,time,seed,inputs,sample,range,markers}=recipe, folder=path.resolve(out);
  const project=readGraphProject(path.resolve(path.dirname(file),graph),{kit});
  const tapped=project.audioTaps(taps,{time,seed,inputs});
  const {audio,entries,report}=P.mediaGraph.audioPrint.prepare(tapped.sources,{
    sample,range,markers,source:{reference:graph},projectHash:tapped.projectHash,
    seed:tapped.seed,time:tapped.time,traces:tapped.traces
  });
  return publishAudioPrint({audio,entries,report},folder,library,P.mediaGraph);
}

function publishAudioPrint({audio,entries,report},folder,library,A) {
  const names=Object.keys(audio);
  const waves=names.map(name=>WAV.encode(audio[name],{encoding:'pcm24'}));
  const stored=library.addBatch(names.map((name,i)=>({value:WAV.decode(waves[i]),entry:entries[name]})));
  const takes=Object.fromEntries(names.map((name,i)=>{
    const {entry}=stored[i], file=name+'.wav', edit=name+'.edit.json';
    write(path.join(folder,file),waves[i]);
    json(path.join(folder,edit),A.audioPrint.edit(entry));
    return [name,{file,sha256:sha(waves[i]),edit,entry}];
  }));
  const manifest=path.join(folder,'print.json');
  json(manifest,{format,version:1,takes});
  return {manifest,...report,entries:Object.fromEntries(names.map((name,i)=>[name,stored[i].entry.id]))};
}

function readAudioPrint(file,kit) {
  const P=kit.KIT.procedural,{check,fields}=P.musicInstruments,A=P.mediaGraph;
  const source=read(file),folder=path.dirname(file);
  check(fields(source,['format','version','takes']) && source.format===format && source.version===1 &&
    fields(source.takes,variants) && Object.keys(source.takes).length,'Invalid audio print manifest');
  const takes=Object.fromEntries(Object.entries(source.takes).map(([take,row])=>{
    check(fields(row,['file','edit','sha256','entry']) && row.file===take+'.wav' && row.edit===take+'.edit.json' &&
      typeof row.sha256==='string' && /^[a-f0-9]{64}$/.test(row.sha256),'Invalid audio print take');
    const entry=A.sampleCatalog.entry(row.entry);
    check(entry.asset && entry.print?.take===take,'Audio print take entry does not match its manifest');
    return [take,{...row,entry}];
  }));
  const cached=new Map();
  function find(take) {
    const name=take ?? (Object.keys(takes).length===1 ? Object.keys(takes)[0] : undefined);
    check(variants.includes(name) && Object.hasOwn(takes,name),'Choose a dry or wet take from this print');
    return takes[name];
  }
  return {
    entry:take=>find(take).entry,
    load(take,slice) {
      const row=find(take), {entry}=row;
      if (!cached.has(row)) {
        const wav=path.join(folder,row.file);
        check(fs.statSync(wav).size<=WAV.maxBytes,'Printed WAV exceeds its byte budget');
        const bytes=fs.readFileSync(wav);
        check(sha(bytes)===row.sha256,'Printed WAV hash does not match its manifest');
        const value=WAV.decode(bytes);
        check(value.sampleRate===entry.sampleRate && value.channels===entry.channels &&
          value.samples.length===entry.frames*entry.channels,'Printed WAV layout does not match its entry');
        cached.set(row,value);
      }
      const pcm=cached.get(row);
      const value=slice===undefined ? pcm : A.sampleEdit.render(pcm,A.audioPrint.edit(entry),{slice}).value;
      return {entry,value};
    }
  };
}

module.exports={printAudio,readAudioPrint,publishAudioPrint};
