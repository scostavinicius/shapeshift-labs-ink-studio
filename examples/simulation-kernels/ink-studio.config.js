module.exports = {
  load() {
    const kit = require('../..').load();
    require('./damped-spring.cjs').register(kit);
    return kit;
  }
};
