// Run with Node 24: node scripts/replay-e59s43-hauling.mjs <history-directory>
// Expects the three 100-tick Screeps history files for each room, named ROOM-FIRSTTICK.json.
// https://screeps.com/room-history/shard3/ROOM/FIRSTTICK.json
// and ROOM-terrain.json from https://screeps.com/api/game/room-terrain?shard=shard3&encoded=1&room=ROOM
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { chooseMineTrip, minePickupPriority, mineWaitBudget } from "../src/logistics/minePickup.ts";
const constants = createRequire(import.meta.url)("@screeps/common/lib/constants");
const { ENERGY_DECAY, ENERGY_REGEN_TIME, CREEP_LIFE_TIME } = constants;
Object.assign(globalThis, { ENERGY_DECAY, ENERGY_REGEN_TIME, CREEP_LIFE_TIME });

const directory = process.argv[2];
const start = 84237600,
  duration = 300;
const home = "E58S42",
  transit = "E58S43",
  remote = "E59S43";
const sites = [
  [41, 5],
  [40, 43],
];
const sourceTiles = [
  [42, 6],
  [41, 43],
];
const range = (obj, [x, y]) => Math.max(Math.abs(obj.x - x), Math.abs(obj.y - y));
const energy = (obj) => obj?.store?.energy ?? 0;
function merge(obj, diff) {
  for (const [key, val] of Object.entries(diff)) {
    if (val && typeof val === "object" && obj[key] && typeof obj[key] === "object")
      merge(obj[key], val);
    else obj[key] = val;
  }
}
// Use the recorded road network; allow terrain for short approaches off the road.
const offsets = { [home]: [0, 0], [transit]: [0, 50], [remote]: [50, 50] };
function tileId(room, x, y) {
  const [dx, dy] = offsets[room];
  return (dy + y) * 100 + dx + x;
}
const terrain = new Uint8Array(10000);
function loadMap(room, objects) {
  const file = join(directory, room + "-terrain.json");
  const tiles = JSON.parse(readFileSync(file, "utf8")).terrain[0].terrain;
  for (let y = 0; y < 50; y++)
    for (let x = 0; x < 50; x++) {
      const mask = Number(tiles[y * 50 + x]);
      terrain[tileId(room, x, y)] = mask & 1 ? 0 : mask & 2 ? 10 : 2;
    }
  for (const o of objects) {
    const tile = tileId(room, o.x, o.y);
    if (o.type === "road") terrain[tile] = 1;
    else if (
      (constants.OBSTACLE_OBJECT_TYPES.includes(o.type) && o.type !== "creep") ||
      ["controller", "source", "mineral"].includes(o.type)
    )
      terrain[tile] = 0;
  }
}
// Return the length of a road-favouring path to withdrawal range, accounting for
// room borders. Use orthogonal transitions at exits, as in the recorded route.
function roadSteps(room, tile) {
  const queue = [],
    dist = new Map(),
    steps = new Map();
  function push(pos, cost, length) {
    if (!terrain[pos] || cost >= (dist.get(pos) ?? Infinity)) return;
    dist.set(pos, cost);
    steps.set(pos, length);
    (queue[cost] ??= []).push(pos);
  }
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) push(tileId(room, tile[0] + dx, tile[1] + dy), 0, 0);
  for (let cost = 0; cost < queue.length; cost++)
    for (const pos of queue[cost] ?? []) {
      if (dist.get(pos) !== cost) continue;
      const x = pos % 100,
        y = Math.floor(pos / 100);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || nx >= 100 || ny < 0 || ny >= 100 || (!dx && !dy)) continue;
          if (
            dx &&
            dy &&
            (Math.floor(x / 50) !== Math.floor(nx / 50) ||
              Math.floor(y / 50) !== Math.floor(ny / 50))
          )
            continue;
          push(ny * 100 + nx, cost + terrain[pos], steps.get(pos) + 1);
        }
    }
  return steps;
}
const trucks = Array.from({ length: duration }, () => new Map());
const frames = [],
  warehouse = [];
for (const room of [remote, transit, home]) {
  for (let chunk = 0; chunk < duration; chunk += 100) {
    const file = join(directory, room + "-" + (start + chunk) + ".json");
    const { ticks } = JSON.parse(readFileSync(file, "utf8"));
    const state = new Map();
    for (let t = chunk; t < chunk + 100; t++) {
      const diff = ticks[start + t];
      assert.ok(diff, `Missing frame ${room} ${start + t}`);
      for (const [id, patch] of Object.entries(diff)) {
        if (!patch) state.delete(id);
        else if (!state.has(id)) state.set(id, patch);
        else merge(state.get(id), patch);
      }
      const objects = [...state.values()];
      if (t === 0) loadMap(room, objects);
      for (const o of objects.filter(
        (o) => o.type === "creep" && o.name.startsWith("transport_"),
      )) {
        trucks[t].set(o.name, {
          room,
          x: o.x,
          y: o.y,
          energy: energy(o),
          capacity: o.storeCapacity,
          death: o.ageTime - start,
          spawning: o.spawning,
        });
      }
      if (room === home) warehouse[t] = energy(objects.find((o) => o.type === "storage"));
      if (room === remote)
        frames[t] = sites.map((tile, i) => {
          const box = objects.find((o) => o.type === "container" && range(o, tile) === 0);
          const src = objects.find((o) => o.type === "source" && range(o, sourceTiles[i]) === 0);
          const miner = objects.find(
            (o) => o.type === "creep" && o.name.startsWith("drone_") && range(o, tile) === 0,
          );
          const dropped =
            objects.find((o) => o.type === "energy" && range(o, tile) === 0)?.energy ?? 0;
          return {
            stored: energy(box),
            capacity: box.storeCapacity,
            dropped,
            sourceEnergy: src.energy,
            sourceCapacity: src.energyCapacity,
            regeneration: src.nextRegenerationTime
              ? src.nextRegenerationTime - start - t
              : ENERGY_REGEN_TIME,
            harvestRate:
              miner.body.filter((p) => p.type === "work" && p.hits > 0).length *
              constants.HARVEST_POWER,
          };
        });
    }
  }
}

// Reconstruct withdrawals and deliveries using both sides of the transfer. A mixed load
// contributes only the amount picked up at these two sites.
const trips = new Map(),
  events = Array.from({ length: duration }, () => [[], []]);
const observed = { full: [0, 0], delivered: 0, loss: [0, 0] };
for (let t = 0; t < duration; t++) {
  for (const [i, s] of frames[t].entries()) observed.full[i] += Number(s.stored === s.capacity);
  if (!t) continue;
  for (const [name, cur] of trucks[t]) {
    const prev = trucks[t - 1].get(name);
    if (!prev) continue;
    const delta = cur.energy - prev.energy;
    const i = sites.findIndex((tile) => prev.room === remote && range(prev, tile) <= 1);
    if (delta > 0 && i >= 0) {
      const trip = trips.get(name) ?? { name, site: i, remoteEnergy: 0, firstPickup: t };
      assert.equal(trip.site, i);
      trip.remoteEnergy += delta;
      trip.lastPickup = t;
      trips.set(name, trip);
      events[t][i].push(delta);
    }
    const trip = trips.get(name);
    if (delta < 0 && trip && trip.delivered === undefined) {
      assert.equal(prev.room, home);
      assert.ok(range(prev, [24, 40]) <= 1);
      assert.equal(warehouse[t] - warehouse[t - 1], -delta);
      assert.equal(cur.energy, 0);
      trip.delivered = t;
      observed.delivered += trip.remoteEnergy;
    }
  }
}

// Isolate changes to the transport schedule from the miners' repair/sleep cycle. Derive
// net deposits from stock conservation, including ground decay and observed withdrawals.
const deposits = frames.map((row, t) =>
  row.map((s, i) => {
    if (!t) return 0;
    const prev = frames[t - 1][i],
      withdrawals = events[t][i].reduce((a, b) => a + b, 0);
    const net = s.stored + s.dropped - prev.stored - prev.dropped + withdrawals;
    const decay = s.dropped > 0 ? Math.ceil((s.dropped + 1) / ENERGY_DECAY) : 0;
    observed.loss[i] += decay;
    return net + decay;
  }),
);
// Verify the reconstructed inputs reproduce every stock frame when fed the old
// pickups, including drops collected on the second tick of a visit.
for (let i = 0; i < sites.length; i++) {
  let { stored, dropped } = frames[0][i];
  for (let t = 1; t < duration; t++) {
    for (const amount of events[t][i]) {
      // The replay records the pickup object via its stock change. A pickup from
      // a partial box can coincide with mining, so compare both possible origins.
      const fromBox =
        stored >= amount &&
        Math.min(frames[t][i].capacity, stored - amount + deposits[t][i]) === frames[t][i].stored;
      if (fromBox) stored -= amount;
      else dropped -= amount;
    }
    const total = stored + deposits[t][i];
    stored = Math.min(frames[t][i].capacity, total);
    dropped += total - stored;
    dropped -= Math.ceil(dropped / ENERGY_DECAY);
    assert.deepEqual([stored, dropped], [frames[t][i].stored, frames[t][i].dropped]);
  }
}
const returnTime = sites.map((_, i) => {
  const travel = [...trips.values()]
    .filter((trip) => trip.site === i)
    .map((trip) => trip.delivered - trip.lastPickup)
    .sort((a, b) => a - b);
  assert.ok(travel.length);
  return travel[Math.floor(travel.length / 2)];
});

// Keep all productive jobs outside E59S43 before each historical trip. Release a new
// spawn on its first active frame. Returns release the vehicle back to the colony.
// Each of the four observed runs gets one visit. A different return tick can change
// when the truck becomes available for its next job outside this comparison.
const releases = [...trips.values()]
  .map((trip) => {
    let release = 0;
    for (let t = 1; t < trip.firstPickup; t++) {
      const cur = trucks[t].get(trip.name),
        prev = trucks[t - 1].get(trip.name);
      if (
        cur?.room === home &&
        prev &&
        ((prev.spawning && !cur.spawning) || cur.energy !== prev.energy)
      )
        release = t;
    }
    const origin = trucks[release].get(trip.name);
    assert.ok(origin && !origin.spawning);
    return {
      name: trip.name,
      release,
      origin,
      historicalSite: trip.site,
      historicalPickup: trip.firstPickup,
    };
  })
  .sort((a, b) => a.release - b.release);

// Anchor each site's distance to its measured loaded return time; adjust by the road
// distance from this particular release position relative to the warehouse.
const roads = sites.map((tile) => roadSteps(remote, tile));
const toWarehouse = roadSteps(home, [24, 40]);
function travelFrom(origin, site) {
  const route = roads[site];
  const steps = route.get(tileId(origin.room, origin.x, origin.y));
  const warehouseSteps = route.get(tileId(home, 25, 39));
  assert.ok(Number.isFinite(steps) && Number.isFinite(warehouseSteps));
  return Math.max(1, returnTime[site] + steps - warehouseSteps);
}

function simulate(extraTravel, keepHistoricalJourney = false, optimized = true) {
  const inventory = frames[0].map(({ stored, dropped }) => ({ stored, dropped }));
  const fleet = releases.map((r) => ({
    ...r,
    initial: r.origin.energy,
    cargo: 0,
    stage: "idle",
    eta: 0,
    site: -1,
  }));
  const stats = { full: [0, 0], delivered: 0, loss: [0, 0], transit: 0, truckTicks: 0 };
  for (let t = 0; t < duration; t++) {
    for (let i = 0; i < sites.length; i++)
      stats.full[i] += Number(inventory[i].stored === frames[t][i].capacity);
    if (t === duration - 1) break;
    for (const unit of fleet) {
      if (unit.stage !== "idle" || t < unit.release) continue;
      const space = unit.origin.capacity - unit.initial;
      let best;
      for (const [i, frame] of frames[t].entries()) {
        const direct = travelFrom(unit.origin, i);
        const historicalDelay =
          unit.historicalPickup - unit.release - travelFrom(unit.origin, unit.historicalSite);
        const adjustment = keepHistoricalJourney ? historicalDelay : 0;
        const travel = Math.max(1, direct + adjustment) + extraTravel;
        const depotTicks =
          toWarehouse.get(tileId(unit.origin.room, unit.origin.x, unit.origin.y)) + 1;
        const afterDepot = Math.max(1, returnTime[i] + adjustment) + extraTravel;
        const bookings = fleet
          .filter((u) => u.stage === "out" && u.site === i)
          .map((u) => ({
            eta: Math.max(0, u.eta - t - 1),
            capacity: u.origin.capacity - (u.unloadFirst ? 0 : u.initial) - u.cargo,
          }));
        const plan = chooseMineTrip(
          { ...frame, ...inventory[i] },
          bookings,
          travel - 1,
          space,
          returnTime[i] + extraTravel,
          unit.origin.death - t,
          optimized && unit.initial > 0
            ? {
                eta: depotTicks + afterDepot - 1,
                capacity: unit.origin.capacity,
              }
            : undefined,
        );
        if (!plan) continue;
        const priority = minePickupPriority(plan.load, plan.fullAt, plan.eta + 1);
        if (priority > 0 && (!best || priority > best.priority))
          best = {
            site: i,
            plannedLoad: plan.load,
            travel: plan.eta + 1,
            priority,
            unloadFirst: plan.unloadFirst,
            unloadAt: plan.unloadFirst ? t + depotTicks : undefined,
          };
      }
      if (best) Object.assign(unit, { ...best, stage: "out", eta: t + best.travel });
    }
    const next = t + 1;
    for (const u of fleet) {
      if (u.unloadAt === next) {
        u.unloaded = u.initial; // Home cargo is never credited as remote energy.
        u.initial = 0;
      }
      if (u.eta !== next) continue;
      if (u.stage === "return") {
        stats.delivered += u.cargo;
        u.stage = "done";
        continue;
      }
      if (u.stage !== "out") continue;
      const inv = inventory[u.site],
        free = u.origin.capacity - u.initial - u.cargo;
      const ground = inv.dropped > 0 && (inv.stored < frames[t][u.site].capacity || u.tookFromBox);
      const wanted = Math.min(free, u.plannedLoad - u.cargo);
      if (
        optimized &&
        !inv.dropped &&
        inv.stored < wanted &&
        (u.waitUntil === undefined || t < u.waitUntil) &&
        !fleet.some((other) => other !== u && other.stage === "out" && other.site === u.site)
      ) {
        const budget = mineWaitBudget(
          { ...frames[t][u.site], ...inv },
          wanted,
          u.origin.capacity,
          returnTime[u.site] + extraTravel,
          u.origin.death - t,
        );
        if (budget > 0) {
          u.waitUntil ??= t + budget;
          u.eta = next + 1;
          continue;
        }
      }
      const amount = Math.min(free, ground ? inv.dropped : inv.stored);
      if (ground) inv.dropped -= amount;
      else {
        inv.stored -= amount;
        u.tookFromBox = true;
      }
      u.cargo += amount;
      if (amount < free && (ground ? inv.stored > 0 : inv.dropped > 0)) u.eta = next + 1;
      else {
        u.stage = "return";
        u.eta = next + returnTime[u.site] + extraTravel;
      }
    }
    for (let i = 0; i < sites.length; i++) {
      const inv = inventory[i],
        total = inv.stored + deposits[next][i];
      inv.stored = Math.min(frames[t][i].capacity, total);
      inv.dropped += total - inv.stored;
      const loss = Math.ceil(inv.dropped / ENERGY_DECAY);
      inv.dropped -= loss;
      stats.loss[i] += loss;
    }
  }
  stats.transit = fleet
    .filter((u) => u.stage === "return" || u.stage === "out")
    .reduce((n, u) => n + u.cargo, 0);
  stats.truckTicks = fleet.reduce(
    (sum, u) => sum + (u.stage === "done" ? u.eta : duration - 1) - u.release,
    0,
  );
  for (let i = 0; i < sites.length; i++)
    assert.ok(inventory[i].stored >= 0 && inventory[i].dropped >= 0);
  const supply =
    frames[0].reduce((n, s) => n + s.stored + s.dropped, 0) +
    deposits.flat().reduce((a, b) => a + b, 0);
  assert.equal(
    supply,
    stats.delivered +
      stats.transit +
      stats.loss[0] +
      stats.loss[1] +
      inventory.reduce((n, s) => n + s.stored + s.dropped, 0),
  );
  return {
    stats,
    fleet: fleet.map((u) => [u.name, u.release, u.site, u.stage, u.eta, u.cargo, u.unloaded ?? 0]),
  };
}
console.log(
  JSON.stringify(
    {
      start,
      duration,
      observed: {
        ...observed,
        truckTicks: releases.reduce((sum, r) => sum + trips.get(r.name).delivered - r.release, 0),
      },
      trips: [...trips.values()],
      returnTime,
      outbound: releases.map((r) => [
        r.name,
        r.release,
        r.origin.energy,
        ...sites.map((_, i) => travelFrom(r.origin, i)),
      ]),
      previousDirect: simulate(0, false, false),
      direct: simulate(0),
      historicalTravel: simulate(0, true),
      extraFiveTicksPerLeg: simulate(5),
      extraTenTicksPerLeg: simulate(10),
    },
    null,
    2,
  ),
);
