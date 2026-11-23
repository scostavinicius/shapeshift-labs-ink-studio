/* Bond state for a small rigid lattice. Each edge survives or fails independently. */
(function(K){
  const W=K.world, {check,record,own}=W.data;
  const finite=(n,lo,hi)=>Number.isFinite(n)&&n>=lo&&n<=hi;
  const keys=(value,allowed)=>record(value)&&Object.keys(value).every(key=>allowed.includes(key));
  const keyOf=(a,b)=>a<b?a+'/'+b:b+'/'+a;
  const pair=(a,b)=>a<b?[a,b]:[b,a];
  const intact=bond=>bond.damage<bond.strength;

  function settings(raw){
    const {strength=1,impact=1,thermal=0,minCoolingRate=0}=raw??{};
    check(finite(strength,.000001,1e9)&&finite(impact,0,1e6)&&finite(thermal,0,1e6)&&
      finite(minCoolingRate,0,1e6),'Invalid bond strength or response');
    return {strength,impact,thermal,minCoolingRate};
  }
  function prepare(raw,selected,index,adjacent){
    check(keys(raw,['strength','impact','thermal','minCoolingRate','seams'])&&selected.length>=2,
      'Bonded pieces need at least two cells and valid fracture settings');
    const spec=settings(raw), {seams=[]}=raw, selectedSet=new Set(selected), overrides=new Map();
    check(Array.isArray(seams)&&seams.length<=36,'A compound accepts up to 36 seam overrides');
    for(const seam of seams){
      const {cells,strength}=seam??{};
      check(keys(seam,['cells','strength'])&&Array.isArray(cells)&&cells.length===2&&finite(strength,.000001,1e9),
        'A seam needs two face-neighbor cells and a strength');
      const [a,b]=cells.map(index), key=keyOf(a,b);
      check(selectedSet.has(a)&&selectedSet.has(b)&&adjacent[a].includes(b)&&!overrides.has(key),
        'Seams must be unique shared faces inside the lifted patch');
      overrides.set(key,strength);
    }
    return {spec,overrides};
  }

  function edges(partKeys,adjacent){
    const present=new Set(partKeys);
    return partKeys.flatMap(a=>adjacent[a].filter(b=>b>a&&present.has(b)).sort((a,b)=>a-b).map(b=>[a,b]));
  }
  function create({spec,overrides},cells,adjacent,temperature){
    const bonds=edges(Object.keys(cells).map(Number),adjacent).map(([a,b])=>
      ({a,b,strength:overrides.get(keyOf(a,b))??spec.strength,damage:0}));
    return {spec,bonds,faces:{},samples:Object.fromEntries(Object.entries(cells).map(([key,row])=>[key,temperature(row)]))};
  }

  function distances(first,bonds){
    const distance=new Map([[first,0]]), queue=[first];
    for(const key of queue)for(const bond of bonds){
      if(!intact(bond))continue;
      const next=bond.a===key?bond.b:bond.b===key?bond.a:undefined;
      if(next===undefined||distance.has(next))continue;
      distance.set(next,distance.get(key)+1);
      queue.push(next);
    }
    return distance;
  }
  function components(cells,bonds){
    const remaining=new Set(Object.keys(cells).map(Number)), result=[];
    for(const key of remaining){
      const group=[...distances(key,bonds).keys()].sort((a,b)=>a-b);
      for(const member of group)remaining.delete(member);
      result.push(group);
    }
    return result;
  }
  function update(previous,cells,loads,dt,adjacent,temperature){
    const {spec}=previous, {impact,thermal,minCoolingRate}=spec, open=previous.bonds.filter(intact);
    const samples=Object.fromEntries(Object.entries(cells).map(([key,row])=>[key,temperature(row)]));
    const stress=new Map(), failed=[];
    if(impact)for(const {cell,energy} of loads){
      const distance=distances(cell,open), weights=open.map(({a,b})=>
        0.28**Math.min(distance.get(a)??Infinity,distance.get(b)??Infinity));
      const total=weights.reduce((sum,weight)=>sum+weight,0);
      if(!total)continue;
      for(let i=0;i<open.length;i++){
        const bond=open[i], damage=energy*impact*(weights[i]/total);
        stress.set(bond,(stress.get(bond)??0)+damage);
      }
    }
    const faces={...previous.faces};
    const bonds=previous.bonds.map(bond=>{
      if(!intact(bond))return bond;
      const {a,b,strength}=bond, load=stress.get(bond)??0;
      const cooling=thermal*Math.max(0,previous.samples[a]-samples[a]-minCoolingRate*dt,
        previous.samples[b]-samples[b]-minCoolingRate*dt);
      const damage=Math.min(strength,bond.damage+load+cooling);
      if(damage===strength){
        faces[a]=(faces[a]??0)|1<<adjacent[a].indexOf(b);
        faces[b]=(faces[b]??0)|1<<adjacent[b].indexOf(a);
        failed.push({a,b,strength,impactDamage:load,coolingDamage:cooling,cause:load&&cooling?'mixed':load?'impact':'cooling'});
      }
      return damage===bond.damage?bond:{...bond,damage};
    });
    return {fracture:{spec,bonds,faces,samples},failed};
  }

  function subset({spec,bonds,faces,samples},group){
    const members=new Set(group);
    return {spec,bonds:bonds.filter(({a,b})=>members.has(a)&&members.has(b)),
      faces:Object.fromEntries(group.filter(key=>own(faces,key)).map(key=>[key,faces[key]])),
      samples:Object.fromEntries(group.map(key=>[key,samples[key]]))};
  }

  function validate(state,cells,adjacent){
    const cellKeys=Object.keys(cells).map(Number), expected=edges(cellKeys,adjacent);
    check(keys(state,['spec','bonds','faces','samples'])&&
      keys(state.spec,['strength','impact','thermal','minCoolingRate'])&&Object.keys(state.spec).length===4&&
      Array.isArray(state.bonds)&&state.bonds.length===expected.length&&record(state.samples)&&record(state.faces)&&
      Object.keys(state.samples).length===cellKeys.length&&cellKeys.every(key=>finite(state.samples[key],-273.150001,10000.000001))&&
      Object.entries(state.faces).every(([key,bits])=>own(cells,key)&&Number.isSafeInteger(bits)&&bits>=1&&bits<=63&&
        adjacent[key].every((neighbor,side)=>neighbor>=0||!(bits&1<<side))),
      'Invalid saved material bond state');
    settings(state.spec);
    for(const [i,[a,b]] of expected.entries()){
      const bond=state.bonds[i];
      check(keys(bond,['a','b','strength','damage'])&&bond.a===a&&bond.b===b&&finite(bond.strength,.000001,1e9)&&
        finite(bond.damage,0,bond.strength),'Invalid saved material bond');
      const ab=Boolean(state.faces[a]&1<<adjacent[a].indexOf(b)), ba=Boolean(state.faces[b]&1<<adjacent[b].indexOf(a));
      check(ab===!intact(bond)&&ba===ab,'Invalid saved material crack faces');
    }
    check(components(cells,state.bonds).length===1,'A saved compound must be bonded together');
  }

  W.materialBonds=Object.freeze({prepare,create,update,components,subset,validate,intact});
})(KIT);
