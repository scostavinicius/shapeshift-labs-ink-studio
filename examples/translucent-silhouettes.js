module.exports = ({ KIT:K, makeBuilder, makeSculpt }) => {
  const groups=[];
  return {
    id:'translucent-silhouettes',
    name:'Tea glass',
    seed:21,
    build(seed) {
      groups.length=0;
      const B=makeBuilder(seed,[
        0x253847,0x31454f,0x57676c,0x8c8a7a,0xab987d,0xd4b897,
        0x4a363b,0x7f5145,0xb37651,0xe1a76b,0xf5d3a0,
        0x376c80,0x5188a2,0x75b4c6,0x96d7db,0xbfebe8,0xeff5e6,
        0x984d64,0xc56873,0xe09589,0xf2b89b,
        0x536643,0x7a8e51,0xa5b46d,0xbfd788,
        0x6e8497,0x94aebf,0xd1e2df,0xffecd0,
        0x374d60,0x515466,0x6b5363,0x896173
      ]);
      const S=makeSculpt(B);
      S.sun=K.V.norm([-.54,.68,.49]);
      S.amb=.39;
      S.sky=.13;
      const iron={r:[1,2,3]}, stone={r:[2,3,4,5]}, brass={r:[6,7,8,9,10]}, glow={r:[10,28],em:true};
      S.box([0,-.32,0],[1.58,.195,.88],iron,{res:.09,rd:.08});
      S.box([0,-.125,0],[1.52,.076,.84],stone,{res:.075,rd:.055});
      for (let i=0;i<6;i++) S.box([(i-2.5)*.47,-.046,.39],[.228,.026,.37],stone,{res:.07,rd:.023});
      S.lathe([-.51,.002,.06],.15,[.43,.38],iron,{res:.053});
      S.ball([-.51,.43,.06],[.39,.34,.37],brass,{res:.054});
      S.lathe([-.51,.69,.06],.115,[.259,.16,.065],brass,{res:.041});
      S.ball([-.51,.82,.06],.081,glow,{res:.050});
      S.tube([[-.23,.44,.06],[-.01,.54,.06],[.12,.76,.06]],.105,.048,brass,{res:.046});
      S.tube([[-.85,.52,.05],[-1.05,.63,.05],[-1.12,.42,.05],[-.87,.32,.05]],.061,.055,iron,{res:.053});
      S.lathe([1.02,.005,.28],.31,[.23,.29],brass,{res:.045});
      S.lathe([1.02,.27,.28],.075,[.30,.31],stone,{res:.052});
      S.bake();
      const rod=(a,b,r,color,alpha=1.2,flags)=>{
        const span=K.V.sub(b,a);
        B.axial(...K.V.lerp(a,b,.5),K.V.norm(span),.39*K.V.len(span),r,B.P[color],alpha,flags);
      };
      function begin() { return B.count(); }
      function end(first,material,offset) {
        B.describeSplats(first,B.count(),{material,object:material});
        if (offset) groups.push({first,end:B.count(),offset});
      }
      function card(at,axes,color,alpha,shape,extra) {
        const first=begin();
        const normal=K.V.norm(K.V.cross(axes.slice(0,3),axes.slice(3)));
        B.disc(...at,normal,.4,.018,B.P[color],alpha,{nd:true,...extra});
        B.describeFootprint(first,B.count(),{...shape,depth:'plane'},axes);
      }
      let first=begin();
      const plume=[
        [[.125,.80,.10],[.17,.95,.12],.044], [[.17,.94,.12],[.06,1.14,.10],.062],
        [[.06,1.11,.10],[-.20,1.31,.05],.091], [[-.17,1.30,.05],[-.35,1.51,.06],.11],
        [[-.33,1.50,.06],[-.25,1.67,.14],.10], [[-.24,1.66,.14],[.06,1.82,.18],.101],
        [[.09,1.81,.18],[.34,2.00,.20],.092]
      ];
      for (const [index,[a,b,r]] of plume.entries()) {
        rod(a,b,r,index<3?27:26,.73-index*.048,{nd:true});
        if (index>1) rod(K.V.mad(a,[1,.29,0],.075),K.V.mad(b,[1,.24,0],.11),r*.64,27,.20,{nd:true});
      }
      end(first,'steam',p=>[.16*Math.sin(p),.07*Math.cos(p),0]);

      first=begin();
      card([.02,1.21,.25],[.52,.12,0,-.15,.62,.03],13,.19,{shape:'square',softness:.022},{gl:true});
      end(first,'pane',p=>[.24*Math.sin(p),0,.52*Math.cos(p)]);
      first=begin();
      const rim=[[-.35,.47,.22],[.69,.71,.22],[.39,1.95,.28],[-.65,1.71,.28]];
      for (let i=0;i<4;i++) rod(rim[i],rim[(i+1)%4],.031,i<2?13:15,.56,{gl:true,nd:true});
      rod([-.54,1.46,.26],[-.12,1.62,.27],.023,16,.43,{nd:true});
      end(first,'glass-edge',p=>[.24*Math.sin(p),0,.52*Math.cos(p)]);

      first=begin();
      const hem=[[-1.36,1.33,.25],[-.98,1.41,.32],[-.58,1.49,.39],[-.17,1.54,.44],
        [.25,1.52,.43],[.64,1.44,.37],[1.02,1.51,.28]];
      for (let i=0;i<hem.length-1;i++) {
        const a=hem[i],b=hem[i+1];
        rod(a,b,.036,i%3===1?20:18,.76,{nd:true});
        rod(K.V.mad(a,[0,-1,0],.051),K.V.mad(b,[0,-1,0],.046),.025,i%2?17:19,.51,{nd:true});
      }
      end(first,'silk',p=>[-.08*Math.sin(p),.10*Math.sin(p),-.52*Math.cos(p)]);

      first=begin();
      rod([1.01,.31,.28],[.79,1.26,.28],.023,21,.83,{nd:true});
      const leafShape={shape:'polygon',vertices:[[-1,0],[-.49,.64],[.21,.83],[1,.16],[.36,-.57],[-.4,-.55]],softness:.08};
      for (const [i,at] of [[.75,.66,.29],[1.18,.72,.30],[.65,.91,.29],[1.02,1.03,.26],[.78,1.23,.25]].entries()) {
        const sign=i%2?-1:1;
        card(at,[sign*.205,-.064,0,sign*.023,.079,.033],22+i%3,.81,leafShape);
      }
      rod([.88,1.00,.26],[.46,1.16,.25],.018,24,.81,{nd:true});
      rod([1.04,.72,.30],[1.32,.86,.28],.018,23,.75,{nd:true});
      end(first,'leaves',p=>[.14*Math.sin(p+.32),.035*Math.sin(p),.17*Math.cos(p)]);
      return B.finish({
        cam:{target:[-.06,.89,.03],dist:4.65,yaw:.15,pitch:.12,ortho:true,sway:0},
        detail:22,radius:4,dither:0,refract:.65,
        look:{stableTransparency:{mode:'blend',depthTolerance:.11},translucentSilhouettes:{rules:[
          {select:{material:'steam'},policy:'steam'},
          {select:{material:'glass-edge'},policy:'glass',width:1.48,opacity:1.16},
          {select:{material:'silk'},policy:'cloth',width:1.38,opacity:1.18},
          {select:{material:'leaves'},policy:'foliage'}
        ]}}
      });
    },
    animate(world) {
      const rest=world.data.slice();
      world.anim={update(_dt,time){
        for (const {first,end,offset} of groups) {
          const shift=offset(time*Math.PI);
          for (let i=first;i<end;i++) for (let a=0;a<3;a++) world.data[i*16+a]=rest[i*16+a]+shift[a];
        }
      }};
    }
  };
};
