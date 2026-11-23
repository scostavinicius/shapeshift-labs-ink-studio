const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const ink = require('..'), kit = ink.load(), K = kit.KIT, C = K.curveSplats;
const PNG = require('../cli/png.js');
const palette = [0x14212e, 0xf3b56b, 0x76d6ae];
const camera = { target: [0, 0, 0], yaw: 0, pitch: 0, dist: 6 };
const imageOptions = { w: 128, h: 76, px: 1, raw: true };
const host = builder => builder.finish({ cam: camera, radius: 5, fog: { c: 0, start: 1, max: 0 }, dither: 0 });
const at = (frame, x, y) => [...frame.rgb.subarray((y * frame.w + x) * 3, (y * frame.w + x) * 3 + 3)];
const source = (points, style = {}) => ({ source: { kind: 'path', points }, radius: .05, ...style });
const scene = strands => ({ format: C.format, version: 1, id: 'strand-check', camera, strands });

test('finite segment coverage is stable when a path is subdivided, in perspective and orthographic views', () => {
  const whole = [[-2, 0, -.45], [2, 0, .45]];
  const pieces = Array.from({ length: 41 }, (_, i) => K.V.lerp(whole[0], whole[1], i / 40));
  const a = C.world(scene([source(whole)])), b = C.world(scene([source(pieces)]));
  for (const ortho of [false, true]) {
    const opts = { ...imageOptions, transparent: true, ortho };
    const reference = ink.render(a, opts), divided = ink.render(b, opts);
    assert.ok(reference.alpha.some(alpha => alpha > 160));
    assert.equal(reference.alpha.length, divided.alpha.length);
    assert.ok(reference.alpha.every((alpha, i) => Math.abs(alpha - divided.alpha[i]) <= 1));
    assert.notDeepEqual(ink.render(a, { ...opts, curveSplats: false }).alpha, reference.alpha);
  }
});

test('an editable strand that crosses a solid in depth emerges at the correct end', () => {
  const B = kit.makeBuilder(1, palette);
  const points = [[-2, 0, -1.4], [2, 0, 1.4]];
  const strand = C.draw(B, points, { radius: .13, color: '#f3b56b', object: 'wire' });
  assert.equal(strand.segments, 1);
  B.disc(0, 0, 0, [0, 0, 1], .92, .05, B.P[2], 2.7);
  const world = host(B);
  const frame = ink.render(world, imageOptions);
  const left = at(frame, 54, 38), right = at(frame, 74, 38);
  assert.ok(left[0] < left[1], String(left));
  assert.ok(right[0] > right[1], String(right));

  const entry = scene([source(points, { radius: .13 })]);
  const before = ink.render(C.world(entry), imageOptions);
  points[1][1] = 1.2;
  assert.notDeepEqual(ink.render(C.world(entry), imageOptions).rgb, before.rgb);
  assert.equal(entry.strands[0].source.points[1][1], 1.2);
});

test('spline, textile, routed and recorded trail inputs retain their separate paths and labels', () => {
  const B = kit.makeBuilder(1, palette);
  const spline = C.draw(B, { kind: 'spline', points: [[-1,0,0], [0,1,0], [1,0,0]], samples: 8 });
  assert.equal(spline.end - spline.first, 16);
  const compiled = K.curve.create({ type: 'flower', segments: 64 });
  assert.equal(C.draw(B, compiled).segments, 64);

  const textile = K.textile.weave({ size: [2, 1.4], columns: 4, rows: 3, radius: .06, clearance: .02 });
  let sampled = 0;
  const yarn = K.textile.draw(B, textile, { renderer: 'curve-splats', curveProfile: { section: 'flattened', width: .18, twist: .3 }, color: ({ uv }) => {
    assert.equal(uv.length, 2);
    sampled++;
    return '#76d6ae';
  } });
  assert.equal(yarn.threads.length, textile.threads.length);
  assert.equal(sampled, yarn.segments);
  assert.ok(yarn.threads.every((strand, i) => strand.id === textile.threads[i].id));

  const fixture = structuredClone(require('../examples/world-routed-workshop.json'));
  fixture.visual.routedLinkRenderer = 'curve-splats';
  fixture.visual.routedLinkProfiles = { hose: { width: .28 } };
  const run = K.world.runtime.create(fixture);
  const link = run.query().probe('routes/links', undefined, { link: 'hose' }).value;
  const routed = C.draw(B, { kind: 'routed', link });
  assert.equal(routed.threads.length, link.paths.length);
  assert.ok(routed.segments > 0);
  const visual = K.world.visual(kit, run.view(), run.query());
  assert.equal(visual.curveSplats, true);
  const meta = visual.renderMetadata, hose = meta.objects.indexOf('hose');
  assert.ok(hose > 0);
  assert.ok(meta.objectIds.some((id, i) => id === hose && Math.abs(visual.data[i * 16 + 12] - .14) < 1e-6));

  const trail = { kind: 'trail', samples: [{ point: [0, 0, 0] }, { point: [.4, .2, 0] },
    null, [1, 1, 0], [1.5, 1.2, 0]] };
  assert.equal(C.draw(B, trail, { object: 'spark' }).segments, 2);
  const count = B.count();
  assert.throws(() => C.draw(B, trail, { maxSegments: 1 }), /segment budget/);
  assert.equal(B.count(), count);
  const world = host(B);
  assert.ok(world.renderMetadata.objects.includes('hose'));
  assert.ok(world.renderMetadata.objects.includes('spark'));
});

test('the normal render CLI opens an editable JSON curve scene and can switch to Gaussian carriers', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-curve-splats-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = name => path.join(folder, name);
  const entry = scene([{ source: { kind: 'spline', points: [[-2,0,0],[-.8,.7,.2],[.8,-.5,-.3],[2,0,0]], samples: 5 },
    section: 'flattened', edge: 'beta', caps: { start: 'blunt', end: 'fading' }, width: { samples: [.06, .21, .10] }, twist: [[0, 0], [1, Math.PI]], color: '#f3b56b', object: 'wire' }]);
  fs.writeFileSync(file('strand.json'), JSON.stringify(entry));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  for (const mode of ['on', 'off']) {
    const result = spawnSync(process.execPath, [cli, 'render', 'strand.json', '--curve-splats', mode,
      '--raw', '--w', '128', '--h', '76', '--px', '1', '--out', mode + '.png'], { cwd: folder, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const curve = PNG.read(file('on.png')), fallback = PNG.read(file('off.png'));
  assert.equal(curve.w, 128);
  assert.notDeepEqual(curve.rgb, fallback.rgb);
});

const band = (frame, x, from = 0) => {
  let result = 0;
  for (let y = from; y < frame.h; y++) result += frame.alpha[y * frame.w + x] / 255;
  return result;
};
const straight = [[-2, 0, 0], [2, 0, 0]];
const profileFrame = style => ink.render(C.world(scene([{ source: straight, ...style }])),
  { ...imageOptions, ortho: true, transparent: true });

const patternView = { ...imageOptions, ortho: true, transparent: true, fov: 2 * Math.atan(76 / 240) };

const sampledBend = Array.from({ length: 81 }, (_, i) => {
  const u = i / 80;
  return [-2.5 + 5 * u, .57 * Math.sin(2 * Math.PI * u) + .14 * Math.sin(24 * u), .12 * u];
});
function parallelThreads(points, spacing) {
  return { kind: 'textile', plan: { threads: Array.from({ length: 5 }, (_, i) => ({
    id: 'thread-' + i, radius: .016, stations: points.map(([x,y,z]) =>
      ({ p:[x,y+spacing*(i-2),z], uv:[0,0], n:[0,0,1] }))
  })) } };
}

test('curve simplification budgets projected bends and leaves detailed patterns alone', () => {
  const settings = { lod: { simplify:[.16,.40] }, edge:'hard', width:.085 };
  const recipe = scene([{ source: sampledBend, ...settings }]);
  const world = C.world(recipe);
  for (const ortho of [true, false]) {
    const opts = { ...imageOptions, ortho, transparent:true, renderStats:true, edgeFilter:true };
    const near = ink.render(world, { ...opts, dist:6 });
    const far = ink.render(world, { ...opts, dist:17 });
    const reference = ink.render(world, { ...opts, dist:17, curveLod:false });
    assert.ok(near.renderStats.curveSegments > far.renderStats.curveSegments);
    assert.ok(far.renderStats.curveSegments < reference.renderStats.curveSegments / 2);
    assert.ok(far.renderStats.curveLod.removedSegments > 40);
    assert.equal(reference.renderStats.curveSegments, 80);
    assert.ok(far.alpha.some(n => n > 40));
    assert.ok(far.alpha.reduce((sum, n, i) => sum + Math.abs(n-reference.alpha[i]), 0) <
      .45 * reference.alpha.reduce((sum,n) => sum+n,0));
  }
  const patterned = C.world(scene([{ source: sampledBend, ...settings, pattern: { dash:{ spacing:.24 } } }]));
  const opt = { ...imageOptions, dist:15, renderStats:true };
  assert.deepEqual(ink.render(patterned,opt).rgb, ink.render(patterned,{...opt,curveLod:false}).rgb);
  assert.throws(() => C.world(scene([{ ...recipe.strands[0], lod:{ simplify:[1, .1] } }])), /increasing art-pixel/);
});

test('fine strands transition to one selectable pigment shape without double opacity', () => {
  const threads = parallelThreads(K.curve.line([-2,0,0],[2,0,0],20), .073);
  const lod = { aggregate:{ width:.32, color:'#f3b56b', samples:10, transition:[.49,1.50] } };
  const recipe = scene([{ source:threads, edge:'hard', width:.041, color:'#76d6ae', lod }]);
  const world = C.world(recipe), full = C.world(scene([{ ...recipe.strands[0], lod:false }]));
  const render = (dist, extra) => ink.render(world,{ ...patternView, dist, renderStats:true,...extra });
  const near = render(4), mid = render(8), far = render(20), disabled = render(20,{curveLod:false});
  assert.equal(near.renderStats.curveLod.aggregateGroups,0);
  assert.equal(mid.renderStats.curveLod.blendingGroups,1);
  assert.ok(mid.alpha.every(alpha => alpha === 0 || alpha === 255));
  assert.equal(far.renderStats.curveLod.aggregateGroups,1);
  assert.equal(far.renderStats.curveLod.blendingGroups,0);
  assert.equal(far.renderStats.curveSegments,10);
  assert.deepEqual(at(far,64,37),[243,181,107]);
  assert.equal(disabled.renderStats.curveSegments,100);
  assert.deepEqual(disabled.rgb,ink.render(full,{ ...patternView, dist:20 }).rgb);
  const tighter = C.world(scene([{ ...recipe.strands[0], lod:{ aggregate:{ ...lod.aggregate, transition:[.15,.40] } } }]));
  assert.equal(ink.render(tighter,{ ...patternView, dist:20, renderStats:true }).renderStats.curveLod.aggregateGroups,0);
});

test('a bound aggregate follows its members and updates spacing, and complete groups survive joining', () => {
  const B = kit.makeBuilder(1,palette);
  const source = parallelThreads(K.curve.line([-1.7,0,0],[1.7,0,0],12),.061);
  const lod = { simplify:[.16,.4], aggregate:{ width:.31, color:'#f3b56b', samples:8, transition:[.50,1.10] } };
  let lift = 0, stretch = 1;
  const bound = C.bind(B,source,({points}) => points.map(([x,y,z]) => [x, lift + y * stretch, z]), {
    width:.027, edge:'hard', color:'#76d6ae', lod,
  });
  const world = host(B), options = { ...patternView, dist:18, renderStats:true };
  const nearOrigin = ink.render(world,options);
  assert.deepEqual(at(nearOrigin,64,37),[243,181,107]);
  lift = .9;
  bound.pose(world);
  const lifted = ink.render(world,options);
  assert.equal(lifted.renderStats.curveLod.aggregateGroups,1);
  assert.equal(lifted.alpha[37*lifted.w+64],0);
  assert.deepEqual(at(lifted,64,32),[243,181,107]);
  stretch = 4;
  bound.pose(world);
  assert.equal(ink.render(world,options).renderStats.curveLod.aggregateGroups,0);

  const Solid = kit.makeBuilder(1,palette);
  C.draw(Solid,source,{width:.027,edge:'hard',lod});
  const chunk = host(Solid);
  const provenance = require('../src/splat-provenance.js');
  const Empty = kit.makeBuilder(1,palette);
  Empty.curveSplat([-1,0,0],[1,0,0],.1,Empty.P[1],0);
  const joined = provenance.join([host(Empty),chunk],
    {cam:chunk.cam,fog:chunk.fog,radius:chunk.radius,dither:0});
  assert.deepEqual(ink.render(joined,options).rgb, nearOrigin.rgb);
  const broken = provenance.subset(joined,[1,2,3,4,5,6,7]);
  assert.equal(broken.curveLod[0]?.aggregate, undefined);
});

test('separate depths of a translucent self-crossing survive hard strand coverage union', () => {
  const points = [[-1.65,0,-.78], [1.65,0,-.78], [1.65,1.32,.68], [0,1.32,.68], [0,-1.32,.68]];
  const style = { edge: 'hard', width: .22, opacity: .5,
    along: { pigment: ({ distance }) => distance < 3.4 ? '#e54139' : '#3ec3bd' } };
  for (const edgeFilter of [false, true]) {
    const world = C.world(scene([{ source: points, ...style }]));
    const result = ink.render(world, { ...patternView, edgeFilter });
    assert.equal(result.alpha[37 * result.w + 51], 128);
    assert.ok(Math.abs(result.alpha[37 * result.w + 64] - 191) <= 1);
    const [r, g] = at(result, 64, 37);
    assert.ok(g > r, 'the nearer teal span dominates at the crossing');
  }
});

test('bounded mist shades translucent curve fragments at their own depth by default', () => {
  const strands = [[.45,.95],[-.45,-1.12]].map(([y,z]) => source([[-1.75,y,z],[1.75,y,z]], {
    edge: 'hard', width: .25, opacity: .53, color: '#ff2010'
  }));
  const atmosphere = [K.atmosphere.box({ min: [-4,-2,-.73], max: [4,2,.52], density:1.1, color:'#0000ff' })];
  const world = C.world({ ...scene(strands), background:'#000000', atmosphere });
  for (const ortho of [true, false]) {
    const view = { ...patternView, ortho, transparent:false };
    const clear = ink.render(world, { ...view, atmosphere:false }), fog = ink.render(world, view);
    const red = (frame, rows) => Math.max(...rows.map(y => at(frame, 64, y)[0]));
    const front = [26,27,28,29,30,31,32], behind = [43,44,45,46,47,48,49];
    assert.equal(red(fog, front), red(clear, front));
    assert.ok(red(clear, behind) > 125);
    assert.ok(red(fog, behind) < .32 * red(clear, behind));
  }
});

test('live sun strand casting and receiving toggle independently and respect physical dash gaps', () => {
  function render(shadow, receive, opacity = 1, dash = false) {
    const B = kit.makeBuilder(1, palette);
    const first = B.count();
    B.disc(0, 0, 0, [0,0,1], 1.5, .02, B.P[1], 2.4);
    B.describeAlbedo(first, B.count(), '#cccccc');
    C.draw(B, [[.4,-.95,.95],[.4,1,.95]], { edge:'hard', width:.20, opacity, color:'#76d6ae',
      shadow: { cast:shadow }, ...(dash && { pattern: { dash: { spacing:.4, duty:.55 } } }) });
    C.draw(B, [[-1,-.35,.29],[1,-.35,.29]], { edge:'hard', width:.16, color:'#f3b56b', shadow:{ receive } });
    const world = host(B);
    return ink.render(world, { ...patternView, liveSun: { direction:[1,0,1], ambient:.2, intensity:.9,
      mapSize:192, bias:.013, filter:0 } });
  }
  const clear = render(false, true), shadowed = render(true, true), receiveOff = render(true, false);
  const soft = render(true, true, .45), dash = render(true, true, 1, true);
  const floor = frame => at(frame, 53, 28)[0], cord = frame => at(frame, 58, 44)[0];
  assert.ok(floor(shadowed) + 65 < floor(clear));
  assert.ok(floor(soft) > floor(shadowed) + 25 && floor(soft) < floor(clear) - 25);
  assert.equal(floor(shadowed), floor(receiveOff));
  assert.ok(cord(shadowed) + 65 < cord(clear));
  assert.equal(cord(receiveOff), cord(clear));
  assert.ok([22,26,31,35].some(y => at(dash, 53,y)[0] > at(shadowed,53,y)[0] + 65));
  assert.ok([22,26,31,35].some(y => at(dash, 53,y)[0] === at(shadowed,53,y)[0]));
  assert.throws(() => C.world(scene([{ source: straight, shadow:{ cast: 'on' } }])), /boolean cast and receive/);
});

test('arc pigment and dash gaps agree after subdivision of a straight span', () => {
  const pieces = Array.from({ length: 43 }, (_, i) => K.V.lerp(...straight, i / 42));
  const pattern = {
    grain: { anchor: 'arc', spacing: .061, strength: .3, seed: 11 },
    dash: { anchor: 'arc', spacing: .48, duty: .68, phase: .031 },
    dither: { anchor: 'arc', spacing: .092, colors: ['#bb5a45', '#81cfa4'] }
  };
  for (const edge of ['hard', 'beta']) {
    const draw = source => C.world(scene([{ source, width: .23, edge, caps: 'blunt', pattern }]));
    const view = { ...patternView, edgeFilter: true };
    const a = ink.render(draw(straight), view), b = ink.render(draw(pieces), view);
    assert.equal(a.alpha[37 * a.w + 31], 0);
    assert.ok(a.alpha[37 * a.w + 35] > 50);
    assert.ok(new Set(Array.from({ length: 74 }, (_, i) => at(a, i + 27, 37)[0])).size > 8);
    assert.ok(a.alpha.every((value, i) => Math.abs(value - b.alpha[i]) <= 1));
    for (let x = 27; x < 101; x++) if (a.alpha[37 * a.w + x] > 180)
      assert.ok(at(a, x, 37).every((value, i) => Math.abs(value - at(b, x, 37)[i]) <= 1));
  }
});

test('chart dither spans a ribbon and stays registered on the chart when its route is resampled', () => {
  const recipe = scene([]);
  recipe.charts = { face: { kind: 'plane', origin: [-2,-1,0], u: [4,0,0], v: [0,2,0] } };
  recipe.palette = ['#c16754', '#eebc73'];
  recipe.paletteRoles = { ink: [1, 2] };
  const style = { edge: 'hard', section: 'flattened', aspect: .2, width: .61, caps: 'blunt',
    pattern: { dither: { anchor: 'chart', spacing: [.07,.073], colors: ['ink.0', 'ink.1'] } } };
  function run(controls) {
    const world = C.world({ ...recipe, strands: [{ ...style, source: { kind: 'surface', chart: 'face', points: controls } }] });
    return ink.render(world, patternView);
  }
  const a = run([[.07,.51],[.94,.51]]), b = run([[.07,.51],[.511,.51],[.94,.51]]);
  assert.deepEqual([34, 36, 38, 40].map(y => a.alpha[y * a.w + 64]), [255,255,255,255]);
  assert.equal(new Set([34, 36, 38, 40].map(y => at(a, 64, y).join())).size, 2);
  for (let y = 34; y <= 41; y++) for (let x = 46; x <= 82; x++) assert.deepEqual(at(a, x, y), at(b, x, y));
  const posed = C.world({ ...recipe, strands: [{ ...style,
    source: { kind: 'surface', chart: 'face', points: [[.07,.51],[.94,.51]] } }] });
  const view = { ...patternView, w: 129, h: 77, target: [.17,.18,0] };
  const seen = [0, .72, -.73].map(pitch => ink.render(posed, { ...view, pitch }));
  assert.ok(seen.every(frame => frame.alpha[38 * frame.w + 64] === 255));
  assert.deepEqual(at(seen[0], 64, 38), at(seen[1], 64, 38));
  assert.deepEqual(at(seen[0], 64, 38), at(seen[2], 64, 38));
  const B = kit.makeBuilder(1, palette);
  assert.throws(() => C.draw(B, straight, { pattern: { grain: { anchor: 'chart' } } }), /chart-anchored patterns need/);
  assert.equal(B.count(), 0);
});

test('equivalent lifts of a periodic chart resolve the same pigment and gaps', () => {
  const charts = { drum: { kind: 'cylinder', origin: [0,-1,0], height: 2, radius: 1.2 } };
  const render = lap => {
    const source = { kind: 'surface', chart: 'drum', points: [[lap+.12,.49],[lap+.38,.49]], coordinates: 'lifted' };
    const pattern = {
      grain: { anchor: 'chart', spacing: [.023,.034], seed: 73 },
      dash: { anchor: 'chart', spacing: .091, duty: .7 },
      dither: { anchor: 'chart', spacing: [.042,.071], colors: ['#84482c', '#edac66'] }
    };
    return ink.render(C.world({ ...scene([{ source, edge: 'hard', width: .45, pattern }]), charts }), patternView);
  };
  const a = render(0), b = render(1);
  assert.ok(a.alpha.includes(255));
  assert.deepEqual(a.alpha, b.alpha);
  for (let y = 34; y <= 41; y++) for (let x = 49; x <= 79; x++) assert.deepEqual(at(a, x, y), at(b, x, y));
});

test('screen dither stays on the output grid and arc paint stretches with a bound curve', () => {
  const dither = { anchor: 'screen', spacing: 1, colors: ['#f3b56b', '#76d6ae'] };
  const world = C.world(scene([{ source: straight, width: .5, edge: 'hard', pattern: { dither } }]));
  const a = ink.render(world, patternView), b = ink.render(world, { ...patternView, target: [.35,0,0] });
  const scaled = ink.render(world, { ...patternView, w: 384, h: 228, px: 3 });
  assert.deepEqual(a.rgb, scaled.rgb);
  assert.notDeepEqual(at(a, 64, 37), at(a, 65, 37));
  for (let x = 46; x < 81; x++) assert.deepEqual(at(a, x, 37), at(b, x, 37));

  const B = kit.makeBuilder(1, palette);
  const binding = C.bind(B, straight, ({ points }) => points.map(([x,y,z]) => [3 * x + .4, y, z]), {
    width: .24, edge: 'hard', reveal: { start: .25, end: .8 },
    pattern: { dither: { ...dither, anchor: 'arc', spacing: .162 }, dash: { spacing: .39, phase: .031, duty: .75 } }
  });
  const bound = host(B), rest = ink.render(bound, patternView);
  binding.pose(bound);
  const posed = ink.render(bound, patternView);
  assert.notDeepEqual(rest.alpha, posed.alpha);
  for (let x = 48; x < 78; x++) assert.deepEqual(at(rest, x, 37), at(posed, (x - 64) * 3 + 73, 37));
});

test('assembled and subset splats retain the curve pattern program and its coordinates', () => {
  const provenance = require('../src/splat-provenance.js');
  const draw = (y, color) => {
    const B = kit.makeBuilder(1, palette);
    C.draw(B, straight.map(([x]) => [x,y,0]), { width: .29, edge: 'hard',
      pattern: { dither: { mix: 1, colors: ['#ffffff', color] } } });
    return host(B);
  };
  const a = draw(.38, '#f3b56b'), b = draw(-.38, '#76d6ae');
  const joined = provenance.join([a,b], { cam: a.cam, radius: a.radius, fog: a.fog, dither: 0 });
  const frame = ink.render(joined, patternView), subset = ink.render(provenance.subset(joined, [1]), patternView);
  assert.deepEqual(at(frame, 64, 30), [243,181,107]);
  assert.deepEqual(at(frame, 64, 45), [118,214,174]);
  assert.deepEqual(at(subset, 64, 45), at(frame, 64, 45));
  assert.equal(subset.alpha[30 * subset.w + 64], 0);
});

test('material edge filtering keeps a half-pixel curve visible through a camera pan', () => {
  const wire = source([[-1.5, 0, 0], [1.5, 0, 0]], { width: .019, edge: 'hard', material: 'wire' });
  const mark = source([[-.42,.56,.08], [0,.72,.08], [.42,.56,.08]], {
    width: .065, edge: 'hard', material: 'paint', color: '#76d6ae'
  });
  const world = C.world({ ...scene([wire, mark]), camera: { ...camera, dist: 4 }, look: {
    edgeFilter: { rules: [{ select: { material: 'paint' }, strength: 0 }, { select: { material: 'wire' } }] }
  } });
  for (const ortho of [false, true]) {
    const options = { w: 96, h: 64, px: 1, raw: true, transparent: true, ortho };
    const native = [], filtered = [];
    for (let i = 0; i <= 16; i++) {
      const view = { ...options, target: [0, i * .043 / 16, 0] };
      const off = ink.render(world, { ...view, edgeFilter: false }), on = ink.render(world, view);
      native.push(band(off, 48, 24));
      filtered.push(band(on, 48, 24));
      const outline = 24 * on.w;
      assert.deepEqual(off.alpha.subarray(0, outline), on.alpha.subarray(0, outline));
      assert.ok(on.alpha.subarray(0, outline).includes(255));
      if (i === 0) {
        const enlarged = ink.render(world, { ...view, w: 288, h: 192, px: 3 });
        assert.deepEqual(enlarged.alpha, on.alpha);
      }
    }
    assert.ok(Math.min(...native) < .01 && Math.max(...native) > .99);
    assert.ok(Math.min(...filtered) > .4 && Math.max(...filtered) < .61);
  }
});

test('filtered strand coverage survives subdivision across hard and optical profiles', () => {
  const ends = [[-1.5, .03, -.09], [1.5, -.025, .16]];
  const pieces = Array.from({ length: 101 }, (_, i) => K.V.lerp(...ends, i / 100));
  for (const edge of ['hard', 'beta', 'gaussian']) {
    const draw = points => C.world(scene([{ source: points, edge, opacity: .7, width: .045 }]));
    const options = { ...imageOptions, transparent: true, ortho: false, edgeFilter: true, target: [0, .011, 0] };
    const a = ink.render(draw(ends), options), b = ink.render(draw(pieces), options);
    assert.ok(a.alpha.some(value => value > 0 && value < 120));
    assert.ok(b.alpha.every((value, i) => Math.abs(a.alpha[i] - value) <= 2), edge);
    const half = ink.render(draw(pieces), { ...options, edgeFilter: { strength: .5 } });
    assert.notDeepEqual(half.alpha, b.alpha);
  }
});

test('filtered coverage blends the visible wire with opaque geometry at its local depth', () => {
  const wire = source([[-1.6,0,-.7], [1.6,0,.7]], {
    width: .030, edge: 'hard', material: 'wire', color: '#f3b56b'
  });
  const plate = source([[-1.25,0,0], [1.25,0,0]], {
    width: .24, edge: 'hard', material: 'metal', color: '#76d6ae'
  });
  const look = { edgeFilter: { rules: [{ select: { material: 'wire' } }] } };
  const options = { ...imageOptions, ortho: true, transparent: true, target: [0, .013, 0] };
  const render = strands => ink.render(C.world({ ...scene(strands), look }), options);
  const both = render([wire, plate]), backing = render([plate]), single = render([wire]);
  for (const x of [49, 79]) {
    assert.ok(single.alpha[37 * single.w + x] > 0);
    const [r, g, b] = at(both, x, 37);
    assert.equal(both.alpha[37 * both.w + x], 255);
    if (x === 49) assert.deepEqual([r, g, b], at(backing, x, 37));
    else {
      assert.ok(r > 118 && r < 243);
      assert.ok(g < 214 && g > 181);
    }
  }
});

test('a selected minimum holds in art pixels through zoom and perspective depth', () => {
  const line = source([[-2.1, -.37, -2.4], [2.1, -.37, 1.5]], {
    width: .024, edge: 'hard', material: 'cable'
  });
  const mark = source([[-1.4, .60, .12], [1.4, .60, .12]], {
    width: .036, edge: 'hard', material: 'paint'
  });
  const policy = {
    default: { mode: 'minimum', pixels: 1.6 },
    rules: [{ select: { material: 'paint' }, policy: { mode: 'physical' } }]
  };
  const make = strand => C.world({ ...scene([strand, mark]), look: { curveWidth: policy, edgeFilter: true } });
  const world = make(line), divided = make({ ...line, source: Array.from({ length: 19 }, (_, i) =>
    K.V.lerp(...line.source.points, i / 18)) });
  for (const ortho of [false, true]) for (const dist of [5, 9]) {
    const options = { ...imageOptions, transparent: true, ortho, dist };
    const on = ink.render(world, options), physical = ink.render(world, { ...options, curveWidth: false });
    const top = 35 * on.w;
    assert.deepEqual(on.alpha.subarray(0, top), physical.alpha.subarray(0, top));
    for (const x of [53, 64, 75]) {
      assert.ok(band(on, x, 38) > 1.44 && band(on, x, 38) < 1.86);
      assert.ok(band(physical, x, 38) < .72);
    }
    const subdivided = ink.render(divided, options);
    for (const x of [53, 64, 75]) assert.ok(Math.abs(band(subdivided, x) - band(on, x)) < .14);
    const scaled = ink.render(world, { ...options, w: options.w * 3, h: options.h * 3, px: 3 });
    assert.deepEqual(scaled.alpha, on.alpha);
  }
  const capped = { default: { mode: 'minimum', pixels: 5, maxScale: 1 } };
  assert.deepEqual(ink.render(world, { ...imageOptions, curveWidth: capped }).rgb,
    ink.render(world, { ...imageOptions, curveWidth: false }).rgb);
});

test('fade leaves fine weave gaps unfilled and retains smooth opacity inside the range', () => {
  const strands = [-.23, .23].map(y => source([[-1.5, y, 0], [1.5, y, 0]], {
    width: .10, edge: 'hard', material: 'weave'
  }));
  strands.push(source([[-1.5, 0, .1], [1.5, 0, .1]], { width: .026, edge: 'hard', material: 'filament' }));
  const curveWidth = { rules: [{ select: { material: 'filament' }, policy: { mode: 'fade', range: [.38, .95] } }] };
  const world = C.world({ ...scene(strands), look: { curveWidth, edgeFilter: true } });
  for (const edgeFilter of [false, true]) {
    const view = { ...imageOptions, transparent: true, ortho: true, edgeFilter, target: [0,.02,0], passes: ['depth'] };
    const renders = [2.6, 4, 6, 8, 12].map(dist => ink.render(world, { ...view, dist }));
    const center = 37 * view.w + 64, opposite = 38 * view.w + 64;
    const occupancy = renders.map(frame => Math.max(frame.alpha[center], frame.alpha[opposite]));
    assert.equal(occupancy.at(-1), 0);
    assert.ok(occupancy[0] > occupancy[1] && occupancy[1] > occupancy[2] && occupancy[2] > 0, occupancy.join(','));
    assert.ok(renders.at(-1).alpha.some(value => value > 100));
    assert.equal(renders[2].passes.depth[center], renders.at(-1).passes.depth[center]);
  }
  assert.throws(() => C.world({ ...scene(strands), look: { curveWidth: { default: { mode: 'fade', range: [1, 1] } } } }),
    /increasing art-pixel range/);
});

test('projected width measures a flattened ribbon across its camera-facing section', () => {
  const ribbon = source(straight, { width: .2, edge: 'hard', section: 'flattened', aspect: .10 });
  const edgeOn = { ...ribbon, up: [0,0,1] }, broadside = { ...ribbon, up: [0,1,0] };
  const options = { ...imageOptions, transparent: true, ortho: true, edgeFilter: true };
  const withMinimum = { ...options, curveWidth: { default: { mode: 'minimum', pixels: 1.8 } } };
  const edge = C.world(scene([edgeOn])), broad = C.world(scene([broadside]));
  assert.ok(band(ink.render(edge, options), 64) < .5);
  assert.ok(band(ink.render(edge, withMinimum), 64) > 1.6);
  assert.deepEqual(ink.render(broad, withMinimum).alpha, ink.render(broad, options).alpha);
});

test('a depth-slanted strand fades continuously within a segment with filtered edges', () => {
  const ends = [[-2.2, 0, -2.4], [1.55, 0, 2.0]];
  const split = Array.from({ length: 25 }, (_, i) => K.V.lerp(...ends, i / 24));
  const style = { edge: 'hard', width: .046 };
  const world = points => C.world(scene([source(points, style)]));
  const options = { ...imageOptions, transparent: true, edgeFilter: true,
    curveWidth: { default: { mode: 'fade', range: [.72, 1.2] } } };
  const a = ink.render(world(ends), options), b = ink.render(world(split), options);
  assert.ok(band(a, 42) < .05);
  assert.ok(band(a, 65) > .1);
  assert.ok(band(a, 84) > .64);
  for (let x = 45; x < 87; x++) assert.ok(Math.abs(band(a, x) - band(b, x)) < .035);
});

test('width and taper use arc length, including for a path with irregular control spacing', () => {
  const fixed = profileFrame({ width: .22 });
  assert.deepEqual(fixed.alpha, profileFrame({ radius: .11 }).alpha);
  assert.ok(Math.abs(band(fixed, 48) - band(fixed, 80)) < .02);
  const pressure = { samples: [.10, .43, .10] };
  const painted = profileFrame({ width: pressure, taper: [[0, 1], [.64, 1], [1, 0]] });
  assert.ok(band(painted, 64) > 2 * band(painted, 35));
  assert.ok(band(painted, 92) < .25 * band(painted, 64));
  const irregular = ink.render(C.world(scene([{ source: [[-2, 0, 0], [-1.85, 0, 0], [.92, 0, 0], [2, 0, 0]],
    width: pressure, taper: [[0, 1], [.64, 1], [1, 0]] }])),
  { ...imageOptions, ortho: true, transparent: true });
  assert.ok(Math.abs(band(irregular, 64) - band(painted, 64)) < .08);
  assert.deepEqual(pressure.samples, [.10, .43, .10]);
});

test('twist physically turns an elliptical section about the strand tangent', () => {
  const broad = profileFrame({ width: .44, aspect: .26, twist: 0 });
  const edge = profileFrame({ width: .44, aspect: .26, twist: Math.PI / 2 });
  const visibleWidth = (frame, x) => {
    let pixels = 0;
    for (let y = 0; y < frame.h; y++) if (frame.alpha[y * frame.w + x] >= 30) pixels++;
    return pixels;
  };
  assert.ok(visibleWidth(broad, 64) >= visibleWidth(edge, 64) * 2);
  const roll = profileFrame({ width: .44, aspect: .26, twist: [[0, 0], [1, Math.PI]] });
  assert.ok(visibleWidth(roll, 64) < visibleWidth(roll, 43) * .65);
  assert.ok(visibleWidth(roll, 64) < visibleWidth(roll, 86) * .65);
  const circular = profileFrame({ width: .44, aspect: 1 });
  assert.deepEqual(profileFrame({ width: .44, aspect: 1, twist: [[0, 0], [1, 5]] }).alpha, circular.alpha);
});

test('profile painters are sampled in path order and a bad profile leaves the builder intact', () => {
  const B = kit.makeBuilder(1, palette), positions = [];
  const range = C.draw(B, straight, { width: at => {
    positions.push(at.u);
    assert.equal(at.point.length, 3);
    return .05 + at.u * .18;
  }, twist: at => at.u * Math.PI, profileSamples: 24 });
  assert.equal(range.segments, 24);
  assert.ok(positions.every((v, i) => i === 0 || v > positions[i - 1]));
  const count = B.count();
  assert.throws(() => C.draw(B, straight, { taper: [[0, 1], [0, .3]] }), /increasing positions/);
  assert.throws(() => C.draw(B, straight, { width: ({ u }) => u > .6 ? NaN : .25 }), /invalid width/);
  assert.throws(() => C.draw(B, straight, { taper: 0, twist: [[0, 0], [1, Math.PI]], maxSegments: 3 }), /segment budget/);
  assert.equal(B.count(), count);
});

test('named round and elliptical sections preserve the existing profiles while flattened sections have a plateau', () => {
  const width = .9, aspect = .25;
  const round = profileFrame({ width, section: 'round' });
  assert.deepEqual(round.alpha, profileFrame({ width }).alpha);
  const ellipse = profileFrame({ width, aspect, section: 'elliptical' });
  assert.deepEqual(ellipse.alpha, profileFrame({ width, aspect }).alpha);
  const flat = profileFrame({ width, aspect, section: 'flattened' });
  const center = frame => frame.alpha[38 * frame.w + 64];
  const atOffset = (frame, offset) => frame.alpha[(38 + offset) * frame.w + 64] / center(frame);
  assert.ok(atOffset(flat, 5) > .90);
  assert.ok(atOffset(flat, 5) > atOffset(ellipse, 5) + .07);
  assert.ok(atOffset(flat, 12) < .08 && atOffset(ellipse, 12) > .25);
});

test('flattened sections follow the authored path frame and continue across subdivided spans', () => {
  const folded = K.curve.path(straight, { up: [0, 0, 1] });
  const settings = { width: .4, aspect: .24, section: 'flattened' };
  const raster = (source, settings, ortho) => ink.render(C.world(scene([{ source, ...settings }])),
    { ...imageOptions, ortho, transparent: true });
  const broad = raster(straight, settings, true), edge = raster(folded, settings, true);
  assert.notDeepEqual(broad.alpha, edge.alpha);
  assert.deepEqual(broad.alpha, raster(folded, { ...settings, up: [0, 1, 0] }, true).alpha);
  assert.ok(band(broad, 64) > band(edge, 64));

  const pieces = Array.from({ length: 24 }, (_, i) => K.V.lerp(straight[0], straight[1], i / 23));
  for (const ortho of [false, true]) {
    const a = raster(straight, settings, ortho), b = raster(pieces, settings, ortho);
    assert.ok(a.alpha.every((value, i) => Math.abs(value - b.alpha[i]) <= 1));
  }
  const B = kit.makeBuilder(1, palette);
  assert.throws(() => C.draw(B, straight, { section: 'square' }), /round, elliptical or flattened/);
  assert.throws(() => C.draw(B, straight, { section: 'round', aspect: .5 }), /round sections use aspect 1/);
  assert.equal(B.count(), 0);
});

test('Gaussian is the default, compact Beta ends at its support, and hard coverage has a binary edge', () => {
  const options = { width: .44, opacity: .94 };
  const gaussian = profileFrame(options), beta = profileFrame({ ...options, edge: 'beta' });
  assert.deepEqual(gaussian.alpha, profileFrame({ ...options, edge: 'gaussian' }).alpha);
  const at = (frame, y) => frame.alpha[y * frame.w + 64];
  assert.ok(Math.abs(at(beta, 38) - at(gaussian, 38)) <= 2);
  assert.ok(at(gaussian, 50) > 0);
  assert.equal(at(beta, 50), 0);
  assert.ok(beta.alpha.some(value => value > 0 && value < 128));

  const hard = profileFrame({ width: .44, edge: 'hard' });
  assert.equal(at(hard, 38), 255);
  assert.ok(hard.alpha.every(value => value === 0 || value === 255));
  const B = kit.makeBuilder(1, palette);
  assert.throws(() => C.draw(B, straight, { edge: 'sharp' }), /gaussian, beta or hard/);
  assert.equal(B.count(), 0);
});

test('compact and half-opacity hard sections keep their coverage through subdivisions', () => {
  const pieces = Array.from({ length: 32 }, (_, i) => K.V.lerp(straight[0], straight[1], i / 31));
  const raster = (source, settings, ortho) => ink.render(C.world(scene([{ source, ...settings }])),
    { ...imageOptions, ortho, transparent: true });
  for (const section of ['round', 'elliptical', 'flattened']) for (const edge of ['beta', 'hard']) {
    const style = { section, edge, width: .4, opacity: .5, twist: .31 };
    for (const ortho of [false, true]) {
      const a = raster(straight, style, ortho), b = raster(pieces, style, ortho);
      assert.ok(a.alpha.some(value => value > 12));
      assert.ok(a.alpha.every((value, i) => Math.abs(value - b.alpha[i]) <= 1), section + '/' + edge);
      if (edge === 'hard') assert.ok(b.alpha.every(v => v === 0 || v === 128));
    }
  }
  const view = { ...imageOptions, yaw: Math.PI / 2, transparent: true, ortho: true };
  const endOn = source => ink.render(C.world(scene([{ source, width: .3, edge: 'beta', opacity: .45 }])), view);
  const a = endOn(straight), b = endOn(pieces);
  assert.ok(a.alpha.some(value => value > 128));
  assert.ok(a.alpha.every((value, i) => Math.abs(value - b.alpha[i]) <= 1));
});

test('hard strand groups stay distinct when native worlds with the same local IDs are joined', () => {
  const make = z => {
    const B = kit.makeBuilder(1, palette);
    C.draw(B, straight.map(([x, y]) => [x, y, z]), { edge: 'hard', width: .4, opacity: .5, object: 'cord' });
    return host(B);
  };
  const front = make(.3), back = make(-.3);
  const world = K.procedural.splatProvenance.join([front, back], front);
  const opts = { ...imageOptions, ortho: true, transparent: true };
  const single = ink.render(front, opts), combined = ink.render(world, opts);
  assert.equal(single.alpha[38 * single.w + 64], 128);
  assert.equal(combined.alpha[38 * combined.w + 64], 191);
});

test('rounded, blunt, tapered and fading caps control each end independently', () => {
  const base = profileFrame({ width: .4 }), rounded = profileFrame({ width: .4, caps: 'rounded' });
  const blunt = profileFrame({ width: .4, caps: { start: 'blunt', end: 'rounded' } });
  assert.deepEqual(base.alpha, rounded.alpha);
  const at = (frame, x, y = 38) => frame.alpha[y * frame.w + x];
  assert.ok(at(rounded, 21) > 15);
  assert.equal(at(blunt, 21), 0);
  assert.equal(at(blunt, 106), at(rounded, 106));
  assert.equal(at(blunt, 64), at(rounded, 64));
  const start = type => profileFrame({ width: .4, caps: { start: { type, length: .38 } } });
  const tapered = start('tapered'), fading = start('fading');
  assert.ok(band(tapered, 35) < band(base, 35) / 2);
  assert.ok(at(tapered, 35) > at(fading, 35) + 70);
  assert.equal(at(fading, 64), at(base, 64));
  assert.equal(at(tapered, 106), at(base, 106));

  const B = kit.makeBuilder(1, palette);
  assert.throws(() => C.draw(B, straight, { caps: { end: 'square' } }), /invalid cap/);
  assert.throws(() => C.draw(B, straight, { joins: [{ type: 'pool', at: 1.1 }] }), /invalid join/);
  assert.equal(B.count(), 0);
});

test('blunt caps survive straight subdivision and native assembly in both projections', () => {
  const pieces = Array.from({ length: 39 }, (_, i) => K.V.lerp(straight[0], straight[1], i / 38));
  for (const edge of ['gaussian', 'beta', 'hard']) {
    const make = points => C.world(scene([source(points, { caps: 'blunt', width: .31, edge, opacity: .57 })]));
    for (const ortho of [false, true]) {
      const options = { ...imageOptions, ortho, yaw: .67, transparent: true };
      const world = make(pieces), a = ink.render(make(straight), options), b = ink.render(world, options);
      assert.ok(a.alpha.every((value, i) => Math.abs(value - b.alpha[i]) <= 1), edge + '/' + ortho);
      const native = K.procedural.splatProvenance;
      const subset = native.subset(world, Array.from({ length: world.count }, (_, i) => world.count - 1 - i));
      assert.deepEqual(ink.render(native.join([subset], world), options).alpha, b.alpha);
    }
  }
});

test('small breaks stay open even with soft edges and pools change only a local part of the strand', () => {
  for (const edge of ['gaussian', 'beta', 'hard']) {
    const gap = profileFrame({ width: .4, edge, joins: [{ at: .5, type: 'break', length: .04 }] });
    assert.equal(gap.alpha[38 * gap.w + 64], 0);
    assert.ok(gap.alpha[38 * gap.w + 58] > 80);
    assert.ok(gap.alpha[38 * gap.w + 69] > 80);
  }
  const base = profileFrame({ width: .4, opacity: .35 });
  const pool = profileFrame({ width: .4, opacity: .35,
    joins: [{ at: .5, type: 'pool', length: .18, strength: 2, spread: .4, color: '#63d5be' }] });
  assert.ok(band(pool, 64) > band(base, 64) * 1.7);
  assert.ok(Math.abs(band(pool, 35) - band(base, 35)) < .03);
  const tint = at(pool, 64, 38);
  assert.ok(tint[1] > tint[0]);

  const loop = { kind: 'path', closed: true, points: [[0,1,0],[2,1,0],[2,-1,0],[-2,-1,0],[-2,1,0]] };
  const renderLoop = joins => ink.render(C.world(scene([{ source: loop, width: .25, joins }])),
    { ...imageOptions, ortho: true, transparent: true });
  const closed = renderLoop([]), opened = renderLoop([{ type: 'break', at: 0, length: .06 }]);
  assert.ok(closed.alpha[19 * closed.w + 64] > 180);
  assert.equal(opened.alpha[19 * opened.w + 64], 0);
});

test('distance material keys resolve scene roles, tint pigment, and control coverage independently', () => {
  const input = {
    ...scene([{ source: [[-2, 0, 0], [-1.75, 0, 0], [2, 0, 0]], width: .38, edge: 'hard',
      along: { paletteRole: [[0, 'wire.shadow'], [.5, 'wire.highlight']],
        pigment: '#ff80ff', opacity: { keys: [[0, 1], [.5, .5]], interpolation: 'step' } } }]),
    palette: ['#b75a38', '#b75a38', '#80cc80'], paletteRoles: { wire: [1, 3] }
  };
  const world = C.world(input), frame = ink.render(world, { ...imageOptions, ortho: true, transparent: true });
  assert.equal(world.count, 3);
  assert.equal(world.pal.length, 4);
  assert.deepEqual(at(frame, 42, 38), [183, 45, 56]);
  assert.deepEqual(at(frame, 86, 38), [128, 102, 128]);
  assert.equal(frame.alpha[38 * frame.w + 42], 255);
  assert.equal(frame.alpha[38 * frame.w + 86], 128);
  assert.equal(world.curveSplatSource, input);

  const B = kit.makeBuilder(1, palette);
  assert.throws(() => C.draw(B, straight, { along: { paletteRole: 'undefined' } }), /Unknown or empty palette role/);
  assert.throws(() => C.draw(B, straight, { along: { roughness: ({ u }) => u < .5 ? .3 : 1.5 } }), /roughness/);
  assert.equal(B.count(), 0);
  C.draw(B, straight, { width: .4, edge: 'hard', along: { pigment: { samples: ['#ff0000', '#0000ff'] } } });
  const blend = ink.render(host(B), { ...imageOptions, ortho: true });
  const [red, green, blue] = at(blend, 64, 38);
  assert.ok(Math.abs(red - blue) < 12 && green === 0);
});

test('strand roughness moves a highlight without changing coverage and emission has its own pass', () => {
  const recipe = {
    ...scene([{ source: straight, edge: 'hard', width: .62, color: '#58261e',
      along: {
        roughness: { keys: [[0, .08], [.5, .82]], interpolation: 'step' },
        emission: { keys: [[0, 0], [.62, .6]], interpolation: 'step' }, emissionColor: '#2080ff'
      } }]),
    liveSun: { direction: [0, .55, 1], intensity: .8, shadows: false }
  };
  const world = C.world(recipe);
  const opts = { ...imageOptions, ortho: true, transparent: true, passes: ['emission'] };
  const lit = ink.render(world, opts), unlit = ink.render(world, { ...opts, liveSun: { intensity: 0 } });
  assert.deepEqual(lit.alpha, unlit.alpha);
  assert.deepEqual(lit.passes.emission, unlit.passes.emission);
  const peak = x => Math.max(...Array.from({ length: lit.h }, (_, y) => at(lit, x, y)[0] - at(unlit, x, y)[0]));
  assert.ok(peak(43) > peak(88) * 1.5);
  const band = x => Array.from({ length: lit.h }, (_, y) => at(lit, x, y)[0] - at(unlit, x, y)[0])
    .filter(value => value > 4).length;
  assert.ok(band(88) > band(43));
  const e = x => [...lit.passes.emission.slice((38 * lit.w + x) * 3, (38 * lit.w + x) * 3 + 3)];
  assert.deepEqual(e(43), [0, 0, 0]);
  assert.ok(e(88)[0] < .10 && e(88)[1] > .29 && e(88)[2] > .58);
  assert.notDeepEqual(ink.render(world, { ...opts, pitch: .35 }).rgb, lit.rgb);

  const B = kit.makeBuilder(1, world.pal);
  B.disc(0, -1, 0, [0, 0, 1], .1, .02, B.P[0], 1);
  const plain = host(B);
  const joined = kit.SplatProvenance.join([plain, world], { cam: camera, fog: world.fog, liveSun: recipe.liveSun });
  assert.deepEqual([...joined.curveMaterials.slice(0, 4)], [0, 0, 0, 0]);
  assert.deepEqual(joined.curveMaterials.slice(4), world.curveMaterials);
  assert.ok(ink.render(joined, opts).passes.emission.some(value => value > .58));
});

test('textile worlds can paint with named palette roles and the yarn sample context', () => {
  const yarn = K.textile.weave({ size: [3, 2], columns: 4, rows: 3, radius: .06, clearance: .02 });
  const world = K.textile.world(yarn, {
    pal: palette, paletteRoles: { amber: [1], green: [2] },
    appearance: { renderer: 'curve-splats', curveProfile: { profileSamples: 24,
      along: { paletteRole: ({ u, distance, family, uv }) => {
        assert.ok(uv.length === 2 && distance > 0);
        return (family === 'warp') === (u < .5) ? 'amber' : 'green';
      } } } }
  });
  const frame = ink.render(world, imageOptions);
  let green = 0, amber = 0;
  for (let i = 0; i < frame.rgb.length; i += 3) {
    if (frame.rgb[i] > 150 && frame.rgb[i + 1] < frame.rgb[i]) amber++;
    if (frame.rgb[i + 1] > 150 && frame.rgb[i] < frame.rgb[i + 1]) green++;
  }
  assert.ok(green > 20 && amber > 20);
});

test('strand sheen and specular independently follow the posed tangent without changing coverage', () => {
  const vertical = straight.map(([x, y, z]) => [y, x, z]);
  const view = { ...imageOptions, w: 129, h: 77, ortho: true, transparent: true };
  const draw = (path, lighting) => ink.render(C.world({
    ...scene([{ source: path, edge: 'hard', radius: .54, color: '#47292c', lighting }]),
    liveSun: { direction: [.8, 0, 1], intensity: 1, shadows: false }
  }), view);
  const direct = { roughness: .1, diffuse: 0, anisotropy: 1, sheen: 0, specular: .75, transmission: 0 };
  const across = draw(vertical, direct), along = draw(straight, direct);
  const off = draw(straight, false), iso = { ...direct, anisotropy: 0 };
  const center = image => at(image, 64, 38)[0];
  assert.deepEqual(along.alpha, off.alpha);
  assert.ok(center(across) > center(along) + 35);
  assert.equal(center(draw(vertical, iso)), center(draw(straight, iso)));
  assert.equal(center(draw(vertical.slice().reverse(), direct)), center(across));

  const sheenOnly = { ...direct, specular: 0, sheen: .8 };
  const fibreAcross = draw(vertical, sheenOnly), fibreAlong = draw(straight, sheenOnly);
  assert.ok(center(fibreAcross) > center(off) + 20);
  assert.ok(center(fibreAcross) > center(fibreAlong) + 12);
});

test('backlit strands scatter directional light through the soft edge without contributing to emission', () => {
  const source = { kind: 'path', points: straight };
  const style = { source, edge: 'beta', radius: .27, color: '#444455',
    lighting: { preset: 'backlit-fibre', diffuse: 0, sheen: 0, specular: 0, transmissionColor: '#ffa24c' } };
  const view = { ...imageOptions, transparent: true, passes: ['emission'] };
  const sun = direction => ({ direction, intensity: 1, shadows: false });
  const world = C.world({ ...scene([style]), liveSun: sun([0, 0, 1]) });
  for (const ortho of [true, false]) {
    const front = ink.render(world, { ...view, ortho });
    const back = ink.render(world, { ...view, ortho, liveSun: sun([0, 0, -1]) });
    assert.deepEqual(back.alpha, front.alpha);
    assert.ok(back.passes.emission.every(value => value === 0));
    for (const y of [38, 32]) {
      const delta = at(back, 64, y).map((value, i) => value - at(front, 64, y)[i]);
      assert.ok(delta[0] > 45 && delta[0] > delta[1] && delta[1] > delta[2], String(delta));
    }
  }
});

test('directional lighting presets and keyed overrides survive native joins and subsets', () => {
  const B = kit.makeBuilder(1, palette);
  assert.throws(() => C.draw(B, straight, { lighting: 'unknown' }), /unknown strand lighting preset/);
  assert.throws(() => C.draw(B, straight, { lighting: { anisotropy: 2 } }), /lighting.anisotropy/);
  assert.equal(B.count(), 0);
  assert.ok(Object.isFrozen(C.lightingPresets['metal-wire']));
  const light = { preset: 'metal-wire', diffuse: 0, sheen: 0, roughness: .7,
    specular: { keys: [[0, 0], [.5, .88]], interpolation: 'step' }, highlightColor: '#ffc060' };
  C.draw(B, straight, { edge: 'hard', width: .64, color: '#71382a', lighting: light, along: { roughness: .24 } });
  const world = host(B), plain = host(kit.makeBuilder(1, palette));
  const subset = kit.SplatProvenance.subset(kit.SplatProvenance.join([plain, world]), [1, 0]);
  assert.equal(world.curveLighting.length / world.count, 7);
  assert.ok(Math.abs(world.curveMaterials[0] - 1.24) < 1e-6);
  assert.deepEqual(subset.curveLighting.slice(0, 7), world.curveLighting.slice(7));
  const frame = ink.render({ ...world, liveSun: { direction: [0, 0, 1], shadows: false } },
    { ...imageOptions, ortho: true });
  assert.deepEqual(at(frame, 46, 38), [113, 56, 42]);
  const [red, green, blue] = at(frame, 82, 38);
  assert.ok(red > 205 && green > 110 && blue < 155);
});

test('surface strokes follow cylindrical arc length, lift and inset across a periodic seam', () => {
  const chart = K.procedural.surface.cylinder({ id: 'pot', origin: [0, -1, 0], radius: 1, height: 2 });
  const source = { kind: 'surface', id: 'signature', chart, points: [[.94, .5], [.08, .5]],
    lift: { keys: [[0, .12], [1, .22]] }, inset: .04 };
  const plan = C.surfacePath(source);
  assert.ok(plan.points.length > 5);
  assert.ok(Math.abs(plan.uvs.at(-1)[0] - 1.08) < 1e-12);
  assert.ok(Math.abs(Math.hypot(plan.points[0][0], plan.points[0][2]) - 1.08) < 1e-12);
  assert.ok(Math.abs(Math.hypot(plan.points.at(-1)[0], plan.points.at(-1)[2]) - 1.18) < 1e-12);
  assert.ok(plan.points.every(([x, y, z]) => y === 0 && Math.hypot(x, z) > 1));
  const B = kit.makeBuilder(1, palette);
  const drawn = C.draw(B, source, { object: 'pot', color: ({ uv }) => uv[0] < 1 ? '#f3b56b' : '#76d6ae', edge: 'hard', width: .12 });
  assert.equal(drawn.threads[0].id, 'signature');
  assert.ok(drawn.segments > 20);
  assert.ok(host(B).renderMetadata.targets.some(target => target?.surface === 'signature'));
  assert.throws(() => C.draw(B, { ...source, points: [[0, .5], [1, 1.02]] }), /open chart axes/);
  assert.equal(B.count(), drawn.end);
});

test('surface strokes respect lifted orientation across a Möbius join', () => {
  const chart = K.procedural.surface.mobius({ id: 'ribbon', radius: 1.2 });
  const path = C.surfacePath({ chart, points: [[.95, .24], [.05, .76]], lift: .06 });
  assert.ok(Math.abs(path.uvs.at(-1)[0] - 1.05) < 1e-12);
  assert.ok(Math.abs(path.uvs.at(-1)[1] - .24) < 1e-12);
  assert.ok(path.normals.every((normal, i) => !i || K.V.dot(normal, path.normals[i - 1]) > .98));
  const loop = { chart, coordinates: 'lifted', points: [[0, .5], [1, .5]], closed: true };
  const closed = C.surfacePath(loop);
  assert.deepEqual(closed.points[0], closed.points.at(-1));
  assert.throws(() => C.surfacePath({ ...loop, lift: .05 }), /same offset and side/);
});

test('surface groove removes actual sculpt depth using the same editable chart path', () => {
  const chart = { kind: 'plane', origin: [-1, -1, 0], u: [2, 0, 0], v: [0, 2, 0] };
  const source = { kind: 'surface', chart, points: [[.12, .5], [.88, .5]], inset: .04 };
  const build = cut => {
    const B = kit.makeBuilder(1, palette), S = K.sculpt(kit.makeSculpt(B));
    const solid = S.box([0, 0, -.25], [1, 1, .25], { r: [1, 2] }, { hold: cut, res: .089, objectId: 'plate' });
    if (cut) {
      const grooved = C.carve(S, solid, [{ source, radius: .14 }]);
      assert.ok(S.psd(solid, 0, 0, -.09) < 0);
      assert.ok(S.psd(grooved, 0, 0, -.09) > 0);
      assert.ok(S.psd(grooved, 0, .35, -.09) < 0);
    }
    S.keepRenderSdf = true;
    S.bake();
    return { ...host(B), look: { sdfAssist: { epsilon: .0001 } } };
  };
  const view = { ...imageOptions, w: 81, h: 81, ortho: true, passes: ['depth'] };
  const full = ink.render(build(false), view), grooved = ink.render(build(true), view);
  const center = 40 * view.w + 40, outside = 30 * view.w + 40;
  assert.ok(grooved.passes.depth[center] - full.passes.depth[center] > .14);
  assert.ok(Math.abs(grooved.passes.depth[outside] - full.passes.depth[outside]) < .001);
});

test('standalone curve scenes share editable named surface charts', () => {
  const recipe = {
    ...scene([{ edge: 'hard', width: .16, source: { kind: 'surface', chart: 'face', points: [[.18,.3],[.45,.7],[.82,.4]] } }]),
    charts: { face: { kind: 'plane', origin: [-2,-1,0], u: [4,0,0], v: [0,2,0] } }
  };
  const world = C.world(recipe), first = ink.render(world, { ...imageOptions, transparent: true });
  assert.ok(first.alpha.some(value => value === 255));
  assert.equal(world.curveSplatSource, recipe);
  const edited = structuredClone(recipe);
  edited.charts.face.origin[1] = -.2;
  assert.notDeepEqual(ink.render(C.world(edited), { ...imageOptions, transparent: true }).alpha, first.alpha);
  edited.strands[0].source.chart = 'missing';
  assert.throws(() => C.world(edited), /unknown surface chart missing/);
});

test('native bone binding bends curve rows while retaining their widths, paint and identities', () => {
  const B = kit.makeBuilder(1, palette), source = { kind: 'path', id: 'ribbon', points: [[-2,0,0],[0,0,0],[2,0,0]] };
  B.iso(-2, 0, 0, .12, B.P[1], 1);
  const style = { object: 'actor', material: 'cord', section: 'elliptical', edge: 'hard', width: .21,
    caps: 'blunt', twist: [[0, 0], [1, .8]], along: { pigment: { keys: [[0, '#f3b56b'], [.65, '#76d6ae']], interpolation: 'step' } } };
  const binding = C.bind(B, source, C.drivers.bones([0, { bone: 0, second: 1, weight: .5 }, 1]), style);
  const world = host(B), reference = world.data.slice(), ids = Array.from({ length: world.count }, (_, i) => i);
  const tables = new Float32Array(24);
  let angle = 0;
  K.bones.bind(world, { ids, bid: new Uint16Array(ids.length), M: tables, curveBindings: [binding], pose() {
    tables.set([...K.M.id(), 0,0,0]);
    tables.set([...K.M.rot([0,0,1], angle), 0,.3,0], 12);
  } });
  assert.deepEqual([...world.anim.boned], [0]);
  world.anim.update(0, 0);
  const frame = ink.render(world, imageOptions);
  const clips = world.curveClips.slice(), row = (binding.end - 1) * 16;
  angle = Math.PI / 2;
  world.anim.update(1/60, .2);
  assert.ok(world.data[row + 1] > 2);
  assert.ok(Math.abs(world.data[row]) < .02);
  assert.notDeepEqual(world.curveClips, clips);
  for (let i = binding.first; i < binding.end; i++)
    for (const offset of [7, 12, 14, 15]) assert.equal(world.data[i * 16 + offset], reference[i * 16 + offset]);
  assert.equal(binding.threads[0].id, 'ribbon');
  assert.ok(world.renderMetadata.targets.some(target => target?.surface === 'ribbon'));
  assert.notDeepEqual(ink.render(world, imageOptions).rgb, frame.rgb);
});

test('stage sockets and world query sockets supply live curve stations', () => {
  const B = kit.makeBuilder(1, palette), rig = K.rig(B, {});
  rig.part('arm');
  const binding = C.bind(B, { kind: 'path', points: [[-1,0,0],[1,0,0]] },
    C.drivers.sockets(['fixed', { socket: 'tip', offset: [0, .3, 0] }]), { edge: 'hard' });
  const world = host(B), stage = K.stage(world);
  rig.bind(stage);
  stage.socket('fixed', [-1,0,0]);
  stage.socket('tip', [1,0,0], 'arm');
  stage.add(binding);
  rig.set('arm', K.M.rot([0,0,1],Math.PI/2), [0,0,0], [0,0,0]);
  stage.update(0, 0);
  assert.ok(Math.abs(world.data[0] + .65) < 1e-6);
  assert.ok(Math.abs(world.data[1] - .5) < 1e-6);
  const other = C.drivers.sockets([[0,0,0], { entity: 'arm', socket: 'tip', offset: [.2,0,0] }]);
  assert.deepEqual(other({ points: straight }, { query: { frame: () => ({ point: [0,1,0], rotation: K.M.id() }) } }).points[1], [.2,1,0]);
});

test('bound XPBD spans keep row slots through a tear and checkpoint restore', () => {
  const B = kit.makeBuilder(1, palette), sim = K.xpbd.sim({ gravity: [0,0,0] });
  const knots = [[-1,0,0],[0,0,0],[1,0,0]], ids = knots.map(p => sim.point(p, 0));
  const links = [sim.link(0,1), sim.link(1,2)], clean = sim.motion();
  const binding = C.bind(B, knots, C.drivers.xpbd(sim, ids, { links }), { width: .23, edge: 'hard' });
  const world = host(B), stage = K.stage(world);
  stage.add(binding);
  stage.update(0, 0);
  const initial = world.data.slice();
  sim.breakLink(1);
  sim.resetPose([-1,0,0,0,0,0,1,2,0]);
  stage.update(.01, .01);
  assert.equal(world.data[19], 0);
  assert.equal(world.count, 2);
  sim.restoreMotion(clean);
  stage.update(.01, .02);
  assert.deepEqual(world.data, initial);
});

test('cloth presents the attached UV stroke with both solver motion and an explicit review pose', () => {
  const B = kit.makeBuilder(1, palette);
  const cloth = K.cloth(B, { nu: 4, nv: 3, at: [-1,0,0], u: [2,0,0], v: [0,1,0],
    pins: () => false, gravity: [0,0,0], pattern: () => [1,2] });
  const stroke = cloth.bindStroke({ id: 'hem', points: [[0,.5],[1,.5]], lift: .04 },
    { width: .14, edge: 'hard', color: '#76d6ae' });
  const world = host(B), stage = K.stage(world);
  const offset = stroke.first * 16, before = world.data.slice(offset, offset + 16);
  const lifted = cloth.restPose().map((value, i) => i % 3 === 2 ? value + .4 : value);
  cloth.drawPose(stage, lifted);
  assert.ok(Math.abs(world.data[offset + 2] - .44) < 1e-6);
  cloth.sim.resetPose(cloth.restPose());
  stage.add(cloth);
  stage.update(0, 0);
  assert.deepEqual(world.data.slice(offset, offset + 16), before);
});

test('native hair can render stable styled curve strands from its groom solver', () => {
  const B = kit.makeBuilder(1, palette), hair = K.hair(B, {
    roots: [{ id: 'lock', p: [0,1,0], n: [1,0,0] }], segs: 5, len: .65, ramp: [1,2],
    renderer: 'curve-splats', curveProfile: { width: .18, color: '#76d6ae', edge: 'hard' }
  });
  const world = host(B), st = K.stage(world);
  st.add(hair);
  const initial = world.data.slice(), count = world.count;
  st.update(.05, 0);
  st.update(.05, .05);
  assert.equal(world.count, count);
  assert.ok(world.curveSplats);
  assert.ok(world.renderMetadata.targets.some(target => target?.surface === 'lock'));
  assert.notDeepEqual(world.data, initial);
  for (let i = 0; i < count; i++) assert.equal(world.data[i * 16 + 7], initial[i * 16 + 7]);
});

test('twisted cable spacing, length variation and stable member IDs use the seed reproducibly', () => {
  const settings = { guide: straight, style: 'twisted-cable', id: 'cord', seed: 91, count: 4,
    radius: .08, separation: .25, turns: 2, samples: 64 };
  const full = C.bundle(settings);
  assert.ok(Object.isFrozen(full.strands[0].path.points[0]));
  assert.ok(Math.abs(K.V.dist(full.strands[0].path.points[0], full.strands[1].path.points[0]) - .25) < 1e-10);
  const shortened = C.bundle({ ...settings, lengthVariation: .38 });
  assert.deepEqual(shortened, C.bundle({ ...settings, lengthVariation: .38 }));
  assert.notDeepEqual(shortened, C.bundle({ ...settings, seed: 92, lengthVariation: .38 }));
  assert.deepEqual(shortened.strands.map(strand => strand.id), ['cord:0', 'cord:1', 'cord:2', 'cord:3']);
  assert.ok(shortened.strands.every((strand, i) => strand.length < full.strands[i].length &&
    strand.length > .62 * full.strands[i].length && Math.abs(K.curve.length(strand.path.points) - strand.length) < 1e-8));
  const ring = K.curve.path(Array.from({ length: 32 }, (_, i) => [Math.cos(i * Math.PI / 16), Math.sin(i * Math.PI / 16), 0]),
    { closed: true, up: [0,0,1] });
  const loop = C.bundle({ ...settings, guide: ring, turns: undefined });
  assert.ok(loop.closed);
  assert.ok(loop.strands.every(strand => K.V.dist(strand.path.points[0], strand.path.points.at(-1)) === 0));
});

test('braid bundles reuse the over-under plan and retain IDs through standalone drawing', () => {
  const settings = { guide: straight, style: 'braid', id: 'braid', count: 3, separation: .36,
    radius: .065, word: [1, -2], repeats: 2, clearance: .012, up: [0,1,0] };
  const plan = C.bundle(settings);
  assert.equal(plan.crossings.length, 4);
  assert.equal(plan.crossings[0].over, 'braid:0');
  assert.equal(plan.crossings[1].generator, -2);
  assert.ok(K.procedural.interlace.checkClearance(plan.strands, { clearance: .012 }).ok);
  const options = { width: .12, edge: 'hard', color: '#76d6ae' };
  const direct = { source: { kind: 'bundle', ...settings }, ...options };
  const compiled = { source: JSON.parse(JSON.stringify(plan)), ...options };
  const a = C.world(scene([direct])), b = C.world(scene([compiled]));
  assert.deepEqual(a.data, b.data);
  assert.deepEqual(ink.render(a, imageOptions).rgb, ink.render(b, imageOptions).rgb);
  assert.ok(a.renderMetadata.targets.some(target => target?.surface === 'braid:2'));
});

test('clumped hair gathers within a lock and fringe roots land at the authored separation', () => {
  const hair = C.bundle({ guide: straight, style: 'clumped-hair', count: 8, clumps: 2, tightness: 1, frizz: 0, seed: 6 });
  const [a, b, c] = hair.strands;
  assert.equal(a.clump, c.clump);
  assert.notEqual(a.clump, b.clump);
  assert.ok(K.V.dist(a.path.points[0], c.path.points[0]) > .01);
  assert.ok(K.V.dist(a.path.points.at(-1), c.path.points.at(-1)) < 1e-9);
  assert.ok(K.V.dist(a.path.points.at(-1), b.path.points.at(-1)) > .12);
  const B = kit.makeBuilder(1, palette), clumps = new Set();
  C.draw(B, hair, { color: ({ clump }) => {
    clumps.add(clump);
    return clump ? '#f3b56b' : '#76d6ae';
  } });
  assert.deepEqual([...clumps], [0,1]);
  const settings = { guide: straight, style: 'frayed-hem', count: 3, separation: .6, length: .5, frizz: 0 };
  const fringe = C.bundle(settings);
  const roots = fringe.strands.map(strand => strand.path.points[0]);
  assert.ok(roots.every((root, i) => K.V.dist(root, [(i - 1) * .6, 0, 0]) < 1e-10));
  assert.ok(fringe.strands.every(strand => strand.path.points.at(-1)[1] === -.5));
  assert.throws(() => C.draw(B, { kind: 'bundle', ...settings, separation: 4 }), /root spacing/);
});

test('bundle guides can use a named surface chart and keep the world recipe editable', () => {
  const recipe = {
    ...scene([{ source: { kind: 'bundle', style: 'frayed-hem', id: 'tail', count: 5, length: .29,
      guide: { kind: 'surface', chart: 'hem', points: [[.1,.5],[.9,.5]] } }, color: '#f3b56b', edge: 'hard' }]),
    charts: { hem: { kind: 'plane', origin: [-2,-1,0], u: [4,0,0], v: [0,2,0] } }
  };
  const world = C.world(recipe);
  assert.equal(world.curveSplatSource, recipe);
  assert.notDeepEqual(C.world({ ...recipe, seed: 17 }).data, world.data);
  assert.ok(ink.render(world, { ...imageOptions, transparent: true }).alpha.some(value => value === 255));
  assert.ok(world.renderMetadata.targets.some(target => target?.surface === 'tail:4'));
});

test('timed reveal clips a directed segment exactly and supports independent start and end keys', () => {
  const style = { edge: 'hard', width: .2, color: '#f3b56b', reveal: {
    start: [[0,0],[.5,0],[1,.5]], end: [[0,0],[1,1]], width: [[0,.5],[1,1.4]]
  } };
  const view = { ...imageOptions, ortho: true, transparent: true };
  const world = C.world(scene([{ source: straight, ...style }]));
  const read = t => ink.render(world, { ...view, t });
  const alpha = (frame, x) => frame.alpha[38 * frame.w + x];
  assert.ok(read(0).alpha.every(value => value === 0));
  const early = read(.26);
  assert.ok(alpha(early, 38) > 200);
  assert.equal(alpha(early, 64), 0);
  const later = read(.85);
  assert.equal(alpha(later, 38), 0);
  assert.ok(alpha(later, 68) > 200);
  const reversed = ink.render(C.world(scene([{ source: straight.slice().reverse(), ...style }])), { ...view, t: .26 });
  assert.equal(alpha(reversed, 38), 0);
  assert.ok(alpha(reversed, 89) > 200);
  assert.deepEqual(read(.26).alpha, early.alpha);
  assert.ok(read(.85).alpha.filter(value => value > 0).length > early.alpha.filter(value => value > 0).length);
});

test('matched render modes share each sampled pose and camera at native art size', () => {
  const world = C.world(scene([source(straight.slice().reverse(), {
    edge: 'hard', section: 'elliptical', aspect: .62, width: .2,
    reveal: { end: [[0, 0], [1, 1]], width: [[0, .5], [1, 1.4]] }
  })]));
  const data = world.data.slice(), poses = [], cameraPhases = [], frames = [];
  world.look.pixelSize = 3;
  world.anim = { update(dt, time) { poses.push(time); } };
  const report = ink.compareCurveModes(world, {
    width: 101, height: 63, frame: { ortho: true, transparent: true, renderStats: true },
    from: 0, to: 1, fps: 4,
    camera(phase) { cameraPhases.push(phase); return { yaw: phase * .2 }; }
  }, frame => frames.push(frame));
  assert.deepEqual(poses, [0, .25, .5, .75]);
  assert.deepEqual(cameraPhases, [0, 1 / 3, 2 / 3, 1]);
  assert.deepEqual(world.data, data);
  assert.equal(report.frames[0].changedPixels, 0);
  assert.notDeepEqual(report.frames[0].camera.view, report.frames[3].camera.view);
  for (const mode of report.modes) {
    assert.ok(frames[0][mode].alpha.every(value => value === 0));
    const early = frames[1][mode];
    assert.deepEqual([early.w, early.h], [101, 63]);
    assert.equal(early.alpha[31 * 101 + 50], 0);
    assert.ok(early.alpha.subarray(31 * 101 + 51, 32 * 101).some(value => value > 64));
  }
  assert.equal(frames[1].splats.renderStats.curveSegments, 0);
  assert.ok(frames[1].curves.renderStats.curveSegments > 0);
  assert.ok(report.frames[1].changedPixels > 0);
  assert.ok(ink.render(world, { ...imageOptions, t: 0, transparent: true, curveSplats: false }).alpha.some(Boolean));
});

test('curve compare CLI writes both modes without resampling the individual PNGs', () => {
  const root = path.resolve(__dirname, '..'), cli = path.join(root, 'cli', 'ink-studio.js');
  const target = path.join(root, 'examples', 'curve-splat-scene.json');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-curve-modes-'));
  try {
    const run = (...args) => {
      const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    };
    run('compare', target, '--curve-modes', '--w', '81', '--h', '49', '--raw',
      '--from', '0', '--to', '1', '--fps', '2', '--out', folder);
    const report = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json')));
    assert.equal(report.frames.length, 2);
    assert.equal(report.frames[1].time, .5);
    assert.ok(fs.readFileSync(path.join(folder, report.preview)).includes(Buffer.from('acTL')));
    for (const mode of report.modes) {
      const single = path.join(folder, mode + '-single.png');
      run('render', target, '--curve-mode', mode, '--w', '81', '--h', '49', '--px', '1', '--raw', '--t', '.5', '--out', single);
      const image = PNG.read(path.join(folder, report.frames[1].files[mode]));
      assert.deepEqual([image.w, image.h], [81, 49]);
      assert.deepEqual(image, PNG.read(single));
    }
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('timestamped trails clip the birth front and expiry tail and vary width and opacity by age', () => {
  const source = { kind: 'trail', samples: [{ time: 0, point: straight[0] }, { time: 2, point: straight[1] }] };
  const view = { ...imageOptions, ortho: true, transparent: true };
  const make = trail => C.world(scene([{ source, edge: 'hard', width: .32, trail }]));
  const flat = make({ lifetime: .7, fade: 1 });
  const faded = make({ lifetime: .7, width: [[0,1],[1,.25]], fade: [[0,1],[1,0]] });
  assert.ok(ink.render(faded, { ...view, t: 0 }).alpha.every(value => value === 0));
  assert.ok(ink.render(faded, { ...view, t: 2.72 }).alpha.every(value => value === 0));
  const age = ink.render(faded, { ...view, t: 1.22 }), solid = ink.render(flat, { ...view, t: 1.22 });
  const mid = x => age.alpha[38 * age.w + x];
  assert.equal(mid(37), 0);
  assert.equal(mid(82), 0);
  assert.ok(mid(67) > mid(53) + 50);
  assert.ok(solid.alpha.filter(value => value > 0).length > age.alpha.filter(value => value > 0).length);

  const restart = { kind: 'trail', samples: [
    { time: .1, point: [-2,0,0] }, { time: .3, point: [-1.2,0,0] }, null,
    { time: .45, point: [1.2,0,0] }, { time: .65, point: [2,0,0] }
  ] };
  const both = ink.render(C.world(scene([{ source: restart, edge: 'hard', trail: { lifetime: 1, fade: 1 }, width: .17 }])),
    { ...view, t: .7 });
  assert.ok(both.alpha.some(value => value > 0));
  assert.equal(both.alpha[38 * both.w + 64], 0);
  const B = kit.makeBuilder(1, palette);
  assert.throws(() => C.draw(B, { kind: 'trail', samples: [{time: 0, point: straight[0]}, {time: 0, point: straight[1]}] },
    { trail: true }), /increasing timestamps/);
  assert.equal(B.count(), 0);
});

test('timed paths retain distinct clocks through assembly and use the posed forward direction', () => {
  const build = (y, reveal) => {
    const B = kit.makeBuilder(1, palette);
    C.draw(B, straight.map(([x]) => [x,y,0]), { width: .22, edge: 'hard', reveal });
    return host(B);
  };
  const first = build(.5, { end: [[0,0],[1,1]] }), second = build(-.5, { end: [[0,0],[2,1]] });
  const meta = { cam: camera, fog: first.fog }, joined = kit.SplatProvenance.join([first,second], meta);
  assert.equal(joined.curveTiming[0], 1);
  assert.equal(joined.curveTiming[8], 2);
  assert.equal(joined.curveTimePrograms.length, 2);
  const subset = kit.SplatProvenance.subset(joined, [1]);
  const view = { ...imageOptions, ortho: true, transparent: true, t: .8 };
  assert.deepEqual(ink.render(subset, view).alpha, ink.render(second, view).alpha);

  const B = kit.makeBuilder(1, palette);
  const move = C.bind(B, straight, rest => rest.points.map(([x,y,z]) => [-x,y,z]),
    { edge: 'hard', width: .22, reveal: { end: .28 } });
  const posed = host(B);
  move.pose(posed);
  const frame = ink.render(posed, view);
  assert.ok(frame.alpha[38 * frame.w + 90] > 200);
  assert.equal(frame.alpha[38 * frame.w + 38], 0);
});
