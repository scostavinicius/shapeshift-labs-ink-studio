const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const ink = require('..'), kit = ink.load(), C = kit.KIT.curveSplats;
const { measureFrame } = require('../cli/curve-quality-review.js');

const view = { w:91,h:65,px:1,ortho:true,raw:true,renderStats:true,passes:['strandId'] };

function layerFixture() {
  const B = kit.makeBuilder(1,[0x152232,0xf5c47a]);
  for (const [id,y,material] of [['rail',.7,'hero'],['first',.15,'string'],['second',-.15,'string'],['coil',-.6,'winding']]) {
    const points = [[-1.8,y,0],[0,y,0],[1.8,y,0]];
    C.draw(B,{ kind:'path',id,points },{ material,edge:'hard',width:.14 });
  }
  return B.finish({ cam:{ target:[0,0,0],dist:6,yaw:0,pitch:0 },
    radius:5,fog:{ c:0,start:1,max:0 },dither:0 });
}

test('budgets cap segments and fragment slots independently without splitting an admitted strand', () => {
  const world = layerFixture();
  const layers = (segments, fragments) => ({ layers:[
    { id:'silk', select:{ material:'string' }, segments },
    { id:'wire', select:{ material:'winding' }, fragments }
  ] });
  const uncapped = ink.render(world,view);
  const broad = ink.render(world,{ ...view,curveQuality:layers(4,2e6) });
  assert.deepEqual(broad.rgb,uncapped.rgb);
  const [silk,wire] = broad.renderStats.curveQuality[0].layers;
  assert.equal(silk.segments,4);
  assert.equal(wire.segments,2);
  const limited = ink.render(world,{ ...view,curveQuality:layers(3,wire.fragmentSlots-1) });
  const reports = limited.renderStats.curveQuality[0].layers;
  assert.deepEqual(reports.map(row=>row.segments),[2,0]);
  assert.deepEqual(reports.map(row=>row.omittedNames),[['second'],['coil']]);
  assert.ok(reports[0].fragmentSlots >= reports[0].fragments && reports[0].fragments>0);
  assert.ok(reports[1].fragmentSlots <= reports[1].fragmentLimit);
  assert.deepEqual(new Set(limited.passes.strandId),new Set([0,1,2]));
  for (let p=0;p<limited.passes.strandId.length;p++)
    if (uncapped.passes.strandId[p] === 2) assert.equal(limited.passes.strandId[p],2);
  assert.throws(() => ink.render(world,{ ...view,curveQuality:layers(-1,1) }),/nonnegative/);
});

function raster({ gap = false, dark = false } = {}) {
  const w = 7, h = 1, of = values => Float32Array.from(values);
  const ids = Uint32Array.of(0,1,1,gap ? 0 : 1,1,1,0);
  const rgb = new Uint8Array(w * 3).fill(160);
  if (dark) rgb.fill(40,15,18);
  return { w,h,rgb,passes:{ w,h,strandId:ids,strandU:of([-1,.1,.3,.5,.7,.9,-1]),
    strandCoverage:of(ids), strandMotion:new Float32Array(w*2), strandMotionValid:new Uint8Array(w).fill(255) } };
}

test('the matched review finds bracketed gaps, luma jumps at joins, and motion-registered reversals', () => {
  const reference = raster(), joins = new Map([[1,[.8]]]);
  const thresholds = { coverage:.45, joinLuma:.09, flickerLuma:.075 };
  const start = measureFrame(reference,reference,null,joins,thresholds);
  const damaged = measureFrame(reference,raster({ gap:true,dark:true }),start.state,joins,thresholds);
  assert.equal(damaged.metrics.breaks,1);
  assert.equal(damaged.metrics.missingStrands,0);
  assert.equal(damaged.metrics.joinChanges,1);
  assert.equal(damaged.metrics.flickerPixels,0);
  assert.deepEqual(damaged.evidence.map(row=>row.kind),['break','join-brightness']);
  const restored = measureFrame(reference,reference,damaged.state,joins,thresholds);
  assert.equal(restored.metrics.flickerPixels,1);
  assert.equal(restored.metrics.trackedPixels,5);
  const authoredGap = raster({ gap:true });
  assert.equal(measureFrame(authoredGap,authoredGap,null,joins,thresholds).metrics.breaks,0);
});

test('the review CLI writes a native matched pan and per-layer diagnostics', () => {
  const root = path.resolve(__dirname,'..'), cli = path.join(root,'cli','ink-studio.js');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(),'ink-strand-quality-'));
  try {
    const result = spawnSync(process.execPath,[cli,'strand-review','examples/curve-quality-harp.js',
      '--w','64','--h','42','--from','0','--to','.5','--fps','6','--camera-pan','.4,0,0','--out',folder],
      { cwd:root,encoding:'utf8' });
    assert.equal(result.status,0,result.stderr);
    const report = JSON.parse(fs.readFileSync(path.join(folder,'review.json')));
    assert.deepEqual([report.width,report.height,report.fps,report.frames.length],[64,42,6,3]);
    assert.notDeepEqual(report.frames[0].camera.view,report.frames[2].camera.view);
    assert.ok(report.frames.every(frame=>frame.layers.length===3 && frame.budgeted.frameMs>=0));
    assert.ok(fs.readFileSync(path.join(folder,report.preview)).includes(Buffer.from('acTL')));
  } finally {
    fs.rmSync(folder,{recursive:true,force:true});
  }
});
