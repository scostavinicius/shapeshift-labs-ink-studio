/* Camera-local puppet edits. The animation pose remains the source of all contacts. */
(function (K) {
  const { M,V }=K;
  const bindings=new WeakMap(), source=Symbol('view pose source');
  const format='ink-studio/view-poses', radians=Math.PI/180, epsilon=1e-7;
  const xyz=a=>Array.isArray(a)&&a.length===3&&Array.from(a).every(Number.isFinite);
  const record=a=>a&&Object.getPrototypeOf(a)===Object.prototype;
  const name=a=>typeof a==='string'&&a.trim().length&&a.length<=96;
  const zero=[0,0,0];
  function check(ok,message) {
    if(!ok) throw new RangeError('View poses: '+message);
  }
  function angle(n) {
    return ((n+180)%360+360)%360-180;
  }
  function turn(from,to) {
    const a=V.norm(from), b=V.norm(to), axis=V.cross(a,b), s=V.len(axis), c=V.dot(a,b);
    if(s<epsilon) return c<0 ? M.rot(V.perp(a),Math.PI) : M.id();
    return M.rot(V.mul(axis,1/s),Math.atan2(s,c));
  }
  function mounted(puppet, part) {
    return puppet.point(part,puppet.parts[part].pivot);
  }
  function radial(point,root,axis) {
    const d=V.sub(point,root);
    return V.norm(V.mad(d,axis,-V.dot(d,axis)),V.perp(axis));
  }

  function compile(puppet,asset) {
    if(asset===null||asset===undefined||asset===false) return null;
    check(record(asset)&&asset.format===format&&asset.version===1&&name(asset.anchor)&&Object.hasOwn(puppet.parts,asset.anchor),
      'expected a version 1 asset with a named puppet anchor');
    const {anchor,chains:authoredChains={},locks:authoredLocks={},sectors}=asset;
    check(record(authoredChains)&&record(authoredLocks)&&Array.isArray(sectors)&&sectors.length>0&&sectors.length<=24,
      'expected named chains and locks and 1–24 sectors');
    const part=(id)=>name(id)&&Object.hasOwn(puppet.parts,id);
    function under(id,ancestor) {
      for(let p=id;p;p=puppet.parts[p].parent) if(p===ancestor) return true;
      return false;
    }
    const chains=new Map(), props=new Set(), locks=new Map();
    for(const [id,chain] of Object.entries(authoredChains)){
      const {upper,lower,wrist,point,grip}=chain??{};
      check(name(id)&&record(chain)&&part(upper)&&part(lower)&&part(wrist)&&xyz(point)&&
        puppet.parts[lower].parent===upper&&puppet.parts[wrist].parent===lower,
      'chain '+id+' needs an upper, lower and separate wrist in order, with a contact point');
      check(!under(anchor,upper)&&[...chains.values()].every(other=>!under(upper,other.upper)&&!under(other.upper,upper)),
        'chains must be independent of each other and the anchor');
      if(grip!==undefined) {
        check(part(grip)&&!puppet.parts[grip].parent&&grip!==anchor&&!under(anchor,grip),
          'grips need a separate top-level prop');
        props.add(grip);
      }
      chains.set(id,{upper,lower,wrist,point:point.slice(),grip});
    }
    for(const [id,{upper}] of chains) check([...props].every(prop=>!under(upper,prop)),
      'chain '+id+' cannot hang from an edited prop');
    for(const [id,lock] of Object.entries(authoredLocks)){
      check(name(id)&&!chains.has(id)&&record(lock)&&part(lock.part)&&xyz(lock.point),'invalid or duplicate contact lock '+id);
      check([...chains.values()].every(chain=>!under(lock.part,chain.upper))&&[...props].every(prop=>!under(lock.part,prop)),
        'lock '+id+' must be independent of the edited chains and props');
      locks.set(id,{part:lock.part,point:lock.point.slice()});
    }
    const ids=new Set();
    const layers=Array.from(sectors,row=>{
      const {id,yaw,width,elbows={},props:moves={}}=row??{};
      check(record(row)&&name(id)&&!ids.has(id)&&Number.isFinite(yaw)&&Number.isFinite(width)&&width>0&&width<=360&&
        record(elbows)&&record(moves),'invalid sector '+id);
      ids.add(id);
      const edited=Object.entries(elbows), placed=Object.entries(moves);
      check(edited.length+placed.length>0,'sector '+id+' needs an elbow or prop edit');
      for(const [chain,bend] of edited)
        check(chains.has(chain)&&Number.isFinite(bend)&&Math.abs(bend)<=180,'invalid elbow edit on '+chain);
      const rigids=placed.map(([prop,edit])=>{
        const {move=zero,rotation=zero}=edit??{};
        check(props.has(prop)&&record(edit)&&xyz(move)&&V.len(move)<=100&&xyz(rotation)&&
          rotation.every(n=>Math.abs(n)<=90),'invalid or ungripped prop edit on '+prop);
        return [prop,{move:move.slice(),rotation:rotation.slice()}];
      });
      return {id,yaw:angle(yaw),half:width/2,elbows:edited,props:rigids};
    });
    return {anchor,chains,locks,layers,asset:structuredClone(asset)};
  }

  function blend(layers,yaw,directionWeight) {
    const samples=layers.map(layer=>({layer,weight:K.ease.smooth(Math.max(0,1-Math.abs(angle(yaw-layer.yaw))/layer.half))}));
    const normalization=directionWeight/Math.max(1,samples.reduce((sum,row)=>sum+row.weight,0));
    const elbows=new Map(), props=new Map();
    for(const {layer,weight} of samples) {
      const gain=weight*normalization;
      if(!gain) continue;
      for(const [id,rotation] of layer.elbows) elbows.set(id,(elbows.get(id)??0)+rotation*gain);
      for(const [id,{move,rotation}] of layer.props){
        const old=props.get(id)??{move:zero,rotation:zero};
        props.set(id,{move:V.mad(old.move,move,gain),rotation:V.mad(old.rotation,rotation,gain)});
      }
    }
    return {elbows,props,weights:samples.map(({layer,weight})=>({id:layer.id,weight:weight*normalization}))};
  }

  function solve(puppet,definition,camera) {
    puppet.solve();
    const {anchor,chains,locks,layers}=definition;
    const frame=M.polar(puppet.parts[anchor].A), at=mounted(puppet,anchor);
    const ray=camera.ortho ? camera.back : V.sub(camera.eye,at);
    const local=M.app(M.tr(frame),ray), norm=V.len(local), planar=Math.hypot(local[0],local[2]);
    const yaw=planar>epsilon ? Math.atan2(local[0],local[2])/radians : null;
    // Azimuth vanishes at a pole. Fade the edit before it becomes ambiguous.
    const directionWeight=K.ease.smooth(Math.min(1,planar/Math.max(epsilon,norm*.18)));
    const edit=blend(layers,yaw??0,directionWeight);
    const report={yaw,weights:edit.weights,gain:1,elbows:Object.create(null),props:Object.create(null),
      contacts:Object.create(null),applied:false};
    const locked=[...locks].map(([id,{part,point}])=>({id,part,point,from:puppet.point(part,point)}));
    const limbs=[...chains].map(([id,chain])=>{
      const {upper,lower,wrist,point}=chain;
      const shoulder=mounted(puppet,upper), elbow=mounted(puppet,lower), hand=mounted(puppet,wrist);
      return {id,...chain,shoulder,elbow,hand,a:V.dist(shoulder,elbow),b:V.dist(elbow,hand),
        contact:puppet.point(wrist,point), rotation:puppet.parts[wrist].A.slice()};
    });
    const held=new Map();
    let gain=1;
    for(const [id,pose] of edit.props) {
      const pivot=mounted(puppet,id), move=M.app(frame,pose.move);
      const angular=pose.rotation.reduce((sum,n)=>sum+Math.abs(n)*radians,0);
      for(const limb of limbs) if(limb.grip===id) {
        const d=V.dist(limb.shoulder,limb.hand);
        const reserve=Math.max(0,Math.min(limb.a+limb.b-d,d-Math.abs(limb.a-limb.b))-epsilon);
        const bound=V.len(move)+angular*V.dist(limb.hand,pivot);
        if(bound>epsilon) gain=Math.min(gain,reserve/bound);
      }
      held.set(id,{pivot,move,rotation:pose.rotation});
    }
    report.gain=gain;
    for(const [id,prop] of held){
      const {pivot,move,rotation}=prop;
      prop.delta=M.mul(frame,M.mul(K.deform.euler(V.mul(rotation,gain)),M.tr(frame)));
      prop.at=V.mad(pivot,move,gain);
      prop.changed=gain>0&&(V.len(move)>epsilon||V.len(rotation)>epsilon);
      if(prop.changed) {
        puppet.rotate(id,prop.delta);
        puppet.pin(id,puppet.parts[id].pivot,prop.at);
        report.applied=true;
      }
      report.props[id]={from:pivot,to:prop.at};
    }
    function rigid(prop,p) { return prop?.changed ? V.add(prop.at,M.app(prop.delta,V.sub(p,prop.pivot))) : p; }
    for(const limb of limbs){
      const {id,upper,lower,wrist,point,shoulder,elbow,hand,a,b,contact,rotation,grip}=limb;
      const prop=held.get(grip), target=rigid(prop,hand), goal=rigid(prop,contact);
      const bend=edit.elbows.get(id)??0;
      if((prop?.changed||Math.abs(bend)>epsilon)&&Math.min(a,b)>epsilon) {
        const dir=V.sub(target,shoulder), d=V.len(dir);
        if(d>epsilon) {
          const axis=V.mul(dir,1/d), oldAxis=V.norm(V.sub(hand,shoulder),axis);
          const length=(a*a-b*b+d*d)/(2*d), radius=Math.sqrt(Math.max(0,a*a-length*length));
          const pole=M.app(turn(oldAxis,axis),radial(elbow,shoulder,oldAxis));
          const mid=V.mad(V.mad(shoulder,axis,length),M.app(M.rot(axis,bend*radians),pole),radius);
          puppet.rotate(upper,turn(V.sub(elbow,shoulder),V.sub(mid,shoulder)));
          const now=mounted(puppet,lower);
          puppet.rotate(lower,turn(V.sub(mounted(puppet,wrist),now),V.sub(target,now)));
          const wanted=prop?.changed ? M.mul(prop.delta,rotation) : rotation;
          puppet.rotate(wrist,M.mul(wanted,M.inv(puppet.parts[wrist].A)));
          report.applied=true;
        }
      }
      const actual=puppet.point(wrist,point);
      report.elbows[id]={from:elbow,to:mounted(puppet,lower)};
      report.contacts[id]={from:contact,target:goal,actual,error:V.dist(goal,actual),kind:grip?'grip':'wrist'};
    }
    for(const {id,part,point,from} of locked) {
      const actual=puppet.point(part,point);
      report.contacts[id]={from,target:from,actual,error:V.dist(actual,from),kind:'lock'};
    }
    if(Object.values(report.contacts).some(contact=>!Number.isFinite(contact.error)||contact.error>2e-5)) {
      report.applied=false;
      report.limited='contact could not be retained';
    } else if(gain<1) report.limited='prop reach';
    return report;
  }

  function bind(world,puppet,writeBones,correctives) {
    let definition;
    function sample(camera) {
      check(camera&&xyz(camera.back)&&(camera.ortho||xyz(camera.eye)),'expected a resolved camera');
      if(!definition) return null;
      const previous=puppet.pose;
      // World turns and pins create new channel arrays. Keep the original
      // records, art maps and raw bone table available to the live rig.
      puppet.pose=Object.fromEntries(Object.entries(previous).map(([id,pose])=>[id,{...pose}]));
      try {
        const report=solve(puppet,definition,camera);
        const bones=report.applied?correctives.viewFrame(writeBones(new Float32Array(puppet.bones.length))):null;
        return {report,bones};
      } finally {
        puppet.pose=previous;
        puppet.solve();
      }
    }
    const editor=Object.freeze({
      set(asset){ definition=compile(puppet,asset);return editor; },
      get active(){return definition!==null&&definition!==undefined;},
      asset(){return definition&&structuredClone(definition.asset);},
      sample
    });
    bindings.set(world,editor);
    return editor;
  }

  function entry(world) {
    return bindings.get(world[source]??world);
  }
  function frame(world,camera,{enabled=true,headless=false}={}) {
    const editor=entry(world), canonical=world[source]??world;
    if(!editor?.active) return world;
    const bones=enabled && editor.sample(camera)?.bones;
    if(!headless&&!bones&&!world[source]) return world;
    const anim=bones||world[source] ? {...world.anim,bones:bones||canonical.anim.bones} : world.anim;
    if(!headless) return {...world,anim,[source]:canonical};
    const rest=world.rest??canonical.data;
    if(!bones&&!world[source]&&world.rest===rest&&world.data!==rest) return world;
    return {...world,anim,rest,[source]:canonical,data:K.bones.posed({data:rest,anim,posedBuf:undefined})};
  }
  K.viewPoses=Object.freeze({bind,frame,forWorld:entry,source:world=>world[source]??world});
})(KIT);
