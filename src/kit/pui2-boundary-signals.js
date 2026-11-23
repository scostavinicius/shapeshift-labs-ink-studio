/* Reusable finite time signals and interval integrals for physical conditions. */
(function(K){
  const W=K.world,{check,record}=W.data;
  const finite=Number.isFinite, nonnegative=n=>finite(n)&&n>=0, positive=n=>finite(n)&&n>0;
  const fields=(value,keys)=>record(value)&&Object.keys(value).every(key=>keys.includes(key));
  const tau=2*Math.PI;

  function interval(time,dt){
    check(nonnegative(time)&&nonnegative(dt)&&finite(time+dt)&&(!dt||time+dt>time),'Invalid boundary time interval');
    return time+dt;
  }

  function tape(definition){
    if(finite(definition))return {value:()=>definition,integral:(a,b)=>(b-a)*definition};
    check(record(definition),'Boundary signal must be a level, keys, or pulse');
    if(definition.kind==='pulse'){
      const {at,duration,amplitude,shape='hann'}=definition, end=at+duration;
      check(fields(definition,['kind','at','duration','amplitude','shape'])&&nonnegative(at)&&positive(duration)&&
        finite(end)&&end>at&&finite(amplitude)&&['hann','box'].includes(shape),'Invalid boundary pulse');
      const isHann=shape==='hann';
      const primitive=t=>{
        const u=Math.max(0,Math.min(1,(t-at)/duration));
        return amplitude*duration*(isHann ? .5*(u-Math.sin(tau*u)/tau) : u);
      };
      return {
        value:t=>t<at||t>=end?0:amplitude*(isHann ? .5-.5*Math.cos(tau*(t-at)/duration) : 1),
        integral:(a,b)=>primitive(b)-primitive(a)
      };
    }
    const {keys,interpolation='linear',outside='hold'}=definition;
    check(fields(definition,['keys','interpolation','outside'])&&Array.isArray(keys)&&keys.length>=1&&keys.length<=4096&&
      ['linear','step'].includes(interpolation)&&['hold','zero'].includes(outside),'Invalid boundary signal keys');
    const rows=Array.from(keys,(row,i)=>{
      check(fields(row,['time','value'])&&nonnegative(row.time)&&finite(row.value)&&(!i||row.time>keys[i-1].time),
        'Boundary signal keys must be finite and strictly increasing');
      return {time:row.time,value:row.value};
    });
    const sums=new Float64Array(rows.length), linear=interpolation==='linear';
    const segment=(i,span)=>linear&&i<rows.length-1?
      span*(rows[i].value+(rows[i+1].value-rows[i].value)*(.5*span/(rows[i+1].time-rows[i].time))):
      span*rows[i].value;
    for(let i=1;i<rows.length;i++){
      sums[i]=sums[i-1]+segment(i-1,rows[i].time-rows[i-1].time);
      check(finite(sums[i]),'Boundary signal integral exceeded numeric range');
    }
    const first=rows[0],last=rows.at(-1), hold=outside==='hold';
    function index(t){
      let a=0,b=rows.length;
      while(b-a>1){
        const m=(a+b)>>1;
        if(rows[m].time<=t)a=m;
        else b=m;
      }
      return a;
    }
    function primitive(t){
      if(t<first.time)return hold?(t-first.time)*first.value:0;
      if(t>last.time)return sums.at(-1)+(hold?(t-last.time)*last.value:0);
      const i=index(t);
      return sums[i]+segment(i,t-rows[i].time);
    }
    function value(t){
      if(t<first.time)return hold?first.value:0;
      if(t>last.time)return hold?last.value:0;
      const i=index(t), a=rows[i],b=rows[i+1];
      return linear&&b?a.value+(b.value-a.value)*((t-a.time)/(b.time-a.time)):a.value;
    }
    function integral(a,b){
      if(b<=first.time)return hold?(b-a)*first.value:0;
      if(a>=last.time)return hold?(b-a)*last.value:0;
      const i=index(a);
      if(a>=first.time&&i<rows.length-1&&b<=rows[i+1].time)return (b-a)*(linear?value(a+.5*(b-a)):rows[i].value);
      return primitive(b)-primitive(a);
    }
    return {value,integral};
  }

  W.boundarySignals=Object.freeze({fields,finite,nonnegative,positive,interval,tape});
})(KIT);
