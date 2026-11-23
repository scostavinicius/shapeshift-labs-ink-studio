/* Generate independent, editable strands in the transported frame of a guide. */
const CurveBundles = (() => {
  const { V, curve, procedural } = KIT, TAU = 2 * Math.PI;
  const defaults = {
    braid: { count: 3, separation: .31, radius: .32 },
    'twisted-cable': { count: 4, separation: .22, radius: .37 },
    'clumped-hair': { count: 18, separation: .115, radius: .22 },
    'frayed-hem': { count: 21, radius: .17 }
  };
  const number = (value, lo, hi) => Number.isFinite(value) && value >= lo && value <= hi;
  const integer = (value, lo, hi) => Number.isSafeInteger(value) && value >= lo && value <= hi;
  const name = value => typeof value === 'string' && value.length > 0 && value.length <= 120;
  const smooth = t => t * t * (3 - 2 * t);
  function expect(ok, message) {
    if (!ok) throw new RangeError('Strand bundle: ' + message);
  }

  function frames(guide, samples, count, limit) {
    const stations = new Set(Array.from({ length: samples + 1 }, (_, i) => i * guide.length / samples));
    let distance = 0;
    for (let i = 1; i < guide.points.length; i++) {
      distance += V.dist(guide.points[i - 1], guide.points[i]);
      stations.add(distance);
    }
    const distances = [...stations].sort((a, b) => a - b)
      .filter((at, i, sorted) => !i || at - sorted[i - 1] > guide.length * 1e-11);
    expect((distances.length - 1) * count <= limit, 'guide samples exceed the segment budget');
    return distances.map(at => ({ ...guide.frame(at), u: at / guide.length }));
  }

  function trim(points, fraction, length) {
    const end = fraction * length, kept = [points[0]];
    let distance = 0;
    for (let i = 1; i < points.length; i++) {
      const span = V.dist(points[i - 1], points[i]);
      if (distance + span >= end) {
        const remaining = end - distance;
        if (remaining > 0) kept.push(V.lerp(points[i - 1], points[i], Math.min(1, remaining / span)));
        break;
      }
      kept.push(points[i]);
      distance += span;
    }
    return kept;
  }

  const ringRadius = (spacing, count) => count < 2 ? 0 : spacing / (2 * Math.sin(Math.PI / count));
  const local = (frame, x, y) => V.mad(V.mad(frame.p, frame.N, x), frame.B, y);

  function braided(spec, guide, members, separation, random, limit) {
    const count = members.length;
    const handedness = random.sample('braid-hand') < .5 ? -1 : 1;
    const { word = Array.from({ length: count - 1 }, (_, i) => handedness * (i + 1) * (i % 2 ? -1 : 1)),
      repeats = guide.closed ? count : 3, samplesPerCrossing = 12, clearance = 0 } = spec;
    expect(Array.isArray(word) && integer(word.length, 1, 256) && integer(repeats, 1, 128) &&
      integer(samplesPerCrossing, 4, 48) && number(clearance, 0, 100),
      'invalid braid word, repeats, resolution or clearance');
    const braid = procedural.interlace.braid({
      spine: guide, strands: members, word, repeats, spacing: separation, samplesPerCrossing, clearance
    });
    expect(braid.strands.reduce((segments, strand) => segments + strand.path.points.length - 1, 0) <= limit,
      'braid samples exceed the segment budget');
    return braid;
  }

  function twisted(spec, guide, members, separation, phase, limit) {
    const turns = spec.turns ?? (guide.closed ? 3 : 2.5), count = members.length;
    expect(number(turns, -64, 64), 'cable turns must be from -64 to 64');
    expect(!guide.closed || Number.isInteger(turns), 'a closed cable needs a whole number of turns');
    const samples = spec.samples ?? Math.max(40, Math.ceil(Math.abs(turns) * 24));
    expect(integer(samples, Math.max(4, Math.ceil(Math.abs(turns) * 8)), 2048), 'insufficient cable resolution for the requested turns');
    const stations = frames(guide, samples, count, limit), r = ringRadius(separation, count);
    return members.map((_, i) => stations.map(frame => {
      const a = TAU * (i / count + turns * frame.u) + phase;
      return local(frame, r * Math.cos(a), r * Math.sin(a));
    }));
  }

  function hair(spec, guide, members, separation, phase, random, limit) {
    const count = members.length;
    const { clumps = Math.min(4, count), tightness = .76, frizz = .27, samples = 48 } = spec;
    expect(integer(clumps, 1, Math.min(24, count)) && number(tightness, 0, 1) &&
      number(frizz, 0, 10) && integer(samples, 8, 512), 'invalid hair clumping, frizz or resolution');
    const stations = frames(guide, samples, count, limit);
    const spread = ringRadius(separation * (.65 + Math.sqrt(count / clumps)), clumps);
    return members.map(member => {
      const { id, index } = member, group = index % clumps, inGroup = Math.floor(index / clumps);
      const center = TAU * group / clumps + phase;
      const fiber = inGroup * 2.399963229728653 + TAU * random.sample([id, 'fiber-angle']);
      const radius = separation * .56 * Math.sqrt(1 + inGroup);
      const drift = TAU * random.sample([id, 'drift']);
      member.clump = group;
      return stations.map(frame => {
        const u = frame.u, gather = guide.closed ? Math.sin(Math.PI * u) ** 2 : smooth(u);
        const r = radius * (1 - tightness * gather), a = fiber + .48 * gather;
        const wiggle = separation * frizz * gather * (1 - .65 * tightness * gather);
        return local(frame, spread * Math.cos(center) + r * Math.cos(a) + wiggle * Math.sin(3 * TAU * u + drift),
          spread * Math.sin(center) + r * Math.sin(a) + wiggle * Math.cos(2 * TAU * u + drift));
      });
    });
  }

  function fringe(spec, guide, members, separation, random, limit) {
    const { length = .42, frizz = .72, samples = 16 } = spec, count = members.length;
    const run = separation * (count - 1), start = (guide.length - run) / 2;
    expect(number(length, 1e-5, 1e4) && number(frizz, 0, 10) && integer(samples, 4, 512),
      'invalid fringe length, frizz or resolution');
    expect(run + (guide.closed ? separation : 0) <= guide.length * (1 + 1e-10), 'fringe root spacing exceeds the guide length');
    expect(samples * count <= limit, 'fringe samples exceed the segment budget');
    return members.map(({ id, index }) => {
      const frame = guide.frame(start + index * separation);
      const a = TAU * random.sample([id, 'curl']), tilt = 2 * random.sample([id, 'tilt']) - 1;
      const out = (2 * random.sample([id, 'fanning']) - 1) * .32 * length * Math.min(1, frizz);
      return Array.from({ length: samples + 1 }, (_, i) => {
        const t = i / samples, wave = separation * frizz * t * t;
        const along = V.mad(frame.p, frame.T, tilt * wave + .48 * wave * Math.sin(a + TAU * t));
        return V.mad(V.mad(along, frame.N, length * t), frame.B, out * t * t + wave * Math.cos(a + TAU * t));
      });
    });
  }

  function build(spec, guide, limit) {
    const { style = 'braid', id = style, seed = 1, lengthVariation = 0 } = spec;
    expect(Object.hasOwn(defaults, style), 'choose braid, twisted-cable, clumped-hair or frayed-hem');
    const template = defaults[style];
    const { count = template.count,
      separation = template.separation ?? guide.length / (guide.closed ? count : Math.max(1, count - 1)),
      radius = Math.min(100, separation * template.radius) } = spec;
    const cable = style === 'braid' || style === 'twisted-cable';
    expect(name(id) && Number.isSafeInteger(seed) && integer(count, cable ? 2 : 1, style === 'braid' ? 24 : 128) &&
      number(separation, 1e-5, 1e4) && number(radius, style === 'braid' ? 1e-5 : 1e-6, 100) &&
      number(lengthVariation, 0, .9), 'invalid ID, seed, count, separation, radius or length variation');
    const random = Randomness.create(seed).stream('strand-bundle', style);
    const phase = TAU * random.sample('phase');
    const members = Array.from({ length: count }, (_, index) => ({ id: id + ':' + index, family: style, index, radius }));
    const braid = style === 'braid' ? braided(spec, guide, members, separation, random, limit) : null;
    const lines = braid ? braid.strands.map(strand => strand.path.points) :
      style === 'twisted-cable' ? twisted(spec, guide, members, separation, phase, limit) :
        style === 'clumped-hair' ? hair(spec, guide, members, separation, phase, random, limit) :
          fringe(spec, guide, members, separation, random, limit);
    const shouldClose = guide.closed && style !== 'frayed-hem';
    const up = guide.frame(0).N, lengths = new Map();
    const strands = members.map((member, index) => {
      const line = lines[index].map(p => p.slice());
      if (shouldClose) line[line.length - 1] = line[0].slice();
      expect(line.every(p => p.every(value => number(value, -1e5, 1e5))), 'strand exceeds world coordinate bounds');
      const length = curve.length(line), fraction = 1 - lengthVariation * random.sample([member.id, 'length']);
      const actual = length * fraction;
      expect(actual > 1e-7, 'strand has no usable length');
      lengths.set(member.id, actual);
      return { ...member, length: actual,
        path: { points: fraction < 1 ? trim(line, fraction, length) : line, closed: shouldClose && fraction === 1, up: up.slice() } };
    });
    return procedural.data.freeze({ kind: 'bundle-plan', version: 1, style, id, seed, separation, lengthVariation,
      closed: strands.every(strand => strand.path.closed), strands, ...(braid && {
        crossings: braid.crossings.filter(row => row.overDistance <= lengths.get(row.over) && row.underDistance <= lengths.get(row.under)),
        ...(lengthVariation === 0 && { endOrder: braid.endOrder })
      }) });
  }

  return Object.freeze({ build });
})();
