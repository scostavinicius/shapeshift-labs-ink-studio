/* Two casts of the same heron relief under a single moving finish light. */
(function (root, factory) {
  if (typeof module !== 'undefined') module.exports = factory;
  else root.paintedShadowBandsDemo = factory;
})(globalThis, ({ KIT: K, makeBuilder, makeSculpt, SpriteSurface }) => {
  const period = 4;
  const orbit = t => {
    const a = t*Math.PI*2/period;
    return [2.75*Math.sin(a),3.21+.19*(1-Math.cos(a*2)),1.49+.81*(.5+.5*Math.cos(a*2))];
  };
  const lampDirection = t => K.V.norm(K.V.sub(orbit(t),[0,1.55,.30]));
  const outline = [
    [-.92,-.30],[-.67,-.24],[-.49,-.06],[-.33,.10],[-.06,.15],[.05,.24],[.11,.45],
    [.24,.61],[.42,.60],[.50,.53],[.82,.48],[.49,.43],[.38,.35],[.37,.18],
    [.40,-.01],[.34,-.18],[.18,-.29],[-.13,-.36],[-.42,-.42],[-.67,-.41]
  ];
  const wing = [[-.74,-.28],[-.52,-.16],[-.29,.06],[-.03,.11],[.18,.02],[.23,-.12],
    [.11,-.22],[-.07,-.26],[-.25,-.33],[-.57,-.38]];
  const wingLines = [
    [[-.68,-.29],[-.42,-.26],[-.17,-.14],[.06,-.03]],
    [[-.57,-.34],[-.34,-.31],[-.06,-.21],[.15,-.095]],
    [[-.36,-.34],[-.13,-.28],[.10,-.20],[.18,-.14]]
  ];
  function authored(x) {
    const stroke = (line,z,radius,bias,softness=.18) =>
      ({ points:line.map(([u,v])=>[x+u,1.60+v,z]), radius,bias,softness });
    return [
      stroke([[-.72,-.38],[-.45,-.40],[-.14,-.34],[.15,-.28],[.32,-.17]],.47,.095,.25),
      stroke([[-.48,-.16],[-.32,-.06],[-.13,-.015],[.04,-.06],[.11,-.128]],.542,.164,-.34,.19),
      ...wingLines.map(line=>stroke(line,.55,.032,.29,.15)),
      stroke([[.115,.19],[.19,.34],[.29,.46],[.44,.47]],.49,.088,.26),
      stroke([[.30,.52],[.40,.54]],.49,.055,-.22),
      stroke([[-.52,-.65],[-.18,-.56],[.08,-.60],[.49,-.58]],.34,.052,.24),
      stroke([[-.57,.47],[-.41,.58],[-.19,.64],[.08,.64],[.36,.58]],.36,.074,-.19)
    ];
  }

  return {
    id:'painted-shadow-bands', name:'The Marsh Gate', seed:29, period, authored,
    build(seed,{ controls } = {}) {
      const single = controls?.single === true;
      const palette = [
        0x101b24,0x16252d,0x203039,0x2b4046,0x3b5051,0x52645c,0x717d68,
        0x241e2a,0x3b2b35,0x573b3d,0x7a4c43,0xaa694d,0xd49464,0xf0bb80,0xf7d5a0,
        0x322b34,0x4b3941,0x69504c,0x94735b,0xbe976f,0xe3bb87,0xfae0ac,
        0x203438,0x294c50,0x3d6965,0x649184,0x92ac8a,0xcbd6a2,0xfde7ab,0xffc27a
      ];
      const B=makeBuilder(seed,palette), S=K.sculpt(makeSculpt(B)), atlas=SpriteSurface.make(192,96);
      Object.assign(S,{sun:[-.6,.71,.35],amb:.36,sky:.22,sunK:.48,shLen:0,pixel:false});
      const arch={r:[1,2,3,4,5]}, mortar={r:[0,1,2,3]}, copper={r:[7,8,10,11,12,13]},
        gold={r:[9,10,11,12,13,14]}, jade={r:[22,23,24,25,26]}, ink={r:[7,8,9]};
      const field=[15,16,17,18,19,20,21], bird=[8,9,10,11,12,13,14];
      const box=(p,h,mat,res=.078,rd=.041)=>S.box(p,h,mat,{res,rd});
      const ring=(r,cx=0,cy=0)=>Array.from({length:40},(_,i)=>{
        const a=i*Math.PI/20;
        return [cx+r*Math.cos(a),cy+r*Math.sin(a)];
      });
      box([0,1.7,-.79],[4.95,2.02,.24],mortar,.155,.084);
      for (let j=0;j<8;j++) for(let i=-4;i<=4;i++) {
        const offset=j%2?.49:0;
        box([i*.982+offset,.24+j*.504,-.508],[.473,.235,.062],(i+2*j+20)%5===0?mortar:arch,.11,.053);
      }
      box([0,.07,-.03],[3.13,.107,.49],arch,.095,.035);
      box([0,.173,.035],[2.99,.047,.373],jade,.084,.017);
      const sites=single?[0]:[-1.47,1.47];
      for (const x of sites) {
        const painter = x>=0;
        const material = (r,id,positions) => K.surface.material({r,materialId:id},{
          layers:{diffuse:{type:'diffuse',lightingRamp:{role:id,positions,interpolation:'step'},
            shadowBand:{strokes:painter ? authored(x) : []}}}
        });
        const stone=material(field,'limestone',[0,.31,.47,.60,.72,.84,1]),
          ochre=material(bird,'carving',[0,.29,.45,.57,.68,.80,1]);
        const cut=(loops,y,z,deep,mat,res=.041,rd=.018)=>S.extrude(loops,[x,y,z],deep,mat,{res,rd});
        box([x,1.51,-.12],[1.24,1.285,.25],arch,.086,.09);
        box([x,1.51,.144],[1.165,1.215,.091],copper,.063,.050);
        box([x,1.51,.226],[1.107,1.157,.042],ink,.061,.026);
        box([x,1.51,.264],[1.073,1.123,.040],jade,.057,.039);
        cut([ring(.958),ring(.885)],1.60,.322,.089,gold,.043,.020);
        cut([ring(.883)],1.60,.323,.089,stone,.048,.025);
        cut([outline],1.60,.392,.207,ochre,.034,.041);
        cut([wing],1.60,.502,.084,stone,.026,.021);
        for(const line of wingLines) {
          S.tube(line.map(([u,v])=>[x+u,1.60+v,.545]),.014,.008,ochre,{res:.019});
        }
        S.ball([x+.357,2.14,.504],[.028,.023,.022],ink,{res:.016});
        S.ball([x+.352,2.146,.524],.011,{r:[20,21]},{res:.011});
        for(const [u,length,bend] of [[-.68,.35,-.12],[-.53,.39,.05],[-.41,.25,.09],[.50,.31,-.06],[.66,.50,.10]]) {
          const y=1.06+Math.abs(u)*.19;
          S.tube([[x+u,y-.10,.382],[x+u,y+length*.40,.390],[x+u+bend,y+length,.384]],.018,.012,stone,{res:.023});
          S.ball([x+u+bend,y+length,.387],[.023,.043,.018],ochre,{res:.020});
        }
        for (const [u,v] of [[-.8,.87],[.8,.87],[-.82,-.99],[.82,-.99]]) {
          S.ball([x+u,1.60+v,.31],[.077,.046,.026],copper,{res:.035});
          S.ball([x+u,1.61+v,.338],[.042,.030,.017],gold,{res:.027});
        }
        for(let j=0;j<6;j++) {
          const u=-.47+j*.192;
          box([x+u,.484,.315],[.017,.032+(j%2)*.014,.012],gold,.024,.009);
        }
        const title=single?'THE MARSH GATE':painter?'PAINTED BANDS':'LIGHTING ONLY';
        const plate=K.procedural.drawing2d.text(title,{color:'#e8ba84',tracking:1}).value;
        atlas.face([x-.78,.249,.326],[1.56,0,0],[0,.176,0],plate.width+10,plate.height+4,(u,v)=>{
          if (!u || !v || u===plate.width+9 || v===plate.height+3) return 0x855e51;
          if(u>=5&&u<plate.width+5&&v>=2&&v<plate.height+2 &&
             plate.data[((v-2)*plate.width+u-5)*4+3]) return 0xe8ba84;
          return 0x282630;
        });
      }

      S.bake();
      const lantern=K.frameSplats(B,90,(draw,_dt,time)=>{
        const [x,y,z]=orbit(time), hanger=[0,4.29,z];
        draw.streak(hanger,[x,y+.20,z],{width:.022,color:11,density:2.6});
        draw.streak([x-.125,y+.115,z],[x+.125,y+.115,z],{width:.030,color:12,density:3,depth:true});
        draw.streak([x-.121,y-.106,z],[x+.121,y-.106,z],{width:.028,color:10,density:3,depth:true});
        for(const u of [-.119,.119]) draw.streak([x+u,y-.11,z],[x+u,y+.112,z],{width:.021,color:11,density:3,depth:true});
        draw.point([x,y,z-.016],{width:.16,rgb:[1,.54,.23],density:.7});
        draw.point([x,y-.018,z+.023],{width:.061,color:29,density:3.2,depth:true});
        draw.point([x,y+.015,z+.041],{width:.042,color:28,density:3.4,depth:true});
      });
      const cam={target:[0,1.88,.13],dist:single?5.78:6.14,fov:.64,yaw:0,pitch:0,ortho:true};
      const world=B.finish({cam,detail:28,radius:8,dither:0,
        paletteRoles:{limestone:field,carving:bird},look:{splatCoverage:'continuous'},
        surfaceLight:Array.from({length:33},(_,i)=>[i*period/32,...lampDirection(i*period/32)]),
        spriteSurfaces:atlas.finish()
      });
      const stage=K.stage(world);
      stage.add(lantern);
      stage.stateful=false;
      stage.update(0,0);
      return world;
    }
  };
});
