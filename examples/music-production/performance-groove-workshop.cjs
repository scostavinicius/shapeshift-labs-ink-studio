/* Run: node examples/music-production/performance-groove-workshop.cjs output-directory */
const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), {execFileSync}=require('node:child_process');
const {KIT:K}=require('../..').load(), A=K.music.production;
const WAV=require('../../cli/wav'), {write,json}=require('../../cli/asset-files');
const folder=path.resolve(process.argv[2] ?? 'performance-groove-workshop'), at=name=>path.join(folder,name);
const cli=path.join(__dirname,'../../cli/ink-studio.js');
const sampleRate=32000, sourceTempo=98, tempo=112, origin=.16, length=8;
const files=Object.fromEntries(['snare-rim','snare-ghost','hat-closed','hat-closed-alt','metal-soft'].map(name=>
  [name,path.join(__dirname,'samples',name+'.wav')]));
const assets=Object.fromEntries(Object.entries(files).map(([name,file])=>[name,WAV.read(file)]));
const wave=(name,samples)=>write(at(name+'.wav'),WAV.encode({sampleRate,channels:1,samples},{encoding:'pcm24'}));

// Beat, milliseconds from the grid, amplitude and intended sample length.
const breakRows={
  kick:[[0,12,.67,.14],[1.5,-23,.58,.104],[2.75,24,.76,.134],
    [4,8,.69,.14],[5.5,-19,.49,.097],[6.75,21,.73,.125]],
  rim:[[1,31,.54,.116],[3,51,.77,.147],[5,27,.49,.094],[7,46,.68,.148]],
  ghost:[[2.5,-38,.33,.056],[3.75,-28,.22,.077],[6.5,41,.41,.105],[7.75,-31,.27,.054]],
  hat:[[.5,-19,.59,.042],[1.25,37,.17,.068],[1.75,21,.34,.055],[2.25,-29,.71,.038],[3.5,32,.40,.056],
    [4.5,-16,.64,.043],[5.25,33,.23,.063],[5.75,21,.42,.041],[6.25,-25,.67,.039],[7.5,33,.29,.061]],
  metal:[[2,-27,.42,.146],[4.75,40,.68,.104],[6,29,.48,.169]]
};
const samplesByLane={rim:'snare-rim',ghost:'snare-ghost',hat:'hat-closed',metal:'metal-soft'};
const refMix=new Float64Array(Math.ceil((origin+length*60/sourceTempo+.18)*sampleRate));
const referenceLanes={};
for (const [lane,rows] of Object.entries(breakRows)) {
  const samples=new Float64Array(refMix.length), oneShot=assets[samplesByLane[lane]]?.samples;
  const peak=oneShot?.reduce((max,x)=>Math.max(max,Math.abs(x)),.001) ?? 1;
  for (const [beat,offset,gain,duration] of rows) {
    const first=Math.round((origin+beat*60/sourceTempo+offset/1000)*sampleRate);
    const frames=Math.min(oneShot?.length ?? Infinity,Math.round(duration*sampleRate));
    for (let i=0;i<frames;i++) {
      const t=i/sampleRate, fade=Math.min(1,(frames-i)/(.014*sampleRate));
      const hit=oneShot ? oneShot[i]/peak : Math.sin(2*Math.PI*(48*t+1.8*(1-Math.exp(-70*t))))*Math.exp(-t*19);
      samples[first+i]+=gain*fade*hit;
    }
  }
  wave('reference-'+lane,samples);
  referenceLanes[lane]='reference-'+lane+'.wav';
  for (let i=0;i<samples.length;i++) refMix[i]+=samples[i]*(lane==='hat' ? .58 : .76);
}
wave('source-break',refMix);

// An authored MIDI take with measured note-on and note-off times.
const midiRows={
  low:[[0,.035,.31,102,38],[1.5,-.037,.18,86,45],[2.75,.032,.46,112,36],
    [4,.016,.37,100,34],[5.5,-.027,.14,80,41],[6.75,.027,.39,110,43],[7.5,-.034,.13,71,48]],
  answer:[[.75,.067,.16,87,72],[1.75,.026,.58,104,77],[3.25,-.044,.22,81,76],
    [4.5,.075,.24,89,69],[6.25,.052,.71,107,74],[7.25,-.065,.19,78,72]]
};
function midiTake() {
  const ppq=960, events=[];
  for (const [channel,rows] of Object.values(midiRows).entries()) for (const [beat,offset,gate,velocity,pitch] of rows) {
    const start=Math.round((beat+offset)*ppq);
    events.push({tick:start,bytes:[0x90+channel,pitch,velocity]},
      {tick:start+Math.round(gate*ppq),bytes:[0x80+channel,pitch,0]});
  }
  let prior=0;
  const bytes=[];
  for (const {tick,bytes:event} of events.sort((a,b)=>a.tick-b.tick)) {
    const delta=tick-prior;
    if (delta>=128) bytes.push((delta>>7)|0x80);
    bytes.push(delta&127,...event);
    prior=tick;
  }
  bytes.push(0,0xff,0x2f,0);
  const header=Buffer.from('4d546864000000060000000103c04d54726b00000000','hex');
  header.writeUInt32BE(bytes.length,18);
  return Buffer.concat([header,Buffer.from(bytes)]);
}
write(at('reference-playing.mid'),midiTake());
const grid={id:'side-pocket',length,step:.25,map:{tempo:sourceTempo,origin}};
function extract(name,recipe) {
  json(at(name+'-source.json'),recipe);
  execFileSync(process.execPath,[cli,'music','groove','extract',at(name+'-source.json'),'--out',at(name+'-fit.json')]);
  return JSON.parse(fs.readFileSync(at(name+'-fit.json'),'utf8'));
}
const audio=extract('audio',{input:{kind:'audio',lanes:referenceLanes},grid,
  detect:{minGap:.088,minStrength:.048,sensitivity:1.7},gate:{floor:.007}});
const midi=extract('midi',{input:{kind:'midi',file:'reference-playing.mid',
  lanes:[{lane:'low',channel:1},{lane:'answer',channel:2}]},grid});
const template={...audio.template,lanes:{...audio.template.lanes,...midi.template.lanes}};
for (const [lane,rows] of Object.entries({...breakRows,...midiRows}))
  assert.deepEqual(template.lanes[lane].map(cell=>cell.slot),rows.map(row=>row[0]*4),lane);
json(at('groove.json'),template);

const motif=events=>({length,events}), drum=(beat,duration,velocity,articulation)=>({beat,duration,velocity,degree:1,
  ...(articulation && {play:{articulation}})});
const hits=(lane,duration,velocity)=>breakRows[lane].map(([beat])=>drum(beat,duration,velocity));
const line=rows=>rows.map(([beat,duration,velocity,midi])=>({beat,duration,velocity,midi}));
const harmony=(root,quality,anchor)=>({root,quality,voicing:{air:anchor}});
const production={seed:2803,arrangement:{
  score:{tempoMap:{tempo},key:{root:'D4',mode:'minor'},endFade:.12,harmonies:{
    shade:harmony('D3','minor7','F4'),glow:harmony('Bb2','major7','A4'),
    turn:harmony('G2','minor7','Bb4')
  }},
  parts:{
    answer:{role:'lead',material:'answer',pitch:'key'},bass:{role:'bass',material:'bass'},air:{role:'pad',material:'air'},
    kick:{role:'percussion',material:'kick',voice:{instrument:'kick'}},
    snare:{role:'percussion',material:'snare',voice:{instrument:'snare'}},
    hat:{role:'percussion',material:'hat',voice:{instrument:'hat'}},
    metal:{role:'percussion',material:'metal',voice:{instrument:'hat'}}
  },
  motifs:{
    answer:motif(line([[.75,.34,.68,72],[1.75,.33,.70,77],[3.25,.35,.66,76],
      [4.5,.34,.64,69],[6.25,.34,.73,74],[7.25,.33,.61,72]])),
    bass:motif(line([[0,.47,.81,38],[1.5,.40,.67,45],[2.75,.44,.75,36],[3.5,.20,.56,33],
      [4,.47,.79,34],[5.5,.42,.65,41],[6.75,.43,.78,43],[7.5,.40,.58,48]])),
    air:motif([drum(.25,2.35,.47),drum(4.25,2.4,.42)]),
    kick:motif(hits('kick',.14,.79)),
    snare:motif([...hits('rim',.27,.73),...breakRows.ghost.map(([beat])=>drum(beat,.14,.30,'ghost'))]),
    hat:motif(hits('hat',.21,.51)),metal:motif(hits('metal',.27,.61))
  },
  sections:['shade','glow','shade','turn'].map((harmony,i)=>({id:'bar-'+i,harmony,bars:1}))
},patches:{
  keys:{type:'keys',tine:.26,bite:.49,color:.66,drive:1.15,wear:.22,dust:.058,
    env:{attack:.004,decay:.14,sustain:.42,release:.18},
    echo:{delay:.4018,feedback:.28,width:.65,damping:.57,send:.16}},
  bass:{type:'analog',body:.46,color:.34,width:1.4,drive:1.21,
    env:{attack:.004,decay:.14,sustain:.71,release:.062}},
  air:{type:'fm',body:.29,ratio:2,index:1.05,indexDecay:.26,color:.37,width:5,
    env:{attack:.09,decay:.25,sustain:.58,release:.31}},
  kick:{type:'drum',kind:'kick',tune:46,decay:.16,sweep:103,click:.15,color:.42},
  snare:{type:'sample',zones:[{articulation:'main',samples:['snare-rim'],gain:2.7},
    {articulation:'ghost',samples:['snare-ghost'],gain:4.4}]},
  hat:{type:'sample',zones:[{samples:['hat-closed','hat-closed-alt'],gain:7}]},
  metal:{type:'sample',zones:[{samples:['metal-soft'],gain:3.9}]}
},tracks:{
  answer:{patch:'keys',gain:-11,pan:.19,highpass:148,send:.25},
  bass:{patch:'bass',gain:-13,lowpass:855},
  air:{patch:'air',gain:-18,pan:-.24,highpass:233,lowpass:3480,send:.50},
  kick:{patch:'kick',gain:-11,lowpass:4900},
  snare:{patch:'snare',gain:-6,highpass:174,send:.21},
  hat:{patch:'hat',gain:-10,pan:.38,highpass:1075,send:.12},
  metal:{patch:'metal',gain:-11,pan:-.42,highpass:415,send:.37}
},room:{gain:-6,size:1.16,decay:.54,damping:.56}};
const map={template,anchors:[0,4,8,12],links:[{leader:'kick',followers:['bass'],within:.012}],roles:{
  bass:{lane:'low',timing:.85,accent:.65,length:1},
  lead:{lane:'answer',timing:1.07,accent:.84,length:1}
},tracks:{
  kick:{lane:'kick',timing:1,accent:.64,length:0},
  snare:{lane:'rim',timing:1,accent:.97,length:.85,articulations:{ghost:{lane:'ghost',timing:1.16,accent:1.14,length:1}}},
  hat:{lane:'hat',timing:1.05,accent:1,length:1},
  metal:{lane:'metal',timing:.94,accent:.84,length:.63}
}};
json(at('transfer.json'),{...map,template:'groove.json'});
function timingOnly(routes) {
  return Object.fromEntries(Object.entries(routes).map(([name,{articulations,...settings}])=>[name,{
    ...settings,accent:0,length:0,...(articulations && {articulations:timingOnly(articulations)})
  }]));
}
const timingMap={...map,roles:timingOnly(map.roles),tracks:timingOnly(map.tracks)};
const takes=[];
for (const [id,mapping] of [['grid',null],['timing',timingMap],['full',map]]) {
  const result=mapping ? A.mapGroove(production,mapping,assets) : {production};
  const {events}=A.inspect(result.production,assets);
  const {value}=A.render(result.production,assets,{sampleRate});
  const peak=A.meters(value).peak;
  assert(peak>0 && peak<1);
  write(at(id+'.wav'),WAV.encode(value,{encoding:'pcm24'}));
  json(at(id+'.json'),{production:result.production,assets:files,options:{sampleRate}});
  takes.push({id,peak,events,report:result.report});
}
for (const [name,rows] of Object.entries(takes[0].events)) {
  const timed=takes[1].events[name], full=takes[2].events[name];
  assert.deepEqual(timed.map(n=>[n.beat,n.midi,n.gate,n.velocity]),rows.map(n=>[n.beat,n.midi,n.gate,n.velocity]));
  assert.deepEqual(full.map(n=>[n.beat,n.midi,n.time]),timed.map(n=>[n.beat,n.midi,n.time]));
}
for (const kick of takes[2].events.kick) {
  const bass=takes[2].events.bass.find(note=>note.beat===kick.beat);
  assert.equal(kick.time,bass.time);
}
json(at('demo.json'),{title:'Side Pocket',sourceTempo,tempo,origin,length,sampleRate,anchors:map.anchors,
  source:audio.report.measured,midi:midi.report.measured,takes});
console.log(JSON.stringify(takes.map(({id,peak,report})=>({id,peak,report}))));
