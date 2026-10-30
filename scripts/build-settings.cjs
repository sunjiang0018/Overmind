const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const destination = process.env.DEST;
let config;
if (destination) {
  const destinations = JSON.parse(fs.readFileSync(path.join(root, 'screeps.json'), 'utf8'));
  if (!Object.hasOwn(destinations, destination)) {
    throw new Error(`Invalid upload destination: ${destination}`);
  }
  config = destinations[destination];
}

module.exports = {
  outputFile: process.env.BUILD_OUTPUT || path.join(root, 'dist/main.js'),
  screepsOptions: {config, dryRun: !destination},
};
