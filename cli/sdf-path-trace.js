const AreaLights = require('../src/area-lights.js');
const CameraLens = require('../src/camera-lens.js');
const ColorSpace = require('../src/color-space.js');
const LightSchedule = require('../src/light-schedule.js');
const Optical = require('../src/optical-materials.js');
const RenderContract = require('../src/render-contract.js');
const { unpack } = require('../src/render-stages.js');
const SkyEnvironment = require('../src/sky-environment.js');
const { resolveEnvironment, resolveWind, resolveLighting } = require('./environment.js');
const { bind, dot, along, clamp, linear } = require('./sdf-reference-field.js');

const display = ColorSpace.prepare('srgb-linear', 'srgb');
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit = a => { const length = Math.hypot(...a) || 1; return a.map(n => n/length); };
const multiply = (a,b) => { for (let c=0;c<3;c++) a[c] *= b[c]; };
const clear = [1,1,1], blocked = [0,0,0];
const far = 400, transportLimit = 18;

function random(seed) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let n = Math.imul(state ^ state >>> 15, 1 | state);
    n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}

function hemisphere(normal, rng) {
  const r = Math.sqrt(rng()), angle = 2*Math.PI*rng();
  const u = unit(cross(Math.abs(normal[1]) < .9 ? [0,1,0] : [1,0,0],normal));
  const v = cross(normal,u), x = r*Math.cos(angle), y = r*Math.sin(angle), z = Math.sqrt(1-r*r);
  return normal.map((n,c) => n*z+u[c]*x+v[c]*y);
}

function frameLights(world, options, camera) {
  const { direction, time, scene } = RenderContract.clock(world, options);
  const climate = resolveEnvironment(world,options,time,direction);
  const lighting = resolveLighting(world,options,climate,resolveWind(world,options,climate),direction);
  const authored = world.referenceSdfs?.[0]?.lighting;
  const sun = lighting.sun ?? (options.liveSun !== false && world.liveSun !== false ? authored : null);
  const background = unpack(world.pal[0]);
  const sky = SkyEnvironment.withCelestials(climate.environment?.sky,lighting.celestial,background);
  const environment = ray => sky ? linear(SkyEnvironment.shade(sky,ray)) : clear.map(n=>n*(sun?.ambient ?? .18));
  const areas = AreaLights.prepare(options.areaLights === true ? world.areaLights : options.areaLights ?? world.areaLights,
    { time:scene }).filter(light => light.intensity > 0);
  const fallback = authored?.lights.map(light => ({ p:light.p, radius:light.r, intensity:light.s,
    color: light.c?.length ? unpack(world.pal[light.c.at(-1)]) : clear, shadows: Boolean(light.sh) }));
  const local = LightSchedule.select(world.lights?.length ? world.lights : fallback ?? [],camera.eye,
    { daylight:options.lightDaylight ?? options.environment?.daylight ?? world.anim?.daylight ?? 1, limit:64 })
    .map(light => ({ ...light, tint:linear(light.color) }));
  return { sun, areas, local, environment, sky, background:linear(background),
    sunTint: lighting.celestial?.sun?.color ? linear(lighting.celestial.sun.color) : clear };
}

function trace(world, options, camera, settings) {
  const { samples, bounces, epsilon, steps, seed, exposure } = settings;
  const { intersect, rows, stats, bias, support } = bind(world,epsilon,steps);
  const { sun, areas, local, environment, sky, background, sunTint } = frameLights(world,options,camera);
  const { width:w, height:h, view, eye, ortho, tangent, clipNear, clipFar } = camera;
  const rayAt = CameraLens.rays(view,eye,w,h,h*.5/tangent,ortho);
  const skyRay = ortho && sky && CameraLens.rays(view,eye,w,h,h*.5/Math.tan(sky.orthoFov*.5),false);
  const rgb = new Uint8Array(w*h*3), indirect = new Uint8Array(rgb.length), transmission = new Uint8Array(rgb.length);
  const depth = new Float32Array(w*h).fill(Infinity), normals = new Float32Array(rgb.length);
  const coverage = new Float32Array(w*h), sampling = new Float32Array(w*h), spacing = new Float32Array(w*h);
  const even = new Float64Array(3), odd = new Float64Array(3), sumIndirect = new Float64Array(3), sumThrough = new Float64Array(3);
  const transport = { indirectPixels: 0, transmissionPixels: 0 };
  const film = (n,c) => display(n.map(v => clamp(v*exposure))).map(v => v * c);
  const half = samples/2, shuffle = random(seed ^ 0x62c8f57d);
  // Each half independently jitters across the same 2D Latin hypercube.
  const strata = Array.from({length:half},(_,i)=>i);
  for (let i=half-1;i>0;i--) {
    const j = Math.floor(shuffle()*(i+1));
    [strata[i],strata[j]] = [strata[j],strata[i]];
  }

  function attenuate(weight, media, distance) {
    let extinction = 0;
    for (const medium of media.values()) extinction += medium.extinction;
    if (extinction) {
      const attenuation = Math.exp(-distance*extinction);
      for (let c=0;c<3;c++) weight[c] *= attenuation;
    }
  }

  function shadow(hit, direction, length, enabled, initialMedia) {
    if (!enabled) return clear;
    let origin = along(hit.point,hit.normal,dot(hit.normal,direction)>0 ? bias : -bias), left = length - bias;
    const gain = [1,1,1], media = new Map(initialMedia);
    for (let i=0;i<transportLimit && left>0;i++) {
      const h = intersect(origin,direction,0,left);
      attenuate(gain,media,h?.t ?? left);
      if (!h) return gain;
      const { glass, thin } = h.profile;
      if (glass) {
        const f = Optical.fresnel(glass.reflect,dot(h.normal,direction));
        for (let c=0;c<3;c++) gain[c] *= (1-f)*glass.interfaceTint[c]*(h.front ? glass.uncovered : 1);
        if (h.front) media.set(h.source,glass);
        else media.delete(h.source);
      } else if (thin) {
        if (h.front) {
          const weight = thin.strength * Math.exp(-thin.thickness/Math.max(.08,Math.abs(dot(h.normal,direction))));
          for (let c=0;c<3;c++) gain[c] *= weight * thin.rgb[c];
        }
      } else return blocked;
      if (Math.max(...gain)<.0001) return blocked;
      origin = along(h.point,direction,bias);
      left -= h.t + bias;
    }
    return left > 0 ? blocked : gain;
  }

  function direct(hit, normal, rng, media, add) {
    const { albedo, thin } = hit.profile, share = thin ? thin.strength*Math.exp(-thin.thickness) : 0;
    function light(direction, distance, color, level, shadows, kind) {
      const angle = dot(normal,direction);
      const through = angle < 0;
      const amount = through ? thin && (thin.source==='both' || thin.source===kind) &&
        -angle*thin.strength*Math.exp(-thin.thickness/Math.max(.08,-angle)) :
        angle*(1-share);
      if (!(amount>0) || !(level>0)) return;
      const filter = shadow(hit,direction,distance,shadows,media), pigment = through ? thin.rgb : albedo;
      add(pigment.map((n,c) => n*filter[c]*color[c]*amount*level),through);
    }
    if (sun?.intensity) light(sun.direction,far,sunTint,sun.intensity,sun.shadows,'sun');
    for (const source of local) {
      const delta = along(source.p,hit.point,-1), d = Math.hypot(...delta);
      if (d <= bias || d >= source.radius) continue;
      const level = LightSchedule.contribution(source,...hit.point);
      light(delta.map(n=>n/d),d,source.tint,level,source.shadows !== false,'local');
    }
    for (const source of areas) {
      if (Math.hypot(...along(source.at,hit.point,-1)) >= source.radius+Math.hypot(...source.half)) continue;
      const point = source.points[Math.floor(rng()*source.points.length)];
      const delta = along(point,hit.point,-1), d = Math.hypot(...delta);
      if (d <= bias || d >= source.radius) continue;
      const dir = delta.map(n=>n/d), facing = -dot(dir,source.normal);
      const intensity = source.intensity * (1-d/source.radius)**2 *
        (source.shape === 'line' ? 1 : Math.max(0,source.twoSided ? Math.abs(facing) : facing));
      if (!intensity) continue;
      const cookie = AreaLights.transmission(source,hit.point);
      light(dir,d,source.linearRGB.map((n,c)=>n*cookie[c]),intensity,source.shadows,'local');
    }
  }

  function path(ray, sx, sy, rng, output) {
    let origin = ray.origin, direction = ray.direction, diffuse = 0, transmitted = false;
    const throughput = [1,1,1], media = new Map();
    function add(light, indirect, through = transmitted) {
      for (let c=0;c<3;c++) {
        const amount = throughput[c]*light[c];
        output[c] += amount;
        if (indirect) sumIndirect[c] += amount;
        if (through) sumThrough[c] += amount;
      }
    }
    for (let i=0;i<transportLimit;i++) {
      const hit = intersect(origin,direction,i ? 0 : clipNear/ray.axial,i ? far : clipFar/ray.axial);
      if (!hit) {
        const light = i ? environment(direction) : sky ? environment(skyRay?.(sx,sy).direction ?? direction) : background;
        add(light,diffuse>1);
        return i > 0;
      }
      const { profile, front } = hit, normal = front ? hit.normal : hit.normal.map(n=>-n);
      let anchor = hit;
      attenuate(throughput,media,hit.t);
      if (profile.em) add(profile.em,diffuse>1);
      const { glass, thin, albedo } = profile;
      if (glass) {
        const cos = clamp(-dot(normal,direction));
        const current = [...media.values()].at(-1)?.ior ?? (front ? 1 : glass.ior);
        const exterior = [...media.entries()].filter(([source])=>source!==hit.source).at(-1)?.[1].ior ?? 1;
        const ratio = current / (front ? glass.ior : exterior);
        const discriminant = 1-ratio*ratio*(1-cos*cos);
        if (discriminant < 0 || rng() < Optical.fresnel(glass.reflect,cos)) {
          direction = along(direction,normal,2*cos);
          multiply(throughput,glass.mirrorTint);
        } else {
          direction = unit(along(direction.map(n=>n*ratio),normal,ratio*cos-Math.sqrt(discriminant)));
          multiply(throughput,glass.interfaceTint);
          if (front) {
            media.set(hit.source,glass);
            for (let c=0;c<3;c++) throughput[c] *= glass.uncovered;
          } else media.delete(hit.source);
          transmitted = true;
        }
      } else {
        if (diffuse > bounces) break;
        direct(hit,normal,rng,media,(light,through) => add(light,diffuse>0,transmitted || through));
        const through = thin && rng() < thin.strength*Math.exp(-thin.thickness);
        multiply(throughput,through ? thin.rgb : albedo);
        direction = hemisphere(through ? normal.map(n=>-n) : normal,rng);
        if (through) {
          const exit = intersect(along(hit.point,hit.normal,front ? -bias : bias),direction,0,far,[hit.source]);
          if (exit && !exit.front) anchor = exit;
          transmitted = true;
        }
        diffuse++;
      }
      if (Math.max(...throughput)<.0001) break;
      // Offset along the geometric normal to leave the hit even at grazing angles.
      origin = along(anchor.point,anchor.normal,dot(anchor.normal,direction) > 0 ? bias : -bias);
    }
    return true;
  }

  for (let y=0,p=0;y<h;y++) for (let x=0;x<w;x++,p++) {
    const ry = h-y-1, j = p*3;
    const center = rayAt(x+.5,ry+.5);
    const hit = intersect(center.origin,center.direction,clipNear/center.axial,clipFar/center.axial);
    if (hit) {
      depth[p] = hit.t*center.axial;
      normals.set(hit.normal,j);
      spacing[p] = support(hit);
    }
    even.fill(0); odd.fill(0); sumIndirect.fill(0); sumThrough.fill(0);
    let hits = 0;
    for (let s=0;s<samples;s++) {
      const rng = random(Math.imul(p+1,0x9e3779b1) ^ Math.imul(s+1,0x85ebca77) ^ seed);
      const cell = s>>1, sx = x+(cell+rng())/half, sy = ry+(strata[cell]+rng())/half;
      if (path(rayAt(sx,sy),sx,sy,rng,s&1 ? odd : even)) hits++;
    }
    coverage[p] = hits/samples;
    const mean = Array.from(even,(n,c)=>(n+odd[c])/samples);
    rgb.set(film(mean,255).map(Math.round),j);
    // Scale for display only. The count threshold below uses linear radiance.
    const bounce = Array.from(sumIndirect,n=>n/samples), through = Array.from(sumThrough,n=>n/samples);
    indirect.set(film(bounce,255).map(Math.round),j);
    transmission.set(film(through,255).map(Math.round),j);
    if (Math.max(...bounce) > .005) transport.indirectPixels++;
    if (Math.max(...through) > .005) transport.transmissionPixels++;
    const a = film(Array.from(even,n=>2*n/samples),1), b = film(Array.from(odd,n=>2*n/samples),1);
    sampling[p] = Math.max(...a.map((n,c)=>Math.abs(n-b[c])));
  }
  return { w,h,rgb,indirect,transmission,coverage,depth,normals,sampling,spacing,rows,stats: { ...stats, ...transport } };
}

module.exports = { trace };
