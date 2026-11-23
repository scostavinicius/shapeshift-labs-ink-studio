/* Ridge Dispatch. One renderer packet drives a world monitor and its diagnostics. */
const studio = require('..');
const { makeStudy } = require('./projected-routes.js');
const W = 342, H = 202, FEED = [240,144];
const inspector = [217,42,111,67];
const swatches = [
  0x141823,0x222738,0x30394a,0x424e5e,0x586674,0x7d8b89,
  0x382c38,0x59404a,0x835b55,0xac795d,0xd7a77c,0xf0cea2,
  0x202c34,0x2d444b,0x3d5d5f,0x6c9388,0xaac1a1,
  0x6f3348,0xb94d55,0xef7462,0xffc17f,0xffebc4
];
const depthColors = [
  [103,158,145],[74,126,129],[56,100,114],[45,77,101],[37,58,81],[29,44,62],[22,32,48]
];
const box = (x,y,w,h,fill) => ({type:'rect',rect:[x,y,w,h],fill});
const text = (x,y,value,color) => ({type:'text',at:[x,y],text:value,color});
const line = (points,stroke,width=1) => ({type:'path',points,stroke,width});

function probe(frame,atlas,time) {
  const names = time>3.55 ? ['lower-signal','first-signal','switch-signal'] :
    ['first-signal','lower-signal','switch-signal'];
  const weights = new Map(names.map((name,priority) => [name,(names.length-priority)*1024]));
  const priorities = frame.owners.map(owner => weights.get(owner?.id) ?? 0);
  let best = -1, score = 0;
  for (let i=0;i<frame.ids.length;i++) {
    const rank=priorities[frame.ids[i]];
    if (!rank) continue;
    const ink=frame.data[i*4]-frame.data[i*4+2]+frame.data[i*4]/2;
    if (ink<45 || rank+ink<=score) continue;
    best=i;
    score=rank+ink;
  }
  if (best<0) return null;
  const x=best%frame.width, y=Math.floor(best/frame.width);
  return atlas.pick('ridge',(x+.5)/frame.width,(y+.5)/frame.height);
}

function inspectionImage(R, frame, hit) {
  const depth = R.raster(frame,'depth'), matte = R.mask(frame);
  const focus = hit && R.mask(frame,hit.owner.id);
  const model = R.raster(frame,'uv');
  const data = new Uint8Array(frame.data.length);
  for (let i=0;i<frame.ids.length;i++) {
    const p=i*4;
    if (!matte.data[i]) {
      data.set([14,23,32,255],p);
      continue;
    }
    const ring = Math.min(depthColors.length-1,Math.floor(Math.log2(1+depth.data[i]/2)));
    const seam = model.data[i*3] < .035 || model.data[i*3] > .965;
    const color = focus?.data[i] ? [246,103,73] : depthColors[Math.min(depthColors.length-1,ring+Number(seam))];
    data.set([...color,255],p);
  }
  return {w:frame.width,h:frame.height,rgba:data};
}

function inspectorPlate(K, sample) {
  const {hit,time} = sample;
  const pearl = '#e8d8ba', dim = '#6c8b86', edge = '#3e5962', orange='#f88f69';
  const commands = [
    box(207,13,129,182,'#111923'),box(209,15,125,178,'#1c2932'),
    box(210,16,123,2,edge),box(210,191,123,1,edge),
    box(210,18,1,172,'#344952'),box(332,18,1,172,'#101820'),
    box(216,41,113,69,edge),box(...inspector,'#0e1720'),
    text(217,24,'RIDGE DISPATCH',pearl),text(217,33,'DEPTH / SURFACE ID',dim),
    box(217,116,111,1,edge),text(217,123,'SELECTED SURFACE',dim),
    text(217,135,hit?hit.owner.id.replaceAll('-',' ').toUpperCase():'WAITING FOR SIGNAL',hit?orange:pearl),
    text(217,153,hit?`DEPTH  ${hit.depth.toFixed(2)}`:'DEPTH  --',pearl),
    text(217,164,hit?`UV  ${hit.uv.map(n=>n.toFixed(2)).join('  ')}`:'UV  --',pearl),
    box(217,177,111,1,edge),text(217,183,`FEED  ${time.toFixed(2)} S`,dim)
  ];
  return K.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands}).data;
}

function crosshair(K,hit) {
  const commands = [];
  if (hit) {
    const [left,top,w,h] = inspector;
    const x = left+Math.floor((hit.x+.5)*w/FEED[0]), y = top+Math.floor((hit.y+.5)*h/FEED[1]);
    for (const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]])
      commands.push(line([[x+3*dx,y+3*dy],[x+7*dx,y+7*dy]],'#ffd696'));
  }
  return K.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands}).data;
}

function dispatchRoom({KIT:K,makeBuilder,makeSculpt,SpriteSurface},seed) {
  const B = makeBuilder(seed,swatches);
  const S = K.sculpt(makeSculpt(B));
  Object.assign(S,{pixel:true,amb:.53,sky:.25,sun:K.V.norm([-.52,.72,.49]),sunK:.72});
  S.pixelSize(22);
  const navy={r:[0,1,2,3]}, iron={r:[1,2,3,4,5]}, enamel={r:[12,13,14,15]},
    brass={r:[6,7,8,9,10]}, cream={r:[7,8,9,10,11]}, rubber={r:[0,1]},
    red={r:[17,18,19,20],em:true}, amber={r:[9,10,20,21],em:true}, mint={r:[13,14,15,16],em:true};
  const block = (at,half,material,res=.08) => S.box(at,half,material,{res,rd:Math.min(...half)*.28});
  block([-.1,-.22,.15],[6,.22,2.2],navy,.18);
  block([.05,2.4,-1.08],[6,3,.27],navy,.18);
  for (const y of [.15,.51,3.66,4.16]) block([-.1,y,-.76],[6,.022,.075],iron,.16);
  for (const x of [-5.7,-4.62,1.05,4.45,5.42]) {
    block([x,2.11,-.73],[.07,2.16,.075],iron,.12);
    for(const y of [.56,1.47,2.39,3.31])
      block([x,y,-.642],[.021,.022,.015],enamel,.04);
  }
  block([-1.65,.37,.34],[2.74,.23,1.17],iron,.12);
  block([-1.65,.59,.31],[2.72,.045,1.15],enamel,.11);
  block([-1.65,.57,1.47],[2.68,.055,.027],brass,.09);
  block([-1.7,.86,-.01],[1.96,.23,.56],navy,.10);
  block([-1.7,2.22,.10],[2.4,1.38,.35],iron,.10);
  block([-1.7,2.24,.47],[2.23,1.265,.09],rubber,.09);
  block([-1.72,3.535,.47],[2.25,.034,.087],brass,.09);
  block([-1.75,.955,.50],[2.22,.045,.073],enamel,.09);
  for (const x of [-3.9,.49]) for (const y of [1.05,3.44])
    S.ball([x,y,.602],.043,cream,{res:.039});
  for (let i=0;i<8;i++) block([-3.73+i*.155,.773,.68],[.045,.022,.06],i%5?iron:amber,.045);
  for (const [x,material] of [[-.07,mint],[.07,mint],[.25,red]])
    S.ball([x,.771,.77],.048,material,{res:.035});
  block([-2.53,.654,1.32],[1.24,.06,.33],rubber,.09);
  for (let row=0;row<3;row++) for(let i=0;i<18;i++) {
    const x=-3.68+i*.127, z=1.13+row*.126;
    block([x,.722,z],[.045,.035,.046],i%7===0?brass:iron,.045);
  }
  block([-.03,.67,1.14],[.42,.075,.29],iron,.09);
  S.ball([-.07,.76,1.14],[.164,.066,.155],enamel,{res:.043});
  S.ball([-.07,.817,1.14],[.052,.028,.05],amber,{res:.037});
  S.tube([[-.15,.82,1.48],[-.02,.89,1.48],[.23,1.06,1.45],[.54,1.64,1.40],
    [.71,2.24,1.39],[.56,2.48,1.40],[.36,2.55,1.40]],.052,.052,brass,{res:.060});
  block([.29,2.57,1.42],[.16,.083,.103],enamel,.065);
  block([.29,2.542,1.532],[.12,.034,.016],mint,.045);
  for (const y of [1.1,1.68,2.26]) {
    block([-4.68,y,-.42],[.48,.195,.25],iron,.075);
    block([-4.71,y,-.154],[.34,.06,.022],enamel,.08);
    S.ball([-4.48,y+.01,-.109],.05,y>2?red:mint,{res:.04});
  }
  S.bake();

  const surfaces = SpriteSurface.make(272);
  const region = surfaces.reserve(...FEED);
  surfaces.faceRegion([-3.80,1.05,.632],[4.19,0,0],[0,2.39,0],region);
  surfaces.face([-3.74,.873,.642],[1.3,0,0],[0,.11,0],52,4,
    (x,y) => y===0 ? 0x50575c : (x%6===1&&y!==3?0x978575:0x20242d));
  const spriteSurfaces = surfaces.finish();
  return {B,region,spriteSurfaces};
}

module.exports = kit => ({
  id:'shared-render-outputs',name:'Ridge Dispatch',seed:39,
  build(seed) {
    const K = kit.KIT, R = K.renderOutputs, study = makeStudy(K,seed);
    const {B,region,spriteSurfaces} = dispatchRoom(kit,seed);
    const atlas = studio.createCameraAtlas({width:FEED[0],height:FEED[1],views:[{
      id:'ridge',rect:[0,0,...FEED],fps:12,
      source:({time}) => {
        const {route,rgba} = study.render(time);
        return R.create({...route,data:rgba});
      }
    }]});
    const sync = atlas.bindSurface(spriteSurfaces,'ridge',region);
    let monitor;
    function update(world,time) {
      if (!atlas.capture(world,{time}).updated.length) return;
      sync();
      const frame=atlas.outputs('ridge'), hit=probe(frame,atlas,time);
      monitor = {inspection:inspectionImage(R,frame,hit), chrome:inspectorPlate(K,{hit,time}),
        pointer:crosshair(K,hit)};
    }
    const world = B.finish({
      cam:{target:[.4,1.79,.25],dist:9.7,yaw:-.06,pitch:.14,fov:.72,ortho:true,sway:0},radius:5.15,
      detail:24,dither:.055,spriteSurfaces,look:{pixelSize:1,composite:{layers:[
        {source:()=>({w:W,h:H,rgba:monitor.chrome}),resolution:[W,H]},
        {source:()=>monitor.inspection,rect:inspector,resolution:FEED},
        {source:()=>({w:W,h:H,rgba:monitor.pointer}),resolution:[W,H]}
      ]}}
    });
    update(world,0);
    K.stage(world).add({update(_dt,time) { update(world,time); }});
    return world;
  }
});
