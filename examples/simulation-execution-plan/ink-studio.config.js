const ink = require('../..');
module.exports = {
  load() {
    const kit = ink.load();
    const W = kit.KIT.world;
    if (!W.kernels.operation('kernel.damped-spring.v1'))
      require('../simulation-kernels/damped-spring.cjs').register(kit);
    W.runtime.register('spring-drive', ({gain = 8}) => ({
      initial:() => 0,
      inputs:{position:{type:'number',quantity:{unit:'m',frame:'bench',positive:'right'}}},
      outputs:{force:{type:'number',quantity:{unit:'N',frame:'bench',positive:'right'}}},
      estimate:() => ({workspaceBytes:0,workPerStep:{driveSamples:1}}),
      step(_, ctx) {
        const sample = ctx.query.probe('world/data',{}, {dataset:'drive-profile',column:'force',time:ctx.time});
        if (sample.status !== 'ok') throw Error('The drive profile could not be sampled');
        return sample.value - gain*ctx.input.position;
      },
      output:force => ({force})
    }));
    return kit;
  }
};
