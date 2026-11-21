/* Render the drawing studies as alpha-aware Ink rasters, then composite them at native resolution. */
const fs = require('node:fs');
const path = require('node:path');
const { KIT } = require('..').load();
const PNG = require('../cli/png.js');
const { drawing2d, materials, raster } = KIT.procedural;
const width = 560, height = 332;
const ink = '#090a0e', white = '#f5f3f7', muted = '#a1a7b6';
const linear = (from,to,opacity) => ({from,to,opacity});
const radial = (center,radii,opacity) => ({type:'radial',center,radii,opacity});
const rect = (x,y,w,h,fill,falloff) => ({type:'rect',rect:[x,y,w,h],fill,falloff});
const line = (points,color,width = 1,falloff) => ({type:'path',points,color,width,falloff});
const text = (x,y,label,color = muted,scale = 1) => ({type:'text',at:[x,y],text:label,color,scale});
const ellipse = (x,y,r,fill) => ({type:'ellipse',rect:[x-r,y-r,r*2,r*2],fill});
const diagramText = '#8492a5';

function arc(cx,cy,r,start,end) {
  return Array.from({length:100},(_,i) => {
    const t = start+(end-start)*i/99;
    return [cx+r*Math.cos(t),cy+r*Math.sin(t)];
  });
}

function band(center,outer,inner,angles,fill,stroke,width,fillFalloff,strokeFalloff) {
  const [x,y]=center, [start,end]=angles;
  return { type:'polygon', points:[...arc(x,y,outer,start,end),...arc(x,y,inner,end,start)],
    fill,stroke,width,fillFalloff,strokeFalloff };
}

function guides(spec) {
  const {origin, step, cutouts = [], columns = [], rows = [], crosses, color, markColor, falloff} = spec;
  const entries = (axis,lines) => lines.map(([index,from,to,dash]) => ({axis,index,span:[from,to],dash}));
  return {type:'registrationGrid',origin,step,color,markColor,falloff,markWidth:1.1,
    guides:[...entries('u',rows),...entries('v',columns)],
    crosses:crosses.map(([u,v,size]) => ({at:[u,v],size})),omit:cutouts};
}

function fadeStudy() {
  const center=[270,173], angles=[-2.69,1.12];
  return [
    rect(0,0,width,height,ink),
    rect(0,0,width,height,'#316a9e43',radial([270,164],[12,217])),
    {type:'grid',origin:[39.5,32.5],step:[40,38],counts:[12,7],majorEvery:4,
      color:'#708aac63',majorColor:'#89a6c578',
      uFalloff:linear([71,0],[474,0],[.96,.14]),
      vFalloff:linear([0,265],[0,55],[.88,.06])},
    band(center,125,84,angles,'#72d4e67a','#e8f8ff',1.2,
      linear([164,110],[352,221]),linear([303,80],[414,269],[1,.14])),
    line(arc(...center,68,-2.69,1.12),'#7d9ec299',.8,radial([297,108],[18,144])),
    line([[351.5,78.5],[369.5,61.5],[424.5,61.5]],'#87a8bd95'),
    text(434,58,'STROKE','#a7c7db'),
    line([[219.5,87.5],[199.5,145.5],[152.5,145.5]],'#87a8bd95'),
    text(119,142,'FILL','#a7c7db'),
    ellipse(351.5,78.5,1.5,'#b3e7fc'),
    ellipse(219.5,87.5,1.5,'#b3e7fc')
  ];
}

function fanStudy() {
  return [
    rect(0,0,width,height,ink),
    {type:'rayFan',origin:[177,270],angles:[-1.28,-.13],radii:[38,246],
      count:98,width:.58,color:'#8facfa8b'},
    {type:'rayFan',origin:[163,233],angles:[-1.11,.12],radii:[60,259],
      count:74,width:.52,color:'#d5a2fa62'},
    line(arc(177,270,246,-1.28,-.13),'#8295ca67',.8),
    line(arc(177,270,38,-1.28,-.13),'#bfc9ec9d',.8),
    ellipse(177,270,2.3,'#e5e9f8'),
    line([[49.5,270.5],[169.5,270.5]],'#51617c'),
    text(50,255,'ORIGIN','#9aaecb'),
    text(51,54,'RADIAL SPACING','#a8badb'),
    text(51,70,'TWO OVERLAPPING FANS','#677892')
  ];
}

function registrationStudy() {
  const origin=[48.5,39.5], step=[77,50];
  const chart = Array.from({length:41},(_,i) => {
    const t=i/40;
    return [204+t*166,197-t*50+9*Math.sin(18*t)+8*Math.sin(7*t)];
  });
  return [
    rect(0,0,width,height,ink),
    guides({origin,step,color:'#4d576a',markColor:'#dce4f2',
      columns:[[0,0,5],[1,.2,4.75],[2,0,5],[3,0,5],[4,0,5],[5,.2,4],[6,0,5]],
      rows:[[0,0,6],[1,0,6,[.037,.046]],[2,0,6],[3,0,6,[.055,.04]],[4,0,6],[5,0,6]],
      cutouts:[[1.63,1.51,2.81,2.26]],
      crosses:[[0,0,13],[2,1,8],[4,4,9],[6,0,9],[6,5,13]]}),
    {type:'polygon',points:[[185,122],[376,122],[376,218],[185,218]],fill:'#111825',stroke:'#9aadbf',width:1},
    line([[195.5,201.5],[364.5,201.5]],'#37485d'),
    line(chart,'#97d7e0',1.4),
    text(206,134,'LEVEL TRACE','#c7d7ec'),
    text(263,253,'GUIDES CLIPPED AT INSET',diagramText),
    text(59,71,'DASHED GUIDE',diagramText)
  ];
}

const grain = materials.blueNoise({width:32,seed:82});
function ambience(w,h) {
  const value = raster.canvas({width:w,height:h});
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const u=x/w*width, v=y/h*height;
    const cool = Math.exp(-((u-325)**2/18100+(v-199)**2/5100));
    const warm = Math.exp(-((u-224)**2/8100+(v-125)**2/5400));
    const horizon = Math.min(1,Math.max(0,(309-v)/70));
    const noise = (grain.sample(x,y)-.5)*8*Math.min(1,cool+warm);
    const at = (y*w+x)*4;
    value.data[at] = 9+(cool*15+warm*45)*horizon+noise;
    value.data[at+1] = 10+(cool*37+warm*11)*horizon+noise;
    value.data[at+2] = 14+(cool*75+warm*28)*horizon+noise;
    value.data[at+3] = 255;
  }
  return value;
}

function combinedStudy(phase) {
  const c=[297,177], angles=[-2.39,1.88], sway=Math.sin(2*Math.PI*phase), breathe=Math.cos(2*Math.PI*phase);
  return [
    guides({origin:[48.5,32.5],step:[77,52],color:'#8394b368',markColor:'#c1cad9',
      columns:[[0,0,5],[1,0,5],[2,0,5],[3,0,5],[4,0,5],[5,0,5],[6,0,5]],
      rows:[[0,0,6],[1,0,6],[2,0,6,[.035,.045]],[3,0,6],[4,0,6],[5,0,6]],
      crosses:[[0,0,9],[2,1,8],[6,5,11]],
      falloff:linear([0,40],[0,280],[.83,.1])}),
    {type:'rayFan',origin:[152+sway*12,247+breathe*6],angles:[-1.38,-.07+sway*.06],radii:[29,328],
      count:124,width:.47,color:'#bac7fa83',falloff:linear([203,152],[504,234])},
    {type:'rayFan',origin:[203+sway*10,250],angles:[-1.3,-.2],radii:[45,268],
      count:94,width:.42,color:'#e0a9df5c',falloff:radial([249,158],[6,202])},
    band(c,114,83,angles,'#151e32c9','#d2dffc',1.12,
      radial([349,149],[29,190],[.93,.12]),linear([338,91],[203,223],[1,.08])),
    line(arc(...c,114,-1.21,.12),'#f5f6ff',1.35,linear([378,108],[411,229],[.98,.34])),
    line(arc(...c,127,-1.3,.92),'#b6d9fb74',.7,linear([312,55],[398,258])),
    line(arc(...c,68,-2.39,1.88),'#b4bddf60',.7,radial([324,129],[17,143])),
    line([[395.5,120.5],[464.5,120.5]],'#a6b8d693'),
    ellipse(395.5,120.5,1.7,'#cce5ff'),
    text(471,117,'LIT EDGE','#b2c2da'),
    text(56,40,'APERTURE','#c4c8d4')
  ];
}

function scaleDraw(command, scale) {
  if (scale === 1) return command;
  const scaled = {...command};
  const xy = pair => pair.map(value=>value*scale);
  for (const key of ['origin','radii','rect','at'])
    if (command[key]) scaled[key]=xy(command[key]);
  if (command.points) scaled.points=command.points.map(xy);
  if (command.step) scaled.step=Array.isArray(command.step) ? xy(command.step) : command.step*scale;
  if (command.crosses) scaled.crosses=command.crosses.map(mark=>({...mark,size:mark.size*scale}));
  for (const key of ['width','majorWidth','markWidth'])
    if (command[key]) scaled[key]=command[key]*scale;
  for (const key of ['falloff','fillFalloff','strokeFalloff','uFalloff','vFalloff']) {
    const fade=command[key];
    if (fade) scaled[key]=fade.type === 'radial'
      ? {...fade,center:xy(fade.center),radii:xy(fade.radii)}
      : {...fade,from:xy(fade.from),to:xy(fade.to)};
  }
  if (command.type === 'text') {
    scaled.at=scaled.at.map(Math.round);
    scaled.scale=Math.max(1,Math.round((command.scale??1)*scale));
  }
  return scaled;
}

const studies = [fadeStudy,fanStudy,registrationStudy,combinedStudy];
const ambienceByWidth = new Map();
const captions = [
  ['INDEPENDENT FADES','FILL / STROKE / GRID AXES'],
  ['RAY FANS','ANGLE / SPACING / ORIGIN'],
  ['REGISTRATION GRID','CROSSES / DASHES / CUTOUT'],
  ['COMBINED STUDY','FADES / RAYS / GUIDES']
];
function draw(commands,w=width,h=height) {
  return drawing2d.render({width:w,height:h,commands});
}
function render(index,scale=1,phase=0) {
  const w=width*scale, h=height*scale;
  const image=draw(studies[index](phase).map(command=>scaleDraw(command,scale)),w,h);
  if (index !== 3) return image;
  if (!ambienceByWidth.has(w)) ambienceByWidth.set(w,ambience(w,h));
  return raster.stack({width:w,height:h,layers:[{source:ambienceByWidth.get(w)},{source:image}]}).value;
}
function save(target,{width,height,data}) {
  fs.writeFileSync(target,PNG.encode(width,height,data,4));
}

const out=process.argv[2];
if (!out) throw new Error('Usage: node examples/drawing-falloff-studies.cjs <out-dir> [--frames]');
fs.mkdirSync(out,{recursive:true});
const images=studies.map((_,i)=>render(i));
const gap=13, edge=22, tileHeight=height+33;
const w=edge*2+width*2+gap, h=edge*2+tileHeight*2+gap;
const labels=[rect(0,0,w,h,'#171a22')];
const tiles=images.map((source,i)=>{
  const x=edge+(i%2)*(width+gap), y=edge+Math.floor(i/2)*(tileHeight+gap);
  labels.push(rect(x,y+height,width,33,'#20242e'),text(x+12,y+height+12,captions[i][0],white),
    text(x+width-12-captions[i][1].length*6,y+height+12,captions[i][1],'#939cad'));
  return {source,x,y};
});
save(path.join(out,'drawing-studies.png'),raster.stack({width:w,height:h,
  layers:[{source:draw(labels,w,h)},...tiles]}).value);
save(path.join(out,'drawing-aperture.png'),render(3,1.5));
if (process.argv.includes('--frames')) {
  const dir=path.join(out,'frames');
  fs.mkdirSync(dir,{recursive:true});
  for (let i=0;i<84;i++)
    save(path.join(dir,String(i).padStart(3,'0')+'.png'),render(3,1.5,i/84));
}
