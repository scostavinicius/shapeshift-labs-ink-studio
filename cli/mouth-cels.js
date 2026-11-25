const fs=require('node:fs'), path=require('node:path');
const WAV=require('./wav.js'), PNG=require('./png.js'), {write,json}=require('./asset-files.js');

function command(file,opt,{kit}){
  if(typeof opt.out!=='string' || !opt.out.trim() || Object.keys(opt).some(key=>key!=='out'))
    throw new TypeError('Use take mouth-cels <recipe.json> --out directory');
  const owner=path.resolve(file), sources=new Set([owner]), directory=path.resolve(opt.out);
  const raw=JSON.parse(fs.readFileSync(owner,'utf8'));
  const {audio,art,...plan}=raw;
  function input(name){
    if(typeof name!=='string' || !name.trim())throw new TypeError('Mouth cels need named WAV and PNG input files');
    const file=path.resolve(path.dirname(owner),name);
    sources.add(file);
    return file;
  }
  const audioFile=input(audio), {mouthCels}=kit.KIT.world;
  const voice=WAV.read(audioFile);
  const sheet=mouthCels.build(plan,voice);
  let html;
  if(art!==undefined){
    const {fields,record,check}=kit.KIT.procedural.musicInstruments;
    check(fields(art,['face','cels']) && record(art.cels) &&
      Object.keys(art.cels).length===sheet.rig.poses.length,'Review art needs a face and a PNG for each authored cel');
    let bytes=0;
    function encode(name,size){
      const source=input(name), stat=fs.statSync(source);
      bytes+=stat.size;
      check(bytes<=12*1024*1024,'Mouth review art exceeds the byte budget');
      const raw=fs.readFileSync(source), {w,h}=PNG.layout(raw);
      check(w===size[0] && h===size[1],'Review art must match the authored native pixel dimensions');
      PNG.raster(raw);
      return raw.toString('base64');
    }
    const pictures={face:encode(art.face,sheet.rig.grid),cels:Object.fromEntries(sheet.rig.poses.map(pose=>
      [pose,encode(art.cels[pose],sheet.rig.size)]))};
    check(fs.statSync(audioFile).size<=32*1024*1024,'Mouth review WAV exceeds 32 MiB');
    // Canonical PCM keeps browser playback portable across accepted WAV encodings.
    const wave=WAV.encode(voice,{encoding:'pcm16'}).toString('base64');
    const serial=value=>JSON.stringify(value).replace(/</g,'\\u003c');
    html=fs.readFileSync(path.join(__dirname,'mouth-cels-review.html'),'utf8')
      .replace('/* SHEET */ {}',()=>serial(sheet))
      .replace('/* PICTURES */ {}',()=>serial(pictures))
      .replace('/* VOICE */ ""',()=>serial(wave));
  }
  const sheetFile=path.join(directory,'mouth-holds.json'), reviewFile=path.join(directory,'review.html');
  for(const destination of html===undefined ? [sheetFile] : [sheetFile,reviewFile]){
    const stat=fs.statSync(destination,{throwIfNoEntry:false});
    if(sources.has(destination) || stat && [...sources].some(file=>{
      const source=fs.statSync(file);
      return source.dev===stat.dev && source.ino===stat.ino;
    }))throw new RangeError('Mouth cel outputs must be separate from the voice read and art');
  }
  json(sheetFile,sheet);
  if(html!==undefined)write(reviewFile,html);
  process.stdout.write(JSON.stringify({sheet:sheetFile,...(html!==undefined&&{review:reviewFile}),
    holds:sheet.holds.length,phones:sheet.phones.length,warnings:sheet.warnings})+'\n');
}
module.exports={command};
