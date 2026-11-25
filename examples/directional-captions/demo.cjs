/* Pump House. Caption the sound delivered by one native world recording. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {KIT} = require('../..').load();
const WAV = require('../../cli/wav.js');
const {json,write} = require('../../cli/asset-files.js');

const out = path.resolve(process.argv[2]??'pump-house-captions');
const file = name=>path.join(out,name);
const rate = 32000, dt = .05, duration = 7.45, tau = 2*Math.PI;
let seed = 4019, drift = 0;
function noise() {
  seed = (Math.imul(seed,1664525)+1013904223)>>>0;
  return seed/2147483648-1;
}
function wav(name,length,render) {
  const samples = Float32Array.from({length:Math.round(length*rate)},(_,i)=>render(i/rate));
  const nameInPack = 'assets/'+name+'.wav';
  write(file(nameInPack),WAV.encode({sampleRate:rate,channels:1,samples},{encoding:'pcm24'}));
  return nameInPack;
}
function strike(t,partials,grit=0) {
  const tone = partials.reduce((sum,[gain,hz,decay])=>sum+gain*Math.sin(tau*hz*t)*Math.exp(-decay*t),0);
  return Math.min(1,t*1100)*(tone+grit*noise()*Math.exp(-42*t));
}
const assets = {
  stepA:wav('step-a',.11,t=>strike(t,[[.38,92,31],[.21,234,44]],.21)),
  stepB:wav('step-b',.12,t=>strike(t,[[.38,86,32],[.21,201,48]],.22)),
  duct:wav('duct',.84,t=>strike(t,[[.25,181,9],[.18,419,14],[.13,962,22]],.24)+
    (t>.112?.53*strike(t-.112,[[.25,194,11],[.18,435,17]],.18):0)),
  bell:wav('bell',.92,t=>strike(t,[[.31,551,6],[.24,912,9],[.17,1667,12],[.1,2293,23]])),
  cart:wav('cart',1.9,t=>{
    drift+=.23*(noise()-drift);
    return Math.sin(Math.PI*t/1.9)**.7*(.115*Math.sin(tau*(127*t+7*t*t))+.28*drift)*(.72+.28*Math.sin(tau*19*t));
  }),
  spanner:wav('spanner',.52,t=>strike(t,[[.24,270,12],[.24,703,19]],.16)),
  room:wav('room',duration,t=>{
    drift+=.013*(noise()-drift);
    return Math.min(1,t*8,(duration-t)*7)*(.035*Math.sin(tau*51*t)+.024*Math.sin(tau*66*t)+.13*drift);
  })
};
const event = (tick,cue,at)=>({tick,action:'world/event',args:{kind:'audio-cue',cue,at}});
const gate = (tick,value)=>({tick,action:'world/input',args:{port:'air/opening.hatch',value}});
const world = {format:'ink-studio/world',version:1,id:'pump-house',dt,
  entities:{ear:{position:[-2,1,0]},cart:{position:[-13,1,0]}},
  systems:{
    air:{kind:'ventilation',config:{
      rooms:{
        hall:{bounds:{min:[-5,-1,-4],max:[0,5,4]}},
        pumps:{bounds:{min:[0,-1,-4],max:[6,5,4]}}
      },
      openings:{hatch:{from:'hall',to:'pumps',at:[0,1,-.2]}}
    }},
    acoustics:{kind:'acoustics',config:{layout:'air/acoustic-layout',openings:{hatch:{sealed:true}}}}
  },
  commands:[
    event(15,'step-a',[-2,1,2]),event(18,'step-b',[-2,1,1.7]),event(21,'step-a',[-2,1,1.4]),
    event(42,'duct',[-2,3.6,0]),event(70,'bell',[3.5,1,1.4]),
    event(70,'spanner',[-2,1,1.8]),
    gate(92,0),event(99,'bell',[3.5,1,1.4]),
    event(104,'cart',{entity:'cart'}),
    {tick:117,action:'world/patch',args:{edits:[{op:'set',path:'/entities/cart/position',value:[-4.4,1,-.15]}]}}
  ]};
const audio = {format:'ink-studio/scene-audio',version:1,sampleRate:rate,assets,post:{},gain:.86,
  listener:{entity:'ear'},tracks:[{asset:'room',bus:'ambience',gain:.7}],
  spatial:{distance:{reference:2,max:8,fade:.3},propagationDelay:true,occlusion:{acoustic:'acoustics/audible'},
    voiceBudget:{maxVoices:2,reservedVoices:1,stealFade:.01},
    cues:{'step-a':{asset:'stepA',bus:'foley'},'step-b':{asset:'stepB',bus:'foley'},
      duct:{asset:'duct',bus:'effects',gain:.65},bell:{asset:'bell',bus:'effects',gain:.9,protected:true},
      cart:{asset:'cart',bus:'foley',follow:true},
      spanner:{asset:'spanner',bus:'foley',gain:.1,priority:-12,group:'discard'} }}};
audio.spatial.voiceBudget.groups={discard:0};
json(file('world.json'),world);
json(file('soundtrack.json'),audio);
json(file('plan.json'),require('./plan.json'));
const run = KIT.world.runtime.create(world);
run.advance(Math.round(duration/dt));
json(file('world.run.json'),run.recording());
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const command = (...args)=>execFileSync(process.execPath,[cli,'story',...args],{cwd:out,encoding:'utf8'});
command('audio','world.run.json','soundtrack.json','--out','mix');
command('audio-captions','mix/playback.json','plan.json','--out','caption-track');
const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
const ledger = read('mix/playback.json'), track = read('caption-track/captions.json');
assert.deepEqual(track.captions.map(({rule,count,direction,opening})=>[rule,count,direction,opening]),[
  ['steps',3,'behind',null],['duct',1,'above',null],['bell',1,'right','hatch'],['cart',1,'left',null]
]);
assert(ledger.receipts.some(row=>row.cue==='bell'&&row.outcome==='muted'&&row.reason==='blocked'));
assert(ledger.receipts.some(row=>row.cue==='spanner'&&row.outcome==='dropped'));
assert(ledger.receipts.some(row=>row.cue==='cart'&&row.outcome==='late'));
const model = {track,receipts:ledger.receipts,
  audio:fs.readFileSync(file('mix/mix.wav')).toString('base64'),
  wave:fs.readFileSync(file('caption-track/captions.vtt'),'utf8')};
const page = fs.readFileSync(path.join(__dirname,'review.html.template'),'utf8')
  .replace('/* MODEL */ {}',()=>JSON.stringify(model).replace(/</g,'\\u003c'));
write(file('pump-house-captions.html'),page);
console.log(file('pump-house-captions.html'));
