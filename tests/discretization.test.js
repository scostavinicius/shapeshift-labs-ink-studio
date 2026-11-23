const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT:K}=require('..').load(), {world:W,V}=K;
const {format,compile}=W.discretization;
const plan=(source,regions=[])=>({format,version:1,id:'mesh-study',revision:1,units:'m',source,regions});
const close=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<=eps,`${a} differs from ${b}`);
const plain=value=>JSON.parse(JSON.stringify(value));
const normalAt=(face,index)=>face.owner===index?face.normal:face.neighborNormal;

function verifyAdjacency(mesh) {
  for(const [i,cell] of mesh.cells.entries())for(const [j,id] of cell.faces.entries()){
    const face=mesh.faces[id], owner=face.owner===i;
    assert.equal(cell.signs[j],owner?1:-1);
    assert.equal(cell.neighbors[j],owner?face.neighbor:face.owner);
    assert.ok(V.dot(normalAt(face,i),V.sub(face.center,cell.center))>=0);
    if(face.neighbor!==null)assert.equal(face.region,null);
  }
}
function verifyClosed(mesh) {
  for(const [i,cell] of mesh.cells.entries()){
    const areaVector=cell.faces.reduce((sum,id)=>{
      const face=mesh.faces[id];
      return V.mad(sum,normalAt(face,i),face.area);
    },[0,0,0]);
    close(V.len(areaVector),0);
  }
}

test('regular 3D grid publishes cell centres and reciprocal physical faces in world units',()=>{
  const result=compile(plan({kind:'grid',size:[2,1,1],spacing:[2,3,4],origin:[1,2,3]},
    [{tag:'inlet',side:'x0'},{tag:'outlet',side:'x1'}]));
  assert.equal(result.dimension,3);
  assert.equal(result.measure,48);
  assert.equal(result.faces.length,11);
  assert.deepEqual(plain(result.cells.map(c=>c.center)),[[2,3.5,5],[4,3.5,5]]);
  const shared=result.faces.find(f=>f.neighbor!==null);
  assert.deepEqual(plain(shared.center),[3,3.5,5]);
  assert.deepEqual(plain(shared.normal),[1,0,0]);
  assert.deepEqual(plain(shared.neighborNormal),[-1,0,0]);
  close(shared.ownerDistance,1);
  close(shared.neighborDistance,1);
  close(shared.area,12);
  close(result.boundaries.inlet.area,12);
  close(result.boundaries.outlet.area,12);
  verifyAdjacency(result);
  verifyClosed(result);
});

test('native regular 2D masks preserve exposed holes and use chord lengths for face measures',()=>{
  const grid=K.cellular.domain.image({width:3,height:2,origin:[3,5],spacing:[2,1],mask:row=>row.id!=='1,1'});
  const result=compile(plan({kind:'grid',grid},[{tag:'west',side:'x0'},{tag:'hole',kind:'inactive'}]));
  assert.equal(result.dimension,2);
  assert.equal(result.cells.length,5);
  assert.equal(result.measure,10);
  assert.deepEqual(plain(result.cells[0].center),[4,5.5,0]);
  close(result.boundaries.hole.area,4);
  close(result.boundaries.west.area,2);
  verifyAdjacency(result);
  const xz=compile(plan({kind:'grid',size:[2,1],plane:'xz',spacing:[2,3],origin:[1,3,5]},
    [{tag:'low',side:'z0'}]));
  assert.deepEqual(plain(xz.cells[0].center),[2,3,6.5]);
  assert.deepEqual(plain(xz.cells[0].normal),[0,1,0]);
  close(xz.boundaries.low.area,4);
  verifyAdjacency(xz);
});

test('convex cut cells conserve measure and oriented face geometry across sparse blocks',()=>{
  const source={kind:'grid',size:[2,2,1],blocks:{left:{index:[0,0,0],size:[1,2,1]},right:{index:[1,0,0],size:[1,2,1]}},
    cutPlanes:[{id:'slope',tag:'sloped-wall',normal:[1,1,0],offset:2.5}]};
  const result=compile(plan(source,[{tag:'inlet',side:'x0'}]));
  assert.equal(result.cells.length,4);
  close(result.measure,4-1.5**2/2);
  close(result.cells.find(row=>row.id==='1,1,0').fraction,0.125);
  const tip=result.cells.find(row=>row.id==='1,1,0');
  close(tip.center[0],1+0.5/3);
  close(tip.center[1],1+0.5/3);
  close(result.boundaries['sloped-wall'].area,1.5*Math.SQRT2);
  const crossBlocks=result.faces.filter(f=>f.neighbor!==null&&result.cells[f.owner].block!==result.cells[f.neighbor].block);
  assert.equal(crossBlocks.length,2);
  close(crossBlocks.reduce((sum,f)=>sum+f.area,0),1.5);
  verifyAdjacency(result);
  verifyClosed(result);

  const edge=compile(plan({kind:'grid',size:[2,1,1],cutPlanes:[{id:'stop',normal:[1,0,0],offset:1}]}));
  close(edge.boundaries.stop.area,1);
  assert.equal(edge.cells.length,1);
});

test('sparse blocks allocate their cells independently of the enclosing lattice size',()=>{
  const source={kind:'grid',size:[1000000,1000,2000],
    blocks:{tiny:{index:[2,4,8],size:[2,1,1]},other:{index:[900000,20,12],size:[1,1,1]}}};
  const result=compile({...plan(source,[{tag:'void',kind:'inactive'}]),maxCells:3});
  assert.equal(result.cells.length,3);
  assert.deepEqual(plain(result.layout.blocks.tiny.cells),[0,1]);
  assert.ok(result.faces.filter(f=>f.neighbor!==null).length===1);
  assert.equal(result.boundaries.void.faces.length,16);
  assert.throws(()=>compile({...plan({...source,blocks:{...source.blocks,duplicate:source.blocks.tiny}}),maxCells:5}),/Overlapping sparse blocks/);
});

test('folded charts join authored sides and publish both local conormals',()=>{
  const plane=(id,origin,u,v)=>K.procedural.surface.plane({id,origin,u,v});
  const source={kind:'charts',charts:[
    {id:'floor',width:2,height:2,carrier:plane('floor',[0,0,0],[2,0,0],[0,1,0])},
    {id:'wall',width:1,height:2,carrier:plane('wall',[2,1,0],[0,0,1],[0,-1,0])}],
  seams:[{a:['floor','u1'],b:['wall','u0'],reverse:true}]};
  const result=compile(plan(source,[{tag:'left',chart:'floor',side:'u0'}]));
  assert.equal(result.cells.length,6);
  close(result.measure,3);
  close(result.boundaries.left.area,1);
  const joins=result.faces.filter(f=>f.neighbor!==null&&result.cells[f.owner].address[0]!==result.cells[f.neighbor].address[0]);
  assert.equal(joins.length,2);
  for(const f of joins){
    close(f.area,0.5);
    close(V.dot(f.normal,f.neighborNormal),0);
  }
  verifyAdjacency(result);
  assert.throws(()=>compile(plan({...source,seams:[{...source.seams[0],reverse:false}]})),/disagree on face geometry/);
});

test('indexed triangles, exact-weld triangle soup, and tetrahedra share the boundary representation',()=>{
  const pos=[0,0,0,1,0,0,1,1,0,0,1,0], tri=[0,1,2,0,2,3];
  const surface=compile(plan({kind:'mesh',mesh:K.mesh.make(pos,tri)},[{tag:'edge',vertices:[[0,1]]}]));
  assert.equal(surface.faces.length,5);
  close(surface.measure,1);
  close(surface.boundaries.edge.area,1);
  verifyAdjacency(surface);

  const soup=compile(plan({kind:'mesh',positions:tri.flatMap(i=>pos.slice(3*i,3*i+3))}));
  assert.equal(soup.faces.length,5);
  assert.equal(soup.vertices.length,4);
  const vertices=[0,0,0,1,0,0,0,1,0,0,0,1,0,0,-1];
  const solid=compile(plan({kind:'mesh',positions:vertices,tetrahedra:[0,1,2,3,0,1,2,4]}));
  assert.equal(solid.dimension,3);
  assert.equal(solid.faces.length,7);
  close(solid.measure,1/3);
  close(solid.faces.find(f=>f.neighbor!==null).area,0.5);
  verifyClosed(solid);
  verifyAdjacency(solid);

  assert.throws(()=>compile(plan({kind:'mesh',positions:[...pos,0,0,1],indices:[0,1,2,0,1,3,0,1,4]})),/Non-manifold/);
});

test('CLI produces portable boundary metadata from native chart and OBJ files',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ink-discretization-'));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js'), location=path.join(directory,'plan.json');
  const surface={kind:'charts',charts:[{id:'panel',width:2,height:1,
    carrier:{kind:'plane',origin:[0,0,0],u:[2,0,0],v:[0,1,0]}}]};
  const run=(source,regions)=>{
    fs.writeFileSync(location,JSON.stringify(plan(source,regions)));
    execFileSync(process.execPath,[cli,'sim','discretize','plan.json','--out','domain.json'],{cwd:directory});
    return JSON.parse(fs.readFileSync(path.join(directory,'domain.json'),'utf8'));
  };
  try {
    const chart=run(surface,[{tag:'edge',chart:'panel',side:'v0'}]);
    assert.equal(chart.boundaries.edge.area,2);
    fs.writeFileSync(path.join(directory,'tri.obj'),'v 0 0 0\nv 3 0 0\nv 0 2 0\nf 1 2 3\n');
    const mesh=run({kind:'mesh',file:'tri.obj'});
    assert.equal(mesh.cells[0].measure,3);
    assert.equal(mesh.faces.length,3);
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
