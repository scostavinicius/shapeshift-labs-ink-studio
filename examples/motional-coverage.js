module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => {
  let shaft;
  const id = 'motional-coverage';
  return {
    id, name:'The cable house', seed:19,
    build(seed) {
      const B = makeBuilder(seed, [
        0x202d40,0x2b4356,0x3a5260,0x53696c,0x71837b,0x93a092,0xb2b8a1,
        0x382e3e,0x574054,0x79535e,0xa66f67,0xd09576,0xefba87,0xffdba1,
        0x273941,0x39505a,0x547477,0x78a09b,0xaed1b6,0xecd4a2
      ]);
      const S = makeSculpt(B);
      Object.assign(S, { amb:.38, sky:.18, sunK:.63, sun:K.V.norm([-.45,.64,.58]) });
      const stone = {r:[0,1,2,3,4,5]}, dark = {r:[0,14,1,2,16]}, wood = {r:[7,8,9,10,11,12]};
      const brass = {r:[7,9,10,11,12,13]}, iron = {r:[14,0,1,2,4]};
      const box = (at, half, mat, res=.08, rd=.02) => S.box(at,half,mat,{res,rd});
      for (const [x,y,z,w,h] of [[-.9,-.4,-5.1,1.85,1.2],[1.6,-.56,-5,1.6,1.12],[-2.95,-.4,-3,.7,1.7],[2.61,-.66,-2.5,1,1.22]])
        box([x,y,z],[w,h,.68],{r:[1,2,3,4,5]},.24,.55);
      box([0,-.83,0],[3.05,.21,1.09],stone,.12,.065);
      box([0,-.58,.10],[3.08,.063,1.13],{r:[2,3,4,5,6]},.09,.045);
      for (let i=-5;i<=5;i++) box([i*.55,-.69,1.08],[.265,.086,.109],dark,.087,.017);
      for (const x of [-2.15,2.12]) {
        box([x,.49,-.32],[.105,1.05,.115],wood,.072);
        box([x,-.46,-.32],[.25,.085,.26],iron,.075);
        box([x,1.55,-.32],[.17,.07,.17],brass,.063);
      }
      box([-.88,1.5,-.32],[1.32,.083,.102],wood,.069);
      box([.77,-.34,.13],[.57,.22,.37],wood,.068,.05);
      box([.77,-.105,.13],[.65,.05,.39],iron,.061);
      S.lathe([.78,-.055,.16],.19,[.32,.36],brass,{res:.054});
      S.lathe([.78,.128,.16],.083,[.37,.345],iron,{res:.046});
      box([1.52,-.17,.36],[.23,.36,.20],wood,.074);
      box([1.52,.19,.36],[.235,.052,.2],iron,.065);
      box([1.52,.286,.36],[.14,.087,.13],{r:[12,13],em:true},.054);
      box([1.52,.385,.36],[.19,.044,.16],brass,.054);
      // The front guide occludes the moving gold spindle.
      box([.99,.55,.71],[.053,.54,.062],dark,.053);
      box([.99,1.025,.72],[.12,.056,.093],brass,.055);
      S.bake();

      function wires(object, paths, width, color, density) {
        const first = B.count();
        for (const points of paths) for (let i=1;i<points.length;i++) {
          const a=points[i-1], b=points[i], span=K.V.sub(b,a);
          B.axial(...K.V.lerp(a,b,.5),K.V.norm(span),.41*K.V.len(span),width,B.P[color],density);
        }
        B.describeSplats(first,B.count(),{object,material:'rigging'});
        return [first,B.count()];
      }
      const cable = Array.from({length:19},(_,i)=>{
        const u=i/18;
        return [-2.18+4.32*u,1.46-.31*Math.sin(u*Math.PI)-.25*u,-.23+.24*u];
      });
      wires('suspension-cables',[cable,[[-1.06,1.23,-.12],[-1.06,.16,-.12]],
        [[-1.63,1.34,-.15],[-1.63,.39,-.15]]],.017,19,1.17);
      wires('balustrade',[[[-2.91,-.01,.76],[-.47,-.01,.76]],[[-2.91,.29,.76],[-.47,.29,.76]],
        ...[-2.88,-2.32,-1.73,-1.16,-.51].map(x=>[[x,-.51,.76],[x,.37,.76]])],.019,17,1.14);
      shaft = wires('travelling-spindle',[[[.54,.19,.34],[.54,1.044,.34]],[[.30,.88,.34],[.77,.88,.34]]],.016,13,1.16);
      return B.finish({
        cam:{target:[0,.47,0],dist:6.25,yaw:.17,pitch:.09,ortho:true,sway:0}, radius:7, dither:0,
        look:{motionalCoverage:{rules:[{select:{material:'rigging'}}]}}
      });
    },
    animate(world) {
      const [first,end] = shaft, rest = world.data.slice();
      world.anim = { update(_dt,t) {
        const phase = t*Math.PI*2;
        for (let i=first;i<end;i++) {
          world.data[i*16] = rest[i*16]+.47*(1-Math.cos(phase));
          world.data[i*16+1] = rest[i*16+1]+.09*Math.sin(phase);
        }
      } };
    }
  };
};
