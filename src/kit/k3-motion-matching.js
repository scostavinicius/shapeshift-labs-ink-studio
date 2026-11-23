/* Motion matching for procedural foot rigs. Poses are indexed in the body's XZ frame. */
(function (K) {
  const {V}=K, tau=2*Math.PI;
  const signed=angle=>Math.atan2(Math.sin(angle),Math.cos(angle));
  const vector=(value,n)=>Array.isArray(value)&&value.length===n&&Array.from(value).every(Number.isFinite);
  const positive=(n,limit)=>Number.isFinite(n)&&n>0&&n<=limit;
  const xz=([x,,z])=>[x,z];
  const direction=(yaw,speed)=>[Math.sin(yaw)*speed,Math.cos(yaw)*speed];
  function check(ok,message) {
    if(!ok) throw new RangeError('Motion matching: '+message);
  }
  function rotate([x,z],yaw) {
    const c=Math.cos(yaw), s=Math.sin(yaw);
    return [c*x+s*z,c*z-s*x];
  }
  const unit=point=>Math.hypot(...point);
  const norm2=([x,z])=>x*x+z*z;
  const add=(a,b)=>[a[0]+b[0],a[1]+b[1]];
  const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
  const scale=(a,n)=>[a[0]*n,a[1]*n];
  const power=(v,weight)=>v*v*weight;
  const sum=(a,b)=>a+b;
  const wrap=angle=>((angle%tau)+tau)%tau;

  // Build entry poses for a single-support gait. Each indexed row carries a
  // stance, angular change, entry and intended velocities, and a landing.
  function bake({feet,time=.24,reach=.34,lift=.26,lead=.58,speeds=[0,.9,1.8,2.7],
    headings=[0,30,60,90,120,150,180,-150,-120,-90,-60,-30],phaseSamples=9}={}) {
    check(Array.isArray(feet)&&feet.length>=2&&feet.length<=8&&Array.from(feet).every(foot=>vector(foot?.home,2)),
      'provide 2–8 feet with finite XZ homes');
    check(positive(time,2)&&positive(reach,10)&&positive(lift,5)&&Number.isFinite(lead)&&lead>=0&&lead<=2,
      'invalid step duration, reach, lift, or lead');
    check(Array.isArray(speeds)&&speeds.length>=2&&speeds.length<=8&&speeds[0]===0&&
      Array.from(speeds).every((speed,i)=>Number.isFinite(speed)&&speed>=0&&speed<=20&&(!i||speed>speeds[i-1])),
      'provide 2–8 increasing speed bands starting at zero');
    check(Array.isArray(headings)&&headings.length>=3&&headings.length<=24&&headings.includes(0)&&
      Array.from(headings).every(angle=>Number.isFinite(angle)&&Math.abs(angle)<=180)&&
      new Set(headings.map(angle=>wrap(angle*Math.PI/180).toFixed(10))).size===headings.length&&
      Number.isInteger(phaseSamples)&&phaseSamples>=3&&phaseSamples<=16,'invalid heading or phase samples');
    const directions=headings.map(angle=>angle*Math.PI/180), homes=feet.map(foot=>foot.home.slice());
    const starts=homes.map(()=>[]), swings=homes.map(()=>[]);
    const speedScale=1/speeds.at(-1), spaceScale=1/reach;
    const poseScale=.75*spaceScale**2/homes.length;
    for (const [foot,home] of homes.entries()) {
      for (const speed of speeds) for (const goalSpeed of speeds) for (const heading of directions) {
        const goal=direction(heading,goalSpeed);
        for (let sample=0;sample<phaseSamples;sample++) {
          const phase=sample/phaseSamples, left=1-phase;
          const velocity=direction(heading*phase*.35,speed);
          const room=speed*time*.48, ease=K.ease.smooth(phase);
          const expected=homes.map((stance,i)=>{
            if(i!==foot) return [stance[0],0,stance[1]+room*(.65-1.5*phase)];
            const path=direction(heading*phase*.55,(room+goalSpeed*time*.53)*ease);
            return [home[0]+path[0],lift*(4*phase*left)**2,home[1]-room+path[1]];
          });
          const carry=add(scale(velocity,.30),scale(goal,.70));
          const landing=add(rotate(home,heading*.84),add(scale(carry,time*left),scale(goal,time*lead)));
          const row={foot,phase,heading,velocity,goal,expected,landing};
          (sample===0?starts:swings)[foot].push(row);
          if(sample===0) swings[foot].push(row);
        }
      }
    }
    function search({phase=0,feet:points,eligible,velocity,goal,heading}) {
      check(Number.isFinite(phase)&&phase>=0&&phase<1&&Array.isArray(points)&&points.length===homes.length&&
        Array.from(points).every(point=>vector(point,3))&&vector(velocity,2)&&vector(goal,2)&&Number.isFinite(heading)&&
        Array.isArray(eligible)&&eligible.length>0&&Array.from(eligible).every(i=>Number.isInteger(i)&&i>=0&&i<homes.length),
        'invalid entry-pose query');
      let best, score=Infinity;
      for (const i of eligible) for (const row of (phase===0?starts:swings)[i]) {
        let error=power(row.phase-phase,15)
          +norm2(sub(row.velocity,velocity))*speedScale**2
          +norm2(sub(row.goal,goal))*12*speedScale**2
          +(1-Math.cos(row.heading-heading))*3.5;
        if(best&&error>=score) continue;
        for (let leg=0;leg<homes.length;leg++) {
          const delta=V.sub(row.expected[leg],points[leg]);
          error+=V.dot(delta,delta)*poseScale*(i===leg ? 1 : .65);
        }
        if(!best||error<score) { best=row; score=error; }
      }
      const {foot,phase:entryPhase,heading:turn,landing}=best;
      return {foot,phase:entryPhase,heading:turn,landing:landing.slice(),score};
    }
    const size=swings.map(rows=>rows.length).reduce(sum,0);
    return Object.freeze({size,search});
  }

  function bind({feet,time=.24,reach=.34,lift=.26,lead=.58,ground=()=>0,lifted,planted,motionMatching}={}) {
    const settings=motionMatching===true?{}:motionMatching;
    check(settings&&Object.getPrototypeOf(settings)===Object.prototype&&typeof ground==='function','invalid gait settings');
    const {speeds,headings,phaseSamples,intentAngle=24,intentSpeed=.45}=settings;
    check(positive(intentAngle,180)&&positive(intentSpeed,20),'invalid steering thresholds');
    const index=bake({feet,time,reach,lift,lead,speeds,headings,phaseSamples});
    const legs=feet.map(({home,group},i)=>({home:home.slice(),group:group||0,index:i,p:null,from:null,to:null,u:1,lift:0}));
    const gait={feet:legs,steps:0,height:0,match:null,index};
    let swing,intent,previousFoot=-1;
    function point([x,z]) {
      const y=ground(x,z);
      check(Number.isFinite(y),'ground must return a finite height');
      return [x,y,z];
    }
    function start(body,goal,heading,eligible,phase,reason) {
      const origin=xz(body.p);
      const offsets=legs.map(foot=>{
        const [x,z]=rotate(sub(xz(foot.p),origin),-body.yaw);
        return [x,foot.p[1]-ground(foot.p[0],foot.p[2]),z];
      });
      const found=index.search({phase,feet:offsets,eligible,velocity:rotate(body.v??[0,0],-body.yaw),
        goal:rotate(goal,-body.yaw),heading:signed(heading-body.yaw)});
      // Correct the small time difference between the nearest indexed phase
      // and this rig's continuous phase, without changing its swing clock.
      const adjust=scale(rotate(goal,-body.yaw),time*(found.phase-phase)*.70);
      const landing=point(add(origin,rotate(add(found.landing,adjust),body.yaw)));
      const foot=legs[found.foot], duration=time*(1-phase), velocity=swing?.velocity??[0,0,0];
      swing={foot,phase,duration,elapsed:0,velocity,tangent:V.mul(velocity,duration),
        lift:lift*(1-phase)**2};
      foot.from=foot.p.slice();
      foot.to=landing;
      foot.u=phase;
      gait.match={...found,reason,inputHeading:heading,entry:foot.from.slice(),landing:landing.slice(),velocity:velocity.slice()};
      if(reason==='step') {
        previousFoot=foot.index;
        gait.steps++;
        if(lifted) lifted(foot);
      }
    }
    function advance(dt) {
      const step=swing, {foot,duration,phase,tangent}=step;
      step.elapsed=Math.min(duration,step.elapsed+dt);
      if(step.elapsed===duration) {
        foot.p=foot.to.slice();
        foot.u=1;
        foot.lift=0;
        swing=undefined;
        if(planted) planted(foot);
        return;
      }
      const t=step.elapsed/duration, t2=t*t, shape=4*t*(1-t);
      foot.u=phase+(1-phase)*t;
      // A Hermite arc preserves position and velocity when a swing is
      // retargeted. Its value and velocity both reach the new contact cleanly.
      const p=V.add(V.lerp(foot.from,foot.to,t2*(3-2*t)),V.mul(tangent,t*(1-t)**2));
      const velocity=V.add(V.mul(V.sub(foot.to,foot.from),6*t*(1-t)/duration),
        V.mul(tangent,(1-4*t+3*t2)/duration));
      p[1]+=step.lift*shape*shape;
      velocity[1]+=step.lift*8*shape*(1-2*t)/duration;
      const floor=point(xz(p))[1];
      if(p[1]<floor&&velocity[1]<0) velocity[1]=0;
      foot.p=p;
      foot.p[1]=Math.max(floor,foot.p[1]);
      foot.lift=(foot.p[1]-floor)/lift;
      step.velocity=velocity;
    }
    gait.update=(dt,body)=>{
      check(Number.isFinite(dt)&&dt>=0&&dt<=1&&vector(body?.p,3)&&Number.isFinite(body.yaw)&&
        (body.v===undefined||vector(body.v,2)),'invalid body pose, velocity, or elapsed time');
      const goal=body.intent?.v??body.v??[0,0];
      check(vector(goal,2),'invalid steering velocity');
      const speed=unit(goal);
      const heading=body.intent?.yaw??(speed>.03?Math.atan2(goal[0],goal[1]):body.yaw);
      check(Number.isFinite(heading),'invalid steering heading');
      const origin=xz(body.p);
      const targets=legs.map(foot=>point(add(origin,rotate(foot.home,body.yaw))));
      legs.forEach((foot,i)=>{foot.p??=targets[i].slice();});
      const changed=!!intent&&(Math.abs(signed(heading-intent.heading))>=intentAngle*Math.PI/180||
        unit(sub(goal,intent.goal))>=intentSpeed);
      if(!intent||changed) intent={heading,goal:goal.slice()};
      if(swing) {
        if(changed&&swing.foot.u<.76) start(body,goal,heading,[swing.foot.index],swing.foot.u,'steer');
      } else {
        const offsets=legs.map((foot,i)=>unit(sub(xz(foot.p),xz(targets[i]))));
        const furthest=Math.max(...offsets);
        if(furthest>reach || changed&&furthest>reach*.32) {
          const eligible=legs.filter(foot=>offsets[foot.index]>=Math.max(reach*.18,furthest-reach*.36)).map(foot=>foot.index);
          if(eligible.length>1&&eligible.includes(previousFoot)) eligible.splice(eligible.indexOf(previousFoot),1);
          start(body,goal,heading,eligible,0,'step');
        }
      }
      if(swing&&dt) advance(dt);
      gait.height=legs.map(foot=>foot.p[1]-lift*foot.lift).reduce(sum,0)/legs.length;
      return legs;
    };
    return gait;
  }

  K.motionMatching=Object.freeze({bake,bind});
})(KIT);
