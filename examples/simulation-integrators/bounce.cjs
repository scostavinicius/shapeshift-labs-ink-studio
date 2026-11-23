module.exports = (_kit,{gravity=9.81,bounce=.73,wind=0,floor=0,restSpeed=.22}={})=>{
  if(![gravity,bounce,wind,floor,restSpeed].every(Number.isFinite)||gravity<=0||bounce<0||bounce>=1||restSpeed<=0)
    throw Error('Bounce needs finite gravity, restitution, wind, floor, and rest speed');
  const resting=(q,v)=>q[1]===floor&&v[1]===0;
  function acceleration(_time,q,v,out){
    out[0]=wind;
    out[1]=resting(q,v)?0:-gravity;
  }
  function derivative(_time,[x,y,vx,vy],out){
    out[0]=vx;
    out[1]=vy;
    out[2]=wind;
    out[3]=y===floor&&vy===0?0:-gravity;
  }
  return {derivative,acceleration,events:[{
    id:'floor-impact',direction:'falling',
    value:(_time,state)=>state[1]-floor,
    react(_time,state){
      state[1]=floor;
      state[3]*=-bounce;
      if(state[3]<restSpeed)state[3]=0;
    }
  }]};
};
