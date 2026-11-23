/* Cinder Foundry. A fired charge breaks, travels as a compound, and hits the cooling bed. */
const fs=require('node:fs');
const path=require('node:path');
const ink=require('..');
const PNG=require('../cli/png.js');

function definition() {
  const initial=[], entities={}, cell=.42;
  const charge=[
    {at:[4,6,3],material:'glass',temperature:830,wetness:.35,data:{vein:'blue glass'}},
    {at:[5,6,3],material:'slag',temperature:990,wetness:.12},
    {at:[6,6,3],material:'slag',temperature:910},
    {at:[4,7,3],material:'slag',temperature:800},
    {at:[5,7,3],material:'glass',temperature:725},
    {at:[5,8,3],material:'slag',temperature:565},
    {at:[5,7,2],material:'slag',temperature:900}
  ];
  function box(min,max,material){
    for(let z=min[2];z<=max[2];z++)for(let y=min[1];y<=max[1];y++)for(let x=min[0];x<=max[0];x++)
      initial.push({at:[x,y,z],material});
  }
  box([1,0,1],[22,0,4],'deck');
  box([3,1,3],[7,3,4],'basalt');
  box([4,4,3],[6,5,4],'basalt');
  box([13,1,2],[20,1,4],'bed');
  box([19,2,3],[20,2,4],'bed');
  initial.push(...charge);

  function fixture(name,position,half,ramp){
    entities[name]={position,visual:{half,ramp,materialId:'foundry-fixtures'}};
  }
  const steel=[1,2,3,4], brass=[12,13,14,15], grate=[8,9,10,11], footing=[2,3,4,5];
  fixture('cast-base',[0,-.18,.03],[4.84,.20,1.29],footing);
  fixture('foundation',[.14,-.44,.07],[4.56,.10,1.12],steel);
  fixture('rail-back',[-.05,.54,-.98],[4.49,.085,.068],steel);
  fixture('rail-front',[.02,.30,1.18],[4.47,.060,.052],steel);
  fixture('forge-wall',[-2.71,1.68,-.98],[1.22,1.43,.18],grate);
  fixture('forge-roof',[-2.71,3.38,-.73],[1.26,.20,.48],grate);
  fixture('forge-crown',[-2.71,3.60,-.83],[.95,.09,.31],steel);
  fixture('forge-post-left',[-3.84,1.94,-.63],[.11,1.36,.23],grate);
  fixture('forge-post-right',[-1.65,1.91,-.68],[.095,1.29,.17],steel);
  fixture('forge-lintel',[-2.73,3.11,-.54],[1.16,.085,.16],brass);
  fixture('forge-brace',[-3.67,2.07,-.43],[.07,.81,.12],brass);
  fixture('furnace-eye',[-3.82,2.68,-.35],[.10,.11,.05],[15,16,17,19]);
  fixture('chimney-lower',[-3.34,3.90,-.96],[.27,.25,.21],grate);
  fixture('chimney-cap',[-3.34,4.19,-.96],[.34,.085,.26],steel);
  fixture('quench-tank',[2.80,.62,-.99],[1.55,.23,.16],grate);
  fixture('quench-rail',[2.81,.87,-.73],[1.62,.043,.085],brass);
  fixture('quench-post-left',[1.24,.76,-.67],[.08,.28,.10],steel);
  fixture('quench-post-right',[4.44,.76,-.66],[.08,.28,.10],steel);
  for(let i=0;i<10;i++){
    const x=-4.42+i*.98;
    fixture('tread-'+i,[x,.04,1.06],[.055,.052,.10],i%2?brass:footing);
  }
  for(let i=0;i<7;i++)fixture('fin-'+i,[-3.47+i*.24,2.90,-.75],[.035,.12,.08],brass);
  for(let i=0;i<5;i++)fixture('bed-fin-'+i,[1.52+i*.59,.63,-.79],[.055,.19,.072],steel);
  for(const x of [-4.45,4.43]){
    const tag=x<0?'left':'right';
    fixture('beacon-'+tag,[x,.64,.90],[.08,.36,.08],steel);
    fixture('beacon-cap-'+tag,[x,1.03,.90],[.12,.075,.12],brass);
  }

  return {
    format:'ink-studio/world',version:1,id:'cinder-foundry',seed:184,dt:1/24,
    systems:{forge:{kind:'material-cells',config:{size:[24,13,6],origin:[-5.04,0,-1.26],cell,
      ambient:20,cooling:.21,conduction:1.15,settle:true,drag:.12,initial,
      materials:{
        basalt:{density:2.7,specificHeat:.84,ramp:[0x514b59,0x714b54,0x915155,0xbd754d,0xf4a362,0xffe5a9]},
        deck:{density:2.6,specificHeat:.94,ramp:[0x45596b,0x61627a,0x875d6a,0xb17b64,0xedba85]},
        bed:{density:2.5,specificHeat:.90,hotAt:380,ramp:[0x3b6973,0x456b78,0x586880,0x81667b,0xb78383,0xecc195]},
        slag:{density:2.62,specificHeat:1.05,hotAt:930,ramp:[0x483743,0x7c3b45,0xb44c41,0xe87342,0xffad57,0xffe5a1]},
        glass:{density:2.16,specificHeat:.83,hotAt:760,ramp:[0x344b72,0x57538a,0x825e93,0xc76a9e,0xf095b5,0xffcfba]}
      }
    }}},
    entities,
    visual:{volume:'forge',resolution:.13,look:{pixel:true},camera:{target:[0,1.82,0],dist:13.2,yaw:.19,pitch:.40,sway:0},
      palette:[0x233142,0x17222e,0x263847,0x3b4d5b,0x546a75,0x75878a,0x96a79e,0xbac5ac,
        0x332d3f,0x494053,0x625568,0x7f6d77,0x54404a,0x866055,0xb08865,0xd8aa75,0xf0c87e,0xffe4a3,
        0x6b3946,0xb85148,0xdf7156,0xf49d68,0x436770,0x5d8b8f,0x7fb0a0,0xb7cbb1],
      skyEnvironment:{defaults:{zenith:'#263a55',horizon:'#718484',ground:'#344351',sunStrength:0}}},
    commands:[{tick:11,action:'forge/lift',args:{body:'charge',cells:charge.map(row=>row.at),
      velocity:[5.36,1.66,.02],angular:[.6,.48,1.85],breakSpeed:3}}]
  };
}

function sequence(kit,end,visit){
  const {world:W}=kit.KIT, source=definition(), run=W.runtime.create(source);
  const charge=source.commands[0].args.cells, selected=new Set(run.query().probe('forge/cells').value
    .filter(row=>charge.some(at=>at.every((n,i)=>n===row.at[i]))).map(row=>row.id));
  let impact, lift;
  for(let tick=0;tick<=end;tick++){
    if(tick)run.step();
    for(const event of run.events){
      if(event.kind==='material-crumble')impact=event;
      if(event.kind==='material-lift')lift=event;
    }
    const query=run.query(), moving=query.probe('forge/pieces').value.charge;
    const parcels=(moving?.cells??query.probe('forge/cells').value).filter(row=>selected.has(row.id));
    const metrics=query.probe('forge/balance').value;
    const phase=moving?'rigid':impact?'cells-returned':'cells';
    visit({tick,phase,impact,lift,parcels,metrics,moving},run);
  }
  return {source,recording:run.recording(),impact,lift};
}

function render(kit,run,options={}){
  const world=kit.KIT.world.visual(kit,run.view(),run.query());
  return ink.render(world,{w:340,h:184,px:1,ortho:true,zoom:1.34,raw:true,t:0,...options});
}

if(require.main===module){
  const out=path.resolve(process.argv[2]??'studio/material-conversion');
  fs.mkdirSync(out,{recursive:true});
  const kit=ink.load(), frames=[], images=[];
  const {source,recording,impact,lift}=sequence(kit,58,(state,run)=>{
    const {tick,phase,parcels,metrics,moving}=state, name='frame-'+String(tick).padStart(3,'0')+'.png';
    const {w,h,rgb}=render(kit,run), file=path.join(out,name);
    PNG.write(file,w,h,rgb);
    images.push('data:image/png;base64,'+fs.readFileSync(file).toString('base64'));
    const tracked=parcels.find(row=>row.data?.vein==='blue glass');
    frames.push({tick,phase,temperature:tracked.temperature,wetness:tracked.wetness,energy:tracked.energy,
      parcel:tracked.id,mass:parcels.reduce((sum,row)=>sum+row.mass,0),point:tracked.point,cell:tracked.at,
      error:metrics.energyError,ambient:metrics.ambientEnergy,position:moving?.body.position});
  });
  if(!impact||!lift||impact.tick<=lift.tick+4)throw Error('The foundry demo needs a visible flight and measured impact');
  for(const [name,value] of Object.entries({'foundry.world':source,'foundry.run':recording,
    'foundry-trace':{frames,impact,lift}}))
    fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify(value,null,2)+'\n');
  const template=fs.readFileSync(path.join(__dirname,'material-conversion.html.template'),'utf8');
  fs.writeFileSync(path.join(out,'cinder-foundry.html'),template.replace('/* STUDY */',()=>
    'const { frames, images, impact, lift } = '+JSON.stringify({frames,images,impact,lift})+';'));
}
module.exports={definition,sequence,render};
