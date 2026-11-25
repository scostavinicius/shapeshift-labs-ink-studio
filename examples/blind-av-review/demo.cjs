/* Review the same Last Ferry take in three independent cohorts. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const WAV = require('../../cli/wav.js');
const { json,write } = require('../../cli/asset-files.js');
const Review = require('../../cli/blind-av-review.js');

const out = path.resolve(process.argv[2]??'last-ferry-blind');
const file = name=>path.join(out,name);
const kit = ink.load(), scene = require('../joint-load-priorities/scene.js')(kit);
const fps = 20, duration = 3.5, rate = 48000, arrival = 1.7;
fs.mkdirSync(file('source/picture'),{recursive:true});
const world = scene.build(scene.seed);
const frames = Array.from({length:fps*duration},(_,i)=>{
  const name = 'picture/'+String(i).padStart(4,'0')+'.png', t = i/fps;
  world.anim.update(0,t);
  const image = ink.render(world,{w:352,h:198,px:1,raw:true,t});
  PNG.write(file('source/'+name),image.w,image.h,image.rgb);
  return name;
});

const tau = 2*Math.PI;
let seed = 89331, wash = 0, grit = 0;
const noise = ()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2147483648-1);
const bed = new Float64Array(rate*duration*2), bell = new Float64Array(rate*1.7);
for (let i=0;i<rate*duration;i++) {
  const t = i/rate, sample = noise(), edge = Math.min(1,t*14,(duration-t)*12);
  wash += .023*(sample-wash);
  grit += .19*(sample-grit);
  bed[2*i] = edge*(.17*wash+.047*grit+.011*Math.sin(tau*63*t));
  bed[2*i+1] = edge*(.14*wash+.039*grit+.008*Math.sin(tau*64*t+.5));
}
const partials = [[513,.25,.52],[1011,.18,.38],[1597,.15,.18],[2497,.07,.067]];
for (let i=0;i<bell.length;i++) {
  const t = i/rate;
  for (const [start,gain] of [[0,1],[.34,.43],[.67,.16]]) {
    const age = t-start;
    if (age<0) continue;
    const fade = Math.min(1,age*2700,(bell.length-i)/(rate*.07));
    for (const [frequency,amplitude,decay] of partials)
      bell[i] += gain*amplitude*fade*Math.exp(-age/decay)*Math.sin(tau*frequency*age+.21);
  }
}
write(file('source/rain.wav'),WAV.encode({sampleRate:rate,channels:2,samples:bed},{encoding:'pcm24'}));
write(file('source/bell.wav'),WAV.encode({sampleRate:rate,channels:1,samples:bell},{encoding:'pcm24'}));
const dt = 1/40;
json(file('source/world.json'),{id:'last-ferry-blind',dt,commands:[
  {tick:Math.round(arrival/dt),action:'world/event',args:{kind:'audio-cue',cue:'bell',at:[0,0,-1.2]}}
]});
json(file('source/sound.json'),{format:'ink-studio/scene-audio',version:1,world:'world.json',
  assets:{rain:'rain.wav',bell:'bell.wav'},sampleRate:rate,
  tracks:[{asset:'rain',time:0,gain:.75}],spatial:{cues:{bell:{asset:'bell',distance:{rolloff:0}}}}});
const T = kit.KIT.procedural.takeTime;
const {waves} = ink.readSceneAudio(file('source/sound.json'),{kit}).render({startPoint:T.read(0),endPoint:T.read(duration)});
write(file('source/mix.wav'),waves.mix);
json(file('source/brief.json'),{...require('./brief.json'),picture:{fps,frames},audio:{file:'mix.wav'}});

const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const run = (...args)=>execFileSync(process.execPath,[cli,'take',...args],{encoding:'utf8'});
run('blind-review',file('source/brief.json'),'--out',file('pack'));
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
const key = read('pack/review-key.json');
const examples = {
  picture:[['swing','bell',3],['swing','unsure',2],['swing','bell',null]],
  sound:[['unsure','bell',4],['swing','bell',3],['gate','bell',4]],
  combined:[['swing','bell',5],['swing','bell',4],['swing','bell',5]]
};
fs.mkdirSync(file('illustrative-ballots'));
for (const {seat,mode,choices} of key.seats) {
  const [action,cause,impact] = examples[mode].shift();
  json(file('illustrative-ballots/'+seat+'.json'),{format:Review.ballotFormat,version:1,seat,session:key.session,
    completions:1,answers:{action:choices.action.indexOf(action)+1,cause:choices.cause.indexOf(cause)+1,impact}});
}
run('blind-review-score',file('pack/review-key.json'),file('illustrative-ballots'),'--out',file('illustrative-results'));
const report = read('illustrative-results/report.json');
assert.equal(report.received,9);
assert.deepEqual(report.cohorts.map(row=>[row.action.correct,row.cause.correct,row.impact.median]),
  [[3,2,2.5],[1,3,4],[3,3,5]]);
const samples = ['picture','sound','combined'].map(mode=>{
  const row = key.seats.find(seat=>seat.mode===mode);
  return {mode,html:fs.readFileSync(file('pack/'+row.file),'utf8')};
});
write(file('last-ferry-review-demo.html'),Review.page('results',{report,samples}));
write(file('try-a-blind-review.html'),samples[2].html);
console.log(file('last-ferry-review-demo.html'));
