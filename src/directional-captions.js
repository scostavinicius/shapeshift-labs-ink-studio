/* Direction and burst rules shared by recorded and live playback. */
const InkDirectionalCaptions = (() => {
  const format = 'ink-studio/directional-captions';
  const fields = (value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).every(key=>keys.includes(key));
  const integer = (value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
  const token = value=>typeof value==='string'&&value.trim()&&value.length<=512;
  const text = value=>token(value)&&value.length<=100&&!/[\x00-\x1f\x7f]/u.test(value);
  const vector = value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
  const dot = (a,b)=>a.reduce((sum,value,index)=>sum+value*b[index],0);
  const norm = v=>{
    const length = Math.hypot(...v);
    return length>1e-6?v.map(n=>n/length):null;
  };
  const cross = ([x,y,z],[a,b,c])=>[y*c-z*b,z*a-x*c,x*b-y*a];
  const labels = {ahead:'ahead',behind:'behind you',left:'to your left',right:'to your right',
    above:'above you',below:'below you','ahead-left':'ahead to your left','ahead-right':'ahead to your right',
    'behind-left':'behind you to the left','behind-right':'behind you to the right'};
  const captionText = (group) => {
    const {rule,count,opening,direction} = group;
    const headline = count>1?(rule.burstText??rule.text)+' (×'+count+')':rule.text;
    return [headline,opening&&'through a doorway',Object.hasOwn(labels,direction)&&labels[direction]].filter(Boolean).join(' · ');
  };
  const check = (condition,message)=>{if (!condition) throw new TypeError(message);};

  function direction(at, ear) {
    if (!vector(at)||!vector(ear?.position)||!vector(ear.forward)||!vector(ear.up)) return null;
    const delta = norm(at.map((value,index)=>value-ear.position[index]));
    const forward = norm(ear.forward), right = forward&&norm(cross(forward,ear.up));
    if (!delta||!right) return null;
    const up = cross(right,forward);
    const elevation = dot(delta,up);
    if (elevation>=.574) return 'above';
    if (elevation<=-.574) return 'below';
    const angle = Math.atan2(dot(delta,right),dot(delta,forward));
    const index = (Math.round(angle/(Math.PI/4))+8)%8;
    return ['ahead','ahead-right','right','behind-right','behind','behind-left','left','ahead-left'][index];
  }

  function compile(plan,sampleRate) {
    check(fields(plan,['format','version','rules','mergeMs','holdMs'])&&plan.format===format&&plan.version===1&&
      integer(sampleRate,1,192000)&&Array.isArray(plan.rules)&&integer(plan.rules.length,1,512),
    'Expected a version 1 directional caption plan and a sample rate');
    const {rules,mergeMs=350,holdMs=1150} = plan;
    check(integer(mergeMs,0,1500)&&integer(holdMs,350,6000)&&mergeMs<=holdMs,
      'Caption mergeMs must fit the caption holdMs');
    const merge = Math.round(mergeMs*sampleRate/1000), hold = Math.round(holdMs*sampleRate/1000);
    const ids = new Set(), cues = new Map(), families = new Map();
    for (const row of rules) {
      check(fields(row,['id','cues','families','text','burstText','priority'])&&
        typeof row.id==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(row.id)&&!ids.has(row.id)&&
        text(row.text)&&(row.burstText===undefined||text(row.burstText))&&integer(row.priority??0,-100,100)&&
        (row.cues!==undefined||row.families!==undefined),'Invalid directional caption rule');
      ids.add(row.id);
      const rule = Object.freeze({id:row.id,text:row.text,burstText:row.burstText,priority:row.priority??0});
      for (const [values,map] of [[row.cues,cues],[row.families,families]]) {
        if (values===undefined) continue;
        check(Array.isArray(values)&&integer(values.length,1,128)&&values.every(token),'Invalid caption cue or family selectors');
        for (const value of values) {
          check(!map.has(value),'More than one caption rule for '+value);
          map.set(value,rule);
        }
      }
    }
    return Object.freeze({merge,hold,rule:({cue,family})=>cues.get(cue)??families.get(family)});
  }

  function group(compiled,events,{from=0,to=Number.MAX_SAFE_INTEGER}={}) {
    const keyed = new Map(), groups = [];
    for (const event of events.slice().sort((a,b)=>a.sample-b.sample)) {
      const {sample,opening=null,direction=null,beatId,eventId,receipt} = event;
      const rule = compiled.rule(event);
      if (!rule||!integer(sample,from,to-1)) continue;
      const key = JSON.stringify([rule.id,direction,opening]);
      let row = keyed.get(key);
      if (!row||sample-row.first>compiled.merge) {
        row = {rule,first:sample,last:sample,direction,opening,count:0,events:new Set(),beatIds:new Set(),receipts:[]};
        keyed.set(key,row);
        groups.push(row);
      }
      row.last = sample;
      const identity = beatId??eventId;
      if (identity===undefined||!row.events.has(identity)) row.count++;
      if (identity!==undefined) row.events.add(identity);
      if (beatId!==undefined) row.beatIds.add(beatId);
      if (receipt!==undefined) row.receipts.push(receipt);
    }
    return groups.map(row=>({id:row.rule.id,text:captionText(row),startSample:row.first,
      endSample:Math.min(to,row.last+compiled.hold),lastSample:row.last,count:row.count,
      direction:row.direction,opening:row.opening,priority:row.rule.priority,beatIds:[...row.beatIds],receipts:row.receipts}));
  }

  function live(plan,rate) {
    const compiled = compile(plan,rate);
    const pending = new Map(), heard = [];
    const stamp = time=>Math.round(time*rate);
    let groupCache = [];
    let revision = 0, lastRevision = -1;

    function advance(sample,ear) {
      for (const [key,row] of pending) {
        if (row.sample>sample) continue;
        pending.delete(key);
        record({...row,direction:direction(row.at,ear)});
      }
      const cutoff = sample-compiled.hold-compiled.merge;
      // Asynchronous worklet confirmations can arrive after direct voices.
      for (let index=heard.length-1;index>=0;index--) if (heard[index].sample<=cutoff) {
        heard.splice(index,1);
        revision++;
      }
    }
    function record(row) {
      if (!compiled.rule(row)) return;
      heard.push(row);
      if (heard.length>4096) heard.shift();
      revision++;
    }
    return {
      stamp, advance,
      offers: cue=>Boolean(compiled.rule(cue)),
      queue(key,row) {
        if (!compiled.rule(row)) return;
        if (pending.size>=4096) pending.delete(pending.keys().next().value);
        pending.set(key,row);
      },
      cancel(key) { pending.delete(key); },
      confirm(row,ear) { record({...row,direction:direction(row.at,ear)}); },
      reset() { pending.clear(); heard.length=0; revision++; },
      read(sample,ear) {
        advance(sample,ear);
        if (lastRevision!==revision) {
          groupCache = group(compiled,heard).map(row=>Object.freeze({...row,beatIds:Object.freeze(row.beatIds),
            receipts:Object.freeze(row.receipts)}));
          lastRevision = revision;
        }
        return Object.freeze(groupCache.filter(row=>row.startSample<=sample&&row.endSample>sample)
          .sort((a,b)=>b.priority-a.priority||a.startSample-b.startSample));
      }
    };
  }

  return Object.freeze({format,compile,direction,group,live,validDirection:value=>Object.hasOwn(labels,value)});
})();
if (typeof module!=='undefined') module.exports = InkDirectionalCaptions;
else globalThis[Symbol.for('ink-studio.directional-captions')] = InkDirectionalCaptions;
