import {createRenderer} from '../../src/webgl/renderer.mjs';
import {makeCamera} from '../../src/webgl/view.mjs';

const get=id=>document.getElementById(id);
const status=get('status'),play=get('pause'),scrub=get('scrub'),guideButton=get('guides');
const arrows={ArrowUp:[0,1],ArrowLeft:[-1,0],ArrowDown:[0,-1],ArrowRight:[1,0]};
const view={ortho:true,raw:true,damp:false};
try {
  const scene=switchbackCourier({KIT,makeBuilder,makeSculpt}), end=Math.round(scene.duration*60);
  const lanes=['baseline','matched'].map(id=>{
    const canvas=get(id), world=scene.build(scene.seed,{controls:{matched:id==='matched'}});
    const ctx=canvas.nextElementSibling.getContext('2d');
    return {id,canvas,world,ctx,actor:world.courier,readout:get(id+'-readout'),
      renderer:createRenderer(canvas,{toolkit:{KIT,PixelLook}})};
  });
  let mode='replay',frame=0,playing=false,show=true,pending,previous,balance=0;
  function drawLane({world,ctx,canvas,actor,renderer,readout,id}) {
    const {width,height}=canvas;
    renderer.render(world,{...view,t:actor.t});
    ctx.clearRect(0,0,width,height);
    const {view:matrix,projection}=makeCamera(world,view,width,height);
    const screen=([x,y,z])=>[
      Math.round((1+(matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12])*projection[0])*width/2),
      Math.round((1-(matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13])*projection[5])*height/2)];
    const feet=actor.gait.feet, turn=actor.transition;
    if(show) {
      for(const patch of actor.events.slice(-9)){
        const [x,y]=screen(patch.point);
        ctx.fillStyle='#94c1be55';
        ctx.fillRect(x-2,y-1,5,3);
      }
      for(const f of feet) {
        const [x,y]=screen(f.p);
        ctx.fillStyle=f.u===1?'#9cf3d6':'#ffc179';
        ctx.fillRect(x-2,y-2,5,5);
        if(f.u<1) {
          const [tx,ty]=screen(f.to);
          ctx.strokeStyle='#ffc179';
          ctx.setLineDash([3,2]);
          ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(tx,ty);ctx.stroke();
          ctx.setLineDash([]);
          ctx.strokeRect(tx-3.5,ty-3.5,7,7);
        }
      }
      if(turn?.firstPlant) {
        const {from,point}=turn.firstPlant, [x,y]=screen(point);
        ctx.strokeStyle=id==='matched'?'#8fe5d2':'#ffc179';
        ctx.beginPath();ctx.moveTo(...screen(from));ctx.lineTo(x,y);ctx.stroke();
        ctx.strokeRect(x-4.5,y-4.5,9,9);
      }
      const goal=actor.goal, n=Math.hypot(...goal);
      if(n>.01) {
        const [x,,z]=actor.root;
        const from=screen([x,0,z]),to=screen([x+goal[0]*.36,0,z+goal[1]*.36]);
        ctx.beginPath();ctx.moveTo(...from);ctx.lineTo(...to);
        ctx.strokeStyle='#7dd1ec';ctx.stroke();
        ctx.fillStyle='#7dd1ec';ctx.fillRect(to[0]-2,to[1]-2,5,5);
      }
    }
    const steps=feet.filter(foot=>foot.u===1).length;
    const first=turn?.firstPlant;
    const landing=first ? (first.forward>=.03 ? first.forward.toFixed(2)+' units forward' :
      first.forward<=-.03 ? (-first.forward).toFixed(2)+' units back' : 'across the new heading') : null;
    const row=turn?.match;
    const base=steps+' planted · '+(feet.length-steps)+' swinging';
    const details=turn ? [
      row ? 'Entry at '+Math.round(row.phase*100)+'% of swing' : id==='baseline' ? 'Kept the pre-turn landing' : 'Finishing the current step',
      landing ? 'First landing '+landing : 'Awaiting first landing'
    ] : [actor.gait.index ? actor.gait.index.size.toLocaleString()+' indexed entry poses' : 'Foot-home distance triggers each step'];
    readout.replaceChildren(document.createTextNode(base),document.createElement('br'),document.createTextNode(details.join(' · ')));
  }
  function draw() {
    lanes.forEach(drawLane);
    scrub.value=String(frame);
    scrub.disabled=mode==='steer';
    const actor=lanes[1].actor;
    get('time').value=(mode==='replay' ? actor.action+' · ' : 'Live steering · ')+actor.t.toFixed(2)+' s';
  }
  function queue(){pending??=requestAnimationFrame(tick);}
  function setPlaying(value) {
    playing=value;previous=undefined;balance=0;
    play.textContent=playing?'Pause':'Resume';
    if(playing) queue();
  }
  function tick(now) {
    pending=undefined;
    if(playing) {
      if(previous!==undefined) balance+=Math.min(.10,(now-previous)/1000);
      previous=now;
      while(balance>=1/60&&(mode==='steer'||frame<end)) {
        lanes.forEach(({actor})=>actor.advance(mode==='replay'));
        frame++;
        balance-=1/60;
      }
      if(mode==='replay'&&frame>=end) setPlaying(false);
      if(playing) queue();
    }
    draw();
  }
  function seek(to) {
    mode='replay';frame=0;
    lanes.forEach(({actor})=>actor.reset());
    while(frame<to) {
      lanes.forEach(({actor})=>actor.advance(true));
      frame++;
    }
    draw();
  }
  function steer(x,z) {
    mode='steer';
    lanes.forEach(({actor})=>actor.aim(scene.command(x,z)));
    setPlaying(true);
  }
  get('replay').addEventListener('click',()=>{seek(0);setPlaying(true);});
  play.addEventListener('click',()=>{
    if(mode==='replay'&&frame===end) seek(0);
    setPlaying(!playing);
  });
  guideButton.addEventListener('click',()=>{
    show=!show;guideButton.setAttribute('aria-pressed',String(show));draw();
  });
  scrub.addEventListener('input',()=>{const next=Number(scrub.value);setPlaying(false);seek(next);});
  document.querySelectorAll('[data-vector]').forEach(button=>button.addEventListener('click',()=>{
    steer(...button.dataset.vector.split(',').map(Number));
  }));
  window.addEventListener('keydown',event=>{
    const input=arrows[event.key];
    if(!input||event.target===scrub||event.repeat||event.metaKey||event.ctrlKey||event.altKey) return;
    event.preventDefault();
    steer(...input);
  });
  scrub.max=String(end);
  document.querySelectorAll('button').forEach(button=>{button.disabled=false;});
  status.hidden=true;
  seek(156);
} catch (error) {
  status.textContent=error.message;
  throw error;
}
