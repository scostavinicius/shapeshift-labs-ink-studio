/* Run: node examples/music-production/pad-pattern-workshop.cjs output-directory */
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('../..'), kit=ink.load(), {padPattern,sampleCatalog}=kit.KIT.procedural.mediaGraph;
const {json}=require('../../cli/asset-files');
const folder=path.resolve(process.argv[2] ?? 'pad-pattern-workshop'), library=path.join(folder,'library');
const catalog=ink.openSampleLibrary(library,{kit});
const rate=32000, tau=2*Math.PI, frame=seconds=>Math.round(seconds*rate);
const wave=(seconds,signal)=>({sampleRate:rate,channels:1,samples:Float64Array.from({length:frame(seconds)},
  (_,i)=>signal(i/rate,i))});
const assets={};
function add(name,value,recorded=false) {
  const source=recorded ? {kind:'file',name:name+'.wav',reference:'examples/music-production/samples/CREDITS.md'} :
    {kind:'instrument',name};
  const sample={id:name,label:name,...(recorded && {license:{id:'CC0-1.0'}})};
  const {entry}=catalog.add(sampleCatalog.capture(value,{sample,source}));
  assets[name]={sample:name,asset:entry.asset};
}
for (const name of ['snare-main','snare-alt','snare-ghost','snare-rim','hat-closed','hat-closed-alt',
  'metal-hit','metal-soft','metal-alt']) add(name,ink.readWav(path.join(__dirname,'samples',name+'.wav')),true);
add('kick',wave(.28,(t,i)=>{
  const phase=52*t+71*(1-Math.exp(-40*t))/40;
  return Math.min(1,t*1500)*(.87*Math.sin(tau*phase)*Math.exp(-t*18)+.12*Math.sin(i*1.77)*Math.exp(-t*100));
}));
add('bass',wave(.48,t=>{
  const phase=87.30706*t+.009*Math.sin(tau*2.7*t);
  const bite=(.19*Math.sin(tau*phase*2)+.085*Math.sin(tau*phase*3+.4))*Math.exp(-t*3);
  return Math.min(1,t/.01)*(.58*Math.sin(tau*phase)+bite);
}));

const layer=(id,...names)=>({id,takes:names.map(asset=>({asset}))});
const pad=(layers,properties={})=>({...properties,articulations:{default:layers}});
const sampler={id:'relay-logic',pads:{
  kick:pad([layer('low','kick')],{gain:-4,attack:0,inserts:[{type:'drive',amount:1.4,mix:.18}]}),
  snare:pad([{...layer('ghost','snare-ghost'),velocity:[0,0,.40,.68],gain:1.5},
    {...layer('stick','snare-main','snare-alt'),velocity:[.40,.68,1,1]}],{
    attack:0,gain:-5,pan:.04,inserts:[{type:'highpass',hz:100}],sends:{chamber:.16}
  }),
  hat:pad([layer('metal','hat-closed','hat-closed-alt')],{attack:0,release:.012,gain:-9,
    inserts:[{type:'highpass',hz:700}]}),
  relay:pad([layer('strikes','metal-hit','metal-soft','metal-alt')],{
    attack:.001,release:.026,gain:-7,pan:.02,inserts:[{type:'highpass',hz:160},{type:'drive',amount:1.42,mix:.28}]
  }),
  bass:pad([{id:'sine-body',takes:[{asset:'bass',root:'F2',loop:{from:frame(.162),to:frame(.391),crossfade:frame(.029)}}]}],{
    gated:true,attack:.004,release:.055,gain:-8,inserts:[{type:'lowpass',hz:1060}]
  })
},buses:{
  chamber:{gain:-5,inserts:[{type:'delay',seconds:.069,feedback:.34,mix:1},{type:'lowpass',hz:2600}]},
  echo:{gain:-2,pan:.18,inserts:[{type:'delay',seconds:.377,feedback:.48,mix:1},{type:'lowpass',hz:2450}]}
}};
sampler.pads.snare.articulations.rim=[layer('edge','snare-rim','snare-ghost')];

const hit=(id,beat,pad,velocity,rest={})=>({id,beat,pad,velocity,...rest});
const pattern={id:'relay-logic',seed:61,length:4,steps:[
  hit('down',0,'kick',.91),hit('low-ghost',.77,'kick',.38,{when:{every:2,phase:0}}),
  hit('kick-push',1.78,'kick',.61),hit('kick-answer',2.48,'kick',.77),
  hit('snare-a',1,'snare',.79,{offset:.011}),hit('snare-b',3,'snare',.83,{offset:.014}),
  hit('rim-ghost',2.72,'snare',.36,{articulation:'rim',play:{pan:.16,filter:{type:'lowpass',hz:2300}}}),
  ...[.5,1.5,2,2.5,3.5,3.78].map((beat,i)=>hit('hat-'+i,beat,'hat',[.62,.51,.33,.58,.65,.34][i],{
    play:{pan:i%2===0 ? -.24 : .38,tune:i%2===0 ? 80 : -190,
      filter:{type:'lowpass',hz:i%2===0 ? 9500 : 5100}},gate:i%2===0 ? .16 : .1
  })),
  hit('bass-f',0,'bass',.83,{note:'F2',gate:.81}),hit('bass-f-again',1.68,'bass',.73,{note:'F2',gate:.28}),
  hit('bass-ab',2.38,'bass',.77,{note:'Ab2',gate:.42}),
  hit('bass-eb',3.26,'bass',.71,{note:'Eb2',gate:.49,when:{fill:false}}),
  hit('relay-call',.31,'relay',.57,{when:{every:2,phase:0},gate:.38,
    play:{sample:'metal-hit',tune:-420,pan:-.28,sends:{echo:.36}}}),
  hit('relay-answer',1.24,'relay',.64,{when:{every:2,phase:1},gate:.14,
    play:{sample:'metal-alt',startSample:280,tune:540,pan:.56,sends:{echo:.55}}}),
  hit('relay-chance',2.18,'relay',.45,{when:{chance:.48},gate:.3,
    play:{sample:'metal-soft',tune:-180,pan:-.5,filter:{type:'lowpass',hz:2800},sends:{chamber:.41}}}),
  hit('fill-pickup',2.88,'relay',.67,{when:{fill:true},gate:.17,
    play:{sample:'metal-alt',tune:290,pan:.5,sends:{chamber:.35}}})
],fills:[
  {id:'turnaround',from:3.25,to:4,steps:[
    hit('rim-roll',3.25,'snare',.78,{articulation:'rim',gate:.065,
      play:{sample:'snare-rim',filter:{type:'highpass',hz:420},pan:-.18,sends:{chamber:.38}},
      roll:{count:6,spacing:.125,velocity:[.57,1.16],tune:[400,-520]}}),
    hit('kick-fill',3.74,'kick',.84,{gate:.17})
  ]},
  {id:'release',from:3,to:4,mode:'add',steps:[
    hit('relay-roll',3.25,'relay',.71,{gate:.105,play:{
      sample:'metal-alt',startSample:92,filter:{type:'lowpass',hz:3800},pan:-.25,sends:{echo:.49}
    },roll:{count:6,spacing:.125,velocity:[.63,1.14],tune:[550,-560]}})
  ]}
]};
const settings={cycles:8,fills:[{cycle:3,id:'turnaround'},{cycle:7,id:'release'}],
  render:{sampleRate:rate,map:{tempo:121,swing:.557},duration:17.3}};
const edits=[
  {op:'set',id:'p3-rim-roll-4',changes:{play:{sample:'snare-ghost',tune:-750,pan:.85,sends:{echo:.72}}}},
  {op:'set',id:'p7-relay-roll-5',changes:{play:{sample:'metal-hit',startSample:330,tune:-1080,
    pan:.84,filter:{type:'lowpass',hz:1650},sends:{echo:.84}}}}
];
const at=name=>path.join(folder,name);
for (const [name,value] of Object.entries({'kit.json':{kit:sampler,assets},'pattern.json':pattern,
  'run.json':settings,'edits.json':edits})) json(at(name),value);
const cli=(...args)=>execFileSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),'music',...args],{encoding:'utf8'});
cli('pads','program',at('pattern.json'),at('run.json'),'--out',at('captured.json'));
cli('pads','edit',at('captured.json'),at('edits.json'),'--out',at('revised.json'));
const take=name=>JSON.parse(cli('samples','kit',library,at('kit.json'),at(name+'.json'),'--out',at(name)));
const original=take('captured'), revised=take('revised');
json(at('pattern-report.json'),padPattern.perform(pattern,settings).report);
console.log(JSON.stringify({original,revised},null,2));
