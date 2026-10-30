const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');

test('the Screeps upload plugin receives emitted Rolldown code and Wasm', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'overmind-upload-test-'));
  const pluginPath = require.resolve('rollup-plugin-screeps');
  const apiPath = createRequire(pluginPath).resolve('screeps-api');
  const previousApi = require.cache[apiPath];
  const previousPlugin = require.cache[pluginPath];
  const uploads = [];
  let notifyUpload;
  class FakeScreepsAPI {
    raw = {user: {branches: async () => ({list: [{branch: 'test'}]})}};
    code = {set: (branch, code) => {uploads.push({branch, code}); notifyUpload();}};
  }
  require.cache[apiPath] = {exports: {ScreepsAPI: FakeScreepsAPI}};
  delete require.cache[pluginPath];
  try {
    const screeps = require('rollup-plugin-screeps');
    const {rolldown} = await import('rolldown');
    fs.writeFileSync(path.join(directory, 'entry.js'), 'export function loop() {return 24;}');
    const output = path.join(directory, 'rolldown');
    fs.mkdirSync(output);
    fs.writeFileSync(path.join(output, 'fixture.wasm'), Buffer.from([0, 97, 115, 109]));
    let timeout;
    const uploaded = new Promise((resolve, reject) => {
      notifyUpload = resolve;
      timeout = setTimeout(() => reject(new Error('Upload plugin did not receive the bundle')), 3000);
    });
    let bundle;
    try {
      bundle = await rolldown({input: path.join(directory, 'entry.js'),
        plugins: [screeps({config: {token: 'fake-test-token', branch: 'test'}})]});
      await bundle.write({file: path.join(output, 'main.js'), format: 'cjs', sourcemap: false});
      await uploaded;
      assert.equal(uploads.at(-1).branch, 'test');
      assert.equal(uploads.at(-1).code.main, fs.readFileSync(path.join(output, 'main.js'), 'utf8'));
      assert.deepEqual(uploads.at(-1).code['fixture.wasm'], {binary: 'AGFzbQ=='});
    } finally {
      clearTimeout(timeout);
      await bundle?.close();
    }
    assert.equal(uploads.length, 1);
  } finally {
    if (previousApi) require.cache[apiPath] = previousApi;
    else delete require.cache[apiPath];
    if (previousPlugin) require.cache[pluginPath] = previousPlugin;
    else delete require.cache[pluginPath];
    fs.rmSync(directory, {recursive: true, force: true});
  }
});
