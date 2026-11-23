const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Ink = require('..');
const { KIT: K, makeBuilder } = Ink.load();
const AreaLights = require('../src/area-lights.js');
const { create } = require('../cli/bounce-probes.js');

const colors = [0x1b2833, 0x72797a, 0xf04126, 0x30a3ff, 0xefefdc];
const upward = [0, 1, 0];
const views = { w: 92, h: 62, px: 1, raw: true, renderStats: true, passes: ['objectId', 'depth', 'coverage'] };
const finish = { cam: { target: [0, .46, 0], yaw: .07, pitch: .41, dist: 5, ortho: true }, dither: 0, radius: 4 };
const sites = [
  { id: 'left', at: [-1, .40, 0], radius: 1.15 },
  { id: 'right', at: [3.6, .40, 0], radius: 1.15 },
  { id: 'remote', at: [11, .4, 0], radius: 1.15 }
];

function tile(B, { x = 0, y = 0, normal = upward, color = 1, id, flags = {}, size = 5 }) {
  const first = B.count(), half = (size - 1) / 2;
  for (let u = -half; u <= half; u++) for (let v = -half; v <= half; v++)
    B.disc(x + u * .18, y, v * .18, normal, .15, .012, B.P[color], 2, flags);
  const end = B.count();
  B.describeSplats(first, end, { object: id });
  return [first, end];
}

test('a moving painted reflector updates only local sites and its old color falls back to the bake', () => {
  const B = makeBuilder(1, colors);
  tile(B, { x: -1, id: 'floor' });
  const [first, end] = tile(B, { x: -1, y: 1.03, color: 2, id: 'door', normal: [0, -1, 0] });
  const dynamic = { reflect: [{ object: 'door' }] };
  const w = B.finish({ ...finish, bounceProbes: { probes: sites, reach: 2.05, samples: 128,
    dynamic, cast: { include: [{ object: 'door' }] }, receive: { include: [{ object: 'floor' }] }, skyStrength: 0 } });
  const baked = JSON.stringify(w.bounceProbes);
  assert(w.bounceProbes.probes.every(probe => probe.coefficients.every(n => n === 0) && probe.open.every(n => n === 1)));
  const start = create(w), left = start.sample(sites[0].at, upward).rgb;
  const sky = K.bounceProbes.update(w, w.bounceProbes).probes;
  assert(sky[0].open.some(value => value < .5));
  assert.equal(sky[2], w.bounceProbes.probes[2]);
  assert.deepEqual(start.stats, { sites: 3, updated: ['left'], rays: 128 });
  assert(left[0] > .12 && left[0] > left[2] * 4);

  for (let i = first; i < end; i++) {
    w.data[i * 16] += 4.6;
    w.data[i * 16 + 7] = 0xffa330;
  }
  const next = create(w);
  assert.deepEqual(next.stats.updated, ['right']);
  assert.deepEqual(next.sample(sites[0].at, upward).rgb, [0, 0, 0]);
  const blue = next.sample(sites[1].at, upward).rgb;
  assert(blue[2] > .12 && blue[2] > blue[0] * 4);
  assert.deepEqual(next.sample(sites[2].at, upward).rgb, [0, 0, 0]);
  assert.equal(JSON.stringify(w.bounceProbes), baked);
  assert.deepEqual(Ink.bakeBounceProbes(w, JSON.parse(baked)), JSON.parse(baked));
});

test('emissive carriers follow their native geometry and the baked comparison matches the former fill', () => {
  const B = makeBuilder(2, colors);
  tile(B, { x: -1, id: 'floor' });
  const [first] = tile(B, { x: -.75, y: 1, id: 'moth', flags: { em: true }, color: 3, size: 3 });
  assert(B.count() > first);
  const w = B.finish({ ...finish, bounceProbes: { probes: sites, samples: 144, reach: 2.2, skyStrength: 0,
    dynamic: { emit: [{ select: { object: 'moth' }, gain: 5 }] }, cast: { include: [] }, receive: { include: [{ object: 'floor' }] } } });
  const on = Ink.render(w, views), baked = Ink.render(w, { ...views, dynamicBounce: false });
  const without = Ink.render(w, { ...views, bounceProbes: false });
  assert.deepEqual(on.renderStats.bounceProbes.updated, ['left']);
  assert.equal(baked.renderStats.bounceProbes.rays, 0);
  assert.deepEqual(baked.rgb, without.rgb);
  assert.deepEqual(on.passes.depth, baked.passes.depth);
  const floor = on.passes.objects.indexOf('floor');
  assert(on.passes.objectId.some((id, p) => id === floor && on.rgb[p * 3 + 2] > baked.rgb[p * 3 + 2] + 12));
  assert(create(w).receives(0));
  assert(!create(w).receives(first));
  // A covered floor edge can also color a pixel with a different dominant owner.
  assert(on.passes.coverage.every((coverage, p) => coverage > 0 || on.rgb.subarray(p * 3, p * 3 + 3)
    .every((n, c) => n === baked.rgb[p * 3 + c])));
});

test('a moving area lantern relights the bounced surface, even where its direct beam cannot reach', () => {
  const B = makeBuilder(3, colors);
  for (const x of [-1, 3.6]) {
    tile(B, { x, id: 'floor' });
    const [first, end] = tile(B, { x, y: 1.1, color: 4, id: 'ceiling', normal: [0, -1, 0] });
    B.describeAlbedo(first, end, '#eee8cd');
  }
  const areaLights = [{ id: 'lantern', at: time => [time < 1 ? -1 : 3.6, .42, 0],
    normal: upward, size: [.18, .18], radius: 1.55, intensity: 20, color: '#ff5030', shadows: false, sampleGrid: 1, visible: false }];
  const w = B.finish({ ...finish, areaLights, bounceProbes: { probes: sites, reach: 2.1, samples: 128, skyStrength: 0,
    dynamic: { lights: ['lantern'] }, cast: { include: [{ object: 'ceiling' }] } } });
  const first = AreaLights.prepare(areaLights, { time: 0 });
  assert.deepEqual(AreaLights.evaluate(first, [-1, 0, 0], upward), [0, 0, 0]);
  const run = time => create(w, undefined, undefined, undefined, w, { time, lights: AreaLights.prepare(areaLights, { time }) });
  const baked = create(w, undefined, undefined, undefined, w, { dynamic: false });
  const local = run(0), moved = run(2), sought = run(0);
  assert.deepEqual(local.stats.updated, ['left']);
  assert.deepEqual(moved.stats.updated, ['right']);
  assert.deepEqual(local.sample(sites[0].at, upward), sought.sample(sites[0].at, upward));
  assert.deepEqual(moved.sample(sites[0].at, upward), baked.sample(sites[0].at, upward));
  assert(local.sample(sites[0].at, upward).rgb[0] > baked.sample(sites[0].at, upward).rgb[0] + .3);
  assert.deepEqual(local.sample(sites[2].at, upward), moved.sample(sites[2].at, upward));
});

test('the CLI exports the baked/live comparison and a frame-local trace', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-dynamic-bounce-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const scene = path.join(folder, 'fixture.js'), cli = path.resolve(__dirname, '../cli/ink-studio.js');
  fs.writeFileSync(scene, `module.exports=({makeBuilder})=>({id:'fixture',name:'Lantern </script>',seed:1,build(){
    const B=makeBuilder(1,[0x132636,0x828b94,0xff5628]);
    let first=B.count();
    for(let x=-2;x<=2;x++)for(let z=-2;z<=2;z++)B.disc(x*.18,0,z*.18,[0,1,0],.175,.01,B.P[1],2);
    B.describeSplats(first,B.count(),{object:'floor'});
    first=B.count();
    B.disc(0,.8,0,[0,-1,0],.44,.01,B.P[2],2,{em:true});
    B.describeSplats(first,B.count(),{object:'glow'});
    return B.finish({cam:{target:[0,.32,0],dist:3.8,pitch:.42,yaw:.05,ortho:true},radius:4,dither:0,
      bounceProbes:{samples:72,reach:2,skyStrength:0,dynamic:{emit:[{select:{object:'glow'},gain:4}]},
        probes:[{id:'near',at:[0,.25,0],radius:1.1}]}});
  }});`);
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  assert.match(run('bounce-probes', 'review', scene, '--w', '48', '--h', '32', '--to', '.75', '--fps', '4',
    '--out', folder, '--raw'), /Compared 3 native frames/);
  const read = file => fs.readFileSync(path.join(folder, file));
  const report = JSON.parse(read('review.json'));
  assert(report.samples.every(sample => sample.changedPixels > 0 && sample.rays === 72 && sample.updated[0] === 'near'));
  const data = JSON.parse(read('index.html').toString().match(/id="bounce-data">(.*)<\/script>/)[1]);
  assert.deepEqual(data.report, report);
  for (const id of ['baked', 'live']) {
    const png = read(id + '.png');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [48, 32]);
    assert.equal(png.readUInt32BE(png.indexOf('acTL') + 4), 3);
  }
  run('render', scene, '--w', '48', '--h', '32', '--px', '1', '--dynamic-bounce', 'off', '--raw', '--out', path.join(folder, 'off.png'));
  assert(read('off.png').equals(Buffer.from(data.pictures[0].baked.split(',')[1], 'base64')));
});

test('dynamic settings use real target selectors and reject an empty bake extension', () => {
  const definition = { probes: sites, dynamic: { lights: ['lantern'] } }, settings = require('../src/bounce-probes.js');
  assert.deepEqual(settings.prepare(definition).dynamic, { reflect: [], emit: [], lights: ['lantern'] });
  assert.throws(() => settings.prepare({ ...definition, dynamic: {} }), /one or more sources/);
  assert.throws(() => settings.prepare({ ...definition, dynamic: { emit: [{ select: { object: 'a' }, gain: 17 }] } }), /emitter/);
  assert.throws(() => settings.prepare({ ...definition, dynamic: { reflect: [{ unknown: 'a' }] } }), /selector field/);
});
