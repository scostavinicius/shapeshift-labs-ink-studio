const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const ink=require('../..'), kit=ink.load(), {KIT:K}=kit, W=K.world, T=K.procedural.takeTime;
const WAV=require('../../cli/wav.js');
const {write,json}=require('../../cli/asset-files.js');
const {renderPreview}=require('./preview.cjs');
const [archive,out,chrome=process.env.INK_TEST_CHROME]=process.argv.slice(2);
if(!archive||!out||!chrome)throw Error('Use node examples/pinned-binaural/demo.cjs <KEMAR compact.zip> <output directory> <Chrome executable>');

const credit='Bill Gardner and Keith Martin, HRTF Measurements of a KEMAR Dummy-Head Microphone, MIT Media Laboratory, 1994.';
const sourceURL='https://sound.media.mit.edu/resources/KEMAR.html';
const directions=[];
for(const elevation of [-30,0,30,60,90])for(let azimuth=0;azimuth<=(elevation===90?0:180);azimuth+=30){
  const name=`elev${elevation}/H${elevation}e${String(azimuth).padStart(3,'0')}a.wav`;
  const ir=WAV.decode(execFileSync('unzip',['-p',archive,name]));
  assert.equal(ir.sampleRate,44100);
  assert.equal(ir.samples.length,256);
  const left=Array.from({length:128},(_,i)=>ir.samples[i*2]), right=left.map((_,i)=>ir.samples[i*2+1]);
  directions.push({azimuth,elevation,left,right});
  if(azimuth>0&&azimuth<180)directions.push({azimuth:-azimuth,elevation,left:right,right:left});
}
const binauralProfile={format:'ink-studio/binaural-profile',version:1,id:'mit-kemar-compact-49',sampleRate:44100,
  transition:.012,credit,directions};
const profile=JSON.stringify(binauralProfile), sha256=createHash('sha256').update(profile).digest('hex'), profileFile='mit-kemar-compact-49.json';
write(path.join(out,profileFile),profile);
write(path.join(out,'KEMAR-ATTRIBUTION.txt'),credit+'\nCopyright 1994 MIT Media Laboratory. Use requires author citation.\n'+sourceURL+'\n');

const rate=48000, dt=.032, duration=7.36, listener=[0,1.6,0];
const cues=[
  {tick:12,name:'Front',azimuth:0,elevation:0},
  {tick:42,name:'Front left',azimuth:-45,elevation:0},
  {tick:72,name:'Left',azimuth:-90,elevation:0},
  {tick:102,name:'Behind',azimuth:180,elevation:0},
  {tick:132,name:'Right',azimuth:90,elevation:0},
  {tick:162,name:'High right',azimuth:65,elevation:47},
  {tick:192,name:'Above',azimuth:0,elevation:90}
].map(({tick,name,azimuth,elevation})=>{
  const a=azimuth*Math.PI/180, e=elevation*Math.PI/180;
  return {tick,time:tick*dt,name,azimuth,elevation,at:[2*Math.sin(a)*Math.cos(e),1.6+2*Math.sin(e),-2*Math.cos(a)*Math.cos(e)]};
});
const commands=cues.map(({tick,at})=>({tick,action:'world/event',args:{kind:'audio-cue',cue:'relay',at}}));
const manifest={id:'signal-room',dt,commands};
const spatial={cues:{relay:{asset:'relay',gain:.76,distance:{rolloff:0}}}};
const scene={format:'ink-studio/scene-audio',version:1,sampleRate:rate,listener,spatial};
const soundtrack={...scene,world:'world.json',assets:{relay:'relay.wav'},spatial:{...spatial,binauralProfile:{file:profileFile,sha256}}};
json(path.join(out,'world.json'),manifest);
json(path.join(out,'soundtrack.json'),soundtrack);

const reverbFree=K.procedural.mediaGraph.synthesizeGesture({model:'metal',seed:81,duration:.36,sampleRate:rate,
  parameters:{body:312,hardness:.87,decay:.17,strike:.55}}).value;
// A short broadband contact makes the pinna differences audible on the same source take.
const samples=reverbFree.samples.slice();
let seed=112;
for(let i=0;i<rate*.026;i++){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  samples[i]+=(seed/2147483648-1)*.16*Math.exp(-i/340);
}
const sourceBytes=WAV.encode({...reverbFree,samples},{encoding:'pcm24'});
write(path.join(out,'relay.wav'),sourceBytes);
const source=WAV.decode(sourceBytes);
const interval={startPoint:T.read(0),endPoint:T.read(duration)};
const env={kit,runtime:()=>W.runtime.create(manifest),resolveAsset:()=>source};
const pinned=ink.readSceneAudio(path.join(out,'soundtrack.json'),{kit});
const printed=pinned.render(interval), simple=ink.createSceneAudio(scene,env).render(interval);
assert.equal(printed.report.binauralProfile.sha256,sha256);
assert.equal(printed.report.headroom,1,'Comparison should have no master scaling');

async function demo(){
  const planner=W.spatialAudio.create({...spatial,binauralProfile:pinned.binauralProfile}), run=W.runtime.create(manifest);
  const frameAt=time=>{
    const {binauralProfile,...frame}=planner.frame({time,query:run.query(),listener,events:run.events});
    return frame;
  };
  const frames=[frameAt(0)];
  for(const {tick,time} of cues){run.advance(tick);frames.push(frameAt((Math.round(time*rate)+.25)/rate));}
  const length=Math.round(duration*rate);
  const preview=await renderPreview(chrome,{rate,length,frames,source:Array.from(source.samples),profile,sha256});
  const offline=WAV.decode(printed.waves.mix).samples;
  let delta=0, squared=0;
  for(let i=0;i<offline.length;i++){
    const diff=offline[i]-preview[i];delta=Math.max(delta,Math.abs(diff));squared+=diff*diff;
  }
  assert.equal(preview.length,offline.length);
  assert(delta<2e-7,`Browser and headless render differ by ${delta}`);
  const browserBytes=WAV.encode({samples:preview,channels:2,sampleRate:rate},{encoding:'pcm24'});
  write(path.join(out,'preview.wav'),browserBytes);
  write(path.join(out,'export.wav'),printed.waves.mix);
  write(path.join(out,'stereo-pan.wav'),simple.waves.mix);
  const statistics={profile:printed.report.binauralProfile,rate,frames:length,
    peakSampleDelta:delta,rmsSampleDelta:Math.sqrt(squared/offline.length)};
  json(path.join(out,'comparison.json'),{...statistics,cues});
  const audio=bytes=>'data:audio/wav;base64,'+bytes.toString('base64');
  const template=fs.readFileSync(path.join(__dirname,'review.html'),'utf8');
  const audition={duration,cues,statistics,credit,sourceURL,
    clips:{preview:audio(browserBytes),offline:audio(printed.waves.mix),stereo:audio(simple.waves.mix)}};
  write(path.join(out,'index.html'),template.replace('/*INK_BINAURAL_DEMO*/',()=>JSON.stringify(audition).replaceAll('<','\\u003c')));
  console.log(JSON.stringify(statistics,null,2));
}
demo().catch(error=>{console.error(error.stack);process.exitCode=1;});
