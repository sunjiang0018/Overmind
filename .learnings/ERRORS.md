# Research tooling errors

## [ERR-20261030-AST] TypeScript inventory parent nodes

**Logged**: 2026-10-30T10:58:54+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
An ad hoc Lodash usage scanner assumed every TypeScript AST node retained its parent.

### Error
`TypeError: Cannot read properties of undefined (reading kind)` in `ts.isCallExpression(node.parent)`.

### Context
Read-only research script using TypeScript 5.3.3 `createProgram`; no application source was affected. A separate package-fetch attempt also selected a temporary cwd before creating it.

### Suggested Fix
For syntax-only scans, use `createSourceFile(..., true)` and guard optional parents. For typed scans, use `createCompilerHost(options, true)`. Create a temporary working directory before selecting it.

### Metadata
- Reproducible: yes
- Related Files: docs/es-toolkit-official-research.md

### Resolution
- **Resolved**: 2026-10-30
- **Notes**: Re-ran the inventory with retained parents and separately checked collection input types. Reissued package fetch from an existing cwd. The restricted network returned ENOTFOUND; a permitted network-enabled fetch succeeded. Current Rollup plugins were then observed to reject some package subpath named imports; these are documented as migration constraints.

---

## [ERR-20261030-NAT] Native array callback type inference

**Logged**: 2026-10-30T11:21:37+08:00
**Priority**: low
**Status**: resolved
**Area**: backend

### Summary
Replacing Lodash calls with native methods exposed implicit callback parameter types and an overly narrow literal-array element type.

### Error
TypeScript TS7006 on RoomPosition callbacks and TS2345 on BodyPartConstant passed to includes on an inferred move/carry array.

### Context
The baseline compiled. The first migration build required explicit callback types because prototype methods use noImplicitThis:false, and a BodyPartConstant[] annotation for the whitelist.

### Suggested Fix
Preserve explicit callback types when native receivers are any, and annotate intended whitelist element types rather than using assertions.

### Metadata
- Reproducible: yes
- Related Files: src/prototypes/RoomPosition.ts, src/movement/helpers.ts

### Resolution
- **Resolved**: 2026-10-30
- **Notes**: Added annotations; npm test, 40 Node tests, 9 Python tests, and dry-run Rollup packaging passed.

---

## [ERR-20261030-ARR] Native array continuation tooling and typing

**Logged**: 2026-10-30T11:54:33+08:00
**Priority**: low
**Status**: resolved
**Area**: backend

### Summary
The second native-array pass exposed source-range and contextual-type assumptions in migration tooling.

### Details
- A parent call such as `_.map(xs, fn).join(separator)` can share its start offset with the nested map call. Matching only the start offset caused the preflight parser to reject a generated file before any source was written. Match both start and end offsets.
- Native array callbacks do not supply the same contextual typing as Lodash overloads. Explicit values<Order>/values<DirectiveHarvest> generics and a StructureRampart[] annotation were needed. Compact removes undefined containers at runtime; the local StructureContainer[] assertion records that existing guarantee.
- Nullable lab mineral types require a widened readonly comparison array to preserve includes(null) returning false without assertions or extra property reads.
- AST test fixtures must use declared class names and realistic structure constant values; the loader now asserts that the requested class exists.

### Suggested Action
Parse every generated file before writing any source, use complete AST node spans, and check full builds after the final batch of edits. Read class metadata before constructing source-extraction fixtures.

### Metadata
- Reproducible: yes
- Related Files: src/prototypes/RoomStructures.ts, src/hiveClusters/evolutionChamber.ts, tests/native-arrays-continuation.test.cjs

### Resolution
- **Resolved**: 2026-10-30
- **Notes**: Range matching and types corrected; npm test, 50 Node tests, 9 Python tests, and Rollup dry-run passed. Ten behavioral fixtures passed with actual Lodash 3 against both the pre-pass snapshot and updated source.

---

## [ERR-20261030-RLD] Search connector transport failure during Rolldown compatibility assessment

**Logged**: 2026-10-30
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
The connected search service failed to reach its MCP backend while checking current Rolldown documentation.

### Error
Transport send error: HTTP request failed while sending a request to the MCP backend.

### Context
- Operation: mcp__codex_apps__search_service_web_run
- Query: official Rolldown migration, TypeScript, decorators, and plugin compatibility documentation.

### Suggested Fix
Use the available web tool to read official rolldown.rs documentation and the upstream package manifest when the connector transport is unavailable.

### Metadata
- Reproducible: unknown
- Related Files: rollup.config.js, tsconfig.json, package.json

### Resolution
- **Resolved**: 2026-10-30
- **Notes**: The web tool retrieved official feature and transform documentation and the upstream Node.js engine requirements. No bundler configuration or dependencies were changed.

---

## [ERR-20261030-RMG] Rolldown migration compatibility and package-manager integration

**Logged**: 2026-10-30
**Priority**: medium
**Status**: resolved
**Area**: config

### Summary
The migration exposed package-manager version mismatches and compiler behavior that must be preserved explicitly.

### Details
- The terminal pnpm 10 cannot reuse the pnpm 12 / v11 content store. Existing node_modules metadata identifies pnpm 12.10.1. Old Corepack expects bin/pnpm.cjs, but pnpm 12 has a new executable layout. npm exec with the matching package-manager version worked without replacing the existing dependency directory. Restricted registry access needed a network-enabled command.
- Oxc does not inline ambient const enum values from declaration files. Enabling isolatedModules rejects the project's memory-key enums. Keep isolatedModules disabled and generate transform.define entries from the existing literal declarations. A compiler-oracle test checks all entries.
- Rolldown's neutral platform requires explicit mainFields to resolve legacy packages such as clone. Unresolved imports now fail the build, and the output contract checks for a single self-contained chunk exporting loop.
- Rollup 2's configuration loader cannot default-import a relative CommonJS settings module; require works.
- Concurrent source edits invalidate timing comparisons. The comparison command fingerprints source files and tsconfig.json and aborts if they change during a run.
- The current training-mode loop has the same pre-existing missing LATEST_GLOBAL_RESET_TICK error in both bundles. Tests record this instead of adding an artificial runtime global.

### Suggested Action
Use the pinned package manager, preserve class-field assignment semantics when raising the TS target, and rerun the comparison after source changes.

### Metadata
- Reproducible: yes
- Related Files: package.json, tsconfig.json, rolldown.config.mjs, scripts/ambient-enums.cjs, scripts/compare-builds.cjs
- See Also: ERR-20261030-RLD

### Resolution
- **Resolved**: 2026-10-30
- **Notes**: Both bundlers pass complete-bundle VM behavior checks and upload-hook checks using a fake API. TypeScript checks, legacy TypeScript emission and an offline frozen-lockfile install passed. No live deployment was performed.

---


## [ERR-20261030-MAP] Native dictionary mapping types and VM fixtures

**Logged**: 2026-10-30
**Priority**: low
**Status**: resolved
**Area**: backend

### Summary
A strongly typed native mapValues replacement exposed dictionary values previously assigned to a string column through a Lodash any overload. A regression fixture also reused a VM context with a top-level class declaration and hit an Identifier already declared error.

### Resolution
- Explicitly coerce the directive's mapped display records to strings, preserving the existing column output; verify that output against Screeps Lodash 3.
- Export a class expression in the test loader so multiple extracted classes can share one VM context.
- Use the Lodash 3 dependency supplied by @screeps/common for behavior and performance comparisons, since the development dependency was upgraded separately to Lodash 4.

### Metadata
- Related Files: src/directives/Directive.ts, tests/native-mapping.test.cjs, scripts/benchmark-collections.cjs

## [ERR-20261030-DEP] Latest-dependency compatibility requirements

**Logged**: 2026-10-30
**Priority**: medium
**Status**: resolved
**Area**: config

### Summary
Upgrading to current stable packages requires separate native TypeScript CLI and JavaScript API packages and explicit game-runtime compatibility aliases.

### Details
- TypeScript 7.0.2 no longer supplies the classic compiler API. The official setup uses @typescript/native as an alias for native TypeScript and typescript as an alias for @typescript/typescript6. The tsc binary is supplied by the native package; the API compatibility package supplies tsc6 and re-exports TypeScript 6.0.3.
- Native TypeScript emission required an explicit rootDir: src to preserve the previous tsc-out file layout.
- Screeps runtime still supplies Lodash 3. Keep its global types under an explicit @types/lodash-screeps alias and obtain the runtime fixture from @screeps/common, even though the tooling dependency and its ordinary types are updated to Lodash 4.
- TensorFlow 4 pulls in core-js. pnpm's build policy reported its optional banner-only postinstall as ignored. An explicit allowBuilds.core-js: false records the intentional skip; no build artifacts are needed from that script.
- Raw Node fetch failed in this environment while npm registry queries through pnpm succeeded. Use package-manager registry queries for dependency metadata.

### Suggested Action
Check compiler APIs as well as CLI versions when crossing TypeScript majors, and keep runtime declarations aligned with the actual Screeps engine.

### Metadata
- Reproducible: yes
- Related Files: package.json, tsconfig.json, scripts/build.cjs, typedoc.json, tests/helpers/screeps-lodash.cjs

### Resolution
- **Resolved**: 2026-10-30
- **Notes**: Native checks and emission, 74 JavaScript tests, nine Python tests, TypeDoc generation, obfuscator behavior, runtime dependency smoke checks, and a noninteractive frozen-lockfile install passed. Existing lint diagnostics remain documented separately in docs/dependency-upgrades.md.

---


## [ERR-20261030-HOT] Body boost types and extracted-method scope

**Logged**: 2026-10-30
**Priority**: low
**Status**: resolved
**Area**: backend

### Summary
The installed Screeps BodyPartDefinition type exposes boost as a broad keyof union rather than ResourceConstant. Extracting EvolutionChamber.requiredBoostAmount for testing also required injecting its imported BOOST_PARTS table.

### Resolution
Preserve the former ResourceConstant[] return guarantee with a local boost annotation, and supply the Screeps boost-to-body-part mapping explicitly in the extracted-method test scope. Ten new behavioral tests, the complete test suites, builds, and operation benchmarks passed.

### Metadata
- Related Files: src/utilities/creepUtils.ts, tests/helpers/hotpath-subjects.cjs, tests/lodash-hotpaths.test.cjs

---

## [ERR-20261030-PNP] Pinned pnpm bootstrap outside writable workspace

**Logged**: 2026-10-30
**Priority**: low
**Status**: resolved
**Area**: config

### Summary
Running `pnpm --version` attempted to bootstrap pnpm 12.16.1 into a protected user-library directory and failed with EPERM.

### Error
`EPERM: operation not permitted, mkdir '/Users/sunjiang/Library/pnpm/.tools/pnpm/12.16.1_tmp_17063'`

### Resolution
Dependencies were already installed. Running the existing scripts with `npm test` avoided package-manager bootstrapping; all 108 JavaScript tests, type checking, and the Rolldown build passed. The nine Python planner tests also passed. No dependency installation or lockfile change was needed.

### Metadata
- Reproducible: yes
- Related Files: package.json
- See Also: ERR-20261030-RMG
