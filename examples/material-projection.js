/* Relay Nine. The painted loading ramp changes projection while the harbor stays registered. */
const { rect,fill,line,pixel } = require('./pixel-stamp-studies.js');
const W=176,H=112, period=3.5;
const modes=[
  { name:'Perspective', projection:{} },
  { name:'Affine', projection:{mapping:'affine'} },
  { name:'Affine and Snap', projection:{mapping:'affine',vertexSnap:3} },
  { name:'Subdivided Affine', projection:{mapping:'affine',vertexSnap:3,subdivisions:4} }
];
const palettes=[
  '#142436','#1d3444','#254959','#35616b','#528481','#7aa499','#a7b9a3','#d3d1ad',
  '#292537','#4a3245','#73424a','#a15651','#d07956','#ed9f62','#ffc981','#ffe9ac',
  '#313758','#46416a','#625078','#846682','#ac818a','#cb9a95','#e9b39b','#f1cbab',
  '#1b2b3e','#304359','#425b70','#597b86','#4f4353','#735463','#9a706f',
  '#84c4b4','#b2e4cb','#f5dc9e','#274850','#111b28','#6ea7a4','#247172'
];
const rgb=rgba=> (rgba[0]<<16)|(rgba[1]<<8)|rgba[2];
const stamp=(K,w,h,strokes)=>K.pixelStamps.image({width:w,height:h,palette:palettes,strokes});
const paint=({width,rgba})=>(x,y)=>{
  const p=(y*width+x)*4;
  if (rgba[p+3]) return rgb(rgba.subarray(p,p+3));
};

function ramp(K,seed) {
  const w=128,h=184,strokes=[rect(0,0,0,w,h)];
  for(let y=0;y<h;y+=16) for(let x=0;x<w;x+=16) {
    const slot=x%32===y%32?3:2;
    strokes.push(rect(slot,x+1,y+1,15,15),rect(slot+1,x+1,y+1,14,1),rect(1,x+1,y+15,14,1));
    const j=4+Math.floor(K.hash(x,y,seed)*7);
    if ((x+y)%48!==0) {
      strokes.push(rect(2,x+j,y+5,5,1),rect(slot+1,x+3,y+j,3,1),pixel(1,x+j,y+6));
    }
  }
  for (const x of [6,120]) {
    strokes.push(rect(35,x-3,0,7,h),rect(34,x-1,0,3,h),rect(31,x,0,1,h));
    for (let y=3;y<h;y+=12) strokes.push(rect(14,x-2,y,4,2),pixel(37,x+2,y+1));
  }
  for (let y=13;y<h-9;y+=27) {
    strokes.push(fill(8,[[51,y+2],[64,y-4],[78,y+2],[78,y+8],[64,y+2],[51,y+8]]),
      fill(14,[[53,y+1],[64,y-4],[75,y+1],[75,y+5],[64,y],[53,y+5]]),
      line(13,[[53,y+4],[64,y],[75,y+4]]));
    for (const x of [28,99]) strokes.push(rect(34,x,y,2,4),pixel(6,x,y));
  }
  for (const y of [70,143]) {
    strokes.push(rect(0,10,y-1,108,6),rect(10,12,y+2,104,2),rect(13,12,y+1,104,1));
    for (let x=16;x<113;x+=11) strokes.push(line(15,[[x,y+2],[x+2,y]]));
  }
  return stamp(K,w,h,strokes);
}

function sky(K,seed) {
  const w=228,h=146,strokes=[];
  const bands=[[16,20],[17,32],[18,49],[19,62],[20,74],[21,82],[22,98],[23,h]];
  let top=0;
  for (const [slot,end] of bands) {
    strokes.push(rect(slot,0,top,w,end-top));
    top=end;
  }
  const cx=125,cy=72;
  for (let dy=-12;dy<=12;dy++) {
    const dx=Math.floor(Math.sqrt(152-dy*dy));
    strokes.push(rect(dy<4?15:14,cx-dx,cy+dy,dx*2+1,1));
  }
  for (const [x,y,wide,slot] of [[8,60,49,19],[70,63,43,20],[137,61,63,19],[80,73,52,21],
    [119,77,28,20],[168,77,45,21],[4,81,65,21],[168,83,26,22]]) {
    strokes.push(fill(slot,[[x,y+3],[x+4,y+1],[x+wide*.37,y+1],[x+wide*.44,y],[x+wide-6,y],
      [x+wide,y+1],[x+wide*.84,y+2],[x+wide*.78,y+4]]),rect(slot,x+wide+3,y+2,8,1));
  }
  strokes.push(fill(28,[[0,100],[16,98],[31,95],[38,97],[51,93],[60,96],[75,96],[86,90],
    [100,96],[115,95],[132,98],[146,93],[157,91],[179,95],[189,92],[208,95],[228,94],[228,h],[0,h]]),
    fill(25,[[0,106],[17,102],[38,105],[50,100],[72,103],[89,99],[110,104],[142,103],
      [159,99],[183,104],[196,100],[228,106],[228,h],[0,h]]));
  for (let i=0;i<74;i++) {
    const x=Math.floor(K.hash(i,seed,22)*w), y=105+Math.floor(K.hash(i,seed,28)*39);
    strokes.push(rect(i%5?26:27,x,y,2+i%8,1));
  }
  return stamp(K,w,h,strokes);
}

function cladding(K) {
  const w=96,h=48,strokes=[rect(0,0,0,w,h),rect(3,0,2,w,1),rect(1,0,29,w,17),rect(2,0,30,w,1)];
  for (let x=0;x<w;x+=16) {
    strokes.push(rect(2,x+1,5,14,21),rect(3,x+1,5,13,1),rect(0,x+13,7,1,18),
      rect(1,x+4,11,6,7),rect(4,x+4,11,6,1),rect(3,x+2,35,12,1),
      rect(10,x+4,38,5,2),pixel(13,x+5,38),pixel(7,x+12,8));
  }
  strokes.push(rect(4,0,45,w,1),rect(8,0,46,w,2));
  return stamp(K,w,h,strokes);
}

function signal(K) {
  const w=56,h=36,strokes=[rect(8,0,0,w,h),rect(16,2,2,52,32),rect(28,3,3,50,1),
    rect(25,2,28,52,6),rect(12,2,29,52,1)];
  const glyphs=K.inspection.font({});
  for (const [word,left,top,slot] of [['RELAY',8,6,7],['09',37,16,15]]) {
    for (const [i,ch] of [...word].entries()) {
      const glyph=glyphs.get(ch);
      for(let y=0;y<8;y++) for(let x=0;x<6;x++)
        if (glyph[y*6+x]) strokes.push(pixel(slot,left+i*7+x,top+y));
    }
  }
  strokes.push(fill(31,[[7,18],[15,12],[23,18],[19,18],[19,23],[11,23],[11,18]]),rect(27,26,20,6,1),
    pixel(13,4,31),pixel(13,51,31));
  return stamp(K,w,h,strokes);
}

function camera(time) {
  const beat=time*2*Math.PI/period;
  return { target:[.29*Math.sin(beat),.78,-.48+.24*Math.cos(beat)], yaw:.095*Math.sin(beat-.2),
    pitch:.19+.022*Math.cos(beat), dist:4.35-.32*Math.sin(beat), fov:.83 };
}

function scene({KIT:K,makeBuilder,SpriteSurface:A},seed,projection) {
  const pack=A.make(512);
  function tile(image) { return pack.reserve(image.width,image.height,paint(image)); }
  const skyline=tile(sky(K,seed)), deck=tile(ramp(K,seed)), sheet=tile(cladding(K)), warning=tile(signal(K));
  const solid=ink=>pack.reserve(1,1,()=>Number.parseInt(ink.slice(1),16));
  const steel=solid(palettes[2]), dark=solid(palettes[0]), metal=solid(palettes[29]), gold=solid(palettes[13]),
    lamp=solid(palettes[32]), rim=solid(palettes[4]);
  const panel=(at,right,up,art,opts)=>pack.faceRegion(at,right,up,art,opts);
  panel([-23,-11,-18],[46,0,0],[0,24,0],skyline);
  panel([-2.17,0,2.75],[4.34,0,0],[0,0,-11.75],deck,{id:'loading-ramp',projection});
  for (const side of [-1,1]) {
    const x=side*2.34;
    panel([x,-.48,2.85],[0,0,-11.85],[0,.46,0],sheet);
    panel([x-.11,-.012,2.9],[0,0,-11.88],[.22,0,0],rim);
    panel([x,-.02,-5.8],[0,0,-3.2],[0,1.43,0],sheet);
    panel([x,.14,1.69],[0,0,-10.6],[0,.043,0],gold);
    for (const z of [1.65,-.2,-2.1,-4,-5.8]) {
      panel([x-.08,-.01,z],[.16,0,0],[0,.33,0],dark);
      panel([x,.12,z-.05],[0,0,.11],[0,.18,0],steel);
      panel([x-.07,.26,z+.013],[.14,0,0],[0,.048,0],lamp);
    }
    panel([side*1.96-.24,0,-8.8],[.49,0,0],[0,3.65,0],sheet);
    panel([side*1.89-.37,3.43,-8.68],[.74,0,0],[0,.24,0],metal);
    panel([side*1.87-.21,3.56,-8.65],[.43,0,0],[0,.05,0],gold);
  }
  panel([-2.22,3.39,-8.8],[4.44,0,0],[0,.29,0],sheet);
  panel([-2.28,3.67,-8.74],[4.56,0,0],[0,.067,0],rim);
  panel([-.74,2.31,-8.46],[1.48,0,0],[0,.95,0],warning);
  for (const x of [-1.31,1.03]) panel([x,3.19,-8.70],[.28,0,0],[0,.10,0],lamp);
  return makeBuilder(seed,[0x142436]).finish({spriteSurfaces:pack.finish(),cam:camera(0),dither:0});
}

module.exports=kit=>({
  id:'material-projection',name:'Relay Nine',seed:92,
  build(seed,{controls:{mode='affine'}={}}={}) {
    const options={perspective:0,affine:1,snap:2,subdivided:3};
    if (!Object.hasOwn(options,mode)) throw new RangeError('Choose perspective, affine, snap or subdivided');
    const world=scene(kit,seed,modes[options[mode]].projection);
    kit.KIT.stage(world).add({update(_dt,time) { Object.assign(world.cam,camera(time)); }});
    return world;
  }
});

if (require.main===module) {
  const fs=require('node:fs'), path=require('node:path'), ink=require('..'), PNG=require('../cli/png.js');
  const compose=require('../src/frame-composite.js').compose, kit=ink.load(), {KIT:K}=kit;
  if (process.argv.length!==3) throw new Error('Usage: node examples/material-projection.js OUT_DIRECTORY');
  const directory=path.resolve(process.argv[2]), fps=12, gutter=4, caption=13;
  const worlds=modes.map(mode=>scene(kit,92,mode.projection));
  const points=[[0,0],[W+gutter,0],[0,H+caption+gutter],[W+gutter,H+caption+gutter]];
  const draw=points.map(([x,y],i)=>({type:'text',text:modes[i].name,at:[x+W/2,y+6],size:8,
    color:i===0?'#a6c6ca':'#ffe2a1'}));
  const width=W*2+gutter,height=(H+caption)*2+gutter;
  const blank={w:1,h:1,rgb:Uint8Array.of(20,27,40)};
  const frames=Array.from({length:period*fps},(_,i)=>{
    const layers=worlds.map((world,j)=>{
      const [x,y]=points[j];
      return {source:ink.render(world,{w:W,h:H,px:1,raw:true,...camera(i/fps)}),rect:[x,y+caption,W,H]};
    });
    const plan=K.frameComposite.prepare({layers:[...layers,{draw}]},width,height,1);
    return PNG.packFrame(compose(blank,K.frameComposite.layers(plan,{},0),width,height,'nearest'));
  });
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'relay-nine.apng'),PNG.encodeAnimation(frames,fps));
  console.log(directory);
}
