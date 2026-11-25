/* Build the Moon Relay animator review and render the same edits with Ink. */
const fs=require('node:fs'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('../..'), {portrait,cel,poses}=require('./art.cjs');
const PNG=require('../../cli/png.js'), {write,json}=require('../../cli/asset-files.js');
const cli=path.resolve(__dirname,'../../cli/ink-studio.js');
const out=path.resolve(process.argv[2]??'moon-relay-review'), suppliedVoice=process.argv[3];
const assets=path.join(out,'art');
fs.mkdirSync(assets,{recursive:true});
function image(name,raster){
  write(path.join(out,name),PNG.encode(raster.width,raster.height,raster.data,4));
}
const face=portrait(), sprites=Object.fromEntries(poses.map(name=>[name,cel(name)]));
image('art/portrait.png',face);
for(const [name,art] of Object.entries(sprites))image('art/'+name+'.png',art);
const voice=path.join(out,'read.wav'), aiff=path.join(out,'scratch.aiff'), line='Mark five. Blue moon.';
if(suppliedVoice){
  const source=path.resolve(suppliedVoice);
  if(source!==voice)fs.copyFileSync(source,voice);
}else{
  execFileSync('say',['-v','Samantha','-r','136','-o',aiff,line]);
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',aiff,
    '-af','adelay=140:all=1,apad=pad_dur=0.23','-ac','1','-ar','48000','-sample_fmt','s16',voice]);
  fs.rmSync(aiff);
}
const recipe={
  format:'ink-studio/mouth-cel-plan',version:1,id:'moon-relay',audio:'read.wav',fps:16,accentDb:3.5,
  rig:{grid:[112,86],origin:[51,48],size:[18,10],rest:'rest',poses,accents:{open:'open-accent',round:'round-accent'}},
  utterances:[{id:'dispatch',speech:{kind:'text',text:line,symbols:['aɪ'],
    lexicon:{mark:'mɑɹk',five:'fˈaɪv',blue:'bluː',moon:'mˈuːn'}}}],
  art:{face:'art/portrait.png',cels:Object.fromEntries(poses.map(name=>[name,'art/'+name+'.png']))}
};
json(path.join(out,'plan.json'),recipe);
execFileSync(process.execPath,[cli,'take','mouth-cels',path.join(out,'plan.json'),'--out',out],{stdio:'inherit'});
const sheet=JSON.parse(fs.readFileSync(path.join(out,'mouth-holds.json'),'utf8'));
const link=node=>({node});
const celAssets=Object.fromEntries(poses.map(name=>[name,{format:'png',file:'art/'+name+'.png'}]));
const project={format:'ink-studio/graph-project',version:1,
  assets:{sheet:{format:'json',file:'mouth-holds.json'},portrait:{format:'png',file:'art/portrait.png'},...celAssets},
  nodes:{
    sheet:{op:'jsonAsset',inputs:{name:'sheet'}}, portrait:{op:'pngAsset',inputs:{name:'portrait'}},
    ...Object.fromEntries(poses.map(name=>['cel-'+name,{op:'pngAsset',inputs:{name}}])),
    bank:{op:'data.record',inputs:Object.fromEntries(poses.map(name=>[name,link('cel-'+name)]))},
    mouth:{op:'raster.mouthCels',inputs:{sheet:link('sheet'),face:link('portrait'),cels:link('bank')}}
  },
  outputs:{portrait:link('mouth'),hold:{node:'mouth',port:'hold'}},
  exports:{portrait:{output:'portrait',format:'png'},hold:{output:'hold',format:'json'}}
};
const graphFile=path.join(out,'portrait.graph.json'), kit=ink.load();
json(graphFile,project);
const graph=ink.readGraphProject(graphFile,{kit}), clock=kit.KIT.timeDomains.take({fps:sheet.fps});
const flagged=new Set(sheet.holds.map(hold=>hold.pose));
if(!['seal','teeth','open-accent','round-accent'].every(name=>flagged.has(name)))
  throw new Error('Demo read did not expose its important cels');
const frames=path.join(out,'frames');
fs.mkdirSync(frames,{recursive:true});
try{
  for(let i=0;i<sheet.frames;i++){
    const {portrait:frame}=graph.run({take:clock.at(i)}).outputs;
    image('frames/'+String(i).padStart(4,'0')+'.png',frame);
  }
}finally{graph.clear();}
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-framerate','16',
  '-i',path.join(frames,'%04d.png'),'-i',voice,'-vf','scale=672:516:flags=neighbor',
  '-c:v','libx264','-crf','16','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-movflags','+faststart',
  path.join(out,'moon-relay.mp4')],{stdio:'inherit'});
fs.rmSync(frames,{recursive:true});
