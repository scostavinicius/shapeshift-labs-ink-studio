// Renders a scene from a ring of camera angles at every frame of its animation, so a page can turn it under the mouse
// while it keeps moving. One sheet per frame (every angle on it, at the renderer's own pixel size), split over several processes.
//   node showcase/spin-anim.js [scene.js] [--n 60] [--from 1.5] [--secs 7] [--fps 12] [--pitch 0.3] [--jobs 4] [--out studio/out/spin-anim]
const fs = require('fs'),
  path = require('path'),
  os = require('os'),
  { spawn } = require('child_process');

const args = process.argv.slice(2),
  opt = {},
  pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i];
  else pos.push(args[i]);
}
const file = path.resolve(pos[0] || path.join(__dirname, 'farol.js')),
  n = +(opt.n || 60),
  from = +(opt.from || 1.5),
  fps = +(opt.fps || 12),
  frames = Math.round(+(opt.secs || 7) * fps),
  pitch = +(opt.pitch || 0.3),
  cols = 10,
  out = path.resolve(opt.out || 'studio/out/spin-anim');

if (opt.part === undefined) {
  // the parent: hand frames out to workers, then write the description the page reads
  const jobs = +(opt.jobs || Math.max(1, Math.min(6, os.cpus().length - 1)));
  fs.mkdirSync(out, { recursive: true });
  const t0 = Date.now();
  let left = jobs;
  for (let k = 0; k < jobs; k++) {
    const child = spawn(process.execPath, [__filename, ...args, '--part', String(k), '--jobs', String(jobs)], { stdio: 'inherit' });
    child.on('exit', code => {
      if (code) process.exitCode = code;
      if (--left) return;
      const meta = { n, frames, fps, cols, pitch, from };
      fs.writeFileSync(path.join(out, 'spin.json'), JSON.stringify(meta));
      fs.writeFileSync(path.join(out, 'spin.js'), 'window.SPIN = ' + JSON.stringify(meta) + ';\n');
      console.log(`${n * frames} views (${n} angles x ${frames} frames) in ${out}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    });
  }
} else {
  // a worker: run the world forward from the start, and draw every angle at each frame that is its own
  const R = require('../cli/render.js'),
    PNG = require('../cli/png.js'),
    part = +opt.part,
    jobs = +opt.jobs,
    kit = require('../index.js').load(),
    scene = require(file)(kit),
    w = scene.build(scene.seed);
  let clock = 0;
  if (w.anim) w.anim.update(0, 0);
  for (let f = part; f < frames; f += jobs) {
    const t = from + f / fps;
    if (w.anim)
      while (clock < t - 1e-9) {
        const dt = Math.min(1 / 60, t - clock);
        clock += dt;
        w.anim.update(dt, clock);
      }
    const imgs = [];
    for (let i = 0; i < n; i++) imgs.push(R.render(w, { t, yaw: w.cam.yaw + (i / n) * Math.PI * 2, pitch, w: 900, h: 620 }));
    const sheet = R.grid(imgs, cols);
    PNG.write(path.join(out, `f${f}.png`), sheet.w, sheet.h, sheet.rgb);
    if (part === 0) console.log(`frame ${f + 1}/${frames}`);
  }
}
