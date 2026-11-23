const kind = 'sample-resonator';
const sampleRate = 96000;

function register({KIT: K}, observe) {
  return K.world.kernels.register(kind,{
    revision:1,
    description:'Advance a damped resonator over preallocated typed state at audio sample rates.',
    block:true,
    inputs:{drive:'number'},
    outputs:{signal:'number',peak:'number'},
    estimate:() => ({workspaceBytes:0,workPerStep:{resonatorSamples:1}}),
    prepare({frequency=440,decay=0.06},{dt}) {
      if (!(frequency > 0 && frequency*dt < 0.5 && decay > 0 && Number.isFinite(decay)))
        throw new RangeError('The resonator needs a positive frequency below Nyquist and a finite decay');
      const state = new Float64Array(3);
      const radius = Math.exp(-dt/decay);
      const a = 2*radius*Math.cos(2*Math.PI*frequency*dt), b = radius*radius;
      const output = () => ({signal:state[0],peak:state[2]});
      function process(start,end,input) {
        let latest = state[0], previous = state[1], peak = state[2];
        for (let sample=start;sample<end;sample++) {
          const signal = a*latest-b*previous+input.drive;
          previous = latest;
          latest = signal;
          peak = Math.max(peak,Math.abs(signal));
          observe?.sample?.(sample,signal);
        }
        state[0] = latest;
        state[1] = previous;
        state[2] = peak;
        return output();
      }
      return {
        reset() {
          state.fill(0);
          return output();
        },
        advance({tick,input}) {
          observe?.visit?.(1);
          return process(tick-1,tick,input);
        },
        advanceBlock({start,end,input}) {
          observe?.visit?.(end-start);
          return process(start,end,input);
        },
        snapshot:() => {
          observe?.publish?.();
          return {buffers:{state}};
        },
        restore:({buffers}) => state.set(buffers.state)
      };
    },
    example:{clock:{dt:1/sampleRate,tick:1600,blockSize:1600},
      commands:[{tick:1,input:'drive',value:0.00008}]}
  });
}

module.exports = {kind,sampleRate,register};
