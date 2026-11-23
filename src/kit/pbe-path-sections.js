/* Measure closed planar sections on normals to an arc-length path. */
(function(K) {
  const P=K.procedural, {V}=K;
  const format='ink-studio/path-section-report', maxStations=512, maxRing=4096, maxVertices=16384;
  const record=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
  const vector=(p,n)=>Array.isArray(p)&&p.length===n&&Array.from(p).every(x=>Number.isFinite(x)&&Math.abs(x)<=1e8);
  const integral=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  const delta=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  const turn=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const mix=(a,b,t)=>a+(b-a)*t;

  function routeFrames(path,up) {
    const authored=Array.isArray(path);
    check(up===undefined||vector(up,3)&&V.len(up)>1e-8,'Path sections need a nonzero up vector');
    check(!authored||integral(path.length,2,4097)&&Array.from(path).every(p=>vector(p,3)),
      'Path sections need finite authored 3D points');
    const route=authored?P.routes.polyline(path,{up}):path;
    check(Number.isFinite(route?.length)&&route.length>0&&route.length<=1e8&&typeof route.sample==='function',
      'Path sections need an arc-length route or a 3D polyline');
    const transported=authored?K.curve.frames(route.points,up):null;
    return {length:route.length,at(t) {
      const {point,tangent,side,normal,segment}=route.sample(t);
      check(vector(point,3)&&vector(tangent,3)&&V.len(tangent)>1e-8,'A path station needs a finite point and tangent');
      const direction=V.norm(tangent);
      let u;
      if (transported) {
        const a=transported[segment], b=transported[segment+1];
        const v=V.lerp(a.N,b.N,Math.max(0,Math.min(1,(t-a.t)/(b.t-a.t))));
        u=V.cross(v,direction);
      } else if (vector(side,3)) u=V.mad(side,direction,-V.dot(side,direction));
      else u=V.cross(up??(vector(normal,3)?normal:[0,1,0]),direction);
      if (V.len(u)<1e-8) u=V.perp(direction);
      u=V.norm(u);
      return {point:point.slice(),tangent:direction,u,v:V.cross(direction,u)};
    }};
  }

  function locate(keys,value) {
    let start=0,end=keys.length-1;
    while (end-start>1) {
      const mid=(start+end)>>>1;
      if(keys[mid]<=value)start=mid;
      else end=mid;
    }
    return start;
  }

  function profileSource(source,epsilon) {
    if (source.banks!==undefined) {
      check(source.profiles===undefined,'Choose contour profiles or paired banks');
      const {left,right,depth}=source.banks??{};
      check(Number.isFinite(depth)&&depth>epsilon&&depth<=1e8,'Paired banks need a positive finite depth');
      function rail(rows) {
        check(Array.isArray(rows)&&integral(rows.length,2,4097)&&Array.from(rows).every((p,i)=>
          vector(p,2)&&p[0]>=0&&p[0]<=1&&(!i||p[0]>rows[i-1][0]))&&rows[0][0]===0&&rows.at(-1)[0]===1,
        'Each bank needs ascending [normalized arc, lateral offset] keys spanning 0 to 1');
        const keys=rows.map(row=>row[0]);
        return t=>{
          const i=locate(keys,t), [a,x]=rows[i], [b,y]=rows[i+1];
          return mix(x,y,(t-a)/(b-a));
        };
      }
      const lower=rail(left),upper=rail(right);
      check([...left,...right].every(([t])=>upper(t)>=lower(t)),'Paired banks cross');
      return (_,t)=>{
        const l=lower(t),r=upper(t),h=depth/2;
        return {loops:r-l>epsilon?[[[l,-h],[r,-h],[r,h],[l,h]]]:[]};
      };
    }
    const profiles=source.profiles;
    check(Array.isArray(profiles)&&integral(profiles.length,1,512)&&Array.from(profiles).every((key,i)=>
      record(key)&&Number.isFinite(key.at)&&key.at>=0&&key.at<=1&&(!i||key.at>profiles[i-1].at)&&
      Array.isArray(key.loops)&&integral(key.loops.length,1,256))&&profiles[0].at===0&&
      (profiles.length===1||profiles.at(-1).at===1),'Contour profiles need ascending normalized keys spanning the path');
    const keys=profiles.map(row=>row.at);
    const rings=profiles.map(({loops})=>{
      let count=0;
      return Array.from(loops,loop=>{
        check(Array.isArray(loop)&&integral(loop.length,3,maxRing+1)&&Array.from(loop).every(p=>vector(p,2)),
          'Contour profiles need finite closed planar loops');
        const points=compact(loop,epsilon);
        count+=points.length;
        check(integral(points.length,3,maxRing)&&count<=maxVertices,'Invalid or oversized contour profile');
        return points;
      });
    });
    check(rings.every(loops=>loops.length===rings[0].length&&loops.every((ring,i)=>ring.length===rings[0][i].length)),
      'Contour profiles need matching loop and vertex counts');
    return (_,t)=>{
      if (keys.length===1) return {loops:rings[0]};
      const i=locate(keys,t), alpha=(t-keys[i])/(keys[i+1]-keys[i]);
      return {loops:rings[i].map((ring,j)=>ring.map(([u,v],k)=>{
        const next=rings[i+1][j][k];
        return [mix(u,next[0],alpha),mix(v,next[1],alpha)];
      }))};
    };
  }

  function sdfSource(source,count,spend) {
    const {field,bounds,cell=0.04,iso=0}=source;
    const sample=typeof field==='function'?field:typeof field?.sdf==='function'?field.sdf.bind(field):null;
    check(typeof sample==='function'&&vector(bounds?.min,2)&&vector(bounds?.max,2)&&
      bounds.min.every((v,i)=>Math.abs(v)<=1e6&&v<bounds.max[i]&&Math.abs(bounds.max[i])<=1e6)&&
      Number.isFinite(cell)&&cell>=1e-6&&Number.isFinite(iso),'SDF sections need a field, ordered planar bounds, and a positive cell size');
    const [x0,y0]=bounds.min, [x1,y1]=bounds.max;
    const cols=Math.ceil((x1-x0)/cell), rows=Math.ceil((y1-y0)/cell), cells=cols*rows;
    check(cells<=500000,'SDF path section exceeds the per-plane cell budget');
    spend(count*((cols+1)*(rows+1)+cells));
    return ({point,u,v})=>{
      let clipped=false, missing=false;
      const paths=P.contours.march((a,b)=>{
        const value=sample(point[0]+a*u[0]+b*v[0],point[1]+a*u[1]+b*v[1],point[2]+a*u[2]+b*v[2]);
        if (value===null) missing=true;
        else if (value<=iso&&(a===x0||a===x1||b===y0||b===y1)) clipped=true;
        return value;
      },{bounds,iso,cell,maxCells:cells});
      const status=missing?'undefined':clipped?'clipped':paths.some(path=>!path.closed)?'open':undefined;
      return {status,loops:paths.filter(path=>path.closed).map(path=>path.points)};
    };
  }

  function meshSource(source,count,epsilon,spend) {
    const mesh=source.mesh, vertices=mesh?.pos??mesh?.positions, indices=mesh?.tri??mesh?.indices;
    const array=value=>Array.isArray(value)||ArrayBuffer.isView(value)&&typeof value.length==='number';
    check(array(vertices)&&vertices.length>=9&&vertices.length%3===0&&
      (indices===undefined?vertices.length%9===0:array(indices)&&indices.length>=3&&indices.length%3===0),
      'Mesh sections need triangles with finite positions and optional indices');
    const pointCount=vertices.length/3, triangleCount=indices===undefined?vertices.length/9:indices.length/3;
    spend(count*(triangleCount+pointCount));
    const positions=Float64Array.from(vertices,value=>{
      check(typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1e8,'Mesh section position is out of range');
      return value;
    });
    const faces=indices===undefined?null:Uint32Array.from(indices,value=>{
      check(integral(value,0,pointCount-1),'Mesh section triangle index is out of range');
      return value;
    });
    const sides=new Float64Array(pointCount);
    return ({point,tangent,u,v})=>{
      for(let i=0;i<pointCount;i++){
        const j=i*3;
        const distance=(positions[j]-point[0])*tangent[0]+(positions[j+1]-point[1])*tangent[1]+(positions[j+2]-point[2])*tangent[2];
        sides[i]=Math.abs(distance)<=epsilon?0:distance;
      }
      const segments=planarEdges(epsilon);
      function vertex(i) {
        const j=i*3;
        return [positions[j]-point[0],positions[j+1]-point[1],positions[j+2]-point[2]];
      }
      const flat=p=>[V.dot(p,u),V.dot(p,v)];
      const index=i=>faces===null?i:faces[i];
      for(let i=0;i<triangleCount*3;i+=3) {
        const a=index(i),b=index(i+1),c=index(i+2),sa=sides[a],sb=sides[b],sc=sides[c];
        if ((sa>0&&sb>0&&sc>0)||(sa<0&&sb<0&&sc<0))continue;
        if (a===b||b===c||a===c)continue;
        const ids=[a,b,c], coords=ids.map(vertex);
        if (sa===0&&sb===0&&sc===0) {
          for (let j=0;j<3;j++) segments.add(flat(coords[j]),flat(coords[(j+1)%3]),true);
          continue;
        }
        const hits=[];
        for(let j=0;j<3;j++) {
          const k=(j+1)%3, left=sides[ids[j]], right=sides[ids[k]];
          if(left===0)hits.push(flat(coords[j]));
          else if((left<0&&right>0)||(left>0&&right<0))
            hits.push(flat(V.lerp(coords[j],coords[k],left/(left-right))));
        }
        if (hits.length===2) segments.add(hits[0],hits[1],false);
      }
      return segments.loops();
    };
  }

  function planarEdges(epsilon) {
    const bins=new Map(), nodes=[], edges=new Map();
    const key=(x,y)=>x+':'+y;
    function weld(point) {
      const x=Math.floor(point[0]/epsilon),y=Math.floor(point[1]/epsilon);
      check(Math.max(Math.abs(x),Math.abs(y))<Number.MAX_SAFE_INTEGER-2,'Mesh section weld tolerance is too small for its coordinates');
      for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
        const bin=bins.get(key(x+i,y+j));
        if(bin)for(const index of bin)if(delta(point,nodes[index].point)<=epsilon)return index;
      }
      const index=nodes.length, bucket=key(x,y);
      nodes.push({point,links:[]});
      if(!bins.has(bucket))bins.set(bucket,[]);
      bins.get(bucket).push(index);
      return index;
    }
    function add(first,second,cap) {
      if(delta(first,second)<=epsilon)return;
      const u=weld(first),v=weld(second), a=Math.min(u,v),b=Math.max(u,v);
      if(a===b)return;
      const id=key(a,b);
      if(!edges.has(id))edges.set(id,{a,b,cut:false,cap:0,used:false});
      const edge=edges.get(id);
      if(cap)edge.cap++;
      else edge.cut=true;
    }
    function loops() {
      const active=[];
      for(const edge of edges.values()){
        if(edge.cap>2)return {status:'ambiguous',loops:[]};
        if(!edge.cut&&edge.cap!==1)continue;
        nodes[edge.a].links.push(edge);
        nodes[edge.b].links.push(edge);
        active.push(edge);
      }
      if(nodes.some(node=>node.links.length>2))return {status:'ambiguous',loops:[]};
      if(nodes.some(node=>node.links.length===1))return {status:'open',loops:[]};
      const rings=[];
      for(const start of active){
        if(start.used)continue;
        const points=[];
        let vertex=start.a,edge=start;
        while(edge&&!edge.used){
          points.push(nodes[vertex].point);
          edge.used=true;
          vertex=edge.a===vertex?edge.b:edge.a;
          edge=nodes[vertex].links.find(candidate=>!candidate.used);
        }
        rings.push(points);
      }
      return {loops:rings};
    }
    return {add,loops};
  }

  function compact(raw,epsilon) {
    const points=[];
    for(const p of raw)if(!points.length||delta(p,points.at(-1))>epsilon)points.push(p);
    if(points.length&&delta(points[0],points.at(-1))<=epsilon)points.pop();
    return points;
  }

  function polygonStats(points,epsilon) {
    let area=0, perimeter=0;
    const min=[Infinity,Infinity], max=[-Infinity,-Infinity];
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length];
      area+=turn(points[0],a,b);
      perimeter+=delta(a,b);
      for(let axis=0;axis<2;axis++){
        min[axis]=Math.min(min[axis],a[axis]);
        max[axis]=Math.max(max[axis],a[axis]);
      }
    }
    if(Math.abs(area)<=epsilon*epsilon)return null;
    return {points,area:Math.abs(area)*0.5,perimeter,bounds:{min,max},
      distance:P.geometry.profileDistance(points)};
  }

  function crosses(rings,epsilon,spend) {
    const edges=rings.flatMap(({points},ring)=>points.map((a,i)=>{
      const b=points[(i+1)%points.length];
      return {ring,i,size:points.length,a,b,min:Math.min(a[0],b[0]),max:Math.max(a[0],b[0]),
        low:Math.min(a[1],b[1]),high:Math.max(a[1],b[1])};
    })).sort((a,b)=>a.min-b.min);
    spend(edges.length);
    let checked=0;
    function side(edge,point) {
      const value=turn(edge.a,edge.b,point), tolerance=epsilon*delta(edge.a,edge.b);
      return Math.abs(value)<=tolerance?0:Math.sign(value);
    }
    for(let i=0;i<edges.length;i++){
      const a=edges[i];
      for(let j=i+1;j<edges.length&&edges[j].min<=a.max+epsilon;j++){
        if((++checked&1023)===0)spend(1024);
        const b=edges[j];
        if(a.low>b.high+epsilon||b.low>a.high+epsilon)continue;
        const gap=Math.abs(a.i-b.i);
        if(a.ring===b.ring&&(gap===1||gap===a.size-1)){
          const before=(a.i+1)%a.size===b.i?a:b, after=before===a?b:a;
          const [x,y]=before.a, [u,v]=before.b, [s,t]=after.b;
          if(side(before,after.b)===0&&(u-x)*(s-u)+(v-y)*(t-v)<0)return true;
          continue;
        }
        if(side(a,b.a)*side(a,b.b)<=0&&side(b,a.a)*side(b,a.b)<=0)return true;
      }
    }
    spend(checked%1024);
    return false;
  }

  function caliper(points) {
    const sorted=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    function half(order) {
      const hull=[];
      for(const p of order){
        while(hull.length>=2&&turn(hull.at(-2),hull.at(-1),p)<=0)hull.pop();
        hull.push(p);
      }
      hull.pop();
      return hull;
    }
    const hull=half(sorted).concat(half(sorted.reverse()));
    let tip=1, width=Infinity;
    for(let i=0;i<hull.length;i++){
      const a=hull[i],b=hull[(i+1)%hull.length],height=j=>turn(a,b,hull[j]);
      for(let j=0;j<hull.length-1;j++){
        const next=(tip+1)%hull.length;
        if(height(next)<=height(tip))break;
        tip=next;
      }
      width=Math.min(width,height(tip)/delta(a,b));
    }
    return width;
  }

  function metrics(raw,selection,epsilon,spend,wantContours) {
    const failed=status=>({status,area:null,perimeter:null,minimumOpening:null,centerClearance:null,components:null});
    if(raw.status)return failed(raw.status);
    let vertices=0;
    const rings=raw.loops.map(loop=>{
      const points=compact(loop,epsilon);
      vertices+=points.length;
      check(integral(points.length,0,maxRing)&&vertices<=maxVertices,'Section exceeds its contour vertex budget');
      return points.length>=3?polygonStats(points,epsilon):null;
    });
    if(rings.includes(null)||crosses(rings,epsilon,spend))return failed('ambiguous');
    const parent=Array(rings.length).fill(-1), depths=Array(rings.length).fill(0), origin=[];
    const ordered=rings.map((_,i)=>i).sort((a,b)=>rings[b].area-rings[a].area);
    for(const [index,i] of ordered.entries()){
      const ring=rings[i], [x,y]=ring.points[0];
      for(let j=index-1;j>=0;j--){
        const outer=rings[ordered[j]], {min,max}=outer.bounds;
        spend(1);
        if(x<min[0]||x>max[0]||y<min[1]||y>max[1])continue;
        spend(outer.points.length);
        if(outer.distance(x,y)<0){
          parent[i]=ordered[j];
          depths[i]=depths[parent[i]]+1;
          break;
        }
      }
      origin[i]=ring.distance(0,0);
    }
    const deepest=origin.some(value=>Math.abs(value)<=epsilon)?undefined:ordered.findLast(i=>origin[i]<0);
    const center=deepest!==undefined&&depths[deepest]%2===0?deepest:-1;
    const outers=ordered.filter(i=>depths[i]%2===0);
    const chosen=selection==='all'?outers:center<0?[]:[center], included=new Set(chosen);
    let area=0,perimeter=0,width=Infinity;
    const labelled=rings.map((ring,i)=>{
      const hole=depths[i]%2===1, component=hole?parent[i]:i, selected=included.has(component);
      if(selected){
        area+=(hole?-1:1)*ring.area;
        perimeter+=ring.perimeter;
        if(!hole)width=Math.min(width,caliper(ring.points));
      }
      return wantContours?{points:ring.points.map(p=>p.slice()),kind:hole?'hole':'outer',component,selected}:null;
    });
    return {status:chosen.length?'ok':'empty',area,perimeter,minimumOpening:chosen.length?width:0,
      centerClearance:center<0?0:2*Math.min(...origin.map(Math.abs)),components:chosen.length,
      ...(wantContours&&{contours:labelled})};
  }

  function measure({path,source,samples,distances,range,up,selection='center',contours=false,
    epsilon=1e-7,maxWork=12000000}={}) {
    check(record(source)&&['mesh','sdf','contours'].includes(source.kind)&&['center','all'].includes(selection)&&
      typeof contours==='boolean'&&Number.isFinite(epsilon)&&epsilon>=1e-8&&epsilon<=0.01&&integral(maxWork,1,100000000),
      'Invalid path section source, selection, or work settings');
    const route=routeFrames(path,up), length=route.length;
    check(range===undefined||vector(range,2),'Path sections need a finite arc range');
    const [from,to]=range??[0,length];
    check(from>=0&&to<=length&&to>from,
      'Path section range must be ordered and inside the path');
    const count=samples??distances?.length??32;
    check(integral(count,1,maxStations)&&
      (distances===undefined||samples===undefined&&Array.isArray(distances)&&Array.from(distances).every((d,i)=>
        Number.isFinite(d)&&d>=from&&d<=to&&(!i||d>distances[i-1]))),'Use 1–512 section samples or ascending arc distances');
    const stations=distances??Array.from({length:count},(_,i)=>from+((i+0.5)/count)*(to-from));
    let work=0, retained=0;
    function spend(amount) {
      work+=amount;
      check(work<=maxWork,'Path sections exceed the work budget');
    }
    const slice=source.kind==='mesh'?meshSource(source,count,epsilon,spend):
      source.kind==='sdf'?sdfSource(source,count,spend):profileSource(source,epsilon);
    const sections=stations.map((distance,index)=>{
      const t=distance/length, frame=route.at(t);
      const start=index>0?(stations[index-1]+distance)*0.5:from;
      const end=index<count-1?(distance+stations[index+1])*0.5:to;
      const result=metrics(slice(frame,t),selection,epsilon,spend,contours);
      if(result.contours){
        for(const row of result.contours)retained+=row.points.length;
        check(retained<=1000000,'Path section report exceeds its contour output budget');
      }
      return {index,distance,t,span:[start,end],sectionLength:end-start,...frame,...result};
    });
    const minimum=key=>{
      let best=null;
      for(const section of sections)if(section[key]!==null&&(!best||section[key]<best.value))
        best={index:section.index,distance:section.distance,value:section[key]};
      return best;
    };
    return P.data.freeze({format,version:1,source:source.kind,selection,pathLength:length,range:[from,to],
      measuredLength:to-from,complete:sections.every(row=>row.area!==null),work,sections,
      minima:{area:minimum('area'),opening:minimum('minimumOpening'),centerClearance:minimum('centerClearance')}});
  }

  P.pathSections=Object.freeze({format,measure});
})(KIT);
