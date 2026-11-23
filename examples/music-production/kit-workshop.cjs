/* Run: node examples/music-production/kit-workshop.cjs output-directory */
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('../..'), kit=ink.load(), A=kit.KIT.procedural.mediaGraph;
const {json}=require('../../cli/asset-files.js');
const sampleRate=32000, tau=2*Math.PI, frame=seconds=>Math.round(seconds*sampleRate);
const folder=path.resolve(process.argv[2] ?? 'kit-workshop');
const library=ink.openSampleLibrary(path.join(folder,'library'),{kit});

function wave(seconds,signal) {
  return {sampleRate,channels:1,samples:Float64Array.from({length:frame(seconds)},(_,i)=>signal(i/sampleRate,i))};
}
function store(id,label,value,source,material) {
  return library.add(A.sampleCatalog.capture(value,{
    sample:{id,label,material,...(source.kind==='file' && {license:{id:'CC0-1.0'}})},source
  })).entry;
}

const cuts=['snare-ghost','snare-main','snare-alt','snare-rim','hat-closed','hat-closed-alt','hat-open','metal-soft'];
const parts=cuts.map(name=>ink.readWav(path.join(__dirname,'samples',name+'.wav')));
const track=wave(parts.reduce((length,a)=>length+a.samples.length/sampleRate+.015,0),()=>0);
const marks=[];
let offset=0;
for (const [i,name] of cuts.entries()) {
  marks.push({op:'add',id:name,at:offset});
  track.samples.set(parts[i].samples,offset);
  offset+=parts[i].samples.length+frame(.015);
}
const drumEntry=store('drum-strip','Versilian drum and metal slices',track,
  {kind:'file',name:'VCSL segments',reference:'examples/music-production/samples/CREDITS.md'},'acoustic percussion');
const edit=A.sampleEdit.edit(A.sampleEdit.create(track,{source:{id:drumEntry.id,asset:drumEntry.asset}}),marks);
json(path.join(folder,'drum-strip.json'),edit);
const assets=Object.fromEntries(cuts.map(name=>[name,{edit:'drum-strip.json',slice:name}]));

const grain=(i,salt)=>((Math.sin((i+salt)*91.731)*47381.13)%1);
const generated={
  kick:wave(.35,(t,i)=>{
    const phase=49*t+71*(1-Math.exp(-t*48))/48;
    return Math.min(1,t*1700)*(.9*Math.sin(tau*phase)*Math.exp(-t*13)+.13*grain(i,17)*Math.exp(-t*105));
  }),
  reed:wave(.64,(t,i)=>{
    const root=261.625565, phase=root*t+.11*Math.sin(tau*3.1*t);
    const env=Math.min(t/.046,1)*(.83+.07*Math.sin(tau*4.7*t));
    const partials=.46*Math.sin(tau*phase)+.09*Math.sin(tau*2*phase+.3)+.085*Math.sin(tau*3*phase)+
      .054*Math.sin(tau*5*phase+.37)+.034*Math.sin(tau*7*phase);
    return env*(partials+.044*grain(i,141)*Math.exp(-t*10));
  }),
  'key-off':wave(.16,(t,i)=>Math.min(t*1900,1)*(.25*grain(i,57)*Math.exp(-t*48)+
    .19*Math.sin(tau*448*t)*Math.exp(-t*34)+.11*Math.sin(tau*183*t)*Math.exp(-t*54))),
  bass:wave(.52,(t,i)=>{
    const phase=65.4064*t+.003*Math.sin(tau*3.3*t);
    const edge=(.13*Math.sin(tau*2*phase)+.065*Math.sin(tau*3*phase))*Math.exp(-t*3);
    return Math.min(t/.012,1)*(.64*Math.sin(tau*phase)+edge+.034*grain(i,151)*Math.exp(-t*22));
  })
};
for (const [name,value] of Object.entries(generated)) {
  const entry=store(name,name,value,{kind:'instrument',name},'synthesized');
  assets[name]={sample:name,asset:entry.asset};
}

const take=asset=>({asset}), layer=(id,...samples)=>({id,takes:samples.map(take)});
const snare={
  notes:[38,38],pan:.07,gain:-3,attack:0,inserts:[{type:'highpass',hz:105},{type:'drive',amount:1.35,mix:.28}],
  sends:{chamber:.16},articulations:{
    default:[{...layer('ghost','snare-ghost'),velocity:[0,0,.42,.78],gain:2},
      {...layer('stick','snare-alt','snare-main'),velocity:[.42,.78,1,1]},
      {...layer('rim-overlay','snare-rim'),velocity:[.8,.98,1,1],gain:-10}],
    rim:[layer('rim','snare-rim','snare-ghost')]
  }
};
const reed={
  notes:[67,83],gated:true,release:.125,attack:.005,pan:-.08,gain:-9,
  inserts:[{type:'highpass',hz:115},{type:'lowpass',hz:2500},{type:'drive',amount:1.8,mix:.22}],
  sends:{echo:.53,chamber:.23},articulations:{default:[{
    id:'reed-body',takes:[{asset:'reed',root:'C4',loop:{from:frame(.207),to:frame(.459),crossfade:frame(.027)}}],
    releases:[{asset:'key-off',gain:5}]
  }]}
};
const definition={id:'switchyard',pads:{
  kick:{notes:[36,36],gain:-4,attack:0,inserts:[{type:'drive',amount:1.4,mix:.25}],
    articulations:{default:[layer('low','kick')]}},
  snare,
  'closed-hat':{notes:[42,42],pan:-.29,gain:-10,choke:'hats',attack:0,
    articulations:{default:[layer('closed','hat-closed','hat-closed-alt')]}},
  'open-hat':{notes:[46,46],pan:-.29,gain:-10,choke:'hats',attack:0,
    articulations:{default:[layer('open','hat-open')]}},
  metal:{notes:[51,51],pan:.39,gain:-10,sends:{echo:.38},articulations:{default:[layer('strike','metal-soft')]}},
  reed,
  bass:{gated:true,attack:.004,release:.12,gain:-8,inserts:[{type:'lowpass',hz:850}],
    articulations:{default:[{id:'bass-body',takes:[{asset:'bass',root:'C2',
      loop:{from:frame(.105),to:frame(.379),crossfade:frame(.028)}}]}]}}
},buses:{
  chamber:{gain:-5,inserts:[{type:'delay',seconds:.071,mix:1,feedback:.36},{type:'lowpass',hz:2850}]},
  echo:{pan:.31,gain:-2,inserts:[{type:'delay',seconds:.345,mix:1,feedback:.46},
    {type:'highpass',hz:220},{type:'lowpass',hz:2300}]}
}};
json(path.join(folder,'kit.json'),{kit:definition,assets});
const midi=(note,time,velocity,extra)=>({note,time,velocity,...extra});
const led=[];
function play(note,beat,velocity,properties={}) {
  led.push(midi(note,{beat},velocity,properties));
}
const bassLines=[
  [[48,0,.81],[48,1.75,.41],[51,2.5,.32],[53,3.22,.51]],
  [[46+12,0,.6],[53,1.49,.39],[51,2.02,.74],[48,3.51,.31]],
  [[48,0,1.04],[48,1.74,.38],[55,2.5,.6]],
  [[51,0,.58],[53,1.21,.38],[51,2.13,.45],[48,3.02,.67]]
];
for (let bar=0;bar<4;bar++) {
  const base=bar*4;
  for (const [beat,velocity] of [[0,.93],[.76,.39],[1.83,.72],[2.52,.91],[3.49,.55]])
    if (!(bar%2 && beat===.76) && !(bar===3 && beat===3.49)) play(36,base+beat,velocity);
  for (const [beat,velocity] of [[.66,.39],[1.016,.91],[2.23,.3],[3.028,.86]])
    play(38,base+beat,velocity,bar===3 && beat===3.028 ? {articulation:'rim'} : {});
  for (const [i,beat] of [0,.5,1.26,1.5,1.75,2,2.5,2.75,3.5].entries()) {
    const open=i===1 || i===6;
    play(open ? 46 : 42,base+beat,[.54,.61,.34,.58,.31,.69,.72,.32,.47][i]);
  }
  for (const [note,beat,dur] of bassLines[bar])
    play(note-12,base+beat,.76,{pad:'bass',until:{beat:base+beat+dur}});
}
for (const [note,beat,dur,force] of [
  [75,.54,.53,.72],[72,2.67,.44,.61],[79,4.44,.34,.77],[77,5.08,.78,.81],
  [75,7.45,.43,.62],[72,8.82,1.21,.64],[79,11.52,.38,.74],[75,12.23,.49,.68],[72,13.64,1.46,.8]
]) play(note,beat,force,{until:{beat:beat+dur}});
for (const [beat,velocity] of [[2.13,.52],[6.38,.57],[7.72,.73],[10.48,.54],[14.69,.62]]) play(51,beat,velocity);

function run(name,events,options) {
  const performance=path.join(folder,name+'.json');
  json(performance,{events,options:{sampleRate,...options}});
  return JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),
    'music','samples','kit',path.join(folder,'library'),path.join(folder,'kit.json'),performance,
    '--out',path.join(folder,name)],{encoding:'utf8'}));
}
const stages={
  'snare-ladder':run('snare-ladder',[.24,.49,.65,.95,.95].map((velocity,i)=>midi(38,.16+i*.49,velocity)),{duration:2.68}),
  'hat-choke':run('hat-choke',[midi(46,.12,.91),midi(46,1.17,.91),midi(42,1.4,.86)],{duration:2.15}),
  'reed-study':run('reed-study',[midi(72,.16,.89,{duration:1.04}),midi(75,1.78,.78,{duration:.53})],{duration:3.24}),
  switchyard:run('switchyard',led,{map:{tempo:112,swing:.565},duration:10.6})
};
console.log(JSON.stringify(stages,null,2));
