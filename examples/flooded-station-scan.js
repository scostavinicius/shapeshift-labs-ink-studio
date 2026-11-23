const ink = require('..');
const scanStart = .32, scanEnd = 3.95, scanRate = 10, length = 6.4;
const scanWidth = 29, scanHeight = 60;
const palette = [
  0x091321, 0x0c1b2c, 0x122436, 0x183144, 0x224256, 0x2c5261, 0x3b6470,
  0x1b293a, 0x28384a, 0x394e59, 0x4b6368, 0x6b7a76,
  0x241f31, 0x3d303f, 0x69454a, 0x926254, 0xc88866,
  0x102438, 0x142f47, 0x1e4053, 0x28535e, 0x3f7171, 0x66958d,
  0x143a3e, 0x317365, 0x71a898, 0xd0dbac
];

const clamp = n => Math.min(1, Math.max(0, n));
const smooth = n => n * n * (3 - 2 * n);
function emitter(time) {
  const u = clamp((time - scanStart) / (scanEnd - scanStart));
  return {
    at: [-3.05 + u * 3.2, 1.18 + .34 * u, 3.52 - .54 * u],
    target: [-4.02 + 8.24 * smooth(u), .58 + 1.84 * smooth(clamp(u * 2.6)), -2.55],
    fov: .42 + .35 * smooth(clamp(u * 3.6))
  };
}

module.exports = ({ KIT: K, SpriteSurface, makeBuilder, makeSculpt }) => ({
  id: 'flooded-station-scan', name: 'Flooded Station 09', seed: 43,
  build(seed, { controls: { returns = true, study = 'sweep' } = {} } = {}) {
    if (!['sweep', 'orbit'].includes(study) || typeof returns !== 'boolean')
      throw new TypeError('Choose sweep or orbit and pass a boolean returns setting');
    const { V } = K, B = makeBuilder(seed, palette), S = K.sculpt(makeSculpt(B));
    Object.assign(S, { pixel: true, sun: V.norm([-.52, .57, .47]), amb: .44, sky: .17, sunK: .46, shLen: 0 });
    const iron = { r: [1, 2, 3, 4, 5] }, edge = { r: [7, 8, 9, 10, 11] };
    const rust = { r: [12, 13, 14, 15, 16] }, dark = { r: [0, 1, 2, 3] };
    const water = K.reflection.material({ r: [17, 18, 19, 20, 21] }, 'concourse',
      { f0: .40, strength: .67, distortion: 1.4, blur: .18, color: '#96b5bd' });
    const box = (at, half, mat, tag, res = .13, rd = .035) => S.box(at, half, mat, { tag, res, rd });
    const tube = (points, size, mat, tag) => S.tube(points, size, size * .83, mat,
      { tag, res: Math.max(.04, size * .9) });
    const panels = SpriteSurface.make(384, 256);

    box([.05, -.30, .00], [5.28, .25, 4.18], water, 'water', .15, .026);
    box([0, .14, 4.08], [5.36, .18, .22], iron, 'near-coping', .14, .06);
    box([-5.09, .16, -.17], [.25, .20, 3.99], edge, 'retaining-edge', .15);
    box([5.15, .16, -.17], [.22, .21, 3.97], edge, 'retaining-edge', .15);
    box([0, .12, -3.63], [5.25, .25, .35], iron, 'retaining-edge', .14);
    const brick = [0x172737, 0x1a2b3b, 0x1c2e3e, 0x213546, 0x213445];
    panels.face([-5.18, .26, -3.74], [10.36, 0, 0], [0, 4.05, 0], 308, 119, (x, y) => {
      const row = Math.floor(y / 12), u = x + row % 2 * 17;
      const key = (Math.floor(u / 34) * 13 + row * 7) % brick.length;
      if (y % 12 === 0 || u % 34 === 0) return 0x101d2c;
      if (y % 12 === 1) return brick[Math.min(key + 1, brick.length - 1)];
      return brick[key];
    }, { id: 'underground-brick' });
    box([0, 4.25, -3.67], [5.35, .16, .24], iron, 'lintel', .14);
    box([0, 4.09, -3.43], [5.37, .052, .069], edge, 'lintel', .11);
    for (const x of [-4.85, -.43, 4.85]) {
      box([x, 2.07, -3.45], [.21, 1.94, .34], iron, 'piers', .15, .05);
      box([x, 3.83, -3.38], [.28, .13, .32], edge, 'piers', .12);
      box([x, .53, -3.38], [.29, .18, .31], dark, 'piers', .12);
    }

    const arch = (radius, z) => Array.from({ length: 37 }, (_, i) => {
      const a = i * Math.PI / 36;
      return [-2.65 + radius * Math.cos(a), 1.58 + radius * Math.sin(a), z];
    });
    box([-2.65, 1.15, -3.47], [1.38, .92, .15], dark, 'gate-recess', .14);
    S.ball([-2.65, 1.72, -3.36], [1.35, 1.12, .11], dark, { tag: 'gate-recess', res: .105 });
    for (const [radius, size, mat, z] of [[1.42, .104, edge, -3.19], [1.23, .061, iron, -3.10]]) {
      const arc = arch(radius, z);
      tube([V.add(arc[0], [0, -1.21, 0]), ...arc, V.add(arc.at(-1), [0, -1.21, 0])], size, mat, 'gate-frame');
    }
    for (let i = -5; i <= 5; i++) {
      const h = 1.45 + 1.12 * Math.sqrt(1 - (i / 6) ** 2);
      box([-2.65 + i * .18, (h + .30) / 2, -3.14], [.028, (h - .30) / 2, .032], iron, 'gate-grille', .10, .01);
    }
    box([-2.65, 1.34, -3.09], [1.16, .038, .031], iron, 'gate-grille', .098);
    box([-2.65, 3.24, -3.47], [.43, .23, .09], iron, 'station-sign', .084);
    const mark = K.procedural.drawing2d.render({ width: 48, height: 23, edges: 'hard', commands: [
      { type: 'rect', rect: [0, 0, 48, 23], fill: '#25384a' },
      { type: 'rect', rect: [0, 0, 48, 2], fill: '#536a70' },
      { type: 'text', text: '09', at: [14, 5], scale: 2, color: '#81a19b' }
    ] });
    panels.face([ -3.03, 3.07, -3.37 ], [.76, 0, 0], [0, .35, 0], 48, 23,
      (x,y) => { const k = (y * 48 + x) * 4; return mark.data[k] * 65536 + mark.data[k + 1] * 256 + mark.data[k + 2]; },
      { id: 'station-number' });

    // A narrow near railing stands in the way of the first returns.
    for (const x of [-4.66, -3.46, -2.26, -1.06, .14]) {
      tube([[x, -.16, 1.66], [x, 1.08, 1.66]], .058, rust, 'near-rail');
      box([x, -.04, 1.66], [.095, .08, .10], edge, 'near-rail', .067);
      box([x, 1.09, 1.66], [.074, .047, .07], { r: [14, 15, 16] }, 'near-rail', .065);
    }
    tube([[-4.79, 1.09, 1.66], [.31, 1.09, 1.66]], .069, rust, 'near-rail');
    tube([[-4.72, .58, 1.66], [.18, .58, 1.66]], .038, edge, 'near-rail');

    // Stair nosings and handrails are separate silhouettes.
    for (let i = 0; i < 11; i++) {
      const z = 1.36 - i * .367, y = -.20 + i * .229;
      box([2.01, y - .07, z], [1.34, .14, .20], i % 3 ? iron : edge, 'stairs', .10);
      box([2.01, y + .071, z + .165], [1.31, .019, .025], edge, 'stairs', .09, .008);
    }
    box([2.01, 2.08, -3.09], [1.34, .18, .76], iron, 'landing', .115);
    for (const x of [.57, 3.45]) {
      const points = [];
      for (const i of [0, 3, 6, 10]) {
        const y = -.20 + i * .229, z = 1.36 - i * .367;
        tube([[x, y, z], [x, y + .85, z]], .046, rust, 'stair-rails');
        points.push([x, y + .85, z]);
      }
      points.push([x, 2.95, -3.43]);
      tube(points, .058, edge, 'stair-rails');
    }
    box([2.15, 3.34, -3.46], [.69, .55, .16], dark, 'upper-door', .11, .055);
    for (const x of [1.47, 2.84]) box([x, 3.34, -3.24], [.048, .56, .065], rust, 'upper-door', .075);
    box([2.15, 3.91, -3.24], [.73, .062, .065], edge, 'upper-door', .082);
    for (const [x, z] of [[-.35, -2.98], [3.70, -2.96], [-4.57, -2.98]]) {
      box([x, 3.47, z], [.15, .19, .12], iron, 'service-lamps', .075);
      box([x, 3.40, z + .13], [.094, .042, .019], { r: [23, 24, 25], em: true }, 'service-lamps', .052);
    }
    for (let y = 0; y < 5; y++) {
      const z = 2.12 + y * .35;
      for (let i = 0; i < 7; i++) {
        const x = ((i * 29 + y * 13) % 59) * .165 - 4.84;
        box([x, -.027, z], [.09 + ((i * 11 + y * 9) % 7) * .053, .009, .015],
          { r: [19, 20, 21, 22] }, 'water-glints', .048, .002);
      }
    }
    S.bake();
    const surfaces = panels.finish();
    const finish = () => ({
      cam: { target: [0, 1.45, -.38], yaw: .16, pitch: .25, dist: 11.5, ortho: true, fov: .70 },
      radius: 11, detail: 25, dither: 0, spriteSurfaces: surfaces,
      look: { splatCoverage: 'continuous' }
    });
    // Snapshot the source geometry before allocating the presentation splats.
    const geometry = B.finish(finish());
    const scanner = K.pixelScanner.create({
      capacity: 8192, spacing: .109, range: [.40, 10], width: .022, density: 1.9, surfaceBias: .027,
      freshFor: .24, settleAfter: 1.1,
      fresh: ['#ffeab1', '#b1fff0', '#dfd1ff'],
      settled: ['#f7ae74', '#72e9cf', '#ae9deb'],
      old: ['#ba7968', '#3da29f', '#8271bc']
    });
    const stored = new Map();
    let last = -1, observed;
    const displayTime = t => study === 'orbit' ? scanEnd + 1.2 + Math.max(0, t) :
      t < 0 ? (t % length + length) % length : t % length;
    function sync(t) {
      const time = displayTime(t);
      const index = Math.min(Math.floor((scanEnd - scanStart) * scanRate), Math.floor((time - scanStart) * scanRate + 1e-8));
      if (index < last) { scanner.clear(); last = -1; observed = undefined; }
      if (!returns || index < 0) return;
      for (let tick = last + 1; tick <= index; tick++) {
        if (!stored.has(tick)) {
          const sample = scanStart + tick / scanRate, sensor = emitter(sample);
          const passes = ink.capturePixelScan(geometry, { ...sensor, time: sample, w: scanWidth, h: scanHeight });
          stored.set(tick, { passes, at: sensor.at, time: sample });
        }
        observed = stored.get(tick);
        scanner.ingest(observed.passes, observed);
        last = tick;
      }
    }
    const marks = K.frameSplats(B, returns ? scanner.capacity : 1, (draw, _dt, t) => {
      if (returns) scanner.draw(draw, displayTime(t));
    });
    const instrument = K.frameSplats(B, 64, (draw, _dt, t) => {
      const time = displayTime(t);
      if (study === 'orbit' || time < scanStart || time > scanEnd || !returns) return;
      const { at } = emitter(time);
      draw.point(at, { width: .052, rgb: [1, .82, .49], density: 3 });
      draw.streak(V.add(at, [-.12, -.035, .03]), V.add(at, [.12, -.035, .03]),
        { width: .042, rgb: [.36, .57, .60], density: 2.7, emissive: false, depth: true });
      if (!observed) return;
      const { depth, position } = observed.passes;
      for (let row = 8; row <= 45; row += 6) {
        const p = row * scanWidth + (scanWidth >> 1), m = p * 3;
        if (!Number.isFinite(depth[p])) continue;
        const hit = [position[m], position[m + 1], position[m + 2]];
        draw.streak(at, hit, { width: .010, rgb: [.34, .85, .75], density: .16 });
      }
    });
    const world = B.finish({ ...finish(), reflections: [K.reflection.plane({ id: 'concourse', at: [0, -.05, 0] })] });
    const stage = K.stage(world);
    stage.add({ update(_dt, t) {
      sync(t);
      const time = displayTime(t);
      const swing = study === 'orbit' ? Math.sin(t * Math.PI * 2 / 4) : smooth(clamp((time - scanEnd) / 2.1));
      world.cam.yaw = .14 - .34 * swing;
      world.cam.pitch = .24 + .033 * swing;
    } });
    stage.add(marks);
    stage.add(instrument);
    stage.stateful = false;
    stage.update(0, 0);
    return world;
  }
});
