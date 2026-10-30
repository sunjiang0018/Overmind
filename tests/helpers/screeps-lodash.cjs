const {createRequire} = require('node:module');

// Screeps supplies Lodash 3. Use its own dependency for runtime emulation and parity checks.
module.exports = createRequire(require.resolve('@screeps/common'))('lodash');
