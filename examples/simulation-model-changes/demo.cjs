const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const {KIT:K}=require('./ink-studio.config.js').load();
const {embedModels}=require('../../cli/simulation-model-files.js');
const PNG=require('../../cli/png.js'), WAV=require('../../cli/wav.js');
const W=K.world, source=path.join(__dirname,'tube.changes.json');
const plan=embedModels(require(source),source);
const rate=48000, end=rate*3, savedAt=69000;
const [narrow,fork,chamber]=plan.changes;

function capture(source,parts,at=0,checkpoint) {
  const audio=new Float64Array(end-at), diameter=new Float64Array(end-at);
  const play=W.modelChanges.create(source,{checkpoint,onBlock(start,stop,buffers){
    const count=stop-start;
    audio.set(buffers.audio.subarray(0,count),start-at);
    diameter.set(buffers.diameter.subarray(0,count),start-at);
  }});
  let i=0;
  return {audio,diameter,play,until(sample) {
    while (play.cursor()<sample) play.process(Math.min(parts[i++%parts.length],sample-play.cursor()));
  }};
}

const abrupt={...plan,changes:[{...narrow,duration:0},
  {type:'swap',variant:fork.variant,sample:fork.sample,policy:'reset'},
  {type:'swap',variant:chamber.variant,sample:chamber.sample,policy:'reset'}]};
const stepped=capture(abrupt,[512]), edited=capture(plan,[127,64,311,19]);
stepped.until(end);
edited.until(savedAt);
const saved=JSON.parse(JSON.stringify(edited.play.checkpoint()));
const replay=capture(plan,[401,7,96],savedAt,saved);
edited.until(end); replay.until(end);
assert.deepEqual(replay.audio,edited.audio.subarray(savedAt));
assert.deepEqual(replay.diameter,edited.diameter.subarray(savedAt));
assert.deepEqual(replay.play.checkpoint(),edited.play.checkpoint());

const out=path.resolve(process.argv[2]??'studio/out/simulation-model-changes');
fs.mkdirSync(out,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(out,name),value);
for (const [name,clip] of [['controlled',edited],['hard-switch',stepped]]) {
  const samples=clip.audio.map((value,i)=>0.78*value*Math.min(1,i/192,(end-1-i)/960));
  write(name+'.wav',WAV.encode({sampleRate:rate,channels:1,samples}));
}
const jump=(clip,sample)=>Math.abs(clip.audio[sample]-clip.audio[sample-1]);
const changes=edited.play.inspect();
write('resume.checkpoint.json',JSON.stringify(saved,null,2)+'\n');
write('report.json',JSON.stringify({rate,samples:end,checkpointSample:savedAt,
  resumedSamplesMatched:end-savedAt,changes,jumps:[fork,chamber].map(({sample,variant})=>
    ({sample,variant,hard:jump(stepped,sample),controlled:jump(edited,sample)}))},null,2)+'\n');

const width=1140,height=810, commands=[];
const bg='#101923',panel='#192934',paper='#edf4ee',muted='#b2c7ce',grid='#3b5661';
const mint='#99efc9',gold='#ffbe88',blue='#9ac7ff',deep='#2b494f';
const rect=(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill});
const label=(text,x,y,scale=2,color=paper)=>commands.push({type:'text',text,at:[x,y],scale,color});
const line=(points,stroke,width=2)=>commands.push({type:'path',points,stroke,width});
rect(0,0,width,height,bg);
rect(44,39,27,4,mint);
label('INK STUDIO / SIMULATION',83,33,2,mint);
label('Edit a running model',41,65,5);
label('TUBE NETWORK / 48 KHZ',45,126,2,muted);

rect(44,164,1052,330,panel);
label('BORE CONTROL',65,186,2);
label('SMOOTH RAMP',790,186,2,mint);
label('HARD STEP',946,186,2,gold);
const left=94, span=962, x=sample=>left+span*sample/end, y=bore=>341-127*bore;
rect(x(fork.sample),212,x(fork.sample+fork.duration)-x(fork.sample),230,deep);
for (const bore of [0.9,0.6,0.3]) {
  rect(left,Math.round(y(bore)),span,1,grid);
  label(bore.toFixed(1),55,Math.round(y(bore))-6,1,muted);
}
const chart=clip=>Array.from({length:601},(_,i)=>[x(i*240),y(clip.diameter[Math.min(end-1,i*240)])]);
line(chart(stepped),gold,2);
line(chart(edited),mint,3);
for (let i=0;i<=6;i++) {
  const sample=i*rate/2, pos=x(sample);
  rect(Math.round(pos),446,1,7,muted);
  label((i/2).toFixed(1)+' S',Math.round(pos)-14,465,1,muted);
}
rect(left,446,span,1,grid);
label('OUTLET AUDIO',66,328,1,muted);
const center=403;
rect(left,center,span,1,grid);
for (let i=0;i<span;i+=2) {
  const a=Math.floor(i*end/span), b=Math.floor((i+2)*end/span);
  let low=0, high=0;
  for (let j=a;j<b;j++) {
    low=Math.min(low,edited.audio[j]);
    high=Math.max(high,edited.audio[j]);
  }
  rect(left+i,Math.round(center-high*66),1,Math.max(1,Math.round((high-low)*66)),mint);
}
rect(Math.round(x(chamber.sample)),214,1,229,blue);
label('REMAP',Math.round(x(chamber.sample))+9,217,1,blue);
label('FADE',Math.round(x(fork.sample))+9,217,1,mint);

const schemes=[
  {title:'01 / NARROW THE BORE',tag:'SMOOTHSTEP / 500 MS',name:'tube',points:[[30,128],[138,128],[238,128]],color:gold},
  {title:'02 / ADD A FORK',tag:'CROSSFADE / 175 MS',name:'fork',points:[[30,143],[111,143],[241,143],[146,100],[208,100]],color:mint},
  {title:'03 / SWAP THE BRANCH',tag:'REMAP / 7 STATE VALUES',name:'chamber',
    points:[[30,132],[104,132],[250,132],[145,97],[207,97],[182,165]],color:blue}
];
for (const [i,s] of schemes.entries()) {
  const px=44+i*354, py=515;
  rect(px,py,344,220,panel);
  rect(px+17,py+19,3,14,s.color);
  label(s.title,px+30,py+20,2);
  label(s.tag,px+20,py+49,2,s.color);
  const coords=s.points.map(([x,y])=>[px+x+19,py+y]), links=plan.variants[s.name].operators.solver.config.links;
  for (const [a,b] of links) line([coords[a],coords[b]],a===0?muted:s.color,a===0?4:3);
  for (const [j,[cx,cy]] of coords.entries()) {
    const side=j<3?13:9;
    rect(cx-Math.floor(side/2),cy-Math.floor(side/2),side,side,j<3?paper:s.color);
  }
  label('IN',px+34,py+182,1,muted);
  label('OUT',px+250,py+182,1,muted);
}
rect(44,763,27,2,mint);
label('MID-FADE CHECKPOINT / '+(end-savedAt).toLocaleString('en-US')+' RESUMED SAMPLES MATCH',84,755,2,paper);
write('tube-model-changes.png',PNG.encodeFrame(PNG.packRGBA(K.procedural.drawing2d.render({width,height,commands,edges:'hard'}))));
