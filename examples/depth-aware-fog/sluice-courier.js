module.exports = ({ KIT:K, makeBuilder, makeSculpt }) => ({
  id:'sluice-courier',
  name:'Courier at the floodgate',
  seed:71,
  build(seed) {
    const B=makeBuilder(seed,[
      0x101c27,0x182b3b,0x234353,0x355669,0x5a7e85,0x7fa7a2,0xb5c6ae,
      0x16383e,0x205954,0x31796a,0x4b9c82,0x8fc5a2,
      0x402e35,0x795044,0x9f6447,0xbc8055,0xde9e5e,0xffc77c,0xffe3a4,
      0x512738,0x874044,0xbc5142,0xe37642,0xf79844,0xffb759,
      0x112839,0x205061,0x367f90,0x68bfba,0xa2e8d5,
      0x4a4550,0x76636b,0xb19687,0xffebba
    ]);
    const S=K.sculpt(makeSculpt(B));
    Object.assign(S,{sun:K.V.norm([-.47,.71,.52]),amb:.42,sky:.13,sunK:.65,wob:.013});
    const foundation={r:[0,1,2,3]}, slate={r:[1,2,3,4,5]}, pale={r:[2,3,4,5,6]};
    const sealed={r:[0,1,2,7,8]}, copper={r:[12,13,14,15,16]}, faded={r:[7,8,9,10,11]};
    const bulb={r:[16,17,18,33],em:true}, aqua={r:[26,27,28,29],em:true};
    const box=(at,half,mat,objectId,res=.087,rd=.037)=>S.box(at,half,mat,{objectId,res,rd});
    const ball=(at,r,mat,objectId,res=.053)=>S.ball(at,r,mat,{objectId,res});
    const tube=(points,r,mat,objectId,res=.061)=>S.tube(points,r,r,mat,{objectId,res});

    box([0,-.28,.45],[4.45,.32,1.74],foundation,'sluice-floor',.17,.105);
    box([0,.012,.514],[4.34,.073,1.62],slate,'sluice-floor',.151,.04);
    for (let i=0;i<14;i++) {
      const x=(i-6.5)*.59;
      box([x,.092,1.85],[.215,.013,.056],faded,'walkway-inlay',.064,.012);
    }
    box([0,1.395,.408],[4.4,1.285,.15],sealed,'lock-wall',.146,.05);
    box([0,2.721,.501],[4.3,.081,.192],slate,'wall-coping',.138,.035);
    box([0,.18,.5],[4.38,.097,.194],foundation,'wall-coping',.141,.036);
    for (const x of [-3.35,-2.05,-.71,.71,2.05,3.35]) {
      box([x,1.38,.558],[.034,1.21,.036],slate,'wall-mullions',.105,.026);
      for (const y of [.34,1.31,2.42]) ball([x,y,.604],.026,pale,'wall-mullions',.028);
    }
    for (const x of [-2.71,2.71]) {
      box([x,1.43,.573],[.40,.76,.041],foundation,'sluice-doors',.105,.049);
      for (let i=0;i<7;i++) box([x+(i-3)*.089,1.43,.614],[.025,.65,.024],slate,'sluice-doors',.077,.019);
      for (const y of [.87,2.00]) box([x,y,.644],[.39,.034,.025],pale,'sluice-doors',.084,.024);
    }
    for (const x of [-3.68,3.66]) {
      box([x,.23,.85],[.36,.14,.29],slate,'lamp-housing',.088,.066);
      box([x,1.472,.66],[.088,1.25,.095],copper,'lamp-housing',.094,.049);
      tube([[x,2.01,.69],[x,2.30,.79],[x,2.36,.99]],.037,copper,'lamp-housing',.047);
      box([x,2.27,.986],[.196,.095,.122],copper,'lamp-housing',.058,.036);
      box([x,2.202,.992],[.152,.021,.090],x<0?aqua:bulb,'lamp-housing',.052,.015);
    }
    const stationX=-2.47;
    box([stationX,.25,1.56],[.38,.18,.30],foundation,'signal-crate',.084,.054);
    box([stationX,.445,1.56],[.31,.041,.274],faded,'signal-crate',.071,.028);
    for (const x of [-2.68,-2.26]) box([x,.268,1.858],[.041,.119,.019],copper,'signal-crate',.055,.014);
    box([stationX,.278,1.875],[.072,.026,.014],bulb,'signal-crate',.041,.013);
    for (const x of [-3.45,-.80,.86,3.49]) {
      box([x,.129,1.70],[.106,.073,.111],pale,'rail-ends',.062,.045);
      tube([[x,.18,1.70],[x,.76,1.70]],.037,slate,'rail-ends',.054);
    }
    for (const [a,b] of [[-3.45,-2.87],[2.83,3.49]])
      tube([[a,.758,1.70],[b,.758,1.70]],.029,copper,'rail-ends',.056);
    S.bake();

    const actor='courier', coat={r:[19,20,21,22,23,24]}, hood={r:[20,21,22,23,24]},
      boots={r:[0,1,12,13]}, leather={r:[12,13,14,15,16]}, face={r:[12,14,15,16,17]},
      glass={r:[0,25,26,27,28]}, lime={r:[15,16,17,18,33]};
    const z=.987, start=B.count();
    function A(x,y,d=0) {return [x,y,z+d];}
    S.lathe(A(0,.48),.77,[.303,.275,.208],coat,{res:.052,objectId:actor});
    box(A(.008,.70,-.182),[.224,.273,.079],leather,actor,.050,.047);
    box(A(.015,.78,.258),[.260,.056,.018],boots,actor,.034,.011);
    box(A(.019,.793,.279),[.067,.039,.015],lime,actor,.037,.013);
    box(A(-.032,1.123,.119),[.142,.074,.089],leather,actor,.042,.026);
    for (const s of [-1,1]) {
      ball(A(s*.241,1.043,.011),[.115,.150,.108],coat,actor,.046);
      tube([A(s*.305,.995,.042),A(s*.352,.82,.118),A(s*.373,.66,.188)],.079,coat,actor,.048);
      ball(A(s*.372,.643,.196),[.085,.084,.081],leather,actor,.041);
    }
    ball(A(0,1.394,.030),[.228,.263,.197],hood,actor,.045);
    ball(A(0,1.363,.177),[.169,.163,.082],face,actor,.041);
    box(A(.018,1.405,.244),[.156,.074,.039],glass,actor,.034,.033);
    box(A(.036,1.435,.284),[.082,.013,.009],aqua,actor,.030,.008);
    box(A(0,1.547,.21),[.135,.029,.064],hood,actor,.038,.024);
    tube([A(-.18,1.46,.02),A(-.191,1.68,.011),A(-.148,1.75,.02)],.018,leather,actor,.027);
    ball(A(-.141,1.753,.023),.026,bulb,actor,.026);
    tube([A(.378,.624,.174),A(.435,.553,.186),A(.495,.585,.205)],.021,leather,actor,.026);
    box(A(.469,.434,.21),[.095,.127,.057],boots,actor,.032,.024);
    box(A(.469,.435,.272),[.061,.082,.018],bulb,actor,.029,.015);
    S.bake();
    const bodyEnd=B.count(), legs=[];
    for (const side of [-1,1]) {
      const first=B.count();
      tube([A(side*.127,.62),A(side*.147,.386,.025),A(side*.161,.193,.067)],.093,boots,actor,.049);
      box(A(side*.171,.163,.111),[.108,.080,.145],boots,actor,.046,.036);
      box(A(side*.172,.157,.228),[.081,.032,.021],leather,actor,.043,.017);
      S.bake();
      legs.push([first,B.count()]);
    }

    const bounds={min:[-4.24,.06,.568],max:[4.24,2.61,.915]};
    const banks=K.procedural.density.bounded({bounds,sample:(x,y,z,t)=>{
      const ripple=.55+.22*Math.sin(4.3*y-.55*x+1.35*t)+.18*Math.sin(3.9*x+9*z-1.12*t);
      const weight=(Math.max(.27,Math.min(1,1.25-y*.34)));
      return Math.max(0,ripple)*weight;
    }});
    const pool=K.procedural.density.bounded({bounds:{min:[-4,-.13,.95],max:[4,.47,2.52]},
      sample:(x,y,z,t)=>Math.max(0,.58+.36*Math.sin(1.7*x+4.1*z-.88*t)) });
    const world=B.finish({
      cam:{target:[0,1.19,.45],dist:7.35,yaw:.015,pitch:.103,ortho:true,sway:0},
      radius:10, detail:25,dither:0,look:{splatCoverage:'continuous'},
      atmosphere:[
        K.atmosphere.field({field:banks,density:8.5,step:.036,color:'#83b9c1',anisotropy:.11}),
        K.atmosphere.field({field:pool,density:.34,step:.16,color:'#858fa0',lit:false})
      ],
      volumeLighting:{ambient:.68,points:[
        {at:[-2.56,1.18,.973],radius:2.7,color:'#48f7e9',intensity:2.85,castsShadow:false},
        {at:[2.49,1.833,.949],radius:2.37,color:'#ffc365',intensity:2.72,castsShadow:false}
      ]},
      volumeQuality:{scale:4,depthTolerance:.49,steps:46},
      skyEnvironment:{defaults:{zenith:'#263849',horizon:'#71848a',ground:'#293a45',sunStrength:0}}
    });
    const stage=K.stage(world);
    stage.stateful=false;
    stage.t0=0;
    function move(first,end,x,y) {
      for (let i=first;i<end;i++) {
        stage.D[i*16]=stage.base[i*16]+x;
        stage.D[i*16+1]=stage.base[i*16+1]+y;
        stage.touch(i);
      }
    }
    stage.add({pre(_dt,t){
      const walk=-.94+t*.87, stride=t*Math.PI*2*1.24;
      move(start,bodyEnd,walk,.024*Math.cos(stride*2));
      for (const [i,[first,end]] of legs.entries()) {
        const step=Math.sin(stride+i*Math.PI);
        move(first,end,walk+.10*step,.055*Math.max(0,step));
      }
    }});
    return world;
  }
});
