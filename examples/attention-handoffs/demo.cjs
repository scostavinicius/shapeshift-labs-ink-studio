/* Render one picture take and print four native editorial timing variants. */
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('../..'),PNG=require('../../cli/png.js'),WAV=require('../../cli/wav.js');
const {write,json}=require('../../cli/asset-files.js');
const kit=ink.load(), scene=require('./scene.js')(kit), cli=path.resolve(__dirname,'../../cli/ink-studio.js');
const directory=path.resolve(process.argv[2]??'sounding-glass-review');
const out=file=>path.join(directory,file), fps=20, frames=84, sampleRate=48000;
fs.mkdirSync(out('frames'),{recursive:true});
fs.copyFileSync(path.join(__dirname,'scene.js'),out('scene.js'));
const world=scene.build(scene.seed);
const picture=Array.from({length:frames},(_,i)=>{
  const t=i/fps, file='frames/'+String(i).padStart(4,'0')+'.png';
  world.anim.update(0,t);
  const image=ink.render(world,{w:384,h:216,px:1,raw:true,t});
  PNG.write(out(file),image.w,image.h,image.rgb);
  return file;
});

const length=Math.floor(frames/fps*sampleRate), bed=new Float64Array(length*2), cue=new Float64Array(sampleRate*1.33);
const tau=2*Math.PI, pin=sampleRate*.12, wobble=t=>Math.sin(tau*.31*t);
let seed=9923, water=0, fizz=0;
for(let i=0;i<length;i++){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  const sample=seed/2147483648-1, t=i/sampleRate;
  water+=.009*(sample-water);
  fizz+=.071*(sample-fizz);
  const border=Math.min(1,t*12,(length-i)/(sampleRate*.23));
  const motor=.017*Math.sin(tau*63*t+.16*wobble(t))+.009*Math.sin(tau*91.5*t);
  const drift=.049*water*(.64+.22*wobble(t))+.008*fizz;
  bed[2*i]=border*(motor+drift);
  bed[2*i+1]=border*(motor*.88+drift*(.92+.07*Math.sin(t*.87)));
}
function tone(t,at,amp,frequency,decay,bend=0){
  const age=t-at;
  if(age<0)return 0;
  return amp*Math.exp(-age/decay)*Math.sin(tau*(frequency*age+bend*age*age)+.29);
}
for(let i=0;i<cue.length;i++){
  const t=(i-pin)/sampleRate, tail=Math.min(1,(cue.length-i)/(sampleRate*.060));
  cue[i]=tail*(tone(t,0,.25,493,.17,26)+tone(t,0,.136,749,.25,19)+tone(t,0,.086,1418,.13,-28)+
    tone(t,.132,.077,989,.31,-21)+tone(t,.132,.072,1484,.22,11)+tone(t,.132,.031,2410,.081,-41));
}
const native={sampleRate};
write(out('water-bed.wav'),WAV.encode({...native,channels:2,samples:bed},{encoding:'pcm24'}));
write(out('glass-cue.wav'),WAV.encode({...native,channels:1,samples:cue},{encoding:'pcm24'}));

const name='sounding-glass', reveal=36;
json(out('editorial.json'),{assets:{water:'water-bed.wav',glass:'glass-cue.wav'},
  session:{format:'ink-studio/audio-editorial',version:1,id:name,sampleRate,picture:{fps,shots:[{id:'port',frames}]},
    clips:[{id:'water',track:'bed',spot:{samples:0},take:'bed',takes:{bed:{asset:'water',sync:{sample:0}}}},
      {id:'glass',track:'foley',spot:{frame:reveal},take:'hit',takes:{hit:{asset:'glass',sync:{sample:pin}}}}]}});
json(out('handoff.json'),{format:'ink-studio/attention-handoff',version:1,id:name,editorial:'editorial.json',
  picture:{fps,frames:picture},window:{from:12,to:78},reveal:{frame:reveal,label:'Jelly lights up'},clip:'glass',
  variants:[{id:'early',offsetMs:-420,label:'Sound first'},{id:'anticipation',offsetMs:-180,label:'Short lead'},
    {id:'sync',offsetMs:0,label:'Together'},{id:'answer',offsetMs:560,label:'Picture first'}]});
const folder=out('audition');
execFileSync(process.execPath,[cli,'take','audition-handoff',out('handoff.json'),'--out',folder],{stdio:'inherit'});
const report=JSON.parse(fs.readFileSync(path.join(folder,'report.json'),'utf8'));
if(report.headroom!==1 || report.variants.map(row=>row.offsetMs).join()!=='-420,-180,0,560')
  throw new Error('Sounding Glass demo timing or gain did not match the authored comparison');
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-framerate',String(fps),'-start_number',String(report.window.from),
  '-i',out('frames/%04d.png'),'-i',path.join(folder,'early.wav'),'-frames:v',String(report.window.frames),
  '-vf','scale=768:432:flags=neighbor','-c:v','libx264','-pix_fmt','yuv420p','-crf','17',
  '-c:a','aac','-b:a','192k','-t',String(report.window.frames/fps),'-movflags','+faststart',out('sounding-glass.mp4')]);
