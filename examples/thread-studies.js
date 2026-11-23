/* Three pictures built from raised yarn, with a separate technique in each study. */
function makeThreadStudy({ KIT: K, makeBuilder }, study = 'garden') {
  const { textile, V } = K;
  const size = [8.4, 5.04],
    dark = [17, 22, 33];
  const B = makeBuilder(2107, [0x111621, 0xffffff]);
  const ellipse = (u, v, x, y, rx, ry) => ((u - x) / rx) ** 2 + ((v - y) / ry) ** 2;
  function chart(u, v) {
    return [
      (u - 0.5) * size[0],
      (v - 0.5) * size[1] - 0.19 * Math.sin(Math.PI * u) * (1 - v),
      0.2 * Math.cos(Math.PI * (u - 0.5)) + 0.13 * (1 - v) * Math.sin(Math.PI * (u * 3 - 0.4))
    ];
  }
  function backing(colorAt, depth = 0.045) {
    const w = 50,
      h = 30;
    const point = (u, v) => {
      const p = chart(u, v);
      return [p[0], p[1], p[2] - depth];
    };
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const u = i / w,
          v = j / h,
          x = (i + 1) / w,
          y = (j + 1) / h;
        const a = point(u, v),
          b = point(x, v),
          c = point(x, y),
          d = point(u, y);
        const tint = colorAt((u + x) / 2, (v + y) / 2).map(value =>
          Math.round(value * (0.91 + 0.13 * K.hash(i, j, 151)))
        );
        for (const face of [
          [a, b, c],
          [a, c, d]
        ])
          K.surfacePatches.triangle(B, face, { color: tint, object: 'backing', material: 'cloth' });
      }
  }
  const darkStitches = ['#233745', '#293544', '#263745', '#2d404b'];
  function sampleStyle(id, options = {}) {
    return { object: id, sides: 6, ambient: 0.5, sheen: 0.14, twist: 0.16, light: [-0.68, 0.74, 0.92], ...options };
  }
  function garden() {
    const reeds = [
      [0.065, 0.76, 0.51],
      [0.12, 0.7, 0.48],
      [0.175, 0.3, 0.35],
      [0.26, -0.6, 0.3],
      [0.81, 0.77, 0.47],
      [0.925, -0.65, 0.63],
      [0.963, -0.55, 0.46]
    ];
    const stars = [
      [0.16, 0.75],
      [0.231, 0.79],
      [0.24, 0.58],
      [0.32, 0.86],
      [0.343, 0.72],
      [0.423, 0.81],
      [0.47, 0.57],
      [0.502, 0.76],
      [0.588, 0.89],
      [0.84, 0.85],
      [0.891, 0.74],
      [0.941, 0.84]
    ];
    function sprig(u, v) {
      for (const [base, angle, height] of reeds) {
        const t = (v - 0.045) / height,
          stem = clip => base + angle * height * 0.4 * clip ** 1.54;
        if (t < 0 || t > 1.06) continue;
        if (Math.abs(u - stem(t)) < 0.012 * (1.16 - t * 0.63)) return 1;
        for (let i = 0; i < 8; i++) {
          const k = 0.2 + i * 0.091,
            y = (t - k) * height;
          if (y < -0.014 || y > 0.058) continue;
          const side = i % 2 ? 1 : -1,
            x = (u - stem(k)) * side,
            wide = 0.105 * height * (1.25 - k);
          if (x >= 0 && ellipse(x, y, wide * 0.7, wide * 0.58, wide, 0.0138 + wide * 0.13) < 1) return 2 + (i % 3);
        }
      }
      return 0;
    }
    const coast = u => 0.4 + 0.065 * Math.sin(9 * u + 0.7) + 0.046 * Math.sin(19 * u - 0.1) + 0.033 * Math.cos(31 * u);
    function motif(u, v) {
      const leaf = sprig(u, v),
        moon = ellipse(u, v, 0.721, 0.73, 0.105, 0.175);
      if (u < 0.017 || u > 0.983 || v < 0.025 || v > 0.975) return 'selvedge';
      if (leaf) return 'leaf' + leaf;
      if (moon < 0.97) return moon > 0.78 ? 'rim' : 'moon';
      if (stars.some(([x, y], i) => ellipse(u, v, x, y, i % 3 === 0 ? 0.015 : 0.006, i % 3 === 0 ? 0.017 : 0.011) < 1))
        return 'star';
      const bank = 0.57 + 0.075 * Math.sin((0.4 - v) * 9.7) - 0.1 * (0.41 - v);
      if (v < 0.412 && Math.abs(u - bank) < 0.018 + (0.412 - v) * 0.42) {
        return Math.sin(v * 138 + u * 9) + 0.55 * Math.cos(18 * u) > -0.12 ? 'water-light' : 'water';
      }
      if (v < coast(u) - 0.17) return 'shore';
      if (v < coast(u) - 0.08) return 'front';
      if (v < coast(u)) return 'ridge';
      return Math.round(v * 43) % 3 === 0 && u < 0.97 && v > 0.47 && v < 0.94 ? 'sky' : 'air';
    }
    const palette = {
      selvedge: '#816556',
      leaf1: '#f2b58a',
      leaf2: '#e1a37a',
      leaf3: '#cb7f62',
      leaf4: '#a9554e',
      rim: '#e3ac80',
      moon: '#f5cd9e',
      star: '#ffe2b0',
      'water-light': '#75b8b8',
      water: '#456d8e',
      shore: '#355960',
      front: '#486979',
      ridge: '#646783',
      sky: '#243c54'
    };
    backing((u, v) => {
      const name = motif(u, v);
      return name === 'water' || name === 'water-light' ? [24, 49, 62] : name === 'shore' ? [33, 51, 57] : [29, 38, 54];
    });
    const plan = textile.stitch({
      chart,
      size,
      columns: 74,
      rows: 47,
      radius: 0.03,
      samples: 3,
      length: 1.02,
      mask: (u, v) => (motif(u, v) === 'air' ? 1 : -1),
      direction(u, v) {
        const name = motif(u, v);
        if (name === 'moon' || name === 'rim') return [1, 0.25 + (u - 0.72) * 2.6];
        if (name.startsWith('leaf')) return [0.37 + 1.0 * Math.sin(u * 23 + v * 10), 1];
        if (name.startsWith('water')) return [1, -0.1];
        return [1, 0.25 * Math.cos(u * 12 + v * 4)];
      }
    });
    textile.draw(
      B,
      plan,
      sampleStyle('embroidery', {
        sides: 5,
        threadPitch: 0.09,
        color({ uv: [u, v], index }) {
          return palette[motif(u, v)] ?? darkStitches[index % 4];
        }
      })
    );
    return { title: 'Moon Garden', technique: 'Directional embroidery', plan };
  }

  function moth() {
    const rose = ['#df8b71', '#f2ad8c', '#eda582', '#bf675d'];
    const cream = ['#efc798', '#f5d6a6', '#f3b987'];
    const nights = ['#3e3551', '#493b56', '#5b465e', '#624a61', '#3e3f59'];
    backing(() => [31, 28, 44], 0.15);
    const plan = textile.knit({ chart, size, columns: 25, rows: 17, radius: 0.041, samples: 2 });
    textile.draw(
      B,
      plan,
      sampleStyle('knitting', {
        sides: 6,
        threadPitch: 0.145,
        sheen: 0.13,
        color({ uv: [u, v], index }) {
          const x = Math.abs(u - 0.5),
            y = v - 0.5;
          const upper = ellipse(x, y + 0.39 * x, 0.208, 0.115, 0.214, 0.154),
            lower = ellipse(x, y - 0.45 * x, 0.14, -0.162, 0.137, 0.134);
          const antenna = Math.abs(x - (y - 0.15) * 0.62) < 0.015 && y > 0.18 && y < 0.349;
          if ((x < 0.02 && Math.abs(y) < 0.23) || antenna) return cream[index % 3];
          if (Math.min(upper, lower) < 1) {
            const outerEye = ellipse(x, y, 0.274, 0.034, 0.053, 0.077);
            if (outerEye < 0.28) return '#4b455f';
            if (outerEye < 1.16 || ellipse(x, y, 0.158, -0.173, 0.04, 0.055) < 1) return cream[index % 3];
            if (upper > 0.77 && lower > 0.79) return '#da9a76';
            if (lower < 1) return ['#965f7c', '#ad6e86', '#c8828b'][index % 3];
            return rose[index % 4];
          }
          if (ellipse(u, v, 0.5, 0.5, 0.434, 0.435) > 0.92 && ellipse(u, v, 0.5, 0.5, 0.434, 0.435) < 1.09)
            return '#9f776d';
          if ((index === 1 || index === 15) && Math.abs(u - 0.5) < 0.433) return '#694b67';
          return nights[(index + Math.floor(6 * u)) % nights.length];
        }
      })
    );
    return { title: 'Ember Moth', technique: 'Interlocking knit loops', plan };
  }

  function harbor() {
    const loomChart = (u, v) => {
      const p = chart(u, v);
      return [p[0], p[1] + 0.07 * Math.sin(u * 12) * v, p[2] + 0.05 * Math.cos(u * 21 - v * 3)];
    };
    const plan = textile.weave({
      chart: loomChart,
      size,
      columns: 27,
      rows: 16,
      radius: 0.07,
      clearance: 0.008,
      lift: 0.053,
      flatness: 0.44,
      samples: 3,
      pattern: ['1100', '0110', '0011', '1001']
    });
    function tall(u, v) {
      const towers = [
        [0.03, 0.116, 0.57],
        [0.121, 0.187, 0.7],
        [0.192, 0.281, 0.6],
        [0.282, 0.335, 0.74],
        [0.344, 0.393, 0.66],
        [0.645, 0.69, 0.51],
        [0.704, 0.759, 0.57],
        [0.775, 0.816, 0.65],
        [0.83, 0.921, 0.73],
        [0.925, 0.974, 0.575]
      ];
      return towers.some(([a, b, y]) => u >= a && u <= b && v > 0.3 && v < y);
    }
    function shade(u, v, family, index) {
      const warp = family === 'warp';
      if (u < 0.026 || u > 0.974 || v < 0.037 || v > 0.966) return warp ? '#dd947b' : '#9f5376';
      if (v > 0.42 && ellipse(u, v, 0.568, 0.643, 0.207, 0.293) < 1) {
        if (tall(u, v)) return warp ? '#3a3f5c' : '#252b44';
        const band = Math.floor(v * 21);
        if (band % 5 === 0 || band % 5 === 1) return warp ? '#c3748a' : '#b86480';
        return warp ? '#efb090' : '#df8e85';
      }
      if (tall(u, v)) {
        if (warp && v < 0.66 && v > 0.39 && (index % 3 === 0 || index % 5 === 0) && Math.sin(v * 141 + index) > 0.3)
          return '#9ed2cb';
        return warp ? '#557083' : '#425672';
      }
      if (v < 0.37) {
        const line = Math.sin(v * 143 + u * 10 + Math.sin(u * 13));
        const flare = Math.abs(u - 0.55) < 0.28 - (v - 0.13) * 0.27;
        if (line > 0.24 && flare) return warp ? '#ca788a' : '#9b638e';
        if (line > -0.04) return warp ? '#609da8' : '#497a9b';
        return warp ? '#3b5692' : '#404d80';
      }
      return warp ? '#3d557a' : '#563b69';
    }
    backing((u, v) => {
      const color = shade(u, v, 'weft', 0);
      return V.mul(
        [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)),
        0.46
      );
    }, 0.025);
    textile.draw(
      B,
      plan,
      sampleStyle('weaving', {
        sides: 6,
        threadPitch: 0.18,
        sheen: 0.24,
        ambient: 0.56,
        color: ({ uv: [u, v], family, index }) => shade(u, v, family, index)
      })
    );
    return { title: 'Signal Harbor', technique: 'Over-under woven strips', plan };
  }

  const builders = { garden, moth, harbor };
  if (!Object.hasOwn(builders, study)) throw new RangeError('Unknown thread study ' + study);
  const { title, technique, plan } = builders[study]();
  const cam = {
    target: [0, -0.04, 0.08],
    dist: 11.15,
    yaw: study === 'moth' ? -0.08 : 0.1,
    pitch: 0.1,
    fov: 0.55,
    sway: 0
  };
  const world = B.finish({
    cam,
    title,
    radius: 100,
    dither: 0,
    fog: { c: 0, start: 1, max: 0 },
    look: { pixelSize: 1, clean: 1, splatCoverage: 'continuous' }
  });
  return { world, title, technique, stats: plan.stats };
}
if (typeof module !== 'undefined') module.exports = makeThreadStudy;
