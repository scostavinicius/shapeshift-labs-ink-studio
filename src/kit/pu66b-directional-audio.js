/* Source-local polar pressure response for low, middle and high frequencies. */
(function(K){
  const W=K.world,{V,M}=K,{check,copy,record,vector}=W.data;
  const bands=['low','mid','high'], unit=n=>Number.isFinite(n)&&n>=-72&&n<=0;
  const fields=(value,names)=>record(value)&&Object.keys(value).every(name=>names.includes(name));
  function compile(raw){
    const profile=copy(raw);
    check(fields(profile,['forward','points']),'Invalid sound radiation profile');
    const {forward=[0,0,-1],points}=profile;
    check(vector(forward)&&V.len(forward)>1e-6&&forward.every(n=>Math.abs(n)<=1e6)&&
      Array.isArray(points)&&points.length>=2&&points.length<=36,'Invalid sound radiation axis or polar curve');
    let prior=-1;
    for(const point of points){
      check(fields(point,['angle','db'])&&Number.isFinite(point.angle)&&point.angle>prior&&point.angle<=180&&
        fields(point.db,bands)&&bands.every(band=>unit(point.db[band])),'Invalid sound radiation angle or band level');
      prior=point.angle;
    }
    check(points[0].angle===0&&points.at(-1).angle===180,'Sound radiation curve must span 0 to 180 degrees');
    const axis=V.norm(forward);
    function orient(rotation){return rotation?V.norm(M.app(rotation,axis)):axis.slice();}
    function sample(direction,departure){
      const delta=V.len(departure)>1e-8?V.dot(direction,V.norm(departure)):1;
      const angle=Math.min(180,Math.acos(Math.max(-1,Math.min(1,delta)))*180/Math.PI);
      const upper=points.findIndex(point=>point.angle>=angle);
      const b=points[upper],a=points[Math.max(0,upper-1)];
      const t=a===b?0:(angle-a.angle)/(b.angle-a.angle);
      const db=Object.fromEntries(bands.map(band=>[band,a.db[band]+t*(b.db[band]-a.db[band])]));
      return {angle,db};
    }
    return Object.freeze({orient,sample});
  }
  W.directionalAudio=Object.freeze({compile});
})(KIT);
