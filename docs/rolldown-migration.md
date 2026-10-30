# Rolldown migration and Node 24

Screeps announced that all runtime servers moved to Node.js 24 on April 1, 2026:
[official announcement](https://steamcommunity.com/games/464350/announcements/detail/494970521254890069).
This project targets Node 24 and ES2024. TypeScript has subsequently been upgraded from 5.9.3
to the native 7.0.2 compiler with the official 6.x compiler API compatibility package;
see [dependency upgrade notes](dependency-upgrades.md). Node 24.11.1 was used for local validation.
Rolldown is now the only bundler. The temporary Rollup fallback, its dependencies,
configuration, comparison command, and generated comparison artifacts have been removed.

## Commands

| Command | Behavior |
| --- | --- |
| `npm run build` / `npm run compile` | Default to the validated Rolldown pipeline |
| `npm run compile:rolldown` | Type check, then produce `dist/main.js` with Rolldown |
| `npm run typecheck` | Type checking without JavaScript output |
| `npm run build:types` | Retained TypeScript emit to `tsc-out/` for the obfuscation workflow |
| `npm run docs` | Generate API documentation in `dist/docs/` |
| `npm run test:unit` | JavaScript source-level tests and constant-enum validation |
| `npm run test:bundle` | Build `dist/main.js`, check runtime behavior, and exercise the upload plugin against a fake API |

Builds use installed local tools rather than global bundler versions.

Only explicit `--destination` arguments to `scripts/build.cjs` enable uploads.
For example, the public-server deployment command runs
`node scripts/build.cjs --destination main`.
`screeps.json` retains the existing destination schema and stays untracked.
The build runner clears inherited `DEST` and `BUILD_OUTPUT` values for local builds.

## TypeScript behavior

- `target` and `lib` are `es2024`; module output remains `esnext` for bundling, with `moduleResolution: bundler`.
- `@types/node` uses major version 24; `.nvmrc`, the package engine, and Travis CI also use Node 24.
- `experimentalDecorators: true` retains the existing decorator calling convention.
- `useDefineForClassFields: false` explicitly preserves the old assignment semantics. Raising the target past ES2022 otherwise changes this default and can reset properties in derived classes.
- `isolatedModules` remains disabled because the project uses global ambient `const enum` memory keys. Enabling it rejects these uses.
- Rolldown/Oxc does not resolve ambient enums from declaration files. `scripts/ambient-enums.cjs` reads their literal values and supplies `transform.define`. There is no second hand-maintained mapping. Unsupported enum initializers fail the build. A test compares every generated value with actual TypeScript compiler emission.
- The build runner executes the TypeScript 7 `tsc --noEmit` before Rolldown. Tests, the enum parser, TypeDoc, and TSLint use the official TypeScript 6 API compatibility package. Direct bundler CLI calls and the explicit `--skip-typecheck` flag skip the native compiler check and are intended for use after a separate check.

See the [TypeScript class-field documentation](https://www.typescriptlang.org/tsconfig/#useDefineForClassFields)
and [Rolldown built-in transforms](https://rolldown.rs/guide/notable-features).

## Bundle and deployment compatibility

Rolldown uses built-in TypeScript conversion, dependency resolution, and CommonJS interop.
The neutral platform avoids automatically assuming browser or full Node runtime globals;
`mainFields: ['module', 'main']` preserves resolution of older dependencies such as `clone`.
Tree shaking and minification remain disabled. Side-effect imports, prototype installation,
and class names used by the profiler are preserved.

The output must be one CommonJS chunk, with no external imports or additional chunks,
exporting only `loop`. Rolldown validates this contract before the upload plugin runs.
The existing direct-eval warning from the optional remote debugger is filtered; other
warnings remain visible, and unresolved imports fail the build.
`rollup-plugin-screeps` remains as a compatible upload adapter; it has no runtime dependency
on the removed bundler. Tests verify that Rolldown passes its emitted JavaScript and a Wasm
fixture through the plugin's actual build hooks to a fake Screeps API. No live upload occurs
in validation.

The generated bundle executes in Node 24 VM contexts with official Screeps constants,
Lodash 3.10.1, and a minimal world with no owned rooms. The checks cover global reset,
module/prototype initialization, the `loop` export, build and refresh ticks, low CPU suspension,
full-bucket pixel generation, and compressed room-memory round trips. These checks do not
simulate a populated colony or replace a live-server observation.

Training-mode startup is also checked. Its first tick currently throws
`LATEST_GLOBAL_RESET_TICK is not defined` because the existing training
reset does not initialize that global. The regression test records this baseline behavior;
the bundler migration does not change the training logic.

## Historical migration comparison

Before removing Rollup, the comparison warmed each bundler once, alternated execution order,
and launched a fresh Node process for every sample. The existing TypeScript-plugin disk cache
was retained. Full mode included the same type check; bundle mode skipped that separate check.
Both modes included process startup and configuration loading. Measurements were sequential,
and source or TypeScript configuration changes invalidated a run. The comparison tooling was
removed after the migration was validated; the results below are a historical record.

The JSON report includes all samples, medians, bundle sizes, SHA-256 hashes, tool versions,
and the source hash. Different bundlers are expected to produce different bytes; behavior
and the output contract are compared instead of requiring identical hashes.

Local five-run medians on 2026-10-30, Node 24.11.1 / macOS arm64:

| Metric | Rollup 2.80.0 | Rolldown 1.2.16 |
| --- | ---: | ---: |
| Type check + bundle | 2,165.48 ms | 1,333.39 ms |
| Bundle, including CLI/config loading | 971.28 ms | 198.96 ms |
| Output bytes | 1,605,278 | 1,100,156 |

On that checkout, full build time fell about 38.4%, bundle time about 79.5%, and output size
about 31.5%. These are warm-cache local build measurements, not Screeps runtime CPU results.
The recorded samples and source hash are saved in [rolldown-build-comparison.json](rolldown-build-comparison.json).
Validation passed: TypeScript checking and emission, all JavaScript tests, nine Python tests,
both bundles' behavior checks, fake-API upload checks, and an offline frozen-lockfile install.
No live-server deployment was performed. Use `npm test` to validate the current Rolldown build.
