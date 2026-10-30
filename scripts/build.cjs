const {spawnSync} = require('node:child_process');
const path = require('node:path');
const {parseArgs} = require('node:util');

const root = path.resolve(__dirname, '..');
const {values} = parseArgs({
  options: {
    destination: {type: 'string'},
    output: {type: 'string', default: 'dist/main.js'},
    'skip-typecheck': {type: 'boolean', default: false},
  },
});
if (Number(process.versions.node.split('.')[0]) !== 24) {
  throw new Error('Builds require Node.js 24; run nvm use first.');
}

// Local builds stay local even when the calling shell has a deployment destination set.
const env = {...process.env};
delete env.DEST;
delete env.BUILD_OUTPUT;
env.BUILD_OUTPUT = path.resolve(root, values.output);
env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --dns-result-order=ipv4first`.trim();
if (values.destination) env.DEST = values.destination;

function run(file, args) {
  const result = spawnSync(process.execPath, [path.join(root, file), ...args], {
    cwd: root, env, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

if (!values['skip-typecheck']) {
  run('node_modules/@typescript/native/bin/tsc', ['--noEmit', '-p', '.']);
}
console.log(`Building with Rolldown (destination: ${values.destination || 'none'})`);
run('node_modules/rolldown/bin/cli.mjs', ['-c', 'rolldown.config.mjs']);
