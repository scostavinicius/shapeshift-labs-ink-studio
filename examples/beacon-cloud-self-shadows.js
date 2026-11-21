const beacon = require('./review-beacon.js');
const reviewCamera = require('./environment-review-camera.js');

const billows = [
  [-11.2,5.20,-15.9,4.7,1.60,3.10], [-7.7,5.25,-15.5,4.6,1.85,3.50],
  [-3.7,5.51,-16.0,4.5,2.24,4.30], [1.2,5.42,-16.4,4.9,2.12,3.80],
  [4.7,5.25,-17.0,3.3,1.65,3.10], [7.0,4.92,-17.8,2.7,1.28,2.45],
  [-10.1,6.41,-17.4,2.55,1.60,2.65], [-7.2,7.21,-16.3,2.32,1.72,2.35],
  [-4.7,7.48,-17.9,2.55,2.01,3.11], [-1.6,7.03,-16.7,2.81,1.84,2.20],
  [1.4,6.63,-15.9,2.30,1.55,2.61], [3.6,6.18,-18.0,2.42,1.73,2.20],
  [-6.8,5.52,-12.6,2.9,1.25,2.0], [-3.3,5.32,-12.3,2.6,1.33,2.15],
  [0.0,5.04,-12.9,3.1,1.17,1.87], [3.4,5.04,-14.0,2.5,1.34,1.98],
  [-9.5,4.17,-14.8,2.42,.83,1.76], [-5.1,3.97,-14.1,2.94,.97,2.37],
  [-.9,4.13,-15.6,3.17,.93,2.6], [4.3,4.31,-15.4,2.46,.92,1.94]
];
const stormDensity = {
  bounds:{min:[-17,2.8,-22],max:[10,10.1,-9.8]},
  sample(x,y,z) {
    let body=-Infinity;
    for (const [cx,cy,cz,rx,ry,rz] of billows) {
      const radius=((x-cx)/rx)**2+((y-cy)/ry)**2+((z-cz)/rz)**2;
      body=Math.max(body,1-radius);
    }
    const breakup=.092*Math.sin(4.7*x+.4*z)*Math.sin(6.3*y-.62*x)*Math.cos(3.5*z+1.3*y)
      +.14*Math.sin(1.45*x+1.6*y)*Math.cos(2.1*z-.25*x);
    const t=Math.max(0,Math.min(1,(body+breakup)*1.85));
    return t*t*(3-2*t);
  }
};

module.exports = kit => {
  const base = beacon(kit);
  const duration = 4.8;
  const camera = reviewCamera([
    {time:0, target:[-.72,2.28,-.8], dist:14.4, yaw:.06, pitch:.11},
    {time:duration, target:[-.45,2.20,-.8], dist:14.4, yaw:-.11, pitch:.12}
  ]);
  return {
    ...base, id:'beacon-cloud-self-shadows', name:'Storm front over the beacon',
    review:{duration,checkpoints:[0,2.4,4.6]},
    animate:camera.animate,
    build(seed) {
      const world=base.build(seed);
      const direction=kit.KIT.V.norm([-.75,.50,.44]);
      return { ...world, cam:{...camera.at(0),sway:0},
        liveSun:{...world.liveSun,direction},
        cloudField:kit.KIT.clouds.asset({
          field:stormDensity, density:.68, densityResolution:[108,43,60],
          opacity:.97, velocity:[2.45,.20],
          color:'#343b53', lighting:{color:'#f8dec1',ambient:.21,strength:.95,rim:.29},
          selfShadows:{strength:1,distance:16,steps:8}
        },{
          resolution:88,directions:12,cardYaw:-.28
        }),
        cloudRepresentation:'volume'
      };
    }
  };
};
