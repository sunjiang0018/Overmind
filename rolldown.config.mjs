import {defineConfig} from 'rolldown';
import screeps from 'rollup-plugin-screeps';
import settings from './scripts/build-settings.cjs';
import ambientEnums from './scripts/ambient-enums.cjs';

export default defineConfig({
  input: 'src/main.ts',
  platform: 'neutral',
  resolve: {mainFields: ['module', 'main']},
  tsconfig: './tsconfig.json',
  transform: {
    target: 'es2024',
    define: ambientEnums.ambientEnumDefines(),
  },
  // Prototype installation and global initialization have intentional side effects.
  treeshake: false,
  plugins: [
    {
      name: 'screeps-output-contract',
      generateBundle(_options, bundle) {
        const chunks = Object.values(bundle).filter(item => item.type === 'chunk');
        if (chunks.length !== 1 || chunks[0].imports.length || chunks[0].dynamicImports.length
            || chunks[0].exports.length !== 1 || chunks[0].exports[0] !== 'loop') {
          throw new Error('Screeps requires one self-contained CommonJS module exporting loop');
        }
      },
    },
    screeps(settings.screepsOptions),
  ],
  onwarn(warning, warn) {
    if (warning.code === 'EVAL') return; // Existing remote debugger; minification stays disabled.
    if (warning.code === 'UNRESOLVED_IMPORT') throw new Error(warning.message);
    warn(warning);
  },
  output: {
    file: settings.outputFile,
    format: 'cjs',
    exports: 'named',
    codeSplitting: false,
    sourcemap: false,
    minify: false,
  },
});
