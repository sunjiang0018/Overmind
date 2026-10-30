# Dependency upgrades — 2026-10-30

Direct dependencies were checked against the npm registry's stable `latest` tags. The project
continues to target Node 24 and ES2024 and uses pnpm 12.16.1 with the updated lockfile.

| Dependency | Installed before this update | Installed after this update |
| --- | --- | --- |
| `@tensorflow/tfjs` | 1.7.4 | 4.22.0 |
| `columnify` | 1.5.4 | 1.6.0 |
| `onnxjs` | 0.1.8 | 0.1.8; manifest minimum updated |
| `source-map` | 0.7.3 | 0.8.0 |
| `javascript-obfuscator` | 4.2.2 | 5.9.0 |
| `lodash` | 3.10.1 | 4.18.1 |
| `@types/lodash` | 3.10.2 | 4.17.27 |
| TypeScript CLI | 5.9.3 | 7.0.2 |
| TypeScript compiler API | 5.9.3 | 6.0.3 via the official compatibility package |
| `tslint` | 5.20.1 | 6.1.3 |
| `typedoc` | 0.14.2 | 0.28.20 |
| `pnpm` | 12.10.1 | 12.16.1 |

`@screeps/common` 2.16.1, `@types/screeps` 3.4.0, `rolldown` 1.2.16, and
`rollup-plugin-screeps` 1.0.1 were already at their latest stable versions. Manifest minimums
for the Screeps packages were updated where applicable. The upload adapter still has no
dependency on the removed Rollup bundler.

## Runtime compatibility

`@types/node` stays on the latest Node 24 release, 24.19.2. The registry's general latest tag
is for Node 26 and would describe a different runtime than the project uses.

Screeps supplies Lodash 3 at runtime. Upgrading the tooling dependency to Lodash 4 did not
change the game's global `_`, but the project no longer calls it: all executable Lodash calls
were replaced with native helpers in `src/utilities/native.ts`; see
[native-lodash-migration.md](native-lodash-migration.md). The `@types/lodash-screeps` alias is
still installed but is no longer selected through `compilerOptions.types`, so a reintroduced
`_` call fails type checking. Runtime mocks and parity tests continue to obtain Lodash 3 from
the official `@screeps/common` dependency through `tests/helpers/screeps-lodash.cjs`.

The final `pnpm outdated` check lists the intentionally retained Node 24 types, the Lodash 3
compatibility alias (displayed under its upstream package name), and deprecated TSLint.
TSLint 6.1.3 is its latest release; this upgrade does not replace the lint framework.

## TypeScript 7 and compiler API tools

The native compiler is installed as `@typescript/native: npm:typescript@7.0.2`, which supplies
the `tsc` executable. The `typescript` module is aliased to the official
`@typescript/typescript6@6.0.2` compatibility package, which re-exports TypeScript 6.0.3's
JavaScript API and supplies `tsc6`. This is the side-by-side setup described in the
[official TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).
It allows current compiler API consumers to keep working while type checking and emission
use the latest native compiler.

`scripts/build.cjs` invokes the native compiler explicitly. `rootDir: src` preserves the
previous `tsc-out/Overmind.js` and `tsc-out/assimilation/Assimilator.js` emission paths.
The ES2024 target, legacy decorators, and class-field assignment semantics remain unchanged.

## TypeDoc and installation

TypeDoc's obsolete `mode`, `ignoreCompilerErrors`, and `excludeNotExported` options were
replaced by a standalone `typedoc.json` with explicit expanded entry points. The new
`npm run docs` command writes to `dist/docs/` inside the project. See the
[current TypeDoc input options](https://typedoc.org/documents/Options.Input.html).

The new TensorFlow dependency brings in `core-js`. Its optional postinstall only prints a
project banner and does not build artifacts; `allowBuilds.core-js: false` records that it is
intentionally skipped so installation remains noninteractive. The obsolete highlight.js
build allowance was removed after the TypeDoc upgrade removed that package.

## Validation

- The full JavaScript suite and complete Rolldown bundle tests pass, including global reset,
  ticks, memory keys, pixel generation, and a mocked Screeps upload.
- Native TypeScript 7 type checking and JavaScript emission to `tsc-out/` pass.
- The nine Python planner tests pass.
- The new TypeDoc configuration generates HTML successfully. Existing documentation links
  produce warnings; the generator reports no errors.
- The upgraded obfuscator preserves a fixture's behavior with the existing CLI flags.
- Runtime package smoke checks pass for TensorFlow CPU tensor operations, columnify, ONNX
  tensor construction, and source-map generation/consumption.
- An offline frozen-lockfile installation with pnpm 12.16.1 passes.

Before the upgrade, lint reported 27 diagnostics; the upgraded tool initially reported nine.
The remaining lint issues have since been fixed, and `npm run lint` now passes. No live-server
code upload or deployment was performed.
