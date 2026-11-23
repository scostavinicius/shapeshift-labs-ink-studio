/* Editable guide paths for the four strand bundle styles. */
module.exports = ({ KIT: K }) => {
  const C = K.curveSplats, id = 'curve-splat-bundles', seed = 19;
  const spline = points => ({ kind: 'spline', points, samples: 9 });
  const bundle = (style, guide, settings, appearance) => ({
    source: { kind: 'bundle', id: style, style, guide, ...settings }, ...appearance
  });
  const copper = ['#c76c50', '#e6aa73', '#994a49', '#f0c58e'];
  const silk = ['#75a7c9', '#385e8b', '#88c0d3', '#5574ac'];
  const hems = ['#d17c64', '#f0bb83', '#df8f6d', '#bb6354', '#e9a877'];
  const ledge = [[-2.55,.79,-.17],[-1.66,.50,.13],[-.79,.33,.47],[0,.35,.65],
    [.89,.42,.42],[1.69,.55,-.02],[2.54,.78,-.20]];
  const raised = amount => spline(ledge.map(([x,y,z]) => [x,y+amount,z]));
  const studies = {
    braid: {
      background: '#14222e',
      strands: [bundle('braid', spline([[-2.48,-.66,-.03],[-1.58,-.25,.17],[-.73,.46,.36],
        [.07,.60,.30],[.95,.28,-.07],[1.72,-.15,-.11],[2.45,-.01,.13]]), {
        count: 3, separation: .385, radius: .115, word: [1,-2], repeats: 3, up: [0,.9,.42], clearance: .014
      }, {
        edge: 'hard', caps: 'blunt', lighting: { preset: 'glossy-hair', specular: .34, highlightColor: '#ffe6b8' },
        color: ({ index }) => ['#dd805c', '#5bb19e', '#d9b28a'][index]
      })]
    },
    'twisted-cable': {
      background: '#161f2d',
      strands: [bundle('twisted-cable', spline([[-2.53,.15,.05],[-1.69,.66,.22],[-1.0,.60,.39],
        [-.4,-.16,.66],[.19,-.62,.62],[.85,-.50,.13],[1.57,.08,-.17],[2.48,.36,.01]]), {
        count: 4, separation: .156, radius: .076, turns: 5.8, lengthVariation: .052, up: [0,1,0]
      }, {
        edge: 'hard', caps: 'blunt', lighting: { preset: 'metal-wire', highlightColor: '#ffe1ad', specular: .83 },
        color: ({ index }) => copper[index]
      })]
    },
    'clumped-hair': {
      background: '#151e32',
      strands: [bundle('clumped-hair', spline([[-2.37,.65,-.04],[-1.56,.81,.22],[-.83,.34,.56],
        [-.2,-.49,.43],[.5,-.70,.22],[1.32,-.48,.12],[2.45,-.01,.12]]), {
        count: 28, separation: .196, radius: .037, clumps: 4, tightness: .87, frizz: .46, lengthVariation: .27,
        up: [0,1,0], samples: 46
      }, {
        edge: 'beta', opacity: .93, profileSamples: 20, taper: [[0,.83],[.27,1],[.68,.78],[1,.13]],
        lighting: { preset: 'glossy-hair', highlightColor: '#b7ddff', specular: .84 },
        color: ({ clump }) => silk[clump]
      })]
    },
    'frayed-hem': {
      background: '#1a202c', target: [0,.04,0],
      strands: [
        { source: raised(.27), color: '#718e8a', edge: 'hard', section: 'flattened', aspect: .16,
          width: .55, lighting: { preset: 'matte-thread', diffuse: .48, sheen: .16 } },
        { source: raised(.43), color: '#a4b9a2', edge: 'hard', section: 'flattened', aspect: .44, width: .052 },
        bundle('frayed-hem', raised(0), { count: 33, separation: .15, radius: .023, length: 1.12,
          lengthVariation: .61, frizz: 1.25, up: [0,-1,0], samples: 18 }, {
          edge: 'beta', profileSamples: 16, taper: [[0,1],[.59,.77],[1,.17]],
          lighting: { preset: 'matte-thread', diffuse: .4, sheen: .12 },
          color: ({ index }) => hems[index % hems.length]
        }),
        { source: raised(.014), color: '#f2bc8c', edge: 'hard', width: .059, lighting: 'matte-thread' }
      ]
    }
  };
  return { id, seed, name: 'Strand bundles', build(value = seed, { controls = {} } = {}) {
    const style = controls.style ?? 'braid';
    if (!Object.hasOwn(studies, style)) throw new RangeError('Choose braid, twisted-cable, clumped-hair or frayed-hem');
    const { background, target = [0,0,0], strands } = studies[style];
    return C.world({
      format: C.format, version: 1, seed: value, id: style, background,
      camera: { target, dist: 6.0, yaw: .10, pitch: .10 },
      liveSun: { direction: [-.26,.53,.92], ambient: .48, intensity: .96, shadows: false },
      strands: strands.map(strand => strand.source.kind === 'bundle' ?
        { ...strand, source: { ...strand.source, seed: value } } : strand)
    });
  } };
};
