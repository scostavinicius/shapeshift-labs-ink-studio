/* Compare isolated runs from one committed boundary and draw their watched future. */
(function (K) {
  const W=K.world, R=W.runtime, {check,copy,id,record,selector,read}=W.data;
  const {freeze}=K.procedural.data;
  const names=['baseline','proposal'];
  const finite=Number.isFinite;
  const tuple=(value,n)=>Array.isArray(value)&&value.length===n&&Array.from(value).every(finite);
  const point=value=>tuple(value,3)&&value.every(n=>Math.abs(n)<=1e9);
  const count=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const nonnegative=n=>finite(n)&&n>=0;

  function list(rows,kind,prepare) {
    check(Array.isArray(rows)&&rows.length<=128,'Forecast needs up to 128 '+kind+' entries');
    const used=new Set();
    return Array.from(rows,row=>{
      check(record(row)&&id(row.id)&&!used.has(row.id),'Forecast '+kind+' IDs must be distinct');
      used.add(row.id);
      return {id:row.id,...prepare(row)};
    });
  }

  function site(value,required=false) {
    if (value===undefined&&!required) return undefined;
    check(point(value)||(record(value)&&(point(value.point)||id(value.entity)&&
      (value.socket===undefined||id(value.socket)))),'Forecast site needs an XYZ point or entity/socket');
    return copy(value);
  }

  function probe({field,at,args,path},required=false) {
    check(typeof field==='string'&&field.trim()&&(args===undefined||record(args)),'Forecast needs a named query field');
    return {field,at:site(at,required),args:copy(args??{}),path:path===undefined?undefined:selector(path)};
  }

  function readings(options) {
    const tracks=list(options.tracks??[],'track',row=>{
      const {tolerance=.02,offset=[0,0,0]}=row;
      check(nonnegative(tolerance)&&point(offset),'Invalid forecast track tolerance or offset');
      return {...(row.field===undefined?{at:site(row.at,true)}:probe(row)),tolerance,offset:offset.slice()};
    });
    const flows=list(options.flows??[],'flow',row=>{
      const {seconds=.35,maxLength=1.5,minSpeed=.02,tolerance=.02,lift=0,heightField}=row;
      check([seconds,maxLength,minSpeed,tolerance].every(nonnegative)&&finite(lift)&&Math.abs(lift)<=1e9&&
        (heightField===undefined||typeof heightField==='string'&&heightField.trim()),'Invalid forecast flow display settings');
      return {...probe(row,true),seconds,maxLength,minSpeed,tolerance,lift,heightField};
    });
    const watch=list(options.watch??[],'watch',row=>{
      const {tolerance=.02}=row;
      check(nonnegative(tolerance),'Invalid forecast watch tolerance');
      return {...probe(row),tolerance};
    });
    return {tracks,flows,watch};
  }

  function location(query,at) {
    const value=at===undefined?null:query.target(at)?.point;
    return point(value)?value.slice():null;
  }

  function field(query,{field,at,args,path}) {
    const sample=query.probe(field,at,args);
    if (sample.status!=='ok') return null;
    return path===undefined?sample.value:read(sample.value,path);
  }

  function track(query,row) {
    const p=row.field===undefined?location(query,row.at):field(query,row);
    const at=point(p)?p.map((value,i)=>value+row.offset[i]):null;
    return {id:row.id,at:point(at)?at:null};
  }

  function flow(query,row) {
    const at=location(query,row.at), value=field(query,row);
    if (!at||!(tuple(value,2)||tuple(value,3))) return null;
    if (row.heightField!==undefined) {
      const height=field(query,{field:row.heightField,at:row.at,args:row.args});
      if (!finite(height)) return null;
      at[1]=height;
    }
    at[1]+=row.lift;
    const vector=value.length===2?[value[0],0,value[1]]:value.slice(), speed=Math.hypot(...vector);
    if (!finite(speed)||speed<=row.minSpeed||row.seconds===0||row.maxLength===0||!point(at)) return null;
    const distance=Math.min(speed*row.seconds,row.maxLength);
    const to=at.map((p,i)=>p+vector[i]/speed*distance);
    return point(to)?{id:row.id,at,to,speed,vector}:null;
  }

  function numeric(value) {
    if (finite(value)) return value;
    if (tuple(value,2)||tuple(value,3)) return value.slice();
    return null;
  }

  function difference(a,b) {
    if (finite(a)&&finite(b)) return Math.abs(a-b);
    if (Array.isArray(a)&&Array.isArray(b)&&a.length===b.length) return Math.hypot(...a.map((p,i)=>p-b[i]));
    return null;
  }

  function firstObserved(tick,time,plan,a,b,left,right) {
    for (const [kind,rows] of [['track',plan.tracks],['field',plan.watch],['flow',plan.flows]]) for (const [i,row] of rows.entries()) {
      const before=kind==='track'?left[i].at:numeric(field(a,row));
      const after=kind==='track'?right[i].at:numeric(field(b,row));
      const delta=difference(before,after);
      if (delta>row.tolerance||(before===null)!==(after===null)) {
        const at=kind==='track'?after??before:location(b,row.at)??location(a,row.at);
        return {tick,time,kind,id:row.id,before,after,delta:finite(delta)?delta:null,at};
      }
    }
  }

  function visualSettings(value) {
    if (value===undefined) return null;
    const {render,anchor,threshold=0,minPixels=1}=value??{};
    check(record(value)&&typeof render==='function'&&(anchor===undefined||typeof anchor==='function')&&
      count(threshold,0,255)&&count(minPixels,1,1048576),'Invalid forecast comparison capture or pixel thresholds');
    return {render,anchor,threshold,minPixels};
  }

  function captureImage(image) {
    const w=image?.w??image?.width,h=image?.h??image?.height;
    check(count(w,1,8192)&&count(h,1,8192)&&w*h<=1048576,'Forecast comparison needs a bounded RGB or RGBA frame');
    const data=image.data, channels=image.channels??data?.length/(w*h);
    return FrameComposite.pixels({w,h,rgba:image.rgba??(channels===4?data:undefined),
      rgb:image.rgb??(channels===3?data:undefined),alpha:image.alpha});
  }

  function imageDifference(a,b,{threshold,minPixels}) {
    check(a.w===b.w&&a.h===b.h,'Forecast comparison frames must share one art grid');
    let minX=a.w,minY=a.h,maxX=-1,maxY=-1,pixel,peak=threshold,changed=0;
    for (let y=0,p=0;y<a.h;y++) for (let x=0;x<a.w;x++,p+=4) {
      const delta=Math.max(Math.abs(a.data[p]-b.data[p]),Math.abs(a.data[p+1]-b.data[p+1]),
        Math.abs(a.data[p+2]-b.data[p+2]),Math.abs(a.data[p+3]-b.data[p+3]));
      if (delta<=threshold) continue;
      changed++;
      minX=Math.min(x,minX); minY=Math.min(y,minY); maxX=Math.max(x,maxX); maxY=Math.max(y,maxY);
      if (delta>peak) {peak=delta;pixel=[x,y];}
    }
    if (changed<minPixels) return undefined;
    return {pixel,changed,peak,bounds:[minX,minY,maxX-minX+1,maxY-minY+1],viewport:[a.w,a.h]};
  }

  function origin(source,runtime) {
    if (typeof source?.fork==='function'&&typeof source?.schedule==='function'&&typeof source?.checkpoint==='function') return source;
    if (source?.format===R.checkpointFormat) return R.create(source.world,{...runtime,checkpoint:source});
    return R.create(source,runtime);
  }

  function program(source,options) {
    const {steps=48,every=4,baseline=[],actions=[],compareView,runtime={}}=options;
    check(count(steps,1,600)&&count(every,1,600)&&record(runtime)&&Array.isArray(baseline)&&Array.isArray(actions),
      'Forecast needs a valid step horizon, sample interval and command lists');
    const plan=readings(options), visual=visualSettings(compareView);
    check(plan.tracks.length||plan.flows.length||plan.watch.length||visual,'Forecast needs something to observe');
    const first=origin(source,runtime), startTick=first.view().tick,endTick=startTick+steps;
    check(endTick<=R.maxTick,'Forecast horizon exceeds the simulation tick range');
    const runs=[first.fork(),first.fork()];
    for (const [i,entries] of [baseline,actions].entries()) {
      check(entries.length<=1024&&Array.from(entries).every(record),'Forecast needs up to 1024 scheduled commands per branch');
      if (entries.length) runs[i].schedule(Array.from(entries,entry=>({tick:startTick+1,...entry})));
    }

    const samples=[];
    let observed,visible,pixels=0;
    function collect(tick) {
      const retain=tick===endTick||(tick-startTick)%every===0;
      const queries=runs.map(run=>run.query()),time=runs[0].view().time;
      const positions=(retain||!observed)&&queries.map(query=>plan.tracks.map(row=>track(query,row)));
      if (retain) {
        const paths=queries.map((query,i)=>({tracks:positions[i],flows:plan.flows.flatMap(row=>flow(query,row)??[])}));
        samples.push({tick,time,baseline:paths[0],proposal:paths[1]});
      }
      if (tick===startTick) return;
      if (!observed) observed=firstObserved(tick,time,plan,...queries,...positions);
      if (!visual||visible) return;
      const sources=[], images=[];
      for (const [i,run] of runs.entries()) {
        const source=visual.render({branch:names[i],tick,time,view:run.view(),query:queries[i]});
        const image=captureImage(source);
        pixels+=image.w*image.h;
        check(pixels<=64*1024*1024,'Forecast comparison exceeds its total art-pixel budget');
        sources.push(source); images.push(image);
      }
      const change=imageDifference(...images,visual);
      if (!change) return;
      const [x,y]=change.pixel;
      const at=visual.anchor ? visual.anchor({x,y,tick,time,baseline:sources[0],proposal:sources[1]}) :
        [...sources].reverse().filter(K.renderOutputs.is).map(frame=>K.renderOutputs.pick(frame,x,y)?.position).find(Boolean);
      check(at==null||point(at),'Forecast pixel anchor must return an XYZ point or null');
      visible={...change,tick,time,at:at?.slice()??null};
    }
    const finish=()=>freeze({startTick,endTick,samples,viewCompared:Boolean(visual),firstObserved:observed??null,firstVisible:visible??null});
    return {runs,startTick,endTick,collect,finish};
  }

  function run(source,options={}) {
    const forecast=program(source,options);
    for (let tick=forecast.startTick;tick<=forecast.endTick;tick++) {
      if (tick>forecast.startTick) for (const run of forecast.runs) run.advance(tick);
      forecast.collect(tick);
    }
    return forecast.finish();
  }

  async function runAsync(source,options={}) {
    const forecast=program(source,options);
    for (let tick=forecast.startTick;tick<=forecast.endTick;tick++) {
      if (tick>forecast.startTick) for (const run of forecast.runs) await run.advanceAsync(tick);
      forecast.collect(tick);
    }
    return forecast.finish();
  }

  const style={baseline:'#f3be7f',proposal:'#a8f2d2',first:'#ffce85'};
  const distance=(a,b)=>Math.hypot(...a.map((p,i)=>p-b[i]));
  const rgba=(hex,alpha)=>hex+Math.round(alpha*255).toString(16).padStart(2,'0');
  function diamond(at,r,color,width=1) {
    const [x,y,z]=at;
    return {type:'path',space:'world',closed:true,width,color,
      points:[[x-r,y,z],[x,y,z+r],[x+r,y,z],[x,y,z-r]]};
  }

  function commands(forecast,{tick=forecast.endTick,branches=names,ghosts=7,radius=.14,markers=true,screenMarker,colors={}}={}) {
    check(count(tick,forecast.startTick,forecast.endTick)&&Array.isArray(branches)&&
      Array.from(branches).every(name=>names.includes(name))&&new Set(branches).size===branches.length&&
      count(ghosts,0,24)&&finite(radius)&&radius>0&&radius<=1000&&typeof markers==='boolean'&&record(colors)&&
      (screenMarker===undefined||tuple(screenMarker,2)&&screenMarker.every(n=>count(n,1,8192))),
    'Invalid forecast drawing settings');
    const inks={...style,...colors};
    check(Object.keys(inks).every(key=>Object.hasOwn(style,key)&&/^#[0-9a-f]{6}$/i.test(inks[key])),
      'Forecast drawing colors need RGB hex swatches');
    const last=forecast.samples.findLastIndex(row=>row.tick<=tick), sample=forecast.samples[last], out=[];
    for (const branch of branches) {
      for (const row of sample[branch].flows) out.push({
        type:'arrow',space:'world',from:row.at,to:row.to,width:1,headLength:4,headWidth:4,color:rgba(inks[branch],.84)
      });
      if (!ghosts||last===0) continue;
      const start=Math.max(0,last-ghosts);
      for (const [i] of sample[branch].tracks.entries()) {
        let prior=forecast.samples[start][branch].tracks[i].at;
        for (let j=start+1;j<=last;j++) {
          const {at}=forecast.samples[j][branch].tracks[i];
          if (at&&prior&&distance(prior,at)>.001) out.push({
            type:'path',space:'world',points:[prior,at],width:1,color:rgba(inks[branch],.5)
          });
          if (at&&(!prior||distance(prior,at)>.001||j===last))
            out.push(diamond(at,radius*(j===last?1.18:1),rgba(inks[branch],j===last?1:.65)));
          prior=at;
        }
      }
    }
    const first=forecast.viewCompared?forecast.firstVisible:forecast.firstObserved;
    if (markers&&first?.at&&first.tick<=tick) {
      const [x,y,z]=first.at,r=radius*1.55;
      out.push(diamond(first.at,r,inks.first,1.35),
        {type:'path',space:'world',points:[[x-r*.38,y,z],[x+r*.38,y,z]],color:inks.first,width:1},
        {type:'path',space:'world',points:[[x,y,z-r*.38],[x,y,z+r*.38]],color:inks.first,width:1});
    } else if (markers&&first?.pixel&&first.tick<=tick&&screenMarker?.every((n,i)=>n===first.viewport[i])) {
      const [x,y]=first.pixel;
      for (const dx of [-1,1]) for (const dy of [-1,1]) {
        const X=x+(dx<0?-4:2),Y=y+(dy<0?-4:2);
        out.push({type:'rect',rect:[X,Y,3,1],color:inks.first},
          {type:'rect',rect:[X+(dx>0?2:0),y+(dy<0?-4:0),1,3],color:inks.first});
      }
    }
    return out;
  }

  function layer(forecast,options) {
    return {draw:commands(forecast,options)};
  }

  W.forecast=Object.freeze({run,runAsync,commands,layer});
})(KIT);
