const path=require('node:path');
const studio=require(process.env.INK_STUDIO_BENCH_PACKAGE??path.join(__dirname,'../..'));
const root=path.dirname(require.resolve(process.env.INK_STUDIO_BENCH_PACKAGE??path.join(__dirname,'../..')));

module.exports={
  load(){
    const kit=studio.load();
    require(path.join(root,'examples/simulation-prepared/vent-network.js'))(kit.KIT);
    require(path.join(root,'examples/simulation-fast-checkpoints/ink-studio.config.js')).register(kit);
    return kit;
  }
};
