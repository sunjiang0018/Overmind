import { test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  planMinePickup,
  chooseMineTrip,
  minePickupPriority,
  mineWaitBudget,
  type MineStock,
} from "../src/logistics/minePickup";
import { constants } from "./helpers/constants";

for (const key of ["ENERGY_REGEN_TIME", "ENERGY_DECAY", "CREEP_LIFE_TIME"]) {
  vi.stubGlobal(key, constants[key]);
}
const mine: MineStock = {
  capacity: 2000,
  stored: 610,
  dropped: 0,
  harvestRate: 10,
  sourceEnergy: 3000,
  sourceCapacity: 3000,
  regeneration: 300,
};

test("a cross-room truck can leave below the old reporting threshold, but not during a regeneration pause", () => {
  assert.equal(planMinePickup(mine, [], 89, 1500).load, 1500);
  assert.equal(
    planMinePickup({ ...mine, sourceEnergy: 0, regeneration: 80 }, [], 89, 1500).load,
    0,
  );
});

test("reserve in arrival order, protect an en-route truck, and send a second load when it fits", () => {
  const full = { ...mine, stored: 2000 };
  assert.equal(planMinePickup(full, [{ eta: 10, capacity: 1500 }], 20, 1500).load, 0);
  assert.equal(planMinePickup(full, [{ eta: 10, capacity: 1500 }], 110, 1500).load, 1500);
  assert.equal(planMinePickup(full, [{ eta: 90, capacity: 1500 }], 10, 1500).load, 0);
  assert.equal(planMinePickup(full, [{ eta: 90, capacity: 1500 }], 10, 964).load, 964);
  assert.equal(planMinePickup(full, [{ eta: 10, capacity: 1500 }], 10, 1500).load, 0);
});

test("one reservation covers both the ground pile and container, even on the pickup tick", () => {
  const site = { ...mine, stored: 1100, dropped: 420 };
  assert.equal(planMinePickup(site, [], 0, 1500).load, 1500);
  assert.equal(planMinePickup(site, [{ eta: 0, capacity: 1500 }], 1, 1500).load, 30);
  assert.equal(planMinePickup(site, [{ eta: 0, capacity: 1500 }], 20, 1500).load, 0);
});

test("an earlier overflow beats a less urgent full load at the same distance", () => {
  const urgent = planMinePickup({ ...mine, stored: 1980 }, [], 89, 1500);
  const other = planMinePickup(mine, [], 89, 1500);
  assert.ok(
    minePickupPriority(urgent.load, urgent.fullAt, 90) >
      minePickupPriority(other.load, other.fullAt, 90),
  );
});

test("a home unload earns its detour on the full round trip, even for a partial mine load", () => {
  const stock = { ...mine, stored: 1630, harvestRate: 12, sourceEnergy: 2220, regeneration: 227 };
  const bookings = [{ eta: 79, capacity: 1500 }];
  const route = (eta: number, ttl = 1000) =>
    chooseMineTrip(stock, bookings, 112, 964, 89, ttl, { eta, capacity: 1500 });
  assert.equal(route(115)?.unloadFirst, true);
  assert.equal(route(115)?.load, 1395);
  assert.equal(route(240)?.unloadFirst, false);
  assert.equal(route(115, 206)?.unloadFirst, false);
  assert.equal(route(115, 200), undefined);
  assert.equal(
    chooseMineTrip({ ...mine, stored: 0 }, [], 10, 0, 89, 1000, { eta: 30, capacity: 1500 }),
    undefined,
  );
});

test("only wait for production that can justify the wait and still reach storage", () => {
  const stock = { ...mine, stored: 1399 };
  const budget = (s: MineStock, ttl = 1000) => mineWaitBudget(s, 1500, 1500, 101, ttl);
  assert.equal(budget(stock), 13);
  assert.equal(budget(stock, 110), 0);
  assert.equal(budget({ ...stock, sourceEnergy: 0 }), 0);
  assert.equal(budget({ ...stock, harvestRate: 0 }), 0);
  assert.equal(budget({ ...stock, dropped: 30 }), 0);
  assert.equal(budget({ ...stock, stored: 1500 }), 0);
  assert.equal(budget({ ...stock, harvestRate: 5 }), 0);
});
