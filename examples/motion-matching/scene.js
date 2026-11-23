/* The two couriers share the same controls and root motion. Their feet take different paths. */
function switchbackCourier({KIT:K,makeBuilder,makeSculpt}) {
  const {M,V}=K, step=1/60, speed=1.8, duration=4.4;
  const route=[
    {at:0,name:'Approach',v:[speed,0]},
    {at:1.24,name:'Left turn',v:[0,speed]},
    {at:2.43,name:'Reverse',v:[0,-speed]},
    {at:3.69,name:'Stop',v:[0,0]}
  ];
  const command=(x,z)=>{
    const magnitude=Math.hypot(x,z);
    return magnitude ? [x*speed/magnitude,z*speed/magnitude] : [0,0];
  };
  const home=[[-.225,.018],[.225,.018]];
  const palette=[
    0x0d1925,0x1e2d3b,0x273b47,0x33505a,0x456367,0x617b78,0x8ba097,0xb7c5a9,
    0x123540,0x216273,0x3795a2,0x65cdcf,0xa1ede0,0xe1f8d3,
    0x432d32,0x704538,0xa8683f,0xd49a4d,0xffcc72,0xffe1a4,0xfbf4d4,
    0x483749,0x765465,0xad7782,0xdfa9a3
  ];
  const ground=()=>0;
  const angle=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
  const norm=p=>V.norm(p);
  const restBody=[0,.95,0];
  function build(seed=73,{controls}={}) {
    const matched=controls?.matched!==false;
    const B=makeBuilder(seed,palette), S=K.sculpt(makeSculpt(B)), R=K.rig(B,S);
    Object.assign(S,{sun:norm([-.45,.73,.55]),amb:.58,sunK:.55,sky:.24,wob:.015});
    const cloth={r:[8,9,10,11,12]}, armor={r:[14,15,16,17,18,19]}, brass={r:[15,16,17,18,19,20]},
      dark={r:[0,1,2,3,4]}, steel={r:[1,2,3,4,5,6]}, lens={r:[9,10,11,12,13],em:true};
    const box=(p,h,c,tag,res=.049,rd=.035)=>S.box(p,h,c,{tag,res,rd});
    const ball=(p,r,c,tag,res=.046)=>S.ball(p,r,c,{tag,res});
    const tube=(p,r,c,tag,res=.047)=>S.tube(p,r,r,c,{tag,res});
    for(let z=-5;z<=5;z++) for(let x=-5;x<=5;x++) {
      const stripe=x===0||z===0, shade=(x*13+z*49)%5;
      box([x,-.052,z],[.486,.053,.486],{r:stripe?[1,2,3,4]:shade?[0,1,2,3]:[0,2,3,4]},null,.164,.06);
      if(stripe&&(x||z)) {
        const mark=x===0?[.028,.009,.175]:[.175,.009,.028];
        box([x,.001,z],mark,{r:[3,4,5]},null,.084,.008);
      }
      if((x===2||x===-2)&&(z===2||z===-2)) {
        box([x,.026,z],[.160,.032,.160],armor,null,.074);
        box([x,.064,z],[.065,.027,.065],lens,null,.058);
      }
    }
    box([0,.035,-3.32],[1.18,.037,.064],armor,null,.074);
    box([0,.035,3.32],[1.18,.037,.064],armor,null,.074);

    const body='chassis';
    box([0,1.115,0],[.329,.228,.286],cloth,body,.049,.127);
    box([0,.953,.006],[.288,.109,.254],steel,body,.051,.063);
    box([0,1.355,.026],[.283,.108,.228],brass,body,.045,.077);
    box([0,1.417,.043],[.222,.046,.163],armor,body,.041,.040);
    box([0,1.166,.259],[.223,.099,.071],dark,body,.038,.051);
    box([0,1.173,.317],[.148,.042,.027],lens,body,.034,.019);
    for(const x of [-.264,.264]) ball([x,1.167,.207],[.073,.073,.061],brass,body,.035);
    box([0,1.139,-.292],[.244,.170,.101],armor,body,.051,.063);
    tube([[.176,1.411,-.145],[.209,1.63,-.155]],.017,steel,body,.031);
    ball([.211,1.634,-.155],.039,brass,body,.032);
    box([-.350,1.107,-.015],[.046,.121,.174],armor,body,.04,.038);
    box([.350,1.107,-.015],[.046,.121,.174],armor,body,.04,.038);
    for(const x of [-.12,0,.12]) box([x,1.075,-.386],[.028,.061,.017],dark,body,.034,.013);

    const legs=home.map(([x,z],i)=>{
      const hip=[x*.89,.957,z], knee=[x,.506,z+.265], ankle=[x,.104,z];
      const a='thigh-'+i,b='shin-'+i,c='sole-'+i;
      tube([hip,knee],.069,steel,a);
      ball([x,.708,z+.136],[.087,.147,.106],armor,a,.042);
      tube([knee,ankle],.056,cloth,b);
      ball(knee,[.108,.112,.094],brass,b,.036);
      ball([x+Math.sign(x)*.089,.506,z+.265],.032,dark,b,.029);
      box([x,.069,z+.041],[.109,.068,.173],steel,c,.041,.030);
      box([x,.120,z+.119],[.105,.040,.079],armor,c,.035,.024);
      return {hip,knee,ankle,a,b,c};
    });
    S.bake();
    const world=B.finish({cam:{target:[0,.68,0],dist:4.48,yaw:.53,pitch:.52,ortho:true,sway:0},
      detail:30,dither:0,radius:10,look:{splatCoverage:'continuous'}});
    const stage=K.stage(world);
    R.bind(stage);
    const events=[], pivots=[];
    let p, v, yaw, goal, targetYaw, gait, t, active, previous, transition, feetYaw;
    const options={feet:home.map((h,i)=>({home:h,group:i})),reach:.235,time:.29,lift:.245,lead:.59,ground,
      motionMatching:matched&&{speeds:[0,.9,1.8,2.7]},
      planted(foot) {
        events.push({point:foot.p.slice(),foot:gait.feet.indexOf(foot),at:t});
        if(events.length>72) events.shift();
        if(transition && !transition.firstPlant && transition.feet[gait.feet.indexOf(foot)]) {
          const from=transition.feet[gait.feet.indexOf(foot)];
          const offset=V.sub(foot.p,from);
          transition.firstPlant={foot:gait.feet.indexOf(foot),point:foot.p.slice(),from,
            forward:offset[0]*transition.v[0]/speed+offset[2]*transition.v[1]/speed,at:t};
        }
      }
    };
    function reset() {
      p=[-1.95,0,-.65]; v=[0,0]; goal=[0,0]; yaw=targetYaw=Math.PI/2;
      gait=K.gait(options); feetYaw=[yaw,yaw]; t=0; active=0; previous=null; transition=null;
      events.length=0;
      pose(0);
    }
    function aim(vector,name='Steer') {
      if(goal[0]===vector[0]&&goal[1]===vector[1]) return;
      const nextAngle=Math.hypot(...vector)>.01?Math.atan2(vector[0],vector[1]):targetYaw;
      if(gait.feet.some(f=>f.u<1)&&Math.abs(angle(nextAngle,targetYaw))>.2) {
        transition={name,at:t,v:vector.slice(),feet:gait.feet.map(f=>f.u<1?f.p.slice():null),firstPlant:null};
      } else if(Math.abs(angle(nextAngle,targetYaw))>.2) transition=null;
      goal=vector.slice(); targetYaw=nextAngle;
    }
    const link=(id,from,to,a,b)=>{
      const rest=V.sub(to,from), current=V.sub(b,a);
      const turn=M.aim(norm(rest),norm(current)), stretch=V.len(current)/V.len(rest);
      const axis=norm(rest);
      const axial=M.id().map((n,i)=>n+(stretch-1)*axis[Math.floor(i/3)]*axis[i%3]);
      R.set(id,M.mul(turn,axial),from,a);
    };
    function pose(dt) {
      const base=[p[0],restBody[1]+.023*Math.sin(t*14)*Math.min(1,Math.hypot(...v)),p[2]];
      const facing=M.rot([0,1,0],yaw);
      const feet=gait.update(dt,{p:base,yaw,v,intent:{v:goal,yaw:targetYaw}});
      R.set(body,facing,restBody,base);
      for (const [i,{hip,knee,ankle,a,b,c}] of legs.entries()) {
        const foot=feet[i], joint=V.add(base,M.app(facing,V.sub(hip,restBody)));
        const end=V.add(foot.p,[0,ankle[1],0]);
        const reach=Math.max(1,V.dist(joint,end)/1.115);
        const pole=M.app(facing,[i? .18 : -.18,0,1]);
        const {mid}=K.ik2(joint,end,.55*reach,.57*reach,pole);
        link(a,hip,knee,joint,mid);
        link(b,knee,ankle,mid,end);
        if(foot.u<1) feetYaw[i]+=K.clamp(angle(targetYaw,feetYaw[i]),-dt*13,dt*13);
        R.set(c,M.rot([0,1,0],feetYaw[i]),ankle,end);
        pivots[i]={hip:joint,knee:mid,ankle:end};
      }
      R.apply();
      world.cam.target=[p[0],.70,p[2]];
    }
    function tick(dt,replay) {
      if(replay) {
        while(active+1<route.length&&t>=route[active+1].at-1e-9) active++;
        aim(route[active].v,route[active].name);
      }
      const k=1-Math.exp(-dt*12);
      for(let i=0;i<2;i++){
        v[i]+=(goal[i]-v[i])*k;
        p[i*2]=K.clamp(p[i*2]+v[i]*dt,-4.32,4.32);
      }
      const turn=angle(targetYaw,yaw);
      yaw+=K.clamp(turn,-dt*9,dt*9);
      t+=dt;
      pose(dt);
      if(gait.match&&gait.match!==previous) {
        previous=gait.match;
        if(transition && previous.reason==='steer' && !transition.firstPlant)
          transition.match={...previous,at:t};
      }
    }
    stage.add({update(dt){tick(dt,true);}});
    world.anim.stateful=true;
    world.courier={
      get t(){return t;}, get gait(){return gait;}, get pivots(){return pivots;}, get events(){return events;},
      get transition(){return transition;}, get goal(){return goal;}, get root(){return p;},
      get action(){return route[active].name;},
      aim,reset,
      advance(replay){tick(step,replay);}
    };
    reset();
    return world;
  }
  return {id:'switchback-courier',name:'Switchback Courier',seed:73,duration,route,command,build};
}
if(typeof module!=='undefined') module.exports=switchbackCourier;
