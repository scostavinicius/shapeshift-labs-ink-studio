import {createRenderer} from '../../src/webgl/renderer.mjs';
import {makeCamera,cameraPose} from '../../src/webgl/view.mjs';

const get=id=>document.getElementById(id);
const status=get('status'),yawControl=get('yaw'),orbit=get('orbit'),guides=get('guides'),select=get('sector');
const elbow=get('elbow'),staff=get('staff'),download=get('export');
const canvas=get('corrected'),ctx=get('markers').getContext('2d'),{width,height}=canvas;
const rad=Math.PI/180;
try {
  const scene=breakwaterWarden({KIT,makeBuilder,makeSculpt}),world=scene.build(scene.seed);
  const editor=world.warden.puppet.viewPoses,asset=editor.asset();
  const renderer=createRenderer(canvas,{toolkit:{KIT,PixelLook}});
  const base=createRenderer(get('source'),{toolkit:{KIT,PixelLook}});
  let yaw=Number(yawControl.value),show=true,playing=false,previous,queued,uri;
  function updateDownload() {
    if(uri) URL.revokeObjectURL(uri);
    uri=URL.createObjectURL(new Blob([JSON.stringify(asset,null,2)+'\n'],{type:'application/json'}));
    download.href=uri;
  }
  function drawGuides(camera,result) {
    ctx.clearRect(0,0,width,height);
    if(!show) return;
    const {view:matrix,projection}=camera;
    const screen=([x,y,z])=>[
      Math.round((1+(matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12])*projection[0])*width/2),
      Math.round((1-(matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13])*projection[5])*height/2)];
    for(const {from,to} of Object.values(result.elbows)){
      const [x,y]=screen(result.applied?to:from),a=screen(from);
      ctx.strokeStyle='#ffc580';
      ctx.setLineDash([2,2]);
      ctx.beginPath();
      ctx.moveTo(...a);
      ctx.lineTo(x,y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeRect(x-2.5,y-2.5,5,5);
    }
    for(const contact of Object.values(result.contacts)){
      const [x,y]=screen(result.applied?contact.actual:contact.from);
      ctx.fillStyle=contact.kind==='grip'?'#a4eeef':'#99dfbf';
      ctx.fillRect(x-2,y,5,1);
      ctx.fillRect(x,y-2,1,5);
    }
  }
  function draw() {
    const options={yaw:yaw*rad,pitch:.16,ortho:true,raw:true,damp:false,changedRows:[]};
    base.render(world,{...options,viewPoses:false});
    renderer.render(world,options);
    const camera=makeCamera(world,options,width,height);
    const {report}=editor.sample({...cameraPose(camera),ortho:true});
    drawGuides(camera,report);
    yawControl.value=String(yaw);
    get('angle').value=Math.round(yaw)+'°';
    const grips=Object.values(report.contacts).filter(contact=>contact.kind==='grip');
    const locks=Object.values(report.contacts).filter(contact=>contact.kind==='lock');
    const weight=report.weights.map(row=>row.id+' '+Math.round(row.weight*100)+'%').join(' · ');
    const movement=Object.values(report.elbows).reduce((max,row)=>Math.max(max,KIT.V.dist(row.from,row.to)),0);
    const retained=contacts=>contacts.every(contact=>contact.error<=2e-5)||!report.applied;
    const pose=report.applied?'Elbow shift '+movement.toFixed(2)+' units':'Source pose at this angle';
    const reach=report.limited==='prop reach'?' · Staff '+Math.round(report.gain*100)+'% of edit':'';
    const contact=retained(locks)&&retained(grips) ? '2 feet planted · Both grips retained' : 'Contact outside tolerance';
    get('base').textContent='Shared camera and animation pose';
    get('report').replaceChildren(document.createTextNode(weight+' · '+pose+reach),document.createElement('br'),document.createTextNode(contact));
  }
  function refreshFields() {
    const sector=asset.sectors[Number(select.value)];
    elbow.value=String(sector.elbows['left grip']);
    staff.value=String(sector.props.staff.move[1]);
    get('bend').value=elbow.value+'°';
    get('lift').value=Number(staff.value).toFixed(2);
  }
  function author() {
    const sector=asset.sectors[Number(select.value)];
    sector.elbows['left grip']=Number(elbow.value);
    sector.props.staff.move[1]=Number(staff.value);
    editor.set(asset);
    refreshFields();
    updateDownload();
    draw();
  }
  function queue(){queued??=requestAnimationFrame(tick);}
  function tick(now) {
    queued=undefined;
    if(!playing) return;
    if(previous!==undefined) yaw=((yaw+(now-previous)*.032+180)%360+360)%360-180;
    previous=now;
    draw();
    queue();
  }
  function play(on) {
    playing=on;
    previous=undefined;
    orbit.textContent=on?'Pause orbit':'Orbit';
    if(on) queue();
  }
  for(const [i,layer] of asset.sectors.entries()) select.append(new Option(layer.id,i));
  select.addEventListener('change',()=>{
    play(false);
    yaw=asset.sectors[Number(select.value)].yaw;
    refreshFields();
    draw();
  });
  yawControl.addEventListener('input',()=>{play(false);yaw=Number(yawControl.value);draw();});
  elbow.addEventListener('input',author);
  staff.addEventListener('input',author);
  guides.addEventListener('click',()=>{show=!show;guides.setAttribute('aria-pressed',String(show));draw();});
  orbit.addEventListener('click',()=>play(!playing));
  refreshFields();
  updateDownload();
  draw();
  [yawControl,orbit,guides,select,elbow,staff].forEach(control=>control.disabled=false);
  download.hidden=false;
  status.hidden=true;
} catch (error) {
  status.textContent=error.message;
  throw error;
}
