/* The same glazed cutout can cast as a card or as a carved clay slab. */
const { rect, line, fill, pixel } = require('./pixel-stamp-studies.js');
const W=51, H=75, LOOP=4.8;

function grille(K) {
  const rim=[[2,74],[2,28],[4,20],[8,13],[14,7],[20,3],[25,1],[31,3],[37,7],[43,13],[47,21],[49,28],[49,74]];
  const holes = [
    [[22,12],[25,8],[28,12],[28,19],[25,23],[22,19]],
    [[11,20],[16,15],[18,18],[17,25],[13,29],[10,28]],
    [[40,20],[35,15],[33,18],[34,25],[38,29],[41,28]],
    [[8,63],[8,42],[10,37],[13,33],[16,37],[17,42],[17,63]],
    [[20,65],[20,36],[22,29],[25,25],[28,29],[31,36],[31,65]],
    [[34,63],[34,42],[35,37],[38,33],[41,37],[43,42],[43,63]],
    [[12,69],[15,66],[18,69],[15,72]],[[22,69],[25,66],[28,69],[25,73]],[[33,69],[36,66],[39,69],[36,72]]
  ];
  const swatches=['#1c3540','#285263','#36747b','#57948c','#81b3a1','#abd0ae','#e1bd80','#905c51','#eedd9e'];
  const strokes=[
    fill(0,rim),
    fill(1,[[4,72],[4,27],[8,17],[15,9],[25,3],[34,8],[42,14],[47,26],[47,72]]),
    fill(2,[[5,70],[6,27],[10,17],[17,10],[25,6],[34,10],[41,16],[45,27],[45,70]]),
    line(4,[[4,70],[4,28],[8,17],[16,9],[25,4],[33,8],[40,13]],1),
    line(3,[[7,66],[7,29],[12,20],[19,13],[25,10],[32,13]],1),
    line(0,[[48,68],[48,30],[45,23],[41,18]],1),
    rect(1,4,63,43,3), rect(4,5,64,39,1),rect(1,3,70,45,3),
    rect(7,4,73,43,1),rect(6,4,72,41,1),
    rect(3,5,32,2,30),rect(1,44,33,2,30)
  ];
  holes.forEach((shape,i)=>{
    strokes.push(fill(i===4 ? 5 : 4,shape.map(([x,y])=>[x-1,y-1])));
    strokes.push(fill(1,shape.map(([x,y])=>[x+1,y+1])));
    strokes.push(fill(null,shape));
  });
  for (const [x,y] of [[7,26],[18,12],[25,5],[35,11],[43,23],[6,48],[45,57],[19,46],[32,46]]) {
    const shape=[[x,y-2],[x+2,y],[x,y+2],[x-2,y]];
    strokes.push(fill(7,shape),pixel(6,x,y),pixel(8,x,y-1));
  }
  for(const [x,y] of [[6,36],[7,18],[18,8],[30,8],[34,9],[41,16],[6,53],[45,53],[3,61],[11,70],[30,70],[41,70]])
    strokes.push(pixel(5,x,y));
  const paint=K.pixelStamps.image({width:W,height:H,palette:swatches,strokes});
  const front=[],back=[];
  for(let y=0;y<H;y++) for(let x=0;x<W;x++) {
    const p=(y*W+x)*4, clay=paint.rgba[p+3]!==0;
    const glaze=paint.rgba[p]===0x81 || paint.rgba[p]===0xab;
    const trim=x<6 || x>44 || y>65;
    const side = x<18 || x>32;
    const relief = glaze ? .031 : trim ? .018 : 0;
    const body = trim ? -.33 : side ? -.26 : -.16;
    front.push(clay ? relief : 0);
    back.push(clay ? body : 0);
  }
  return {paint,shadowShell:{front,back}};
}

module.exports = ({KIT:K,makeBuilder,makeSculpt,SpriteSurface}) => ({
  id:'painted-shadow-shells',name:'The Glaze Kiln',seed:53,period:LOOP,grille:()=>grille(K),
  build(seed,{controls:{shell=true,fog=true,study='kiln'}={}}={}) {
    if (!['kiln','mist'].includes(study)) throw new RangeError('Choose the kiln or mist study');
    const mist = study==='mist';
    const palette=[
      0x111d29,0x172a36,0x203644,0x2b4652,0x395867,0x516c73,0x72908a,
      0x212331,0x352d39,0x564049,0x79564d,0xab7758,0xd49b6a,0xf9ca84,0xffe6a8,
      0x172e36,0x24424a,0x30595d,0x417973,0x6ba08b,0xa0c1a1
    ];
    const { V }=K, B=makeBuilder(seed,palette), S=K.sculpt(makeSculpt(B)), A=SpriteSurface.make(400);
    Object.assign(S,{pixel:true,sun:V.norm([-.5,.71,.27]),amb:.47,sky:.11,sunK:.32,shLen:0});
    const tile={r:[1,2,3,4,5]}, grout={r:[0,1,2,3]}, glaze={r:[15,16,17,18,19]},
      bronze={r:[8,9,10,11,12,13]}, iron={r:[7,8,9,10]};
    const box=(p,h,mat,res=.13,rd=.05)=>S.box(p,h,mat,{res,rd});
    const facade=grille(K), region=A.reserve(W,H);
    A.faceRegion([-1.81,.53,.14],[1.67,0,0],[0,2.63,0],region,{
      id:'glazed-ceramic',castsShadow:true,...(shell&&{shadowShell:facade.shadowShell})
    });
    const wall=[0x304452,0x344952,0x38505a,0x405763,0x425d65,0x49636a];
    A.face([-4.75,-.01,-1.70],[9.5,0,0],[0,3.91,0],286,119,(x,y)=>{
      const row=Math.floor(y/14),shift=row%2*20,col=Math.floor((x+shift)/40);
      const u=(x+shift)%40,v=y%14;
      if(!u||!v) return 0x253737;
      const n=(row*11+col*7+2)%wall.length;
      if(v===1||u===1) return wall[Math.min(n+1,wall.length-1)];
      return (x*13+y*29+x*y)%139===0 ? wall[Math.max(0,n-1)] : wall[n];
    });
    const atlas=A.finish();
    SpriteSurface.update(atlas,region,{w:W,h:H,rgba:facade.paint.rgba});

    box([0,-.202,-.12],[4.85,.17,3.1],grout,.18,.076);
    for(let j=0;j<6;j++) for(let i=0;i<13;i++){
      const x=(i-6)*.735+(j%2)*.155,z=-1.36+j*.65;
      box([x,-.014,z],[.351,.038,.310],(i*7+j*11)%9===0?glaze:tile,.155,.034);
    }
    for(const y of [.14,3.71]){
      box([0,y,-1.60],[4.70,.095,.14],tile,.115,.045);
      box([0,y+(y<1?.112:-.112),-1.57],[4.67,.028,.09],glaze,.125,.021);
    }
    for(const x of [-4.12,3.98]){
      box([x,1.88,-1.57],[.22,1.70,.22],grout,.124,.063);
      for(const y of [.42,3.19]) box([x,y,-1.47],[.29,.087,.245],glaze,.105,.041);
      box([x,2.67,-1.30],[.097,.142,.046],bronze,.079,.029);
    }
    for(const x of [-1.81,-.14]){
      S.tube([[x,.21,.14],[x,2.87,.14]],.045,.039,bronze,{res:.053});
      box([x,.20,.14],[.12,.18,.12],tile,.067,.035);
      S.ball([x,2.77,.14],[.068,.075,.065],bronze,{res:.041});
      for(const y of [.71,2.25]) S.ball([x,y,.201],[.046,.052,.048],bronze,{res:.033});
    }
    box([-.975,.438,.13],[.918,.086,.113],glaze,.076,.029);
    box([-.975,.331,.13],[.976,.051,.132],grout,.085,.027);
    const rafter=[-1.77,3.95,2.06];
    box([rafter[0],3.97,1.04],[.171,.075,1.14],iron,.127,.053);
    S.ball(rafter,[.054,.055,.058],bronze,{res:.039});
    S.bake();

    const amount=t=>.5-.5*Math.cos(t*2*Math.PI/LOOP);
    const lampAt=t=>{
      const q=amount(t);
      return [-.978-1.83*q,1.86+.30*q,2.23-.87*q];
    };
    const lamp=K.frameSplats(B,84,(draw,_dt,time)=>{
      const p=lampAt(time), [x,y,z]=p;
      draw.streak(rafter,[x,y+.17,z],{width:.022,color:10,density:2.3,depth:true});
      draw.streak([x-.13,y+.13,z],[x+.13,y+.13,z],{width:.032,color:12,density:3.1,depth:true});
      draw.streak([x-.12,y-.12,z],[x+.12,y-.12,z],{width:.033,color:10,density:3.1,depth:true});
      for(const u of [-.12,.12])draw.streak([x+u,y-.11,z],[x+u,y+.11,z],{width:.019,color:11,density:2.9,depth:true});
      draw.point(p,{width:.158,rgb:[1,.57,.27],density:.62});
      draw.point([x,y-.011,z+.01],{width:.065,color:13,density:2.9,emissive:true,depth:true});
      draw.point([x,y+.011,z+.024],{width:.042,color:14,density:3.1,emissive:true,depth:true});
    });
    const aim=t=>V.sub([-.33+1.2*amount(t),1.60,-1.53],lampAt(t));
    const world=B.finish({
      cam:mist ? {target:[-.19,1.71,-.59],dist:7.86,yaw:.73,pitch:.20,ortho:true,sway:0,fov:.535} :
        {target:[-.22,1.87,-.57],dist:8.45,yaw:.44,pitch:.112,ortho:true,sway:0,fov:.535},
      radius:10,dither:0,detail:24,look:{splatCoverage:'continuous'},spriteSurfaces:atlas,
      areaLights:[K.lightEmitters.disc({id:'kiln-lamp',at:lampAt,normal:aim,visible:false,
        size:[.07,.08],sampleGrid:1,color:'#ffd091',radius:8,intensity:mist ? 5.3 : 13.5,volumeIntensity:mist ? 6.5 : 3.7})],
      volumeLighting:{ambient:mist ? .03 : .085},
      ...(mist&&{volumeQuality:{steps:192,stepScale:.32}}),
      atmosphere:fog?[K.atmosphere.box({min:[-3.30,.16,-1.67],max:[4.02,3.49,mist ? .11 : .30],
        density:mist ? .27 : .18,step:mist ? .099 : .135,color:mist ? '#9ac5c2' : '#a9c3c4',lit:true})]:[]
    });
    const stage=K.stage(world);
    stage.add(lamp);
    stage.stateful=false;
    stage.update(0,0);
    return world;
  }
});
