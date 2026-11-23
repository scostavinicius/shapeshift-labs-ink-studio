/* Staggered compressible pressure and volume-flow update over piecewise uniform bores. */
(function(K){
  const W=K.world, {check}=W.data, finite=Number.isFinite;
  const lerp=(a,b,t)=>a+(b-a)*t;
  function layout(spec){
    const {segments,density,soundSpeed,cellLength,sampleRate,cfl}=spec;
    const bulk=density*soundSpeed**2;
    check(finite(bulk)&&bulk>0,'Distributed wave bulk modulus exceeds range');
    let cells=0, faces=0, maxSlope=0, limiting=null;
    const links=segments.map((link,section)=>{
      const count=Math.ceil(link.length/cellLength), dx=link.length/count;
      check(Number.isSafeInteger(count)&&count>0&&cells+count<=65536,'Distributed wave exceeds its cell budget');
      const compliance=link.area*dx/bulk, inertance=density*dx/link.area;
      const rate=2*(count===1?4:3)/(compliance*inertance);
      check(finite(rate)&&rate>0,'Distributed wave cell exceeds its numeric range');
      if(rate>maxSlope){
        maxSlope=rate;
        limiting={kind:'section',tube:link.name,section,fromMetres:link.at,toMetres:link.at+link.length};
      }
      const row={...link,dx,count,cell:cells,face:faces,compliance,inertance};
      cells+=count;faces+=count+1;
      return row;
    });
    const maxDt=2*cfl/Math.sqrt(maxSlope);
    const substeps=Math.max(1,Math.ceil(Math.sqrt(maxSlope)/(2*cfl*sampleRate)));
    return {links,cells,faces,substeps,maxDt,limiting};
  }

  function create(spec,review){
    const {nodes,probes,soundSpeed,sampleRate}=spec;
    const {links,cells,faces,substeps,maxDt,limiting}=layout(spec);
    review?.limit('wave-cfl-budget',1/(sampleRate*32),maxDt,limiting,undefined,
      {requiredSubsteps:Number.isSafeInteger(substeps)?substeps:null,maxSubsteps:32});
    if(substeps>32){
      const error=Error('Distributed wave needs more than 32 CFL substeps at '+limiting.tube+
        ' section '+limiting.section+'; enlarge cellLength or raise sampleRate');
      if(review)error.diagnostics=review.report({solver:'distributed-wave',domain:spec.identity,advanced:false});
      throw error;
    }
    const dt=1/(sampleRate*substeps), p=new Float64Array(cells), q=new Float64Array(faces);
    review?.limit('wave-substep',dt,maxDt,limiting,undefined,{sampleDt:1/sampleRate,substeps});
    const through=review&&new Float64Array(nodes.length);
    const pressure=new Float64Array(nodes.length), weight=new Float64Array(nodes.length),
      outward=new Float64Array(nodes.length), load=new Float64Array(nodes.length);
    for(const link of links){
      const sigma=soundSpeed*link.loss;
      link.decay=Math.exp(-sigma*dt);
      const time=sigma===0?dt:-Math.expm1(-sigma*dt)/sigma;
      link.pGain=time/link.compliance;
      link.qGain=time/link.inertance;
      const {from,to,qGain}=link;
      check(link.pGain>0&&finite(link.pGain)&&qGain>0&&finite(2*qGain)&&link.decay>0,'Distributed wave loss or step exceeds range');
      weight[from]+=2*qGain;
      weight[to]+=2*qGain;
    }
    for(const [i,node] of nodes.entries()){
      weight[i]+=node.outside;
      check(weight[i]>0&&finite(weight[i]),'Distributed wave termination exceeds numeric range');
    }
    const sites=probes.map(row=>{
      if(row.node!==undefined)return row;
      const link=links[row.section], at=row.ratio*link.count;
      return {...row,link,at};
    });

    function advance(sample,input,probePressure,probeFlow,observe){
      for(let k=0;k<substeps;k++){
        load.fill(0);
        outward.fill(0);
        if(observe)through.fill(0);
        for(const link of links){
          const {from,to,cell,face,count,qGain,decay}=link, end=face+count;
          // These are the oriented flow biases before the junction's pressure is added.
          q[face]=decay*q[face]-2*qGain*p[cell];
          q[end]=decay*q[end]+2*qGain*p[cell+count-1];
          load[from]-=q[face];
          load[to]+=q[end];
        }
        for(const [i,node] of nodes.entries()){
          const level=node.source<0?0:input[node.source];
          pressure[i]=node.pressureSource?level:node.released?0:(load[i]+level)/weight[i];
        }
        for(const link of links){
          const {from,to,cell,face,count,qGain,pGain,decay}=link, end=face+count;
          q[face]+=2*qGain*pressure[from];
          q[end]-=2*qGain*pressure[to];
          outward[from]+=q[face];
          outward[to]-=q[end];
          if(observe){
            through[from]=Math.max(through[from],Math.abs(q[face]));
            through[to]=Math.max(through[to],Math.abs(q[end]));
          }
          for(let j=1;j<count;j++){
            const a=cell+j-1,b=face+j;
            q[b]=decay*q[b]+qGain*(p[a]-p[a+1]);
          }
          for(let j=0;j<count;j++){
            const i=cell+j,b=face+j;
            p[i]=decay*p[i]+pGain*(q[b]-q[b+1]);
          }
        }
        if(observe)observe(pressure,outward,through,input,sample/sampleRate+(k+1)*dt);
      }
      for(const [i,site] of sites.entries()){
        if(site.node!==undefined){
          probePressure[i]=pressure[site.node];
          probeFlow[i]=outward[site.node];
          continue;
        }
        const {link,at}=site, {cell,face,count,from,to}=link;
        const faceIndex=Math.min(count-1,Math.floor(at));
        probeFlow[i]=lerp(q[face+faceIndex],q[face+faceIndex+1],at-faceIndex);
        if(at<=.5)probePressure[i]=lerp(pressure[from],p[cell],at*2);
        else if(at>=count-.5)probePressure[i]=lerp(p[cell+count-1],pressure[to],2*(at-count+.5));
        else{
          const j=Math.floor(at-.5);
          probePressure[i]=lerp(p[cell+j],p[cell+j+1],at-.5-j);
        }
      }
    }
    return {advance,buffers:{pressure:p,flow:q},workPerSample:substeps*(cells+faces+links.length+nodes.length)+sites.length,
      info:{cells,faces,substeps,dt},reviewWork:substeps*(links.length+nodes.length*2)};
  }
  W.waveDistributed=create;
})(KIT);
