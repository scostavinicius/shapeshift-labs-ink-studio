module.exports = ({KIT:K,makeBuilder,makeSculpt})=>({
  id:'aperture-relay',
  name:'The Aperture Relay',
  seed:62,
  build(seed) {
    const B=makeBuilder(seed,[
      0x12202a,0x203246,0x334b56,0x4f656e,0x748584,0xa5aa93,
      0x372b34,0x5d4140,0x855547,0xab7351,0xce9661,0xeaac68,0xffce84,0xffe8ad,
      0x183945,0x205563,0x377f84,0x5fb4aa,0xabe5c8,
      0x4b384f,0x705070,0x9f6992,0xd789af,0xffb1c0,0xffe7d2,
      0x642a42,0xa33c55,0xda5060,0xff7d54,0xffad74,0xffe0a1
    ]);
    const S=K.sculpt(makeSculpt(B));
    Object.assign(S,{sun:K.V.norm([-.39,.83,.42]),amb:.36,sky:.16,sunK:.59,wob:.014,pixel:true});
    const stone={r:[0,1,2,3,4]}, zinc={r:[1,2,3,4,5]}, copper={r:[6,7,8,9,10,11]},
      brass={r:[7,8,9,10,11,12,13]}, green={r:[14,15,16,17,18]}, enamel={r:[19,20,21,22]},
      fire={r:[27,28,29,30],em:true,materialId:'protected-glint'},
      pearl={r:[22,23,24],em:true,materialId:'protected-glint'};
    const tube=(points,r,m,objectId,res=.044)=>S.tube(points,r,r,m,{objectId,res});
    const ball=(at,r,m,objectId,res=.041)=>S.ball(at,r,m,{objectId,res});
    const lathe=(y,h,profile,m,objectId,res=.066)=>S.lathe([0,y,0],h,profile,m,{objectId,res});

    lathe(.03,.11,[.78,.74],stone,'plinth');
    lathe(.14,.10,[.74,.65],zinc,'plinth');
    lathe(.24,.052,[.65,.65],brass,'plinth',.055);
    lathe(.292,.096,[.60,.51],copper,'plinth',.058);
    lathe(.388,.43,[.48,.39,.32,.35],green,'stem',.057);
    lathe(.494,.031,[.45,.45],brass,'stem',.056);
    lathe(.782,.07,[.37,.41],zinc,'stem',.053);
    for(let i=0;i<12;i++) {
      const a=i*Math.PI/6;
      ball([.543*Math.sin(a),.298,.543*Math.cos(a)],.029,i%3?brass:enamel,'bolts',.027);
    }
    const heading=.86, c=Math.cos(heading),s=Math.sin(heading);
    const axes=[[c,0,-s],[0,1,0],[s,0,c]];
    const at=(x,y,z)=>[c*x+s*z,y,-s*x+c*z];
    const box=(x,y,z,half,m,objectId,res=.044,rd=.029,extra={})=>
      S.box(at(x,y,z),half,m,{objectId,res,rd,ax:axes,...extra});

    ball([0,1.64,0],[.560,.765,.56],copper,'relay-housing',.067);
    // A deep rectangular bore reveals a tiny warm reflection along a narrow arc.
    box(.146,1.724,.428,[.215,.245,.400],brass,'aperture-bore',.05,.038,{neg:true});
    lathe(.91,.072,[.436,.476],brass,'housing-ring',.058);
    lathe(2.236,.07,[.385,.332],brass,'housing-ring',.054);
    lathe(2.306,.11,[.325,.257],green,'crown',.053);
    lathe(2.415,.049,[.262,.279],brass,'crown',.049);
    lathe(2.464,.16,[.24,.14,.05],enamel,'crown',.043);
    S.bake();

    box(.183,1.728,.598,[.083,.126,.024],fire,'signal-reflection',.028,.017);
    ball(at(.214,1.720,.629),[.027,.070,.020],pearl,'signal-reflection',.022);
    box(-.038,1.728,.505,[.044,.26,.044],brass,'aperture-guard',.048,.024);
    box(.36,1.725,.475,[.052,.264,.062],brass,'aperture-guard',.047,.024);
    for(const y of [1.456,1.989]) {
      box(.16,y,.471,[.26,.043,.101],brass,'aperture-guard',.042,.025);
      for(const x of [-.07,.385]) ball(at(x,y,.558),.036,green,'aperture-guard',.029);
    }
    // Skewed bars close and reopen the little windows as the cage turns.
    for(const y of [1.56,1.69,1.817,1.94]) {
      const bend=(y-1.75)*.38;
      tube([at(-.012,y,.534),at(.096,y+.036,.60+bend),at(.202,y+.023,.572+bend),at(.35,y-.012,.52)],
        .019,green,'aperture-grille',.031);
    }
    for(const z of [.22,.38,.54]) {
      tube([at(.405,1.08,z),at(.753,1.256,z+.018),at(.755,1.635,z-.023),at(.486,1.89,z)],
        .024,brass,'side-lattice',.037);
    }
    tube([at(.419,1.065,.27),at(.81,1.26,.26),at(.81,1.667,.26),at(.486,1.91,.27)],
      .041,copper,'side-lattice',.046);
    box(.79,1.435,.257,[.048,.082,.051],enamel,'side-lattice',.039,.025);

    tube([at(-.27,2.38,-.11),at(-.33,2.735,-.15),at(-.20,2.865,-.137)],.025,copper,'antenna',.030);
    ball(at(-.196,2.862,-.137),.044,brass,'antenna',.028);
    tube([at(.04,2.56,0),at(.082,2.796,.033),at(.142,2.9,.05)],.022,green,'antenna',.032);
    ball(at(.147,2.912,.05),.037,enamel,'antenna',.029);
    for(const y of [1.26,1.48,1.7,1.92,2.11])
      ball(at(-.17,y,-.484),.051,y===1.7?green:brass,'rear-fastenings',.037);
    S.bake();

    return B.finish({cam:{target:[0,1.48,0],dist:5.35,yaw:0,pitch:.13,ortho:true,sway:0},
      detail:26,radius:5,dither:0,look:{splatCoverage:'continuous'}});
  }
});
