/* The Salt Lantern Basin. Two aligned terrain rasters and a painted dawn sky. */
const {rect,fill,line,pixel} = require('./pixel-stamp-studies.js');
const W=256,H=152, mapW=512,mapH=512, duration=8;
const bounds=[-190,190,-35,340];
const clip=(n,lo=0,hi=1)=>Math.max(lo,Math.min(hi,n));
const ease=(lo,hi,n)=>{
  const t=clip((n-lo)/(hi-lo));
  return t*t*(3-2*t);
};
const colors={
  rock:[
    ['#302841','#372d48','#4d354d','#594060','#6d526b','#8a667b'],
    ['#43304a','#53354d','#684053','#704b64','#8c6279','#a77a89'],
    ['#604056','#754459','#905365','#855773','#a67484','#be8d97'],
    ['#86545c','#9f5a63','#bd736e','#a46d7f','#bc8490','#d29da1'],
    ['#af6e66','#c37a6d','#e29578','#bf8487','#d59a9a','#e2afae'],
    ['#d49577','#e8a780','#ffcd9d','#d69891','#e5afa8','#efc1b5'],
    ['#b66568','#ce776a','#ef9a7d','#b97c88','#cf9298','#dfa7a6']
  ],
  salt:[
    ['#734c62','#965f75','#b17c8c','#cf95a0'],
    ['#ae747b','#b78290','#cd99a0','#e0adae'],
    ['#d39488','#d7a19d','#e2b2ac','#ebbcba'],
    ['#ecb6a1','#edb9ac','#eec2b8','#f4cbc0'],
    ['#ffdbb5','#f6ccb4','#f7d1c3','#f9d6c7']
  ],
  brine:[
    ['#213e52','#405071','#685f7c','#a57e91'],
    ['#2f5967','#4e6982','#807992','#b58b9b'],
    ['#427877','#648691','#988a9d','#c899a6'],
    ['#6f9b88','#88a2a0','#ae9da8','#d6abb0'],
    ['#acba99','#b3b8ac','#c1aeb1','#e1b6b8'],
    ['#d7d4a5','#d9cbb2','#e1c6ba','#edc3bc']
  ]
};

// Each rock swatch has separately painted low, middle and high alternatives.
// Haze then replaces any of those exact colors with a member of a second ramp.
const altitude={
  thresholds:[9,24],
  swatches:Object.fromEntries(colors.rock.map(row=>[row[0],row.slice(0,3)]))
};
const distance={
  thresholds:[55,112,212],
  swatches:Object.fromEntries([
    ...colors.rock.flatMap(row=>row.slice(0,3).map(color=>[color,[color,...row.slice(3)]])),
    ...[...colors.salt,...colors.brine].map(row=>[row[0],row])
  ])
};

// The apron, ledge profile and side spurs are painted separately from the top.
function mesa(x,z,[cx,cz,rx,rz,high,tilt=0]) {
  x-=cx+(z-cz)*tilt;
  z-=cz;
  const grooves=.065*Math.sin(x*.45+z*.07)+.045*Math.sin(z*.34-x*.11);
  const radial=Math.hypot(x/rx,z/rz)+grooves;
  const apron=.18*(1-ease(.70,1.44,radial));
  const ledge=.34*(1-ease(.54,.79,radial))+.33*(1-ease(.34,.54,radial));
  const crown=.15*(1-ease(.08,.33,radial));
  return high*(apron+ledge+crown);
}

const outcrops=[
  [-52,40,41,37,13,.63],[40,52,44,33,14,-.44],[72,96,38,31,28,-.32],[-85,119,49,48,25,.34],
  [-53,160,20,26,31,-.19],[61,171,43,34,46,.59],[-110,188,73,37,49,.68],
  [-46,204,52,40,38,.45],[14,217,36,29,32,-.51],[115,243,59,40,66,-.39],
  [-72,263,102,40,70,-.49],[10,292,49,34,51,-.21],[-150,270,75,54,80,.21]
];
const ridgeCenter=x=>55+3.8*Math.sin(x*.069)+2.1*Math.sin(x*.185);
const riverCenter=z=>-6+18*Math.sin((z-92)*.033)+7*Math.sin((z-90)*.077);
const shoreline=(x,z)=>{
  const main=Math.abs(x-riverCenter(z))-(4+13*ease(71,105,z)*(1-ease(139,177,z)));
  const strand=Math.abs(x-riverCenter(z)-16-6*Math.sin(z*.17))-1.55;
  return Math.min(main,strand+7*(1-ease(76,90,z)*(1-ease(121,142,z))));
};

function makeBasin(K,seed) {
  const height=new Float32Array(mapW*mapH), rgba=new Uint8Array(height.length*4), regions=new Uint8Array(height.length);
  const dx=(bounds[1]-bounds[0])/mapW,dz=(bounds[3]-bounds[2])/mapH;
  for (let j=0;j<mapH;j++) for (let i=0;i<mapW;i++) {
    const x=bounds[0]+(i+.5)*dx,z=bounds[2]+(j+.5)*dz, p=j*mapW+i;
    const dry=shoreline(x,z);
    const bottom=.50*ease(-1,8,dry)+.11*Math.sin(x*.35-z*.19)*Math.sin(z*.41);
    const width=10+2.25*Math.sin(x*.18)+1.9*Math.sin(x*.41+z*.04);
    const foothill=1-ease(.23,1.85,Math.abs(z-ridgeCenter(x))/width);
    const crest=1-ease(.09,.84,Math.abs(z-ridgeCenter(x))/width);
    const ridge=(.41*foothill+.59*crest)*(18+4.5*Math.sin(x*.113+.9)+2.3*Math.sin(x*.34)+
      3.9*Math.sin(x*.051-1))*(1-.78*ease(56,111,Math.abs(x)));
    const spurs=outcrops.reduce((high,rock)=>Math.max(high,mesa(x,z,rock)),0);
    const rock=Math.max(ridge,spurs);
    const strata=Math.floor(rock*1.57)/1.57;
    const cuts=.58*Math.sin(x*.54+z*.24)*Math.sin(x*.22-z*.36)+.27*Math.sin(x*1.52+z*.66);
    height[p]=Math.max(bottom,(.60*strata+.40*rock)+cuts*ease(1,8,rock));
  }
  const packed=new Map(Object.values(colors).flatMap(rows=>rows.map(row=>[
    row[0],row[0].slice(1).match(/../g).map(s=>parseInt(s,16))
  ])));
  for (let j=0;j<mapH;j++) for (let i=0;i<mapW;i++) {
    const x=bounds[0]+(i+.5)*dx,z=bounds[2]+(j+.5)*dz, p=j*mapW+i, y=height[p];
    const shore=shoreline(x,z);
    const dX=(height[j*mapW+Math.min(mapW-1,i+1)]-height[j*mapW+Math.max(0,i-1)])/(2*dx);
    const dZ=(height[Math.min(mapH-1,j+1)*mapW+i]-height[Math.max(0,j-1)*mapW+i])/(2*dz);
    const patch=K.hash(Math.floor((x+Math.sin(z*.32)*2)/2.7),Math.floor(z/1.25),seed);
    const vein=y+.34*Math.sin(x*.31)+.14*Math.sin(z*.27);
    const seam=vein-Math.floor(vein/3.8)*3.8;
    let row;
    if (y>1.35) {
      const light=(.54*dX+.87*dZ+.72)/Math.hypot(1,dX,dZ);
      const color=Math.round(2.45+1.9*light+(patch-.5)*.8-(seam<.36?.8:0));
      row=colors.rock[seam>.39&&seam<.68&&color>=3?6:clip(color,0,5)];
      regions[p]=z<80?2:3;
    } else if (shore<.30&&z>72&&z<245) {
      const wave=Math.sin(z*1.25+Math.sin(x*.65));
      const stripe=wave>.91&&(Math.sin(z*.71-x*.49)+Math.sin(x*.14+z*.05)>.44);
      const color=shore>-.06?5:shore>-.5?4:shore>-1.4?3:shore>-2.8?2:patch>.74&&stripe?3:patch>.44?1:0;
      row=colors.brine[color];
      regions[p]=1;
    } else {
      const cut=Math.sin(x*.72+Math.sin(z*.37)*1.1)+Math.sin(z*.91+Math.sin(x*.48));
      const terrace=Math.sin((shore+.3*Math.sin(z*.36))*2.10)+.35*Math.sin(z*.61+x*.55);
      const crust=shore<2.5&&z>73&&z<245;
      const color=crust?terrace>.45?4:3:cut<-1.53&&patch>.24?1:cut>1.1?3:patch>.92?0:2;
      row=colors.salt[color];
    }
    rgba.set(packed.get(row[0]),p*4);
    rgba[p*4+3]=255;
  }
  return K.heightmapFlyover.create({
    bounds,heights:{width:mapW,height:mapH,data:height},paint:{w:mapW,h:mapH,rgba},
    regions:{names:['salt flats','brine channels','near escarpment','distant mesas'],data:regions},
    altitude,distance
  });
}

function makeSky(K,seed) {
  const width=W+100,height=H+66, cx=199,cy=48;
  const palette=[
    '#292b57','#39345e','#524064','#664a69','#835974','#a17083','#b9828d','#ce999c',
    '#e0aca6','#edbeaa','#f7d09c','#ffe2ab','#ffefc7','#8d607d','#6f5476'
  ];
  const strokes=[];
  const bands=[[0,10],[1,20],[2,33],[3,45],[4,55],[5,65],[6,72],[7,81],[8,92],[9,height]];
  let top=0;
  for (const [slot,bottom] of bands) {
    strokes.push(rect(slot,0,top,width,bottom-top));
    top=bottom;
  }
  for (let y=-16;y<=16;y++) {
    const wide=Math.floor(Math.sqrt(273-y*y));
    strokes.push(rect(y<1?12:y<9?11:10,cx-wide,cy+y,2*wide+1,1));
  }
  const cloud=[
    [49,39,42,3,3],[68,49,71,4,4],[4,59,80,6,5],[96,57,52,3,5],
    [174,54,95,4,5],[213,62,86,4,6],[259,44,82,5,4],
    [28,72,89,3,7],[120,72,55,2,7],[223,76,105,3,8],[8,83,61,2,8]
  ];
  for (const [x,y,w,h,c] of cloud) {
    strokes.push(fill(c,[[x,y+h],[x+5,y+h-2],[x+w*.31,y+h-2],[x+w*.39,y],[x+w-8,y],
      [x+w,y+1],[x+w*.83,y+2],[x+w*.87,y+h],[x+w*.41,y+h]]));
    strokes.push(line(c+1,[[x+4,y+h+1],[x+w*.34,y+h+1],[x+w*.43,y+h]]));
    strokes.push(rect(c,x-9,y+h,6,1),rect(c+1,x+w+4,y+1,11,1));
  }
  for (let i=0;i<61;i++) {
    const x=Math.floor(K.hash(i,seed,51)*width),y=Math.floor(K.hash(i,seed,52)*29);
    strokes.push(pixel(i%9?4:7,x,y));
  }
  return K.pixelStamps.image({width,height,strokes,palette});
}

function camera(time) {
  const t=clip(time/duration);
  const climb=ease(.09,.67,t);
  return {
    at:[-13+23*t,10.8+22*climb-2.4*ease(.80,1,t),10+75*t],
    yaw:.052-.154*Math.sin(t*1.69),
    horizon:68-15*climb,fov:1.07,near:.35,far:284
  };
}

function makeStudy(K,seed) {
  const basin=makeBasin(K,seed), sky=makeSky(K,seed);
  return (time,controls={})=>{
    const view=camera(time);
    const frame=basin.render({width:W,height:H,camera:view,...controls});
    const rgba=new Uint8Array(frame.data);
    const trackX=Math.round(46+view.yaw*100), trackY=Math.round(75-view.horizon);
    for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
      const p=y*W+x;
      if (frame.ids[p]) continue;
      const j=((y+trackY)*sky.width+x+trackX)*4;
      rgba.set(sky.rgba.subarray(j,j+4),p*4);
    }
    return {w:W,h:H,rgba};
  };
}

module.exports=({KIT:K,makeBuilder})=>({
  id:'heightmap-flyover',name:'The Salt Lantern Basin',seed:67,
  build(seed,{controls:{altitudeBands=true,distanceBands=true}={}}={}) {
    const study=makeStudy(K,seed);
    return makeBuilder(seed,[0x39345e]).finish({
      look:{composite:{world:{resolution:[8,8]},layers:[{
        resolution:[W,H],filter:'nearest',
        source:({time})=>study(time,{altitudeBands,distanceBands})
      }]}}
    });
  }
});
module.exports.makeBasin=makeBasin;
module.exports.camera=camera;
module.exports.dimensions=[W,H];
