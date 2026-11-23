/* Capstan Relay. Listen across one pinned performance, then play part of its print. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('../..'),kit=ink.load(),A=kit.KIT.procedural.mediaGraph;
const {write,json}=require('../../cli/asset-files');
const [directory='resampling-jam-workshop']=process.argv.slice(2);
const at=name=>path.resolve(directory,name), rate=32000, frame=s=>Math.round(s*rate);
const save=(name,value)=>write(at(name),ink.encodeWav(value,{encoding:'float64'}));
const cli=path.resolve(__dirname,'../../cli/ink-studio.js');
const call=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,'music',...args],{encoding:'utf8',maxBuffer:8e6}));
const jam=(mode,name,settings,out)=>call('jam',mode,at('library'),at(name),at(settings),'--out',at(out));
const sounds={
  axle:{model:'metal',seed:552,duration:.72,parameters:{body:91,hardness:.28,decay:.61,strike:.27}},
  pin:{model:'metal',seed:211,duration:.51,parameters:{body:414,hardness:.66,decay:.45,strike:.13}},
  nick:{model:'scrape',seed:83,duration:.23,parameters:{speed:.73,pressure:.66,body:960,grain:.61}},
  reed:{model:'breath',seed:471,duration:.64,parameters:{voice:.85,pitchStart:142,pitchEnd:226,roughTail:.91,throat:960}},
  reedAlt:{model:'breath',seed:73,duration:.57,parameters:{voice:.84,pitchStart:173,pitchEnd:259,roughTail:.85,throat:1180}}
};
for (const [name,model] of Object.entries(sounds)) save('inputs/'+name+'.wav',A.synthesizeGesture({...model,sampleRate:rate}).value);
const pad=(asset,gain,pan,extra={})=>({gain,pan,attack:.003,articulations:{default:[{
  id:'body',takes:(Array.isArray(asset) ? asset : [asset]).map(asset=>({asset}))
}]},...extra});
const sourceKit={id:'capstan',pads:{
  axle:pad('axle',-4,-.08,{inserts:[{type:'lowpass',hz:980}]}),
  pin:pad('pin',-9,.23,{inserts:[{type:'highpass',hz:290}]}),
  nick:pad('nick',-12,-.34,{inserts:[{type:'highpass',hz:430}]}),
  reed:pad(['reed','reedAlt'],-8,.08)
}};
const step=(id,beat,pad,velocity,tune=0,offset=0,other={})=>({id,beat,pad,velocity,offset,
  play:{tune,...other}});
const pattern={id:'capstan',length:4,seed:4732,steps:[
  step('foot',0,'axle',.9),step('nick-a',.46,'nick',.7,0,.012),
  step('pin-a',.75,'pin',.71,-160,.008),step('call',1.31,'reed',.75,-300,-.009),
  step('foot-a',1.97,'axle',.63,-285,.014),step('nick-b',2.21,'nick',.41,320,-.012),
  step('pin-b',2.63,'pin',.61,300,.013),step('call-b',3.08,'reed',.68,0,.005),
  step('pin-c',3.6,'pin',.49,100,.020)
],fills:[{id:'return',from:2.5,to:4,steps:[
  step('turn',2.58,'axle',.82,-200,.004),step('turn-pin',2.9,'pin',.74,-350),
  step('reply',3.23,'reed',.82,170,.008),step('ending',3.87,'nick',.64,-200,.010)
]}]};
const performance=A.padPattern.perform(pattern,{cycles:2,fills:[{id:'return',cycle:1}],
  render:{sampleRate:rate,duration:4.86,map:{tempo:113}}}).value;

const macro=(label,defaultValue,targets)=>({label,default:defaultValue,
  targets:targets.map(([path,range])=>({path,range}))});
const rack={
  format:'ink-studio/audio-rack',version:1,id:'capstan-bench',revision:1,title:'Capstan Bench',
  description:'Resonant color and a drifting granular return.',
  inputs:{main:'in'},output:'out',strips:{
    in:{inserts:['resonator','warmth'],sends:{scatter:{level:.2,tap:'post'}}},
    scatter:{inserts:['grains','dust'],fader:.7},out:{fader:.81}
  },
  processors:{
    resonator:{type:'eq',bands:[{mode:'peak',hz:360,q:4.8,gainDb:9},{mode:'peak',hz:890,q:5.8,gainDb:6},
      {mode:'high-shelf',hz:3100,q:.7,gainDb:-3}]},
    warmth:{type:'saturation',driveDb:4,outputDb:-5,bias:.11,toneHz:7100,wet:.8},
    grains:{type:'granular',grainMs:192,density:33,scanRate:.74,semitones:-1,sprayMs:31,
      jitterCents:55,reverse:.28,spread:.8,seed:188,wet:1},
    dust:{type:'tempo-delay',beats:.5,feedback:.35,crossfeed:.72,lowHz:285,highHz:3800,driveDb:2,wet:.56}
  },
  macros:{
    focus:macro('Resonance',.42,[
      [['processors','resonator','bands',0,'hz'],[270,1300]],
      [['processors','resonator','bands',1,'hz'],[580,3300]],
      [['processors','resonator','bands',2,'gainDb'],[-9,7]]]),
    heat:macro('Saturation',.51,[
      [['processors','warmth','driveDb'],[-4,19]],[['processors','warmth','outputDb'],[-1,-10]]]),
    fog:macro('Granular return',.23,[
      [['strips','in','sends','scatter','level'],[.01,1.15]],
      [['processors','grains','scanRate'],[1.03,.56]],[['processors','grains','semitones'],[4,-7]]])
  }
};
const source={format:'ink-studio/resampling-jam',version:1,id:'capstan-relay',kit:sourceKit,performance,
  assets:Object.fromEntries(Object.keys(sounds).map(name=>[name,'inputs/'+name+'.wav'])),
  racks:{bench:rack},branches:[{id:'bench',rack:'bench'}]};
json(at('jam.json'),source);
const forks={branches:[
  {id:'hollow',label:'Hollow brass',from:'bench',speed:.71,macros:{focus:.13,heat:.47,fog:.08}},
  {id:'shards',label:'Sharp fragments',from:'bench',speed:1.47,macros:{focus:.89,heat:.78,fog:.12}},
  {id:'mist',label:'Grain and smoke',from:'bench',speed:.88,macros:{focus:.37,heat:.63,
    fog:{unit:'seconds',points:[{at:0,value:.29},{at:1.14,value:.52},{at:2.09,value:.94},{at:3.37,value:.78}]}}}
],sweep:{from:'bench',prefix:'scan',axes:[
  {control:'speed',values:[.72,1.2]},{control:'macros.focus',values:[.22,.68]},{control:'macros.fog',values:[.12,.7]}
]}};
json(at('forks.json'),forks);
const forked=call('jam','branch',at('jam.json'),at('forks.json'),'--out',at('branched.json'));
const range={firstSample:frame(1.16),endSample:frame(3.16)};
const comparison={branches:['hollow','shards','mist'],range,levels:{targetRmsDb:-20,gapSeconds:.57}};
json(at('comparison.json'),comparison);
const compared=jam('audition','branched.json','comparison.json','compare');
const compare=JSON.parse(fs.readFileSync(compared.report));
const sweep={branches:forked.added.filter(row=>row.id.startsWith('scan-')).map(row=>row.id),
  range:{firstSample:range.firstSample,endSample:range.firstSample+frame(.92)},levels:{targetRmsDb:-21,gapSeconds:.23}};
json(at('sweep.json'),sweep);
jam('audition','branched.json','sweep.json','sweep');
const anchors=compare.events.filter(row=>row.at>=range.firstSample && row.at<range.endSample);
const inWindow=pad=>anchors.find(row=>row.pad===pad && row.at>range.firstSample);
const markers=[{id:'entry',at:range.firstSample,kind:'slice'},
  {id:'fragments',at:inWindow('pin').at,kind:'attack'},{id:'reply',at:inWindow('reed').at,kind:'attack'}].sort((a,b)=>a.at-b.at);
const selection={branch:'mist',range,takes:['dry','wet'],markers,
  sample:{id:'capstan',label:'Capstan Relay / grain and smoke',material:'metal and breath',license:{id:'CC0-1.0'}},
  note:'The low metal and the long granular swell answer one another here.'};
json(at('keep.json'),selection);
const kept=jam('keep','branched.json','keep.json','print');
call('jam','recover',at('library'),kept.entries.wet,'--out',at('recovered'));
json(at('render.json'),{branch:'mist',range});
const playback=jam('render','recovered/jam.json','render.json','replay');
assert.deepEqual(fs.readFileSync(playback.audio),fs.readFileSync(at('print/wet.wav')));

const instrument={kit:{id:'relay-instrument',pads:{
  cut:pad('fragments',-3,.08,{inserts:[{type:'highpass',hz:246}],sends:{wall:.30}}),
  fall:pad('print',-6,-.06,{gated:true,release:.19,inserts:[{type:'lowpass',hz:730}]}),
  sing:pad('reply',-4,.21,{gated:true,release:.13,sends:{wall:.74}}),
  flash:pad('print',-4,-.12,{gated:true,release:.16,sends:{wall:.39}})
},buses:{wall:{gain:-8,pan:-.22,inserts:[{type:'lowpass',hz:3100},{type:'delay',seconds:.263,feedback:.43,mix:1}]}}},
assets:{
  print:{print:'print/print.json',take:'wet'},
  fragments:{print:'print/print.json',take:'wet',slice:'fragments'},
  reply:{print:'print/print.json',take:'wet',slice:'reply'}
}};
json(at('instrument.json'),instrument);
const arrangement={
  fall:[[.06,.91,-910,0,.86],[1.55,.77,-690,0,.53],[2.67,.82,-1110,0,.86],[4.10,.86,-910,0,.82],
    [5.66,.85,-510,0,.70],[6.7,.9,-1200,0,1.22]],
  cut:[[.39,.72,330,-.37],[1.12,.83,610,.19],[1.35,.47,-180,.3],[2.19,.73,190,-.33],[3.24,.77,720,.27],
    [3.76,.49,930,-.18],[4.57,.67,610,.23],[5.02,.55,-350,-.33],[6.33,.68,510,.12],[7.43,.62,890,.21]],
  sing:[[.87,.83,-85,.34,.45],[2.39,.74,490,-.15,.54],[3.50,.58,0,.32,.41],[4.82,.83,720,.23,.57],
    [6.15,.74,990,-.31,.48],[7.74,.85,-190,.04,.84]],
  flash:[[1.86,.6,250,-.20,.30],[3.98,.64,900,.23,.23],[5.37,.58,230,.17,.24],[7.12,.73,680,-.18,.36]]
};
const newPerformance={options:{sampleRate:rate,duration:9.2},events:Object.entries(arrangement).flatMap(([pad,events])=>
  events.map(([time,velocity,tune,pan,duration],i)=>({id:pad+'-'+i,pad,time,velocity,play:{tune,pan,
    ...(pad==='flash' && {startSample:frame(.46)})},...(duration!==undefined && {duration})})))};
json(at('instrument-performance.json'),newPerformance);
const played=call('samples','kit',at('library'),at('instrument.json'),at('instrument-performance.json'),'--out',at('instrument'));
const report=JSON.parse(fs.readFileSync(played.report));
json(at('demo.json'),{range,branches:forks.branches,sweep:forked.added.filter(row=>row.id.startsWith('scan-')),
  keep:{branch:selection.branch,markers,note:selection.note},comparison:compare,instrument:report});
console.log(at('demo.json'));
