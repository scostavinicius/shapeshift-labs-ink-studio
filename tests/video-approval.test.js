const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {test} = require('node:test');
const PNG = require('../cli/png.js');
const Metrics = require('../cli/video-approval-metrics.js');

const read = file=>JSON.parse(fs.readFileSync(file,'utf8'));
const width=48, height=30, start=20, count=6, rate='24000/1001';
const red=[190,45,55], green=[34,96,26], dark=[28,38,52], lamp=[20,215,235];
const out = (dir,name)=>path.join(dir,name);
function command(args,cwd){
  return spawnSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'take','approve-video',...args],{cwd,encoding:'utf8',timeout:30000});
}
function enc(args,cwd) {
  const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-nostdin',...args],{cwd,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.error?.message);
}
function pathDir(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-video-approval-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}
function available(t) {
  if (['ffmpeg','ffprobe'].every(name=>spawnSync(name,['-version'],{stdio:'ignore'}).status===0)) return true;
  t.skip('FFmpeg and FFprobe are unavailable');
  return false;
}
function fixture(dir) {
  fs.mkdirSync(out(dir,'source'));
  fs.mkdirSync(out(dir,'damaged'));
  const files=[];
  function paint(bytes,x,y,value){bytes.set(value,(y*width+x)*3);}
  for(let i=0;i<count;i++){
    const pixels=new Uint8Array(width*height*3);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)
      paint(pixels,x,y,x>=4&&x<=19&&y>=5&&y<25?x%2?red:green:dark);
    paint(pixels,34,10,lamp);
    // A genuine authored flicker is also present in the source.
    if (i===3) for(let y=11;y<19;y++)paint(pixels,39,y,[110,190,190]);
    const name='source/'+String(i).padStart(3,'0')+'.png';
    PNG.write(out(dir,name),width,height,pixels);
    files.push(name);
    const damaged=pixels.slice();
    if(i===1){
      for(let y=5;y<25;y++)for(let x=4;x<=19;x++)paint(damaged,x,y,[112,70,40]);
      paint(damaged,34,10,[40,90,120]);paint(damaged,35,10,[20,115,132]);
    }
    if(i===2) for(let y=16;y<22;y++) for(let x=29;x<33;x++)paint(damaged,x,y,[57,93,128]);
    PNG.write(out(dir,'damaged/'+String(i).padStart(3,'0')+'.png'),width,height,damaged);
  }
  return {format:'ink-studio/video-round-trip',version:1,delivery:'damaged.mp4',
    picture:{fps:{numerator:24000,denominator:1001},firstFrame:start,frames:files},
    palette:{pairs:[{id:'panel-paints',colors:['#be2d37','#22601a']}]},
    accents:{colors:['#14d7eb']}};
}
const json = (file,value)=>fs.writeFileSync(file,JSON.stringify(value));
function rgbVideo(dir,folder,name,extra=[]) {
  enc(['-framerate',rate,'-i',folder+'/%03d.png','-an','-c:v','libx264rgb','-crf','0',
    '-threads','1',...extra,name],dir);
}

test('reports source accent contrast loss and treats decoded-only reversals separately from authored motion',()=>{
  const settings=Metrics.prepare({palette:false,accents:{colors:['#fafafa']}});
  const make=()=>({w:7,h:3,source:new Uint8Array(63).fill(25),art:new Uint8Array(63).fill(25),mask:new Uint8Array(21)});
  const before=make(), middle=make(), after=make();
  for(const frame of [before,middle,after]) for(let k=0;k<3;k++) frame.source[30+k]=250;
  middle.art.fill(160,30,33);
  middle.art.fill(140,27,30);
  middle.art.fill(140,33,36);
  assert.equal(Metrics.accentCheck(middle,settings.accents,Metrics.displayColor()).damaged,1);
  assert(middle.mask[10]&Metrics.marks.accents);
  middle.art.fill(70,3,12);
  middle.source.fill(70,3,6);
  const flicker=Metrics.flickerCheck(before,middle,after,settings.flicker);
  assert.equal(flicker.flagged,true);
  assert(!(middle.mask[1]&Metrics.marks.flicker));
  assert(middle.mask[2]&Metrics.marks.flicker);
});

test('decodes the actual file, preserves presentation order and shows the first damaged frame',t=>{
  if(!available(t))return;
  const dir=pathDir(t), plan=fixture(dir);
  rgbVideo(dir,'damaged','damaged.mp4',['-output_ts_offset','1']);
  json(out(dir,'plan.json'),plan);
  const result=command(['plan.json','--out','review'],dir);
  assert.equal(result.status,2,result.stderr);
  const report=read(out(dir,'review/report.json'));
  assert.equal(report.status,'flagged');
  assert.equal(report.firstDamaged.sourceFrame,21);
  assert.equal(report.firstDamaged.deliveryFrame,1);
  assert.deepEqual(Object.keys(report.firstDamaged.problems),['palette','accents','flicker']);
  assert.deepEqual(report.flaggedFrames,{palette:1,accents:1,flicker:2});
  assert(report.delivery.firstPts>0);
  assert.equal(report.delivery.sha256,createHash('sha256').update(fs.readFileSync(out(dir,'damaged.mp4'))).digest('hex'));
  const joined=PNG.raster(out(dir,'review/comparison.png')), damage=PNG.raster(out(dir,'review/damage.png'));
  assert.deepEqual([joined.w,joined.h],[width*2,height]);
  const at=(y,x)=>[...joined.data.slice((y*joined.w+x)*4,(y*joined.w+x)*4+3)];
  assert.deepEqual(at(7,5),red);
  assert.deepEqual(at(7,width+5),[112,70,40]);
  assert(damage.data.some((value,index)=>index%4===0&&value===244||index%4===0&&value===255));
  assert(fs.readFileSync(out(dir,'review/index.html'),'utf8').includes('First damaged frame'));
});

test('approves matched lossless enlargement and flags genuine chroma subsampling from an unedited source',t=>{
  if(!available(t))return;
  const dir=pathDir(t), plan=fixture(dir);
  rgbVideo(dir,'source','clean.mp4',['-vf','scale=iw*2:ih*2:flags=neighbor']);
  json(out(dir,'clean.json'),{...plan,delivery:'clean.mp4',scale:2});
  const clean=command(['clean.json','--out','clean-review'],dir);
  assert.equal(clean.status,0,clean.stderr||clean.stdout);
  assert.equal(read(out(dir,'clean-review/report.json')).firstDamaged,null);
  assert.equal(fs.existsSync(out(dir,'clean-review/comparison.png')),false);

  enc(['-framerate',rate,'-i','source/%03d.png','-c:v','libx264','-crf','30','-pix_fmt','yuv420p',
    '-threads','1','web.mp4'],dir);
  json(out(dir,'web.json'),{...plan,delivery:'web.mp4',palette:{}});
  const web=command(['web.json','--out','web-review'],dir);
  assert.equal(web.status,2,web.stderr||web.stdout);
  const report=read(out(dir,'web-review/report.json'));
  assert.equal(report.delivery.pixelFormat,'yuv420p');
  assert(report.flaggedFrames.palette>0);
  assert(report.flaggedFrames.accents>0);
});

test('validates file cadence and frame count, honors clip cuts and fails uncovered protected colors',t=>{
  if(!available(t))return;
  const dir=pathDir(t), plan=fixture(dir);
  rgbVideo(dir,'damaged','irregular.mp4',['-vf','setpts=PTS+gte(N\\,3)','-fps_mode','passthrough']);
  json(out(dir,'irregular.json'),{...plan,delivery:'irregular.mp4'});
  const bad=command(['irregular.json','--out','invalid'],dir);
  assert.equal(bad.status,1,bad.stderr);
  assert.match(bad.stderr,/timing diverges/);
  assert.equal(fs.existsSync(out(dir,'invalid')),false);
  rgbVideo(dir,'damaged','damaged.mp4');
  json(out(dir,'length.json'),{...plan,window:{from:start,to:start+count-1}});
  assert.match(command(['length.json','--out','wrong-length'],dir).stderr,/decoded frames/);
  const frames=plan.picture.frames.map((file,i)=>({file,frame:start+i,cut:i===1||i===2,
    sha256:createHash('sha256').update(fs.readFileSync(out(dir,file))).digest('hex')}));
  json(out(dir,'clip.json'),{format:'ink-studio/graph-clip',version:1,fps:plan.picture.fps,from:start,to:start+count,frames});
  json(out(dir,'flicker.json'),{...plan,picture:'clip.json',palette:false,accents:false});
  const filtered=command(['flicker.json','--out','filtered'],dir);
  assert.equal(filtered.status,0,filtered.stderr||filtered.stdout);
  assert.equal(read(out(dir,'filtered/report.json')).flaggedFrames.flicker,0);
  json(out(dir,'unseen.json'),{...plan,accents:false,flicker:false,
    palette:{pairs:[{id:'offscreen',colors:['#112233','#223344']}]}});
  const unseen=command(['unseen.json','--out','unseen'],dir);
  assert.equal(unseen.status,2,unseen.stderr);
  assert.equal(read(out(dir,'unseen/report.json')).status,'inconclusive');
});
