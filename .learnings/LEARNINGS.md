# Learnings

## [LRN-20261030-N24] correction

**Logged**: 2026-10-30T12:44:01+08:00
**Priority**: medium
**Status**: resolved
**Area**: config

### Summary
The user confirmed that the target official Screeps environment runs Node.js 24.

### Details
The package originally declared Node 20.11, which led to an overly conservative plan for Object.groupBy. The actual target version supplied by the user takes precedence over stale project metadata. The shared workspace was subsequently updated to Node 24 and TypeScript 5.9.3; TypeScript already includes Object.groupBy types, so the temporary declaration added during migration was removed.

### Suggested Action
Use native Node 24 APIs for this deployment target. Re-read current package scripts and types before final checks when the shared workspace changes. Preserve Lodash 3's plain grouping records and null/undefined keys at the migration boundary, and keep caller-provided object predicates lazy when their side effects can change later values.

### Metadata
- Source: user_feedback
- Related Files: package.json, src/utilities/groupBy.ts, tests/native-grouping.test.cjs
- Tags: screeps, node24, native-grouping, shared-workspace

### Resolution
- **Resolved**: 2026-10-30
- **Notes**: Native Object.groupBy and Object.keys are used; object filters use Object.entries where predicates are suitable. Grouping behavior is checked against Lodash 3.10.1.

---

## [LRN-20261103-001] best_practice

**Logged**: 2026-11-03T09:00:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: backend

### Summary
Validate staging and recovery gates separately from crossing into combat.

### Details
Breaker staging was incorrectly gated on enemy vision and an empty tower, leaving it at the spawn. The drainer inherited a 500-energy-per-tower departure gate while its operating recovery reserve was 300; it stalled at full health with home towers at 490 and 920 energy. Move to home staging before enemy checks; specialize the drainer departure reserve to 300 and preserve full-health departure.

### Suggested Action
Test real observed stalled states, including absent enemy vision and home tower levels between 300 and 500. Keep looter reserve unchanged.

### Metadata
- Source: user_feedback
- Related Files: src/overlords/offense/towerStrike.ts, src/overlords/offense/towerDrain.ts, src/overlords/offense/northLoot.ts, tests/north-raid.test.cjs
- Tags: screeps, staging, recovery, inherited-policy

---

## [LRN-20261103-002] best_practice

**Logged**: 2026-11-03T09:37:41.920390+08:00
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
Separate recoverable mission state and audit gaps from permanent mission termination; reserve distinct staging lanes.

### Details
A cost-accounting gap permanently stopped a healthy looter, an unexpected edge crossing stopped a drainer after healing, and the hunter shared a staging tile with a waiting breaker. Recurring units now flag accounting uncertainty without inventing expenses, return and retry after a missed tick or accidental crossing, and the hunter stages at x16 instead of x17. Returning without cargo after an interrupted sortie must not independently mark the mission terminal.

### Suggested Action
Keep strict stop behavior for the original budgeted raid. Verify retry behavior with missing ticks, unexpected crossings, and a real occupied staging tile. Preserve counters and evidence when restoring existing units.

### Metadata
- Source: user_feedback
- Related Files: src/overlords/offense/northRaid.ts, src/overlords/offense/northLoot.ts, src/overlords/offense/towerDrain.ts, src/overlords/offense/northHunter.ts, tests/north-raid.test.cjs
- See Also: LRN-20261103-001

---

## [LRN-20261103-003] correction

**Logged**: 2026-11-03T09:58:03.690555+08:00
**Priority**: medium
**Status**: resolved
**Area**: backend

### Summary
The native scout recycling overlord expects role changeling, not scout.

### Details
RANDOM_SCOUT_COUNT=0 already returns native scouts to the spawn and recycles them. During cancellation, assigning mission units to E58S42>scout with role scout left the native scouts array empty. Roles.scout is the alias changeling. Correcting that value and rebuilding Overmind caused all five units to enter native recycling. All were checked to carry zero resources before reassignment.

### Suggested Action
Read actual Roles values before memory reassignment; confirm both assigned unit list and actual movement. Stop spawn directives first, preserve audit records, and check carried resources before recycling.

### Metadata
- Source: error
- Related Files: src/creepSetups/setups.ts, src/overlords/scouting/randomWalker.ts
- Tags: screeps, recycling, role-alias

---

## [LRN-20261103-004] correction

**Logged**: 2026-11-03T10:33:03.752737+08:00
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
Natural-wall roads are walkable Screeps tunnels, including the live road at E58S43 (17,19).

### Details
RoomPosition.isWalkable previously rejected all terrain walls and incorrectly claimed roads could not be built there. Visible matrices supported ordinary roads, but invisible matrices forgot tunnels and road-ignore matrices failed to reopen wall roads. The fix checks observed wall roads, records tunnel coordinates in room intel, uses them for invisible matrices, and invalidates cached invisible matrices when tunnel knowledge changes. Structures, private ramparts, and explicit obstacles still block those tiles. A live path comparison from (18,0) to the Storage neighbor shortened from 34 to 31 steps.

### Suggested Action
Verify Screeps terrain assumptions against official mechanics. Preserve connectivity even when ignoring road preferences; test visibility loss, road deletion, and rampart or creep blockers.

### Metadata
- Source: user_feedback
- Related Files: src/game/RoomPosition.ts, src/intel/RoomIntel.ts, src/matrix/MatrixLib.ts, tests/tunnel-pathing.test.cjs
- Tags: screeps, tunnels, pathfinding, room-intel

---

## [LRN-20261108-MKT] best_practice

**Logged**: 2026-11-08T09:41:00+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
Read Screeps Terminal inventory and market depth using authenticated GET requests; verify shard dimensions before estimating freight.

### Details
`auth/me` exposes in-game CR as `money`; its `credits` field is not Game.market.credits. `user/rooms?id=<userId>` identifies owned shards/rooms. `game/room-objects?room=<room>&shard=<shard>` returns Terminal stores. `game/market/orders?resourceType=<type>&shard=<shard>` returns active order depth; use `amount`, rather than remainingAmount, for presently fillable quantity. `game/world-size?shard=shard3` returned width/height 122 in this session. Use the actual shard size for continuous room distance; assuming 202 overstates freight. The attempted `game/market/history` URL returned HTML and must not be treated as a supported JSON endpoint.

### Suggested Action
Keep credentials out of output. Distinguish gross bid-depth valuation from a liquidation estimate funded by the Terminal's own energy. Account for both the energy sold and energy spent shipping it. Flag inventory without sufficient buy-order depth. These probes require no game console writes or code deployment.

### Metadata
- Source: error
- Tags: screeps, market, valuation, api
- See Also: ERR-20261106-CONSOLE-SIZE

---

## [LRN-20261110-HYD] correction

**Logged**: 2026-11-10T10:00:11.959Z
**Priority**: medium
**Status**: resolved
**Area**: backend

### Summary
Several peaceful defenders do not prove duplicate spawning; repeated enemy visits may leave several legitimate reinforcements.

### Details
The user identified recurring harassment as an alternative explanation for three E58S44 hydralisks. Live diagnostics showed no spawn requests, different birth times (196 and 447 ticks apart), and a refreshed safeSince value during investigation. Keep confirmed behavior defects (unconditional idle adoption and no peacetime downsizing) separate from unproven spawn history.

### Suggested Action
Inspect demand and arrival history before claiming over-spawning. Preserve threat-driven reinforcements and require a quiet period before downsizing.

### Metadata
- Source: user_feedback
- Related Files: src/overlords/defense/outpostDefense.ts

---

## [LRN-20261110-E57S44] correction

**Logged**: 2026-11-10T10:24:19.697938+00:00
**Priority**: medium
**Status**: resolved
**Area**: backend

### Summary
Use the user's empirical tower-draining and prior engagement evidence when evaluating E57S44.

### Details
The user reported prior probe attacks against pcunning, observed exposed remote harvesting creeps, and confirmed that its tower AI spent all tower energy. This raises the feasibility of a capped unboosted border-drain then demolition raid. Assess this as escalation of prior engagement. Preserve the distinction between tower exhaustion and a lasting supply blockade: a later read-only snapshot at tick 84185217 showed tower (11,14) refilled from 278 to 548 while storage and terminal were still empty. Safe mode remained inactive with four activations available.

### Suggested Action
Treat prior tower exhaustion as user-provided evidence, check current refill and defense response, and separate limited raid budgets from full capture and complete loot hauling. No game orders were issued.

### Metadata
- Source: user_feedback
- Tags: screeps, combat-assessment, empirical-evidence, tower-drain

---

## [LRN-20261110-RAID-CPU] best_practice

**Logged**: 2026-11-10T10:51:39.495468+00:00
**Priority**: medium
**Status**: resolved
**Area**: backend

### Summary
Reserve CPU through a budgeted raid and its withdrawal; validate eligibility again immediately before spawning.

### Details
The E57S44 order was accepted at tick 84185519, then ordinary pixel generation consumed the CPU bucket at tick 84185530. The initial custom 1500-bucket recruitment gate delayed the queued medic. Active limited-raid flags now suppress pixel production through withdrawal without changing the independent user pause setting, and recruitment follows the existing main-loop 100-bucket floor. A regression also caught queued breakers remaining eligible after tower refilling; execution-time validation now checks role-specific phase and live vision as well as the cumulative budget.

### Suggested Action
Keep cost reservations durable across uncertain spawn outcomes, charge native home-tower healing against the same cap, and compare unrelated compiled modules with the live backup before deployment. Current unit, bundle, lint, format, type and deprecated-API checks pass.

### Metadata
- Source: error
- Related Files: src/strategy/limitedRaid.ts, src/overlords/offense/limitedRaid.ts, src/hiveClusters/hatchery.ts, src/utilities/pixels.ts, tests/limited-raid.test.ts
- Tags: screeps, raid, budget, spawn-queue, cpu

---
