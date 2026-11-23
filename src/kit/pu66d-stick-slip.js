/* Elastic shear loading and deterministic breakaway, sliding and catch pulses. */
(function(K){
  const W=K.world,{check,record}=W.data,{hash}=K.procedural.data;
  const finite=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const fields=(row,keys)=>record(row)&&Object.keys(row).every(key=>keys.includes(key));
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const dynamic=(kinetic,stat,speed,scale)=>kinetic+.15*(stat-kinetic)*Math.exp(-speed/scale);
  function compile(raw){
    check(fields(raw,['stiffness','staticFriction','kineticFriction','slipScale','roughness','minInterval','gain','body','decay','hardness']),
      'Invalid stick-slip contact settings');
    const {stiffness=22000,staticFriction=.84,kineticFriction=.42,slipScale=.14,roughness=.22,
      minInterval=.014,gain=.55,body=230,decay=.10,hardness=.65}=raw;
    check(finite(stiffness,1,1e8)&&finite(staticFriction,0,4)&&finite(kineticFriction,0,staticFriction)&&
      finite(slipScale,.0001,100)&&finite(roughness,0,.8)&&finite(minInterval,.008,.2)&&finite(gain,0,4)&&
      InkContactPulse.valid({phase:'slip',body,decay,hardness}),'Invalid stick-slip friction or pulse settings');
    return {stiffness,staticFriction,kineticFriction,slipScale,roughness,minInterval,gain,body,decay,hardness};
  }
  function contact(settings,key,seed,reference){
    const {stiffness:k,roughness,minInterval,body,decay,hardness}=settings, salt=hash(key,seed);
    let previous, last=-Infinity, ordinal=0, shear=0, released=false;
    const random=label=>hash(label+ordinal,salt)/4294967296;
    function limits(reading){
      const {load,speed,friction}=reading;
      const kinetic=friction??settings.kineticFriction;
      const stat=friction===undefined?settings.staticFriction:Math.min(4,kinetic+settings.staticFriction-settings.kineticFriction);
      const high=stat*load*(1+roughness*.38*(random('threshold:')-.5));
      const low=Math.min(high,dynamic(kinetic,stat,speed,settings.slipScale)*load);
      return {high,low,canSlip:load>0&&stat>kinetic&&high>low};
    }
    function emit(phase,time,reading,energy,pulses){
      if(energy<=0||phase==='slip'&&time-last+1e-9<minInterval)return;
      const {speed,load,at}=reading, referenceEnergy=reference**2/(2*k);
      const gain=settings.gain*Math.min(1,Math.sqrt(energy/referenceEnergy));
      const pitch=1+(random('pitch:')-.5)*roughness*.44;
      last=time;
      ordinal++;
      if(gain)pulses.push({time,at,gain,pitch,pulse:{phase,body,decay,hardness},speed,load,energy,
        cue:reading.cue,material:reading.material});
    }
    function advance(to,pulses){
      if(!previous||to<=previous.time)return;
      const {speed,time,frictionState}=previous;
      const {high,low,canSlip}=limits(previous);
      if(!canSlip){shear=0;return;}
      if(speed<=1e-5)return;
      // Long host gaps restore from the last second of held input.
      let at=Math.max(time,to-1);
      if(at>time)shear=0;
      if(frictionState==='stick'){
        shear=Math.min(high/k,shear+speed*(to-at));
        return;
      }
      while(at<to){
        const {high,low,canSlip}=limits(previous);
        if(!canSlip){shear=0;break;}
        const crossing=at+Math.max(0,(high/k-shear)/speed), next=Math.max(crossing,last+minInterval);
        if(next>to){shear=Math.min(high/k,shear+speed*(to-at));break;}
        emit(released?'slip':'breakaway',next,previous,(high*high-low*low)/(2*k),pulses);
        shear=low/k;
        released=true;
        at=next;
      }
    }
    function update(reading,time){
      const pulses=[];
      advance(time,pulses);
      const current={...reading,time}, {high,low,canSlip}=limits(current);
      if(!canSlip){shear=0;released=false;}
      else if(previous&&released&&(previous.frictionState!=='stick'&&reading.frictionState==='stick'||
        previous.speed>1e-5&&reading.speed<=1e-5)){
        const force=Math.min(high,Math.max(low,k*shear));
        emit('catch',time,current,force*force/(2*k),pulses);
        shear=0;released=false;
      }else if(previous?.frictionState==='stick'&&reading.frictionState==='slip'&&reading.speed>1e-5){
        emit('breakaway',time,current,(high*high-low*low)/(2*k),pulses);
        shear=low/k;
        released=true;
      }
      previous=current;
      return pulses;
    }
    function finish(time){const pulses=[];advance(time,pulses);previous=undefined;shear=0;return pulses;}
    return {update,finish};
  }
  W.stickSlip=Object.freeze({compile,contact,dynamic});
})(KIT);
