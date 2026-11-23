const test=require('node:test');
const assert=require('node:assert/strict');
const Ink=require('..');
const kit=Ink.load(), {KIT:K}=kit;
const feet=[{home:[-.22,0]},{home:[.22,0]}];
const close=(a,b,epsilon)=>assert(K.V.dist(a,b)<epsilon,JSON.stringify({a,b}));
const same=(a,b)=>a.every((n,i)=>n===b[i]);

test('entry poses are indexed by eligible limb, swing phase, heading, and velocity',()=>{
  const index=K.motionMatching.bake({feet,speeds:[0,1,2],headings:[0,90,180,-90],phaseSamples:8});
  assert.equal(index.size,2*3*3*4*8);
  const q={phase:.5,feet:[[-.22,0,0],[.22,.20,-.04]],eligible:[1],velocity:[0,1],goal:[1,0],heading:Math.PI/2};
  const left=index.search(q);
  assert.equal(left.foot,1);
  assert.equal(left.phase,.5);
  assert.equal(left.heading,Math.PI/2);
  const right=index.search({...q,goal:[-1,0],heading:-Math.PI/2});
  assert.equal(right.heading,-Math.PI/2);
  assert(left.landing[0]>right.landing[0]);
  assert(index.search({...q,velocity:[0,2],goal:[2,0]}).landing[0]>left.landing[0]);
  assert.equal(index.search({...q,eligible:[0],phase:0}).phase,0);
  assert.equal(index.search({...q,eligible:[0],phase:0}).foot,0);
  assert.throws(()=>index.search({...q,eligible:[]}),/invalid entry-pose query/);
  const immutable=index.search(q);
  left.landing[0]=300;
  assert.deepEqual(index.search(q),immutable);
});

test('a direction change starts at the actual swing pose and preserves velocity and planted contacts',()=>{
  const events=[];
  const gait=K.gait({feet,time:.30,reach:.23,lift:.24,ground:(x,z)=>x*.04-z*.02,motionMatching:true,
    planted:foot=>events.push({name:'plant',index:foot.index,point:foot.p.slice()}),
    lifted:foot=>events.push({name:'lift',index:foot.index})});
  const body={p:[0,0,0],yaw:0,v:[0,1.8],intent:{v:[0,1.8],yaw:0}};
  gait.update(0,body);
  for(let i=0;i<20;i++){
    body.p[2]+=.03;
    gait.update(1/60,body);
  }
  const swing=gait.feet.find(foot=>foot.u<1);
  assert(swing.u>.35&&swing.u<.76);
  const stance=gait.feet.find(foot=>foot!==swing);
  const anchored=stance.p.slice(), entry=swing.p.slice(), previousLanding=swing.to.slice(), phase=swing.u;
  body.intent={v:[1.8,0],yaw:Math.PI/2};
  gait.update(0,body);
  assert.deepEqual(swing.p,entry);
  assert.equal(swing.u,phase);
  assert.equal(gait.match.reason,'steer');
  assert.equal(gait.match.foot,swing.index);
  assert.deepEqual(gait.match.entry,entry);
  assert(K.V.dist(previousLanding,swing.to)>.28);
  assert(gait.match.velocity.some(n=>Math.abs(n)>.05));
  const elapsed=1e-6;
  gait.update(elapsed,body);
  close(K.V.mul(K.V.sub(swing.p,entry),1/elapsed),gait.match.velocity,1e-3);
  gait.update(.30*(1-phase)-elapsed+1e-9,body);
  assert.equal(swing.u,1);
  assert.deepEqual(stance.p,anchored);
  assert.deepEqual(swing.p,swing.to);
  assert.equal(swing.p[1],swing.p[0]*.04-swing.p[2]*.02);
  assert.deepEqual(events.map(e=>e.name),['lift','plant']);
});

test('Switchback Courier uses identical root motion and gets its next contact into both turns',()=>{
  const scene=require('../examples/motion-matching/scene.js')(kit);
  const worlds=[false,true].map(matched=>scene.build(scene.seed,{controls:{matched}}));
  const [base,matched]=worlds.map(world=>world.courier);
  const landings=worlds.map(()=>new Map());
  for (let i=0;i<264;i++){
    const old=matched.gait.feet.map(foot=>({u:foot.u,p:foot.p.slice()}));
    for (const [j,{courier}] of worlds.entries()){
      courier.advance(true);
      const result=courier.transition;
      if(result?.firstPlant&&!landings[j].has(result.name)) landings[j].set(result.name,result);
    }
    assert.deepEqual(base.root,matched.root);
    assert(matched.gait.feet.some(foot=>foot.u===1));
    matched.gait.feet.forEach((foot,j)=>{if(foot.u===1&&old[j].u===1) assert(same(foot.p,old[j].p));});
  }
  for(const kind of ['Left turn','Reverse']){
    const a=landings[0].get(kind),b=landings[1].get(kind);
    assert(b.match.phase>0&&b.match.phase<1);
    assert(b.firstPlant.forward>a.firstPlant.forward+.22);
  }
  const sample=()=>JSON.stringify({root:matched.root,feet:matched.gait.feet.map(f=>f.p)});
  const previous=sample();
  matched.reset();
  for(let i=0;i<264;i++) matched.advance(true);
  assert.equal(sample(),previous);
  const colors=Ink.render(worlds[1],{w:76,h:56,px:1,ortho:true,raw:true}).rgb;
  assert(new Set(colors).size>12);
});
