/* Last Ferry. Print the same storm with and without one joint priority window. */
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('../..'),PNG=require('../../cli/png.js'),WAV=require('../../cli/wav.js');
const {write,json}=require('../../cli/asset-files.js');
const kit=ink.load(),K=kit.KIT,T=K.procedural.takeTime, scene=require('./scene.js')(kit), packet=require('./priority.json');
const folder=path.resolve(process.argv[2]??'last-ferry-review');
const out=file=>path.join(folder,file), rate=48000, fps=20, duration=3.5, strike=1.7, dt=.025;
const tau=2*Math.PI, window=packet.windows[0];
fs.mkdirSync(folder,{recursive:true});
fs.copyFileSync(path.join(__dirname,'scene.js'),out('scene.js'));
json(out('priority.json'),packet);
let seed=89331;
const noise=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2147483648-1);
function make(name,duration,channels,draw){
  const count=Math.round(duration*rate), samples=new Float64Array(count*channels);
  for(let i=0;i<count;i++)for(let ch=0;ch<channels;ch++)samples[i*channels+ch]=draw(i/rate,ch);
  write(out(name+'.wav'),WAV.encode({channels,sampleRate:rate,samples},{encoding:'pcm24'}));
  return name+'.wav';
}
let wash=0, droplet=0;
const assets={
  wash:make('wash',duration,2,(t,ch)=>{
    const grain=noise();
    wash+=.031*(grain-wash);
    droplet+=.21*(grain-droplet);
    const envelope=Math.min(1,t*10,(duration-t)*10);
    return envelope*(.073*wash+.022*droplet+.015*Math.sin(tau*62*t+ch*.13));
  }),
  rain:make('canopy',.22,1,t=>{
    const envelope=Math.min(1,t*850)*Math.exp(-t/.061);
    return envelope*(.074*noise()+.059*Math.sin(tau*(204*t-23*t*t))+.021*Math.sin(tau*578*t));
  }),
  shoe:make('boots',.24,1,t=>{
    const envelope=Math.min(1,t*640)*Math.exp(-t/.054);
    return envelope*(.039*noise()+.093*Math.sin(tau*(102*t-120*t*t))+.049*Math.sin(tau*181*t));
  }),
  bell:make('brass-bell',.65,1,t=>Math.exp(-t/.48)*
    (.119*Math.sin(tau*513*t+.61)*Math.exp(-t/.37)+.125*Math.sin(tau*1011*t+.44)*Math.exp(-t/.33)+
     .105*Math.sin(tau*1597*t+.28)*Math.exp(-t/.13)+.075*Math.sin(tau*2497*t+.17)*Math.exp(-t/.051)))
};
const distance={rolloff:0}, cues={
  rain:{asset:'rain',priority:22,group:'rain',distance},
  boot:{asset:'shoe',priority:18,group:'crowd',distance},
  bell:{asset:'bell',priority:-8,group:'hardware',distance}
};
const commands=[];
function cue(tick,name,x,gain,pitch=1){
  commands.push({tick,action:'world/event',args:{kind:'audio-cue',cue:name,at:[x,0,-1.4],gain,pitch}});
}
for(let tick=3;tick<136;tick+=3){
  for(let i=0;i<3;i++)cue(tick+i%2,'rain',(i-1)*1.8+.34*noise(),.63+.17*noise(),.97+.23*noise());
  for(let i=0;i<3;i++)cue(tick+i%2,'boot',(i-1)*1.3+.27*noise(),.65+.15*noise(),.92+.20*noise());
}
cue(strike/dt,'bell',0,1);
commands.sort((a,b)=>a.tick-b.tick);
json(out('world.json'),{id:'last-ferry',dt,commands});
const source={format:'ink-studio/scene-audio',version:1,world:'world.json',assets,sampleRate:rate,gain:.87,
  tracks:[{asset:'wash',time:0,gain:.86}],spatial:{cues,voiceBudget:{maxVoices:4,reservedVoices:0,stealFade:.008}}};
const world=scene.build(scene.seed), span={startPoint:T.read(0),endPoint:T.read(duration)};
const movies={}, metrics={};
for(const [mode,track] of [['ordinary',false],['protected',packet]]){
  const dir=out(mode), frames=path.join(dir,'frames');
  fs.mkdirSync(frames,{recursive:true});
  const settings={...source,spatial:{...source.spatial,...(track&&{jointPriority:'priority.json'})}};
  json(out(mode+'.json'),settings);
  const {waves,report}=ink.readSceneAudio(out(mode+'.json'),{kit}).render(span,{trace:true});
  const wave=path.join(dir,'mix.wav');
  write(wave,waves.mix);
  const bell=report.voiceBudget.decisions.find(row=>row.cue==='bell');
  if(bell.action!==(track?'admitted':'dropped'))throw new Error('Demo does not stress the bell voice as authored');
  const tSample=1.85;
  world.anim.update(0,tSample);
  const check=ink.render(world,{w:352,h:198,px:1,raw:true,t:tSample,jointPriority:track,renderStats:true});
  PNG.write(path.join(dir,'still.png'),check.w,check.h,check.rgb);
  metrics[mode]={rows:check.renderStats.splatRows,fragments:check.renderStats.fragments,particleRowsSkipped:check.renderStats.omittedParticleRows,
    backgroundRowsSkipped:check.renderStats.omittedBackgroundRows,bell,backgroundSlots:track?1:4,
    priorityWindows:report.voiceBudget.priorityWindows??[]};
  for(let i=0;i<duration*fps;i++){
    const t=i/fps, file=String(i).padStart(4,'0')+'.png';
    if(track&&(t<window.from||t>=window.to)){
      fs.copyFileSync(path.join(out('ordinary'),'frames',file),path.join(frames,file));
      continue;
    }
    world.anim.update(0,t);
    const frame=ink.render(world,{w:352,h:198,px:1,raw:true,t,jointPriority:track});
    PNG.write(path.join(frames,file),frame.w,frame.h,frame.rgb);
  }
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-framerate',String(fps),'-i',path.join(frames,'%04d.png'),
    '-i',wave,'-vf','scale=704:396:flags=neighbor','-c:v','libx264','-crf','17','-pix_fmt','yuv420p',
    '-c:a','aac','-b:a','192k','-movflags','+faststart',out(mode+'.mp4')]);
  movies[mode]=fs.readFileSync(out(mode+'.mp4')).toString('base64');
}
for(const mode of ['ordinary','protected'])fs.rmSync(path.join(out(mode),'frames'),{recursive:true});
if(metrics.protected.fragments>=metrics.ordinary.fragments || metrics.protected.particleRowsSkipped<1200)
  throw new Error('Demo did not lower rain work while protecting the bell');
const report={duration,strike,window:{from:window.from,to:window.to},metrics};
json(out('comparison.json'),report);
const template=fs.readFileSync(path.join(__dirname,'review.html'),'utf8');
write(out('last-ferry-demo.html'),template.replace('/* REPORT */ {}',JSON.stringify(report))
  .replace('/* MOVIES */ {}',JSON.stringify(movies)));
