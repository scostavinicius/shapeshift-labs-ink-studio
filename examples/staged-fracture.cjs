/* Cinder Foundry follow-up: a quenched glaze cracks, then an impact sheds a corner. */
const fs=require('node:fs');
const path=require('node:path');
const ink=require('..');
const PNG=require('../cli/png.js');
const foundry=require('./material-conversion.cjs');

function definition(){
  const source=foundry.definition(), {commands,systems:{forge:{config}}}=source;
  source.id='cinder-foundry-fracture';
  const launch=commands[0], [glass,root,corner]=launch.args.cells;
  delete launch.args.breakSpeed;
  launch.args.fracture={strength:240,impact:1,thermal:.21,minCoolingRate:245,
    seams:[{cells:[glass,root],strength:6.5},{cells:[root,corner],strength:.46}]};
  commands.push({tick:18,action:'forge/heat',args:{body:'charge',at:glass,energy:-24}});
  config.materials.glass.ramp=[0x354462,0x4a6683,0x598998,0x7eb4b0,0xb0e0c8,0xdbf0d2];
  config.materials['corner-slag']={...config.materials.slag,
    ramp:[0x472f3b,0x8e483c,0xd7824a,0xfec36b,0xffe0a1,0xfff0c6]};
  const tip=config.initial.find(row=>row.at.every((n,i)=>n===corner[i]));
  tip.material='corner-slag';
  return source;
}

function sequence(kit,last,visit){
  const {world:W}=kit.KIT, source=definition(), run=W.runtime.create(source);
  const read=name=>run.query().probe('forge/'+name).value;
  const [glass,root,corner]=source.commands[0].args.cells, equal=(a,b)=>a.every((n,i)=>n===b[i]);
  const track=read('cells').find(row=>equal(row.at,corner)).id;
  const seamIds=[{key:'Glaze seam',strength:6.5,a:glass,b:root},{key:'Corner seam',strength:.46,a:root,b:corner}];
  const stages={}, broken=new Map(), wanted=new Set(['material-lift','material-crack','material-fracture','material-crumble']);
  const events=[];
  for(let tick=0;tick<=last;tick++){
    if(tick)run.step();
    for(const event of run.events){
      if(!wanted.has(event.kind))continue;
      events.push(event);
      if(event.kind==='material-lift')stages.lift=event;
      if(event.kind==='material-crack')for(const seam of event.seams){
        const match=seamIds.find(({a,b})=>equal(a,seam.cells[0])&&equal(b,seam.cells[1]));
        if(match)broken.set(match.key,true);
        if(seam.cause==='cooling')stages.quench??=event;
        if(seam.cause==='impact')stages.impact??=event;
      }
      if(event.kind==='material-fracture')stages.split??=event;
      if(event.kind==='material-crumble'&&event.cells.some(row=>row.parcel===track))stages.loose??=event;
    }
    const pieces=read('pieces'), main=pieces.charge, balance=read('balance');
    const carried=Object.values(pieces).flatMap(row=>row.cells);
    const chip=carried.find(row=>row.id===track)??read('cells').find(row=>row.id===track);
    const seams=seamIds.map(({key,a,b,strength})=>{
      const bond=main?.bonds.find(row=>equal(a,row.cells[0])&&equal(b,row.cells[1]));
      return {name:key,damage:broken.has(key)?1:(bond?.damage??0)/strength};
    });
    visit({tick,seams,chip:chip.temperature,chipAt:chip.at,chipId:track,rigid:Boolean(main),count:main?.cells.length??0,
      massError:balance.massError,energyError:balance.energyError,heat:balance.energy,phase:stages.loose?
        'loose':stages.split?'split':stages.quench?'cracked':stages.lift?'flying':'kiln',position:main?.body.position},run);
  }
  return {source,recording:run.recording(),stages,events};
}

function crop(frame){
  const {w,h,passes}=frame;
  const charge=new Set(['glass','corner-slag'].map(name=>passes.materials.indexOf(name)).filter(i=>i>0));
  let left=w,top=h,right=0,bottom=0;
  for(let p=0;charge.size&&p<passes.materialId.length;p++){
    if(!charge.has(passes.materialId[p]))continue;
    const x=p%w, y=Math.floor(p/w);
    left=Math.min(left,x);right=Math.max(right,x);
    top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  const x=left===w?108:(left+right)/2, y=top===h?73:(top+bottom)/2;
  return [Math.max(0,Math.min(w-64,Math.round(x)-32)),Math.max(0,Math.min(h-52,Math.round(y)-26))];
}

if(require.main===module){
  const out=path.resolve(process.argv[2]??'studio/staged-fracture');
  fs.mkdirSync(out,{recursive:true});
  const kit=ink.load(), frames=[], images=[];
  const result=sequence(kit,52,(frame,run)=>{
    const image=foundry.render(kit,run,{passes:['materialId']}), {w,h,rgb}=image;
    const filename='fracture-'+String(frame.tick).padStart(3,'0')+'.png';
    const file=path.join(out,filename);
    PNG.write(file,w,h,rgb);
    images.push('data:image/png;base64,'+fs.readFileSync(file).toString('base64'));
    frames.push({...frame,crop:crop(image)});
  });
  const {quench,impact,split,loose}=result.stages;
  if(!quench||!impact||!split||!loose||quench.tick>=impact.tick||frames.at(-1).count!==6)
    throw Error('The study needs a cooling crack, a later impact, a deposited corner and a surviving rigid piece');
  for(const [name,data] of Object.entries({'fracture.world':result.source,'fracture.run':result.recording,
    'fracture-trace':{stages:result.stages,frames,events:result.events}}))
    fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify(data,null,2)+'\n');
  const template=fs.readFileSync(path.join(__dirname,'staged-fracture.html.template'),'utf8');
  fs.writeFileSync(path.join(out,'cinder-fracture.html'),template.replace('/* STUDY */',()=>
    'const { frames, images, stages } = '+JSON.stringify({frames,images,stages:result.stages})+';'));
}
module.exports={definition,sequence};
