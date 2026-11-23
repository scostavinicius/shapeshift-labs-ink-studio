const ink = require('../..');

module.exports = {
  load() {
    const kit = ink.load(), W = kit.KIT.world;
    W.runtime.register('crossing-source', ({tone = false}) => ({
      initial:()=>0,
      step:(_, {time}) => tone ? Math.sin(2*Math.PI*3*time)+0.8*Math.sin(2*Math.PI*44*time) : time,
      outputs:{value:'number'}, output:value=>({value})
    }));
    W.runtime.register('crossing-meter', ({channels}) => ({
      inputs:Object.fromEntries(channels.map(name=>[name,'number'])),
      initial:()=>[],
      step:(state,{time,input})=>state.concat({time,...input}).slice(-4)
    }));
    return kit;
  }
};
