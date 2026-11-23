/* Three handcrafted materials share one moving light and keep exact highlight texels. */
const PERIOD = 4.8;
const rect = (x,y,w,h,fill) => ({ type:'rect', rect:[x,y,w,h], fill });
const oval = (x,y,w,h,fill) => ({ type:'ellipse', rect:[x,y,w,h], fill });
const poly = (points,fill) => ({ type:'polygon',points,fill });
const text = (x,y,label,color) => ({ type:'text', at:[x,y], text:label, color });

const brass = () => [
  oval(3,8,56,56,'#241e2b'), oval(4,6,56,56,'#634052'), oval(3,4,56,56,'#ac7056'),
  oval(6,6,50,50,'#d49a63'), oval(7,9,48,48,'#9d6151'),
  oval(11,10,43,44,'#f0b973'), oval(12,13,40,39,'#563b43'),
  oval(15,14,34,34,'#2b3c43'), oval(17,16,31,31,'#3e5456'),
  poly([[31,15],[34,26],[43,30],[36,33],[34,42],[30,37],[22,41],[25,33],[19,29],[28,25]],'#203840'),
  poly([[32,17],[34,27],[42,30],[35,32],[32,40],[30,35],[24,38],[27,31],[22,29],[29,27]],'#c08a58'),
  poly([[32,20],[32,28],[37,30],[32,31],[31,36],[30,31],[26,29],[30,28]],'#efc88b'),
  rect(30,5,3,1,'#f4cc87'), rect(20,7,6,1,'#e5b476'),
  rect(9,32,2,6,'#834a43'), rect(12,43,2,4,'#824849'), rect(46,47,3,2,'#ca8c60'),
  rect(29,52,6,1,'#a06854'), rect(50,14,2,2,'#944e49'), rect(42,8,4,1,'#e3a868'),
  rect(6,24,2,4,'#c5915c'), rect(52,38,2,3,'#b17351')
];
const enamel = () => [
  poly([[31,2],[43,9],[55,22],[61,34],[54,48],[42,58],[31,64],[18,58],[6,47],[1,34],[7,21],[18,9]],'#342c3d'),
  poly([[31,3],[42,10],[54,23],[59,33],[53,44],[41,55],[31,60],[18,54],[8,44],[3,33],[8,22],[18,11]],'#b27c61'),
  poly([[31,6],[41,12],[52,24],[56,33],[51,43],[40,52],[31,57],[20,51],[10,42],[6,33],[12,23],[20,13]],'#23535c'),
  poly([[31,9],[44,17],[53,27],[55,34],[45,43],[34,48],[20,47],[9,38],[9,29],[17,19]],'#417a75'),
  poly([[30,10],[41,16],[47,23],[40,25],[30,21],[17,26],[12,26],[19,17]],'#629a87'),
  poly([[10,40],[20,48],[34,50],[49,41],[47,46],[38,53],[31,55],[20,51],[12,44]],'#2d6567'),
  poly([[31,38],[23,33],[16,24],[15,20],[24,21],[30,27],[31,21],[35,19],[39,24],[38,30],[46,26],[49,28],[45,35],[36,40]],'#25494f'),
  poly([[31,36],[24,31],[17,23],[23,23],[29,28],[32,32],[31,27],[34,22],[37,23],[36,30],[33,34],[42,28],[47,28],[43,34],[36,37]],'#d1ad86'),
  poly([[32,35],[36,33],[35,41],[29,47],[28,46],[32,41]],'#9cb797'),
  rect(8,33,2,2,'#8fbdaa'), rect(52,33,1,3,'#70b5a0'),
  rect(30,5,2,1,'#f0c990'), rect(30,57,3,1,'#d7ab7e')
];
const glass = () => [
  poly([[31,3],[48,13],[60,34],[47,55],[31,64],[16,55],[2,34],[14,13]],'#29263f'),
  poly([[31,3],[48,14],[59,33],[46,53],[31,61],[15,53],[3,33],[15,13]],'#688dac'),
  poly([[31,7],[45,16],[55,33],[43,50],[31,58],[18,50],[7,33],[18,16]],'#395d7f'),
  poly([[31,7],[30,20],[18,16],[7,33],[21,29],[30,21],[40,30],[54,33],[45,16]],'#9bd5d5'),
  poly([[30,20],[42,30],[40,42],[31,47],[22,42],[20,30]],'#50629a'),
  poly([[30,21],[37,30],[31,39],[23,34],[23,29]],'#5686a8'),
  poly([[31,39],[37,30],[42,30],[40,42],[31,47],[22,42],[25,38]],'#658ab0'),
  poly([[7,33],[20,30],[22,42],[18,50]],'#6ca4ad'),
  poly([[55,33],[42,30],[40,42],[43,50]],'#8fb9c9'),
  poly([[18,50],[22,42],[31,47],[31,58]],'#4d5c80'),
  poly([[40,42],[43,50],[31,58],[31,47]],'#62739e'),
  poly([[32,8],[45,16],[49,23],[43,19],[37,17]],'#c3eeea'),
  poly([[17,15],[28,8],[26,13],[21,17]],'#c8e4d7'),
  rect(20,33,1,8,'#83b7c4'), rect(41,33,1,5,'#b0d0d9'), rect(30,48,2,7,'#8aa9be')
];

module.exports = ({ KIT: K, SpriteSurface, makeBuilder, makeSculpt }) => ({
  id: 'highlight-cel-bench', name: 'The Jeweler’s Bench', seed: 67,
  build(seed, { controls: { study = 'bench' } = {} } = {}) {
    if (!['bench','scale'].includes(study)) throw new RangeError('Choose bench or scale');
    const { V } = K;
    const palette = [
      0x101520,0x171e2b,0x202937,0x2f3c48,0x40515b,0x55646d,0x74888a,
      0x231c2d,0x35283b,0x483344,0x694953,0x8e615b,0xb47d64,
      0x654746,0x936351,0xbb8a62,0xe6ba82,0xffdfa6,
      0x21494b,0x31645d,0x52867a,0x84b19c,
      0xffe9b0,0xfff8df,0xa9e6cd,0xe4f7db,0xb5dcee,0xfffbef
    ];
    const B = makeBuilder(seed,palette), S = K.sculpt(makeSculpt(B));
    Object.assign(S,{ pixel:true, amb:.49,sky:.17,sun:V.norm([-.48,.66,.44]),sunK:.37,shLen:0 });
    const wood = {r:[7,8,9,10,11,12]}, frame = {r:[8,9,13,14,15]}, dark = {r:[0,1,2,3]};
    const velvet = [[0x273644,0x324552,0x3c515a],[0x203638,0x2d4947,0x3f5853],[0x382b42,0x45334a,0x543d52]];
    const box = (at, half, material, res=.12, rd=.04) => S.box(at,half,material,{res,rd});
    box([0,.27,.14],[4.42,.24,1.65],wood,.14,.06);
    box([0,.49,.14],[4.37,.07,1.61],frame,.12,.025);
    box([0,.58,.20],[4.22,.044,1.45],dark,.12,.028);
    box([0,1.23,-.63],[4.37,.62,.12],wood,.15,.065);
    box([0,1.85,-.52],[4.36,.043,.060],frame,.105,.018);
    box([0,.32,1.77],[4.16,.035,.026],frame,.12,.012);
    const atlas = SpriteSurface.make(384,256), sites = [];
    const drawing = K.procedural.drawing2d;
    const band = ['#392c3b','#403141','#463747','#463244','#503a47'];
    const plank = (x,y) => {
      if (y === 0 || y === 23) return 0x635054;
      if (y === 10 || (x + y * 11) % 91 === 0) return 0x4a3744;
      return parseInt(band[(Math.floor(x/41)+Math.floor(y/4))%band.length].slice(1),16);
    };
    atlas.face([-4.17,.14,1.797],[8.34,0,0],[0,.31,0],268,24,plank);
    const cards = [['brass',-2.60,brass],['enamel',0,enamel],['glass',2.60,glass]];
    for (const [i, [key,x,design]] of cards.entries()) {
      box([x,1.52,-.14],[1.17,1.12,.30],frame,.105,.09);
      atlas.face([x-1.08,.48,.255],[2.16,0,0],[0,2.08,0],64,64,(u,v)=>{
        if (u===0 || v===63) return velvet[i][0];
        if (u===63 || v===0) return velvet[i][2];
        return velvet[i][(u*17+v*19+u*v)%31===0 ? 0 : 1];
      });
      for (const s of [-1,1]) for (const y of [.68,2.38])
        S.ball([x+s*.95,y,.258],.033,{r:[13,15,16]},{res:.032});
      const paint = drawing.render({width:64,height:66,edges:'hard',commands:design()});
      const region = atlas.reserve(paint.width,paint.height);
      atlas.faceRegion([x-.88,.81,.460],[1.76,0,0],[0,1.82,0],region,{id:key+'-face'});
      const plaque = drawing.render({width:60,height:14,edges:'hard',commands:[
        rect(0,0,60,14,'#4f3842'),rect(1,1,58,12,'#292535'),rect(1,1,58,1,'#79594f'),
        text([11,8,11][i],4,key.toUpperCase(),'#c29c7c')
      ]});
      atlas.face([x-.60,.175,1.81],[1.20,0,0],[0,.28,0],plaque.width,plaque.height,(u,v)=>{
        const p = (v*plaque.width+u)*4;
        return plaque.data[p]*65536+plaque.data[p+1]*256+plaque.data[p+2];
      });
      sites.push({ id:key, family:key, light:'swing-lamp', span:1.02,
        at:[x+[0,.19,.27][i], [2.27,2.14,2.16][i], .464], bias:.018 });
      sites[i].region = region;
      sites[i].paint = paint;
    }
    S.bake();
    const spriteSurfaces = atlas.finish();
    const highlightCels = sites.map(({region,paint,...site}) => {
      SpriteSurface.update(spriteSurfaces,region,{w:paint.width,h:paint.height,rgba:paint.data});
      return site;
    });
    const swing = time => {
      const a = time*Math.PI*2/PERIOD;
      return [study==='scale' ? -2.60+.95*Math.sin(a+.6) : 3.45*Math.sin(a), 3.29+.25*(1-Math.cos(a*2)), 2.90];
    };
    const direction = time => {
      const p=swing(time);
      return V.sub([study==='scale' ? -2.60 : p[0]*.48,1.30,.06],p);
    };
    const lamp = K.frameSplats(B, 64, (draw,_dt,time) => {
      const p=swing(time);
      draw.streak([study==='scale'?-2.60:0,5.4,2.92], V.add(p,[0,.15,0]), {width:.019,rgb:[.43,.36,.38],density:1.5});
      for (let i=0;i<20;i++) {
        const a=i*Math.PI/10;
        draw.point(V.add(p,[.14*Math.cos(a),-.012,.105*Math.sin(a)]),
          {width:.027,rgb:[.84,.58,.39],density:2.4,depth:true});
      }
      draw.point(p,{width:.074,rgb:[1,.83,.53],density:3.4,depth:true});
    });
    const cam = { target:[0,1.60,.42],dist:8.45,fov:.625,ortho:true,yaw:-.085,pitch:.13 };
    const world = B.finish({ cam,radius:10,detail:26,dither:0,spriteSurfaces,highlightCels,
      look:{splatCoverage:'continuous'},
      areaLights:[K.lightEmitters.disc({id:'swing-lamp',at:swing,normal:direction,size:[.16,.16],
        sampleGrid:1, radius:11, intensity:1.7, color:'#ffd7ae', shadows:false, visible:false})]
    });
    const stage=K.stage(world);
    if (study==='scale') stage.add({ update(_dt,time) {
      const phase=time*Math.PI*2/PERIOD, closeness=.5-.5*Math.cos(phase);
      cam.target=[-2.60,1.62,.48];
      cam.dist=25.2-20.2*closeness;
      cam.yaw=-.05+.73*Math.sin(phase-.90)*closeness;
      cam.pitch=.12;
    } });
    stage.add(lamp);
    stage.stateful=false;
    stage.update(0,0);
    return world;
  }
});
