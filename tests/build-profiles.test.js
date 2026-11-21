const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const studio = require('..');
const { build } = require('../scripts/build.js');
const PNG = require('../cli/png.js');

const root = path.resolve(__dirname, '..');

test('the compact baked player samples published frames and can be mounted and disposed on its own', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-player-build-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const [{ file, rawBytes, gzipBytes }] = build('playback', directory);
  assert(rawBytes < 10_000 && gzipBytes < 4000);
  assert.deepEqual(fs.readdirSync(directory), ['ink-studio.player.mjs']);
  const source = studio.bundle({ profile: 'playback', format: 'module' });
  assert.equal(fs.readFileSync(file, 'utf8'), source);
  const { mountSceneReplay, sampleReplayFrame, validateSceneReplay } = await import(pathToFileURL(file).href);
  const frames = [0, 80, 160].map(value => PNG.encode(2, 1, Uint8Array.of(value, 0, 0, 0, value, 0)).toString('base64'));
  const recording = { format: 'ink-studio/scene-replay', version: 1, title: 'Baked relay', width: 2, height: 1,
    start: 1.25, fps: 24000 / 1001, frameRate: { numerator: 24000, denominator: 1001 }, frames };
  const framePeriod = 1001 / 24000;
  assert.deepEqual(sampleReplayFrame(recording, framePeriod), { index: 1, time: 1.25 + framePeriod, width: 2,
    height: 1, src: 'data:image/png;base64,' + frames[1] });
  assert.equal(sampleReplayFrame(recording, 3 * framePeriod, { loop: true }).index, 0);
  assert.throws(() => validateSceneReplay({ ...recording, width: 3 }), /dimensions/);
  assert.throws(() => validateSceneReplay({ ...recording, version: 2 }), /Invalid Ink Studio/);

  const image = {}, slider = new EventTarget();
  slider.setAttribute = (key, value) => { slider[key] = value; };
  const player = mountSceneReplay({ querySelector: key => ({ img: image, input: slider })[key] }, recording);
  assert.equal(image.src, 'data:image/png;base64,' + frames[0]);
  assert.deepEqual([image.width, image.height, slider.max], [2, 1, 2]);
  slider.value = '2';
  slider.dispatchEvent(new Event('input'));
  assert.equal(player.currentTime, 2 * framePeriod);
  assert.equal(image.src, 'data:image/png;base64,' + frames[2]);
  player.dispose();
  slider.dispatchEvent(new Event('input'));
  player.seek(0);
  assert.equal(image.src, 'data:image/png;base64,' + frames[2]);
});

test('the prebuilt Node entry renders from a read-only package with its authoring bundle sources absent', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-node-build-'));
  const dist = path.join(directory, 'dist');
  t.after(() => {
    fs.chmodSync(directory, 0o755);
    if (fs.existsSync(dist)) fs.chmodSync(dist, 0o755);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  for (const name of ['index.js', 'package.json', 'src', 'cli', 'scripts', 'examples']) {
    fs.cpSync(path.join(root, name), path.join(directory, name), { recursive: true,
      filter: file => file !== path.join(root, 'src', 'kit') });
  }
  const [{ file }] = build('node', dist);
  fs.chmodSync(dist, 0o555);
  fs.chmodSync(directory, 0o555);
  const probe = `
    const assert = require('node:assert/strict');
    const studio = require('./index.js');
    const kit = studio.load();
    assert.equal(kit, require('./dist/ink-studio.node.cjs'));
    assert.ok(kit.SCENES.length > 0);
    const builder = kit.makeBuilder(1, [0x141823, 0xdeac7b]);
    builder.disc(0, 0, 0, [0, 0, 1], .35, .03, builder.P[1], 3);
    const world = builder.finish({ cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 } });
    const frame = studio.render(world, { w: 24, h: 24, px: 1 });
    assert.equal(frame.rgb.length, 24 * 24 * 3);
    assert.ok(frame.drawn > 0);
  `;
  execFileSync(process.execPath, ['-e', probe], { cwd: directory,
    env: { ...process.env, INK_STUDIO_DEVELOPMENT: '0' } });
  assert.deepEqual(fs.readdirSync(dist), [path.basename(file)]);
});
