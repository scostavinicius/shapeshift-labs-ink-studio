/* Sounding Glass. A submersible window picks up a luminous jelly. */
module.exports=({KIT:K,SpriteSurface,makeBuilder,makeSculpt})=>{
  const colors=[
    0x07141d,0x102731,0x183e48,0x27616a,0x45888a,0x77a59a,0x9bbaaa,
    0x342932,0x633e3e,0x955544,0xc27751,0xe8a763,0xffce87,0xffebba,0xfff1cb,
    0x152333,0x263848,0x45616a,0x638586,0x9da9a3,0x7f6251
  ];
  const tau=2*Math.PI, clamp=n=>Math.max(0,Math.min(255,n));
  const tint=(r,g,b)=>((clamp(r)|0)<<16)|((clamp(g)|0)<<8)|(clamp(b)|0);
  const fade=(a,b,v)=>{
    const u=Math.max(0,Math.min(1,(v-a)/(b-a)));
    return u*u*(3-2*u);
  };
  function build(seed) {
    const B=makeBuilder(seed,colors), S=K.sculpt(makeSculpt(B)), atlas=SpriteSurface.make(1024);
    Object.assign(S,{wob:.0015,amb:.45,sky:.24,sunK:.46,sun:K.V.norm([-.59,.75,.35])});
    const grain=(x,y)=>((x*2017^y*421^x*y*193)&15)-7;
    atlas.face([-6,-2.20,-2.7],[12,0,0],[0,5.8,0],384,184,(x,y)=>{
      const u=x/384,v=y/184,g=grain(x,y)*.52;
      const spotlight=Math.max(0,1-Math.hypot((u-.48)*2,(v-.32)*1.7));
      const ray=Math.max(0,Math.sin(37*(u-v*.44))*.8+Math.cos(11*(u-v*.31))*.49-.62)*(1-v)**1.5;
      const high=.83+.045*Math.sin(x*.073)+.06*Math.sin(x*.028), low=.95+.039*Math.sin(x*.092);
      if(v>low)return tint(6+g,17+g,23+g);
      if(v>high)return tint(10+g,33+g,40+g);
      const mote=((x*167^y*353^x*y*19)&127)===26 && Math.sin(x*.23+y*.1)>.05;
      return tint(10+9*spotlight+g+5*ray+(mote?19:0),28+25*spotlight+g+15*ray+(mote?32:0),
        38+29*spotlight+g+21*ray+(mote?31:0));
    },{id:'water'});

    atlas.face([-5.7,-2.45,.77],[11.4,0,0],[0,6.08,0],456,244,(x,y)=>{
      const dx=(x-228)/40, dy=(y-121)/40, r=Math.hypot(dx,dy*.99), a=Math.atan2(dy,dx), g=grain(x,y)*.57;
      if(r<1.42)return null;
      const direction=(Math.sin(a-2.1)+1)*.5, shade=direction**1.8;
      if(r<1.50)return tint(15+g+23*shade,31+g+25*shade,37+g+27*shade);
      if(r<1.58)return tint(45+g+56*shade,57+g+50*shade,58+g+43*shade);
      if(r<1.70){
        const bolt=Math.cos((a+.145)*12)>.950 && r>1.60 && r<1.68;
        return bolt?tint(101+38*shade,93+28*shade,70+15*shade):tint(61+g+29*shade,71+g+28*shade,66+g+26*shade);
      }
      if(r<1.735)return tint(41+g+24*shade,46+g+25*shade,45+g+25*shade);
      if(r<1.78)return tint(15+g+14*shade,26+g+13*shade,30+g+15*shade);
      const arc=Math.max(0,1-(r-1.78)*.72), cross=(y%44===4 || x%91===3) ? -8 : 0;
      const light=14*arc+7*Math.cos(4*a)*arc+g+cross;
      const angled=Math.sin(x*.035+y*.051)*1.9;
      return tint(17+light+angled,32+light+angled,37+light+angled);
    },{id:'observation-port'});

    const dark={r:[0,1,15,16]}, panel={r:[1,16,17,18]}, trim={r:[7,8,9,20]}, lamp={r:[4,5,6],em:true},
      jelly={r:[8,9,10,11,12,13]}, wire={r:[8,9,10,11]};
    const box=(p,h,m,id,res=.068,rd=.036)=>S.box(p,h,m,{objectId:id,res,rd});
    const tube=(p,a,b,m,id,res=.044)=>S.tube(p,a,b,m,{objectId:id,res});
    for(const sign of [-1,1]){
      const x=sign*2.37;
      box([x,.33,.82],[.33,.46,.071],dark,'pod');
      box([x,.36,.904],[.274,.363,.039],panel,'pod');
      box([x,.47,.954],[.206,.172,.022],dark,'pod',.043,.021);
      for(let i=0;i<3;i++)box([x-.116+i*.108,.476,.981],[.026,.079,.009],i===2?lamp:panel,'meter',.029,.009);
      box([x,.187,.957],[.093,.032,.019],trim,'pod',.038,.014);
      tube([[x,.012,.89],[x,-.23,.90],[x+sign*.21,-.41,.93],[x+sign*.51,-.43,.91]],.045,.047,trim,'cable');
    }
    box([0,-.962,.93],[3.4,.067,.096],dark,'sill',.108,.021);
    box([0,-.875,.94],[1.64,.022,.052],trim,'rim',.089,.019);
    S.bake();

    const first=B.count();
    S.ball([0,.635,-.58],[.59,.22,.31],jelly,{objectId:'jelly',res:.031});
    tube([[-.49,.555,-.37],[-.36,.488,-.33],[-.17,.458,-.31],[0,.444,-.30],
      [.20,.465,-.29],[.42,.493,-.33],[.522,.552,-.37]],.037,.027,{r:[11,12,13,14],em:true},'jelly-rim',.029);
    for(let i=0;i<5;i++){
      const x=(i-2)*.181,s=.13-i*.014;
      tube([[x,.473,-.524],[x+s,.291,-.494],[x-s,.12,-.45],[x-.09,-.13-i*.027,-.42],
        [x+s,-.34-i*.044,-.43]],.037-i*.004,.015,i===2?jelly:wire,'tendril',.029);
    }
    for(let i=0;i<3;i++){
      const x=(i-1)*.173;
      S.ball([x,.616+(i===1?.067:0),-.255],[.047,.042,.023],
        {r:[12,13,14],em:true},{objectId:'jelly-glow',res:.023});
    }
    S.bake();
    const last=B.count();
    for(let i=0;i<25;i++){
      const a=i*2.399, r=.60+(i%6)*.108, x=Math.cos(a)*r, y=.26+Math.sin(a)*r*.79;
      B.disc(x,y,-.36,[0,0,1],.017+(i%5===0?.010:0),.011,B.P[i%3===0?13:11],.7,{em:true});
    }
    const end=B.count();
    const world=B.finish({id:'sounding-glass',dither:0,radius:6,fog:{c:0,max:0},spriteSurfaces:atlas.finish(),
      cam:{target:[0,.61,0],dist:5.45,pitch:.022,yaw:.018,ortho:true,sway:0},look:{splatCoverage:'continuous'}});
    const coords=Array.from({length:end-first},(_,n)=>{
      const i=(first+n)*16, [x,y,z,alpha]=world.data.subarray(i,i+4), color=world.data[i+7];
      return {i,x,y,z,alpha,r:color&255,g:color>>8&255,b:color>>16&255};
    });
    world.anim={update(_dt,t){
      const rise=fade(.63,3.98,t), visible=t>=1.8-1e-7;
      const glow=visible?.92+.08*Math.cos(tau*.83*(t-1.8)):.13;
      const bob=.028*Math.sin(tau*.7*t);
      for(const [n,row] of coords.entries()){
        const {i,x,y,z,alpha,r,g,b}=row, whisker=y<.40;
        world.data[i]=x-.16+rise*.33+(whisker?.025*Math.sin(tau*.7*t+4*y):.009*Math.sin(tau*.7*t));
        world.data[i+1]=y-.56+rise*.83+bob;
        world.data[i+2]=z;
        if(first+n>=last)world.data[i+3]=alpha*(visible? .54+.42*Math.sin((n%5)*.47+t*3.2)**2 : 0);
        world.data[i+7]=(10+(r-10)*glow|0)+(24+(g-24)*glow|0)*256+(30+(b-30)*glow|0)*65536;
      }
    }};
    world.anim.update(0,0);
    return world;
  }
  return {id:'sounding-glass',name:'Sounding Glass',seed:13,build};
};
