const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const Ink=require('..'), kit=Ink.load();
const {KIT:K}=kit;
const example='examples/view-poses/breakwater-warden.js';
const build=()=>require('../'+example)(kit).build();
const rad=Math.PI/180;
const camera=degrees=>({back:[Math.sin(degrees*rad),0,Math.cos(degrees*rad)],ortho:true});
const same=(a,b)=>a.length===b.length&&a.every((n,i)=>n===b[i]);
function intact(report) {
  const contacts=Object.values(report.contacts);
  assert.equal(contacts.length,4);
  for(const c of contacts) {
    assert(c.error<1e-6,JSON.stringify(c));
    if(c.kind==='lock') assert.deepEqual(c.actual,c.from);
  }
}

test('view sampling swings elbows, rigidly carries grips, and restores the live puppet',()=>{
  const world=build(), {puppet}=world.warden, editor=puppet.viewPoses;
  const bones=world.anim.bones, clean=bones.slice(), pose=puppet.pose;
  const elbow=puppet.point('lower-L',puppet.parts['lower-L'].pivot);
  const sample=editor.sample(camera(-42));
  assert(sample.report.applied);
  assert.equal(sample.report.weights[0].weight,1);
  assert.notEqual(sample.bones,bones);
  assert(K.V.dist(elbow,sample.report.elbows['left grip'].to)>.25);
  assert(K.V.dist(sample.report.props.staff.from,sample.report.props.staff.to)>.08);
  intact(sample.report);
  const grip=Object.values(sample.report.contacts).filter(c=>c.kind==='grip');
  assert(Math.abs(K.V.dist(grip[0].from,grip[1].from)-K.V.dist(grip[0].actual,grip[1].actual))<1e-8);
  for(const side of ['L','R']) {
    const upper=puppet.parts['upper-'+side], lower=puppet.parts['lower-'+side], wrist=puppet.parts['hand-'+side];
    const point=(p,table)=>{const i=p.first*12;return K.V.add(K.M.app(table.subarray(i,i+9),p.pivot),table.subarray(i+9,i+12));};
    for(const [a,b] of [[upper,lower],[lower,wrist]]) {
      const rest=K.V.dist(point(a,bones),point(b,bones));
      assert(Math.abs(K.V.dist(point(a,sample.bones),point(b,sample.bones))-rest)<1e-6);
    }
  }
  assert.equal(editor.sample(camera(160)).bones,null);
  assert.equal(puppet.pose,pose);
  assert.equal(world.anim.bones,bones);
  assert(same(bones,clean));
  assert.deepEqual(puppet.point('lower-L',puppet.parts['lower-L'].pivot),elbow);
  assert.equal(K.viewPoses.forWorld(world),editor);
});

test('overlapping sectors blend through the rear seam in the puppet anchor frame',()=>{
  const world=build(), {puppet}=world.warden, e=puppet.viewPoses, asset=e.asset();
  asset.sectors[0].yaw=177;
  asset.sectors[1].yaw=-159;
  e.set(asset);
  const a=e.sample(camera(179.99)), b=e.sample(camera(-179.99));
  assert(a.report.weights.every(row=>row.weight>0));
  assert(a.report.weights.reduce((sum,row)=>sum+row.weight,0)<=1+1e-12);
  assert(K.V.dist(a.report.elbows['left grip'].to,b.report.elbows['left grip'].to)<.001);
  intact(a.report);
  intact(b.report);
  assert.equal(e.sample({back:[0,1,0],ortho:true}).bones,null);
  const view=a.report.yaw;
  puppet.pose.chest={rot:[0,30,0]};
  puppet.flush();
  const local=e.sample(camera(view+30)).report;
  assert(Math.abs(local.weights[0].weight-a.report.weights[0].weight)<1e-12);
  const at=puppet.point('chest',puppet.parts.chest.pivot);
  const perspective=e.sample({back:[0,0,1],eye:K.V.mad(at,camera(view+30).back,7),ortho:false}).report;
  assert(Math.abs(perspective.weights[0].weight-local.weights[0].weight)<1e-12);
});

test('reach bounds preserve both grips during large edits and malformed locks cannot replace the asset',()=>{
  const world=build(), e=world.warden.puppet.viewPoses, asset=e.asset();
  asset.sectors[0].props.staff.move=[.7,.9,.6];
  e.set(asset);
  const a=e.sample(camera(-42)), b=e.sample(camera(-42.01));
  assert(a.report.applied);
  assert.equal(a.report.limited,'prop reach');
  assert(a.report.gain<.3);
  assert(K.V.dist(a.report.props.staff.to,b.report.props.staff.to)<.001);
  intact(a.report);
  intact(b.report);
  asset.locks.bad={part:'hand-L',point:[0,0,0]};
  assert.throws(()=>e.set(asset),/must be independent/);
  assert(a.report.gain===e.sample(camera(-42)).report.gain);
});

test('Node and native sprite baking use the same camera-dependent bone pose',()=>{
  const world=build(), options={w:112,h:104,px:1,yaw:-42*rad,pitch:.16,ortho:true,raw:true,transparent:true};
  const src=Ink.render(world,{...options,viewPoses:false}), rendered=Ink.render(world,options);
  assert(rendered.rgb.filter((n,i)=>n!==src.rgb[i]).length>150);
  const outside={...options,yaw:145*rad};
  assert.deepEqual(Ink.render(world,outside).rgb,Ink.render(world,{...outside,viewPoses:false}).rgb);
  const atlas=Ink.spriteAtlas(world,{width:options.w,height:options.h,directions:4,times:[0],yaw:options.yaw,
    pitches:[options.pitch],maps:['depth','normal','silhouette'],view:{raw:true}});
  assert(atlas.images.depth.some(Boolean));
  assert(atlas.images.normal.some(Boolean));
  for(const {yaw,pitch,rect} of atlas.metadata.frames){
    const image=Ink.render(world,{...options,yaw,pitch});
    for(let y=0;y<options.h;y++)for(let x=0;x<options.w;x++){
      const pixel=y*options.w+x, offset=4*((rect.y+y)*atlas.metadata.width+rect.x+x);
      assert.equal(atlas.images.color[offset+3],image.alpha[pixel]);
      if(image.alpha[pixel]) assert(same(atlas.images.color.subarray(offset,offset+3),image.rgb.subarray(pixel*3,pixel*3+3)));
    }
  }
});

test('pose-space sculpts remain active without changing their live state when the camera moves',()=>{
  const world=build(), {puppet}=world.warden, editor=puppet.viewPoses;
  const sample=editor.sample(camera(-42)), elbow=sample.report.elbows['left grip'].from;
  const sculpt=puppet.correctives.capture({id:'cuff',drivers:[{part:'upper-L',radius:30}],
    select:{object:'upper-L'},strokes:[{at:elbow,radius:.24,move:[-.03,.022,.035]}]});
  puppet.correctives.set([sculpt]);
  const base=world.anim.bones, snapshot=base.slice();
  const directed=editor.sample(camera(-42));
  assert.equal(puppet.correctives.state()[0].weight,1);
  assert.equal(directed.bones.length,base.length);
  assert(directed.bones.length>sample.bones.length);
  assert(same(world.anim.bones,snapshot));
  assert.equal(world.anim.bones,base);
  assert(puppet.parts['upper-L'].rotation.every((n,i)=>n===K.M.id()[i]));
  intact(directed.report);
});

test('the CLI can reapply an editable asset with exact native output',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-view-poses-'));
  t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
  const asset=path.join(dir,'asset.json'), a=path.join(dir,'a.png'), b=path.join(dir,'b.png');
  fs.writeFileSync(asset,JSON.stringify(build().warden.asset));
  function draw(out,...args) {
    execFileSync(process.execPath,['cli/ink-studio.js','render',example,'--out',out,
      '--w','96','--h','88','--px','1','--raw',...args],{cwd:path.resolve(__dirname,'..'),stdio:'pipe'});
  }
  draw(a);
  draw(b,'--params','{"corrections":false}','--view-poses',asset);
  assert(fs.readFileSync(a).equals(fs.readFileSync(b)));
  draw(b,'--view-poses','off');
  assert(!fs.readFileSync(a).equals(fs.readFileSync(b)));
});

test('WebGL resolves the sector on the final camera and can bypass it on the same live rig',
  {skip:!process.env.INK_TEST_CHROME},()=>{
    const view=require('../cli/look-webgl.js');
    const result=view({chrome:process.env.INK_TEST_CHROME,hardware:true},require('../'+example),(kit,make,backend)=>{
      const scene=make(kit), world=scene.build(scene.seed), renderer=backend(150,130,{raw:true,ortho:true,damp:false});
      const bones=world.anim.bones, unchanged=bones.slice();
      function draw(deg,active){
        renderer.draw(world,{yaw:deg*Math.PI/180,pitch:.16,viewPoses:active});
        return atob(renderer.image());
      }
      function diff(a,b){
        let n=0;
        for(let i=0;i<a.length;i+=3) if(a.slice(i,i+3)!==b.slice(i,i+3)) n++;
        return n;
      }
      const port=diff(draw(-42,true),draw(-42,false)), starboard=diff(draw(54,true),draw(54,false));
      const rear=diff(draw(153,true),draw(153,false));
      renderer.close();
      return {port,starboard,rear,restored:world.anim.bones===bones&&bones.every((n,i)=>n===unchanged[i])};
    });
    assert(result.port>45&&result.starboard>45);
    assert.equal(result.rear,0);
    assert(result.restored);
  });
