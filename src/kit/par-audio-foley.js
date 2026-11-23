/* Turn committed world contacts into editable, perspective-matched editorial clips. */
(function (K) {
  const P=K.procedural,A=P.mediaGraph,S=P.mediaGraphSupport;
  const {fields,record,id,integer,finite,check}=P.musicInstruments;
  const perspectives=['close','distant'];
  function named(raw,min,max,label) {
    check(record(raw),'Expected '+label);
    const rows=Object.entries(raw);
    check(integer(rows.length,min,max) && rows.every(([name])=>id(name)),'Invalid '+label);
    return rows;
  }
  function plan(source,assets) {
    check(fields(source,['kit','picture','world','sampleRate','map','sourceEdits','bindings','perspective','seed']) &&
      fields(source.kit,['id','materials']) && id(source.kit.id) &&
      integer(source.sampleRate ?? 48000,8000,96000) && record(source.world) &&
      Array.isArray(source.bindings) && integer(source.bindings.length,1,64) &&
      integer(source.seed ?? 0,0,0xffffffff) && perspectives.includes(source.perspective ?? 'close'),
    'Expected a Foley kit, picture, committed world ledger, and bindings');
    const Q=K.world.query;
    const {kit,picture,world,map,sourceEdits,seed=0,sampleRate=48000,perspective='close'}=source;
    const clock=S.editorialClock({picture,world,map,sampleRate}), materials=new Map();
    for (const [material,sounds] of named(kit.materials,1,64,'Foley materials')) {
      const actions=new Map();
      for (const [action,variants] of named(sounds,1,32,'Foley actions')) {
        const pairs=named(variants,1,8,'Foley performances').sort(([a],[b])=>a<b ? -1 : 1);
        for (const [name,pair] of pairs) {
          check(fields(pair,perspectives) && perspectives.every(side=>id(side+'-'+name) && record(pair[side]) && id(pair[side].asset)),
            'Each Foley performance needs a named close and distant take');
        }
        actions.set(action,pairs);
      }
      materials.set(material,actions);
    }
    const rules=new Map(), names=new Set();
    for (const row of source.bindings) {
      check(fields(row,['id','on','material','action','perspective','gain']) && id(row.id) && !names.has(row.id) &&
        fields(row.on,['kind','system','where']) && id(row.on.kind) && (row.on.system===undefined || id(row.on.system)) &&
        (row.material===undefined || materials.has(row.material)) &&
        (row.action===undefined || id(row.action)) && perspectives.includes(row.perspective ?? perspective) &&
        finite(row.gain ?? 1,0,4),'Invalid Foley event binding');
      names.add(row.id);
      if (!rules.has(row.on.kind)) rules.set(row.on.kind,[]);
      rules.get(row.on.kind).push(row);
    }
    const aliases=new Map();
    for (const name of Object.keys(world.aliases ?? {}).sort()) {
      const key=world.aliases[name];
      if (!aliases.has(key)) aliases.set(key,name);
    }
    const clips=[], contacts=[], skipped={}, used=new Set();
    const events=[...world.events].sort((a,b)=>a.tick-b.tick || (a.id<b.id ? -1 : 1));
    for (const event of events) for (const binding of rules.get(event.kind) ?? []) {
      if (binding.on.system!==undefined && binding.on.system!==event.system || !Q.condition(binding.on.where,event)) continue;
      const anchor=aliases.get(event.id) ?? event.id;
      const spot=clock.spot({event:anchor});
      if (spot.issue) {
        skipped[spot.issue]=(skipped[spot.issue] ?? 0)+1;
        continue;
      }
      const material=binding.material ?? event.material, action=binding.action ?? event.action;
      const pairs=materials.get(material)?.get(action);
      check(pairs,'Foley binding '+binding.id+' needs a kit action for '+String(material)+' / '+String(action));
      const strength=event.strength ?? 1;
      check(finite(strength,0,1),'Foley strength must be in [0,1]');
      const address=JSON.stringify([binding.id,anchor]), hash=P.data.hash;
      const key='foley-'+hash(address).toString(16)+'-'+hash(address,0x92d68ca2).toString(16);
      check(!used.has(key) && clips.length<512,'Foley exceeds its editable contact budget or has duplicate IDs');
      used.add(key);
      const [performance]=pairs[hash(address,seed)%pairs.length];
      const side=binding.perspective ?? perspective, take=side+'-'+performance;
      const takes=Object.fromEntries(pairs.flatMap(([variant,pair])=>perspectives.map(mic=>[mic+'-'+variant,pair[mic]])));
      clips.push({id:key,track:'foley',spot:{event:anchor},take,takes,gain:strength*(binding.gain ?? 1)});
      contacts.push({clip:key,binding:binding.id,event:anchor,eventId:event.id,material,action,performance,
        perspective:side,take,spot,alternates:Object.keys(takes).filter(name=>name!==take)});
    }
    const value=P.data.clone({format:'ink-studio/audio-editorial',version:1,id:kit.id,picture,world,sampleRate,clips,
      ...(map!==undefined && {map}),...(sourceEdits!==undefined && {sourceEdits})});
    A.audioEditorial.inspect(value,assets);
    return {value,report:{kit:kit.id,perspective,seed,contacts,skipped}};
  }
  A.foley=Object.freeze({plan});
})(KIT);
