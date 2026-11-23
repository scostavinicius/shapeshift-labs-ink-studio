/* Reduce native art-pixel passes to scoped, inspectable sound measurements. */
(function (K) {
  const W=K.world,P=K.procedural,S=W.soundMeasurements,{check,own}=W.data,{fields}=W.boundarySignals;
  const channels=Object.freeze({
    depth:[1,'scene-unit'],previousDepth:[1,'scene-unit'],emissionDepth:[1,'scene-unit'],
    coverage:[1,'1'],mask:[1,'1'],protected:[1,'1'],
    motion:[2,'art-px/frame'],partMotion:[2,'art-px/frame'],emissionMotion:[2,'art-px/frame'],
    normal:[3,'1'],position:[3,'scene-unit'],objectPosition:[3,'scene-unit'],emission:[3,'linear-rgb']
  });
  const selectors=[['object','objectId','objects'],['material','materialId','materials'],['part','partId','parts']];
  const integer=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
  const reductions=['mean','rms','peak','min','max','fraction'];

  function prepare(options){
    check(fields(options,['channel','object','material','part','region','reduce','project','weight','above','perSecond'])&&
      own(channels,options.channel),'Choose a native art pass for sound measurement');
    const {channel,region,reduce='mean',weight,above=.5,perSecond=false}=options;
    const [components,baseUnit]=channels[channel];
    check(reductions.includes(reduce)&&(weight===undefined||['coverage','mask'].includes(weight))&&
      Number.isFinite(above)&&(options.above===undefined||reduce==='fraction')&&
      typeof perSecond==='boolean'&&(!perSecond||components===2),
    'Invalid art-pass sound reduction, weight or time unit');
    const selected=selectors.filter(([key])=>options[key]!==undefined).map(([key,pass,legend])=>{
      const target=options[key];
      check(typeof target==='string'&&target.length>0&&target.length<=160||integer(target,1,0xffffffff),
        'Use an art-pass label or positive ID for '+key);
      return {key,pass,legend,target};
    });
    check(region===undefined||Array.isArray(region)&&region.length===4&&
      Array.from(region).every((value,i)=>integer(value,i<2?0:1,2048)), 'Use an art-pixel rectangle [x, y, width, height]');
    const project=options.project??(components===1?'scalar':'magnitude'), pick=S.projection(project);
    const scope=Object.fromEntries(selected.map(({key,target})=>[key,target]));
    const unit=reduce==='fraction'?'1':perSecond?'art-px/s':baseUnit;
    const required=[...new Set([channel,...selected.map(row=>row.pass),...(weight?[weight]:[]),
      ...(['normal','position','objectPosition'].includes(channel)?['depth']:[])])];

    function measure(frame,{at,cut=false,interval}={}){
      P.takeTime.read(at);
      check(typeof cut==='boolean'&&(interval===undefined||Number.isFinite(interval)&&interval>0),
        'Render sound measurements need a time and positive previous-frame interval');
      const passes=frame?.passes, {w,h}=passes??{}, count=w*h;
      check(integer(w,1,2048)&&integer(h,1,2048)&&count<=1048576&&passes[channel]?.length===count*components,
        'Render did not capture native pass '+channel);
      const [x,y,width,height]=region??[0,0,w,h];
      check(x+width<=w&&y+height<=h,'Sound measurement region exceeds the native art grid');
      const tests=selected.map(({key,pass,legend,target})=>{
        const ids=passes[pass], labels=passes[legend];
        check(ids?.length===count,'Render did not capture selector pass '+pass);
        if(typeof target==='number')return p=>ids[p]===target;
        check(Array.isArray(labels),'Render did not include labels for '+pass);
        const matches=new Set();
        for(let i=1;i<labels.length;i++)if((key==='part'?labels[i]?.part:labels[i])===target)matches.add(i);
        return p=>matches.has(ids[p]);
      });
      const motion=components===2, correspondence=motion||channel==='previousDepth';
      const valid=passes[channel+'Valid'], values=passes[channel], weights=weight&&passes[weight];
      check(!correspondence||valid?.length===count,'Render did not capture validity for '+channel);
      check(!weight||weights?.length===count,'Render did not capture weight pass '+weight);
      const depth=required.includes('depth')&&channel!=='depth'?passes.depth:null;
      if(required.includes('depth')&&channel!=='depth')check(depth?.length===count,'Render did not capture ownership depth');
      const canMeasure=(!correspondence||!cut)&&(!perSecond||interval!==undefined);
      const tuple=new Float64Array(components);
      let eligible=0,used=0,mass=0,sum=0,max=-Infinity,min=Infinity,peak=0;
      for(let j=y;j<y+height;j++)for(let i=x;i<x+width;i++){
        const p=j*w+i;
        if(tests.some(test=>!test(p)))continue;
        eligible++;
        if(!canMeasure||valid&&!valid[p]||depth&&!Number.isFinite(depth[p]))continue;
        const amount=weights?weights[p]:1;
        if(!Number.isFinite(amount)||amount<=0)continue;
        let raw=values[p*components];
        if(components!==1){
          for(let k=0;k<components;k++)tuple[k]=values[p*components+k];
          raw=tuple;
        }
        const projected=pick(raw);
        if(!Number.isFinite(projected))continue;
        const value=perSecond?projected/interval:projected;
        mass+=amount;
        used++;
        min=Math.min(min,value);
        max=Math.max(max,value);
        peak=Math.max(peak,Math.abs(value));
        const contribution=reduce==='fraction'?Number(value>=above):reduce==='rms'?value*value:value;
        sum+=contribution*amount;
      }
      const available=canMeasure&&(used>0||reduce==='fraction'&&!correspondence);
      const value=!available?null:reduce==='fraction'?sum/(width*height):
        reduce==='min'?min:reduce==='max'?max:reduce==='peak'?peak:reduce==='rms'?Math.sqrt(sum/mass):sum/mass;
      check(value===null||Number.isFinite(value),'Art-pass sound measurement exceeds the numeric range');
      return {at,value,...(cut&&{cut:true}),detail:{channel,reduce,project,region:[x,y,width,height],...scope,eligible,used,...(weight&&{weight}),
        ...(reduce==='fraction'&&{above}),...(perSecond&&interval!==undefined&&{interval})}};
    }
    return {unit,channels:required,measure};
  }
  W.renderSoundMeasurements=Object.freeze({prepare});
})(KIT);
