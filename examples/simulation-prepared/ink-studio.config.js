const ink = require('../..');
module.exports = {
  load() {
    const kit = ink.load();
    require('./vent-network.js')(kit.KIT);
    return kit;
  }
};
