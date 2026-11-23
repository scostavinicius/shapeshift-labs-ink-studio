/* Portal traversal for polygonal rooms on the native raycaster art grid. */
(function (K) {
  const Art = IndexedRayArt, {index,record,tuple} = Art;
  const finite = Number.isFinite, epsilon = 1e-8;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi,n));
  const fract = n => n - Math.floor(n);
  const cross = (ax,az,bx,bz) => ax*bz - az*bx;
  const swatchAt = (n,size) => clamp(Math.floor(n*size),0,size-1);
  const unit = n => finite(n) && n>=0 && n<=1;
  const coordinates = (p,n) => tuple(p,n) && p.every(v=>Math.abs(v)<=16384);

  function check(condition,message) {
    if (!condition) throw new RangeError('Sector raycaster: '+message);
  }

  const signed = (edge,x,z) => cross(edge.dx,edge.dz,x-edge.a[0],z-edge.a[1])/edge.length;
  const along = (edge,x,z) => ((x-edge.a[0])*edge.dx+(z-edge.a[1])*edge.dz)/(edge.length**2);
  const onEdge = (edge,x,z) => Math.abs(signed(edge,x,z))<=epsilon && along(edge,x,z)>=-epsilon && along(edge,x,z)<=1+epsilon;

  function classify(room,x,z) {
    const {bounds:[x0,z0,x1,z1]} = room;
    if (x<x0-epsilon || x>x1+epsilon || z<z0-epsilon || z>z1+epsilon) return -1;
    let inside=false;
    for (const edge of room.edges) {
      if (onEdge(edge,x,z)) return 0;
      const {a,b,dx,dz}=edge;
      if ((a[1]>z)!==(b[1]>z) && x<a[0]+(z-a[1])*dx/dz) inside=!inside;
    }
    return inside?1:-1;
  }

  function crosses(a,b) {
    const opposite = (x,y) => x>epsilon && y < -epsilon || x < -epsilon && y>epsilon;
    return opposite(signed(a,...b.a),signed(a,...b.b)) && opposite(signed(b,...a.a),signed(b,...a.b));
  }

  function overlap(a,b) {
    if (Math.abs(signed(a,...b.a))>epsilon || Math.abs(signed(a,...b.b))>epsilon) return false;
    const lo=along(a,...b.a),hi=along(a,...b.b);
    return Math.min(1,Math.max(lo,hi))-Math.max(0,Math.min(lo,hi))>epsilon;
  }

  function outline(points) {
    check(Array.isArray(points) && points.length>=3 && points.length<=128 &&
      Array.from(points).every(point=>coordinates(point,2)), 'provide simple polygons with 3–128 bounded XZ vertices');
    const polygon=points.map(point=>Object.freeze(point.slice()));
    const edges=polygon.map((a,i)=>{
      const b=polygon[(i+1)%polygon.length], dx=b[0]-a[0],dz=b[1]-a[1];
      const length=Math.hypot(dx,dz);
      check(length>epsilon,'polygon has a zero-length edge');
      return {a,b,dx,dz,length,portals:[]};
    });
    const area=edges.reduce((sum,{a,b})=>sum+cross(a[0],a[1],b[0],b[1]),0);
    check(Math.abs(area)>epsilon,'polygon has no area');
    for (const [i,a] of edges.entries()) for (let j=i+1;j<edges.length;j++) {
      const b=edges[j], adjacent=j===i+1 || i===0 && j===edges.length-1;
      check(!overlap(a,b) && (adjacent || !(crosses(a,b) || onEdge(a,...b.a) || onEdge(a,...b.b) ||
        onEdge(b,...a.a) || onEdge(b,...a.b))), 'polygon intersects itself');
    }
    const xs=polygon.map(p=>p[0]),zs=polygon.map(p=>p[1]);
    return {polygon:Object.freeze(polygon),edges,winding:Math.sign(area),
      bounds:[Math.min(...xs),Math.min(...zs),Math.max(...xs),Math.max(...zs)]};
  }

  function separate(a,b) {
    if (Math.min(a.bounds[2],b.bounds[2])-Math.max(a.bounds[0],b.bounds[0])<=epsilon ||
        Math.min(a.bounds[3],b.bounds[3])-Math.max(a.bounds[1],b.bounds[1])<=epsilon) return;
    for (const edge of a.edges) for (const other of b.edges)
      check(!crosses(edge,other) && (!overlap(edge,other) ||
        (edge.dx*other.dx+edge.dz*other.dz)*a.winding*b.winding<0), 'sector interiors overlap');
    for (const [room,other] of [[a,b],[b,a]]) for (const edge of room.edges)
      check(classify(other,...edge.a)<=0 &&
        classify(other,(edge.a[0]+edge.b[0])/2,(edge.a[1]+edge.b[1])/2)<=0, 'sector interiors overlap');
  }

  function exit(room,ox,oz,dx,dz,entered,far,entryEdge) {
    let best, near=far+epsilon;
    for (const edge of room.edges) {
      if (edge===entryEdge) continue;
      const denominator=cross(dx,dz,edge.dx,edge.dz);
      if (denominator*room.winding<=epsilon*edge.length) continue;
      const x=edge.a[0]-ox,z=edge.a[1]-oz;
      const distance=cross(x,z,edge.dx,edge.dz)/denominator;
      if (distance<entered-epsilon || distance>=near || entryEdge && distance<=entered+epsilon) continue;
      const u=cross(x,z,dx,dz)/denominator;
      if (u>=-epsilon && u<=1+epsilon) {
        near=distance;
        best={edge,z:clamp(distance,0,far),u:clamp(u,0,1)};
      }
    }
    return best;
  }

  function passage(edge,u,opens) {
    for (const {opening,other,entryEdge,from,to} of edge.portals) {
      const across=(u-from)/(to-from);
      // Exact endpoint rays belong to the jamb.
      if (across<=epsilon || across>=1-epsilon) continue;
      const amount=opens.get(opening.id);
      const panelU=amount===undefined ? -1 : across+opening.door.slide*amount;
      return {opening,other,entryEdge,across,panelU,blocked:panelU>=0 && panelU<1};
    }
  }

  function create({sectors,portals=[],sprites=[],palette,background=null,shade={}}={}) {
    check(Array.isArray(sectors) && sectors.length>=1 && sectors.length<=128 &&
      Array.isArray(portals) && portals.length<=512 && Array.isArray(sprites) && sprites.length<=512,
      'supply 1–128 sectors, up to 512 portals and up to 512 sprites');
    const swatches=Art.palette(palette,check), texture=Art.textures(K,swatches,check), solids=new Map();
    const defaultLight=Art.lights(shade,swatches,check);
    check(background===null || index(background,swatches.length),'background must be a palette slot or transparent');
    const owners=[null], names=new Set(), rooms=new Map(), doorList=new Map(), portalNames=new Set();
    let edgeCount=0;
    function owner(id,kind) {
      check(typeof id==='string' && id.trim() && !names.has(id),'surface IDs must be distinct names');
      names.add(id);
      owners.push({id,kind});
      return owners.length-1;
    }
    function paint(source,solid) {
      if (index(source,swatches.length)) {
        if (!solids.has(source)) solids.set(source,{width:1,height:1,slots:[source]});
        source=solids.get(source);
      }
      return texture(source,solid);
    }

    for (const input of sectors) {
      const {id,polygon,floor=0,ceiling=3,wall=0,floorPaint=0,ceilingPaint=0,
        edgePaint={},planeScale=[1,1],lightBand=0}=input??{};
      check(typeof id==='string' && id.trim() && !rooms.has(id) && finite(floor) && finite(ceiling) &&
        Math.abs(floor)<=16384 && Math.abs(ceiling)<=16384 && ceiling-floor>epsilon &&
        tuple(planeScale,2) && planeScale.every(n=>n>=.001 && n<=16384) && record(edgePaint),
        'room needs a unique ID, ordered floor and ceiling heights and positive plane scales');
      const room={id,floor,ceiling,planeScale:planeScale.slice(),...outline(polygon)};
      edgeCount+=room.edges.length;
      check(edgeCount<=2048,'floor plan exceeds its edge budget');
      check(Object.keys(edgePaint).every(key=>/^(0|[1-9]\d*)$/.test(key) && index(+key,room.edges.length)),
        'edgePaint must name authored edge indices');
      room.shade=input.shade===undefined?defaultLight:Art.lights(input.shade,swatches,check);
      check(index(lightBand,room.shade.table[0].length),'lightBand is outside the shade ramp');
      room.lightBand=lightBand;
      room.planes=[['floor',floor,floorPaint],['ceiling',ceiling,ceilingPaint]].map(([kind,y,source])=>
        ({id:owner(id+':'+kind,kind),y,texture:paint(source,true)}));
      for (const [i,edge] of room.edges.entries()) {
        edge.id=owner(id+':wall:'+i,'wall');
        edge.texture=paint(Object.hasOwn(edgePaint,i)?edgePaint[i]:wall,true);
        edge.axis=Math.abs(edge.dz)>Math.abs(edge.dx)?'x':'z';
      }
      for (const other of rooms.values()) separate(room,other);
      rooms.set(id,room);
    }

    const connections=[];
    for (const input of portals) {
      const {id,between,segment,sill,lintel,trim,door}=input??{};
      check(typeof id==='string' && id.trim() && !portalNames.has(id) && Array.isArray(between) &&
        between.length===2 && between[0]!==between[1] && between.every(name=>rooms.has(name)) &&
        Array.isArray(segment) && segment.length===2 && Array.from(segment).every(p=>coordinates(p,2)) &&
        Math.hypot(segment[1][0]-segment[0][0],segment[1][1]-segment[0][1])>epsilon,
        'portal needs a unique ID, two room names and a nonzero shared segment');
      portalNames.add(id);
      const [a,b]=between.map(name=>rooms.get(name));
      const [from,to]=segment;
      const matches=room=>room.edges.filter(edge=>onEdge(edge,...from) && onEdge(edge,...to));
      const matchA=matches(a),matchB=matches(b);
      check(matchA.length===1 && matchB.length===1,'portal segment must lie on one boundary edge of each room');
      const [ea]=matchA,[eb]=matchB;
      check((ea.dx*eb.dx+ea.dz*eb.dz)*a.winding*b.winding<0,'portal edges must face opposite interiors');
      const lo=Math.max(a.floor,b.floor,sill??-Infinity),hi=Math.min(a.ceiling,b.ceiling,lintel??Infinity);
      check((sill===undefined||finite(sill)) && (lintel===undefined||finite(lintel)) && hi-lo>epsilon,
        'portal opening has no shared vertical height');
      const opening={id,lo,hi,lower:owner(id+':sill','sill'),upper:owner(id+':lintel','lintel'),
        trim:trim===undefined?undefined:paint(trim,true)};
      if (door!==undefined) {
        const {open=0,slide='positive',paint:source}=door??{};
        check((unit(open)||typeof open==='function') && ['positive','negative'].includes(slide),
          'door needs openness in [0, 1] and a slide direction');
        opening.door={id:owner(id,'door'),open,slide:slide==='positive'?-1:1,texture:paint(source,true)};
        doorList.set(id,opening.door);
      }
      for (const [edge,other,entryEdge] of [[ea,b,eb],[eb,a,ea]]) {
        const lo=along(edge,...from),hi=along(edge,...to);
        check(edge.portals.every(p=>Math.min(Math.max(lo,hi),Math.max(p.from,p.to))-
          Math.max(Math.min(lo,hi),Math.min(p.from,p.to))<=epsilon),'portal segments overlap on an edge');
        edge.portals.push({opening,other,entryEdge,from:lo,to:hi});
      }
      connections.push(Object.freeze({id,between:Object.freeze(between.slice()),
        segment:Object.freeze(segment.map(point=>Object.freeze(point.slice()))),sill:lo,lintel:hi,door:Boolean(door)}));
    }

    const actors=Art.sprites(sprites,paint,owner,check);
    function locate(x,z,roomId) {
      if (roomId!==undefined) {
        const room=rooms.get(roomId);
        return room && classify(room,x,z)>=0?room:null;
      }
      let boundary=null;
      for (const room of rooms.values()) {
        const side=classify(room,x,z);
        if (side>0) return room;
        if (!side && !boundary) boundary=room;
      }
      return boundary;
    }
    const layout=Object.freeze([...rooms.values()].map(({id,polygon,floor,ceiling})=>
      Object.freeze({id,polygon,floor,ceiling})));

    function openings(time,overrides) {
      check(finite(time) && record(overrides) && Object.keys(overrides).every(id=>doorList.has(id)),
        'door overrides must name doors in the floor plan');
      return new Map([...doorList].map(([id,{open}])=>{
        const value=Object.hasOwn(overrides,id)?overrides[id]:typeof open==='function'?open(time):open;
        check(unit(value),'door openness must be in [0, 1]');
        return [id,value];
      }));
    }

    function start(at,roomId) {
      const room=locate(at[0],at[2],roomId);
      check(room && at[1]>room.floor && at[1]<room.ceiling,'view origin must lie between the floor and ceiling of its sector');
      return room;
    }

    function trace(room,ox,oz,dx,dz,far,opens,visit) {
      let entered=0,entryEdge,steps=0;
      while (entered<=far) {
        check(++steps<=edgeCount,'portal traversal did not advance through the floor plan');
        const hit=exit(room,ox,oz,dx,dz,entered,far,entryEdge);
        const gate=hit && passage(hit.edge,hit.u,opens);
        if (!visit(room,entered,hit?.z??far,hit,gate) || !gate || gate.blocked) break;
        ({other:room,entryEdge}=gate);
        entered=hit.z;
      }
    }

    function cast({at,direction,sector,far=128,time=0,doors={}}={}) {
      check(coordinates(at,3) && tuple(direction,2) && finite(far) && far>0,
        'cast needs an XYZ origin, XZ direction and positive distance');
      const length=Math.hypot(...direction);
      check(finite(length) && length>0,'cast direction must be nonzero');
      const [x,y,z]=at,[dx,dz]=direction.map(n=>n/length), room=start(at,sector);
      const opens=openings(time,doors);
      let result=null;
      trace(room,x,z,dx,dz,far,opens,(current,_from,depth,hit,gate)=>{
        if (!hit) return false;
        const {edge,u}=hit;
        let id=edge.id, across=u;
        if (gate) {
          const {opening}=gate;
          if (y<=opening.lo) id=opening.lower;
          else if (y>=opening.hi) id=opening.upper;
          else if (gate.blocked) {id=opening.door.id;across=gate.panelU;}
          else return true;
        }
        result={owner:{...owners[id]},sector:current.id,depth,u:across,point:[x+depth*dx,y,z+depth*dz]};
        return false;
      });
      return result;
    }

    function render({width,height,camera,time=0,doors={}}={}) {
      const {at,sector,yaw=0,fov=Math.PI/3,horizon=height/2,near=.02,far=128}=camera??{};
      check(index(width-1,2048) && index(height-1,2048) && width*height<=K.renderOutputs.maxPixels &&
        coordinates(at,3) && finite(yaw) && finite(horizon) && finite(fov) && fov>=.03 && fov<Math.PI-.03 &&
        finite(near) && near>=1e-5 && finite(far) && far>near,
        'invalid native canvas, camera, field of view or clipping range');
      const [ox,oy,oz]=at, room=start(at,sector), opens=openings(time,doors);
      const focal=height/2/Math.tan(fov/2),center=width/2;
      const forward=[Math.sin(yaw),0,Math.cos(yaw)],right=[forward[2],0,-forward[0]];
      const count=width*height,data=new Uint8Array(count*4),depth=new Float64Array(count).fill(Infinity);
      const ids=new Uint16Array(count), uv=new Float64Array(count*2),placements=[], exposed=new Map();
      const columns=actors.length?Array.from({length:width},()=>[]):null;
      let work=0;
      const line=Array.from({length:height},(_,y)=>(horizon-(y+.5))/focal);
      const row=(y,z)=>clamp(Math.ceil(horizon-(y-oy)*focal/Math.max(z,epsilon)-.5),0,height);
      function art(texture) {
        if (!exposed.has(texture)) exposed.set(texture,texture.frames[texture.at(time)]);
        return exposed.get(texture);
      }
      function color(p,slot) {
        const rgb=swatches[slot], i=p*4;
        data[i]=rgb>>16; data[i+1]=rgb>>8&255; data[i+2]=rgb&255; data[i+3]=255;
      }
      function band(room,z,axis) {
        const {shade,lightBand}=room;
        return Math.min(shade.table[0].length-1,shade.band(z)+lightBand+(shade.bias[axis]??0));
      }
      function write(p,z,id,u,v,texture,pixels,level,room) {
        if (z>=depth[p]) return false;
        const slot=pixels[swatchAt(v,texture.height)*texture.width+swatchAt(u,texture.width)];
        if (slot<0) return false;
        color(p,room.shade.table[slot][level]);
        depth[p]=z; ids[p]=id; uv[p*2]=u; uv[p*2+1]=v;
        return true;
      }
      if (background!==null) for (let p=0;p<count;p++) color(p,background);
      for (let x=0;x<width;x++) {
        const offset=(x+.5-center)/focal, dx=forward[0]+right[0]*offset,dz=forward[2]+right[2]*offset;
        let top=0,bottom=height;
        trace(room,ox,oz,dx,dz,far,opens,(current,from,end,hit,gate)=>{
          work+=current.edges.length+bottom-top;
          check(work<=32*1024*1024,'portal traversal exceeds its frame work budget');
          const [floor,ceil]=current.planes;
          if (columns) columns[x].push({room:current,from,end,top,bottom});
          // The current room owns only its ray interval and the aperture inherited from the last room.
          for (let y=top;y<bottom;y++) {
            if (!line[y]) continue;
            const p=line[y]<0?floor:ceil, z=(p.y-oy)/line[y];
            if (z<near || z<from-epsilon || z>end+epsilon) continue;
            const u=fract((ox+dx*z)/current.planeScale[0]),v=fract((oz+dz*z)/current.planeScale[1]);
            write(y*width+x,z,p.id,u,v,p.texture,art(p.texture),band(current,z),current);
          }
          if (!hit) return false;
          const {edge,u}=hit, shadeBand=band(current,end,edge.axis);
          function wall(id,texture,lo,hi,across,paintLo=lo,paintHi=hi) {
            const y0=Math.max(top,row(hi,end)),y1=Math.min(bottom,row(lo,end));
            const pixels=art(texture);
            for (let y=y0;y<y1;y++) {
              const worldY=oy+line[y]*end;
              const v=clamp((paintHi-worldY)/(paintHi-paintLo),0,1);
              write(y*width+x,end,id,across,v,texture,pixels,shadeBand,current);
            }
          }
          if (!gate) {
            wall(edge.id,edge.texture,current.floor,current.ceiling,u);
            return false;
          }
          const {opening,across,panelU,blocked}=gate, {trim,lo,hi,lower,upper,door}=opening;
          if (lo>current.floor)
            wall(lower,trim??edge.texture,current.floor,lo,trim?across:u,current.floor,trim?lo:current.ceiling);
          if (hi<current.ceiling)
            wall(upper,trim??edge.texture,hi,current.ceiling,trim?across:u,trim?hi:current.floor,current.ceiling);
          if (blocked) {
            wall(door.id,door.texture,lo,hi,panelU);
            return false;
          }
          top=Math.max(top,row(hi,end)); bottom=Math.min(bottom,row(lo,end));
          return top<bottom;
        });
      }
      if (columns) Art.drawSprites(actors,{time,at,forward,right,width,height,center,horizon,focal,near,far,
        paint:art,write,shade:band,owners,placements,check,
        locate(point) {
          const room=locate(point[0],point[2]);
          return room && point[1]>=room.floor && point[1]<=room.ceiling?room:null;
        },
        visible: (sector,x,y,z)=>columns[x].some(c=>c.room===sector && z>=c.from && z<c.end && y>=c.top && y<c.bottom)
      });
      return K.renderOutputs.create({width,height,data,depth,ids,uv,owners,placements,sector:room.id,
        camera:{origin:at,right,up:[0,1,0],forward,center:[center,horizon],scale:[focal,focal]}});
    }

    return Object.freeze({sectors:layout,portals:Object.freeze(connections),cast,render,
      locate(point) {
        check(coordinates(point,2),'locate needs a bounded XZ point');
        const room=locate(...point);
        return room?layout.find(value=>value.id===room.id):null;
      }});
  }

  K.sectorRaycaster=Object.freeze({create});
})(KIT);
