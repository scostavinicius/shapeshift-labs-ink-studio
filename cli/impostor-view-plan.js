const Atlas = require('../src/atlas-sprites.js');
const Selectors = require('../src/target-selectors.js');
const Errors = require('./impostor-error.js');

const tau=2*Math.PI;
const integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
const fields=['minDirections','probes','tolerance','poseSamples','protect'];

function prepare(value, { directions,width,height,times,pitches }) {
  if (value===undefined || value===false) return null;
  if (value===true) value={};
  if (!value || Object.getPrototypeOf(value)!==Object.prototype || Object.keys(value).some(key=>!fields.includes(key)))
    throw new TypeError('Adaptive views need minDirections, probes, tolerance, poseSamples or protect');
  const { minDirections=Math.min(4,directions), probes=Math.max(48,Math.min(192,directions*8)),
    tolerance=.045, poseSamples=3, protect=[] }=value;
  if (!integer(directions,2,64) || !integer(minDirections,2,directions) ||
      !integer(probes,Math.max(8,directions*2),192) || !integer(poseSamples,1,8) ||
      !Number.isFinite(tolerance) || tolerance<0 || tolerance>1 || !Array.isArray(protect) || protect.length>16)
    throw new RangeError('Invalid adaptive view budget, pose samples, protection or error tolerance');
  if (new Set(pitches).size!==pitches.length || pitches.some(p=>Math.abs(p)>=Math.PI/2))
    throw new RangeError('Adaptive elevations need distinct pitches short of the poles');
  // Include the evenly spaced initial headings exactly, even when the requested probe count varies.
  const count=Math.ceil(probes/minDirections)*minDirections;
  const sampleCount=Math.min(poseSamples,times.length);
  const samples=Array.from({length:sampleCount},(_,i)=>sampleCount===1 ?
    Math.floor((times.length-1)/2) : Math.round(i*(times.length-1)/(sampleCount-1)));
  if (count*width*height*pitches.length*sampleCount>8e6 || directions*pitches.length>192)
    throw new RangeError('Adaptive assessment supports eight million probe pixels and up to 192 output views per pose');
  return { directions,minDirections,count,tolerance,samples,protect:protect.map(Selectors.prepare) };
}

function probeViews(yaw,pitches,count) {
  return pitches.flatMap((pitch,ring)=>Array.from({length:count},(_,i)=>({yaw:yaw+i*tau/count,pitch,ring})));
}

function summaries(scores) {
  return { mean:scores.reduce((a,b)=>a+b,0)/scores.length, max:Math.max(...scores) };
}

function selectViews({ probes, pitches, captured, settings }) {
  const {directions,minDirections,count,tolerance}=settings;
  const axes=probes.map(({yaw,pitch})=>Atlas.basis(yaw,pitch).normal);
  const cache=axes.map(()=>new Float64Array(axes.length).fill(-1));
  function error(reference,tile) {
    if (reference===tile) return 0;
    if (cache[reference][tile]<0) {
      const scores=captured[reference].map((frame,i)=>Errors.compare(frame,captured[tile][i]).score);
      cache[reference][tile]=cache[tile][reference]=Math.max(...scores);
    }
    return cache[reference][tile];
  }
  const selected=new Set(), sizes=pitches.map(()=>minDirections), added=pitches.map(()=>[]);
  for (let ring=0;ring<pitches.length;ring++)
    for (let i=0;i<minDirections;i++) selected.add(ring*count+i*count/minDirections);
  const anchors=[...selected], nearest=axes.map(axis=>anchors.reduce((best,tile)=>
    Atlas.dot(axes[tile],axis)>Atlas.dot(axes[best],axis)?tile:best));
  const dot=nearest.map((tile,p)=>Atlas.dot(axes[p],axes[tile]));
  const scores=nearest.map((tile,p)=>error(p,tile)), initial=scores.slice();
  const outranks=(p,tile,d)=>d>dot[p] || d===dot[p] && tile<nearest[p];

  // A view can win only at probes that it already outranks with the initial atlas.
  // Save those angular candidates once. Later additions can only shorten the list.
  const neighbors=axes.map((axis,tile)=>{
    if (selected.has(tile)) return [];
    const candidates=[];
    for (let p=0;p<axes.length;p++) {
      const d=Atlas.dot(axes[p],axis);
      if (outranks(p,tile,d)) candidates.push(p,d);
    }
    return candidates;
  });
  function localGroup() {
    const residual=probes.map((_,p)=>p).filter(p=>!selected.has(p) && scores[p]>tolerance)
      .sort((a,b)=>scores[b]-scores[a] || a-b).slice(0,12);
    let best=[], improvement=1e-12;
    for (const p of residual) {
      const {ring}=probes[p], start=ring*count, index=p-start;
      const previous=start+(index+count-1)%count, next=start+(index+1)%count;
      for (const group of [[p,previous],[p,next],[p,previous,next]]) {
        const proposal=group.filter(tile=>!selected.has(tile));
        if (proposal.length<2 || sizes[ring]+proposal.length>directions) continue;
        // Narrow events can need a neighbor to keep the high-contrast view from replacing calm tiles.
        const replacements=new Map();
        for (const tile of proposal) {
          const candidates=neighbors[tile];
          for (let j=0;j<candidates.length;j+=2) {
            const q=candidates[j], d=candidates[j+1], other=replacements.get(q);
            if (!outranks(q,tile,d) || other && (other.d>d || other.d===d && other.tile<tile)) continue;
            replacements.set(q,{tile,d});
          }
        }
        let gain=0;
        for (const [q,{tile}] of replacements) gain+=scores[q]**2-error(q,tile)**2;
        if (gain>improvement) { best=proposal; improvement=gain; }
      }
    }
    return best;
  }
  function add(tile) {
    const prior=nearest[tile], {yaw,ring}=probes[tile];
    const reasons=captured[tile].map((frame,i)=>Errors.compare(frame,captured[prior][i]))
      .reduce((a,b)=>a.score>=b.score?a:b);
    added[ring].push({ yaw,replaces:probes[prior].yaw,replacesPitch:probes[prior].pitch,...reasons });
    selected.add(tile);
    sizes[ring]++;
    const candidates=neighbors[tile];
    for (let j=0;j<candidates.length;j+=2) {
      const p=candidates[j], d=candidates[j+1];
      if (!outranks(p,tile,d)) continue;
      nearest[p]=tile;
      dot[p]=d;
      scores[p]=error(p,tile);
    }
  }
  while (Math.max(...scores)>tolerance) {
    let best=-1, gain=1e-12;
    for (let tile=0;tile<axes.length;tile++) {
      if (selected.has(tile) || sizes[probes[tile].ring]>=directions) continue;
      let improvement=0;
      const candidates=neighbors[tile];
      // Squared loss prioritizes large errors and accounts for every tile the new view will displace.
      for (let j=0;j<candidates.length;j+=2) {
        const p=candidates[j];
        if (!outranks(p,tile,candidates[j+1])) continue;
        const candidate=error(p,tile);
        improvement+=scores[p]**2-candidate**2;
      }
      if (improvement>gain) { best=tile; gain=improvement; }
    }
    const proposal=best<0 ? localGroup() : [best];
    if (!proposal.length) break;
    for (const tile of proposal) add(tile);
  }
  const yaws=pitches.map(()=>[]);
  for (let i=0;i<probes.length;i++) if (selected.has(i)) {
    const {ring,yaw}=probes[i];
    yaws[ring].push(yaw);
  }
  return pitches.map((pitch,ring)=>({ pitch,yaws:yaws[ring],
    initial:summaries(initial.slice(ring*count,(ring+1)*count)),
    final:summaries(scores.slice(ring*count,(ring+1)*count)),added:added[ring] }));
}

module.exports = { prepare, probeViews, selectViews };
