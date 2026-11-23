const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const ink = require('..'), kit = ink.load(), C = kit.KIT.curveSplats;

const view = { w: 97, h: 65, px: 1, raw: true, transparent: true, ortho: true };
const at = [48, 32], p = at[1] * view.w + at[0];
const camera = { target: [0, 0, 0], dist: 6, yaw: 0, pitch: 0 };
const pathSource = (id, points) => ({ kind: 'path', id, points });
const scene = strands => C.world({ format: C.format, version: 1, id: 'strand-pass-test', camera, strands });
const close = (a, b, epsilon = 1e-5) => assert.ok(Math.abs(a - b) < epsilon, String(a) + ' differs from ' + b);

test('strand passes follow the resolved layers and report the authored direction and station of both hits', () => {
  const back = { source:pathSource('Cable', [[-2,0,-.6],[2,0,-.6]]), width:.2, edge:'hard', opacity:.8 };
  const front = { source:pathSource('Ribbon', [[0,2,.6],[0,-2,.6]]), width:.2, edge:'hard', opacity:.5 };
  const world = scene([back, front]);
  const frame = ink.render(world, { ...view, passes:['strands'], strandPixel:at, edgeFilter:true });
  const { passes, strandPixel } = frame, [nearest, farther] = strandPixel.contributors;
  assert.deepEqual(strandPixel.contributors.map(hit => hit.strand.name), ['Ribbon', 'Cable']);
  assert.equal(passes.strandId[p], 2);
  close(passes.strandCoverage[p], .9);
  close(strandPixel.coverage, .9);
  close(nearest.visibleCoverage, .5);
  close(farther.visibleCoverage, .4);
  close(passes.strandU[p], .5);
  close(nearest.distance, 2);
  close(passes.strandDepth[p], nearest.depth);
  assert.ok(nearest.depth < farther.depth);
  [0,-1,0].forEach((value,k) => close(passes.strandTangent[p * 3 + k],value));
  assert.deepEqual(frame.rgb, ink.render(world, { ...view, edgeFilter:true }).rgb);
  assert.equal(passes.strandMotionValid[p], 0);
  const withOpaque = ink.render(scene([back, { ...front, opacity:1 }]), { ...view, strandPixel:at });
  assert.deepEqual(withOpaque.strandPixel.contributors.map(hit=>hit.strand.name), ['Ribbon']);
  const graph = ink.graphRenderPass(frame, 'strandTangent');
  assert.equal(graph.valid.data[p], 255);
  assert.equal(graph.valid.data[0], 0);
});

test('joined strands keep separate IDs and path distances survive a splat subset and clipped reveal', () => {
  const path = x => ({ source:pathSource('Same label', [[x,1,0],[x,0,0],[x,-1,0]]), width:.13,
    edge:'hard', reveal:{ start:.5, end:.875 } });
  const a = scene([path(-.8)]), b = scene([path(.8)]);
  const provenance = kit.SplatProvenance;
  const joined = provenance.join([a,b], { cam:camera, fog:a.fog, radius:a.radius });
  const world = provenance.subset(joined, [3,1]);
  const { passes } = ink.render(world, { ...view, passes:['strandId','strandU'] });
  assert.deepEqual(passes.strands.map(strand=>strand?.name), [undefined,'Same label','Same label']);
  assert.deepEqual([...new Set(passes.strandId)].sort(), [0,1,2]);
  for (let i = 0; i < passes.strandId.length; i++) if (passes.strandId[i])
    assert.ok(passes.strandU[i] >= .5 && passes.strandU[i] <= .875);
});

test('motion follows the same authored station across a posed deformation and clears on cuts', () => {
  const builder = kit.makeBuilder(1, [0x111122,0xffcc88]);
  const binding = C.bind(builder, pathSource('Drifting', [[0,-1.4,0],[0,1.4,0]]),
    (rest, { time }) => rest.points.map(([x,y,z]) => [x + time * .4, y, z]), { edge:'hard', width:.23 });
  const world = builder.finish({ cam:camera, radius:5, fog:{c:0,start:1,max:0},dither:0 });
  const history = ink.createStrandMotionHistory();
  const sample = (time, resetStrandMotion) => {
    binding.pose(world,{time});
    return ink.render(world, {...view,t:time,passes:['strands'],strandMotionHistory:history,resetStrandMotion}).passes;
  };
  assert.ok(sample(0).strandMotionValid.every(n => n === 0));
  const next = sample(.5);
  assert.ok(next.strandMotionValid.some(n => n === 255));
  const moved = next.strandMotionValid.findIndex(n => n !== 0);
  assert.ok(next.strandMotion[moved * 2] > 1);
  close(next.strandMotion[moved * 2 + 1], 0);
  assert.ok(sample(1,true).strandMotionValid.every(n => n === 0));
  assert.ok(sample(.25).strandMotionValid.every(n => n === 0));
});

test('CLI exports exact native strand channels and inspects the same crossing', () => {
  const root = path.resolve(__dirname,'..'), cli = path.join(root,'cli','ink-studio.js');
  const out = fs.mkdtempSync(path.join(os.tmpdir(),'ink-strand-passes-'));
  const file = 'examples/strand-inspection.js', view = ['--w','176','--h','108','--px','1'];
  const run = (cmd, ...args) => {
    const result = spawnSync(process.execPath,[cli,cmd,file,...view,...args],{cwd:root,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    return result.stdout;
  };
  try {
    const pixel = JSON.parse(run('strand-pixel','--at','88,50','--previous','.33','--t','.55'));
    assert.deepEqual(pixel.contributors.map(hit=>hit.strand.name),['Jade pickup','Copper feed']);
    run('export-layers','--t','.33,.55','--strand-passes','on','--out',out);
    const manifest = JSON.parse(fs.readFileSync(path.join(out,'layers.json')));
    const frame = manifest.frames[1], { width, height, files } = frame.strandData;
    const index = pixel.y * width + pixel.x;
    assert.deepEqual([width,height],[176,108]);
    const bytes = channel => fs.readFileSync(path.join(out,files[channel].file));
    assert.equal(bytes('strandId').readUInt32LE(index * 4),pixel.contributors[0].id);
    close(bytes('strandU').readFloatLE(index * 4),pixel.contributors[0].u);
    close(bytes('strandDepth').readFloatLE(index * 4),pixel.contributors[0].depth);
    assert.equal(bytes('strandMotion').length,width * height * 8);
    assert.equal(bytes('strandMotionValid')[index],255);
    assert.ok(Math.hypot(...pixel.contributors[0].motion) > .5);
    pixel.contributors[0].motion.forEach((value, axis) => close(bytes('strandMotion').readFloatLE(index * 8 + axis * 4),value));
  } finally {
    fs.rmSync(out,{recursive:true,force:true});
  }
});
