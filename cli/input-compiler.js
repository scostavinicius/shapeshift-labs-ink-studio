/* Read portable sources relative to a simulation input compilation plan. */
const fs=require('node:fs'), path=require('node:path');
const {midiFiles}=require('../src/kit/pui8-midi-file.js');

function load(kit,plan,file,dependency=()=>{}){
  const W=kit.KIT.world,{check,record,own}=W.data;
  check(record(plan?.sources),'Input compile plan needs sources');
  const sources=Object.fromEntries(Object.entries(plan.sources).map(([name,source])=>{
    check(record(source),'Invalid input source '+name);
    if(!own(source,'file'))return [name,source];
    const {file:reference,...definition}=source;
    check(typeof reference==='string'&&reference.length>0&&!path.isAbsolute(reference)&&!path.win32.isAbsolute(reference),
      'Input source paths must be relative to the compilation plan');
    const location=path.resolve(path.dirname(path.resolve(file)),reference);
    dependency(location);
    const {kind}=source, midi=kind==='midi', speech=kind==='text'||kind==='ipa';
    check(midi||speech||['controller','cues'].includes(kind),'Invalid file input kind '+kind);
    check(fs.statSync(location).size<=(midi?midiFiles.maxBytes:speech?65536:16*1024*1024),'Input source file exceeds its byte budget');
    if(midi){
      check(definition.bytes===undefined,'Choose inline MIDI bytes or a source file');
      return [name,{...definition,bytes:fs.readFileSync(location)}];
    }
    const text=new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(location));
    if(speech){
      check(definition.text===undefined,'Choose inline speech text or a source file');
      return [name,{...definition,text}];
    }
    const data=JSON.parse(text);
    if(kind==='controller'){
      check(definition.recording===undefined,'Choose inline recording or a source file');
      return [name,{...definition,recording:data}];
    }
    check(definition.track===undefined&&definition.items===undefined,'Choose inline cues or a source file');
    return [name,{...definition,...(Array.isArray(data)?{items:data}:{track:data})}];
  }));
  return W.inputCompilers.compile({...plan,sources});
}

module.exports={load};
