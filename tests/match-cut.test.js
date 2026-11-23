const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { findMatchCuts } = require('..');

const width = 100, height = 64;
const disc = { id: 'disc', outgoing: { object: 'lens', material: 'glass' }, incoming: { object: 'moon' } };
const options = { width, height, fps: 12, motionFrames: 4, previewFrames: 4, separationFrames: 0, limit: 12, matches: [disc] };

function plate(x, { incoming = false, y = 22, size = 10, hidden = false, guide = 61 } = {}) {
  const objectId = new Uint32Array(width * height), materialId = new Uint32Array(width * height);
  const objects = incoming ? [null, 'marker', 'moon'] : [null, 'lens', 'marker'];
  function paint(left, top, size, owner, material) {
    for (let row = top; row < top + size; row++) for (let col = left; col < left + size; col++) {
      objectId[row * width + col] = owner;
      materialId[row * width + col] = material;
    }
  }
  if (!incoming) paint(6, 47, 6, 1, 2); // Same object, excluded by the glass material selector.
  if (!hidden) paint(x, y, size, incoming ? 2 : 1, 1);
  if (guide !== null) paint(guide, 40, 5, incoming ? 1 : 2, 2);
  return { w: width, h: height, passes: { w: width, h: height, objectId, materialId, objects, materials: [null, 'glass', 'metal'] } };
}

test('a same-heading match beats a position-identical pass in the opposite direction', () => {
  const departing = [20, 24, 28, 32].map(x => plate(x));
  const arriving = [32, 28, 24, 24, 28, 32, 36, 40, 44].map(x => plate(x, { incoming: true }));
  const cuts = findMatchCuts(departing, arriving, { ...options, outgoingStart: 80, incomingStart: 16 });
  assert.equal(cuts.comparedPairs, 6);
  const best = cuts.candidates[0];
  assert.deepEqual([best.outgoing.frame, best.incoming.frame], [83, 21]);
  assert.equal(best.incoming.time, 21 / 12);
  assert.equal(best.score, 100);
  assert.deepEqual(best.preview, { outgoing: [80, 84], incoming: [21, 25] });
  assert.deepEqual(best.shapes[0].outgoing.box, [32, 22, 42, 32]);
  assert.deepEqual(best.shapes[0].incoming.velocity, [4, 0]);
  const opposite = cuts.candidates.find(cut => cut.incoming.frame === 16);
  assert.equal(opposite.shapes[0].positionPixels, 0);
  assert.equal(opposite.shapes[0].headingDegrees, 180);
  assert(opposite.score < 25);
});

test('size, position and weighted secondary shapes affect shortlist order', () => {
  const marker = { id: 'marker', weight: 3, outgoing: { object: 'marker' }, incoming: { object: 'marker' } };
  const a = [0, 0, 0, 0].map(() => plate(30));
  const b = [
    ...[0, 0, 0, 0].map(() => plate(27, { incoming: true, y: 19, size: 16, guide: 77 })),
    ...[0, 0, 0, 0].map(() => plate(31, { incoming: true, guide: 61 }))
  ];
  const cuts = findMatchCuts(a, b, { ...options, matches: [disc, marker] });
  const { shapes } = cuts.candidates[0];
  assert.equal(cuts.candidates[0].incoming.frame, 4);
  assert.equal(shapes[0].sizeDeltaPercent, 0);
  assert.equal(shapes[0].positionPixels, 1);
  assert.equal(shapes[1].positionPixels, 0);
  const larger = cuts.candidates.find(cut => cut.incoming.frame === 0).shapes[0];
  assert.equal(larger.positionPixels, 0);
  assert.equal(larger.sizeDeltaPercent, 60);
  assert.deepEqual(larger.moving, [false, false]);
  assert.equal(larger.headingDegrees, null);
});

test('shot edges, hidden subjects and a shortened preview use only verified source frames', () => {
  const a = [plate(0), plate(20), plate(22), plate(24), plate(26, { hidden: true }), plate(30)];
  const b = [plate(22, { incoming: true }), plate(24, { incoming: true }), plate(26, { incoming: true })];
  const result = findMatchCuts(a, b, { ...options, motionFrames: 3, previewFrames: 5 });
  assert.equal(result.outgoing.unmeasurable, 3);
  assert.equal(result.comparedPairs, 1);
  assert.deepEqual(result.candidates[0].preview, { outgoing: [0, 4], incoming: [0, 3] });
  const none = findMatchCuts(a, b, { ...options, motionFrames: 3,
    matches: [{ ...disc, incoming: { object: 'unknown' } }] });
  assert.equal(none.incoming.unmeasurable, 1);
  assert.deepEqual(none.candidates, []);
  assert.throws(() => findMatchCuts(a, b, options), /Each shot handle needs 4/);
});

test('tied cuts are reproducible and the shortlist skips nearby pairs', () => {
  const a = Array.from({ length: 8 }, () => plate(20));
  const b = Array.from({ length: 8 }, () => plate(20, { incoming: true }));
  const result = findMatchCuts(a, b, { ...options, limit: 3, separationFrames: 3 });
  assert.deepEqual(result.candidates.map(cut => [cut.outgoing.frame, cut.incoming.frame, cut.score]),
    [[3, 0, 100], [3, 3, 100], [6, 0, 100]]);
  assert.deepEqual(findMatchCuts(a, b, { ...options, limit: 3, separationFrames: 3 }), result);
});

function chunks(png, type) {
  const found = [];
  for (let i = 8; i < png.length;) {
    const length = png.readUInt32BE(i);
    if (png.toString('ascii', i + 4, i + 8) === type) found.push(png.subarray(i + 8, i + 8 + length));
    i += 12 + length;
  }
  return found;
}

test('shot match-cut exports ranked at-speed previews with the exact seam and matching standalone review', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-match-cut-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const scene = path.resolve(__dirname, '../examples/match-cut/relay-to-moon.js');
  const fixture = require('../examples/match-cut/relay-to-moon.json');
  const plan = { ...fixture, title: 'Relay </script>', width: 104, height: 60, fps: 8, previewFrames: 4, limit: 2, separationFrames: 1,
    outgoing: { ...fixture.outgoing, scene, fromFrame: 2, toFrame: 10 },
    incoming: { ...fixture.incoming, scene, fromFrame: 4, toFrame: 12 } };
  const input = path.join(directory, 'plan.json');
  fs.writeFileSync(input, JSON.stringify(plan));
  const stdout = execFileSync(process.execPath, [cli, 'shot', 'match-cut', input, '--out', directory], { encoding: 'utf8' });
  const read = name => fs.readFileSync(path.join(directory, name));
  const report = JSON.parse(read('cuts.json'));
  const html = read('index.html').toString();
  const data = JSON.parse(html.match(/id="match-cut-data">(.*)<\/script>/)[1]);
  assert.deepEqual(data.report, report);
  assert.match(stdout, /shortlisted 2 cuts/);
  assert.equal(report.comparedPairs, 25);
  assert.equal(report.candidates.length, 2);
  for (const cut of report.candidates) {
    const bytes = read(cut.file), controls = chunks(bytes, 'fcTL');
    const expected = ['outgoing', 'incoming'].flatMap((side, i) => {
      const [from, to] = cut.preview[side];
      return Array.from({ length: to - from }, (_, j) => {
        const png = Buffer.from(data.pictures[i][from + j].split(',')[1], 'base64');
        return chunks(png, 'IDAT')[0];
      });
    });
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [plan.width, plan.height]);
    assert.equal(chunks(bytes, 'acTL')[0].readUInt32BE(0), expected.length);
    assert(controls.every(control => control.readUInt16BE(20) === 1 && control.readUInt16BE(22) === plan.fps));
    assert.deepEqual([chunks(bytes, 'IDAT')[0], ...chunks(bytes, 'fdAT').map(frame => frame.subarray(4))], expected);
    assert.equal(cut.preview.outgoing[1] - 1, cut.outgoing.frame);
    assert.equal(cut.preview.incoming[0], cut.incoming.frame);
  }
});
