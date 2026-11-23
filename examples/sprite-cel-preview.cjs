/* Generate a portable browser workbench for native sprite cels. */
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const ink = require('..');
const { line, fill, rect, pixel } = require('./pixel-stamp-studies.js');

function courier(turn, drift) {
  const n = turn;
  const art = [
    fill(0,[[0,79],[3,68],[16,58],[26,56],[33,50],[47,52],[52,58],[65,60],[74,70],[76,79]]),
    fill(1,[[4,77],[8,68],[20,62],[30,57],[45,56],[50,62],[63,64],[70,72],[72,78]]),
    fill(2,[[8,77],[11,69],[20,66],[27,61],[31,60],[27,68],[20,74],[19,78]]),
    fill(2,[[50,64],[57,63],[63,66],[68,75],[61,78],[55,71]]),
    line(3,[[8,70],[13,67],[21,64],[28,61]],1),
    fill(5,[[18,63],[28,56],[35,57],[42,57],[51,56],[56,64],[51,70],[39,74],[26,71]]),
    fill(6,[[21,63],[29,58],[36,59],[44,59],[51,58],[54,64],[48,68],[39,72],[28,69]]),
    line(7,[[22,63],[29,59],[35,60],[43,61]],1),line(7,[[47,61],[51,59],[54,63]],1),
    rect(13,36,69,5,4),pixel(14,38,70),
    // The silhouette changes as the near cheek comes around. The collar stays pinned.
    fill(4,[[21+n,30],[19+n,22],[22+n,14],[29+n,8],[38+n,6],[46+n,8],[55+n,14],[59+n,22],[58+n,33],
      [60+n,38],[57+n,43],[55+n,52],[49+n,62],[39+n,65],[31+n,62],[24+n,54],[20+n,47],[19+n,39]]),
    fill(8,[[25+n,28],[30+n,20],[40+n,18],[50+n,21],[55+n,28],[55+n,35],[59+n,39],[55+n,43],
      [54+n,50],[48+n,58],[41+n,62],[34+n,59],[27+n,53],[25+n,46],[22+n,41],[23+n,35]]),
    fill(9,[[27+n,29],[33+n,23],[42+n,21],[49+n,23],[53+n,30],[51+n,38],[54+n,44],[52+n,49],
      [47+n,55],[40+n,58],[35+n,56],[29+n,52],[27+n,44],[25+n,39]]),
    fill(10,[[28+n,32],[34+n,26],[42+n,25],[48+n,28],[47+n,36],[45+n,40],
      [48+n,44],[46+n,51],[40+n,54],[36+n,53],[32+n,48],[32+n,44],[28+n,41]]),
    fill(11,[[31+n,31],[36+n,27],[43+n,27],[47+n,30],[43+n,33],[35+n,33]]),
    line(8,[[29+n,48],[31+n,52],[35+n,55],[39+n,56]]),
    line(7,[[47+n,56],[45+n,58],[42+n,59]]),
    // Ear and hair are dark enough to frame the iris and lid.
    fill(9,[[22+n,36],[26+n,38],[27+n,44],[25+n,48],[22+n,46],[21+n,42]]),
    line(7,[[22+n,41],[24+n,40],[25+n,42],[24+n,45]]),pixel(11,22+n,39),
    fill(4,[[19+n,36],[17+n,30],[18+n,21],[22+n,13],[29+n,8],[37+n,6],[43+n,7],[49+n,8],
      [55+n,12],[59+n,16],[61+n,24],[58+n,31],[55+n,29],[53+n,23],[49+n,20],[42+n,25],[37+n,23],
      [31+n,27],[28+n,34],[26+n,38],[24+n,36],[22+n,39]]),
    fill(1,[[20+n,28],[21+n,21],[26+n,14],[31+n,11],[35+n,9],[43+n,8],[49+n,10],[55+n,14],
      [58+n,19],[58+n,24],[54+n,20],[49+n,17],[45+n,21],[42+n,22],[37+n,20],[31+n,23],[28+n,28],[25+n,33]]),
    fill(2,[[23+n,23],[27+n,16],[32+n,13],[39+n,11],[45+n,10],[50+n,12],[54+n,15],[46+n,14],
      [39+n,16],[36+n,18],[31+n,18],[28+n,21]]),
    line(3,[[27+n,16],[31+n,13],[35+n,12],[41+n,11]]),line(3,[[46+n,11],[51+n,12],[54+n,15]]),
    pixel(13,21+n,29),pixel(14,22+n,25),
    // A very small mouth against the lit nose.
    line(11,[[43+n,43],[45+n,45],[47+n,45]],1),line(7,[[44+n,46],[47+n,47],[50+n,46]],1),
    line(5,[[39+n,51],[43+n,50],[46+n,51],[49+n,50]]),line(11,[[42+n,53],[46+n,53]])
  ];
  const far = n > 2 ? [53+n,38,2] : [51+n,37,4];
  art.push(line(7,[[33+n,35],[38+n,34],[43+n,35]]),
    line(7,[[far[0]-1,far[1]-2],[far[0]+far[2],far[1]-1]]),
    fill(4,[[32+n,39],[35+n,37],[40+n,37],[43+n,39],[42+n,42],[36+n,43],[33+n,41]]),
    fill(12,[[33+n,40],[36+n,38],[40+n,38],[42+n,40],[40+n,42],[36+n,42]]),
    rect(3,37+n+drift,38,2,4),rect(4,38+n+drift,39,1,2),pixel(14,37+n+drift,39),
    rect(4,...far,3),rect(12,far[0],far[1]+1,far[2]-1,2),pixel(3,far[0]+far[2]-2,far[1]+1));
  return art;
}

function study(K) {
  const width = 76, height = 79, fps = 12;
  const palette = ['#131f2b','#213742','#315057','#557579','#242a38','#473340','#67454c','#95605b',
    '#a16d62','#bf8771','#dca680','#efc69c','#d9e5bf','#bd8355','#f6dfab'];
  const views = [[-2,0,3],[-1,0,3],[1,0,2],[1,1,2],[1,0,3],[3,0,3],[2,0,2]];
  const strip = new Uint8Array(width*height*views.length*4), stride=width*views.length;
  const frames = views.map(([turn,drift,hold],frame) => {
    const { rgba } = K.pixelStamps.image({width,height,palette,strokes:courier(turn,drift)});
    for(let y=0;y<height;y++)
      strip.set(rgba.subarray(y*width*4,(y+1)*width*4),(y*stride+frame*width)*4);
    return { frame,duration:hold/fps,rect:{x:frame*width,y:0,width,height},pivot:{x:38,y:43} };
  });
  const atlas = K.sprite.atlas({metadata:{width:stride,height,frames,fps},images:{color:strip}});
  return { atlas,width:90,height:88,fps,count:18,mode:'card',frame:8,
    title:'Cinder Courier', note:'Frame 9 has a deliberate one-pixel iris shift. Scrub across it or toggle the two skins to compare.' };
}

function page(workbench) {
  const { create } = ink.load().KIT.sprite.celPreview;
  const preview = create(workbench), unique = [], seen = new Map(), variants = [];
  for (const silhouette of [null, ...(workbench.silhouettes ?? [])]) {
    const session = silhouette === null ? preview : create({
      ...workbench, silhouette, origin:workbench.trackOrigin ?? workbench.origin
    });
    const ids = [];
    for (let i=0;i<session.count;i++) {
      const key=Buffer.from(session.inspect(i,{previous:false,next:false}).rgba).toString('base64');
      if (!seen.has(key)) { seen.set(key,unique.length); unique.push(key); }
      ids.push(seen.get(key));
    }
    variants.push({ label:silhouette ?? 'Composite', ids });
  }
  const data = JSON.stringify({
    width:preview.width,height:preview.height,fps:preview.fps,start:preview.start,unique,variants,
    frame:workbench.frame,title:workbench.title,note:workbench.note,zoom:workbench.zoom ?? (preview.width>200 ? 2 : 4)
  }).replace(/</g,'\\u003c');
  const source = file => fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  const session = source('src/kit/kpzz-sprite-preview.js');
  const component = source('src/webgl/sprite-cel-preview.mjs');
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sprite Cel Preview · Ink Studio</title>
<style>
  :root { color-scheme:dark; background:#181e23; color:#ece3d0; }
  body { margin:0; font:15px/1.5 system-ui,sans-serif; }
  main { width:min(calc(100% - 32px),1000px); margin:auto; padding:30px 0 35px; }
  header { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:end; gap:12px 24px; padding-bottom:20px; }
  h1 { margin:0; font:400 clamp(30px,5.5vw,55px)/1 Georgia,serif; letter-spacing:-.035em; }
  header p { margin:7px 0 0; color:#bdc4c0; }
  #note { max-width:258px; margin:0; font-size:13px; }
  #view-label { display:block; padding-bottom:12px; }
  #view-label[hidden] { display:none; }
  #view { margin-left:7px; font:inherit; padding:5px 8px; color:inherit; background:#30393b; border:1px solid #6a6d66; border-radius:4px; }
</style>
<main>
  <header><div><h1 id="title"></h1><p id="subtitle">Sprite cel preview</p></div><p id="note"></p></header>
  <label id="view-label" hidden>View <select id="view"></select></label>
  <div id="preview"></div>
</main>
<script type="module">
const KIT = {sprite:{}};
${session}
${component}
const data = ${data};
document.querySelector('#title').textContent=data.title;
document.querySelector('#note').textContent=data.note;
document.querySelector('#note').hidden=!data.note;
const decoded=data.unique.map(frame=>Uint8Array.from(atob(frame),ch=>ch.charCodeAt(0)));
const previews=data.variants.map(({ids})=>KIT.sprite.celPreview.fromFrames({...data,frames:ids.map(index=>decoded[index])}));
const host=document.querySelector('#preview'), select=document.querySelector('#view');
const view=mountSpriteCelPreview(host,{preview:previews[0],frame:data.frame,zoom:data.zoom});
if (previews.length>1) {
  document.querySelector('#view-label').hidden=false;
  data.variants.forEach(({label},i)=>select.add(new Option(label,i)));
  select.addEventListener('change',()=>view.setPreview(previews[+select.value],+host.querySelector('[data-frame]').value));
}
</script>
</html>`;
}

function main() {
  const { positionals, values } = parseArgs({ allowPositionals:true, options:{ atlas:{type:'string'}, width:{type:'string'},
    height:{type:'string'}, fps:{type:'string'}, frames:{type:'string'}, yaw:{type:'string'}, pitch:{type:'string'},
    mode:{type:'string'}, silhouette:{type:'string',multiple:true}, demo:{type:'string'} } });
  if (positionals.length !== 1 || values.demo !== undefined && (values.demo !== 'gale-signal' || values.atlas))
    throw new Error('Usage: node examples/sprite-cel-preview.cjs OUT.html [--atlas ATLAS.json | --demo gale-signal]');
  const makeStudy = values.demo ? require('./silhouette-tracks.js').study : study;
  const base = values.atlas ? { atlas:ink.readSpriteAtlas(values.atlas), width:128,height:128,fps:12,count:48,
    mode:'impostor',frame:0,title:path.basename(values.atlas),note:'' } : makeStudy(ink.load().KIT);
  const options = { ...base, ...Object.fromEntries(Object.entries(values)
    .filter(([name])=>['width','height','fps','yaw','pitch'].includes(name)).map(([name,v])=>[name,Number(v)])),
    count:Number(values.frames ?? base.count), mode:values.mode ?? base.mode,
    silhouettes:values.silhouette ?? base.silhouettes };
  const out = path.resolve(positionals[0]);
  fs.writeFileSync(out,page(options));
  process.stdout.write(out+'\n');
}

if (require.main === module) main();
module.exports = { study,page };
