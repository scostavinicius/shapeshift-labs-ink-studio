const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Ink = require('..');
const Camera = require('../src/camera-lens.js');
const { settings, inspectSilhouetteFrame, collisionIntervals, findSilhouetteRepair } =
  require('../cli/silhouette-repair.js');

const width = 24, height = 16;
const cfg = settings({ width, height, toFrame: 5, subjects: [{ object: 'a' }, { object: 'b' }], maxDegrees: 12 });
function plate(a, b, { hidden = [], coverage = 1 } = {}) {
  const camera = new Float32Array(width * height * 2), projected = camera.slice();
  [a, b].forEach(([x, y], i) => {
    for (let row = y; row < y + 3; row++) for (let col = x; col < x + 3; col++) {
      const p = (row * width + col) * 2 + i;
      projected[p] = coverage;
      if (!hidden.includes(i)) camera[p] = coverage;
    }
  });
  return { w: width, h: height, objectMattes: { width, height, objects: ['a', 'b'], projected, camera } };
}

test('fully occluded characters still collide and diagonal contact needs a blank pixel', () => {
  const occluded = inspectSilhouetteFrame(plate([6, 6], [6, 6], { hidden: [1] }), cfg, 8);
  assert.equal(occluded.metrics.status, 'collision');
  assert.equal(occluded.metrics.overlapPixels, 9);
  assert.equal(occluded.metrics.subjects[1].visiblePixels, 0);
  assert.equal(occluded.mask[6 * width + 6], 3);
  const adjacent = inspectSilhouetteFrame(plate([6, 6], [9, 9]), cfg, 9).metrics;
  assert.equal(adjacent.status, 'collision');
  assert.equal(adjacent.overlapPixels, 0);
  assert.equal(adjacent.gapConflictPixels, 1);
  assert.equal(inspectSilhouetteFrame(plate([6, 6], [10, 9]), cfg, 10).metrics.status, 'clear');
});

test('a clipped or hidden actor cannot pass verification as a separated silhouette', () => {
  for (const frame of [
    plate([0, 7], [8, 5]),
    plate([3, 3], [10, 9], { hidden: [0] }),
    plate([3, 3], [10, 9], { coverage: .25 })
  ]) assert.equal(inspectSilhouetteFrame(frame, cfg, 0).metrics.status, 'unverified');
  assert.throws(() => inspectSilhouetteFrame({ ...plate([2, 2], [9, 9]), objectMattes: undefined }, cfg, 0),
    /aligned projected and visible/);
});

test('camera search groups intervals and rejects a promising peak if another frame fails', () => {
  const samples = [
    { frame: 4, status: 'clear' },
    { frame: 5, status: 'collision', overlapPixels: 1, gapConflictPixels: 4 },
    { frame: 6, status: 'collision', overlapPixels: 8, gapConflictPixels: 2 },
    { frame: 7, status: 'clear' },
    { frame: 8, status: 'collision', overlapPixels: 5, gapConflictPixels: 2 }
  ];
  assert.deepEqual(collisionIntervals(samples), [
    { fromFrame: 5, toFrame: 7, peakFrame: 6, peakOverlapPixels: 8 },
    { fromFrame: 8, toFrame: 9, peakFrame: 8, peakOverlapPixels: 5 }
  ]);
  const offsets = [], proof = samples.map(row => ({ ...row, status: 'clear' }));
  const result = findSilhouetteRepair(samples, cfg, ([yaw, pitch], frame) => {
    assert(frame >= 4 && frame <= 8);
    return pitch > 0 && yaw <= 0 ? 'clear' : 'collision';
  }, offset => {
    offsets.push(offset);
    return offset[0] < 0 ? proof : null;
  });
  assert.deepEqual(offsets, [[0, 4], [-4, 4]]);
  assert.deepEqual(result.repair.offsetDegrees, [-4, 4]);
  assert.equal(result.checked[0].result, 'failed-full-shot');
  assert.equal(result.verification, proof);
  assert.equal(findSilhouetteRepair(samples, cfg, () => 'collision', () => assert.fail()).repair, null);
});

test('native projected mattes preserve a rear actor under an opaque splat', () => {
  const { makeBuilder } = Ink.load(), B = makeBuilder(12, [0x111627, 0x94ffd5, 0xffb473]);
  for (const [name, z, color] of [['back', -.4, 1], ['front', .4, 2]]) {
    const first = B.count();
    B.disc(0, 0, z, [0, 0, 1], .65, .009, B.P[color], 3);
    B.describeSplats(first, B.count(), { object: name });
  }
  const world = B.finish({ cam: { target: [0, 0, 0], dist: 5, yaw: 0, pitch: 0, ortho: true }, radius: 4, dither: 0 });
  const view = { w: 49, h: 37, px: 1, raw: true };
  const frame = Ink.render(world, { ...view, objectMattes: { objects: ['back', 'front'], projected: true } });
  const center = 18 * 49 + 24;
  assert(Ink.objectMatte(frame, { object: 'back', view: 'projected' }).data[center] > .95);
  assert(Ink.objectMatte(frame, { object: 'back', view: 'camera' }).data[center] < .05);
  assert.equal(frame.deep, undefined);
  assert.deepEqual(frame.rgb, Ink.render(world, view).rgb);
});

test('orbit offsets add to animated shot poses and preserve native framing options', () => {
  const world = { cam: { target: [1, 2, 3], dist: 4, yaw: .2, pitch: .15, ortho: true }, radius: 6,
    cameraRig: { sample: time => ({ camera: { yaw: .2 + .1 * time } }) } };
  const base = Camera.frame(world, { t: .5 }, 30, 20);
  const repaired = Camera.frame(world, { t: .5, cameraOrbitOffset: [.05, .1] }, 30, 20);
  assert.equal(repaired.yaw, .30);
  assert.equal(repaired.pitch, .25);
  assert.equal(repaired.dist, base.dist);
  assert.deepEqual(repaired.framed, base.framed);
  assert.throws(() => Camera.frame(world, { cameraOrbitOffset: [1] }, 30, 20), /two finite angles/);
});

function frameData(png, frame) {
  let current = -1;
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    if (type === 'fcTL') current++;
    if (type === 'IDAT' && (current === frame || current === -1)) return png.subarray(start, start + length);
    if (type === 'fdAT' && current === frame) return png.subarray(start + 4, start + length);
    offset += 12 + length;
  }
  throw new Error('No PNG data for frame ' + frame);
}

test('CLI identifies the merged interval and replays the exported camera offset through the ordinary clip renderer', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-silhouette-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const scene = path.join(directory, 'crossing.js');
  fs.writeFileSync(scene, `module.exports=({KIT:K,makeBuilder})=>({id:'disc-crossing',seed:1,build(){
    const B=makeBuilder(1,[0x192432,0x8eeace,0xffbf70]);
    for(const [i,name] of ['left','right'].entries()){
      const first=B.count();
      B.disc(0,0,0,[0,0,1],.28,.01,B.P[i+1],3);
      B.describeSplats(first,B.count(),{object:name});
    }
    const world=B.finish({cam:{target:[0,0,0],dist:4.6,yaw:0,pitch:0,ortho:true},radius:6,dither:0});
    const stage=K.stage(world); stage.stateful=false;
    stage.add({pre(_dt,t){
      for(let i=0;i<2;i++){
        stage.D[i*16]=(i?1:-1)*(1.12-2.24*t);
        stage.D[i*16+2]=(i?1:-1)*1.8;
      }
    }});
    return world;
  }});`);
  const input = path.join(directory, 'plan.json');
  fs.writeFileSync(input, JSON.stringify({ format: 'ink-studio/silhouette-repair', version: 1,
    title: 'Crossing </script>', scene, width: 84, height: 56, fps: 12, toFrame: 13,
    contextFrames: 2, stepDegrees: 5, maxDegrees: 20, subjects: [{ object: 'left' }, { object: 'right' }] }));
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  assert.match(run('shot', 'silhouette-repair', input, '--out', directory), /Verified camera orbit offset/);
  const read = filename => fs.readFileSync(path.join(directory, filename));
  const report = JSON.parse(read('repair.json'));
  assert.equal(report.status, 'repaired');
  assert.equal(report.intervals.length, 1);
  assert(report.intervals[0].peakOverlapPixels > 20);
  assert(report.after.every(row => row.status === 'clear'));
  const pictures = JSON.parse(read('index.html').toString().match(/id="silhouette-data">(.*)<\/script>/)[1]);
  assert.deepEqual(pictures.report, report);
  assert.equal(pictures.previews.after.length, report.preview[1] - report.preview[0]);
  const replay = path.join(directory, 'replay.png');
  const peak = report.intervals[0].peakFrame;
  run('clip', scene, '--px', '1', '--w', '84', '--h', '56', '--from', '0', '--to', String(13 / 12), '--fps', '12',
    '--camera-orbit-offset', report.repair.offsetDegrees.join(','), '--out', replay);
  const preview = Buffer.from(pictures.previews.after[peak - report.preview[0]].picture.split(',')[1], 'base64');
  const repaired = frameData(preview, 0);
  assert(frameData(fs.readFileSync(replay), peak).equals(repaired));
  assert(frameData(read('after.png'), peak - report.preview[0]).equals(repaired));
});
