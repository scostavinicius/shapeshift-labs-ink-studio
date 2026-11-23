const ink = require('../..');
module.exports = {
  load() {
    const kit = ink.load();
    require('./resonator.cjs').register(kit);
    return kit;
  }
};
