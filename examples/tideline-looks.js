/* Four render treatments for the same layered lighthouse, ferry and camera move. */
const looks = require('./tideline-looks.json');
const duration = 2.4;
const tau = 2*Math.PI;
const left = -3.31, right = 3.31, bottom = -1.41, top = 1.65;
const clamp = (value,min=0,max=1) => Math.max(min,Math.min(max,value));
const mix = (a,b,t) => a+(b-a)*t;
const rgb = color => [1,3,5].map(index=>parseInt(color.slice(index,index+2),16));
const rect = (x0,y0,x1,y1) => [[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
const ellipse = (x,y,rx,ry,n=24) => Array.from({length:n},(_,i)=>[x+rx*Math.cos(tau*i/n),y+ry*Math.sin(tau*i/n)]);
const clippedRect = (x0,y0,x1,y1,r) =>
  [[x0+r,y0],[x1-r,y0],[x1,y0+r],[x1,y1-r],[x1-r,y1],[x0+r,y1],[x0,y1-r],[x0,y0+r]];

function layout() {
  const artwork = [], boat = [], beam = [];
  const add = (id,role,depth,profile,target=artwork) => target.push({id,role,depth,profile});
  const ring = (id,role,depth,outer,hole) => artwork.push({id,role,depth,rings:[outer,hole]});
  const panel = clippedRect(-3.55,-1.85,3.55,1.88,.16);
  const aperture = rect(left,bottom,right,top);
  add('backing','sky',-.74,aperture);
  add('sky','sky',-.62,aperture);
  add('sun','sun',-.51,ellipse(-1.97,.70,.64,.63,40));
  for (let i=0;i<3;i++) {
    const x=-3.17+i*.63, y=.41+i*.15;
    add('mist-'+i,'foam',-.49,[[x,y],[x+.48,y+.06],[x+1.15,y+.033],[x+1.37,y-.035],[x+.50,y-.026]]);
  }
  add('distant-shore','distant',-.40,[[left,-.43],[right,-.43],[right,.36],[2.48,.18],[1.71,.46],[.92,.28],
    [.33,.45],[-.25,.22],[-.77,.36],[-1.35,.10],[-2.10,.30],[-2.75,.13],[left,.29]]);
  add('near-shore','ridge',-.29,[[left,-.45],[right,-.45],[right,.06],[2.50,.22],[1.83,.04],[1.0,.19],
    [.36,-.13],[-.33,.12],[-1.01,-.04],[-1.81,.08],[-2.37,-.06],[-2.94,.03],[left,-.03]]);
  add('sea','sea',-.15,rect(left,bottom,right,-.27));
  for (let i=0;i<4;i++) {
    const y=-.52-i*.207;
    const strip=Array.from({length:21},(_,j)=> {
      const x=mix(left,right,j/20);
      return [x,y+(.037+i*.013)*Math.sin(x*(1.6+i*.13)+i*1.41)];
    });
    add('current-'+i,'wave',-.08+i*.034,[...strip,...strip.slice().reverse().map(([x,v])=>[x,v-.030-i*.010])]);
    for (let j=0;j<3;j++) {
      const x=-2.83+(j*1.11)+.24*(i%2), v=y+.050*Math.sin(i+j*2);
      add('foam-'+i+'-'+j,'foam',.064+i*.006,[[x,v],[x+.23,v+.031],[x+.62,v+.016],[x+.31,v-.013]]);
    }
  }
  add('headland','cliff',.28,[[.76,bottom],[right,bottom],[right,-.02],[2.86,.17],[2.44,.40],[1.30,.42],[1.0,.14],[.66,-.34],[.53,-.77]]);
  add('grassy-edge','bank',.33,[[.61,-.42],[.75,-.10],[1.10,.43],[1.52,.48],[2.48,.45],[2.87,.29],[right,.09],
    [right,-.06],[2.84,.10],[2.49,.24],[1.59,.24],[1.04,.20],[.88,-.13]]);
  add('cliff-light','shadow',.333,[[.83,-.33],[1.22,.16],[1.83,.17],[1.49,-.15],[1.38,-.54],[1.03,-.78],[.70,-1.30],[.60,-.88]]);
  for (const [i,[x,y,dx]] of [[1.45,-.67,.67],[2.24,-.85,.75],[1.07,-1.11,.59],[2.63,-.41,.42]].entries())
    add('strata-'+i,'roof',.347,[[x,y],[x+dx,y+.17],[x+dx*.88,y+.079],[x+.16,y-.016]]);
  add('tower-shadow','shadow',.44,[[1.19,.30],[1.97,.30],[1.79,1.17],[1.36,1.17]]);
  add('tower-face','tower',.48,[[1.25,.31],[1.71,.31],[1.65,1.17],[1.38,1.17]]);
  add('tower-mark','roof',.52,[[1.30,.69],[1.86,.69],[1.84,.80],[1.32,.80]]);
  add('gallery','metal',.52,clippedRect(1.18,1.06,1.96,1.19,.059));
  add('lens-frame','metal',.53,clippedRect(1.29,1.16,1.85,1.45,.036));
  add('lens','lantern',.57,rect(1.35,1.185,1.79,1.40));
  add('lens-post','metal',.61,rect(1.54,1.185,1.58,1.40));
  add('roof','roof',.59,[[1.18,1.40],[1.92,1.40],[1.74,1.55],[1.54,1.62],[1.40,1.54]]);
  add('pinnacle','trim',.61,ellipse(1.54,1.62,.052,.045,12));
  add('door','metal',.50,[[1.47,.32],[1.65,.32],[1.65,.495],[1.61,.55],[1.51,.55],[1.47,.50]]);
  add('beam','ray',.16,[[1.50,1.29],[-2.35,1.43],[-2.37,1.22]],beam);

  add('keel','metal',.80,[[-.70,-.91],[.66,-.91],[.42,-1.065],[-.49,-1.065]],boat);
  add('hull','hull',.83,[[-.74,-.86],[.70,-.86],[.52,-.98],[-.55,-.98]],boat);
  add('cabin','sail',.865,clippedRect(-.41,-.86,.22,-.62,.054),boat);
  add('roofline','metal',.89,[[-.47,-.64],[.30,-.64],[.15,-.56],[-.36,-.56]],boat);
  add('pilothouse-window','lantern',.92,rect(-.12,-.811,.13,-.697),boat);
  add('mast','metal',.89,rect(-.22,-.57,-.18,-.37),boat);
  add('flag','roof',.92,[[-.18,-.38],[.10,-.46],[-.18,-.48]],boat);
  add('wake','foam',.766,[[-1.17,-1.06],[-.60,-1.10],[.21,-1.126],[.66,-1.095],[.90,-1.13],[.11,-1.174],[-.70,-1.133]],boat);

  ring('frame','frame',.94,panel,aperture);
  ring('outer-trim','trim',1.0,clippedRect(-3.48,-1.79,3.48,1.81,.13),clippedRect(-3.444,-1.754,3.444,1.774,.11));
  add('title-plaque','metal',1.003,clippedRect(-.88,-1.785,.89,-1.467,.060));
  for (const [i,x] of [-3.31,3.31].entries()) {
    add('lower-rivet-'+i,'trim',1.01,ellipse(x,-1.621,.072,.068,16));
    add('upper-rivet-'+i,'trim',1.01,ellipse(x,1.747,.054,.053,16));
  }
  return {artwork,boat,beam};
}

function paperPlan(K, rows, style, thickness) {
  return K.paper.stack(rows.map(({role,...row})=>({...row,color:style.palette[role],
    ...(style.paper && {edgeColor:'#f2d5ac'})})),{thickness});
}

// Value noise in world XY keeps the ink mottling registered during the camera move.
function washAtlas(K, SpriteSurface, plan, style, seed) {
  const atlas = SpriteSurface.make(896,2048), writes = [];
  function noise(x,y,scale,salt) {
    const u = x/scale, v = y/scale, i = Math.floor(u), j = Math.floor(v);
    const s = u-i, t = v-j, a = s*s*(3-2*s), b = t*t*(3-2*t);
    return mix(mix(K.hash(i,j,seed+salt),K.hash(i+1,j,seed+salt),a),
      mix(K.hash(i,j+1,seed+salt),K.hash(i+1,j+1,seed+salt),a),b);
  }
  for (const layer of plan.layers) {
    const {bleed,texel,textureScale} = style, d = bleed*1.3;
    const x0=Math.min(...layer.points.map(p=>p[0]))-d, x1=Math.max(...layer.points.map(p=>p[0]))+d;
    const y0=Math.min(...layer.points.map(p=>p[1]))-d, y1=Math.max(...layer.points.map(p=>p[1]))+d;
    const w=Math.ceil((x1-x0)/texel), h=Math.ceil((y1-y0)/texel), rgba=new Uint8Array(w*h*4);
    const distances=layer.rings.map(K.procedural.geometry.profileDistance), subtle=layer.id==='sky'||layer.id==='backing';
    const paper=rgb(style.palette.outside);
    for (let j=0;j<h;j++) for (let i=0;i<w;i++) {
      const x=mix(x0,x1,(i+.5)/w), y=mix(y1,y0,(j+.5)/h);
      let boundary=Infinity, inside=false;
      for (const sample of distances) { const sd=sample(x,y); boundary=Math.min(boundary,Math.abs(sd)); if(sd<0) inside=!inside; }
      const coarseness=noise(x,y,textureScale,7), grit=noise(x,y,.045,37);
      const dist=(inside?-boundary:boundary)+(coarseness-.50)*bleed*.94;
      const feather=clamp(.60-dist/(bleed*1.32)), margin=feather*feather*(3-2*feather);
      if (!margin) continue;
      const pool=1-clamp(boundary/.10);
      const cloud=noise(x*.67,y*1.25,textureScale*1.85,13), pigment=(coarseness-.5)*.21+(grit-.5)*.10;
      const tone=subtle ? 1+(cloud-.46)*.07 : .99+pigment+(cloud-.44)*.18-pool*.13;
      const strength=subtle ? .96 : .88+grit*.1;
      const q=(j*w+i)*4;
      for(let c=0;c<3;c++) rgba[q+c]=clamp(Math.round(mix(paper[c],layer.color[c]*tone,strength)),0,255);
      rgba[q+3]=Math.round(margin*255);
    }
    const region=atlas.reserve(w,h);
    atlas.faceRegion([x0,y0,layer.depth],[x1-x0,0,0],[0,y1-y0,0],region,{id:layer.id});
    writes.push({region,w,h,rgba});
  }
  const result=atlas.finish();
  for (const {region,...image} of writes) SpriteSurface.update(result,region,image);
  return result;
}

function finishFor(id, style) {
  if (id==='enamel') return {id:'glazed-enamel',
    normal:{type:'waves',axis:[.74,1,0],scale:4.4,amplitude:.15,cross:.12}, layers:{
    pinholes:{type:'tint',color:'#443c43',strength:.08,blend:'multiply',mask:{type:'noise',scale:style.textureScale,low:.55,high:.78}},
    gloss:{type:'specular',color:'#fff1bf',strength:.66,roughness:style.roughness}
  }};
  if (id==='stained-glass') return {id:'stippled-lead',layers:{
    ripples:{type:'tint',color:'#f1bd96',strength:.17,mask:{type:'noise',scale:.085,low:.48,high:.85}}
  }};
  return undefined;
}

function patches(K, B, plan, style, id, { opacity=1.3, coat=true } = {}) {
  const finish=coat ? finishFor(id,style) : undefined, light=[-.35,.50,1];
  for (const layer of plan.layers) for (const face of layer.triangles) {
    K.surfacePatches.triangle(B,face.map(i=>[...layer.points[i],layer.depth]),{
      color:layer.color,normal:[0,0,1],object:layer.id,finish,light,opacity
    });
  }
}

function tessellate(K,B,row,style,seed) {
  const sea = row.id==='sea', lens = row.id==='lens';
  const [x0,y0]=row.profile[0], [x1,y1]=row.profile[2];
  const nx=lens ? 4 : Math.max(2,Math.round((x1-x0)/style.textureScale));
  const ny=lens ? 2 : Math.max(2,Math.ceil((y1-y0)/(style.textureScale*.9)));
  const cells = K.mosaic.voronoi({ bounds:[x0,y0,x1,y1],
    sites:Array.from({length:nx*ny},(_,i)=>{
      const x=i%nx,y=Math.floor(i/nx);
      return [mix(x0,x1,(x+.28+.44*K.hash(x,y,seed))/nx),mix(y0,y1,(y+.25+.50*K.hash(x,y,seed+11))/ny)];
    })
  });
  const palette=lens ? ['#ffe3a0','#e49142','#f1c875','#fc9b64'] :
    sea ? ['#176194','#3275be','#4fa0aa','#3668ac','#5f54a5'] :
    ['#9662bf','#756ac2','#574d9d','#4279b7','#b875b9','#6799bd','#a66b9d'];
  const mesh=K.mosaic.mesh(cells,{
    gap:lens ? Math.min(.012,style.gap) : style.gap, bevel:0, thickness:.018, grout:'#362942', palette,
    paint:cell=>palette[Math.floor(K.hash(cell.index,sea?7:4,seed+70)*palette.length)],
    sample:([x,y],h)=>[x,y,row.depth+h],
    controls:{transmission:style.transmission,roughness:.14,ior:1.5,thickness:.039,absorption:.72,coating:{weight:.17,roughness:.09}}
  });
  K.mosaic.emit(B,mesh,{object:row.id,ambient:.9});
}

function label(SpriteSurface, style) {
  const atlas=SpriteSurface.make(128);
  // Three strokes per glyph stay readable when the seven-pixel plaque tilts.
  const font={
    T:['###','.#.','.#.','.#.','.#.'], I:['###','.#.','.#.','.#.','###'],
    D:['##.','#.#','#.#','#.#','##.'], E:['###','#..','##.','#..','###'],
    L:['#..','#..','#..','#..','###'], N:['#.#','###','###','#.#','#.#']
  };
  const glyphs=[...'TIDELINE'].map(ch=>font[ch]), ink=parseInt(style.palette.label.slice(1),16);
  atlas.face([-.747,-1.736,1.054],[1.494,0,0],[0,.228,0],32,5,
    (x,y)=>glyphs[Math.floor(x/4)][y][x%4]==='#' ? ink : undefined,{id:'title'});
  return atlas.finish();
}

function drawLook(K,B,SpriteSurface,rows,id,seed,atlases) {
  if (!rows.length) return;
  const style=looks[id];
  if (id==='ink-wash') atlases.push(washAtlas(K,SpriteSurface,paperPlan(K,rows,style,0),style,seed));
  if (id==='cut-paper') {
    const {grain,fibers,shadowStrength,softness}=style.paper;
    atlases.push(K.paper.draw(B,paperPlan(K,rows,style,.060),{texel:style.textureScale,ambient:.76,
      light:[-.68,.64,1],shadowStrength,softness,texture:{grain,fibers,seed}}).spriteSurfaces);
  }
  if (id==='enamel') {
    const plan=paperPlan(K,rows,style,.024);
    K.paper.draw(B,plan,{paint:'native',texture:false,ambient:.76,shadowStrength:0,light:[-.35,.5,1]});
    patches(K,B,{layers:plan.layers.map(layer=>({...layer,depth:layer.depth+.013}))},style,id);
  }
  if (id==='stained-glass') {
    const tesserae=new Set(['sky','sea','lens']);
    const solids=rows.filter(row=>!tesserae.has(row.id));
    if (solids.length) patches(K,B,paperPlan(K,solids,style,0),style,id);
    for (const [i,row] of rows.filter(row=>tesserae.has(row.id)).entries()) tessellate(K,B,row,style,seed+i*17);
  }
}

function treatment(row) {
  if (['sky','backing','sun','distant-shore','near-shore'].includes(row.id) || row.id.startsWith('mist-')) return 'ink-wash';
  if (row.id==='sea' || row.id==='lens') return 'stained-glass';
  if (['frame','outer-trim','title-plaque'].includes(row.id) || row.id.includes('-rivet-')) return 'enamel';
  return 'cut-paper';
}

module.exports = ({KIT:K,makeBuilder,SpriteSurface})=>({
  id:'tideline-looks', name:'Tideline signal', seed:81,
  build(seed,{controls={}}={}) {
    const id=controls.look ?? 'ink-wash', mixed=id==='mixed', movingLook=mixed ? 'enamel' : id;
    const style=looks[movingLook];
    if (!Object.hasOwn(looks,movingLook)) throw new RangeError('Tideline look must be '+[...Object.keys(looks),'mixed'].join(', '));
    const B=makeBuilder(seed,Object.values(style.palette).map(color=>parseInt(color.slice(1),16))), atlases=[];
    const {artwork,boat,beam}=layout(), rig=K.rig(B,{});
    for (const key of mixed ? Object.keys(looks) : [id])
      drawLook(K,B,SpriteSurface,mixed ? artwork.filter(row=>treatment(row)===key) : artwork,key,seed,atlases);
    rig.own('ferry',()=>patches(K,B,paperPlan(K,boat,style,0),style,movingLook));
    rig.own('beam',()=>patches(K,B,paperPlan(K,beam,style,0),style,movingLook,{opacity:movingLook==='enamel' ? .22 : .31,coat:false}));
    atlases.push(label(SpriteSurface,style));
    const areaLights = id==='stained-glass' || mixed ? [{
      id:'glass-backlight',at:[0,mixed ? -.84 : .12,-.690],normal:[0,0,1],size:[6.60,mixed ? 1.125 : 3.04],
      radius:1.2,intensity:.86,volumeIntensity:0,color:'#ffe6c7',reflection:false,shadows:false
    }] : undefined;
    const world=B.finish({radius:8,dither:0,cam:{target:[0,0,.18],dist:6.45,yaw:-.045,pitch:.13,ortho:true,sway:0},
      areaLights,spriteSurfaces:atlases,look:{pixelSize:1,artDirection:{cadence:{scene:style.cadence}}}});
    const stage=K.stage(world);
    rig.bind(stage);
    stage.add({pre(_dt,time) {
      const phase=tau*time/duration;
      rig.set('ferry',K.M.rot([0,0,1],-.075*Math.sin(phase+.45)),[0,-.93,.83],
        [-.86+.49*Math.sin(phase),-.93+.046*Math.cos(phase*2),.83]);
      rig.set('beam',K.M.rot([0,0,1],.078*Math.sin(phase)),[1.50,1.29,.16],[1.50,1.29,.16]);
      rig.apply();
    }});
    return K.cameraRig.bind(world,K.cameraRig.compile({duration,shots:{
      front:{yaw:-.045,pitch:.13,dist:6.45,projection:'orthographic',target:[0,0,.18]},
      side:{yaw:.15,pitch:.17,dist:6.45,projection:'orthographic',target:[0,0,.18]}
    },sequence:[{time:0,shot:'front'},{time:.04,shot:'side',blend:1.14},{time:1.20,shot:'front',blend:1.20}]}));
  }
});

module.exports.duration = duration;
