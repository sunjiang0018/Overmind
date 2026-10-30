# Native Lodash migration — 2026-10-30

## Scope

A TypeScript AST scan found **678 executable Lodash calls across 103 source files**, using 57
distinct methods. Commented-out historical code was not counted. After this migration the source
contains **0 `_.method(...)` calls, 0 `_(...)` chains, and 0 Lodash imports**; `tsconfig.json` no
longer includes the `lodash-screeps` global type, so reintroducing `_` calls fails type checking.
`tests/no-lodash.test.cjs` enforces the same contract.

## Strategy

1. Use native JavaScript directly for traversal and trivial collection operations:
   `map`, `filter`, `forEach`, `find`, `some`, `every`, `findIndex`, indexing for
   `first`/`head`/`last`, `slice` for `take`/`drop`/`dropRight`/`tail`, `flat`-equivalent
   flattening, `includes`/`indexOf`, `Object.keys`/`Object.values`, `Object.hasOwn`,
   `Object.assign`, and native string/number methods.
2. Use [src/utilities/native.ts](../src/utilities/native.ts) for operations that need a small loop
   or are not covered by a builtin: `sum`, `min`, `max`, `sortBy`, `defaults`, `defaultsDeep`,
   `clone`, `cloneDeep`, `remove`, `pull`, `compact`, `unique`, `uniqueBy`, `flatten`,
   `zipObject`, `range`, `take`, `drop`, `dropRight`, `last`, `countBy`, `groupBy`, `partition`,
   `mapKeys`, `mapValues`, `pick`, `invert`, `difference`, `without`, `chunk`, `sortedIndex`,
   `findKey`, `size`, `sample`, `compactMap`,
   `shuffle`, `randomInt`, `memoize`, `isEmpty`, and `isObject`. All native collection helpers live
   in this one module; the former `mapValues.ts` and `groupBy.ts` modules were folded into it.
3. Fuse `_.sum(x.map(fn))`, `_.min(x.map(fn))`, and `_.max(x.map(fn))` into a single pass over
   `x`. The helper computes the callback once per element and avoids the intermediate array.
4. Prefer in-place compaction (`remove`, `pull`) and a single write pass instead of Lodash's
   allocation-heavy helpers.

## Representative replacements

| Before | After |
| --- | --- |
| `_.map(xs, fn)`, `_.filter(xs, fn)` | `xs.map(fn)`, `xs.filter(fn)` (object collections use `Object.values(xs)`) |
| `_.first(xs)`, `_.last(xs)` | `xs[0]`, `last(xs)` |
| `_.sum(xs)`, `_.sum(xs, fn)` | `sum(xs)`, `sum(xs, fn)` |
| `_.max(xs.map(fn))`, `_.min(xs.map(fn))` | `max(xs, fn)`, `min(xs, fn)` (single pass) |
| `_.compact(xs)` / `_.compact(xs.map(fn))` | `compact(xs)` / `compactMap(xs, fn)` (single pass) |
| `_.unique(xs)`, `_.unique(xs, fn)` | `unique(xs)`, `uniqueBy(xs, fn)` |
| `_.flatten(xs)` | `flatten(xs)` (indexed loop; benchmarked faster than `.flat()` on project shapes) |
| `_.remove(xs, fn)`, `_.pull(xs, value)` | `remove(xs, fn)`, `pull(xs, value)` (in place) |
| `_.defaults(o, d)`, `_.defaultsDeep(o, d)` | `defaults(o, d)`, `defaultsDeep(o, d)` |
| `_.clone(o)`, `_.cloneDeep(o)` | `clone(o)`, `cloneDeep(o)` |
| `_.sortBy(xs, fn)` | `sortBy(xs, fn)` (stable decorate-sort-undecorate, input untouched) |
| `_.mapValues(o, fn)` | `mapValues(o, fn)` (own keys only, Lodash 3 `(value, key, object)` callback) |
| `_.groupBy(xs, fn)` | `groupBy(xs, fn)` (null-prototype dictionary, insertion order) |
| `_.zipObject(keys, values)` / `_.object(...)` | `zipObject(keys, values)` |
| `_.range(...)` | `range(...)` |
| `_.sample(xs)`, `_.shuffle(xs)`, `_.random(a, b)` | `sample(xs)`, `shuffle(xs)`, `randomInt(a, b)` |
| `_.memoize(fn)` | `memoize(fn)` (Map keyed by the first argument) |
| `_.isEmpty(x)`, `_.isObject(x)` | `isEmpty(x)`, `isObject(x)` |
| `_.get(x, ['a', 'b'])`, `_.has(x, 'k')` | `x.a?.b`, `Object.hasOwn(x, 'k')` |
| `_.extend(a, b)`, `_.contains(xs, v)`, `_.indexOf(xs, v)` | `Object.assign(a, b)`, `xs.includes(v)`, `xs.indexOf(v)` |
| `_.merge(arrays)` (one-argument form) | direct assignment; see `Colony.computeDrops()` |
| `_.trim`, `_.round`, `_.padRight` | `String#trim`, `Math.round`, `String#padEnd` |

## Behavior notes

- `Graph.removeVertex/removeEdge` now use identity predicates. The previous Lodash object
  shorthand performed deep property matching; vertex/edge identity is the intended semantics.
- `Colony.drops` used `_.merge(this.rooms.map(room => room.drops))`. With a single argument,
  Lodash `merge` returns the array unchanged, which contradicted the declared
  `{ [resourceType: string]: Resource[] }` type. `computeDrops()` now merges the per-room
  dictionaries; no consumer relied on the previous array-shaped value.
- `defaultsDeep` merges nested objects and arrays by index while keeping the existing target
  values. `cloneDeep` copies arrays/plain objects and preserves functions and class instances by
  reference, which is required for `MatrixLib` option callbacks.
- `min`/`max` with an iteratee return the computed extremum; these call sites exist only because
  of the `xs.map(fn)` fusion above. Without an iteratee they return the element, as before.
- `remove` compacts the receiver in one write-forward pass. Project predicates inspect values, not
  the array being compacted, so the observable behavior is unchanged.
- Only the call shapes used by this project are supported. Lodash 3 shorthands, deep prototype
  edge cases, and iteratee-argument quirks are intentionally not reproduced.

## Performance

Two benchmarks are included:

- `scripts/benchmark-native-helpers.cjs` isolates each helper against the Lodash 3 build supplied
  by Screeps (`@screeps/common`).
- `scripts/benchmark-project-patterns.cjs` measures the old call-site expression against the new
  call-site expression, including the surrounding project work. It supports `--case <index>` so
  each case can run in a fresh Node process without cross-case JIT or thermal interference.

Method: Node 24.18, Apple M4, 15 samples per process, the first five samples discarded, three
independent runs per case, median of the run medians. Lower is better; speedup is
`lodash / native`. Laptop timing varies, so ranges are shown for the three runs.

### Call-site patterns (fresh process per case)

| Operation | Lodash 3 | Native | Speedup | Run range |
| --- | ---: | ---: | ---: | ---: |
| `sum(store)` (8 keys) | 60.3 ns | 11.9 ns | 5.07× | 4.90–5.12× |
| `sum(creeps, iteratee)` (24) | 33.1 ns | 16.4 ns | 2.02× | 1.98–2.02× |
| `sum(creeps.map(carry))` (24) | 48.0 ns | 16.4 ns | 2.92× | 2.51–2.92× |
| `max(barriers.map(hits))` (40) | 71.9 ns | 29.8 ns | 2.42× | 2.42–2.49× |
| `min(creeps.map(ttl))` (24) | 51.0 ns | 17.1 ns | 2.99× | 2.67–3.00× |
| `sortBy(creeps, range)` (24) | 797.3 ns | 621.3 ns | 1.28× | 1.24–1.30× |
| `compact(creeps.map(...))` (24) | 88.4 ns | 51.1 ns | 1.73× | 1.68–2.05× |
| `unique(room names)` (20) | 664.2 ns | 622.1 ns | 1.07× | 1.04–1.07× |
| `flatten(8×8)` | 134.1 ns | 67.4 ns | 1.99× | 1.98–1.99× |
| `defaults(options)` | 65.5 ns | 20.2 ns | 3.24× | 3.23–3.25× |
| `remove(dead creeps)` (24) | 151.5 ns | 88.0 ns | 1.72× | 1.72–1.74× |
| `zipObject(20 keys)` | 455.2 ns | 449.3 ns | 1.01× | 1.00–1.02× |
| `clone(options)` | 57.0 ns | 6.0 ns | 9.57× | 9.22–9.57× |

`compact(x.map(fn))` is fused into `compactMap(x, fn)`, so it avoids the intermediate array and the
second pass. The `unique` and `zipObject` call-site rows still include their surrounding `map` work
in both implementations, so their end-to-end gain is small even though the helper itself is faster
(helper-level medians: `unique` 1.33×, `zipObject` 1.08×). The common hot paths that Overmind
actually spends CPU on — `sum`, `min`/`max` over mapped collections, `flatten`, `defaults`,
`remove`, `clone`, and `compactMap` — are the ones with large gains.

### Helper-level medians

Helper-only medians from three runs of `benchmark-native-helpers.cjs`: `sum` 3.2–6.4× (3.2× for a
numeric array, 6.4× for a store dictionary, 7.0× for an iteratee), `defaults` 3.2×, `flatten` 2.1×,
`clone` 7.8×, `unique` 1.33×, `compact` 1.29×, `sortBy` 1.25×, `zipObject` 1.08×. `compactMap` is a
new fused helper (mapping + truthiness filter in one pass) and is covered by the call-site row
above.

The helpers are bundled into the uploaded script (Lodash itself was never bundled because Screeps
provides it globally): the bundle grew from 1,101.26 kB to 1,116.10 kB (+14.8 kB) while removing
Lodash call overhead from every tick.

## Verification

- Native TypeScript 7 type checking passes with the `lodash-screeps` global type removed.
- `npm run lint` passes.
- `npm test` passes: 88 unit tests and 6 bundle tests, including the new
  `tests/native-helpers.test.cjs` coverage and the `tests/no-lodash.test.cjs` regression guard.
- The Rolldown bundle still passes the global reset, tick, memory-key, pixel, training, and upload
  contract tests. No live-server upload or deployment was performed.

## Follow-up

- Root `lodash`, `@types/lodash`, and `@types/lodash-screeps` are no longer used by the source and
  can be removed from `devDependencies` in a separate dependency cleanup. `@screeps/common`
  remains necessary for the Lodash 3 parity fixtures used by the test suite.
- Commented-out legacy modules still contain historical `_.` examples in comments; they are inert
  and intentionally left untouched.
