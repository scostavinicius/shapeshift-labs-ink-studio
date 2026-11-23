module.exports = ({KIT:K,makeBuilder,makeSculpt})=>({
  id:'switchyard-signaler',
  name:'The Switchyard Signaler',
  seed:57,
  build(seed,{controls}={}) {
    const B=makeBuilder(seed,[
      0x14222c,0x203544,0x2f4b59,0x4e6a6e,0x748a84,0xb4c1a6,
      0x3c2933,0x6c4248,0x9b514b,0xc86a4f,0xec935e,0xffbc78,0xffdc9d,
      0x1b3d41,0x295d58,0x448a75,0x79b18a,0xb1d1a1,
      0x322c42,0x554459,0x795d66,0x9d7474,0xc69682,0xe7baa0,
      0x3b3c42,0x635451,0x94745d,0xc49d70,0xe9c483,0xffe8b4,
      0x207085,0x53bcc0,0xa7edde,0xf9f2c9
    ]);
    const S=K.sculpt(makeSculpt(B));
    Object.assign(S,{sun:K.V.norm([-.57,.64,.51]),amb:.48,sky:.18,sunK:.55,wob:.012});
    const tags=K.deform.tags(S);
    const jacket={r:[6,7,8,9,10,11]}, trim={r:[7,8,9,10,11,12]}, cloth={r:[0,1,2,3,4]};
    const leather={r:[6,7,25,26,27]}, metal={r:[18,19,20,24,25,26]}, gold={r:[24,25,26,27,28,29]};
    const teal={r:[13,14,15,16,17]}, face={r:[19,20,21,22,23]}, visor={r:[0,1,2,30,31]};
    const glow={r:[30,31,32,33],em:true};
    const tag=(part,objectId=part,res=.055)=>({tag:part,res,objectId});
    const box=(p,h,m,part,id,res,rd=.042)=>S.box(p,h,m,{...tag(part,id,res),rd});
    const ball=(p,r,m,part,id,res)=>S.ball(p,r,m,tag(part,id,res));
    const tube=(p,r,m,part,id,res)=>S.tube(p,r,r,m,tag(part,id,res));
    const turn=(p,h,r,m,part,id,res)=>S.lathe(p,h,r,m,tag(part,id,res));

    for(const [side,part] of [[-1,'leg-left'],[1,'leg-right']]) {
      const x=side*.20;
      turn([x,.14,-.015],.71,[.142,.124,.169],cloth,part,'pants');
      box([x,.12,.063],[.151,.112,.225],leather,part,'boots',.053,.068);
      box([x,.042,.085],[.155,.035,.233],cloth,part,'boots',.049,.029);
      box([x,.24,.126],[.105,.074,.049],metal,part,'boots',.042,.035);
      box([x,.56,.118],[.111,.078,.056],metal,part,'kneepads',.043,.034);
      box([x,.55,.181],[.071,.014,.014],gold,part,'kneepads',.032,.012);
    }
    turn([0,.714,0],.913,[.415,.373,.431,.494,.396],jacket,'torso','jacket',.064);
    box([0,.877,.203],[.368,.061,.067],leather,'torso','belt',.049);
    box([.017,.885,.265],[.091,.066,.021],gold,'torso','buckle',.036,.021);
    tube([[-.098,1.00,.234],[-.107,1.32,.283],[-.052,1.54,.259]],.019,trim,'torso','jacket-seam',.043);
    box([-.165,1.28,.264],[.117,.136,.037],trim,'torso','pocket',.047,.035);
    box([-.169,1.366,.291],[.094,.028,.019],gold,'torso','pocket',.035,.018);
    for(const y of [.995,1.13,1.30,1.435])
      ball([.043,y,.255],.027,gold,'torso','jacket-buttons',.029);
    box([0,1.297,-.261],[.288,.304,.166],metal,'torso','radio-pack',.066,.071);
    box([0,1.625,-.286],[.244,.048,.148],teal,'torso','radio-pack',.052,.035);
    tube([[.122,1.64,-.32],[.151,1.929,-.353],[.184,2.065,-.36]],.023,gold,'torso','radio-aerial',.044);
    ball([.182,2.073,-.359],.029,glow,'torso','radio-aerial',.027);
    turn([0,1.571,0],.14,[.233,.191],cloth,'torso','collar',.051);
    ball([.388,1.505,.057],[.164,.218,.200],jacket,'torso','working-shoulder',.051);
    ball([-.415,1.458,.016],[.133,.167,.156],trim,'torso','jacket',.049);

    ball([0,1.935,.017],[.279,.297,.245],face,'head','face',.054);
    box([0,1.897,.195],[.171,.092,.067],face,'head','face',.044,.036);
    box([0,2.008,.211],[.204,.081,.055],visor,'head','visor',.04,.039);
    box([.024,2.034,.257],[.135,.013,.012],teal,'head','visor',.035,.012);
    turn([0,2.072,.006],.215,[.289,.294,.201],gold,'head','helmet',.049);
    box([.024,2.094,.232],[.276,.030,.107],gold,'head','helmet',.047,.022);
    ball([-.222,1.998,.02],[.048,.083,.080],teal,'head','headset',.044);
    tube([[-.241,1.988,.074],[-.213,1.910,.186],[-.116,1.887,.248]],.019,metal,'head','headset',.044);
    ball([-.118,1.886,.25],.027,metal,'head','headset',.035);

    // The sleeve cap and torso shoulder meet at the raised arm joint.
    ball([.548,1.454,.021],[.161,.203,.167],trim,'upper','working-shoulder',.044);
    tube([[.55,1.414,.019],[.596,1.24,.022],[.632,.977,.049]],.122,jacket,'upper','working-shoulder',.049);
    box([.595,1.149,.111],[.099,.065,.049],gold,'upper','sleeve-badge',.040,.028);
    turn([.632,.938,.04],.109,[.119,.136],leather,'upper','sleeve-cuff',.046);
    tube([[.634,.966,.047],[.661,.777,.083],[.695,.589,.133]],.117,cloth,'fore','forearm',.05);
    box([.678,.72,.157],[.093,.126,.056],metal,'fore','bracer',.044,.049);
    box([.691,.664,.207],[.064,.036,.019],teal,'fore','bracer',.035,.018);
    ball([.70,.555,.145],[.104,.115,.082],leather,'fore','glove',.046);
    for(const [x,y,z] of [[-.49,1.43,.011],[-.558,1.12,.038],[-.585,.89,.086]])
      ball([x,y,z],[.132,.180,.126],jacket,'arm-left','left-sleeve',.054);
    tube([[-.575,.925,.076],[-.586,.765,.127],[-.562,.614,.145]],.104,cloth,'arm-left','left-sleeve',.053);
    ball([-.555,.588,.145],[.105,.098,.083],leather,'arm-left','glove',.044);
    S.bake();

    const world=B.finish({cam:{target:[.30,1.18,0],dist:4.54,yaw:.13,pitch:.13,ortho:true,sway:0},
      radius:5,detail:24,dither:0,look:{splatCoverage:'continuous'}});
    const smooth=n=>{const t=Math.max(0,Math.min(1,n));return t*t*(3-2*t);};
    const signaler=K.puppet(world,{
      parts:{
        torso:{ids:tags.torso,pivot:[0,.76,0],slices:5},
        head:{ids:tags.head,pivot:[0,1.715,0],parent:'torso'},
        upper:{ids:tags.upper,pivot:[.511,1.521,.027],parent:'torso',slices:4},
        fore:{ids:tags.fore,pivot:[.631,.973,.047],parent:'upper',slices:3},
        'arm-left':{ids:tags['arm-left'],pivot:[-.44,1.474,.026],parent:'torso'},
        'leg-left':{ids:tags['leg-left'],pivot:[-.20,.78,0]},
        'leg-right':{ids:tags['leg-right'],pivot:[.20,.78,0]}
      },
      pose(t,_dt,actor) {
        const lift=smooth((t-.13)/.88)*(1-smooth((t-1.37)/.88));
        actor.pose.torso={rot:[0,14*lift,-8*lift]};
        actor.pose.head={rot:[0,-19*lift,-5*lift]};
        actor.pose.upper={rot:[0,-9*lift,111*lift]};
        actor.pose.fore={rot:[0,7*lift,-25*lift]};
        actor.pose['arm-left']={rot:[0,0,-12*lift]};
      }
    });
    if (controls?.correctives!==false) {
      world.anim.update(0,1.1);
      const plan={id:'Raised sleeve',drivers:[{part:'upper',radius:54},{part:'fore',radius:86}],
        select:{object:'working-shoulder'},strokes:[
          {at:[.565,1.519,.162],radius:.49,move:[-.121,.172,.043]},
          {at:[.600,1.355,-.038],radius:.37,move:[-.035,-.083,.073]}
        ]};
      const asset=signaler.correctives.capture(plan);
      signaler.correctives.set([{...asset,sourceTime:1.1}]);
    }
    world.anim.update(0,0);
    return world;
  }
});
