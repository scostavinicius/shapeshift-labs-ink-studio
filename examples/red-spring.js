/* Red Spring Observatory. An original cave built to exercise pixel-stamp authoring. */
const Art = require('./pixel-stamp-studies.js');
const { rect, fill, line, pixel } = Art;
const W=272,H=160,U=.042,D=12;
const pos=(x,y,z)=>[(x-W/2)*U,(H-y)*U,z];
const cave = ['#0d1520','#14232d','#1b2b38','#243847','#2e4a55','#3a6268','#537f7d','#72a294','#a8c4a8',
  '#293638','#354a44','#4b6253','#6b775c','#323e48','#4f5760','#777b73','#a0987f',
  '#3c3135','#5c4142','#7c5250','#b07459','#e9b880','#fff2c4','#0a1019','#27323a','#4a5e65'];
const metals = ['#30272f','#4b3334','#6f4a40','#93644a','#b38458','#d2a470','#ecc78b','#f7e5ae'];
const water = ['#101e2b','#192e3a','#274553','#386272','#538b88','#83ada0','#bfd6b1'];

function chamber() {
  const s=[rect(0,0,0,W,H)];
  const mark=(slot,points)=>s.push(fill(slot,points));
  const cut=(slot,points,width)=>s.push(line(slot,points,width));
  mark(1,[[0,21],[43,17],[63,30],[93,30],[118,21],[161,6],[218,1],[272,6],[272,144],[0,153]]);
  mark(2,[[24,68],[55,46],[81,40],[102,42],[126,27],[150,20],[185,18],[214,27],[233,48],[250,98],
    [228,132],[186,142],[57,134],[0,129],[0,97]]);
  mark(3,[[65,93],[83,65],[101,56],[109,43],[131,29],[154,25],[191,27],[209,40],[222,62],[229,95],
    [209,122],[174,132],[79,132],[57,119]]);
  mark(4,[[98,96],[101,71],[111,62],[120,43],[145,32],[175,34],[193,46],[208,70],[212,99],[185,121],
    [136,130],[96,120]]);
  mark(5,[[111,103],[118,85],[117,75],[126,60],[129,51],[147,41],[165,38],[186,50],[194,75],[193,108],
    [172,118],[136,122],[111,116]]);
  mark(6,[[130,101],[132,76],[144,58],[158,50],[176,55],[182,72],[177,93],[185,104],[160,111],[138,111]]);
  mark(7,[[145,107],[145,84],[154,69],[168,66],[174,74],[168,99],[173,110]]);
  mark(8,[[153,107],[154,88],[159,77],[164,78],[164,99],[169,106],[163,110]]);
  mark(4,[[70,108],[109,97],[117,101],[134,99],[142,107],[178,108],[185,100],[205,97],[225,113],[216,125],
    [190,129],[145,127],[117,132],[78,129],[57,122]]);
  mark(3,[[57,119],[84,112],[108,115],[121,113],[137,118],[163,117],[179,113],[192,114],[210,109],[247,113],
    [272,125],[272,160],[0,160],[0,132]]);
  mark(2,[[0,130],[45,122],[75,126],[97,122],[120,126],[148,122],[167,126],[184,119],[225,124],[249,122],
    [272,131],[272,160],[0,160]]);
  mark(1,[[0,141],[48,137],[66,140],[104,136],[126,142],[146,137],[181,137],[218,141],[236,137],[272,147],[272,160],[0,160]]);
  mark(0,[[0,0],[109,0],[98,18],[77,21],[73,32],[62,37],[58,50],[43,56],[35,69],[32,94],[15,121],[0,126]]);
  mark(1,[[0,24],[31,21],[38,27],[55,28],[61,36],[55,47],[41,55],[34,69],[28,78],[24,76],[25,62],
    [17,56],[15,48],[0,49]]);
  mark(2,[[16,45],[31,37],[44,34],[55,35],[53,44],[37,50],[33,54],[26,59],[24,55],[29,47],[25,46]]);
  mark(3,[[0,74],[17,67],[25,70],[20,77],[13,78],[0,91]]);
  mark(0,[[176,0],[272,0],[272,143],[258,135],[244,119],[246,102],[241,90],[237,77],[231,74],
    [227,53],[213,45],[208,32],[197,27],[195,16]]);
  mark(1,[[191,0],[206,6],[210,17],[219,23],[222,34],[239,39],[244,49],[250,51],[250,66],[260,77],
    [265,89],[272,92],[272,0]]);
  mark(2,[[209,19],[230,16],[249,20],[252,29],[264,34],[272,31],[272,42],[258,47],[242,41],[233,37],
    [222,35],[220,27]]);
  mark(3,[[224,23],[239,20],[249,23],[254,32],[245,33],[235,29],[227,30]]);
  mark(5,[[52,84],[65,67],[79,65],[93,57],[90,63],[82,70],[80,76],[70,75],[64,83]]);
  mark(4,[[51,89],[63,81],[78,79],[88,72],[94,72],[87,81],[78,83],[73,88],[64,87],[59,93]]);
  mark(2,[[53,97],[58,89],[71,90],[80,87],[97,88],[95,97],[89,101],[74,101],[67,104],[56,102]]);
  mark(5,[[184,67],[193,60],[198,62],[205,70],[203,79],[211,83],[214,96],[207,95],[199,90],[199,83],[191,80]]);
  mark(3,[[195,82],[199,79],[202,86],[210,89],[221,86],[228,90],[228,101],[219,107],[205,105],[201,97]]);
  mark(4,[[207,93],[219,90],[225,93],[226,97],[215,96],[211,101],[202,99]]);
  mark(3,[[85,114],[92,108],[103,107],[109,105],[116,108],[117,112],[108,115]]);
  mark(2,[[190,111],[198,105],[210,105],[218,108],[219,111],[212,115],[193,115]]);
  mark(9,[[0,117],[21,114],[36,107],[55,109],[64,115],[80,119],[83,125],[63,131],[29,130],[0,142]]);
  mark(10,[[0,118],[22,114],[35,108],[48,110],[48,114],[31,117],[25,120],[0,126]]);
  mark(11,[[17,117],[34,109],[42,110],[38,112],[29,115]]);
  mark(9,[[211,119],[232,116],[242,111],[259,109],[272,110],[272,151],[255,150],[247,141],[229,136],[217,136],[204,128]]);
  mark(10,[[214,123],[233,117],[246,115],[253,110],[272,112],[272,120],[248,120],[240,124],[224,126]]);
  mark(11,[[223,121],[239,117],[247,115],[249,117],[242,120],[231,122]]);
  mark(23,[[0,147],[24,144],[42,145],[61,143],[73,148],[57,154],[61,160],[0,160]]);
  mark(23,[[225,141],[240,139],[254,141],[272,143],[272,160],[203,160],[211,154],[232,151]]);
  for (const [tone,points] of [
    [4,[[2,24],[20,22],[35,25],[43,25]]],[3,[[14,48],[20,46],[22,41],[37,37],[44,37]]],
    [4,[[66,51],[79,46],[87,46],[97,40]]],[5,[[89,62],[99,58],[105,49]]],
    [5,[[189,45],[199,54],[204,67]]],[4,[[216,62],[224,82],[222,95]]],
    [4,[[26,104],[40,100],[52,101],[57,98],[65,98]]],[11,[[3,120],[19,116],[26,116]]],
    [4,[[68,89],[75,88],[81,84]]],[3,[[72,97],[84,97],[89,95]]],
    [6,[[185,68],[191,62],[196,61]]],[5,[[199,97],[203,93],[211,92]]],
    [4,[[87,112],[93,109],[99,109]]],[4,[[194,110],[200,107],[207,107]]],
    [12,[[34,112],[41,110],[46,111]]],[5,[[71,107],[89,105],[98,105]]],
    [7,[[131,106],[140,105],[153,105]]],[8,[[148,112],[162,111],[175,111]]],
    [5,[[75,124],[88,122],[103,122]]],[5,[[160,126],[181,125],[194,126]]],
    [11,[[231,123],[242,120],[249,120],[258,116]]],[12,[[247,115],[254,112],[262,112]]],
    [2,[[9,142],[22,140],[43,140],[46,138],[55,138]]],[4,[[89,139],[104,138],[120,139]]],
    [3,[[181,142],[191,140],[208,140]]],[2,[[219,151],[237,149],[241,146],[259,146]]]
  ]) cut(tone,points,1.1);

  // Small hanging groups sharpen the foreground silhouette, and each sketch
  // uses connected marks so the bright opening stays the quietest region.
  for (const [x,y,len,wide] of [[12,6,38,9],[31,4,24,7],[63,5,37,8],[83,3,15,7],
    [190,1,17,6],[221,6,25,11],[248,4,40,10],[265,2,33,8]]) {
    mark(0,[[x-wide,y],[x+wide,y],[x+5,y+len*.42],[x+2,y+len*.70],[x,y+len],[x-2,y+len*.58],[x-5,y+len*.44]]);
    cut(2,[[x+wide-2,y+1],[x+4,y+len*.33],[x+2,y+len*.61]],1.1);
  }
  for (const [x,y,bright] of [[89,83,7],[101,77,6],[184,84,6],[204,96,7],[58,86,5],[67,78,6],
    [108,94,7],[121,90,7],[192,94,8],[221,95,6],[81,104,7],[203,105,7],[47,102,6]]) {
    s.push(pixel(bright-1,x,y),pixel(bright,x+1,y),pixel(bright-2,x+2,y+1));
  }
  return { width:W,height:H,palette:cave,strokes:s };
}

function poolSurface() {
  const s=[];
  for (const [slot,x,y,len] of [[1,2,5,36],[2,21,12,31],[2,54,7,26],[3,68,11,31],[2,97,13,39],
    [1,126,6,22],[2,8,22,40],[3,28,30,34],[2,62,26,29],[4,102,25,29],[3,118,33,24],
    [4,45,39,42],[2,12,46,28],[3,82,47,41],[4,115,43,25],[3,28,56,37],[2,72,53,25],
    [5,30,30,9],[5,71,11,8],[5,105,25,11],[5,90,47,8],[4,126,44,11]]) {
    s.push(line(slot,[[x,y],[x+len*.4,y],[x+len*.55,y-1],[x+len,y-1]],1));
  }
  return { width:152,height:60,palette:water,strokes:s,origin:'top-left' };
}

function reflection() {
  const palette=['#241522','#382437','#693148','#85334d','#b64856','#ea5b60'];
  const frames=Array.from({length:48},(_,f)=>{
    const gate=Math.max(0,Math.min(1,(f-13)/7,(39-f)/6)), strokes=[];
    for (let row=0;row<8;row++) {
      const phase=f*.47+row*.88, x=32+Math.sin(phase)*(2.8+row*.58);
      const width=(17-row*1.5)*gate;
      if (width < 1) continue;
      strokes.push(line(0,[[x-width-2,2+row*2],[x+width+2,2+row*2]],1),
        line(row<3?3:2,[[x-width*.87,2+row*2],[x-width*.26,2+row*2]],1),
        line(row<4?4:2,[[x-width*.03,2+row*2],[x+width*.41,2+row*2]],1),
        line(1,[[x+width*.62,2+row*2],[x+width,2+row*2]],1));
      if (row===1&&gate>.83) strokes.push(line(5,[[x,4],[x+2,4]],1));
    }
    return { duration:.125,strokes };
  });
  return {width:64,height:20,palette,frames,origin:'top-left'};
}

const paint = (stamp, projection, size, stage = 'lit', ink = false) => ({
  type:'projected',pattern:'indexed',stage,projection,raster:{ ...stamp,size },ink
});
const plane=(x,y,z)=>({ origin:pos(x,y,z),along:[1,0,0],across:[0,1,0] });

module.exports = ({KIT:K,makeBuilder,makeSculpt})=>({
  id:'red-spring',name:'Red Spring Observatory',seed:17,
  build(seed,{controls}={}) {
    const show=controls?.paint!==false, haunt=controls?.effects!==false;
    const { body,eye }=Art.flowingInk(), rock=Art.stonePaint();
    const bubbles=Object.fromEntries(['5x5','6x5','9x9'].map(size=>[size,Art.bubble(size)]));
    const glints=Object.fromEntries(['3x3','5x3','5x4','7x7'].map(size=>[size,Art.glint(size)]));
    const colors=[...new Set([...cave,...metals,...water,...rock.palette,...body.palette,...bubbles['5x5'].palette,...glints['3x3'].palette])];
    const palette=colors.map(color=>parseInt(color.slice(1),16)), ramp=colorset=>colorset.map(c=>colors.indexOf(c));
    const B=makeBuilder(seed,palette), S=K.sculpt(makeSculpt(B));
    Object.assign(S,{sun:K.V.norm([-.55,.79,.58]),amb:.30,sky:.22,sunK:.76,captureAlbedo:true});
    const dark={r:[0,1,2,3,4],materialId:'basalt',pixelStyle:{shadeSteps:5,edgeHardness:.92}};
    const stone={r:[1,2,3,4,5,6,7],materialId:'stone',pixelStyle:{shadeSteps:5,edgeHardness:1}};
    const copper={r:ramp(metals.slice(0,6)),materialId:'brass',pixelStyle:{shadeSteps:6,edgeHardness:1}};
    const waterMat={r:ramp(water.slice(0,3)),materialId:'water',pixelStyle:{shadeSteps:3,edgeHardness:1}};
    const box=(x,y,z,a,b,c,mat,res=.085,id)=>S.box(pos(x,y,z),[a*U,b*U,c*U],mat,{res,rd:res*.56,objectId:id});
    const ball=(x,y,z,a,b,c,mat,res=.074,id)=>S.ball(pos(x,y,z),[a*U,b*U,c*U],mat,{res,rd:res*.58,objectId:id});
    const lith=-.02;
    const moss = K.surface.material(stone,show ? {layers:{
      facing:paint(rock,plane(28,145,lith),[2.28,3.0],'material'),
      cuts:paint({ width:52,height:70,palette:rock.palette,origin:'top-left',strokes:[
        line(8,[[14,9],[18,6],[24,5]],1.15),line(7,[[20,51],[26,43],[30,43]],1.15),
        line(7,[[3,70],[15,65],[18,62]],1.1),line(4,[[35,62],[37,60],[46,56]],1.18)
      ] },plane(28,145,lith),[2.28,3.0],'lit',true)
    }} : {});
    ball(52,109,.65,22,37,15,moss,.063,'moss-spire');
    ball(28,134,.96,24,19,12,dark,.092,'left-scree');
    ball(69,141,1.21,16,13,12,stone,.078,'left-scree');
    ball(9,152,1.86,29,12,8,dark,.082,'near-scree');
    ball(246,144,1.45,29,19,14,dark,.11,'right-scree');
    ball(258,111,.9,16,20,14,stone,.079,'right-scree');
    ball(223,150,1.82,16,7,9,dark,.102,'near-scree');

    // A shallow slab under the stamp picks up the painted water highlights.
    const pool = K.surface.material(waterMat,{layers:{
      ...(show && {ripples:paint(poolSurface(),plane(69,153,0),[6.384,1.42],'lit',true)}),
      ...(haunt && {reflection:paint(reflection(),plane(108,148,0),[2.688,.63],'lit',true)})
    }});
    ball(146,138,-.63,79,17,24,pool,.117,'spring');
    for(const [x,y,w,h] of [[83,144,15,5],[97,149,12,4],[119,152,13,4],[154,154,17,4],[187,151,17,5],[211,142,12,6]])
      ball(x,y,.81,w,h,5,dark,.1,'curb');
    for(const [x,y,w] of [[214,135,10],[217,143,13],[220,151,16]])
      box(x,y,.76,w,2.4,3.3,stone,.074,'plinth');

    const wet = K.surface.material(copper,show ? {layers:{
      highlight:paint({ width:40,height:44,palette:metals,origin:'top-left',strokes:[
        fill(5,[[7,0],[18,0],[14,9],[12,15],[8,22],[4,23],[10,11]]),
        fill(4,[[20,1],[25,0],[25,6],[20,18],[18,19],[18,14]]),
        line(7,[[4,24],[12,24],[18,23],[24,23]],1.2),line(6,[[12,30],[17,30],[19,29]]),
        line(6,[[25,20],[30,19],[34,15]],1.1),line(6,[[5,8],[10,7],[14,7]],1.0)
      ] },plane(187,139,.24),[1.68,1.85],'lit',true)
    }} : {});
    ball(208,125,1.03,16,12,10,wet,.055,'brass-cistern');
    box(207,116,1.11,15,1.45,7.3,wet,.054,'brass-cistern');
    ball(207,112,1.36,11,3.8,6.4,copper,.061,'brass-cistern');
    for(const x of [192,222]) ball(x,124,1.39,3.3,4.3,3,copper,.053,'brass-cistern');
    const light={r:ramp(['#e9b880','#fff2c4']),em:true,materialId:'wick'};
    for (const [x,y,z] of [[14,98,.24],[231,96,-.2],[239,102,-.1]]) {
      box(x,y+4,z,2.3,4,2.8,copper,.042,'lamp');
      ball(x,y,z+.13,1.25,2.4,1.3,light,.028,'lamp');
    }
    S.bake();

    const field=[{stamp:chamber(),at:pos(W/2,H/2,-3.4),unitsPerPixel:U,objectId:'cave-paint'}];
    if (haunt) {
      field.push({stamp:body,at:pos(136,80,-.17),unitsPerPixel:U,objectId:'ink-body'},
        {stamp:eye,at:pos(136,80,-.156),unitsPerPixel:U,emissionSlots:[8,9,10],objectId:'red-eye'});
      for (const [x,y,z,size,phase] of [[208,116,1.48,'7x7',.76],[197,125,1.5,'5x4',.18],[214,121,1.51,'3x3',1.60],
        [100,143,.53,'5x3',1.25],[182,144,.59,'3x3',.04],[87,133,.4,'3x3',.95]])
        field.push({stamp:glints[size],at:pos(x,y,z),nativePixels:true,phase,objectId:'glint'});
      for (const [x,y,z,size,phase] of [[92,132,.56,'9x9',.08],[108,134,.47,'6x5',.97],[78,132,.62,'5x5',1.65],
        [183,135,.32,'9x9',.55],[196,139,.40,'6x5',1.72],[174,139,.61,'5x5',.82]]) {
        const at=t=>{
          const period=2, age=((t+phase)%period+period)%period;
          return pos(x+Math.round(Math.sin(age*4+phase)*2.1),y-Math.round(Math.min(1.43,age)*17),z);
        };
        field.push({stamp:bubbles[size],at,nativePixels:true,phase,objectId:'bubble'});
      }
    }
    const ink = show ? {
      silhouette:false,crease:false,boundary:false,occlusionSilhouettes:true,depthGap:.34,
      targets:[{ select:{object:'moss-spire'}, silhouette:{
        color:'#243847',contrast:{dark:'#14232d',light:'#72a294',minGain:.04},
        mask:{ type:'indexed', projection:plane(20,152,0),raster:{ width:64,height:83,size:[2.70,3.49],
          strokes:[fill(0,[[0,0],[49,0],[41,19],[25,41],[23,64],[13,66],[0,53]])] } }
      } }]
    } : false;
    return B.finish({
      cam:{target:pos(W/2,H/2,0),dist:D,pitch:0,yaw:0,sway:0,projection:'orthographic',fov:2*Math.atan(H*U/(2*D))},
      pixelStamps:field,detail:31,radius:16,dither:0,
      look:{ ink,splatCoverage:'continuous',effects:{glow:{radius:1,bands:1,colors:['#693148'],threshold:.84,depthBias:.09}} }
    });
  }
});
