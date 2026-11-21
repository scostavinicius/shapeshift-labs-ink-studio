/* Receiver-local reflection filtering shared by planar and probe captures. */
const ReflectionDetail = (() => {
  const dot = (a,b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const cross = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const number = (n,a,b) => Number.isFinite(n) && n>=a && n<=b;
  const pair = (v,a,b) => Array.isArray(v) && v.length===2 && Array.from(v).every(n=>number(n,a,b));

  function prepare(value) {
    if (value === undefined || value === false) return undefined;
    if (value === true) value = {};
    if (!value || Object.getPrototypeOf(value)!==Object.prototype ||
        Object.keys(value).some(key=>!['core','stretch','direction','rotation','distance','cluster'].includes(key)))
      throw new TypeError('Invalid reflection detail settings');
    const {core=.6,stretch=[2,.55],direction='ripple',rotation=0,distance,cluster=3} = value;
    if (!number(core,0,1) || !pair(stretch,0,64) || !['ripple','surface'].includes(direction) ||
        !Number.isFinite(rotation) || !Number.isFinite(Math.fround(rotation)) ||
        !Number.isInteger(cluster) || !number(cluster,1,16) ||
        distance!==undefined && (!pair(distance,0,1e6) || Math.fround(distance[1])<=Math.fround(distance[0])))
      throw new RangeError('Reflection detail needs core in [0,1], stretch in [0,64], a direction, an increasing distance and cluster in [1,16]');
    return {core,stretch:stretch.slice(),direction,rotation,cluster,...(distance && {distance:distance.slice()})};
  }

  function weight(detail, depth = 0) {
    if (!detail.distance) return 0;
    const [near,far] = detail.distance;
    const t = Math.min(1,Math.max(0,(depth-near)/(far-near)));
    return t*t*(3-2*t);
  }

  function axis(detail, normal, perturbed, tangent) {
    const crest = detail.direction==='ripple' && cross(normal,perturbed);
    const length = crest && Math.hypot(...crest);
    const u = length>1e-8 ? crest.map(n=>n/length) : tangent;
    if (!detail.rotation) return u;
    const v = cross(normal,u), c = Math.cos(detail.rotation), s = Math.sin(detail.rotation);
    return u.map((n,i)=>n*c+v[i]*s);
  }

  // Seven taps with fixed weights so nearby streaks do not flicker between sample counts.
  function streak(along, across, gain, tap) {
    if (!along && !across) return tap(0,0,gain);
    tap(0,0,gain*.32);
    for (const sign of [-1,1]) {
      tap(along*sign,0,gain*.17);
      tap(along*sign*.5,0,gain*.12);
      tap(0,across*sign,gain*.05);
    }
  }

  function planar(detail, {x,y,dx,dy,u,v,depth,blur,scale}, tap, block) {
    const far = weight(detail,depth), core = detail.core*(1-far), tail = (1-detail.core)*(1-far);
    if (core) tap(x,y,core);
    if (tail) {
      const length = Math.hypot(u,v), a = length>1e-8 ? u/length : 1, b = length>1e-8 ? v/length : 0;
      streak(Math.hypot(detail.stretch[0]*scale,blur),Math.hypot(detail.stretch[1]*scale,blur),tail,
        (along,across,weight)=>tap(x+dx+a*along-b*across,y+dy+b*along+a*across,weight));
    }
    if (far) {
      const cell = detail.cluster*scale;
      if (cell<=1) tap(x,y,far);
      else block(x,y,cell,far);
    }
  }

  return Object.freeze({ prepare, weight, axis, streak, planar });
})();
if (typeof module !== 'undefined') module.exports = ReflectionDetail;
