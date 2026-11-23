function arm({shoulder,elbow,load}){
  const a=[Math.cos(shoulder),Math.sin(shoulder),0], angle=shoulder+elbow;
  const end=[a[0]+.64*Math.cos(angle),a[1]+.64*Math.sin(angle),0];
  return {elbow:a,hand:end,force:.7*load};
}
function string(W,length,speed){
  return W.resonantModes.bake({format:W.resonantModes.planFormat,version:1,id:'tuning-string',
    source:{kind:'string',length,speed,count:5,decay:5,decayPerHz:.007},
    excitations:{pluck:{point:[length*.27,0,0]}},pickups:{body:{point:[length*.43,0,0]}}});
}
function evaluator({KIT:K},{kind,speed}){
  if(kind==='arm')return ({shoulder,elbow,load})=>{
    const {hand,force}=arm({shoulder,elbow,load});
    return {hand,force};
  };
  if(kind==='string')return ({length})=>({pitch:string(K.world,length,speed).modes[0].hz});
  throw new RangeError('Unknown demo evaluator '+kind);
}
module.exports=evaluator;
module.exports.arm=arm;
module.exports.string=string;
