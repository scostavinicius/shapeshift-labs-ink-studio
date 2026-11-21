const assert = require('node:assert/strict');
const { test } = require('node:test');
const ink = require('..');
const { KIT: K, AtmospherePalette, SkyEnvironment, CloudField, SceneOptics, makeBuilder, makeSculpt } = ink.load();

const field = { type: 'bands', stops: [{ at: 0, color: '#ff0000' }, { at: .5, color: '#0000ff' }] };
const definition = { source: 'depth', domain: [0, 2], field };
const close = (a, b, epsilon = 1e-10) => assert(a.every((value, i) => Math.abs(value - b[i]) <= epsilon), a + ' vs ' + b);

test('authored bands, ramps and domains reuse palette-field sampling', () => {
  const bands = AtmospherePalette.compile(definition, AtmospherePalette.volumeDomains);
  close(bands.apply(.9, [1,1,1]), [1,0,0]);
  close(bands.apply(1, [1,1,1]), [0,0,1]);
  const ramp = AtmospherePalette.compile({ strength: .5, field: { type: 'primary', accent: '#00ff00' } },
    AtmospherePalette.lightDomains);
  close(ramp.apply(.5, [1,0,0]), [.5,.5,0], 1e-6);
  assert.throws(() => AtmospherePalette.compile({ ...definition, source: 'weather' }, AtmospherePalette.volumeDomains), /source/);
  assert.throws(() => AtmospherePalette.compile({ ...definition, domain: [2,2] }, AtmospherePalette.volumeDomains), /domain/);
});

test('depth fields change scattering while Beer–Lambert transmittance stays the same', () => {
  const volumes = opt => SceneOptics.prepareVolumes([SceneOptics.box({
    min: [-1,-1,0], max: [1,1,8], density: .3, color:'#ffffff', step:.125, ...opt
  })]);
  const sample = (rows, z, stop, options) => SceneOptics.trace(rows,[0,0,z],[0,0,1],stop,undefined,options);
  const red = 1 - Math.exp(-.3), blue = Math.exp(-.3) * red;
  const tinted = volumes({ paletteField: definition });
  close(sample(tinted, 0, 2), [red, 0, blue, Math.exp(-.6)]);
  close(sample(tinted, -3, 5, { depthOffset: 3 }), [red, 0, blue, Math.exp(-.6)]);
  close([sample(tinted, 0, 8)[3]], [sample(volumes({}), 0, 8)[3]]);
});

test('cloud altitude recolors a cloud without changing its coverage', () => {
  const source = { bounds:{min:[-2,-2],max:[2,3]}, resolution:[4,4], coverage:Array(16).fill(.9),
    height:2, thickness:2, color:'#a3a3a3', steps:16 };
  const frame = CloudField.compile({ ...source, paletteField: { source:'altitude', domain:[1,3], field } }).frame(0);
  const baseline = CloudField.compile(source).frame(0);
  for (const [alt, channel] of [[1.5,0],[2.5,2]]) {
    const signal=[], original=[];
    const rgb=frame.paint([0,alt,-3],[0,0,1],[0,0,0],undefined,signal);
    baseline.paint([0,alt,-3],[0,0,1],[0,0,0],undefined,original);
    assert(signal[0] > .25);
    close(signal, original);
    assert(rgb[channel] > .25 && rgb[2-channel] === 0);
  }
});

test('attenuated light intensity chooses the beam color and a blocker still cuts it', () => {
  const tint = { source:'intensity', domain:[0,.8], field };
  const spot = { at:[0,0,0], direction:[1,0,0], radius:8, innerAngle:15, outerAngle:25,
    intensity:1, color:'#ffffff', paletteField:tint };
  const ambientFog=SceneOptics.prepareVolumes([SceneOptics.fog({ color:'#ffffff', density:.4, lit:true, step:.1 })]);
  const read = (point, blocked) => {
    const media = SceneOptics.lighting({ ambient:0, spots:[spot], shadow:() => blocked },[]);
    return SceneOptics.trace(ambientFog,point,[0,0,1],.4,undefined,{media});
  };
  const near=read([1,0,0],false), far=read([5,0,0],false), blocked=read([1,0,0],true);
  assert(near[2] > .1 && near[0] === 0);
  assert(far[0] > .018 && far[2] === 0);
  close(blocked, [0,0,0,near[3]]);
  close([near[3]], [far[3]]);
});

function mirror(shared) {
  const b=makeBuilder(5,[0x101522,0x31465c]), s=K.sculpt(makeSculpt(b));
  const finish = K.surface.material({r:[1],materialId:'mirror'},{layers:{
    reflected:{ type:'reflection', source:'scene', f0:1, strength:1 }
  }});
  s.box([0,-.07,0],[2,.055,1.6],finish,{res:.09});
  s.bake();
  const skyEnvironment = { defaults:{ zenith:'#172a3f', horizon:'#172a3f', ground:'#172a3f', sunStrength:0, paletteStrength:1 },
    sky:{ paletteField:{ source:'elevation', gain:'paletteStrength', reflections:shared,
      field:{ type:'bands', stops:[{at:0,color:'#bd6541'}] } } } };
  return b.finish({ cam:{target:[0,.15,0],dist:5.5,yaw:0,pitch:.55}, radius:4, dither:0, skyEnvironment });
}

test('the directional field can be shared with a material reflection or limited to the sky', () => {
  const options={ w:80,h:64,px:1,raw:true,passes:['reflections','materialId'] };
  const a=ink.render(mirror(true),options), b=ink.render(mirror(false),options);
  close([...a.rgb.slice(0,3)], [...b.rgb.slice(0,3)]);
  assert.equal(a.rgb[0], 189);
  const p=a.passes.materialId.findIndex((id,i)=>id && a.passes.reflections[i*3]>.6);
  assert(p>=0);
  close([...a.passes.reflections.subarray(p*3,p*3+3)], [189/255,101/255,65/255], 2/255);
  close([...b.passes.reflections.subarray(p*3,p*3+3)], [23/255,42/255,63/255], 2/255);
  const source = mirror(true).skyEnvironment;
  const sky = SkyEnvironment.compile({ ...source, defaults:{ ...source.defaults, paletteStrength:0 } }).frame(0).sky;
  assert.equal(sky.paletteField, undefined);
});

test('WebGL samples directional sky, analytic fog and altitude-tinted cards at native art pixels', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const fixture = ({ makeBuilder, KIT:K }, definition) => {
    const b=makeBuilder(7,[0x172034]);
    return b.finish({ cam:{target:[0,0,0],dist:5,yaw:0,pitch:0},radius:4,dither:0,
      skyEnvironment:{ defaults:{sunStrength:0}, sky:{ paletteField:{ source:'elevation',
        field:{type:'bands',stops:[{at:0,color:'#342957'}]}} }},
      atmosphere:[K.atmosphere.fog({density:.3,near:.1,far:2,step:.125,paletteField:definition})] });
  };
  const run = require('../cli/look-webgl.js');
  const settings={ dither:0, raw:true, outline:false, w:48, h:32, px:1 };
  const points = { center:[24,16], corner:[3,3] };
  const cpu=ink.render(fixture(ink.load(),definition),settings);
  const { samples, cloud } = run({},fixture,(kit, build, backend, { definition, settings, points }) => {
    const draw=backend(settings.w,settings.h,settings);
    try {
      draw.draw(build(kit,definition));
      const samples=draw.sample(points);
      const world=build(kit,definition);
      world.cam={...world.cam,target:[0,2.5,0]};
      world.atmosphere=[];
      world.cloudRepresentation='card';
      world.cloudField={ bounds:{min:[-2,-3],max:[2,2]}, resolution:[4,4],
        coverage:Array(16).fill(.9), height:2, thickness:2, color:'#969696' };
      draw.draw(world);
      const base=draw.sample(points).center;
      world.cloudField={...world.cloudField,paletteField:{ ...definition, source:'altitude', domain:[1,3] }};
      draw.draw(world);
      return { samples, cloud:[base,draw.sample(points).center] };
    } finally { draw.close(); }
  },{definition,settings,points});
  for (const [name,[x,y]] of Object.entries(points)) {
    const p=(y*settings.w+x)*3;
    close(samples[name],[...cpu.rgb.subarray(p,p+3)], 4);
  }
  assert(cloud[1][2] > cloud[0][2] + 24 && cloud[1][0] < cloud[0][0] - 24, JSON.stringify(cloud));
});
