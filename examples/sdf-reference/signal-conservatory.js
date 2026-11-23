module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'signal-conservatory',
  name: 'The Signal Conservatory',
  seed: 74,
  build(seed) {
    const B = makeBuilder(seed, [
      0x101a25,0x1f2937,0x394354,0x536775,0x778e98,0xa7b6b5,0xd6d5be,0xece2bf,
      0x3d2935,0x61353d,0x8f4a47,0xba5e50,0xe38664,0xf0ab72,0xffcf8c,0xffecd0,
      0x10353e,0x205661,0x377c84,0x5cb6b2,0x9de3d5,0xd4f7dd,
      0x534150,0x805c62,0xaca084,0xd5be92,0x9b352d,0xed7453
    ]);
    const S = K.sculpt(makeSculpt(B));
    const sun = K.V.norm([-.38,.73,.56]);
    Object.assign(S,{ sun, amb:.37,sky:.13,sunK:.56,wob:.014, captureAlbedo:true });
    const stone={r:[2,3,4,5,6],albedo:'#a2aba8'}, chalk={r:[3,4,5,6,7],albedo:'#d8cca8'};
    const basalt={r:[0,1,2,3],albedo:'#465868'}, trim={r:[8,9,22,23,24],albedo:'#8d6a60'};
    const brick={r:[8,9,10,11,12],albedo:'#d25d41'}, red={r:[9,10,11,26,27],albedo:'#e75732'};
    const copper={r:[9,10,12,13,14,25],albedo:'#c89455'}, enamel={r:[16,17,18,19],albedo:'#3d9b9c'};
    const glass={r:[17,18,19,20,21],albedo:'#89eed7',glass:true,a:.24,materialId:'green-glass'};
    const flame={r:[13,14,15],albedo:'#ffcf85',em:2.3,materialId:'filament'};
    const tube=(points,r,m,objectId,res=.054)=>S.tube(points,r,r,m,{res,objectId});
    const box=(at,half,m,objectId,res=.096,rd=.028)=>S.box(at,half,m,{res,rd,objectId});
    const ball=(at,r,m,objectId,res=.062)=>S.ball(at,r,m,{res,objectId});

    box([0,-.20,.15],[3.26,.19,1.86],basalt,'stepped-plinth',.22,.14);
    box([.03,.006,.12],[3.18,.057,1.79],stone,'stone-floor',.16,.035);
    for (let x=-3; x<=3; x+=.5) {
      box([x,.071,1.58],[.152,.013,.025],copper,'inlaid-scale',.054,.012);
      if (Math.abs(x%1)<.01) box([x,.071,1.48],[.021,.014,.051],copper,'inlaid-scale',.045,.010);
    }
    box([0,1.08,-1.23],[3.17,1.08,.15],basalt,'rear-wall',.20,.06);
    box([-.77,1.11,-1.047],[.48,.93,.07],chalk,'return-wall',.147,.044);
    box([2.25,1.10,-1.04],[.66,.91,.067],chalk,'return-wall',.152,.044);
    for (const x of [-3.03,-.16,1.05,2.97])
      box([x,1.08,-1.01],[.058,1.067,.082],trim,'wall-mullions',.09,.034);
    box([0,2.183,-1.10],[3.21,.065,.194],copper,'cornice',.157,.040);
    box([0,2.075,-1.013],[3.10,.035,.064],trim,'cornice',.122,.024);
    for (const z of [-.90,1.19])
      box([-3.066,.15,z],[.108,.13,.12],trim,'railing',.088,.061);
    tube([[-3.07,.28,-.9],[-3.07,.31,1.19]],.036,copper,'railing',.075);
    S.bake();

    // A carved arch and coarse open-grille samples give the coverage pass readable trouble spots.
    const vaultX = -1.64;
    box([vaultX,.78,-.42],[.96,.76,.365],brick,'kiln-vault',.208,.057);
    S.box([vaultX,.315,-.42],[.626,.39,.62],brick,{neg:true,res:.21,rd:.025,objectId:'kiln-vault'});
    S.ball([vaultX,.695,-.42],[.626,.565,.64],brick,{neg:true,res:.219,objectId:'kiln-vault'});
    for (let i=0;i<11;i++) {
      const a=i*Math.PI/10;
      box([vaultX+.784*Math.cos(a),.704+.673*Math.sin(a),-.021],[.097,.048,.047],copper,'brass-voussoirs',.122,.023);
    }
    for (const dx of [-.87,.87]) {
      box([vaultX+dx,.135,-.43],[.18,.08,.434],trim,'vault-feet',.109,.049);
      for (let i=0;i<3;i++) box([vaultX+dx,.36+i*.23,-.055],[.105,.045,.035],red,'vault-seams',.098,.019);
    }
    box([vaultX,1.61,-.427],[.99,.078,.423],trim,'kiln-cap',.166,.055);
    box([vaultX,1.72,-.48],[.77,.054,.34],copper,'kiln-cap',.126,.044);
    S.bake();

    box([vaultX,.112,-.46],[.58,.055,.454],red,'copper-hearth',.152,.037);
    box([vaultX,.34,-.88],[.53,.225,.055],red,'red-bounce-plate',.12,.04);
    for (let i=0;i<3;i++) {
      const x=vaultX+(i-1)*.32;
      tube([[x,.20,-.70],[x,.375,-.62],[x,.301,-.44]],.042,flame,'heated-coils',.056);
    }

    // Light transmitted by the dome has to carry the instrument and its contrasting bands.
    const x=1.28, z=.35;
    box([x,.112,z],[.91,.122,.617],trim,'instrument-plinth',.116,.064);
    box([x,.263,z],[.77,.093,.54],copper,'instrument-plinth',.101,.056);
    box([x,.354,z],[.663,.042,.482],enamel,'instrument-plinth',.083,.038);
    S.lathe([x,.389,z],.75,[.37,.21,.095],chalk,{res:.073,objectId:'porcelain-oscillator'});
    for (const [i,y] of [.55,.71,.89,1.02].entries()) {
      const r=[.332,.271,.222,.149][i];
      S.torus([x,y,z],r,.044,i%2 ? copper : red,{res:.066,objectId:'oscillator-rings'});
    }
    ball([x,1.26,z],.098,flame,'signal-jewel',.047);
    box([x,.996,z],[.55,.012,.399],glass,'green-glass-lid',.079,.008);
    S.bake();
    // The optical envelope is a separate finite source around the painted assembly.
    box([x,.928,z],[.60,.53,.435],glass,'green-glass-envelope',.134,.18);
    S.bake();

    for (const side of [-1,1]) {
      box([x+side*.64,.945,z],[.032,.57,.485],copper,'glass-rails',.101,.024);
      for (const sy of [-1,1]) box([x+side*.641,.96+sy*.55,z+.42],[.044,.045,.035],trim,'glass-corners',.061,.021);
    }
    // A tiny separate screen tends to merge with the back wall when its dabs run together.
    for (let i=0;i<8;i++) {
      const xx=2.17+i*.101;
      box([xx,1.33,-.864],[.018,.365,.030],enamel,'calibration-grille',.118,.012);
    }
    for (const y of [.929,1.73]) box([2.525,y,-.864],[.456,.047,.069],copper,'calibration-grille',.11,.035);
    const paper=K.surface.material({r:[9,10,11,12],albedo:'#c68359'},{
      layers:{ backlight:{type:'transmission',color:13,source:'local',strength:.82,thickness:.11} }
    });
    box([2.57,.52,-.295],[.34,.35,.019],paper,'amber-paper-screen',.113,.011);
    for (const x of [2.197,2.944]) box([x,.52,-.292],[.028,.368,.052],trim,'paper-screen-frame',.075,.019);
    for (const y of [.149,.896]) box([2.57,y,-.29],[.39,.034,.046],copper,'paper-screen-frame',.079,.019);
    S.bake();

    const warm=t=>2.5+4.4*(.5+.5*Math.cos(t*Math.PI/1.4));
    return B.finish({
      id:'signal-conservatory',name:'The Signal Conservatory',
      cam:{ target:[.02,.84,.08],dist:8.9,yaw:.19,pitch:.29,ortho:true,sway:0 },
      radius:8.5, detail:24,dither:0,look:{splatCoverage:'continuous'},
      liveSun:{ direction:sun, ambient:.34, intensity:.74, shadows:true },
      areaLights:[
        { id:'kiln',at:[vaultX,.76,.58],normal:[0,-.32,-.95],size:[.41,.47],shape:'disk',
          color:'#ff944b',radius:2.25,intensity:warm,shadows:true,visible:false },
        { id:'silver-fill',at:[2.71,2.89,1.44],normal:[-.46,-.74,-.49],size:[1.45,.72],
          color:'#bfddff',radius:5.0,intensity:2.9,shadows:true,visible:false },
        { id:'behind-paper',at:[2.57,.52,-.61],normal:[0,0,1],size:[.39,.44],
          color:'#ffbc69',radius:1.56,intensity:t=>8-warm(t)*.65,shadows:true,visible:false }
      ],
      skyEnvironment:{defaults:{zenith:'#576581',horizon:'#536070',ground:'#151f2b',sunStrength:0}}
    });
  }
});
