/* Deterministic admission shared by live Web Audio and recorded spatial soundtracks. */
const WorldVoiceBudget=(()=>{
  const limits=['maxVoices','reservedVoices','groups','stealFade','aggregation'];
  const record=value=>value&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const group=name=>typeof name==='string'&&/^[A-Za-z0-9_][A-Za-z0-9._/-]{0,127}$/.test(name);
  const validVoice=voice=>(voice.priority===undefined||integer(voice.priority,-100,100))&&
    (voice.protected===undefined||typeof voice.protected==='boolean')&&(voice.group===undefined||group(voice.group));

  function compileAggregation(raw){
    if(!record(raw)||Object.keys(raw).some(key=>!['groups','sectors','maxPriority','grain','gain','bus'].includes(key)))
      throw TypeError('Invalid voice aggregation settings');
    const {groups,sectors=4,maxPriority=0,grain=.125,gain=.72,bus='effects'}=raw;
    if(!Array.isArray(groups)||!integer(groups.length,1,32)||!Array.from(groups).every(group)||new Set(groups).size!==groups.length||
      !integer(sectors,1,8)||!integer(maxPriority,-100,0)||!Number.isFinite(grain)||grain<.025||grain>.3||
      !Number.isFinite(gain)||gain<0||gain>1||!['foley','effects','ambience'].includes(bus))
      throw TypeError('Invalid voice aggregation settings');
    return Object.freeze({groups:Object.freeze([...groups]),sectors,maxPriority,grain,gain,bus});
  }
  function compile(raw){
    if(!record(raw)||Object.keys(raw).some(key=>!limits.includes(key)))throw TypeError('Invalid world voice budget');
    const {maxVoices=32,reservedVoices=Math.min(3,maxVoices-1),groups={},stealFade=.008,aggregation}=raw;
    if(!integer(maxVoices,1,128)||!integer(reservedVoices,0,maxVoices)||!record(groups)||
      Object.keys(groups).length>128||!Object.entries(groups).every(([name,count])=>group(name)&&integer(count,0,128))||
      !Number.isFinite(stealFade)||stealFade<0||stealFade>.05)throw TypeError('Invalid world voice budget');
    return Object.freeze({maxVoices,reservedVoices,groups:Object.freeze({...groups}),stealFade,
      ...(aggregation!==undefined&&{aggregation:compileAggregation(aggregation)})});
  }

  function compilePriority(raw){
    if(!record(raw)||Object.keys(raw).some(key=>!['cues','backgroundVoices','groups'].includes(key)))
      throw new TypeError('Invalid joint priority sound settings');
    const {cues,backgroundVoices,groups={}}=raw;
    if(!Array.isArray(cues)||!integer(cues.length,1,64)||!Array.from(cues).every(cue=>
      typeof cue==='string'&&cue.trim()&&cue.length<=512)||new Set(cues).size!==cues.length||
      !integer(backgroundVoices,0,128)||!record(groups)||Object.keys(groups).length>64||
      !Object.entries(groups).every(([name,count])=>group(name)&&integer(count,0,128)))
      throw new RangeError('Joint priorities need cue names and bounded background voice caps');
    return Object.freeze({cues:Object.freeze(cues.slice()),backgroundVoices,groups:Object.freeze({...groups})});
  }
  function prioritize(candidates,policy,rule){
    if(!rule)return {candidates,policy};
    const cues=new Set(rule.cues);
    return {
      candidates:candidates.map(row=>cues.has(row.cue)?
        {...row,protected:true,priority:100,priorityDirect:true}:row),
      policy:{...policy,reservedVoices:Math.max(policy.reservedVoices,policy.maxVoices-rule.backgroundVoices),
        backgroundGroups:rule.groups,aggregation:undefined}
    };
  }

  function select(candidates,policy,stable=true){
    const ordered=[...candidates].sort((a,b)=>Number(Boolean(b.protected))-Number(Boolean(a.protected))||
      (b.priority??0)-(a.priority??0)||b.gain-a.gain||
      (stable?(Number(Boolean(b.incumbent))-Number(Boolean(a.incumbent))||(a.id<b.id?-1:a.id>b.id?1:0)):0));
    const local=policy.backgroundGroups, unprotected=local&&new Map();
    const selected=new Set(), rejected=new Map(), counts=new Map();
    let background=0;
    for(const voice of ordered){
      const {id,group}=voice;
      const count=counts.get(group)??0, cap=group!==undefined&&Object.hasOwn(policy.groups,group)?policy.groups[group]:Infinity;
      const groupBackground=unprotected?.get(group)??0;
      if(count>=cap&&!voice.priorityDirect)rejected.set(id,'group-limit');
      else if(!voice.protected&&local&&group!==undefined&&Object.hasOwn(local,group)&&groupBackground>=local[group])
        rejected.set(id,'priority-group-limit');
      else if(selected.size>=policy.maxVoices)rejected.set(id,'voice-limit');
      else if(!voice.protected&&background>=policy.maxVoices-policy.reservedVoices)rejected.set(id,'reserved');
      else{
        selected.add(id);
        if(!voice.protected){background++;if(local)unprotected.set(group,groupBackground+1);}
        counts.set(group,count+1);
      }
    }
    return Object.freeze({selected,rejected});
  }
  function selectWithTextures(candidates,policy,active=false,stable=true){
    const full=select(candidates,policy,stable), config=policy.aggregation;
    const unchanged={...full,seats:0,overflow:new Set()};
    if(!config||!config.gain)return unchanged;
    const seats=Math.min(config.sectors,policy.maxVoices-Math.max(1,policy.reservedVoices));
    if(seats<=0)return unchanged;
    const eligible=voice=>voice.mode==='cue'&&!voice.protected&&voice.position&&(voice.queueDelay??((voice.delay??0)+(voice.startDelay??0)))<=.5&&voice.bus!=='dialogue'&&voice.bus!=='music'&&
      config.groups.includes(voice.group)&&(voice.priority??0)<=config.maxPriority;
    const incoming=candidates.filter(voice=>!voice.incumbent&&eligible(voice));
    if(!active&&!incoming.some(voice=>full.rejected.has(voice.id)))return unchanged;
    const split=select(candidates,{...policy,maxVoices:policy.maxVoices-seats},stable);
    if(candidates.some(voice=>!eligible(voice)&&full.selected.has(voice.id)&&!split.selected.has(voice.id)))return unchanged;
    return {...split,seats,overflow:new Set(incoming.filter(voice=>split.rejected.has(voice.id)).map(voice=>voice.id))};
  }
  return Object.freeze({compile,compilePriority,prioritize,select,selectWithTextures,validVoice});
})();
if (typeof module !== 'undefined') module.exports = WorldVoiceBudget;
else globalThis[Symbol.for('ink-studio.world-voice-budget')] = WorldVoiceBudget;
