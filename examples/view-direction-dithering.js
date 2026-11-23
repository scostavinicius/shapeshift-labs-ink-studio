/* The Moon Dial. A fixed enamel dial and a moving copper shutter. */
const W = 160, H = 108, period = 4;
const palette = [
  0x151b29,0x20283a,0x2f3d51,0x435568,0x5e7380,0x859b97,0xa6b59e,
  0x152a35,0x1b434e,0x356575,0x548c8c,0x79aaa0,0xb4cec0,0xe1dec0,
  0x31283a,0x543b43,0x86534d,0xbc795a,0xe3a671,0xf5ca8b,0xffe7aa,
  0x2b2d41,0x4b425a,0x68506c,0x986d83,0xbc8991,0xd3a4a3,0xe4c09e
];
const stone = { r:[1,2,3,4,5] }, bevel = { r:[0,1,2,3,4] };
const metal = { r:[14,15,16,17,18,19] }, bright = { r:[16,17,18,19,20] };
const bulb = { r:[18,19,20], em:true }, aqua = { r:[7,8,9,10,11,12] };
const camera = time => {
  const phase = .5 - .5 * Math.cos(time * Math.PI * 2 / period);
  return { yaw:-.29 + .58 * phase, target:[-.09 + .18 * phase,1.47,-.06] };
};
const ps = (x,y,z,r,lo,hi,n) => Array.from({length:n+1},(_,i)=>{
  const a = lo+(hi-lo)*i/n;
  return [x + r*Math.cos(a),y + r*Math.sin(a),z];
});

function build({ KIT:K, makeBuilder, makeSculpt }, seed) {
  const B = makeBuilder(seed,palette), S = K.sculpt(makeSculpt(B));
  const sun = K.V.norm([-.55,.65,.52]);
  S.sun=sun; S.amb=.55; S.sky=.18; S.sunK=.67;
  const box = (x,y,z,h,m,res=.075,rd=.04) => S.box([x,y,z],h,m,{res,rd});
  const bar = (sculpt,points,r,m,opts={}) => sculpt.tube(points,r,r,m,{res:r*.68,...opts});
  const ring = (sculpt,x,y,z,r,minor,m,opts={}) =>
    bar(sculpt,ps(x,y,z,r,0,Math.PI*2,42),minor,m,opts);

  const distant={r:[21,22,23,24,25]};
  for (const [x,y,z,rx,ry,rz] of [[-5,-.87,-5.8,3.6,1.52,1.8],[-.5,-1.1,-6.8,2.6,1.74,1.6],
    [3.2,-.79,-6.5,3.1,1.54,1.55],[6,-.8,-7.4,2.5,1.97,1.4]]) {
    S.rock([x,y,z],[rx,ry,rz],distant,{res:.24});
  }
  box(0,-.16,-.32,[4.2,.16,2.12],bevel,.105);
  for (let j=0;j<5;j++) for (let i=-7;i<=7;i++) {
    const shift=(j%2)*.24;
    box(i*.61+shift,-.038,1.48-j*.63,[.285,.047,.295],(i+2*j)%5===0?bevel:stone,.09,.015);
  }
  box(0,.16,-1.92,[3.65,.20,.18],stone,.087);
  box(0,.37,-1.89,[3.68,.047,.19],metal,.09);
  for (const side of [-1,1]) {
    const x=2.58*side;
    box(x,.17,-1.48,[.37,.23,.38],bevel);
    box(x,.30,-1.48,[.39,.058,.39],stone);
    S.lathe([x,.36,-1.48],2.05,[.25,.20],stone,{res:.081});
    S.lathe([x,2.40,-1.48],.12,[.22,.36],bevel,{res:.059});
    box(x,2.65,-1.48,[.40,.12,.35],stone,.072);
    for (const y of [.51,1.95,2.25]) S.lathe([x,y,-1.48],.056,[.286,.286],stone,{res:.063});
    for (const z of [.53,-1.23]) box(side*2.96,.53,z,[.11,.51,.13],bevel,.069);
    box(side*2.96,.85,-.35,[.11,.047,.98],stone,.080);
    box(side*3.12,1.06,.53,[.28,.048,.28],metal,.055);
    S.ball([side*3.12,1.14,.53],[.083,.104,.084],bulb,{res:.043});
  }
  K.build.arch(S,[0,2.59,-1.52],{span:4.78,height:1.39,thick:.29,depth:.36,block:.38,res:.085,mats:{stone}});

  // The main enamel face is fixed. Its curved rim shows how each pattern maps into depth.
  const x=-.58, y=1.62, z=.22, enamel = { r:[8,9,10,11,12], materialId:'enamel' };
  box(x,.14,.09,[1.22,.17,.69],bevel);
  box(x,.31,.11,[1.05,.075,.62],stone);
  box(x,.46,.12,[.80,.081,.50],metal,.068);
  box(x,.57,.01,[.59,.12,.35],stone);
  S.ball([x,y,z-.05],[1.13,1.05,.33],metal,{res:.050});
  S.ball([x,y,z+.09],[1.00,.96,.31],enamel,{res:.041,objectId:'moon-dial'});
  ring(S,x,y,z+.18,1.019,.056,bright,{res:.043});
  ring(S,x,y,z+.22,.923,.022,metal,{res:.031});
  for (let i=0;i<16;i++) {
    const a=i*Math.PI/8, major=i%4===0;
    const point=r=>[x+r*Math.cos(a),y+r*Math.sin(a),z+.09+.31*Math.sqrt(1-r*r)+.017];
    bar(S,[point(major?.73:.82),point(.90)],major?.026:.015,major?bulb:bright,{res:.029});
  }
  for (const a of [.29,2.85,3.43,5.98]) {
    const px=x+1.075*Math.cos(a),py=y+1.075*Math.sin(a);
    S.ball([px,py,z+.26],[.049,.049,.036],bulb,{res:.028});
  }
  bar(S,ps(x+.02,y-.01,z+.398,.40,-1.13,1.18,22).map(([px,py,pz])=>[px-.12,py,pz-.045]),.026,bright,{res:.032});
  bar(S,[[x-.31,y-.32,z+.355],[x,y,z+.43],[x+.39,y+.54,z+.339]],.023,bulb,{res:.030});
  S.ball([x,y,z+.43],[.072,.072,.042],metal,{res:.046});
  S.ball([x-.017,y+.017,z+.476],.025,bulb,{res:.021});
  for (const [xx,zz] of [[x-.88,.63],[x+.92,.64],[x-.8,-.3],[x+.85,-.29]])
    S.ball([xx,.405,zz],[.038,.034,.042],bright,{res:.029});

  // The smaller shutter turns with its axle, giving object space a moving subject.
  const mount=[1.57,1.11,.42];
  box(mount[0],.16,.37,[.62,.18,.57],bevel);
  box(mount[0],.35,.37,[.58,.076,.50],stone);
  S.lathe([mount[0],.37,.37],.65,[.32,.17],metal,{res:.065});
  bar(S,[[.49,.52,.22],[.79,.59,.45],[1.19,.59,.45],[1.53,.64,.38]],.047,metal);
  for (const j of [0,1]) box(1.57,.48-j*.075,.797,[.20,.018,.019],bright,.041,.011);
  S.bake();

  const T=K.sculpt(makeSculpt(B)), rig=K.rig(B,T), tag={tag:'shutter',res:.045};
  T.sun=sun; T.amb=.60; T.sky=.19; T.sunK=.61;
  const coral={r:[15,16,17,18],materialId:'shutter-enamel'};
  T.ball([0,.06,0],[.53,.53,.19],metal,tag);
  T.ball([0,.06,.078],[.447,.448,.17],coral,tag);
  ring(T,0,.06,.14,.47,.035,bright,tag);
  bar(T,[[-.24,-.17,.212],[0,.06,.27],[.19,.25,.21]],.022,bright,tag);
  bar(T,[[-.21,.10,.23],[0,.06,.27],[.21,.03,.23]],.017,aqua,tag);
  for (const px of [-.25,.25]) T.ball([px,.06,.226],.031,bulb,{...tag,res:.026});
  T.ball([0,.06,.264],.066,metal,tag);
  T.ball([0,.06,.319],.022,bulb,{...tag,res:.023});
  T.bake();

  const shader=(material,space,swatches,origin)=>({ material,palette:swatches,
    dither:{pattern:'bayer',strength:1,space,spacing:.047,origin} });
  const world=B.finish({
    cam:{target:camera(0).target,yaw:camera(0).yaw,pitch:.17,dist:6.4,sway:0,ortho:true},
    radius:9,dither:0,detail:25,
    skyEnvironment:{defaults:{zenith:'#33334f',horizon:'#b0838c',ground:'#594c66',
      sunAzimuth:Math.PI-.13,sunAltitude:.01,sunSize:.044,sunStrength:.79,sunColor:'#f7dba5'}},
    look:{splatCoverage:'continuous',paletteConstraints:{targets:[
      shader('enamel','view',['#28505c','#69928b','#aac0a4'],[.013,.019,.009]),
      shader('shutter-enamel','object',['#6d454e','#b57863','#dfad83'],[-.011,.024,.005])
    ]}}
  });
  const stage=K.stage(world);
  rig.bind(stage);
  stage.add({update(_dt,t) {
    const angle=.53*Math.sin(t*Math.PI*2/period-.30);
    rig.set('shutter',K.M.rot(K.V.norm([.16,1,.22]),angle),[0,.03,0],mount);
    rig.apply();
  }});
  return world;
}

module.exports = kit => ({
  id:'view-direction-dithering',name:'The Moon Dial',seed:43,build:seed=>build(kit,seed)
});

if (require.main===module) {
  const fs=require('node:fs'), path=require('node:path'), ink=require('..'), PNG=require('../cli/png.js');
  if (process.argv.length!==3) throw new Error('Usage: node examples/view-direction-dithering.js OUT_DIRECTORY');
  const directory=path.resolve(process.argv[2]), kit=ink.load(), { KIT:K }=kit;
  const world=build(kit,43), fps=12, packed=[], gutter=6, labelHeight=15;
  const width=W*2+gutter, height=(H+labelHeight)*2+gutter;
  const positions=[[0,0],[W+gutter,0],[0,H+labelHeight+gutter],[W+gutter,H+labelHeight+gutter]];
  const labels=['Screen','World','Object','View direction'];
  const draw=positions.map(([x,y],i)=>({ type:'text', text:labels[i], at:[x+W/2,y+8], size:9,
    color:i===3?'#ffe3ab':'#b6c7c8' }));
  const blank={w:1,h:1,rgb:Uint8Array.of(21,27,41)};
  const compose=require('../src/frame-composite.js').compose;
  const {image,report}=ink.reviewPaletteShimmer(world,{
    from:0,to:period,fps,width:W,height:H,includeView:true,view:{px:1,ortho:true},
    camera:(_phase,time)=>camera(time),pose:(scene,time)=>scene.anim.update(0,time),
    onFrame(_image,{tiles}) {
      const layers=tiles.map(({frame},i)=>{
        const [x,y]=positions[i];
        return {source:frame,rect:[x,y+labelHeight,W,H]};
      });
      const plan=K.frameComposite.prepare({layers:[...layers,{draw}]},width,height,1);
      packed.push(PNG.packFrame(compose(blank,K.frameComposite.layers(plan,{},0),width,height,'nearest')));
    }
  });
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'moon-dial.apng'),PNG.encodeAnimation(packed,fps));
  PNG.write(path.join(directory,'shimmer-comparison.png'),image.w,image.h,image.rgb);
  fs.writeFileSync(path.join(directory,'shimmer.json'),JSON.stringify(report,null,2)+'\n');
  console.log(directory);
}
