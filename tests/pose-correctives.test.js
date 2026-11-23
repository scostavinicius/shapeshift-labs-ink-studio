const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const { execFileSync }=require('node:child_process');
const Ink=require('..');
const kit=Ink.load(), {KIT:K,makeBuilder}=kit, {M,V}=K;
const example='examples/pose-correctives/switchyard-signaler.js';
const close=(a,b,eps=1e-5)=>Array.from(a).forEach((n,i)=>assert(Math.abs(n-b[i])<=eps,n+' vs '+b[i]));

function fixture() {
  const B=makeBuilder(31,[0x192939,0xd77a54,0xa2bf97]);
  B.disc(-.42,.32,0,[0,0,1],.18,.039,B.P[2],3);
  for (const y of [.22,.47,.66]) B.disc(.45,y,.12,[.1,.2,1],.24,.04,B.P[1],3);
  B.describeSplats(1,4,{object:'sleeve'});
  const world=B.finish({cam:{target:[0,.55,0],dist:3.6,yaw:0,pitch:0,ortho:true}});
  const actor=K.puppet(world,{parts:{
    root:{ids:[0],pivot:[0,0,0]},
    arm:{ids:[1,2,3],pivot:[.23,.72,0],parent:'root',slices:2,from:0,to:1}
  }});
  function pose(a,root=0,shift=[0,0,0]) {
    actor.pose.root={rot:[0,0,root],pos:shift};
    actor.pose.arm={rot:[0,0,a]};
    actor.flush();
    return K.bones.posed(world).slice();
  }
  const baseline=pose(85), i=2,q=i*16, point=Array.from(baseline.slice(q,q+3));
  assert(world.data[q+14]>0,'fixture needs a row with two bone influences');
  const center=[point[0]-.12,point[1],point[2]], radius=.5, move=[.16,.068,.024];
  const asset=actor.correctives.capture({id:'raised sleeve',drivers:[{part:'arm',radius:40}],
    select:{object:'sleeve'},strokes:[{at:center,radius,move}]});
  return {world,actor,asset,pose,baseline,q,point,center,radius,move};
}
function covariance(data,q) {
  const x=data[q+4],xy=data[q+5],xz=data[q+6],y=data[q+8],yz=data[q+9],z=data[q+10];
  return [x,xy,xz,xy,y,yz,xz,yz,z];
}

test('the target sculpt moves a blended row exactly and carries its covariance',()=>{
  const f=fixture(), {world,actor,asset,pose,baseline,q,point,center,radius,move}=f;
  const d=V.sub(point,center), inside=1-V.dot(d,d)/radius**2, slope=-4*inside/radius**2;
  const expected=V.mul(move,inside**2), gradient=[1,0,0,0,1,0,0,0,1].map((n,i)=>
    n+move[Math.floor(i/3)]*d[i%3]*slope);
  actor.correctives.set([JSON.parse(JSON.stringify(asset))]);
  const corrected=pose(85);
  close(corrected.slice(q,q+3),V.add(point,expected));
  close(covariance(corrected,q),M.mul(M.mul(gradient,covariance(baseline,q)),M.tr(gradient)));
  assert.equal(actor.correctives.state()[0].weight,1);
  assert(world.anim.bones.length>actor.bones.length);
  close(corrected.slice(0,11),baseline.slice(0,11));

  const bad=structuredClone(asset); bad.rows[0].rest[0]+=1;
  assert.throws(()=>actor.correctives.set([bad]),/different bake or skin binding/);
  assert.deepEqual(pose(85),corrected);
  const oldIndex=asset.rows.map(row=>world.data[row.index*16+12]);
  actor.correctives.set([]);
  assert.notDeepEqual(asset.rows.map(row=>world.data[row.index*16+12]),oldIndex);
  assert.deepEqual(pose(85),baseline);
});

test('joint falloff is pose-relative, continuous and independent of the parent motion',()=>{
  const {actor,asset,pose,q}=fixture(), source=pose(85);
  actor.correctives.set([asset]);
  const peak=pose(85), delta=V.sub(peak.slice(q,q+3),source.slice(q,q+3));
  pose(65);
  close([actor.correctives.state()[0].weight],[.5]);
  pose(45);
  close([actor.correctives.state()[0].weight],[0]);
  const neutral=pose(0).slice(q,q+3);
  assert.equal(actor.correctives.state()[0].weight,0);

  const root=83, shift=[4,-1,.6], after=pose(85,root,shift);
  close([actor.correctives.state()[0].weight],[1]);
  actor.correctives.set([]);
  const before=pose(85,root,shift);
  close(V.sub(after.slice(q,q+3),before.slice(q,q+3)),M.app(M.rot([0,0,1],root*Math.PI/180),delta));
  assert.deepEqual(pose(0).slice(q,q+3),neutral);
  actor.correctives.set([asset]);
  assert.deepEqual(pose(85),peak);
});

test('the correction uses shortest rotation across the angle seam and can use more than one driver',()=>{
  const {actor,pose,q}=fixture(), point=Array.from(pose(179,0).slice(q,q+3));
  const layer=actor.correctives.capture({id:'turned',drivers:[{part:'root',radius:22},{part:'arm',radius:25}],
    select:{object:'sleeve'},strokes:[{at:point,radius:.31,move:[.09,0,0]}]});
  actor.correctives.set([layer]);
  pose(-179,0);
  assert(actor.correctives.state()[0].weight>.97);
  pose(-179,25);
  assert.equal(actor.correctives.state()[0].weight,0);
});

test('headless renders and unassisted Node spriteAtlas use the corrected rig',()=>{
  const scene=require('../'+example)(kit), world=scene.build(57), editor=K.poseCorrectives.forWorld(world);
  const config={ w:70,h:64,px:1,t:1.1,raw:true,ortho:true,transparent:true };
  world.anim.update(0,1.1);
  const rest=world.data, expected=Ink.render(world,config);
  assert.equal(editor.state()[0].weight,1);
  const atlas=Ink.spriteAtlas(world,{width:70,height:64,directions:1,times:[1.1],
    view:{raw:true},maps:['normal','depth','silhouette']});
  assert.equal(world.data,rest);
  for(let i=0;i<expected.alpha.length;i++){
    assert.equal(atlas.images.color[i*4+3],expected.alpha[i]);
    if(expected.alpha[i]) assert.deepEqual([...atlas.images.color.slice(i*4,i*4+3)],[...expected.rgb.slice(i*3,i*3+3)]);
  }
  assert(atlas.images.normal.some(Boolean));
});

test('capture JSON can be reapplied through CLI rendering and sprite review exports the registered result',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-pose-correctives-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const run=(...args)=>execFileSync(process.execPath,['cli/ink-studio.js',...args],{cwd:path.resolve(__dirname,'..'),stdio:'pipe'});
  const out=path.join(dir,'review');
  run('pose-correctives','review',example,'--out',out,'--w','72','--h','62','--fps','5','--from','0','--to','2.4','--raw');
  const report=JSON.parse(fs.readFileSync(path.join(out,'review.json')));
  const [asset]=JSON.parse(fs.readFileSync(path.join(out,'correctives.json')));
  assert.equal(report.samples.length,12);
  assert.equal(report.samples[0].changed,0);
  assert(report.samples.some(row=>row.weights[0].weight>.999 && row.changed>20));
  assert(report.samples.every(row=>row.spriteDifference===0));
  const plan=path.join(dir,'sculpt.json'), exported=path.join(dir,'captured.json');
  fs.writeFileSync(plan,JSON.stringify({id:asset.id,drivers:asset.joints.map(({part,radius})=>({part,radius})),...asset.sculpt}));
  run('pose-correctives','capture',example,'--pose-correctives','off','--plan',plan,'--t','1.1','--out',exported);
  assert.deepEqual(JSON.parse(fs.readFileSync(exported)),asset);
  const a=path.join(dir,'a.png'), b=path.join(dir,'b.png');
  const view=['--t','1.1','--w','72','--h','62','--px','1','--raw'];
  run('render',example,'--out',a,...view);
  run('render',example,'--pose-correctives',exported,'--out',b,...view);
  assert.deepEqual(fs.readFileSync(a),fs.readFileSync(b));
  assert(Ink.readSpriteAtlas(path.join(out,'sprite-atlas')).hasDepth);
});

test('WebGL renders the actual corrective and restores the neutral silhouette',
  {skip:!process.env.INK_TEST_CHROME},()=>{
  const view=require('../cli/look-webgl');
  const output=view({chrome:process.env.INK_TEST_CHROME,hardware:true},require('../'+example),
    (kit,make,backend)=>{
      const scene=make(kit), baseline=scene.build(57,{controls:{correctives:false}}), live=scene.build(57);
      const renderer=backend(140,112,{raw:true,ortho:true,damp:false});
      function frame(world,t) {
        world.anim.update(0,t);
        renderer.draw(world,{time:t});
        return atob(renderer.image());
      }
      const marks=[];
      for(const t of [0,.7,1.1,1.8,2.3]){
        const a=frame(baseline,t), b=frame(live,t);
        let count=0;
        for(let p=0;p<a.length;p+=3)if(a.slice(p,p+3)!==b.slice(p,p+3))count++;
        marks.push({t,count,weight:kit.KIT.poseCorrectives.forWorld(live).state()[0].weight});
      }
      renderer.close();
      return {marks};
    });
  assert(output.marks[2].count>50);
  assert.equal(output.marks[0].count,0);
  assert.equal(output.marks.at(-1).count,0);
  assert.equal(output.marks[2].weight,1);
});
