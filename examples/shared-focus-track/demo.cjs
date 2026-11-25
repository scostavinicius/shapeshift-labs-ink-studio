/* Run with Node from an Ink checkout. FFmpeg encodes the comparison copies. */
const fs=require('node:fs'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('../..'), PNG=require('../../cli/png.js'), WAV=require('../../cli/wav.js');
const kit=ink.load(), focus=require('./focus.json'), scene=require('./scene.js')(kit);
const root=path.resolve(__dirname,'../..');
const out=path.resolve(process.argv[2] ?? 'harbor-latch-review');
const fps=16, duration=6, rate=48000, count=duration*rate;
fs.mkdirSync(path.join(out,'stems'),{recursive:true});
for (const name of ['mixer.json','scene.js','focus.json','demo.cjs','review.html'])
  fs.copyFileSync(path.join(__dirname,name),path.join(out,name));

const tau=2*Math.PI, sat=x=>Math.max(0,Math.min(1,x));
function random(seed) {
  return ()=>{
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    return seed/2147483648-1;
  };
}
function filtered(seed) {
  const noise=random(seed);
  let slow=0,mid=0,high=0;
  return ()=>{
    const current=noise();
    slow+=.012*(current-slow);
    mid+=.071*(current-mid);
    high+=.31*(current-high);
    return [slow,mid,high];
  };
}
function scrape(t,start,end) {
  if(t<=start || t>=end) return 0;
  return Math.sin(Math.PI*(t-start)/(end-start))**1.7;
}
function ring(t,start,modes) {
  const age=t-start;
  if (age<0) return 0;
  return sat(age*2400)*modes.reduce((sum,[hz,amplitude,decay])=>
    sum+amplitude*Math.exp(-age/decay)*Math.sin(tau*hz*age),0);
}
const bed=[filtered(642),filtered(78)], air=filtered(31), near=filtered(476);
const harbor=new Float32Array(count*2), cloth=new Float32Array(count), metal=new Float32Array(count);
for (let i=0;i<count;i++) {
  const t=i/rate, border=sat(t/.1)*sat((duration-t)/.16);
  const [shared,drift]=air(), [low,mid,high]=near();
  const swell=.56+.21*Math.sin(tau*.37*t+.62)+.19*Math.sin(tau*.71*t-.63);
  for (let ch=0;ch<2;ch++) {
    const [sea,foam,hiss]=bed[ch]();
    const beacon=ring(t,4.45+ch*.021,[[256,.048,.34],[381,.026,.29],[653,.014,.47]])+
      ring(t,5.11+ch*.018,[[256,.029,.27],[527,.012,.38]]);
    harbor[2*i+ch]=border*(swell*(.63*sea+.30*foam+.075*hiss)+.27*shared+.10*drift+
      .023*Math.sin(tau*74*t+ch*.42+.26*Math.sin(tau*.7*t))+.82*beacon);
  }
  const folds=scrape(t,.60,2.36)*(.64+.22*Math.sin(tau*9*t)*Math.sin(tau*5.56*t))+
    .49*scrape(t,3.34,4.38);
  cloth[i]=folds*(.31*low+.22*mid+.105*high);
  const drag=scrape(t,2.70,3.16)*(.5+.5*Math.sin(tau*(35*t+1.2*Math.sin(tau*1.17*t))));
  metal[i]=drag*(.16*mid+.16*(high-mid))+
    ring(t,2.72,[[913,.032,.08],[1973,.021,.06],[2771,.019,.034]])+
    ring(t,3.16,[[586,.055,.16],[1199,.061,.18],[1877,.063,.14],[3043,.037,.088],[4141,.018,.039]]);
}
for (const [name,samples,channels] of [['harbor',harbor,2],['cloth',cloth,1],['metal',metal,1]])
  fs.writeFileSync(path.join(out,'stems',name+'.wav'),WAV.encode({samples,channels,sampleRate:rate},{encoding:'pcm24'}));

const play=kit.KIT.procedural.focusTrack;
const world=scene.build(scene.seed);
for (const [mode,track] of [['directed',focus],['bypass',false]]) {
  const folder=path.join(out,mode), frames=path.join(folder,'frames');
  fs.mkdirSync(frames,{recursive:true});
  execFileSync(process.execPath,[path.join(root,'cli/ink-studio.js'),'music','mix','render',path.join(out,'mixer.json'),
    '--focus-track',track ? path.join(out,'focus.json') : 'off','--out',folder],{stdio:'inherit'});
  for (let i=0;i<duration*fps;i++) {
    const t=i/fps;
    world.anim.update(0,t);
    const frame=ink.render(world,{w:672,h:378,px:2,t,raw:true,focusTrack:track});
    PNG.write(path.join(frames,String(i).padStart(4,'0')+'.png'),frame.w,frame.h,frame.rgb);
  }
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-framerate',String(fps),
    '-i',path.join(frames,'%04d.png'),'-i',path.join(folder,'mix.wav'),'-vf','scale=672:378:flags=neighbor',
    '-c:v','libx264','-crf','17','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',
    path.join(out,mode+'.mp4')],{stdio:'inherit'});
  fs.rmSync(frames,{recursive:true});
}
const plan=play.prepare(focus);
const cues=plan.cues.map(cue=>({start:cue.start,end:cue.end,subject:cue.to?.id ?? 'scene'}));
const source=fs.readFileSync(path.join(__dirname,'review.html'),'utf8');
const movies=Object.fromEntries(['directed','bypass'].map(mode=>
  [mode,fs.readFileSync(path.join(out,mode+'.mp4')).toString('base64')]));
fs.writeFileSync(path.join(out,'harbor-latch-demo.html'),source
  .replace('/* CUES */ []',JSON.stringify(cues))
  .replace('/* MOVIES */ {}',JSON.stringify(movies)));
world.anim.update(0,3.125);
const preview=ink.render(world,{w:672,h:378,px:2,t:3.125,raw:true,focusTrack:focus});
const large=require('../../cli/render.js').upscale(preview,2);
PNG.write(path.join(out,'harbor-latch-preview.png'),large.w,large.h,large.rgb);
