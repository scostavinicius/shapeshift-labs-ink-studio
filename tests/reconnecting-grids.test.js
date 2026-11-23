const test=require('node:test');
const assert=require('node:assert/strict');
const {KIT:K}=require('..').load();

test('a seekable wave opens one socket pairing and settles on a different route',()=>{
  const board=K.pixelTiles.reconnect({
    width:2,height:2,...K.pixelTiles.pairedArcs(),initial:['b','a','a','b'],period:5,
    cues:[
      {time:.5,duration:1,next:{a:'b',b:'a'},wave:{from:[0,0],speed:2}},
      {time:3,duration:.5,next:{a:'b',b:'a'}}
    ]
  });
  const start=board.trace(0,0,'E',0);
  assert.equal(start.end,'loop');
  assert.deepEqual(start.path.map(({exit})=>exit),['S','E','N','W']);
  assert.equal(board.sample(0,0,.74).stage,'open');
  assert.equal(board.sample(1,0,.74).variant,'a');
  assert.equal(board.sample(1,0,.74).active,false);
  assert.deepEqual(board.trace(0,0,'E',.74),{path:[],end:'open'});
  assert.deepEqual(board.trace(0,0,'E',2.5),{path:[{x:0,y:0,entry:'E',exit:'N'}],end:'edge'});
  assert.deepEqual(board.raster(.74),board.raster(5.74));
  assert.deepEqual(board.raster(0),board.raster(5));
  assert.deepEqual(board.trace(0,0,'E',-.5),start);
});

test('both hand-authored sizes preserve exact sockets and their visible paths match the declared topology',()=>{
  for(const size of [8,12]){
    const board=K.pixelTiles.reconnect({
      width:1,height:1,size,...K.pixelTiles.pairedArcs(size),cues:[{time:.5,duration:1,to:'b'}]
    });
    const edge=[
      i=>[i,0],i=>[size-1,i],i=>[i,size-1],i=>[0,i]
    ];
    const coords=edge.map(side=>side(size/2));
    for(const time of [0,.55,.79,1.07,1.34,1.51]){
      const {rgba}=board.raster(time),pose=board.sample(0,0,time);
      const opaque=(x,y)=>rgba[(y*size+x)*4+3]===255;
      for(const side of edge) for(let i=0;i<size;i++)
        assert.equal(opaque(...side(i)),i===size/2-1||i===size/2);
      for(const [direction,origin] of coords.entries()){
        const todo=[origin], seen=new Set();
        for(let j=0;j<todo.length;j++){
          const [x,y]=todo[j],key=y*size+x;
          if(seen.has(key)||x<0||x>=size||y<0||y>=size||!opaque(x,y)) continue;
          seen.add(key);
          todo.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
        }
        const pair=pose.pairs.find(value=>value.includes('NESW'[direction]));
        const reached=coords.map(([x,y],i)=>i!==direction&&seen.has(y*size+x)).filter(Boolean).length;
        assert.equal(reached,pair?1:0,size+' at '+time+' from '+'NESW'[direction]);
        if(pair){
          const partner=[...pair].find(letter=>letter!=='NESW'[direction]);
          assert.equal(seen.has(coords['NESW'.indexOf(partner)][1]*size+coords['NESW'.indexOf(partner)][0]),true);
        }
      }
    }
  }
});

test('reconnection rejects broken seams, missing transitions, and loops that do not reset',()=>{
  const config={width:2,height:1,...K.pixelTiles.pairedArcs()};
  const b=structuredClone(config.variants.b.cel);
  b.frames[0].rows[0]='.'.repeat(8);
  assert.throws(()=>K.pixelTiles.reconnect({...config,variants:{...config.variants,b:{pairs:['NW','ES'],cel:b}}}),/two center pixels/);
  const empty={pairs:[],cel:{width:8,height:8,rows:Array(8).fill('.'.repeat(8)),palette:['#010101']}};
  assert.throws(()=>K.pixelTiles.reconnect({...config,initial:['a','empty'],variants:{...config.variants,empty}}),/adjacent tiles/);
  assert.throws(()=>K.pixelTiles.reconnect({...config,transitions:[],cues:[{to:'b'}]}),/missing painted transition/);
  assert.throws(()=>K.pixelTiles.reconnect({...config,period:2,cues:[{to:'b'}]}),/restore every initial/);
});

function raster(w,h,points){
  const rgba=new Uint8ClampedArray(w*h*4);
  for(const [x,y,color] of points)rgba.set([color,0,0,255],(y*w+x)*4);
  return {w,h,rgba};
}
function marks({w,rgba}) {
  const points=[];
  for(let i=0;i<rgba.length;i+=4)if(rgba[i+3])points.push([(i/4)%w,Math.floor(i/4/w),rgba[i]]);
  return points;
}

test('turns pad rectangular glyphs and move only the exact selected texels',()=>{
  const input=raster(4,8,[[0,0,9],[2,0,19],[2,4,29]]);
  const turn=K.pixelGrid.turn({width:2,height:2,cell:[2,4],period:3,cues:[
    {rect:[1,0,1,2],time:.2,duration:.4,turns:1,wave:{from:[1,0],speed:2}},
    {rect:[1,0,1,2],time:2,duration:.4,turns:-1}
  ]});
  assert.deepEqual(marks(turn.raster(input,0)),[[1,0,9],[5,0,19],[5,4,29]]);
  assert.deepEqual(marks(turn.raster(input,.66)),[[1,0,9],[7,1,19],[5,4,29]]);
  assert.deepEqual(marks(turn.raster(input,1.2)),[[1,0,9],[7,1,19],[7,5,29]]);
  assert.deepEqual(marks(turn.raster(input,3)),marks(turn.raster(input,0)));
  assert.deepEqual(marks(input),[[0,0,9],[2,0,19],[2,4,29]]);
  assert.throws(()=>K.pixelGrid.turn({width:1,height:1,period:2,cues:[{turns:1}]}),/original orientation/);
  assert.throws(()=>K.pixelGrid.turn({width:2,height:2,cues:[{}, {rect:[0,0,1,1]}]}),/must not overlap/);
});

test('a canonical in-between is applied in the current orientation and steady art returns at the end',()=>{
  const sample=raster(4,4,[[0,0,33]]);
  const turn=K.pixelGrid.turn({width:1,height:1,cell:[4,4],cues:[
    {time:.2,duration:.2,turns:1},{time:.4,duration:.2,turns:-1}
  ],between:({direction})=>direction<0?raster(4,4,[[0,3,71]]):null});
  assert.deepEqual(marks(turn.raster(sample,.4)),[[3,0,33]]);
  assert.deepEqual(marks(turn.raster(sample,.5)),[[0,0,71]]);
  assert.deepEqual(marks(turn.raster(sample,.6)),[[0,0,33]]);
});
