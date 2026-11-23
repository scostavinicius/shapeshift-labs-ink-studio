const radius=6.8, angle=0.90;
const theta=t=>(2*t-1)*angle;
function center(t) {
  const a=theta(t);
  return [radius*Math.cos(a),0,radius*Math.sin(a)];
}
function radii(t) {
  const shoulder=1-Math.exp(-13*(t-0.5)**2);
  return [0.53+0.68*shoulder,0.35+0.48*shoulder];
}
function createField() {
  return (x,y,z)=>{
    const a=Math.atan2(z,x), radial=Math.hypot(x,z), [w,h]=radii((a+angle)/(2*angle));
    return Math.max((Math.hypot((radial-radius)/w,y/h)-1)*Math.min(w,h),radius*(Math.abs(a)-angle));
  };
}
module.exports=Object.assign(createField,{theta,center,radii,angle});
