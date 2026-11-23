const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const {KIT:K}=require('../..').load(), W=K.world;
const PNG=require('../../cli/png.js');
const authored=require('./bench.domain.json'), world=require('./bench.world.json');
const setup=W.runtime.create(world);
const domain=W.domains.compile(authored,{query:setup.query(),snapshot:{world:world.id,tick:0}});
const throat=W.domains.trace(domain,domain.observations['outlet-throat'].section);
assert.equal(domain.complete,true);
assert.equal(throat.section.index,domain.tubes.upper.minima.area.index);
assert.deepEqual([...domain.nodes.tee.tubes],['feed','lower','upper']);

const dt=1/30, end=168, open=58;
const modelRef=key=>({$model:'/domain/'+key});
const pipeNames=Object.keys(domain.tubes);
const tuning={
  supply:{initial:11,area:4.5,precharge:0.42},
  tee:{capacity:1.7,initial:0.07,area:0.76},
  high:{capacity:1.1,initial:0.02,area:0.8},
  cavity:{initial:0.18,area:1.22},
  tail:{initial:0.08,area:1.75}
};
const nodes=Object.fromEntries(Object.entries(domain.nodes).map(([name,node])=>[name,{
  ...(node.volume>0&&{capacity:modelRef('nodes/'+name+'/volume')}),...tuning[name],position:modelRef('nodes/'+name+'/point')
}]));
const upperConductance=modelRef('tubes/upper/minima/area/value');
const parameters={feed:0.84,upper:upperConductance,lower:0.51,return:0.63};
const pipes=Object.fromEntries(Object.entries(domain.tubes).map(([name,tube])=>[name,{
  from:tube.from.node,to:tube.to.node,conductance:parameters[name],opening:name==='lower'?0:1,
  guides:tube.points.slice(1,-1)
}]));
const leaks=Object.fromEntries(Object.entries(domain.ports).filter(([,port])=>port.kind==='outlet')
  .map(([name,{node}])=>[name,{node,conductance:0.72,outsideHead:domain.nodes[node].point[1]}]));
const model={format:W.models.format,version:1,id:'manifold-flow',revision:1,seed:12,numerics:{dt},
  domain,parameters:{},initial:{},boundaries:{},
  operators:{network:{kind:'pipe-network',revision:1,config:{nodes,pipes,leaks}}},
  inputs:{'lower-valve':'network/valve.lower'},
  outputs:Object.fromEntries(pipeNames.map(name=>[name,'network/flow.'+name])),
  probes:{
    'manifold-pressure':{field:'network/nodes',args:{node:domain.observations['manifold-pressure'].node}},
    'chamber-pressure':{field:'network/nodes',args:{node:domain.observations['chamber-pressure'].node}},
    'outlet-throat':{field:'network/pipes',args:{pipe:domain.observations['outlet-throat'].tube}},
    mass:{field:'network/mass'}
  },
  commands:[{tick:open,input:'lower-valve',value:0.92}]
};

const run=W.runtime.create(model), tracks=[], advanceBy=Object.fromEntries(pipeNames.map(name=>[name,0]));
function record({tick,signals}) {
  const flows=Object.fromEntries(pipeNames.map(name=>{
    const value=signals['network/flow.'+name];
    advanceBy[name]+=value*dt*0.72;
    return [name,value];
  }));
  tracks.push({tick,flows,phase:{...advanceBy}});
}
record(run.view());
run.advance(end,{onTick:record});
const summary=W.models.sample(run);
assert.equal(tracks[open-1].flows.lower,0);
assert.ok(tracks.slice(open).some(row=>row.flows.lower>0.5));
assert.ok(Math.abs(summary.probes.mass.value.error)<1e-9);

const folder=path.resolve(process.argv[2]??'studio/out/branched-domain');
fs.mkdirSync(folder,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(folder,name),value);
const json=(name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
json('compiled-domain.json',domain);
json('upper-throat.trace.json',throat);
json('manifold.model.json',model);
json('report.json',{sectionCount:domain.sectionCount,ports:domain.ports,observations:domain.observations,
  tubes:Object.fromEntries(pipeNames.map(name=>[name,{length:domain.tubes[name].length,volume:domain.tubes[name].volume}])),
  valveTick:open,throat:{id:throat.section.id,area:throat.section.area,origin:throat.section.origin},summary});

const bg='#111c27',panel='#1c303d',paper='#eff3e9',muted='#aac6ce',grid='#45606d';
const gold='#ffc28c',mint='#99eabf',blue='#a5c8ff',light='#dceff8',pipeShade='#3e5561';
const colors={feed:light,upper:gold,lower:mint,return:blue};
const ortho=([x,y,z])=>[x+0.19*z,0.60*z-0.65*y-0.12*x];
const routes=Object.fromEntries(pipeNames.map(name=>[name,K.procedural.routes.polyline(domain.tubes[name].points)]));
const render=(width,height,commands)=>PNG.packRGBA(K.procedural.drawing2d.render({width,height,commands,edges:'hard'}));
const format=(n,digits=2)=>n.toFixed(digits);
function drawing() {
  const commands=[];
  return {commands,rect:(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill}),
    text:(text,x,y,scale=2,color=paper)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color}),
    line:(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width}),
    polygon:(points,fill)=>commands.push({type:'polygon',points,fill})};
}
const socketMarks=[
  ['feed-in',domain.ports['feed-in'],[-22,-29],blue],
  ['upper-exhaust',domain.ports['upper-exhaust'],[-93,-30],gold],
  ['return-exhaust',domain.ports['return-exhaust'],[-63,32],blue],
  ['manifold-pressure',domain.observations['manifold-pressure'],[-90,-42],light],
  ['chamber-pressure',domain.observations['chamber-pressure'],[-28,-46],mint],
  ['return-approach',domain.observations['return-approach'],[-17,-36],blue]
];

const portSockets=new Set(Object.values(domain.ports).map(port=>port.node+'/'+port.socket));

function network(draw,{x,y,scale,labels,frame}) {
  const project=point=>{
    const [u,v]=ortho(point);
    return [x+u*scale,y+v*scale];
  };
  for(const node of Object.values(domain.nodes))for(const [name,socket] of Object.entries(node.sockets)){
    if(socket.tubes.length||portSockets.has(node.id+'/'+name))
      draw.line([project(node.point),project(socket.point)],grid,2);
  }
  for(const name of pipeNames){
    const tube=domain.tubes[name], route=routes[name], points=tube.points.map(project);
    draw.line(points,pipeShade,scale*0.22);
    for(const row of tube.sections){
      const span=row.span.map(s=>project(route.sample(s/tube.length).point));
      draw.line(span,colors[name],Math.max(2,row.minimumOpening*scale*0.22));
    }
    if(frame&&Math.abs(frame.flows[name])>0.008)for(let i=0;i<6;i++){
      const t=((i/6+frame.phase[name]/tube.length)%1+1)%1;
      const [u,v]=project(route.sample(t).point);
      draw.rect(u-2,v-2,5,5,paper);
    }
  }
  for(const node of Object.values(domain.nodes)){
    const [x,y]=project(node.point), size=scale*0.21;
    if(node.kind==='reservoir'){
      draw.rect(x-size*1.5,y-size,size*3,size*2,'#284959');
      draw.rect(x-size*1.5,y-size,size*3,2,blue);
      draw.rect(x-size*1.5,y+size-1,size*3,2,blue);
    }else{
      const color=node.kind==='cavity'?mint:node.kind==='junction'?light:gold;
      const shape=[[x-size,y],[x,y-size],[x+size,y],[x,y+size]];
      draw.polygon(shape,panel);
      draw.line([...shape,shape[0]],color,2);
    }
    if(labels)for(const endpoint of Object.values(node.sockets)){
      if(!endpoint.tubes.length)continue;
      const [sx,sy]=project(endpoint.point);
      draw.rect(sx-2,sy-2,5,5,paper);
    }
  }
  const {section}=throat, contour=section.contours.find(row=>row.selected);
  const plane=contour.points.map(([u,v])=>project(K.V.mad(K.V.mad(section.point,section.u,u),section.v,v)));
  draw.polygon(plane,'#c07b53');
  draw.line([...plane,plane[0]],gold,2);
  if(labels){
    const [tipX,tipY]=project(section.point);
    draw.line([[tipX-4,tipY-8],[tipX-36,tipY-61],[tipX-155,tipY-61]],gold);
    draw.text('UPPER / 4',tipX-155,tipY-87,2,gold);
    draw.text('OUTLET THROAT',tipX-155,tipY-53,1,muted);
    for(const [name,site,[dx,dy],color] of socketMarks){
      const [sx,sy]=project(site.point);
      draw.rect(sx-2,sy-2,5,5,color);
      draw.text(name.toUpperCase(),sx+dx,sy+dy,1,color);
    }
    const [cx,cy]=project(domain.nodes.cavity.point);
    draw.text('2.85 CUBIC UNITS',cx-37,cy+33,1,mint);
    const [tx,ty]=project(domain.nodes.tee.point);
    draw.text('TEE',tx-17,ty+24,2,light);
    const [fx,fy]=project(domain.nodes.supply.point);
    draw.text('SUPPLY',fx-38,fy+31,2,blue);
  }
}

function board() {
  const d=drawing(), width=1180,height=866;
  d.rect(0,0,width,height,bg);
  d.rect(44,38,27,4,mint);
  d.text('INK STUDIO / SIMULATION',82,32,2,mint);
  d.text('Follow the branch',41,64,5);
  d.text('4 TUBES / 35 SECTIONS / 3 NAMED PORTS',45,125,2,muted);
  d.rect(44,164,1092,362,panel);
  d.text('SOCKETED MANIFOLD',65,185,2,paper);
  network(d,{x:590,y:394,scale:67,labels:true,frame:tracks.at(-1)});

  d.rect(44,548,697,272,panel);
  d.text('FLOW AFTER THE VALVE OPENS',63,566,2,paper);
  const x0=79,x1=701,y0=780,y1=626, peak=Math.max(...tracks.flatMap(row=>Object.values(row.flows)));
  const x=tick=>x0+(x1-x0)*tick/end, y=flow=>y0-(y0-y1)*flow/peak;
  for(const at of [y0,y0-48,y0-96,y1])d.rect(x0,Math.round(at),x1-x0,1,grid);
  d.rect(Math.round(x(open)),y1,1,y0-y1,muted);
  d.text('OPEN',x(open)+7,y1-14,1,muted);
  for(const [i,name] of ['feed','upper','lower','return'].entries()){
    d.text(name.toUpperCase(),63+137*i,601,1,colors[name]);
    d.line(tracks.map(row=>[x(row.tick),y(row.flows[name])]),colors[name],2);
  }
  d.text('0 S',76,795,1,muted);
  d.text(format(end*dt,1)+' S',671,795,1,muted);

  d.rect(756,548,380,272,panel);
  d.text('SECTION PROVENANCE',776,566,2,gold);
  d.text('PATH / UPPER-ROUTE R3',776,607,1,muted);
  d.text('SOURCE / THROAT-BORE R4',776,632,1,muted);
  const {section}=throat, inset=section.contours.find(row=>row.selected).points.map(([u,v])=>[948+200*u,704-200*v]);
  d.line([[863,704],[1034,704]],grid);d.line([[948,660],[948,748]],grid);
  d.polygon(inset,'#72563e');
  d.line([...inset,inset[0]],gold,2);
  d.text('AREA  '+format(section.area),776,776,2,paper);
  d.text('OPENING  '+format(section.minimumOpening),957,779,1,paper);
  d.text('SECTIONS KEEP THEIR AUTHORED PATH AND GEOMETRY REVISIONS',44,843,1,mint);
  return render(width,height,d.commands);
}

function frame(sample) {
  const d=drawing(), width=760,height=426;
  d.rect(0,0,width,height,bg);
  d.text('MANIFOLD PLAYBACK',24,23,3,paper);
  d.text('TIME '+format(sample.tick*dt)+' S',25,64,1,muted);
  d.text(sample.tick>=open?'LOWER VALVE OPEN':'LOWER VALVE CLOSED',524,64,1,sample.tick>=open?mint:gold);
  d.rect(24,86,712,243,panel);
  network(d,{x:381,y:221,scale:46,labels:false,frame:sample});
  d.rect(24,350,712,54,panel);
  for(const [i,name] of ['feed','upper','lower','return'].entries()){
    const x=39+i*174;
    d.text(name.toUpperCase(),x,361,1,muted);
    d.text(format(sample.flows[name]),x,382,2,colors[name]);
  }
  return render(width,height,d.commands);
}

write('branched-domain.png',PNG.encodeFrame(board()));
write('manifold-playback.png',PNG.encodeAnimation(tracks.filter(row=>row.tick%4===0).map(frame),{numerator:15,denominator:2}));
