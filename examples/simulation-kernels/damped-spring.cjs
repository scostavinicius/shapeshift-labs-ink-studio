const kind = 'damped-spring';
const config = {mass:1, stiffness:26, damping:0.42, displacement:0.72};
const commands = [
  {tick:158,input:'force',value:3.2},
  {tick:176,input:'force',value:0}
];

const definition = {
  revision:1,
  description:'Integrate a driven damped spring with a typed position, velocity and crossing counter.',
  inputs:{force:{type:'number',quantity:{unit:'N',frame:'bench',positive:'right'}}},
  outputs:{
    displacement:{type:'number',quantity:{unit:'m',frame:'bench',positive:'right'},description:'Signed mass displacement.'},
    velocity:{type:'number',quantity:{unit:'m/s',frame:'bench',positive:'right'}},
    energy:{type:'number',quantity:{unit:'J'}},
    crossings:'number'
  },
  estimate: () => ({workspaceBytes:0, workPerStep:{springIntegrations:1}}),
  prepare(config) {
    const {mass=1,stiffness=26,damping=0.42,displacement=0.72} = config;
    if (!Number.isFinite(mass) || mass <= 0 || !Number.isFinite(stiffness) || stiffness <= 0 ||
        !Number.isFinite(damping) || damping < 0 || !Number.isFinite(displacement))
      throw new RangeError('The spring needs positive mass and stiffness, and finite damping and displacement');
    const phase = new Float64Array(2);
    const crossings = new Uint32Array(1);
    function output() {
      const [x,v] = phase;
      return {displacement:x, velocity:v, energy:0.5*(mass*v*v + stiffness*x*x), crossings:crossings[0]};
    }
    return {
      reset() {
        phase.set([displacement,0]);
        crossings[0] = 0;
        return output();
      },
      advance({dt,input}) {
        const [x,v] = phase;
        const nextV = (v + dt * (input.force-stiffness*x)/mass) / (1+dt*damping/mass);
        const nextX = x + dt*nextV;
        if (x <= 0 && nextX > 0) crossings[0]++;
        phase.set([nextX,nextV]);
        return output();
      },
      snapshot() {
        return {buffers:{phase,crossings}};
      },
      restore({buffers}) {
        phase.set(buffers.phase);
        crossings.set(buffers.crossings);
      }
    };
  },
  example:{config,commands,clock:{dt:0.01,tick:95}}
};

module.exports = {kind,config,commands,definition,register:kit => kit.KIT.world.kernels.register(kind,definition)};
