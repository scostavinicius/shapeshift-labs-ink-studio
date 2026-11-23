const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const kit=require('../..').load(),K=kit.KIT,W=K.world;
const WAV=require('../../cli/wav.js'), PNG=require('../../cli/png.js'), runner=require('../../cli/physical-audio.js');
const waveRunner=require('../../cli/wave-network.js'), modalRunner=require('../../cli/modal-resonator.js');
const out=path.resolve(process.argv[2]??'studio/out/physical-audio');
fs.mkdirSync(out,{recursive:true});
const file=name=>path.join(out,name);
const write=(name,bytes)=>fs.writeFileSync(file(name),bytes);
const json=(name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const sampleRate=48000,startSample=4800,frames=sampleRate*2.4;
const waveRate=24000,modalRate=32000, span=2.4;
const tube={format:W.waveNetworks.format,version:1,id:'ceramic-whistle',nodes:{mouth:{},bell:{}},
  tubes:{bore:{from:'mouth',to:'bell',sections:[{length:.53,area:.005}]}},
  observations:{pressure:{tube:'bore',t:.72},radiation:{tube:'bore',t:.98}}};
json('whistle.json',tube);
const drive=Array.from({length:waveRate*span},(_,index)=>{
  const time=index/waveRate;
  return [.22,.92,1.62].reduce((sum,start,i)=>{
    const age=time-start, duration=[.13,.2,.15][i], hz=[330,420,282][i];
    if(age<0||age>=duration)return sum;
    const phase=2*Math.PI*age*(hz+60*age);
    return sum+Math.sin(Math.PI*age/duration)**1.5*(Math.sin(phase)+.26*Math.sin(2*phase)+.12*Math.sin(3*phase))*.000055;
  },0);
});
const waveRun={format:W.waveNetworks.runFormat,version:1,network:'whistle.json',samples:drive.length,
  settings:{method:'delay',sampleRate:waveRate,loss:.1,sources:{breath:{kind:'flow',node:'mouth'}},
    terminations:{mouth:{kind:'reflect',coefficient:.68},bell:{kind:'reflect',coefficient:-.54}}},
  inputs:{breath:drive}};
json('whistle.wave.json',waveRun);
const strike={point:[.12,.08,0],gains:[.62,1.1,.83,.38]};
const pickup={point:[.25,.07,0],gains:[.85,.87,.63,.67]};
const bell=modalRunner.bake(kit,{format:W.resonantModes.planFormat,version:1,id:'metal-tab',revision:1,
  source:{kind:'authored',modes:[{id:'body',hz:259,decay:5},{id:'edge',hz:579,decay:9},
    {id:'upper',hz:927,decay:14},{id:'rim',hz:1471,decay:23}]},excitations:{strike},pickups:{contact:pickup}},
  file('metal.bake.json'));
json('metal.modes.json',bell);
const bellRun={format:W.resonantModes.runFormat,version:1,asset:'metal.modes.json',settings:{sampleRate:modalRate},
  samples:modalRate*span,impulses:[.43,1.17,1.87].map((time,i)=>({
    excitation:'strike',sample:Math.floor(time*modalRate),fraction:time*modalRate%1,value:[.016,.012,.017][i]}))};
json('metal.run.json',bellRun);
const traces={
  tube:waveRunner.run(kit,waveRun,file('whistle.wave.json')),
  metal:modalRunner.run(kit,bellRun,file('metal.run.json'))
};
const inputs={
  pressure:{trace:'whistle.wave.json',selection:{name:'pressure'}},
  flow:{trace:'whistle.wave.json',selection:{name:'radiation',channel:'flow'}},
  vibration:{trace:'metal.run.json',selection:{name:'contact',metersPerUnit:1}}
};
const signals=Object.fromEntries(Object.entries(inputs).map(([name,input])=>
  [name,W.physicalSignals.fromTrace(traces[name==='vibration'?'metal':'tube'],input.selection)]));
function gain(track,target,differentiate){
  const peak=track.samples.reduce((max,value,index)=>Math.max(max,Math.abs(differentiate?
    (value-(track.samples[index-1]??value))*track.sampleRate:value)),0);
  assert.ok(peak>0);
  return target/peak;
}
const sources={
  whistle:{signal:'pressure',pcmPerUnit:gain(signals.pressure,.29,false),pan:-.72},
  radiator:{signal:'flow',pickup:'flow-derivative',pcmPerUnit:gain(signals.flow,.135,true),pan:.25},
  metal:{signal:'vibration',pickup:'velocity',pcmPerUnit:gain(signals.vibration,.40,true),pan:.65}
};
const paths={
  'whistle-direct':{source:'whistle',delaySamples:864.5,gain:.9,pan:-.72},
  'whistle-wall':{source:'whistle',delaySeconds:.107,gain:.44,pan:.81},
  'whistle-return':{source:'whistle',delaySeconds:.182,gain:.2,pan:-.52},
  'radiator-direct':{source:'radiator',delaySeconds:.022,gain:.92,pan:.15},
  'radiator-wall':{source:'radiator',delaySeconds:.083,gain:.37,pan:.90},
  'metal-direct':{source:'metal',delaySeconds:.012,gain:.9,pan:.63},
  'metal-wall':{source:'metal',delaySeconds:.131,gain:.54,pan:-.88},
  'metal-return':{source:'metal',delaySeconds:.231,gain:.21,pan:.6}
};
const plan={format:W.physicalAudio.format,version:1,id:'ceramic-and-steel',sampleRate,startSample,frames,
  sources,paths,mix:{dry:.34,wet:.9}};
const run={format:runner.runFormat,version:1,plan,inputs};
json('take.json',run);
const result=runner.run(kit,run,file('take.json'));
result.report.files=runner.writeStems(out,result);
json('report.json',result.report);

const audible=(values,threshold)=>values.findIndex((v,i)=>i%2===0&&
  Math.max(Math.abs(v),Math.abs(values[i+1]))>threshold)/2;
const arrivals={
  whistle:audible(result.sources.whistle.samples,1e-7),
  direct:audible(result.paths['whistle-direct'].samples,9e-8),
  wall:audible(result.paths['whistle-wall'].samples,4.4e-8)
};
assert.equal(arrivals.wall-arrivals.whistle,Math.round(paths['whistle-wall'].delaySeconds*sampleRate));
assert.ok(Math.abs(arrivals.direct-arrivals.whistle-paths['whistle-direct'].delaySamples)<=1.5);
for(const audio of ['source','propagation','mix']){
  const saved=WAV.read(file(audio+'.wav'),{metadata:true});
  assert.equal(saved.bwf.timeReference,String(startSample));
  assert.equal(saved.samples.length,frames*2);
}
const reel=new Float64Array((frames+sampleRate*.4)*3*2);
for(const [i,bus] of ['source','propagation','mix'].entries())
  reel.set(result[bus].samples,i*(frames+sampleRate*.4)*2);
write('three-bus-audition.wav',WAV.encode({sampleRate,channels:2,samples:reel},{encoding:'pcm24'}));
json('arrivals.json',{
  outputSampleRate:sampleRate,startSample,
  source:arrivals.whistle+startSample,direct:arrivals.direct+startSample,wall:arrivals.wall+startSample,
  exactDirectDelaySamples:result.report.paths['whistle-direct'].delaySamples,
  firstWallDelayMs:(arrivals.wall-arrivals.whistle)/sampleRate*1000
});

const commands=[],bg='#101f2a',panel='#1b3140',well='#142634',grid='#355361',paper='#ebf2ec',dim='#abc1ca';
const mint='#81dec2',blue='#93bdf4',yellow='#f2ce89',red='#f8a590';
const rect=(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill});
const line=(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width});
const text=(text,x,y,scale=2,color=paper)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color});
const width=1152,height=802;
rect(0,0,width,height,bg);
rect(38,32,26,4,mint);text('INK STUDIO / PHYSICAL AUDIO',76,26,2,mint);
text('Ceramic and steel',36,65,5);
text('A WAVEGUIDE AND A MODAL RESONATOR ON ONE 48 KHZ TAKE',40,122,2,dim);
rect(36,167,1080,330,panel);
text('BUS EXPORTS',56,185,2);
text('EVERY STEM STARTS AT SAMPLE '+startSample,775,187,1,dim);

function waveform(values,x,y,w,h,start,end,color,scale=1){
  rect(x,y,w,h,well);
  const middle=y+h/2;
  for(let i=0;i<=6;i++)line([[x+w*i/6,y],[x+w*i/6,y+h]],grid);
  line([[x,middle],[x+w,middle]],grid);
  const points=[];
  for(let i=0;i<w;i++){
    const first=Math.floor(start+(end-start)*i/w), last=Math.floor(start+(end-start)*(i+1)/w);
    let low=0,high=0;
    for(let j=first;j<last;j++){
      const left=values[2*j],right=values[2*j+1];
      low=Math.min(low,left,right);high=Math.max(high,left,right);
    }
    if(high-low>1e-5){
      const a=Math.min(h*.47,high*h*.42*scale), b=Math.min(h*.47,-low*h*.42*scale);
      points.push([[x+i,middle-a],[x+i,middle+Math.max(b,.6-a)]]);
    }
  }
  for(const column of points)line(column,color);
}
for(const [i,[name,color,label]] of [
  ['source',mint,'DRY SOURCE'],['propagation',blue,'PROPAGATION'],['mix',yellow,'FINAL MIX']
].entries()){
  const y=222+83*i;
  text(label,58,y+8,1,color);
  text('PEAK '+result.report.peaks[name].toFixed(2),58,y+26,1,dim);
  waveform(result[name].samples,170,y,922,63,0,frames,color,2);
}
text('0.10 S',171,475,1,dim);text('1.30 S',615,475,1,dim);text('2.50 S',1053,475,1,dim);
rect(36,518,708,238,panel);
text('FIRST WHISTLE / ARRIVAL DETAIL',56,536,2);
const window=[arrivals.whistle-200,arrivals.whistle+8300];
for(const [i,[label,color,row,index]] of [
  ['SOURCE',mint,result.sources.whistle,arrivals.whistle],
  ['DIRECT +18 MS',blue,result.paths['whistle-direct'],arrivals.direct],
  ['WALL +107 MS',red,result.paths['whistle-wall'],arrivals.wall]
].entries()){
  const y=573+i*52;
  text(label,56,y+13,1,color);
  waveform(row.samples,175,y,540,33,...window,color,4);
  const mark=175+540*(index-window[0])/(window[1]-window[0]);
  line([[mark,y],[mark,y+33]],color);
}
rect(764,518,352,238,panel);
text('PHYSICAL PICKUPS',786,536,2);
text('01   TUBE PRESSURE',787,573,1,mint);
text('24 KHZ WAVEGUIDE / PA',787,592,1,dim);
text('02   OUTLET RADIATION PROXY',787,621,1,blue);
text('FLOW DERIVATIVE / M^3/S^2',787,640,1,dim);
text('03   METAL VIBRATION',787,669,1,yellow);
text('32 KHZ MODAL / M/S',787,688,1,dim);
const frame=PNG.packRGBA(K.procedural.drawing2d.render({width,height,commands,edges:'hard'}));
write('physical-audio.png',PNG.encodeFrame(frame));
console.log('Wrote aligned stems and arrival review to '+out);
