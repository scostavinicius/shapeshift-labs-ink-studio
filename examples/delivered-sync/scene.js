/* Relay Press, a brass contact closes on a steel terminal. */
module.exports=({KIT:K,makeBuilder,makeSculpt,SpriteSurface})=>{
  const colors=[
    0x111b28,0x1c2b3d,0x28394e,0x3e5569,0x5c7182,0x8796a0,0xa8b3b3,
    0x2e2933,0x45373b,0x634a44,0x936549,0xc08c54,0xe0ab68,0xf3cc85,0xffe2a5,
    0x193843,0x275561,0x3d7881,0x4e9d9f,0x82c4bc,0xd7e3c4,
    0x322b39,0x67535d,0x9c6c66,0xc58d6b
  ];
  function build(seed) {
    const B=makeBuilder(seed,colors), S=K.sculpt(makeSculpt(B)), backdrop=SpriteSurface.make(512);
    Object.assign(S,{wob:.002,amb:.42,sky:.21,sunK:.55,sun:K.V.norm([-.67,.66,.44])});
    backdrop.face([-6,-1.86,-1.42],[12,0,0],[0,5.5,0],240,112,(x,y)=>{
      const stripe=(x+13)%31, line=(y+6)%29, dust=((x*2191^y*457^x*y*97)&15)-7;
      const lit=Math.max(0,1-Math.hypot((x-112)/117,(y-51)/62));
      const seam=stripe===0 || line===0 ? -9 : stripe===1 || line===1 ? 6 : 0;
      const r=20+24*lit+dust*.56+seam, g=29+26*lit+dust*.62+seam, b=43+31*lit+dust*.66+seam;
      return ((r|0)<<16)|((g|0)<<8)|(b|0);
    });
    const panel={r:[0,1,2,3,4]}, steel={r:[1,2,3,4,5,6]}, rim={r:[0,1,7,8,9]}, dark={r:[0,1,7,8]},
      brass={r:[8,9,10,11,12,13,14]}, copper={r:[8,9,10,11,23,24]}, teal={r:[1,15,16,17,18,19]};
    const box=(p,h,m,id,res=.064,rd=.037)=>S.box(p,h,m,{objectId:id,res,rd});
    const tube=(p,a,b,m,id,res=.045)=>S.tube(p,a,b,m,{objectId:id,res});
    const ball=(p,r,m,id,res=.038)=>S.ball(p,r,m,{objectId:id,res});
    box([.04,-.47,.46],[4.72,.13,1.5],rim,'bench',.136);
    box([.04,-.314,.47],[4.63,.047,1.48],panel,'bench',.14);
    box([.04,-.356,1.86],[4.63,.053,.04],copper,'edge',.12,.022);
    box([.06,-.16,.04],[1.8,.13,.66],dark,'press',.09,.09);
    box([.06,-.015,.04],[1.7,.047,.61],steel,'press',.084,.04);
    for (const x of [-1.43,1.56]) {
      box([x,.84,-.11],[.125,.85,.17],panel,'press',.077,.052);
      box([x,.27,-.11],[.20,.27,.24],teal,'press',.071,.045);
      box([x,1.48,-.11],[.201,.09,.25],dark,'press',.061,.043);
      ball([x,1.46,.145],[.066,.066,.043],brass,'pin');
    }
    box([.061,1.786,-.09],[1.59,.24,.39],panel,'press',.085,.083);
    box([.061,1.68,.273],[1.333,.103,.088],dark,'press',.066,.05);
    box([-.021,1.84,.294],[.325,.091,.076],teal,'press',.053,.036);
    for (let i=0;i<6;i++)
      box([-.185+i*.066,1.83,.369],[.012,.044,.014],dark,'press',.025,.011);
    box([.06,.118,.06],[.55,.095,.42],dark,'anvil',.066,.04);
    box([.06,.266,.06],[.417,.115,.32],teal,'anvil',.058,.038);
    box([.06,.404,.06],[.32,.035,.233],steel,'terminal',.038,.02);
    for (const x of [-.25,.37]) ball([x,.228,.385],[.046,.049,.03],brass,'pin',.027);
    tube([[.36,.20,.39],[.62,.15,.48],[.85,.068,.44],[.99,.08,.20]],.037,.036,copper,'wiring');
    for (const x of [-2.55,2.62]) {
      box([x,.14,-.13],[.40,.39,.344],panel,'box',.084,.065);
      box([x,.24,.221],[.27,.191,.048],dark,'box',.065,.037);
      for (let i=0;i<3;i++) box([x-.166+i*.165,.311,.274],[.037,.073,.015],teal,'box',.035,.011);
      for (const sign of [-1,1]) ball([x+sign*.30,.02,.23],[.05,.053,.029],brass,'pin',.032);
    }
    tube([[1.89,.116,-.08],[2.05,.237,.06],[2.117,.196,.02],[2.22,.12,-.13]],.049,.037,teal,'wiring');
    S.bake();
    const first=B.count();
    tube([[.06,.837,.08],[.06,1.89,.08]],.09,.12,steel,'ram',.043);
    box([.06,.695,.08],[.239,.12,.179],brass,'ram',.039,.04);
    box([.06,.57,.08],[.204,.035,.167],brass,'ram-tip',.028,.019);
    box([.06,.716,.256],[.13,.039,.023],copper,'ram',.034,.019);
    ball([.06,.717,.275],[.046,.044,.029],steel,'ram');
    S.bake();
    const last=B.count();
    const world=B.finish({id:'relay-press',dither:0,radius:7,fog:{c:0,max:0},spriteSurfaces:backdrop.finish(),
      cam:{target:[.06,.80,-.08],dist:5.65,pitch:.085,yaw:.10,ortho:true,sway:0},
      look:{splatCoverage:'continuous'}});
    const y=Array.from({length:last-first},(_,i)=>world.data[(first+i)*16+1]);
    const smooth=value=>{
      const u=Math.max(0,Math.min(1,value));
      return u*u*(3-2*u);
    };
    world.anim={update(_dt,t) {
      const f=t*24, approach=.049*smooth((f-12)/12);
      const closure=f>=26-.000001 ? .128 : 0;
      const returnEase=smooth((f-36)/13);
      const drop=(approach+closure)*(1-returnEase);
      for (let i=first;i<last;i++) world.data[i*16+1]=y[i-first]+.085-drop;
    }};
    return world;
  }
  return {id:'relay-press',name:'Relay Press',seed:79,build};
};
