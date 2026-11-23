/* Cell-centred finite-volume operators over Ink's compiled discretizations. */
(function(K){
  const W=K.world, {V}=K, {check,record,vector,id,own}=W.data;
  const finite=Number.isFinite, positive=n=>finite(n)&&n>0;
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const array=v=>Array.isArray(v)||ArrayBuffer.isView(v)&&typeof v.length==='number';
  const planFormat='ink-studio/grid-operators-plan', reportFormat='ink-studio/grid-operators-report';
  const kinds=['closed','open','value','gradient','flux'];
  const closed=Object.freeze({kind:'closed'});

  function field(values,count,label,test=finite){
    check(array(values)&&values.length===count,label+' needs '+count+' components');
    for(let i=0;i<count;i++)if(!test(values[i]))throw Error('Invalid '+label+' component '+i);
    return values;
  }

  function prepare(domain,{conditions}={}){
    check(domain?.format===W.discretization.compiledFormat&&domain.version===1&&
      ['grid','charts','mesh'].includes(domain.kind)&&[2,3].includes(domain.dimension)&&
      id(domain.id)&&integer(domain.revision,1,Number.MAX_SAFE_INTEGER)&&typeof domain.units==='string'&&domain.units.length>0&&
      Array.isArray(domain.cells)&&integer(domain.cells.length,1,65536)&&
      Array.isArray(domain.faces)&&integer(domain.faces.length,1,430000)&&record(domain.boundaries),
    'Grid operators need a compiled discretization');
    const identity=Object.freeze({id:domain.id,revision:domain.revision,dimension:domain.dimension,
      kind:domain.kind,units:domain.units,cells:domain.cells.length,faces:domain.faces.length});
    const cells=Array.from(domain.cells,(row,i)=>{
      check(vector(row?.center)&&positive(row.measure),'Invalid operator cell '+i);
      return {center:row.center.slice(),measure:row.measure,faces:[],
        ...(Array.isArray(row.address)&&{address:row.address.slice()})};
    });
    const regions=Object.keys(domain.boundaries);
    check(regions.every(id),'Invalid compiled boundary tag');
    const surface=domain.dimension===2, count=cells.length;
    const last=count-1, faces=Array.from(domain.faces,(row,i)=>{
      const {owner,neighbor,normal,neighborNormal,ownerDistance,neighborDistance,area,center,region}=row??{};
      const interior=neighbor!==null;
      check(integer(owner,0,last)&&vector(center)&&vector(normal)&&Math.abs(V.len(normal)-1)<1e-6&&
        positive(area)&&positive(ownerDistance)&&(interior?
          integer(neighbor,0,last)&&neighbor!==owner&&vector(neighborNormal)&&Math.abs(V.len(neighborNormal)-1)<1e-6&&positive(neighborDistance):
          own(domain.boundaries,region)),'Invalid operator face '+i);
      cells[owner].faces.push(i);
      if(interior)cells[neighbor].faces.push(i);
      return {owner,neighbor,interior,normal:normal.slice(),neighborNormal:interior?neighborNormal.slice():null,
        ownerDistance,neighborDistance,area,center:center.slice(),region,span:ownerDistance+(neighborDistance??0)};
    });
    check(cells.every(row=>row.faces.length>=domain.dimension+1),'Operator topology contains incomplete cells');
    const faceCount=faces.length, zeros=()=>new Float64Array(faceCount), cellValues=values=>field(values,count,'cell field');

    const applied=conditions===undefined?null:
      W.boundaryConditions.bound(conditions,['boundaries','disturbances']).grid(conditions,{cells,faces,regions});

    function policies(table={},time=0,dt=0){
      check(record(table),'Invalid grid boundary table');
      if(applied)table={...applied.boundary(time,dt),...table};
      check(record(table)&&Object.keys(table).every(tag=>regions.includes(tag)),'Unknown or invalid boundary region');
      const normalized=Object.create(null);
      for(const [tag,row] of Object.entries(table)){
        check(record(row)&&kinds.includes(row.kind)&&Object.keys(row).every(key=>['kind','value','inflow'].includes(key))&&
          (['value','gradient','flux'].includes(row.kind)?finite(row.value):row.value===undefined)&&
          (row.inflow===undefined||row.kind!=='closed'&&finite(row.inflow)),'Invalid operator boundary on '+tag);
        normalized[tag]=row;
      }
      return normalized;
    }

    function coefficient(diffusivity){
      if(typeof diffusivity==='number'){
        check(finite(diffusivity)&&diffusivity>=0,'Diffusivity must be finite and nonnegative');
        return ()=>diffusivity;
      }
      field(diffusivity,count,'diffusivity',n=>finite(n)&&n>=0);
      return i=>diffusivity[i];
    }

    function outward(face,bc,owner,k){
      if(bc.kind==='value')return (bc.value-owner)/face.ownerDistance;
      if(bc.kind==='gradient')return bc.value;
      if(bc.kind==='flux')return k>0?-bc.value/k:bc.value===0?0:null;
      return 0;
    }

    function applyBoundaries(values,{boundary,time=0,diffusivity=1}={}){
      cellValues(values);
      const table=policies(boundary,time), at=coefficient(diffusivity), rows=[];
      for(const [face,f] of faces.entries())if(!f.interior){
        const bc=table[f.region]??closed, owner=values[f.owner], k=at(f.owner);
        const g=outward(f,bc,owner,k), v=bc.kind==='value'?bc.value:g===null?null:owner+g*f.ownerDistance;
        const fluxDensity=bc.kind==='flux'?bc.value:-k*g;
        check((v===null||finite(v))&&(g===null||finite(g))&&finite(fluxDensity),'Boundary application exceeded numeric range');
        rows.push({face,region:f.region,kind:bc.kind,value:v,normalGradient:g,diffusiveFluxDensity:fluxDensity,
          advectiveInflow:bc.inflow??(bc.kind==='value'?bc.value:null)});
      }
      return rows;
    }

    function faceGradient(values,{boundary,time=0,diffusivity=1}={}){
      cellValues(values);
      const table=policies(boundary,time), at=coefficient(diffusivity);
      return Float64Array.from(faces,f=>{
        const g=f.interior?(values[f.neighbor]-values[f.owner])/f.span:
          outward(f,table[f.region]??closed,values[f.owner],at(f.owner));
        check(finite(g),'Face gradient is undefined or exceeded numeric range');
        return g;
      });
    }

    // Weighted least squares in XYZ. A small diagonal term handles unobserved axes on surfaces.
    function reconstruct(values,table,at){
      const out=new Float64Array(count*3);
      for(const [i,cell] of cells.entries()){
        let xx=0,xy=0,xz=0,yy=0,yz=0,zz=0,bx=0,by=0,bz=0;
        for(const index of cell.faces){
          const f=faces[index], front=f.owner===i, n=front?f.normal:f.neighborNormal;
          let along, slope;
          if(f.interior){
            const other=front?f.neighbor:f.owner, delta=V.sub(cells[other].center,cell.center);
            if(surface){
              const back=front?f.neighborNormal:f.normal;
              const anchor=V.sub(f.center,cell.center), beyond=V.sub(cells[other].center,f.center);
              const d=front?f.neighborDistance:f.ownerDistance;
              // Unfold the neighbouring half across the common edge.
              along=V.add(anchor,V.add(beyond,V.mul(V.add(n,back),d)));
            }else along=delta;
            const length=V.len(along);
            check(positive(length),'Coincident centers at interior operator face');
            along=V.mul(along,1/length);
            slope=(values[other]-values[i])/length;
          }else{
            const bc=table[f.region]??closed;
            if(bc.kind==='open')continue;
            if(bc.kind==='value'){
              const offset=V.sub(f.center,cell.center), length=V.len(offset);
              along=V.mul(offset,1/length);
              slope=(bc.value-values[i])/length;
            }else{
              along=n;
              slope=outward(f,bc,values[i],at(i));
              if(slope===null)continue;
            }
          }
          const [x,y,z]=along;
          xx+=x*x;xy+=x*y;xz+=x*z;yy+=y*y;yz+=y*z;zz+=z*z;
          bx+=x*slope;by+=y*slope;bz+=z*slope;
        }
        const regularization=1e-12*Math.max(1,xx,yy,zz);
        const a=Math.sqrt(xx+regularization),b=xy/a,c=xz/a;
        const d=Math.sqrt(yy+regularization-b*b),e=(yz-b*c)/d,f=Math.sqrt(zz+regularization-c*c-e*e);
        const u=bx/a,v=(by-b*u)/d,w=(bz-c*u-e*v)/f;
        const z=w/f,y=(v-e*z)/d,x=(u-b*y-c*z)/a;
        check(finite(x)&&finite(y)&&finite(z),'Cell gradient exceeded numeric range');
        out.set([x,y,z],i*3);
      }
      return out;
    }

    function gradient(values,{boundary,time=0,diffusivity=1}={}){
      return reconstruct(cellValues(values),policies(boundary,time),coefficient(diffusivity));
    }

    function interpolate(values,{boundary,time=0,diffusivity=1,scheme='linear'}={}){
      cellValues(values);
      check(['linear','reconstructed'].includes(scheme),'Unknown face interpolation scheme');
      const table=policies(boundary,time), at=coefficient(diffusivity);
      const slopes=scheme==='reconstructed'?reconstruct(values,table,at):null;
      function side(f,i){
        return values[i]+(slopes?V.dot(slopes.subarray(i*3,i*3+3),V.sub(f.center,cells[i].center)):0);
      }
      return Float64Array.from(faces,f=>{
        const bc=table[f.region]??closed;
        let v;
        if(f.interior){
          const weight=f.ownerDistance/f.span;
          v=side(f,f.owner)*(1-weight)+side(f,f.neighbor)*weight;
        }else if(bc.kind==='value')v=bc.value;
        else{
          const g=outward(f,bc,values[f.owner],at(f.owner));
          check(g!==null,'Face value is undefined for nonzero prescribed flux at zero diffusivity');
          v=values[f.owner]+g*f.ownerDistance;
        }
        check(finite(v),'Face interpolation exceeded numeric range');
        return v;
      });
    }

    function sample(values,sites,{boundary,time=0,diffusivity=1}={}){
      cellValues(values);
      check(Array.isArray(sites)&&sites.length<=65536,'Expected a list of up to 65536 cell sample sites');
      const slopes=reconstruct(values,policies(boundary,time),coefficient(diffusivity));
      return Float64Array.from(sites,(site,i)=>{
        check(integer(site?.cell,0,last)&&vector(site.point),'Invalid cell sample site '+i);
        const j=site.cell;
        const value=values[j]+V.dot(slopes.subarray(j*3,j*3+3),V.sub(site.point,cells[j].center));
        check(finite(value),'Cell interpolation exceeded numeric range');
        return value;
      });
    }

    function flux(velocity,{boundary,time=0,location='normal'}={}){
      const table=policies(boundary,time), lengths={normal:faceCount,constant:3,cells:count*3,faces:faceCount*3};
      check(own(lengths,location),'Unknown velocity field location');
      field(velocity,lengths[location],'velocity field');
      const dot=(i,n)=>n[0]*velocity[i]+n[1]*velocity[i+1]+n[2]*velocity[i+2];
      return Float64Array.from(faces,(f,i)=>{
        if(!f.interior&&(table[f.region]??closed).kind==='closed')return 0;
        let normal;
        if(location==='normal')normal=velocity[i];
        else if(location==='faces')normal=dot(i*3,f.normal);
        else{
          const constant=location==='constant';
          normal=dot(constant?0:f.owner*3,f.normal);
          if(f.interior){
            const weight=f.ownerDistance/f.span;
            normal=normal*(1-weight)-dot(constant?0:f.neighbor*3,f.neighborNormal)*weight;
          }
        }
        const amount=normal*f.area;
        check(finite(amount),'Carrier flux exceeded numeric range');
        return amount;
      });
    }

    function net(faceFlux){
      field(faceFlux,faceCount,'face flux');
      const sums=new Float64Array(count);
      for(const [i,f] of faces.entries()){
        const amount=faceFlux[i];
        sums[f.owner]+=amount;
        if(f.interior)sums[f.neighbor]-=amount;
      }
      return sums.map((v,i)=>{
        const result=v/cells[i].measure;
        check(finite(result),'Flux divergence exceeded numeric range');
        return result;
      });
    }

    function boundaryFlux(faceFlux,dt=1){
      const rows=Object.fromEntries(regions.map(tag=>[tag,{in:0,out:0,net:0}]));
      for(const [i,f] of faces.entries())if(!f.interior){
        const value=faceFlux[i]*dt, row=rows[f.region];
        row.out+=Math.max(0,value);
        row.in+=Math.max(0,-value);
      }
      for(const row of Object.values(rows)){
        row.net=row.out-row.in;
        check(finite(row.out)&&finite(row.in),'Boundary account exceeded numeric range');
      }
      return rows;
    }

    function site(cell){
      const {center,address}=cells[cell];
      return {kind:'cell',cell,center:center.slice(),...(address&&{address:address.slice()})};
    }

    function operator(values,table,{diffusivity,carrierFlux}={}){
      const at=coefficient(diffusivity===undefined?0:diffusivity), flux=zeros(), depletion=new Float64Array(count);
      if(carrierFlux!==undefined)field(carrierFlux,faceCount,'carrier flux');
      for(const [i,f] of faces.entries()){
        const {owner,neighbor,interior}=f, a=values[owner], ka=at(owner);
        const bc=table[f.region]??closed;
        let amount=0, conductance=0;
        if(interior){
          const kb=at(neighbor);
          if(ka>0&&kb>0){
            conductance=f.area/(f.ownerDistance/ka+f.neighborDistance/kb);
            amount=conductance*(a-values[neighbor]);
          }
        }else if(bc.kind==='value'&&ka>0){
          conductance=ka*(f.area/f.ownerDistance);
          amount=conductance*(a-bc.value);
        }else if(bc.kind==='gradient')amount=-ka*bc.value*f.area;
        else if(bc.kind==='flux'&&diffusivity!==undefined)amount=bc.value*f.area;

        depletion[owner]+=conductance;
        if(interior)depletion[neighbor]+=conductance;
        if(carrierFlux!==undefined&&(interior||bc.kind!=='closed')){
          const move=carrierFlux[i];
          if(move>0){amount+=move*a;depletion[owner]+=move;}
          else if(move<0){
            const donor=interior?values[neighbor]:bc.inflow??(bc.kind==='value'?bc.value:undefined);
            check(finite(donor),'Incoming advection needs an inflow value on '+f.region);
            amount+=move*donor;
            if(interior)depletion[neighbor]-=move;
          }
        }
        flux[i]=amount;
      }
      let stableDt=Infinity, limitingCell=null;
      for(const [i,c] of cells.entries()){
        check(finite(depletion[i]),'Transport depletion exceeded numeric range');
        if(depletion[i]>0){
          const bound=c.measure/depletion[i];
          if(bound<stableDt){stableDt=bound;limitingCell=i;}
        }
      }
      const rate=net(flux).map(v=>-v);
      return {flux,rate,stableDt:finite(stableDt)?stableDt:null,
        ...(limitingCell!==null&&{limitingCell:site(limitingCell)})};
    }

    function diffusion(values,{boundary,time=0,diffusivity=1}={}){
      const result=operator(cellValues(values),policies(boundary,time),{diffusivity});
      return {...result,boundaryFlux:boundaryFlux(result.flux)};
    }

    function advection(values,{boundary,time=0,carrierFlux}={}){
      check(carrierFlux!==undefined,'Advection needs an integrated carrier flux');
      const result=operator(cellValues(values),policies(boundary,time),{carrierFlux});
      return {...result,boundaryFlux:boundaryFlux(result.flux)};
    }

    function advance(values,{dt,boundary,time=0,diffusivity=0,carrierFlux,source}={},review,observed){
      check(positive(dt),'Transport needs a finite positive dt');
      const result=operator(cellValues(values),policies(boundary,time,dt),{diffusivity,carrierFlux});
      const context={solver:'grid-transport',domain:identity,time,requestedDt:dt,maxDt:result.stableDt};
      if(review){
        check(finite(time),'Invalid transport diagnostic time');
        if(result.stableDt!==null)review.limit('transport-timestep',dt,result.stableDt,result.limitingCell,time);
      }
      if(result.stableDt!==null&&dt>result.stableDt){
        if(review)return {diagnostics:review.report({...context,advanced:false})};
        throw Error('Transport dt exceeds the combined explicit stability bound '+result.stableDt+
          ' at cell '+result.limitingCell.cell+' (requested '+dt+')');
      }
      const authored=applied?.source(time,dt), hasSource=source!==undefined||Boolean(authored);
      if(source!==undefined&&typeof source!=='number')field(source,count,'cell source');
      if(typeof source==='number')check(finite(source),'Invalid constant cell source');
      const supplied=hasSource?Float64Array.from(values,(_,i)=>
        (typeof source==='number'?source:source?.[i]??0)+(authored?.[i]??0)):null;
      const rate=supplied?result.rate.map((value,i)=>value+supplied[i]):result.rate;
      const next=observed===undefined?Float64Array.from(values,(value,i)=>value+dt*rate[i]):
        Float64Array.from(field(observed,count,'observed cell field'));
      function quantity(source){
        let sum=0, carry=0;
        for(let i=0;i<count;i++){
          const term=source[i]*cells[i].measure-carry, update=sum+term;
          carry=(update-sum)-term;
          sum=update;
        }
        check(finite(sum),'Transport quantity exceeded numeric range');
        return sum;
      }
      const before=quantity(values), after=quantity(next), regions=boundaryFlux(result.flux,dt);
      const outward=Object.values(regions).reduce((sum,row)=>sum+row.net,0);
      const sourceAmount=supplied?dt*quantity(supplied):0;
      const error=after-before+outward-sourceAmount;
      check(finite(error),'Transport balance exceeded numeric range');
      const ledger={before,after,boundary:regions,netOut:outward,...(hasSource&&{source:sourceAmount}),error};
      if(review){
        review.error('transport-balance',error,Math.max(Math.abs(before),Math.abs(after),Math.abs(outward),Math.abs(sourceAmount)),
          {kind:'domain',id:identity.id},time+dt,{before,after,netOut:outward,source:sourceAmount});
        for(const [cell,{measure}] of cells.entries()){
          const change=(next[cell]-values[cell])*measure, expected=(dt*rate[cell])*measure;
          review.error('transport-cell-balance',change-expected,
            Math.max(Math.abs(expected),Math.abs(values[cell]*measure),Math.abs(next[cell]*measure)),
            site(cell),time+dt,{change,expected});
        }
      }
      return {...result,rate,values:next,ledger,...(review&&{
        diagnostics:review.report({...context,advanced:observed===undefined,observed:observed!==undefined})
      })};
    }

    return Object.freeze({domain:identity,...(applied&&{boundarySet:applied.identity}),applyBoundaries,interpolate,sample,gradient,faceGradient,flux,divergence:net,
      diffusion,advection,transport:(values,options)=>advance(values,options),
      inspectTransport:(values,options,{observed,diagnostics=true}={})=>
        advance(values,options,W.diagnostics.create(diagnostics),observed)});
  }

  W.gridOperators=Object.freeze({planFormat,reportFormat,prepare});
})(KIT);
