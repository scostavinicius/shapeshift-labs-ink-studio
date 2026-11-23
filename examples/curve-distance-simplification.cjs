/* Render the same cord studies with full detail and with authored curve LOD. */
const path = require('node:path'), ink = require('..'), { KIT: K } = ink.load(), C = K.curveSplats;
const PNG = require('../cli/png.js'), { write, json } = require('../cli/asset-files.js');
const out = path.resolve(process.argv[2] ?? 'studio/out/curve-distance-simplification');
const artWidth = 170, artHeight = 106, scale = 3, width = 1100, height = 690;
const count = 48, fps = 12, top = 175, left = [20, 570];
const bg = '#182534', inkColor = '#f1ece2', dim = '#a8bdcf', border = '#42596d';
const mint = '#97daca', amber = '#f4bf83', rose = '#e5a8ae';
const palette = ['#253644','#334d5d','#506877','#7e969d','#3b6468','#498482','#59a49b',
  '#75bbaf',mint,'#c4ead7','#694c51','#916251','#b57b5a','#d09a70',amber,'#ffe1a6',
  '#715568','#996d7b','#bd8994',rose,'#f1d2c6'];
const pathSource = (id, points) => ({kind:'path',id,points});
const sample = (n, f) => Array.from({length:n+1},(_,i)=>f(i/n));
const lodRange = [.17,.42];

const contour = pathSource('knotted-contour', sample(146,u => {
  const x = -2.42 + 4.84*u;
  // The broad bow blends early. The short knot still needs several bends.
  const knot = .30*Math.exp(-((u-.74)**2)/.008)*Math.sin((u-.74)*58);
  return [x,1.09+.24*Math.cos(2*Math.PI*u)+.13*Math.sin(7*Math.PI*u)+knot,.13*Math.sin(8*u)];
}));
const bands = [
  ['mint',.40,.075,'#75bbaf','#59a49b'],
  ['amber',-.27,.072,'#f4bf83','#d09a70'],
  ['rose',-.94,.069,'#e5a8ae','#bd8994']
].map(([id,y,pitch,color,coarse],band) => {
  const threads = Array.from({length:7},(_,j)=>({
    id:id+'-'+j,radius:.014,
    stations:sample(34,u => {
      const p = [
        4.48*(u-.5), y+(j-3)*pitch+.21*Math.sin(Math.PI*(2*u+.22*band))+.12*Math.sin(6*u+.51*band),
        .15*Math.sin(5.5*u)+.018*(j-3)+.06*band
      ];
      return {p,uv:[u,j/6],n:[0,0,1]};
    })
  }));
  return {source:{kind:'textile',plan:{threads}}, object:id, material:'filament', width:.034, edge:'hard', color,
    lod:{ simplify:lodRange, aggregate:{ transition:[.64,1.55], samples:18, color:coarse } } };
});
const fixtures = [-1,1].flatMap(side => [
  { source:pathSource('anchor-'+side,sample(19,u => {
    const a=Math.PI*2*u;
    return [2.25*side+.113*Math.cos(a),1.05+.113*Math.sin(a),.19];
  })), width:.046, edge:'hard', color:'#d09a70' },
  { source:pathSource('corner-'+side,[[2.35*side,-1.31,-.12],[2.50*side,-1.31,-.12],[2.50*side,-1.12,-.12]]),
    width:.047, edge:'hard', color:'#506877' }
]);
const recipe = {
  id:'filtered-fibre-bands',format:C.format,version:1,seed:7,background:bg,palette,
  camera:{target:[0,-.02,0],dist:6,yaw:0,pitch:.03},
  look:{edgeFilter:true},strands:[
    {source:contour,object:'contour',material:'wire',width:.083,edge:'hard',color:'#ffe1a6',lod:{simplify:lodRange}},
    ...bands,...fixtures
  ]
};
const world = C.world(recipe);
const rows = [];

function board(frame) {
  const phase = frame / (count - 1), travel = phase * phase * (3 - 2 * phase);
  const distance = 5.48 + 13.9*travel;
  const view = {w:artWidth,h:artHeight,px:1,t:frame/fps,dist:distance,ortho:true,
    yaw:-.07+.19*travel,pitch:.04+.065*Math.sin(Math.PI*travel),renderStats:true};
  const images = [ink.render(world,{...view,curveLod:false}),ink.render(world,view)];
  const [native,adaptive] = images.map(image=>image.renderStats);
  const { aggregateGroups = 0, blendingGroups = 0 } = adaptive.curveLod ?? {};
  const state = blendingGroups ? 'TRANSITION' : aggregateGroups ? 'MERGED COLOUR BANDS' : 'THREADS RESOLVED';
  rows.push({frame,distance,full:native.curveSegments,adaptive:adaptive.curveSegments,aggregateGroups,blendingGroups});
  const commands = [];
  const rect = (x,y,w,h,fill) => commands.push({type:'rect',rect:[x,y,w,h],fill});
  const text = (value,x,y,size,color=inkColor) => commands.push({type:'text',text:value,at:[x,y],scale:size,color});
  rect(0,0,width,height,'#111d2c');
  rect(20,28,30,4,mint);
  text('INK STUDIO / CURVE SPLATS',64,23,2,dim);
  text('Distance simplification',20,51,4);
  text('MATCHED ZOOM / 170 X 106 ART PIXELS',21,103,2,dim);
  text('Full detail',left[0],139,3,amber);
  text('Adaptive curves',left[1],139,3,mint);
  for (const x of left) {
    rect(x-1,top-1,artWidth*scale+2,artHeight*scale+2,border);
    rect(x,515,artWidth*scale,102,'#1b2d40');
  }
  text(String(native.curveSegments),left[0]+16,532,4,amber);
  text(String(adaptive.curveSegments),left[1]+16,532,4,mint);
  for(const x of left)text('RENDERED SEGMENTS',x+131,535,2,dim);
  text('FINE THREADS AT EVERY DISTANCE',left[0]+16,588,2);
  text(state,left[1]+16,588,2);
  text('CLOSE',20,636,2,dim);
  text('DISTANT',997,636,2,dim);
  rect(20,668,1060,4,border);
  rect(20,668,Math.max(1,1060*travel),4,mint);
  const board = K.procedural.drawing2d.render({width,height,commands,edges:'hard'});
  for (let k=0;k<images.length;k++) for (let y=0;y<artHeight*scale;y++) for(let x=0;x<artWidth*scale;x++) {
    const a=(Math.floor(y/scale)*artWidth+Math.floor(x/scale))*3, b=((top+y)*width+left[k]+x)*4;
    for(let c=0;c<3;c++)board.data[b+c]=images[k].rgb[a+c];
  }
  return PNG.packRGBA(board);
}

json(path.join(out,'fibre-bands.json'),recipe);
const animation = [];
for(let frame=0;frame<count;frame++){
  const image=board(frame);
  write(path.join(out,'frames','frame-'+String(frame).padStart(3,'0')+'.png'),PNG.encodeFrame(image));
  if(frame%2===0)animation.push(image);
  if(frame===5||frame===count-1)write(path.join(out,frame===5?'close.png':'distant.png'),PNG.encodeFrame(image));
}
write(path.join(out,'curve-distance-simplification-apng.png'),PNG.encodeAnimation(animation,fps/2));
json(path.join(out,'segment-counts.json'),{fps,frames:rows});
console.log('Rendered matched curve detail levels to '+out);
