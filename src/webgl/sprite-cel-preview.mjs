/* A canvas-based timeline inspector. All rasters stay on the native art grid. */
const markup = `
<style>
  .icp { --paper:#ece3d0; --muted:#bac0bd; --line:#3e454a; --panel:#20272c; --well:#171e22;
    --before:#49d2e9; --after:#f675b7; color:var(--paper); font:14px/1.5 system-ui,sans-serif; }
  .icp * { box-sizing:border-box; }
  .icp-toolbar, .icp-transport { display:flex; align-items:center; flex-wrap:wrap; gap:10px 16px; }
  .icp-toolbar { padding:14px 0; border-block:1px solid var(--line); }
  .icp-toolbar label, .icp-transport label { display:inline-flex; align-items:center; gap:7px; }
  .icp-toolbar label:nth-last-child(2) { margin-left:auto; }
  .icp button,.icp select { border:1px solid #6a6d66; border-radius:4px; padding:6px 9px;
    background:#30393b; color:var(--paper); font:inherit; }
  .icp button { cursor:pointer; min-height:36px; }
  .icp button:disabled { opacity:.45; cursor:default; }
  .icp :focus-visible { outline:2px solid #ecc185; outline-offset:3px; }
  .icp input { accent-color:#ecc185; }
  .icp-panels { display:grid; grid-template-columns:minmax(0,1fr) minmax(175px,215px); gap:15px; margin-top:15px; }
  .icp section { min-width:0; background:var(--panel); border:1px solid var(--line); }
  .icp h2 { font-size:15px; font-weight:550; margin:0; }
  .icp-heading { display:flex; gap:8px; justify-content:space-between; align-items:baseline; padding:12px 15px; }
  .icp-heading p { margin:0; color:var(--muted); font:12px ui-monospace,monospace; white-space:nowrap; }
  .icp-well { overflow:auto; min-height:175px; padding:17px; display:flex;
    background:repeating-conic-gradient(#151d22 0% 25%,#1b252b 0% 50%) 0/16px 16px; }
  .icp-well[data-stage] { min-height:350px; }
  .icp canvas { image-rendering:pixelated; display:block; flex:none; margin:auto; }
  .icp [data-onion] { cursor:crosshair; }
  .icp-metrics { margin:0; padding:13px 15px 15px; display:grid; gap:4px; color:var(--muted);
    font:12px/1.6 ui-monospace,monospace; }
  .icp-metrics div { display:flex; flex-wrap:wrap; justify-content:space-between; gap:0 9px; }
  .icp-metrics dd { margin:0; color:var(--paper); }
  .icp [data-before] { color:var(--before); }
  .icp [data-after] { color:var(--after); }
  .icp-pixel { border-top:1px solid var(--line); padding:10px 15px; color:var(--muted);
    font:12px/1.5 ui-monospace,monospace; min-height:39px; display:block; overflow-wrap:anywhere; }
  .icp-transport { border-bottom:1px solid var(--line); padding:13px 0; }
  .icp-transport label { flex:1; min-width:190px; }
  .icp-transport input { width:100%; }
  .icp-transport output { min-width:108px; font:12px ui-monospace,monospace; color:var(--muted); }
  @media (max-width:680px) {
    .icp-panels { grid-template-columns:1fr; }
    .icp-well[data-stage] { min-height:240px; }
    .icp-toolbar label:nth-last-child(2) { margin-left:0; }
  }
</style>
<div class="icp">
  <div class="icp-toolbar">
    <label><input data-previous type="checkbox" checked> Previous skin</label>
    <label><input data-next type="checkbox" checked> Next skin</label>
    <label><input data-difference type="checkbox" checked> Changes only</label>
    <label>Neighbors <select data-neighbors><option value="drawings">Distinct drawings</option><option value="frames">Export frames</option></select></label>
    <label>Zoom <select data-zoom><option value="1">1×</option><option value="2">2×</option><option value="3">3×</option><option value="4">4×</option><option value="6">6×</option><option value="8">8×</option></select></label>
  </div>
  <div class="icp-panels">
    <section aria-label="Onion skin">
      <div class="icp-heading"><h2>Onion skin</h2><p data-overlay-size></p></div>
      <div class="icp-well" data-stage><canvas data-onion aria-label="Current cel with colored onion skins"></canvas></div>
      <output data-pixel class="icp-pixel">Point at a pixel to inspect it.</output>
    </section>
    <section aria-label="Native export">
      <div class="icp-heading"><h2>Native export</h2><p>1×</p></div>
      <div class="icp-well"><canvas data-native aria-label="Clean export at one CSS pixel per art pixel"></canvas></div>
      <dl class="icp-metrics">
        <div><dt>Dimensions</dt><dd data-size></dd></div>
        <div><dt>Previous <span data-before>skin</span></dt><dd data-before-frame></dd></div>
        <div><dt>Next <span data-after>skin</span></dt><dd data-after-frame></dd></div>
      </dl>
    </section>
  </div>
  <div class="icp-transport">
    <button type="button" data-back aria-label="Previous frame">‹</button>
    <button type="button" data-play>Play</button>
    <button type="button" data-forward aria-label="Next frame">›</button>
    <label>Frame <input data-frame type="range" min="0" max="0" step="1" value="0"></label>
    <output data-timing></output>
  </div>
</div>`;

export function mountSpriteCelPreview(host, { preview, frame = 0, zoom = 4 } = {}) {
  if (!host?.ownerDocument || typeof preview?.inspect !== 'function') throw new TypeError('A host and sprite cel preview are required');
  const win = host.ownerDocument.defaultView;
  if (![1,2,3,4,6,8].includes(zoom)) throw new RangeError('Unsupported sprite preview zoom');
  host.innerHTML = markup;
  const find = name => host.querySelector('[data-' + name + ']');
  const onion = find('onion'), native = find('native'), slider = find('frame');
  const previous = find('previous'), next = find('next'), difference = find('difference');
  const neighbors = find('neighbors'), magnification = find('zoom'), play = find('play');
  const pixel = find('pixel'), back = find('back'), forward = find('forward');
  const contexts = new Map([[onion,onion.getContext('2d')],[native,native.getContext('2d')]]);
  const listeners = new win.AbortController();
  const on = (element, event, callback) => element.addEventListener(event,callback,{signal:listeners.signal});
  let image, request, origin, playbackFrame, focusPixel;
  magnification.value = zoom;
  function draw(canvas, data, scale) {
    const { width,height } = preview;
    if (canvas.width !== width || canvas.height !== height) { canvas.width=width; canvas.height=height; }
    canvas.style.width = width*scale+'px';
    canvas.style.height = height*scale+'px';
    contexts.get(canvas).putImageData(new win.ImageData(new Uint8ClampedArray(data),width,height),0,0);
  }
  function pixelReadout() {
    if (!focusPixel) {
      pixel.value = 'Point at a pixel to inspect it.';
      return;
    }
    const [x,y] = focusPixel, i = (y*preview.width+x)*4;
    function value(data) {
      if (!data?.[i+3]) return 'clear';
      return '#' + [...data.subarray(i,i+3)].map(n=>n.toString(16).padStart(2,'0')).join('') +
        (data[i+3]<255 ? ' α'+data[i+3] : '');
    }
    const descriptions = [x+', '+y, 'current '+value(image.rgba)];
    if (image.previous) descriptions.push('previous '+value(image.previous.rgba));
    if (image.next) descriptions.push('next '+value(image.next.rgba));
    pixel.value = descriptions.join('  ·  ');
  }
  function refresh() {
    image = preview.inspect(frame,{
      previous:previous.checked, next:next.checked, neighbors:neighbors.value, changesOnly:difference.checked
    });
    draw(onion,image.onion,+magnification.value);
    draw(native,image.rgba,1);
    slider.max=preview.count-1;
    slider.value=frame;
    back.disabled=frame===0;
    forward.disabled=frame===preview.count-1;
    find('timing').value=(frame+1)+' / '+preview.count+' · '+image.time.toFixed(3)+' s';
    slider.setAttribute('aria-valuetext','Frame '+(frame+1)+' of '+preview.count);
    find('size').textContent=preview.width+' × '+preview.height;
    find('overlay-size').textContent=magnification.value+'× art pixels';
    find('before-frame').textContent=image.previous ? 'Frame '+(image.previous.index+1) : '—';
    find('after-frame').textContent=image.next ? 'Frame '+(image.next.index+1) : '—';
    pixelReadout();
  }
  function pause() {
    if (request !== undefined) win.cancelAnimationFrame(request);
    request=undefined;
    play.textContent='Play';
  }
  function seek(value) {
    if (!Number.isFinite(value)) throw new RangeError('Expected a finite frame index');
    pause();
    frame=Math.min(preview.count-1,Math.max(0,Math.round(value)));
    refresh();
  }
  function step(now) {
    origin ??= now;
    const current=(playbackFrame+Math.floor((now-origin)*preview.fps/1000))%preview.count;
    if (current!==frame) { frame=current; refresh(); }
    request=win.requestAnimationFrame(step);
  }
  on(play,'click',()=>{
    if (request!==undefined) { pause(); return; }
    origin=undefined;
    playbackFrame=frame;
    play.textContent='Pause';
    request=win.requestAnimationFrame(step);
  });
  on(slider,'input',()=>seek(+slider.value));
  on(back,'click',()=>seek(frame-1));
  on(forward,'click',()=>seek(frame+1));
  for(const control of [previous,next,difference,neighbors,magnification]) on(control,'change',refresh);
  on(onion,'pointermove',event=>{
    const bounds=onion.getBoundingClientRect();
    const x=Math.floor((event.clientX-bounds.left)*preview.width/bounds.width);
    const y=Math.floor((event.clientY-bounds.top)*preview.height/bounds.height);
    focusPixel=x>=0&&y>=0&&x<preview.width&&y<preview.height?[x,y]:undefined;
    pixelReadout();
  });
  on(onion,'pointerleave',()=>{ focusPixel=undefined; pixelReadout(); });
  seek(frame);
  return Object.freeze({ seek, pause,
    setPreview(next, value = 0) {
      if (typeof next?.inspect !== 'function') throw new TypeError('Expected a sprite cel preview');
      preview=next;
      focusPixel=undefined;
      seek(value);
    },
    dispose() { pause(); listeners.abort(); host.replaceChildren(); }
  });
}
