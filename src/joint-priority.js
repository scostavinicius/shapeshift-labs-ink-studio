/* One set of take-time windows for visible subject rows and spatial voices. */
const JointPriority=(()=>{
  const targets=typeof TargetSelectors==='undefined' ? require('./target-selectors.js') : TargetSelectors;
  const voice=typeof WorldVoiceBudget==='undefined' ? require('./world-voice-budget.js') : WorldVoiceBudget;
  const fields=(value,keys)=>value && [Object.prototype,null].includes(Object.getPrototypeOf(value)) &&
    Object.keys(value).every(key=>keys.includes(key));
  const time=value=>Number.isFinite(value) && value>=0 && value<=3600;
  function prepare(value){
    if(value===undefined||value===false)return null;
    if(!fields(value,['id','windows'])||!targets.name(value.id)||!Array.isArray(value.windows)||
      value.windows.length<1||value.windows.length>128)
      throw new TypeError('Expected a joint picture and sound priority track');
    let previous=0;
    const ids=new Set();
    const windows=Array.from(value.windows,row=>{
      if(!fields(row,['id','from','to','picture','sound'])||!targets.name(row.id)||ids.has(row.id)||
        !time(row.from)||!time(row.to)||row.to<=row.from||row.from<previous||
        !fields(row.picture,['subjects','particleRetain'])||!Array.isArray(row.picture.subjects)||
        row.picture.subjects.length<1||row.picture.subjects.length>64||
        !Number.isFinite(row.picture.particleRetain)||row.picture.particleRetain<0||row.picture.particleRetain>1)
        throw new RangeError('Joint priority windows need distinct IDs, ordered times, subjects and a particle fraction');
      const subjects=Object.freeze(Array.from(row.picture.subjects,targets.prepare));
      if(subjects.some(select=>'medium' in select||'mediumKind' in select))
        throw new TypeError('Joint priority picture selectors need a surface subject');
      ids.add(row.id);
      previous=row.to;
      return Object.freeze({id:row.id,from:row.from,to:row.to,
        picture:Object.freeze({subjects,particleRetain:row.picture.particleRetain}),sound:voice.compilePriority(row.sound)});
    });
    return Object.freeze({id:value.id,windows:Object.freeze(windows)});
  }
  function at(windows,time){
    let low=0,high=windows.length;
    while(low<high){
      const middle=(low+high)>>>1;
      if(windows[middle].from<=time)low=middle+1;
      else high=middle;
    }
    const row=windows[low-1];
    return row && time<row.to ? row : undefined;
  }
  function forSamples(track,rate,T){
    if(!track)return [];
    const position=time=>{
      const exact=T.mul(T.read(time),T.read(rate));
      return -T.index(T.roundDown([-exact[0],exact[1]]));
    };
    return track.windows.map(row=>({...row,from:position(row.from),to:position(row.to)})).filter(row=>row.from<row.to);
  }
  return Object.freeze({prepare,at,forSamples});
})();
if(typeof module!=='undefined')module.exports=JointPriority;
