const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ink=require('../..'),kit=ink.load(),{KIT:K}=kit,W=K.world,I=W.inputCompilers;
const PNG=require('../../cli/png.js'),WAV=require('../../cli/wav.js');
const out=path.resolve(process.argv[2]??'studio/out/input-compilers');
fs.mkdirSync(out,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(out,name),value);
const json=(name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const end=2.4, rate=120, hostRate=60, fps=24;

function phraseMIDI(){
  const track=Buffer.from([
    0,255,81,3,7,161,32,
    0x81,0x70,0x90,60,105,
    0x81,0x70,0xb0,74,93,
    0x81,0x70,0x90,60,0,
    0,0x90,64,94,
    0x81,0x70,255,81,3,10,174,96,
    0x81,0x70,0x90,64,0,
    0,0x90,67,106,
    0x83,0x60,0x90,67,0,
    0,255,47,0
  ]);
  const header=Buffer.from([77,84,104,100,0,0,0,6,0,0,0,1,1,224,77,84,114,107,0,0,0,0]);
  header.writeUInt32BE(track.length,18);
  return Buffer.concat([header,track]);
}
write('script.txt','Ink moves.\n');
write('transcription.ipa','/t͡ʃəˈmaɪ/\n');
write('chime.mid',phraseMIDI());
json('desk.inputs.json',{format:'ink-studio/input-recording',version:1,initial:{valve:.24},events:[
  {time:.24,channel:'valve',kind:'set',value:.82},
  {time:.58,channel:'valve',kind:'set',value:.92},
  {time:1.13,channel:'valve',kind:'set',value:.70},
  {time:1.6,channel:'desk-mark',kind:'pulse',value:'mark'},
  {time:1.83,channel:'valve',kind:'set',value:.42},
  {time:2.19,channel:'valve',kind:'set',value:.24}
]});
json('stage.cues.json',[
  {id:'ready',time:.18,label:'Ready'},
  {id:'inspection',time:1.28,end:1.61,label:'Inspection',controls:{'desk:valve':.08}},
  {id:'done',time:2.15,label:'Finish'}
]);
const plan={format:I.planFormat,version:1,id:'inspection-take',duration:end,sources:{
  script:{kind:'text',file:'script.txt',lexicon:{ink:'ɪŋk',moves:'muːvz'},targets:{ɪ:{jaw:.68},u:{jaw:.4}}},
  ipa:{kind:'ipa',file:'transcription.ipa',offset:.8,symbols:['aɪ'],targets:{ə:{jaw:.43},'aɪ':{jaw:.87}}},
  midi:{kind:'midi',file:'chime.mid',offset:.18},
  desk:{kind:'controller',file:'desk.inputs.json'},
  stage:{kind:'cues',file:'stage.cues.json'}
}};
const file=path.join(out,'compile.plan.json');
json('compile.plan.json',plan);
const compiled=require('../../cli/input-compiler.js').load(kit,plan,file);
const edits=[{op:'move',id:'stage.inspection',time:.74}];
const revised=I.edit(compiled,edits);
json('original.score.json',compiled);
json('inspection.edits.json',edits);
json('edited.score.json',revised);
const bindings={rate,until:end+1/rate,bindings:{
  valve:{curve:'desk:valve',quantity:{unit:'1',kind:'opening-fraction'},
    limits:{min:0,max:1,maxSpeed:5,maxAcceleration:90}}
}};
json('valve.bindings.json',bindings);
function simulate(label,score){
  const player=I.prepare(score), gesture=player.gestures(bindings);
  json(label+'.gesture.json',gesture);
  const world={format:W.format,version:1,id:'valve-'+label,dt:1/hostRate,systems:{
    inputs:{kind:'input-score',operatorRevision:1,config:{score,bindings:{request:{curve:'desk:valve'}}}},
    valve:{kind:'gesture-score',operatorRevision:1,config:{score:gesture}},
    pipe:{kind:'pipe-network',config:{nodes:{
      tank:{capacity:1,initial:.87,area:1,precharge:2.7},bay:{capacity:1,initial:.08,area:1}
    },pipes:{gate:{from:'tank',to:'bay',conductance:.14,maxFlow:.7,opening:.24}}},
    portQuantities:{inputs:{'valve.gate':{unit:'1',kind:'opening-fraction'}}}}
  },connections:[{from:'valve/valve',to:'pipe/valve.gate'}]};
  json(label+'.world.json',world);
  const host=W.runtime.create(world);
  const rows=Array.from({length:Math.round(end*hostRate)+1},(_,i)=>{
    if(i)host.step();
    const s=host.view().signals;
    return {time:i/hostRate,request:s['inputs/request'],opening:s['valve/valve'],flow:s['pipe/flow.gate'],
      events:s['inputs/events'].map(e=>[e.id,e.phase,e.timing.time])};
  });
  json(label+'.world.trace.json',rows);
  return rows;
}
const before=simulate('original',compiled),after=simulate('edited',revised);
const at=(rows,t)=>rows[Math.min(rows.length-1,Math.round(t*hostRate))];
assert.equal(at(before,1).request,.92);
assert.equal(at(after,1).request,.08);
assert.ok(at(after,1).opening+.3<at(before,1).opening);
assert.ok(after.some(r=>r.events.some(e=>e[0]==='stage.inspection'&&e[1]==='start'&&e[2]===.74)));
json('edited.recording.json',I.prepare(revised).recording());

function audition(rows){
  const notes=compiled.events.filter(e=>e.kind==='note'), sampleRate=24000;
  const pcm=Float64Array.from({length:Math.round(end*sampleRate)},(_,i)=>{
    const t=i/sampleRate, at=t*hostRate, j=Math.floor(at), a=at-j;
    const next=Math.min(j+1,rows.length-1), opening=rows[j].opening*(1-a)+rows[next].opening*a;
    let signal=0;
    for(const note of notes){
      if(t<note.time||t>note.end)continue;
      const local=t-note.time, envelope=Math.min(1,local/.016,(note.end-t)/.050);
      const phase=2*Math.PI*440*2**((note.value.pitch-69)/12)*local;
      signal+=note.value.velocity*envelope*(Math.sin(phase)+.16*Math.sin(2*phase)+.07*Math.sin(3*phase));
    }
    return .58*opening*signal;
  });
  return WAV.encode({sampleRate,channels:1,samples:pcm});
}
write('edited-audition.wav',audition(after));
json('comparison.json',{events:compiled.events.length,curves:Object.keys(compiled.curves).length,
  change:{id:'stage.inspection',before:1.28,after:.74,endBefore:1.61,endAfter:1.07},
  reviewAt:1,original:at(before,1),edited:at(after,1)});

const bg='#14212c',panel='#203444',well='#152735',grid='#3e5664',inkColor='#eef1d9',muted='#b4cbd1',
  mint='#8ce6bf',sky='#8bbcf5',violet='#d2b3fb',peach='#ffb283',gold='#ffe09b';
const groups=[['script','TEXT',mint],['ipa','IPA',violet],['midi','MIDI',sky],['desk','CONTROLLER',gold],['stage','CUES',peach]];
function canvas(width,height){
  const commands=[];
  const rect=(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill});
  const line=(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width});
  const text=(text,x,y,scale=2,color=inkColor)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color});
  const image=()=>PNG.packRGBA(K.procedural.drawing2d.render({width,height,commands,edges:'hard'}));
  rect(0,0,width,height,bg);
  return {rect,line,text,image};
}
function lanes(d,x,y,w,time,asset){
  const left=x+123, px=t=>left+w*t/end;
  for(const [i,[source,label,color]] of groups.entries()){
    const top=y+26*i;
    d.text(label,x,top+6,1,color);d.rect(left,top,w,18,well);
    for(const row of asset.events)if(row.source===source){
      if(row.end!==undefined){
        const band=row.kind==='word'?3:12;
        const start=px(row.time), width=px(row.end)-start;
        d.rect(start,top+(row.kind==='word'?15:2),Math.max(1,width-2),band,color);
        if(row.kind==='note'&&width>25)d.text(String(row.value.pitch),start+5,top+5,1,well);
      }else if(row.kind==='tempo'){
        d.rect(px(row.time)-1,top+15,3,3,color);
      }else{
        d.rect(px(row.time)-1,top+4,3,10,color);
      }
    }
  }
  d.line([[px(time),y-8],[px(time),y+126]],inkColor);
}
function chart(d,x,y,w,h,through,marker){
  const map=(t,v)=>[x+w*t/end,y+h*(1-v)];
  d.rect(x,y,w,h,well);
  for(const v of [0,.25,.5,.75,1])d.line([map(0,v),map(end,v)],grid);
  for(const t of [.6,1.2,1.8])d.line([map(t,0),map(t,1)],grid);
  for(const [rows,color] of [[before,sky],[after,peach]]){
    const points=rows.filter(r=>r.time<=through).map(r=>map(r.time,r.opening));
    if(points.length>1)d.line(points,color,2);
    const [a,b]=points.at(-1);
    d.rect(a-2,b-2,5,5,color);
  }
  d.line([map(marker,0),map(marker,1)],inkColor);
}
function gauge(d,x,y,w,row,title,color){
  d.text(title,x,y,1,color);
  d.rect(x,y+20,w,20,well);
  d.rect(x,y+20,w*row.opening,20,color);
  d.text(Math.round(row.opening*100)+'% OPEN',x,y+52,2,color);
}
function board(){
  const d=canvas(1120,755);
  d.rect(34,30,24,4,mint);
  d.text('INK STUDIO / INPUT COMPILERS',73,25,2,mint);
  d.text('Five sources on one clock',34,63,5);
  d.rect(34,142,1052,209,panel); d.rect(34,372,698,322,panel); d.rect(751,372,335,322,panel);
  d.text('COMPILED EVENTS / EDITED TAKE',54,158,2);
  lanes(d,54,200,884,1,revised);
  d.text('0 S',177,331,1,muted);d.text('2.4 S',1031,331,1,muted);
  d.text('EXECUTED VALVE APERTURE',54,391,2);
  chart(d,63,436,638,172,end,1);
  d.text('ORIGINAL CUE / 1.28 S',63,649,1,sky);d.text('EDITED CUE / 0.74 S',350,649,1,peach);
  d.text('AT 1.00 S',771,391,2);
  gauge(d,771,446,289,at(before,1),'ORIGINAL',sky);
  gauge(d,771,553,289,at(after,1),'EDITED',peach);
  d.text('THE SAME EVENT ID MOVES 540 MS AND KEEPS ITS 330 MS DURATION.',34,720,1,muted);
  return d.image();
}
write('input-compiler-comparison.png',PNG.encodeFrame(board()));
const frames=Array.from({length:Math.floor(end*fps)+1},(_,i)=>{
  const t=i/fps,d=canvas(826,510);
  d.text('MOVE ONE CUE / REPLAY THE ACTUATOR',25,23,2);
  d.text('TIME '+t.toFixed(2)+' S',26,61,1,muted);
  d.rect(24,84,778,155,panel);d.rect(24,256,778,226,panel);
  lanes(d,41,99,607,t,revised);
  chart(d,43,284,511,153,t,t);
  gauge(d,579,279,199,at(before,t),'ORIGINAL',sky);
  gauge(d,579,374,199,at(after,t),'EDITED',peach);
  return d.image();
});
write('input-compiler-demo.apng',PNG.encodeAnimation(frames,fps));
