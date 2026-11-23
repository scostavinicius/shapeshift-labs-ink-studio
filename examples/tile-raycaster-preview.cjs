/* Build the Lantern Archive as a standalone live raycaster and map inspector. */
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const studio = require('..');

function mount(K, example) {
  const archive=example.makeArchive(K,22), {map,doorCell,doorOpen,duration}=example.layout;
  const [width,height]=example.dimensions;
  const byId=id=>document.getElementById(id);
  const view=byId('view'), chart=byId('chart'), timeline=byId('timeline'), door=byId('door');
  const pixels=view.getContext('2d'), diagram=chart.getContext('2d');
  const art=new ImageData(width,height);
  const labels=['surface','depth','uv'].map(byId);
  let time=1.83, manual=null, point=[105,67], request, start, playFrom;
  timeline.max=duration;

  function mapView(camera, aperture, override) {
    const cell=17, left=(chart.width-archive.columns*cell)/2, top=(chart.height-archive.rows*cell)/2;
    const px=x=>left+x*cell, py=z=>top+z*cell;
    diagram.fillStyle='#101c21';
    diagram.fillRect(0,0,chart.width,chart.height);
    for (const [z,row] of map.entries()) for (const [x,key] of [...row].entries()) {
      diagram.fillStyle=key==='.'?'#253a3d':key==='J'?'#6e544a':key==='L'?'#635d4b':'#466269';
      diagram.fillRect(px(x),py(z),cell-1,cell-1);
    }
    const [x,,z]=camera.at, [gateX,gateZ]=doorCell;
    diagram.fillStyle='#ffbd82';
    diagram.fillRect(px(gateX+aperture),py(gateZ+.5)-1,(1-aperture)*cell,2);
    const horizontalFov=2*Math.atan(width/height*Math.tan(camera.fov/2));
    const segments=[-.5,0,.5].map(turn=>{
      const yaw=camera.yaw+horizontalFov*turn, vector=[Math.sin(yaw),Math.cos(yaw)];
      return archive.cast({at:[x,z],direction:vector,far:camera.far,time,doors:override})?.point ??
        [x+vector[0]*3,z+vector[1]*3];
    });
    diagram.strokeStyle='#95c8b7';
    for(const [u,v] of segments) {
      diagram.beginPath();
      diagram.moveTo(px(x),py(z));
      diagram.lineTo(px(u),py(v));
      diagram.stroke();
    }
    diagram.fillStyle='#ffdea9';
    diagram.beginPath();
    diagram.arc(px(x),py(z),3,0,Math.PI*2);
    diagram.fill();
  }

  function draw() {
    const camera=example.camera(time), aperture=manual??doorOpen(time);
    const override=manual===null?{}:{'copper-shutter':manual};
    const frame=archive.render({width,height,camera,time,doors:override});
    art.data.set(frame.data);
    pixels.putImageData(art,0,0);
    if (point) {
      const [x,y]=point;
      pixels.fillStyle='#ffdbab';
      pixels.fillRect(x-5,y,3,1); pixels.fillRect(x+3,y,3,1);
      pixels.fillRect(x,y-5,1,3); pixels.fillRect(x,y+3,1,3);
    }
    mapView(camera,aperture,override);
    const hit=point&&K.renderOutputs.pick(frame,...point);
    const values=hit?[hit.owner.id,hit.depth.toFixed(2),hit.uv.map(v=>v.toFixed(2)).join(', ')]:['—','—','—'];
    labels.forEach((label,i)=>{label.textContent=values[i];});
    timeline.value=time;
    door.value=aperture;
    byId('clock').value=time.toFixed(2)+' s';
    byId('percent').value=Math.round(aperture*100)+'%';
    byId('auto').disabled=manual===null;
  }
  function pause() {
    if (request!==undefined) cancelAnimationFrame(request);
    request=undefined;
    byId('play').textContent='Play';
  }
  function play(now) {
    start ??= now;
    const next=playFrom+Math.floor((now-start)*24/1000)/24;
    if (next>=duration) { time=duration; draw(); pause(); return; }
    if (next!==time) {time=next;draw();}
    request=requestAnimationFrame(play);
  }
  byId('play').addEventListener('click',()=>{
    if (request!==undefined) {pause();return;}
    if (time>=duration) time=0;
    start=undefined;
    playFrom=time;
    byId('play').textContent='Pause';
    request=requestAnimationFrame(play);
  });
  byId('auto').addEventListener('click',()=>{manual=null;draw();});
  timeline.addEventListener('input',()=>{pause();time=+timeline.value;draw();});
  door.addEventListener('input',()=>{manual=+door.value;draw();});
  view.addEventListener('pointerdown',event=>{
    const bounds=view.getBoundingClientRect();
    const clamp=(v,size)=>Math.max(0,Math.min(size-1,Math.floor(v*size)));
    point=[clamp((event.clientX-bounds.left)/bounds.width,width),clamp((event.clientY-bounds.top)/bounds.height,height)];
    draw();
  });
  view.addEventListener('keydown',event=>{
    const step={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
    if (!step) return;
    event.preventDefault();
    point=[Math.max(0,Math.min(width-1,point[0]+step[0])),Math.max(0,Math.min(height-1,point[1]+step[1]))];
    draw();
  });
  draw();
}

const source = file => fs.readFileSync(path.join(__dirname,file),'utf8');
const packed=gzipSync(studio.bundle()+ '\n'+source('pixel-stamp-studies.js')+ `
const example = (() => {
  const module = {exports:{}}, require = () => InkPixelStudies;
  ${source('tile-raycaster.js')}
  return module.exports;
})();
return { KIT, example };\n`,{level:9}).toString('base64');

const html=`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Lantern Archive · Ink Studio</title>
<style>
  :root{color-scheme:dark;background:#131d22;color:#e7d9c0;font:15px/1.5 system-ui,sans-serif}
  body{margin:0} main{max-width:1024px;margin:auto;padding:34px 20px}
  h1{font:400 clamp(36px,6vw,60px)/1 Georgia,serif;margin:0}
  header p{margin:.6em 0 1.25em;color:#aec2b6}
  .views{display:grid;grid-template-columns:minmax(0,1fr) 268px;gap:15px}
  section{min-width:0;background:#1a2a30;border:1px solid #40565b}
  h2{font:normal 13px/1.5 ui-monospace,monospace;margin:0;padding:10px 13px;color:#c4d8c9}
  canvas{display:block;width:100%;height:auto;image-rendering:pixelated;background:#0c151d}
  #view{cursor:crosshair}
  .controls{display:flex;align-items:center;flex-wrap:wrap;gap:10px 14px;padding:11px 12px;border-top:1px solid #40565b}
  label{font:13px ui-monospace,monospace}
  input{flex:1;min-width:110px;accent-color:#eeb481}
  output{min-width:56px;font:13px ui-monospace,monospace;color:#c4d8c9}
  button{font:inherit;color:inherit;background:#304044;border:1px solid #637675;border-radius:3px;padding:4px 11px;cursor:pointer}
  button:disabled{opacity:.5;cursor:default}
  :focus-visible{outline:2px solid #edb686;outline-offset:3px}
  dl{margin:12px 13px 14px;font:13px/1.5 ui-monospace,monospace}
  dl div{display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-top:1px solid #40565b}
  dt{color:#a8c1b4} dd{margin:0}
  @media(max-width:730px){main{padding:24px 14px}.views{grid-template-columns:1fr}#chart{max-width:268px;margin:auto}}
</style>
<main>
  <header><h1>The Lantern Archive</h1><p>Scrub the camera, move the shutter, or click a pixel to inspect the surface.</p></header>
  <div class="views">
    <section><h2>Camera</h2><canvas id="view" width="216" height="136" tabindex="0" aria-label="Click a pixel or move the probe with arrow keys"></canvas>
      <div class="controls"><button id="play">Play</button><label for="timeline">Time</label>
        <input id="timeline" type="range" min="0" step=".01"><output id="clock">Loading…</output></div>
      <div class="controls"><label for="door">Shutter</label><input id="door" type="range" min="0" max="1" step=".01">
        <output id="percent"></output><button id="auto">Follow cue</button></div>
    </section>
    <section><h2>Tilemap</h2><canvas id="chart" width="266" height="217" aria-label="Top-down walls, shutter, and camera rays"></canvas>
      <dl><div><dt>Surface</dt><dd id="surface">—</dd></div><div><dt>Depth</dt><dd id="depth">—</dd></div>
        <div><dt>UV</dt><dd id="uv">—</dd></div></dl>
    </section>
  </div>
</main>
<script type="module">
try {
  const bytes=Uint8Array.from(atob('${packed}'), c=>c.charCodeAt(0));
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const {KIT,example}=new Function(await new Response(stream).text())();
  (${mount.toString()})(KIT,example);
} catch (error) {
  document.querySelector('#clock').value=error.message;
}
</script>
</html>`;

if (process.argv.length!==3) throw new Error('Usage: node examples/tile-raycaster-preview.cjs OUT.html');
fs.writeFileSync(process.argv[2],html);
