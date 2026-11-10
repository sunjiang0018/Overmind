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

## [ERR-20261104-SSL] Python HTTPS certificate store

**Logged**: 2026-11-04T19:10:04+08:00
**Priority**: low
**Status**: resolved
**Area**: config

### Summary
Python's default OpenSSL certificate bundle is missing on this macOS host; authenticated Screeps HTTPS reads failed certificate verification.

### Error
`SSL: CERTIFICATE_VERIFY_FAILED: unable to get local issuer certificate`

### Context
Python urllib requests to the configured Screeps API. No credentials were printed.

### Suggested Fix
Use `ssl.create_default_context(cafile='/etc/ssl/cert.pem')` on this host; preserve certificate verification.

### Metadata
- Reproducible: yes
- Tags: python, ssl, macos, screeps

### Resolution
- **Resolved**: 2026-11-04T19:10:04+08:00
- **Notes**: The system CA bundle successfully verified an authenticated HTTPS request. Native curl also works, though occasional connection errors may require retrying read-only requests. Do not blindly retry trade submissions.

---

## [ERR-20261105-HISTORY-GZIP] Screeps historical room response

**Logged**: 2026-11-05
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
Official Screeps room-history responses can contain a gzip payload and null ticks.

### Error
Direct JSON decoding failed with an invalid UTF-8 byte; processing a missing tick as an object also raised a TypeError.

### Resolution
Read response bytes and decompress when the gzip magic bytes are present before JSON decoding. The official history chunk size is advertised by /api/version (100 ticks during this audit). Ignore null tick entries and reconstruct state from available full snapshots and subsequent object diffs. Read-only audit scripts and raw evidence were saved under /tmp/overmind-e48s43-audit; credentials were not logged.

### Metadata
- Reproducible: yes
- Tags: screeps, history, gzip, null-ticks

---

## [ERR-20261106-VP1] pnpm_store_location

**Logged**: 2026-11-06T10:40:00+08:00
**Priority**: low
**Status**: resolved
**Area**: config

### Summary
Dependency installation must reuse this checkout's project-local pnpm store.

### Error
`ERR_PNPM_UNEXPECTED_STORE`: existing node_modules links target
`node_modules/.pnpm-store/v11`, while the default store is under `~/Library/pnpm`.

### Context
Encountered while adding Vite+ with pnpm 12.16.1. Vite+ package-manager shims
may also need network access to resolve the pinned package manager.

### Resolution
Use `pnpm --store-dir node_modules/.pnpm-store ...` for dependency operations
on this existing checkout. Do not change global pnpm configuration. Offline
frozen installation may still require uncached supply-chain policy metadata;
retry online rather than disabling policy verification.

### Metadata
- Reproducible: yes
- Related Files: package.json, pnpm-lock.yaml

---

## [ERR-20261106-001] vitest_compiler_oracle_timeout

**Logged**: 2026-11-06T14:13:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
The ambient enum compiler oracle exceeded Vitest's default five-second timeout under load.

### Error
`every generated memory key matches the TypeScript compiler output` took about 9.8 seconds; the other 90 tests passed.

### Resolution
Give only this compiler integration test a 30-second timeout. Keep the unit suite's default timeout unchanged.

### Metadata
- Related Files: tests/ambient-enums.test.ts
- Tags: vitest, typescript, timeout

---

## [ERR-20261106-CONSOLE-SIZE] Screeps console diagnostic queries

**Logged**: 2026-11-06
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
Keep Screeps console probes short and retrieve structured results from a temporary Memory key.

### Error
The official `/api/user/console` rejected a long diagnostic expression with `expression size is too large`. A websocket console listener also timed out without receiving the expected initial frame.

### Resolution
A 704-character console expression succeeded. Save only the scoped diagnostic snapshot in a temporary Memory key, read it through `/api/user/memory?shard=shard3&path=<key>`, and delete the temporary keys after inspection. Never log authentication tokens. Keep probes below 1000 characters; the exact server limit was not measured.

### Metadata
- Reproducible: yes (expression size rejection)
- Related Files: /tmp/overmind-outpost-defense-probe.js
- Tags: screeps, console, diagnostics, memory

---

## [ERR-20261108-E57PREVIEW] Local layout preview fallback

**Logged**: 2026-11-08
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
The CUA in-app browser timed out while opening a localhost layout preview.

### Resolution
Closed the CUA attempt with its required completion summary. Generated and visually inspected the standalone SVG through Quick Look instead, then exercised initialization, RCL selection, position selection, layer toggling and state writes in a DOM smoke harness. This does not establish full browser rendering or interaction coverage. The visualization render helper also requires `--force` when replacing an existing preview destination.

### Metadata
- Related Files: plans/E57S45/layout.svg, scripts/plan-e57s45.py
- Tags: cua, preview, svg, visualization

---

## [ERR-20261108-UNSEEN-FLAG] Screeps unseen-room directive creation

**Logged**: 2026-11-08
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
An accepted console request did not create a flag directly in an unseen room.

### Context
Creating the E57S45 colonize flag directly at the target produced neither a flag nor the post-creation marker. The console API's `ok` only confirmed queue acceptance; the target was absent from `Game.rooms`.

### Resolution
Follow `Directive.createIfNotPresent`: create the flag in a visible parent room and set `Memory.flags[name]` with `C` and `setPos` together. The native directive then uses the effective target immediately and relocates the flag. Verified target position, parent, both colonization Overlords and the 1-claimer/4-pioneer queue at tick 84146662. Record console results or catch exceptions in scoped diagnostics; verify effects separately before reporting success.

### Metadata
- Related Files: src/directives/Directive.ts, plans/E57S45/COLONIZATION.md
- Tags: screeps, flags, console, visibility

---

## [ERR-20261108-URL] Screeps diagnostic URL construction

**Logged**: 2026-11-08T20:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
A temporary read-only diagnostic concatenated the configured root path `/` with `/api/`, producing a double slash and an HTML response instead of JSON.

### Error
`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`

### Resolution
Normalize the base pathname and resolve `api/...` with `new URL`, as in scripts/upload.cjs. The corrected request successfully read live shard3 Memory. No credentials were printed. Reading the large code response subsequently exceeded the diagnostic's 20-second timeout; Memory requests succeeded independently.

---

## [ERR-20261108-DIFF] Compiled transporter comparison

**Logged**: 2026-11-08T22:40:13+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
A temporary deployment comparison removed an added helper and call text, but failed because the compiler also changed the surrounding `else if` into a nested `else` block.

### Error
`Unexpected production changes`

### Resolution
Reviewed the full production diff and verified that all code outside TransportOverlord was byte-identical. The changes inside it were the intended supply helper and fallback branch. All 117 tests and the deployment readback passed. Future comparisons must account for compiler control-flow formatting and inspect a failed comparison before proceeding with dependent deployment steps.

---

## [ERR-20261110-HYD] Existing validation failures during hydralisk fix

**Logged**: 2026-11-10T09:57:03.587Z
**Priority**: medium
**Status**: pending
**Area**: tests

### Summary
Full unit validation has six existing LinkNetwork mock failures; full check also stops on existing evolutionChamber formatting.

### Error
`pnpm run test:unit`: getStoredEnergy is not a function in tests/e57s45-logistics-policy.test.ts (six cases).
`pnpm run check`: formatting issue in src/hiveClusters/evolutionChamber.ts.

### Context
The same six tests fail in a clean git archive of HEAD. Neither affected file was modified in the hydralisk fix. Defense regression tests, typecheck and build pass.

### Suggested Fix
Update the LinkNetwork test runtime to provide the imported Structures helpers and separately format evolutionChamber. Keep those changes separate from defense behavior.

### Metadata
- Reproducible: yes
- Related Files: tests/e57s45-logistics-policy.test.ts, src/logistics/LinkNetwork.ts, src/hiveClusters/evolutionChamber.ts

---

## [ERR-20261110-HRC] Cross-room spawn selection

**Logged**: 2026-11-10T10:00:11.960Z
**Priority**: low
**Status**: resolved
**Area**: backend

### Summary
Native RoomPosition.findClosestByRange does not select a spawn in another room.

### Details
Live hydralisk diagnostics omitted the spawn result while all home spawns were remote. Added a regression with null from findClosestByRange; the initial return-home logic failed. Fall back to the home colony's first spawn for cross-room travel.

### Metadata
- Reproducible: yes
- Related Files: src/overlords/defense/outpostDefense.ts, tests/outpost-controller-defense.test.ts

---

## [ERR-20261110-HCS] Screeps console diagnostic length

**Logged**: 2026-11-10T10:02:01.624Z
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
A large one-off console diagnostic was rejected with expression size is too large.

### Resolution
Reduced the expression to the needed room, combat demand, safeSince and surplus names. Avoid echoing full console API payloads; print only queued status. No gameplay changes resulted from the rejected expression.

---

## [ERR-20261110-API-PATH] Screeps API base path normalization

**Logged**: 2026-11-10T10:14:30.216896+00:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
Normalize the configured root path before appending Screeps API endpoints.

### Error
`Unexpected token '<' ... is not valid JSON`

### Context
A read-only battle assessment interpolated configuration path `/` before `/api/`, producing `//api/` and receiving the frontend HTML instead of JSON. Normalizing the path and querying `/api/` returned current room, Memory and market data successfully.

### Suggested Fix
Use URL construction and strip leading/trailing path slashes as scripts/upload.cjs already does. Inspect status and content type before JSON parsing. Keep authentication headers and unrelated account fields out of output.

### Metadata
- Reproducible: yes
- Related Files: scripts/upload.cjs, screeps.json
- Tags: screeps, api, path, readonly-assessment

---

## [ERR-20261110-001] bundle class extraction

**Logged**: 2026-11-10T13:06:00Z
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
Bundled Overmind classes are named class expressions assigned to variables.

### Error
An AST search limited to ClassDeclaration could not find OutpostDefenseOverlord.

### Suggested Fix
Accept ClassExpression as well as ClassDeclaration, require exactly one match, and parse the patched bundle before uploading. The deployment replaced only the defense class in freshly read live code.

---

## [ERR-20261111-RAID-COVER] covered demolition fallback

**Logged**: 2026-11-11
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
Regression testing caught a formation-follow fallback that could advance the breaker without its local escort.

### Error
The covered-demolition test rejected the escort-loss case: dismantling was denied, but fallback movement still entered the target room.

### Context
New breach-and-lure tactics allow following the tank toward the next work site before direct dismantling is possible.

### Suggested Fix
Require the following movement to retain a healthy tank screen, active medical cover within two tiles, cold towers and a local defender buffer, just like direct demolition.

### Metadata
- Reproducible: yes
- Related Files: src/overlords/offense/limitedRaid.ts, tests/limited-raid.test.ts

### Resolution
- Notes: Added the missing movement gates; all 228 unit tests and 20 bundle tests passed before deployment.

---

## [ERR-20261111-RAID-ARM] native console order preparation

**Logged**: 2026-11-11
**Priority**: medium
**Status**: resolved
**Area**: infra

### Summary
Native console payload size and missing target-room vision rejected the initial scheduled-order registration.

### Error
A 2,089-character console expression was rejected as too large. The shortened expression then reported `Could not access room E57S44` while creating the flag at the unseen target.

### Context
The previous force had already recovered. HTTP Memory polling remained paused because its daily quota was exhausted.

### Suggested Fix
Use a short, idempotent expression and a directive flag in a visible owned room; keep target and route explicitly in operation memory. Read the registered controller through the native authenticated WebSocket rather than altering account rate limits.

### Resolution
- Notes: An 829-character expression armed the operation at the home flag. Native tick 84196174 verified the controller, future launch gate, canRecruit=false, empty receipts, zero assigned units, and the unchanged prior 29,770 ledger.

### Metadata
- Reproducible: yes
- Related Files: plans/E57S44/next-raid.json

---
