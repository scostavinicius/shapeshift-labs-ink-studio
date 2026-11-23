const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Ink = require('..');
const Atlas = require('../src/atlas-sprites.js');
const { compare,gaps } = require('../cli/impostor-error.js');
const { prepare,probeViews,selectViews } = require('../cli/impostor-view-plan.js');
const example='examples/adaptive-impostors/aperture-relay.js';

function sample({hole=false,light=false,wing=false}={}) {
  const w=22,h=20,alpha=new Uint8Array(w*h),rgb=new Uint8Array(w*h*3),protect=new Uint8Array(w*h);
  for(let y=4;y<16;y++) for(let x=5;x<17;x++) {
    if (hole && x>=9 && x<=12 && y>=7 && y<=11) continue;
    const p=y*w+x;
    alpha[p]=255;
    rgb.set([106,86,72],p*3);
  }
  if (wing) for(let y=9;y<12;y++) for(let x=17;x<21;x++) alpha[y*w+x]=255;
  if (light) for(let y=7;y<10;y++) for(let x=13;x<16;x++) {
    const p=y*w+x;
    protect[p]=1;
    rgb.set([250,207,98],p*3);
  }
  const frame={w,h,alpha,rgb,protect};
  return {...frame,gaps:gaps(frame)};
}

test('visible error distinguishes outline, gaps and protected color',()=>{
  const base=sample();
  const wing=compare(base,sample({wing:true}));
  assert(wing.silhouette>0 && wing.gaps===0 && wing.highlight===0);
  const hole=compare(base,sample({hole:true}));
  assert(hole.gaps>.9 && hole.silhouette===0 && hole.highlight===0);
  const highlight=compare(base,sample({light:true}));
  assert(highlight.highlight>.5 && highlight.silhouette===0 && highlight.gaps===0);
  assert.equal(compare(base,base).score,0);
});

test('stable angles stay sparse and high-error sectors earn more views across the orbit seam',()=>{
  const pitches=[0], options={directions:8,width:22,height:20,pitches,times:[0,1,2]};
  const settings=prepare({minDirections:4,probes:48,tolerance:.015,poseSamples:2},options);
  assert.deepEqual(settings.samples,[0,2]);
  const probes=probeViews(0,pitches,settings.count);
  const calm=sample(), active=sample({hole:true,light:true,wing:true});
  const run=captured=>selectViews({probes,pitches,settings,captured})[0];
  const smooth=run(probes.map(()=>[calm,calm]));
  assert.equal(smooth.yaws.length,4);
  assert.equal(smooth.final.max,0);
  const distinct=probes.map((_,i)=>[calm, (i>=2 && i<=6 || i>=44 && i<=45) ? active : calm]);
  const adaptive=run(distinct);
  assert(adaptive.final.mean<adaptive.initial.mean);
  assert(adaptive.yaws.length>4 && adaptive.yaws.length<=8);
  assert(adaptive.added.some(add=>add.yaw>0 && add.yaw<1 && add.gaps>0 && add.highlight>0));
  assert(adaptive.added.some(add=>add.yaw>5.5));
  assert.deepEqual(run(distinct),adaptive);
});

test('multi-elevation assessment follows actual closest-view selection across rings',()=>{
  const pitches=[.06,.21], settings=prepare({minDirections:2,probes:24,tolerance:0},
    {directions:5,width:22,height:20,pitches,times:[0]});
  const probes=probeViews(0,pitches,settings.count);
  const samples=[sample(),sample({hole:true}),sample({light:true,wing:true})];
  const captured=probes.map(({ring},i)=>[samples[(Math.floor(i/4)+ring)%3]]);
  const rings=selectViews({probes,pitches,captured,settings});
  const selected=probes.flatMap((probe,i)=>rings[probe.ring].yaws.includes(probe.yaw)?[i]:[]);
  const axis=probes.map(p=>Atlas.basis(p.yaw,p.pitch).normal);
  let cross=0;
  const errors=axis.map((ref,i)=>{
    const best=selected.reduce((a,b)=>Atlas.dot(ref,axis[b])>Atlas.dot(ref,axis[a])?b:a);
    if(probes[i].ring!==probes[best].ring) cross++;
    return compare(captured[i][0],captured[best][0]).score;
  });
  assert(cross>0);
  for(const [i,ring] of rings.entries()) {
    const lane=errors.slice(i*settings.count,(i+1)*settings.count);
    assert(Math.abs(ring.final.mean-lane.reduce((sum,n)=>sum+n/settings.count,0))<1e-12);
    assert.equal(ring.final.max,Math.max(...lane));
  }
});

test('animated atlas exports keep nonuniform angles registered across frames and reject stateful poses',()=>{
  const kit=Ink.load(), world=require('../'+example)(kit).build(62);
  const options={width:36,height:34,directions:5,pitches:[.05,.44],times:[0,.25,.50],maps:['depth','normal','emission','silhouette'],
    view:{raw:true},adaptive:{minDirections:3,probes:18,tolerance:0,poseSamples:2}};
  const baked=Ink.spriteAtlas(world,options);
  assert.deepEqual(baked.metadata.adaptiveViews.poseTimes,[0,.5]);
  const row=baked.metadata.frames.filter(f=>f.frame===0).map(({yaw,pitch})=>[yaw,pitch]);
  assert(row.length>=6 && row.length<=10);
  for(let frame=1;frame<3;frame++)
    assert.deepEqual(baked.metadata.frames.filter(f=>f.frame===frame).map(({yaw,pitch})=>[yaw,pitch]),row);
  const playback=Atlas.compile(baked);
  for(const [yaw,pitch] of row) {
    const tile=playback.select(2,'impostor',Atlas.basis(yaw,pitch).normal);
    assert.equal(tile.yaw,yaw);
    assert.equal(tile.pitch,pitch);
  }
  assert(playback.hasDepth);
  assert.throws(()=>Ink.spriteAtlas({...world,anim:{stateful:true}},options),/seekable scene/);
});

test('atlas CLI writes a loadable adaptive atlas and equal-budget held-out review',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-adaptive-impostor-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const exec=(...args)=>execFileSync(process.execPath,['cli/ink-studio.js','atlas',example,...args],{
    cwd:path.resolve(__dirname,'..'),stdio:'pipe'});
  exec('--out',dir,'--w','66','--h','60','--raw','--adaptive-views','--min-directions','4',
    '--directions','7','--view-probes','32','--view-error','0','--view-review','--maps','depth,normal,emission',
    '--view-protect','[{"material":"protected-glint"}]');
  const report=JSON.parse(fs.readFileSync(path.join(dir,'review','review.json')));
  assert.equal(report.format,'ink-studio/impostor-view-review');
  assert.equal(report.heldOut.count,32);
  assert.equal(report.angles.adaptive.length,report.angles.uniform.length);
  const atlas=Ink.readSpriteAtlas(dir), baseline=Ink.readSpriteAtlas(path.join(dir,'review','uniform-atlas'));
  assert(atlas.hasDepth && baseline.hasDepth);
  assert.deepEqual(atlas.snapshot().metadata.frames.map(frame=>frame.yaw),report.angles.adaptive);
  const lattice=report.assessment.probes;
  assert(report.frames.every(f=>Math.abs(((f.yaw-report.baseYaw)*lattice/(2*Math.PI))%1-.5)<1e-9));
  assert(report.assessment.rings[0].added.some(a=>a.highlight>0));
  assert(report.heldOut.uniform.highlight>0 && report.heldOut.adaptive.score>0);
  const html=fs.readFileSync(path.join(dir,'review','index.html'),'utf8');
  assert.match(html,/data:image\/png;base64,/);
  assert.doesNotMatch(html,/\/\*IMPOSTOR_VIEW_DATA\*\//);
  assert.throws(()=>exec('--out',dir,'--view-error','0'),/need --adaptive-views/);
});
