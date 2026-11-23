/* Rime Lock, an original frost study over visible 3D material boundaries. */
const fs=require('node:fs');
const path=require('node:path');
const ink=require('..');
const PNG=require('../cli/png.js');

function study(kit) {
  const {KIT:K,makeBuilder,makeSculpt}=kit, {V}=K;
  const palette=[
    0x141e2b,0x202c3b,0x2a3b48,0x364d54,0x486265,0x608081,0x8b9c88,
    0x382c36,0x503640,0x6d4745,0x885646,0xa66c4e,0xc58c60,0xe9b578,0xffdda0,
    0x254951,0x335d64,0x477982,0x629398,0x81b3b1,0xa0cebf,0xbce6d5,
    0xe2f0d7,0x3e3446,0x624d59,0x8a6b70,0xcaa499
  ];
  const B=makeBuilder(94,palette), S=K.sculpt(makeSculpt(B));
  Object.assign(S,{amb:.57,sky:.20,sun:V.norm([-.53,.66,.72]),sunK:.42,shLen:0,pixel:true});
  const mat=(r,materialId)=>({r,materialId});
  const stone=mat([1,2,3,4,5],'station-stone'), stoneTrim=mat([2,3,4,5,6],'station-trim');
  const iron=mat([0,1,2,3],'iron'), casing=mat([7,8,9,10,11],'casing'),
    brass=mat([8,9,11,12,13,14],'brass'), copper=mat([9,10,11,12,13],'copper-field'),
    lettering=mat([0,1,2,3],'lettering'), pin=mat([8,10,12,13,14],'bolt'),
    pinInset=mat([0,1,2],'bolt'), snow=mat([15,16,17,18,19,20],'rim-ice');
  const box=(at,half,finish,opts={})=>S.box(at,half,finish,{res:.080,rd:.035,...opts});

  // A layered dock wall and double iron frame behind the sign.
  box([0,-.42,-.22],[4.45,.32,1.22],iron,{res:.18});
  box([0,-.10,-.34],[4.35,.12,1.03],stoneTrim,{res:.14});
  box([0,1.42,-.65],[3.92,1.52,.24],stone,{res:.16,rd:.1});
  for(let i=0;i<5;i++){
    const y=.16+i*.64;
    for(let j=0;j<10;j++){
      const x=(j-4.5)*.79+(i%2?.18:-.08);
      if(Math.abs(x)>3.66) continue;
      const finish=(i*11+j*17)%5===0?stoneTrim:stone;
      box([x,y,-.38],[.378,.300,.088],finish,{res:.12,rd:.04});
    }
  }
  box([0,2.99,-.37],[4.15,.11,.42],stoneTrim,{res:.10});
  box([0,3.15,-.52],[4.07,.07,.26],iron,{res:.14});
  box([0,3.07,.04],[4.13,.029,.055],brass,{res:.10});
  for(const x of [-3.58,3.57]){
    box([x,1.45,-.16],[.15,1.38,.21],iron,{res:.105,rd:.05});
    box([x,2.66,.04],[.19,.09,.09],brass);
    box([x,.44,.07],[.17,.13,.13],brass);
  }
  S.tube([[-3.31,.54,.08],[-3.31,.37,.15],[-3.10,.25,.22],[2.90,.25,.22],[3.21,.40,.16],[3.21,1.18,.08]],
    .065,.065,iron,{res:.084});
  for(const x of [-2.8,-1.63,-.46,.7,1.87,2.84]) {
    box([x,.251,.22],[.09,.086,.075],brass,{res:.043,rd:.024});
    box([x,.26,.303],[.044,.015,.014],stoneTrim,{res:.034});
  }

  box([0,1.68,-.11],[2.96,1.09,.15],iron,{res:.11,rd:.19});
  box([0,1.68,.09],[2.78,.96,.128],casing,{rd:.17,res:.086});
  box([0,1.68,.21],[2.67,.87,.072],brass,{rd:.14,res:.068});
  box([0,1.68,.29],[2.56,.766,.052],copper,{rd:.109,res:.036,objectId:'sign'});
  for(const y of [1.03,2.33]){
    box([0,y,.345],[2.36,.018,.012],casing,{rd:.008,res:.026});
    for(const x of [-1.87,-1.77,1.77,1.87])box([x,y+.052,.348],[.030,.012,.012],brass,{rd:.005,res:.025});
  }
  const font=K.inspection.font({});
  function stamp(text,startX,top,step){
    for(const [n,char] of [...text].entries()){
      const glyph=font.get(char);
      for(let y=0;y<8;y++)for(let x=0;x<6;){
        if(!glyph[y*6+x]){x++;continue;}
        const left=x;
        while(x<6&&glyph[y*6+x])x++;
        const mid=(x+left-1)/2;
        box([startX+(n*6+mid)*step,top-y*step,.358],[(x-left)*step*.50,step*.50,.015],lettering,{res:step*.71,rd:.005});
      }
    }
  }
  stamp('RIME',-1.87,2.18,.108);
  stamp('LOCK  04',-.06,1.44,.049);
  for(const [x,y,r] of [[-2.31,1.91,.11],[-2.30,1.24,.11],[2.29,1.91,.092],[2.30,1.23,.092],[.68,1.85,.145]]){
    box([x,y,.365],[r,r,.043],pin,{res:.035,rd:r*.30});
    box([x,y,.413],[r*.57,r*.092,.012],pinInset,{res:.024,rd:.004});
    box([x-r*.35,y+r*.56,.416],[r*.30,r*.081,.014],pin,{res:.024,rd:.006});
  }
  for(const [x,y] of [[-3.45,.65],[-3.50,.51],[-2.95,.72],[-1.11,.30],[2.81,.15],[3.05,.15],[3.51,.18]]){
    box([x,y,.39],[.13,.021,.13],snow,{res:.055,rd:.014});
  }
  S.bake();
  const family=K.boundaryCels.preset('frost',{swatches:{shade:'#395f65',ice:'#64aebb',rim:'#a9e0db',core:'#f1f6dc'}});
  const definition={rules:[{id:'ice-crust',inside:{select:{material:'frost-field'}},
    outside:{select:{material:'copper-field'}},gaps:[{material:'bolt'},{material:'lettering'}],cornerRun:2,family}]};
  const world=B.finish({cam:{target:[0,1.51,0],dist:10.6,yaw:-.12,pitch:.13,sway:0},detail:28,radius:12,dither:.035,
    skyEnvironment:{defaults:{zenith:'#233348',horizon:'#657b73',ground:'#293748',sunStrength:0}},
    look:{pixel:true,boundaryCels:definition}});
  const {materialIds,materials}=world.renderMetadata, copperId=materials.indexOf('copper-field'), frostId=materials.length;
  const frostMaterials=[...materials,'frost-field'];
  const ice=[0x335d64,0x477982,0x629398,0x81b3b1,0xa0cebf].map(c=>((c&255)<<16)+(c&0x00ff00)+(c>>16));
  function sample(t){
    const head=-2.78+t*1.25, ids=materialIds.slice(), data=world.data.slice(), pix=world.pix?.slice();
    for(let i=0;i<world.count;i++){
      if(ids[i]!==copperId)continue;
      const q=i*16,x=data[q],y=data[q+1],z=data[q+2];
      const step=y>2.12?.50:y>1.96?-.025:y>1.78?.285:y>1.61?-.36:y>1.39?.23:y>1.15?-.195:.36;
      if(z<.29||x>head+step)continue;
      const index=Math.max(0,Math.min(ice.length-1,
        Math.floor((data[q+7]&255)/82+(head+step-x)*.62)+(K.hash(i,7,45)>.81?1:0)));
      ids[i]=frostId;
      data[q+7]=ice[index];
      if(pix)pix[i*8]=0;
    }
    return {...world,data,pix,renderMetadata:{...world.renderMetadata,materialIds:ids,materials:frostMaterials}};
  }
  return {sample,family,definition};
}

const options={w:324,h:168,px:1,ortho:true,zoom:1.27,captureBoundarySites:true};
if(require.main===module){
  const out=path.resolve(process.argv[2]??'studio/frost-boundaries');
  fs.mkdirSync(out,{recursive:true});
  const kit=ink.load(), K=kit.KIT, scene=study(kit), shots=[];
  function png(image,file){
    PNG.write(file,image.w,image.h,image.rgb);
    return 'data:image/png;base64,'+fs.readFileSync(file).toString('base64');
  }
  for(let i=0;i<45;i++){
    const t=i/12, world=scene.sample(t), frame={...options,t};
    const plain=ink.render(world,{...frame,boundaryCels:false,passes:['splatId']});
    const plan=K.boundaryCels.prepare(scene.definition,{scenePalette:world.pal,paletteRoles:world.paletteRoles});
    const {rgb,report}=K.boundaryCels.apply(plain,plain.passes,plan,world,{time:t,captureSites:true});
    shots.push({
      art:png({...plain,rgb},path.join(out,'rime-'+String(i).padStart(3,'0')+'.png')),
      plain:png(plain,path.join(out,'plain-'+String(i).padStart(3,'0')+'.png')),
      report
    });
  }
  const clips=scene.family.sizes.map(band=>({id:band.id,art:Object.entries(band.cels).map(([kind,clip])=>({
    kind, width:clip.width,height:clip.height,pixels:Array.from(K.pixelStamps.image(clip).rgba)
  }))}));
  const template=fs.readFileSync(path.join(__dirname,'frost-boundaries.html.template'),'utf8');
  fs.writeFileSync(path.join(out,'rime-lock.html'),template.replace('/* STUDY */',()=> 'const { shots, clips } = '+JSON.stringify({shots,clips})+';'));
  fs.writeFileSync(path.join(out,'inspection.json'),JSON.stringify(shots.map(shot=>shot.report),null,2)+'\n');
}
module.exports={study,options};
