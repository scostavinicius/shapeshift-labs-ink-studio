/* Last Ferry. A brass bell swings through a harbor squall. */
module.exports=({KIT:K,SpriteSurface,makeBuilder,makeSculpt})=>{
  const palette=[
    0x102031,0x203544,0x305060,0x456977,0x5b8590,0x80a6a3,
    0x312d3b,0x4b4149,0x64524c,0x886c57,0xae8b63,
    0x453137,0x76513c,0xaa754a,0xd89958,0xf2b96f,0xffda8e,0xffe9bd,
    0x29454c,0x3c5d62,0x47777a,0x659091,0x89abad,0xb9cdca
  ];
  const tint=(r,g,b)=>((Math.max(0,Math.min(255,r))|0)<<16)|
    ((Math.max(0,Math.min(255,g))|0)<<8)|(Math.max(0,Math.min(255,b))|0);
  const tau=2*Math.PI;
  function build(seed){
    const B=makeBuilder(seed,palette), S=K.sculpt(makeSculpt(B)), sky=SpriteSurface.make(512);
    Object.assign(S,{wob:.002,amb:.47,sky:.22,sunK:.43,sun:K.V.norm([-.62,.73,.39])});
    sky.face([-8,-2.14,-3.1],[16,0,0],[0,5.4,0],426,146,(x,y)=>{
      const v=y/146, g=(((x*1319^y*827^x*y*37)&15)-7)*.6;
      const ridge=.46+.036*Math.sin(.071*x)+.039*Math.sin(.027*x+1.2);
      if(v<ridge){
        const sunset=Math.max(0,1-Math.abs(v-.435)*2.7), cloud=Math.sin(x*.058+y*.29)+.63*Math.sin(x*.032-y*.54);
        const dark=cloud>.63 ? -13 : cloud>-.25 ? -5 : 0;
        return tint(39+51*sunset+g+dark,59+40*sunset+g+dark,85+24*sunset+g+dark);
      }
      if(v<ridge+.06){
        const city=(x%19<12)&&((y*127+x*197)&31)<2;
        return city?tint(187,150,93):tint(22+g,49+g,64+g);
      }
      const ripple=(Math.sin(y*2.46+x*.076)+.48*Math.sin(y*1.18-x*.19))>.87;
      const silver=ripple ? 15+11*Math.sin(x*.039) : 0;
      return tint(25+g+silver,53+g+silver,66+g+silver);
    });
    const wood={r:[0,1,6,7,8]}, iron={r:[0,1,2,6,7]}, teal={r:[0,1,18,19,20,21]}, brass={r:[11,12,13,14,15,16]},
      trim={r:[8,9,12,14,15]}, bulb={r:[14,15,16,17],em:true};
    const box=(p,h,m,id,res=.07,rd=.033)=>S.box(p,h,m,{objectId:id,res,rd});
    const tube=(p,a,b,m,id,res=.06)=>S.tube(p,a,b,m,{objectId:id,res});
    box([0,-.40,.54],[4.4,.12,1.02],wood,'dock',.16);
    for(let i=0;i<12;i++){
      const x=-4.28+i*.74;
      box([x,-.263,.54],[.354,.04,1.02],i%3?wood:teal,'dock',.14);
    }
    for(const x of [-1.62,1.66]){
      box([x,.93,-.05],[.19,1.30,.205],wood,'gantry',.092,.048);
      box([x,.17,-.02],[.228,.30,.23],iron,'gantry',.082,.051);
      box([x,1.88,-.06],[.22,.077,.25],iron,'gantry',.057);
    }
    box([.02,2.03,-.06],[1.91,.152,.21],teal,'gantry',.073,.048);
    box([.02,2.123,.14],[1.905,.047,.052],trim,'gantry-details',.058,.024);
    for(const side of [-1,1]){
      const x=side*1.60;
      tube([[x,1.39,-.05],[x-side*.44,1.90,-.054]],.044,.046,iron,'gantry');
      box([x+.34*side,.54,-.52],[.055,.76,.05],iron,'rail',.074,.022);
      box([x+.88*side,.48,-.54],[.54,.035,.04],teal,'rail',.065,.018);
      box([x+.88*side,1.10,-.54],[.54,.038,.04],teal,'rail',.070,.02);
      for(let i=1;i<=3;i++)box([x+side*(.38+i*.258),.78,-.53],[.022,.314,.025],iron,'rail',.077,.015);
      const lampX=x+.63*side;
      box([lampX,.55,-.25],[.124,.148,.101],iron,'lamp',.041);
      box([lampX,.56,-.127],[.082,.093,.03],bulb,'lamp',.03,.025);
      box([lampX,.69,-.2],[.15,.028,.118],wood,'lamp',.043,.026);
    }
    S.bake();
    const first=B.count();
    box([0,1.788,.23],[.074,.12,.074],steel(),'bell',.041,.029);
    S.lathe([0,.952,.23],.744,t=>.225+.335*(1-t)**2.65,brass,{objectId:'bell',res:.034});
    S.lathe([0,.941,.23],.075,[.553,.531],trim,{objectId:'bell',res:.038});
    S.lathe([0,.885,.24],.075,[.518,.529],wood,{objectId:'bell',res:.043});
    tube([[0,1.085,.40],[0,.823,.42],[0,.729,.44]],.036,.030,iron,'bell',.033);
    S.ball([0,.751,.44],[.089,.079,.078],brass,{objectId:'bell',res:.030});
    S.bake();
    const last=B.count();
    K.weather.fall(B,{kind:'rain',worldSpace:true,profile:false,n:1850,seed:seed+19,box:[-4.7,4.8,-1.6,3.0],
      top:4.4,ground:()=>-.37,cols:[20,21,22,23],len:.165,size:.015,speed:8.3});
    const world=B.finish({id:'last-ferry',dither:0,radius:6,fog:{c:0,max:0},spriteSurfaces:sky.finish(),
      cam:{target:[.015,.90,.10],dist:5.0,pitch:.115,yaw:-.094,ortho:true,sway:0},
      precipitation:{rain:1,occlusion:false},
      look:{splatCoverage:'continuous',passQuality:{background:{select:[{object:'bell'},{object:'gantry-details'}],retain:.24}}}});
    const base=Array.from({length:last-first},(_,n)=>[world.data[(first+n)*16],world.data[(first+n)*16+1]]);
    world.anim={update(_dt,t){
      const elapsed=t-1.7, q=elapsed<0?-.023*Math.sin(tau*.42*t):.27*Math.exp(-elapsed*.92)*Math.sin(tau*1.48*elapsed);
      const c=Math.cos(q),s=Math.sin(q);
      for(let i=first;i<last;i++){
        const [x,y]=base[i-first], vy=y-1.81;
        world.data[i*16]=x*c-vy*s;
        world.data[i*16+1]=1.81+x*s+vy*c;
      }
    }};
    return world;
    function steel(){return {r:[0,1,2,7]};}
  }
  return {id:'last-ferry',name:'Last Ferry',seed:47,build};
};
