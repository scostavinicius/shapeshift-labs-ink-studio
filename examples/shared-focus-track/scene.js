/* A dock worker slides a brass bolt, with the channel beacon beyond the gate. */
module.exports = ({ KIT: K, SpriteSurface, makeBuilder, makeSculpt }) => {
  const palette = [
    0x17252f, 0x223745, 0x31505d, 0x466b72, 0x638a87, 0x88a391,
    0x2a3037, 0x444048, 0x68504a, 0x91644d, 0xa77754,
    0x49352f, 0x78513c, 0xae7046, 0xd29556, 0xe2b977, 0xf5d99b,
    0x1e3540, 0x2f5157, 0x416b69, 0x59877a, 0x86ae8a, 0xe2cfa0,
    0x52323b, 0x793d43, 0x9f504f, 0xc86b59, 0xdc8c70, 0xe5ab86
  ];
  const step = (a,b,t) => {
    const u = Math.max(0,Math.min(1,(t-a)/(b-a)));
    return u*u*(3-2*u);
  };
  function action(world,rows,t) {
    const reach=step(.44,2.36,t), slide=step(2.70,3.18,t), retract=step(3.28,4.72,t);
    const glove = [-1.23*(1-reach)-1.65*retract+.39*slide,
      -.26*(1-reach)-.34*retract+.11*Math.sin(Math.PI*reach), .16*retract];
    for (const {index,x,y,z,subject} of rows) {
      const shift = subject==='latch' ? [.39*slide,0,0] : glove;
      world.data[index]=x+shift[0];
      world.data[index+1]=y+shift[1];
      world.data[index+2]=z+shift[2];
    }
  }
  function build(seed) {
    const B=makeBuilder(seed,palette), S=K.sculpt(makeSculpt(B));
    Object.assign(S,{wob:.002,amb:.56,sky:.21,sunK:.39,sun:K.V.norm([-.54,.72,.48])});
    const horizon = SpriteSurface.make(512);
    horizon.face([-8,-2.45,-3.9],[16,0,0],[0,6.2,0],384,150,(x,y)=>{
      const u=x/384,v=1-y/150;
      const grain=(((x*2029^y*683^x*y*83)&15)-7)*.6;
      const ridge=.55+.025*Math.sin(x*.071)+.018*Math.sin(x*.149)+.039*Math.sin(x*.021);
      const coast=.49+.022*Math.sin(x*.094)+.045*Math.sin(x*.022);
      const tint=(r,g,b)=>((Math.max(0,Math.min(255,r+grain))|0)<<16) |
        ((Math.max(0,Math.min(255,g+grain))|0)<<8) | (Math.max(0,Math.min(255,b+grain))|0);
      if (v>ridge) {
        const fade=Math.min(1,Math.max(0,(v-.57)/.26)), wisps=Math.sin(x*.046+y*.182)+.55*Math.sin(x*.023-y*.39);
        const dust=wisps>.86 ? 15*(1-fade) : 0;
        return tint(189-126*fade+dust,151-73*fade+dust,128-21*fade+dust);
      }
      if (v>coast) return tint(53+18*u,79+13*u,90+9*u);
      if (v>.44) return tint(37,61,72);
      const ripple=(Math.sin(x*.082+y*2.19)+.58*Math.sin(x*.235-y*1.29))>1;
      const band=(y*31+x*7)%29>4;
      const glint=ripple && band ? 16+14*(1-2*Math.abs(u-.5)) : 0;
      return tint(32+glint,64+glint,75+glint*.77);
    });
    const rail={r:[0,1,2,3,4]}, dark={r:[0,1,6,7]}, iron={r:[1,6,7,8]}, cedar={r:[6,7,8,9,10]},
      patina={r:[0,17,18,19,20,21]}, brass={r:[7,11,12,13,14,15,16]},
      glove={r:[8,23,24,25,26,27,28]}, cuff={r:[0,1,17,18,19,20]};
    const box=(at,half,material,objectId,res=.075,rd=.028)=>S.box(at,half,material,{objectId,res,rd});
    const tube=(path,a,b,material,objectId,res=.045)=>S.tube(path,a,b,material,{objectId,res});
    const ball=(at,radius,material,objectId,res=.04)=>S.ball(at,radius,material,{objectId,res});
    box([0,-.49,.55],[4.6,.12,.88],dark,'dock',.17,.035);
    for (let i=0;i<9;i++) {
      const x=-3.76+i*.94;
      box([x,-.36,.55],[.459,.045,.88],i%3 ? cedar:iron,'dock',.15,.026);
    }
    for (const x of [-3.12,3.05]) {
      box([x,.48,-.55],[.16,.89,.16],rail,'gate',.081,.044);
      box([x,1.399,-.55],[.195,.07,.195],patina,'gate',.061);
    }
    for (const y of [.19,1.22]) box([-1.75,y,-.48],[1.51,.044,.045],rail,'gate',.095);
    for (const y of [.19,1.22]) box([2.56,y,-.48],[.59,.044,.045],rail,'gate',.076);
    for (const x of [-2.7,-2.22,-1.74,-1.26,-.78,2.26,2.67])
      box([x,.68,-.48],[.024,.505,.026],rail,'gate',.086,.016);
    box([.87,.58,-.04],[.16,.98,.18],patina,'gate',.065,.045);
    box([.87,1.571,-.04],[.199,.052,.214],patina,'gate',.055,.031);
    box([1.53,.62,-.10],[.106,.95,.115],rail,'gate',.07,.025);
    box([1.54,.83,.03],[.64,.143,.06],iron,'gate',.063,.045);
    box([1.66,.83,.122],[.12,.17,.085],iron,'gate',.039,.029);
    for (const x of [1.21,1.91]) for (const y of [.74,.925])
      ball([x,y,.103],[.034,.034,.022],brass,'gate',.026);
    box([2.46,.14,-2.15],[.32,.16,.22],rail,'beacon',.079);
    box([2.46,.78,-2.15],[.118,.62,.123],iron,'beacon',.06);
    box([2.46,1.40,-2.15],[.19,.043,.19],rail,'beacon',.054);
    ball([2.46,1.535,-2.128],[.134,.113,.11],{r:[13,14,15,16,22]},'beacon',.05);
    box([2.46,1.662,-2.15],[.158,.037,.15],iron,'beacon',.054);
    S.bake();

    const rows=[];
    function moving(subject,draw) {
      const first=B.count();
      draw(); S.bake();
      rows.push({first,last:B.count(),subject});
    }
    moving('latch',()=>{
      tube([[.94,.837,.245],[1.88,.837,.245]],.057,.061,brass,'latch',.036);
      tube([[1.28,.837,.272],[1.28,.942,.365],[1.19,.997,.374]],.054,.048,brass,'latch',.031);
      ball([1.18,1.008,.374],.067,brass,'latch',.032);
    });
    moving('glove',()=>{
      tube([[-3.3,.635,.93],[-1.13,.65,.69],[-.16,.88,.57],[.75,.96,.44]],.236,.12,cuff,'sleeve',.065);
      box([.62,.961,.493],[.115,.144,.111],cuff,'sleeve',.041,.05);
      ball([.855,.978,.484],[.197,.127,.089],glove,'glove',.036);
      for (const [i,y] of [1.066,1.013,.96,.913].entries()) {
        const x=[1.083,1.153,1.131,1.063][i];
        tube([[.85,y,.486],[x,y+.012,.47],[x+.014,y-.029,.402]],.033,.026,glove,'glove',.029);
      }
      tube([[.813,.926,.486],[.965,.870,.525],[1.055,.894,.475]],.046,.036,glove,'glove',.031);
      tube([[.736,1.007,.553],[.793,1.071,.531]],.018,.014,glove,'glove',.027);
    });
    const world=B.finish({id:'harbor-latch',dither:0,radius:8,sky:[0x486575,0x9b8e81],
      fog:{c:0x83978b,max:0},spriteSurfaces:horizon.finish(),
      cam:{target:[.14,.62,-.03],dist:6.15,pitch:.085,yaw:.04,ortho:true,sway:0},
      look:{splatCoverage:'continuous'}});
    const posed=rows.flatMap(({first,last,subject})=>Array.from({length:last-first},(_,n)=>{
      const index=(first+n)*16, [x,y,z]=world.data.subarray(index,index+3);
      return {index,x,y,z,subject};
    }));
    world.anim={update(_dt,t) {
      action(world,posed,t);
      world.cam.yaw=.04-.042*step(3.22,5.88,t);
      world.cam.target=[.14+.17*step(3.4,5.8,t),.62,-.03];
    }};
    world.anim.update(0,0);
    return world;
  }
  return {id:'harbor-latch',name:'Harbor Latch',seed:88,build};
};
