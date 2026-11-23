const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { inflateSync } = require('node:zlib');
const { test } = require('node:test');
const ink = require('..');
const { layout } = require('../cli/deep-composite.js');

const scene = 'examples/deep-openexr/signal-relay.js';
const dir = t => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(),'ink-deep-openexr-'));
  t.after(()=>fs.rmSync(out,{recursive:true,force:true}));
  return out;
};
function decode(bytes) {
  assert.equal(bytes.readUInt32LE(0),20000630);
  assert.equal(bytes.readUInt32LE(4),0x802);
  let at = 8;
  function name(data) {
    const end = data.indexOf(0,at), s=data.toString('utf8',at,end);
    at=end+1;
    return s;
  }
  const header={};
  while(bytes[at]){
    const key=name(bytes), type=name(bytes), size=bytes.readInt32LE(at);
    at+=4;
    header[key]={type,data:bytes.subarray(at,at+size)};
    at+=size;
  }
  const offsetStart=at+1;
  assert.equal(header.type.data.toString(),'deepscanline');
  assert.equal(header.compression.data[0],2);
  const channels=new Map(), table=header.channels.data;
  at=0;
  while(table[at]){
    const channel=name(table), type=table.readInt32LE(at);
    assert.equal(table.readInt32LE(at+8),1);
    assert.equal(table.readInt32LE(at+12),1);
    channels.set(channel,type);
    at+=16;
  }
  assert.deepEqual([...channels.keys()],[...channels.keys()].sort());
  const w=header.dataWindow.data.readInt32LE(8)+1, h=header.dataWindow.data.readInt32LE(12)+1;
  function unzip(data, length) {
    if(data.length===length) return data;
    const filtered=inflateSync(data);
    assert.equal(filtered.length,length);
    for(let i=1;i<length;i++)filtered[i]+=filtered[i-1]-128;
    const evenEnd=Math.ceil(length/2);
    return Buffer.from(Uint8Array.from({length},(_,i)=>filtered[(i&1 ? evenEnd : 0)+(i>>1)]));
  }
  const rows=[];
  for(let y=0;y<h;y++){
    const block=Number(bytes.readBigUInt64LE(offsetStart+8*y));
    assert.equal(bytes.readInt32LE(block),y);
    const size=[4,12,20].map(offset=>Number(bytes.readBigUInt64LE(block+offset)));
    const start=block+28, offsets=unzip(bytes.subarray(start,start+size[0]),4*w);
    const values=unzip(bytes.subarray(start+size[0],start+size[0]+size[1]),size[2]);
    const total=offsets.readInt32LE((w-1)*4);
    assert.equal(values.length,total*channels.size*4);
    const pixels=[];
    for(let x=0,n=0;x<w;x++){
      const stop=offsets.readInt32LE(x*4), samples=[];
      for(;n<stop;n++) samples.push(Object.fromEntries([...channels].map(([key,type],i)=>[
        key,type===2?values.readFloatLE(4*(total*i+n)):values.readUInt32LE(4*(total*i+n))
      ])));
      pixels.push(samples);
    }
    rows.push(pixels);
  }
  return {header,rows};
}
function fixture() {
  const {stride,idStride}=layout, w=11,h=3,layers=4;
  const count=new Uint32Array(w*h), colors=new Float32Array(w*h*layers*stride), ids=new Uint32Array(w*h*layers*idStride);
  for(const [pixel,depths] of [[w+1,[6,2,2]],[w+3,[9]],[w+w-1,[4,3]]]){
    count[pixel]=depths.length;
    depths.forEach((z,i)=>{
      const slot=pixel*layers+i;
      colors.set([z,.5,.5,.4,.3,.05,.04,.03,.7,.8,.9],slot*stride);
      ids.set([2,i+1,i+1,0xf0000001+i],slot*idStride);
    });
  }
  return {deep:{w,h,layers,count,colors,ids,objects:[null,'glass A','glass B','glass C'],materials:[null],reflections:{}}};
}

test('writes variable-size deep ZIP rows and stable float depths with sample coverage and uint IDs',()=>{
  const {rows,header}=decode(ink.encodeDeepEXR(fixture(),{time:1.25}));
  assert(rows[0].every(pixel=>pixel.length===0));
  assert.equal(header.inkTimeSeconds.data.readDoubleLE(),1.25);
  assert.equal(header.inkSampleOrder.data.toString(),'sorted');
  const pixels=rows[1][1];
  assert.deepEqual(pixels.map(sample=>sample.Z),[2,2,6]);
  assert.deepEqual(pixels.map(sample=>sample.ZBack),[2,2,6]);
  assert.deepEqual(pixels.map(sample=>sample['ink.objectId']),[2,3,1]);
  assert.deepEqual(pixels.map(sample=>sample['ink.materialId']),[0xf0000002,0xf0000003,0xf0000001]);
  assert.deepEqual(pixels.map(sample=>sample.A),[.5,.5,.5]);
  assert.deepEqual(pixels.map(sample=>sample['ink.visibleCoverage']),[.5,.25,.125]);
  const color=((.05+.7*.5+.055)/1.055)**2.4*.5;
  assert(Math.abs(pixels[0].R-color)<1e-7);
  assert.deepEqual(rows[1][10].map(sample=>sample.Z),[3,4]);
  assert.equal(JSON.parse(header.inkStats.data.toString()).retainedSamples,6);
});

test('truncation is explicit and native reflection buffers are selected by name',()=>{
  const frame=fixture();
  frame.deep.count[0]=7;
  assert.throws(()=>ink.encodeDeepEXR(frame),/dropped 3 samples across 1 pixels/);
  frame.deep.colors.fill(0,0,4*layout.stride);
  const {header}=decode(ink.encodeDeepEXR(frame,{allowTruncated:true}));
  assert.equal(JSON.parse(header.inkStats.data.toString()).truncatedPixels,1);
  assert.throws(()=>ink.encodeDeepEXR(frame,{reflection:'unavailable'}),/no reflection named unavailable/);
  frame.deep.reflections.mirror={frame:fixture().deep};
  const reflected=decode(ink.encodeDeepEXR(frame,{reflection:'mirror'}));
  assert.equal(reflected.header.name.data.toString(),'reflection:mirror');
  assert.equal(reflected.rows[1][1].length,3);
});

test('the CLI exports the actual native art grid with calibrated camera depth and writes sequence metadata',t=>{
  const folder=dir(t), file=path.join(folder,'plate.exr');
  const run=(...args)=>execFileSync(process.execPath,['cli/ink-studio.js','export-deep',scene,...args],
    {cwd:path.resolve(__dirname,'..'),stdio:'pipe'});
  run('--out',file,'--w','144','--h','112','--px','2');
  const {header,rows}=decode(fs.readFileSync(file));
  assert.equal(rows.length,56);
  assert.equal(rows[0].length,72);
  assert.equal(header.worldToCamera.type,'m44f');
  const camera=header.worldToCamera.data, ndc=header.worldToNDC.data;
  const pixel=rows[28][40];
  assert.equal(pixel.length,3);
  assert(pixel.slice(0,2).every(n=>n.A>0&&n.A<1));
  assert(Math.abs(pixel[0].Z-(camera.readFloatLE(56)+1.1*camera.readFloatLE(40)))<1e-5);
  assert.equal(ndc.readFloatLE(48),.5);
  assert.equal(ndc.readFloatLE(52),.5);
  assert(ndc.readFloatLE(20)<0);
  const take=path.join(folder,'sequence');
  run('--out',take,'--w','40','--h','30','--t','0,.25');
  const manifest=JSON.parse(fs.readFileSync(path.join(take,'deep.json')));
  assert.deepEqual(manifest.frames.map(frame=>frame.time),[0,.25]);
  for(const item of manifest.frames) assert.equal(decode(fs.readFileSync(path.join(take,item.file))).rows.length,30);
  assert.throws(()=>run('--out',file,'--w','48','--h','40','--layers','1'),/capture dropped/);
  assert.equal(decode(fs.readFileSync(file)).rows.length,56);
  run('--out',file,'--w','48','--h','40','--layers','1','--allow-truncated','on');
  assert(JSON.parse(decode(fs.readFileSync(file)).header.inkStats.data.toString()).droppedSamples>0);
});

test('the official OpenEXR reader can merge a new opaque point between two transparent authored layers',
  {skip:!process.env.INK_TEST_OPENEXR_PYTHON},t=>{
    const folder=dir(t), out=path.join(folder,'relay.exr');
    const world=require('../'+scene)(ink.load()).build(51);
    ink.exportDeepEXR(world,{out,view:{w:232,h:158}});
    execFileSync(process.env.INK_TEST_OPENEXR_PYTHON,['examples/deep-openexr/compose.py',out,folder],
      {cwd:path.resolve(__dirname,'..'),stdio:'pipe'});
    const report=JSON.parse(fs.readFileSync(path.join(folder,'insertion-report.json')));
    assert.deepEqual(report.cases.between.samples.slice(0,3).map(item=>item.object),
      ['teal front sheet','service key','amber rear sheet']);
    assert(fs.statSync(path.join(folder,'merged-between.exr')).size>0);
  });
