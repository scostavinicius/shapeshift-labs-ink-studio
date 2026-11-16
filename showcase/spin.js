// Renders a scene from a full ring of camera angles (and a few heights) so a page can turn it under the mouse.
//   node showcase/spin.js [scene.js] [--n 60] [--t 3] [--pitches 0.05,0.3,0.7] [--out studio/out/spin]
// Writes y<i>_p<j>.png for every angle i and height j, plus spin.json describing them.
const fs = require('fs'),
  path = require('path'),
  R = require('../cli/render.js'),
  PNG = require('../cli/png.js');

const args = process.argv.slice(2),
  opt = {},
  pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i];
  else pos.push(args[i]);
}
const file = path.resolve(pos[0] || path.join(__dirname, 'farol.js')),
  n = +(opt.n || 60),
  t = +(opt.t || 3),
  pitches = String(opt.pitches || '0.05,0.3,0.7').split(',').map(Number),
  out = path.resolve(opt.out || 'studio/out/spin');

const kit = require('../index.js').load(),
  scene = require(file)(kit),
  w = scene.build(scene.seed);
// walk the world to time t a sixtieth of a second at a time, so the waterfall, smoke and flag have got going
if (w.anim) {
  w.anim.update(0, 0);
  for (let c = 0; c < t - 1e-9; ) {
    const dt = Math.min(1 / 60, t - c);
    c += dt;
    w.anim.update(dt, c);
  }
}
fs.mkdirSync(out, { recursive: true });
const t0 = Date.now();
for (let j = 0; j < pitches.length; j++)
  for (let i = 0; i < n; i++) {
    const yaw = w.cam.yaw + (i / n) * Math.PI * 2,
      im = R.render(w, { t, yaw, pitch: pitches[j], zoom: 1, w: 900, h: 620 }),
      big = R.upscale(im, im.px);
    PNG.write(path.join(out, `y${i}_p${j}.png`), big.w, big.h, big.rgb);
  }
fs.writeFileSync(path.join(out, 'spin.json'), JSON.stringify({ name: scene.name, n, pitches, t }));
console.log(`${n * pitches.length} views of ${scene.name} in ${out} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
