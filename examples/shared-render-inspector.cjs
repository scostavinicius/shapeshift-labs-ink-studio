/* Export the actual Ridge Dispatch capture planes for inspection in a standalone browser page. */
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const studio = require('..');
const { makeStudy } = require('./projected-routes.js');
const { KIT: K } = studio.load();
const { renderOutputs: R } = K;
const width = 240, height = 144;
const times = [1.5, 2.75, 3.75, 4.75, 6.5, 7.75];

function encode(array) {
  return Buffer.from(array.buffer,array.byteOffset,array.byteLength).toString('base64');
}

function capture() {
  const study = makeStudy(K,39);
  const atlas = studio.createCameraAtlas({width,height,views:[{
    id:'ridge',rect:[0,0,width,height],
    source:({time}) => {
      const {rgba,route} = study.render(time);
      return R.create({...route,data:rgba});
    }
  }]});
  try {
    return times.map(time => {
      atlas.capture({}, {time});
      const {data,depth,ids,uv,owners,camera} = atlas.outputs('ridge');
      return {time,width,height,owners,camera,data:encode(data),depth:encode(depth),ids:encode(ids),uv:encode(uv)};
    });
  } finally {
    atlas.dispose();
  }
}

function mount(R, snapshots) {
  const live = document.querySelector('#feed'), inspect = document.querySelector('#plane');
  const timeline = document.querySelector('#timeline'), mode = document.querySelector('#mode');
  const metrics = Array.from(document.querySelectorAll('dd'));
  const [feedCtx,planeCtx] = [live,inspect].map(canvas => canvas.getContext('2d'));
  const planes = snapshots.map(({time,...state}) => ({time,frame:R.create(state)}));
  timeline.max=planes.length-1;
  timeline.value=3;
  let pixel = null;
  const wrap = value => value-Math.floor(value);
  function show() {
    const {time,frame}=planes[+timeline.value];
    const {width:w,height:h}=frame;
    const hit = pixel && R.pick(frame,...pixel), kind=mode.value;
    const raster=R.raster(frame,kind);
    const preview=new ImageData(w,h);
    const colors=[[105,159,145],[76,130,130],[57,100,115],[43,75,98],[32,54,76],[23,36,53]];
    for (let i=0;i<w*h;i++) {
      const id=frame.ids[i], p=i*4;
      let swatch=[13,21,28];
      if (id) {
        if (kind==='depth') swatch=colors[Math.min(colors.length-1,Math.floor(Math.log2(1+raster.data[i]/2)))];
        else if (kind==='ids') swatch=[64+(id*73)%126,67+(id*39)%118,62+(id*93)%167];
        else swatch=[Math.floor(70+170*wrap(raster.data[i*3])),Math.floor(66+150*wrap(raster.data[i*3+1])),126];
        if (hit && hit.id===id) swatch=[244,127,90];
      }
      preview.data.set([...swatch,255],p);
    }
    feedCtx.putImageData(new ImageData(new Uint8ClampedArray(frame.data),w,h),0,0);
    planeCtx.putImageData(preview,0,0);
    if (pixel) for (const ctx of [feedCtx,planeCtx]) {
      const [x,y]=pixel;
      ctx.fillStyle='#ffdcaa';
      ctx.fillRect(x-6,y,4,1); ctx.fillRect(x+3,y,4,1);
      ctx.fillRect(x,y-6,1,4); ctx.fillRect(x,y+3,1,4);
    }
    document.querySelector('#time').value=time.toFixed(2)+' s';
    timeline.setAttribute('aria-valuetext',time.toFixed(2)+' seconds');
    const format = values => values.map(value=>value.toFixed(2)).join(', ');
    const values = [pixel?.join(', ') ?? '—',hit?.owner.id ?? '—',hit?.depth.toFixed(2) ?? '—',
      hit ? format(hit.uv) : '—',hit?.position ? format(hit.position) : '—',
      hit ? '#'+hit.rgba.slice(0,3).map(n=>n.toString(16).padStart(2,'0')).join('') : '—'];
    metrics.forEach((node,index)=>{node.textContent=values[index];});
  }
  for (const canvas of [live,inspect]) {
    canvas.addEventListener('pointerdown',event=>{
      const box=canvas.getBoundingClientRect();
      pixel=[Math.min(canvas.width-1,Math.max(0,Math.floor((event.clientX-box.left)*canvas.width/box.width))),
        Math.min(canvas.height-1,Math.max(0,Math.floor((event.clientY-box.top)*canvas.height/box.height)))];
      show();
    });
    canvas.addEventListener('keydown',event=>{
      const axis={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
      if (!axis) return;
      event.preventDefault();
      const [x,y]=pixel ?? [Math.floor(canvas.width/2),Math.floor(canvas.height/2)];
      pixel=[Math.min(canvas.width-1,Math.max(0,x+axis[0])),Math.min(canvas.height-1,Math.max(0,y+axis[1]))];
      show();
    });
  }
  timeline.addEventListener('input',show);
  mode.addEventListener('change',show);
  const {frame}=planes[+timeline.value], id=frame.owners.findIndex(owner=>owner?.id==='lower-signal');
  const index=frame.ids.findIndex((owner,i)=>owner===id && frame.data[i*4]>210);
  if (index>=0) pixel=[index%frame.width,Math.floor(index/frame.width)];
  show();
}

function page() {
  const source=fs.readFileSync(path.join(__dirname,'../src/render-outputs.js'),'utf8');
  const data=gzipSync(JSON.stringify(capture()),{level:9}).toString('base64');
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ridge Dispatch • Feed Inspector</title>
<style>
  :root{background:#141b24;color:#ead8bc;color-scheme:dark;font:15px/1.5 system-ui,sans-serif}
  body{margin:0} main{max-width:980px;margin:auto;padding:35px 18px}
  h1{font:400 clamp(34px,6vw,55px)/1 Georgia,serif;margin:0;color:#f3dcc0}
  header p{color:#b0c6bf;margin:.55em 0 1.3em}
  .controls,.bar{display:flex;align-items:center;gap:12px}
  .controls{border-block:1px solid #425760;padding:10px 0;margin-bottom:15px;flex-wrap:wrap}
  .controls input{flex:1;min-width:140px;accent-color:#f49e73}
  .bar{justify-content:space-between;padding:7px 11px;min-height:36px}
  label,output,.bar{font:13px/1.4 ui-monospace,monospace}
  select{font:inherit;padding:.28em .5em;border:1px solid #67807b;background:#273740;color:inherit}
  .panes{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  section{border:1px solid #425760;background:#1d2b34;min-width:0}
  canvas{display:block;image-rendering:pixelated;width:100%;height:auto;cursor:crosshair;background:#101820}
  canvas:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #ffc783;outline-offset:3px}
  dl{display:grid;grid-template-columns:repeat(3,1fr);gap:0 12px;margin:15px 0 0}
  dl div{border-top:1px solid #425760;padding:7px 0 9px;min-width:0}
  dt{color:#a5bfb7;font-size:13px} dd{margin:3px 0 0;overflow-wrap:anywhere;font:14px ui-monospace,monospace}
  @media(max-width:630px){.panes{grid-template-columns:1fr}dl{grid-template-columns:repeat(2,1fr)}}
</style>
<main>
  <header><h1>Ridge Dispatch</h1><p>Pick a pixel in either view to read the captured surface.</p></header>
  <div class="controls"><label for="timeline">Capture time</label>
    <input id="timeline" type="range" min="0" max="0" step="1"><output id="time">Loading…</output></div>
  <div class="panes">
    <section><div class="bar">Color feed</div><canvas id="feed" width="240" height="144" tabindex="0" aria-label="Pick a color pixel with a pointer or arrow keys"></canvas></section>
    <section><div class="bar"><label for="mode">Diagnostic plane</label><select id="mode"><option value="depth">Depth</option><option value="ids">Surface ID</option><option value="uv">Texture UV</option></select></div>
      <canvas id="plane" width="240" height="144" tabindex="0" aria-label="Pick a diagnostic pixel with a pointer or arrow keys"></canvas></section>
  </div>
  <dl><div><dt>Pixel</dt><dd></dd></div><div><dt>Surface</dt><dd></dd></div><div><dt>Depth</dt><dd></dd></div>
    <div><dt>UV</dt><dd></dd></div><div><dt>World XYZ</dt><dd></dd></div><div><dt>Color</dt><dd></dd></div></dl>
</main>
<script type="module">
${source}
try {
  const buffer = text => Uint8Array.from(atob(text),char=>char.charCodeAt(0)).buffer;
  const zipped = new Blob([buffer('${data}')]).stream();
  const decoded = await new Response(zipped.pipeThrough(new DecompressionStream('gzip'))).json();
  (${mount.toString()})(RenderOutputs,decoded.map(frame=>({...frame,
    data:new Uint8Array(buffer(frame.data)),depth:new Float64Array(buffer(frame.depth)),
    ids:new Uint16Array(buffer(frame.ids)),uv:new Float64Array(buffer(frame.uv))
  })));
} catch (error) {
  document.querySelector('#time').value=error.message;
}
</script>
</html>`;
}

if (process.argv.length!==3) throw new Error('Usage: node examples/shared-render-inspector.cjs OUT.html');
fs.writeFileSync(process.argv[2],page());
