/* Render the actual delivery, check it, and build a portable A/B review. */
const fs=require('node:fs'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('../..'), PNG=require('../../cli/png.js'), WAV=require('../../cli/wav.js');
const {json,write}=require('../../cli/asset-files.js'), {analyze}=require('../../cli/delivered-sync.js');
const kit=ink.load(), scene=require('./scene.js')(kit);
const out=path.resolve(process.argv[2] ?? 'relay-press-review'), frameDir=path.join(out,'frames');
const fps=24, duration=3, rate=48000, count=fps*duration;
fs.mkdirSync(frameDir,{recursive:true});
fs.copyFileSync(path.join(__dirname,'scene.js'),path.join(out,'scene.js'));
const world=scene.build(scene.seed);
const files=Array.from({length:count},(_,i)=>{
  const time=i/fps;
  world.anim.update(0,time);
  const frame=ink.render(world,{w:360,h:204,px:1,raw:true,t:time});
  const filename='frames/'+String(i).padStart(4,'0')+'.png';
  PNG.write(path.join(out,filename),frame.w,frame.h,frame.rgb);
  return filename;
});

const print=(name,pcm)=>write(path.join(out,name+'.wav'),WAV.encode(pcm,{encoding:'pcm24'}));
const ring=(age,hz,decay)=>Math.cos(2*Math.PI*hz*age)*Math.exp(-age/decay);
const latch=new Float64Array(rate), room=new Float64Array(rate*duration*2), tau=2*Math.PI;
const preroll=10800, slip=6800;
let seed=49111, air=0;
for (let i=0;i<room.length/2;i++) {
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  air+=.024*(seed/2147483648-1-air);
  const t=i/rate, fade=Math.min(1,t*12,(duration-t)*11);
  const motor=t>.47 && t<1.2 ? .010*Math.sin(tau*(89*t+3.85*t*t))*Math.sin(Math.PI*(t-.47)/.73) : 0;
  const rattle=t>1.70 && t<2.15 ? .010*air*Math.sin(Math.PI*(t-1.70)/.45) : 0;
  for (let ch=0;ch<2;ch++) room[2*i+ch]=fade*(.056*air+.009*Math.sin(tau*55*t+.24*ch)+motor+rattle);
}
for (let i=preroll;i<latch.length;i++) {
  const age=(i-preroll)/rate;
  latch[i]=.15*ring(age,554,.14)+.14*ring(age,1205,.069)+.10*ring(age,2368,.035)+.08*ring(age,3881,.012);
}
const assets={latch:{sampleRate:rate,channels:1,samples:latch},room:{sampleRate:rate,channels:2,samples:room}};
for (const [name,asset] of Object.entries(assets)) print(name+'-source',asset);
const mixes={};
for (const [mode,trim] of [['late',0],['aligned',slip]]) {
  const mixer={id:mode,sampleRate:rate,end:{seconds:duration},peakPolicy:'error',output:'master',
    strips:{relay:{clips:[{id:'strike',source:'latch',at:{seconds:1},fromSample:trim}],pan:.12,
      sends:{echo:{tap:'post',level:.19}}},room:{clips:[{id:'tone',source:'room'}]},echo:{inserts:['air']},master:{}},
    processors:{air:{type:'reverb',decay:.36,size:.58,damping:.56,wet:1}},
    taps:{relay:{strip:'relay'}}};
  mixes[mode]={mixer,assets:{latch:'latch-source.wav',room:'room-source.wav'}};
  json(path.join(out,mode+'-mixer.json'),mixes[mode]);
  const rendered=kit.KIT.procedural.mediaGraph.mixer.render(mixer,assets);
  print(mode+'-stem',rendered.taps.relay);
  print(mode+'-mix',rendered.value);
}
const picture={fps,frames:files};
const spec={format:'ink-studio/delivered-sync-check',version:1,picture,
  stems:{late:{file:'late-stem.wav'},aligned:{file:'aligned-stem.wav'}},
  checks:['late','aligned'].map(mode=>({id:mode,window:{from:17,to:35},scheduled:{frame:24,sample:48000},
    picture:{region:[162,111,33,13],separated:files[25],contact:files[26],maxError:.105,holdFrames:2},
    audio:{stem:mode},toleranceMs:25}))};
const recipe=path.join(out,'check.json');
json(recipe,spec);
const {report}=analyze(recipe,kit);
json(path.join(out,'sync-report.json'),report);
const [late,aligned]=report.checks;
if (late.status!=='audio-late' || aligned.status!=='in-sync' ||
    report.checks.some(row=>row.picture.hit?.frame!==26))
  throw new Error('Unexpected demo detection. See '+path.join(out,'sync-report.json'));
for (const mode of ['late','aligned']) {
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-framerate',String(fps),
    '-i',path.join(frameDir,'%04d.png'),'-i',path.join(out,mode+'-mix.wav'),'-vf','scale=720:408:flags=neighbor',
    '-c:v','libx264','-crf','16','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',
    path.join(out,mode+'.mp4')],{stdio:'inherit'});
}
function crop(frame) {
  const source=PNG.read(path.join(out,files[frame])), [x,y,w,h]=spec.checks[0].picture.region;
  const rgb=new Uint8Array(w*h*3);
  for (let row=0;row<h;row++) {
    const first=((row+y)*source.w+x)*3;
    rgb.set(source.rgb.subarray(first,first+w*3),row*w*3);
  }
  return PNG.encode(w,h,rgb).toString('base64');
}
const movies=Object.fromEntries(['late','aligned'].map(mode=>[mode,fs.readFileSync(path.join(out,mode+'.mp4')).toString('base64')]));
const data=Object.fromEntries(report.checks.map(({id,picture,audio,deltaMs,scheduled,status})=>
  [id,{picture:picture.hit,audio:audio.hit,deltaMs,scheduled,status}]));
const html=fs.readFileSync(path.join(__dirname,'review.html'),'utf8');
fs.writeFileSync(path.join(out,'relay-press-demo.html'),html.replace('/* RESULTS */ {}',JSON.stringify(data))
  .replace('/* MOVIES */ {}',JSON.stringify(movies))
  .replace('/* CROPS */ []',JSON.stringify([crop(late.picture.hit.frame-1),crop(late.picture.hit.frame)])));
