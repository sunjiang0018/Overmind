// All times are measured from the current tick, including the source's next regeneration.
export interface MineStock {
  stored: number;
  capacity: number;
  dropped: number;
  sourceEnergy: number;
  sourceCapacity: number;
  regeneration: number;
  harvestRate: number;
}

export interface MineArrival {
  eta: number;
  capacity: number;
}

function production(stock: MineStock, ticks: number): number {
  const beforeRegen = Math.min(ticks, stock.regeneration);
  const current = Math.min(stock.sourceEnergy, beforeRegen * stock.harvestRate);
  const after = ticks - beforeRegen;
  const perCycle = Math.min(stock.sourceCapacity, ENERGY_REGEN_TIME * stock.harvestRate);
  return (
    current +
    Math.floor(after / ENERGY_REGEN_TIME) * perCycle +
    Math.min(stock.sourceCapacity, (after % ENERGY_REGEN_TIME) * stock.harvestRate)
  );
}

export function planMinePickup(
  stock: MineStock,
  bookings: MineArrival[],
  eta: number,
  space: number,
  requireFullLoad = true,
) {
  type Inventory = { stored: number; dropped: number };
  function advance(inv: Inventory, from: number, to: number) {
    // A full mine container spills production onto its tile until a pickup clears space.
    inv.dropped = Math.max(0, inv.dropped - (to - from) * Math.ceil(inv.dropped / ENERGY_DECAY));
    const total = inv.stored + production(stock, to) - production(stock, from);
    const spill = Math.max(0, total - stock.capacity);
    // Charge decay for the whole interval to avoid promising short-lived overflow.
    inv.dropped += Math.max(0, spill - (to - from) * Math.ceil(spill / ENERGY_DECAY));
    inv.stored = Math.min(stock.capacity, total);
  }
  function take(inv: Inventory, capacity: number) {
    const ground =
      inv.stored >= stock.capacity
        ? Math.min(inv.dropped, Math.max(0, capacity - inv.stored))
        : Math.min(inv.dropped, capacity);
    const box = Math.min(inv.stored, capacity - ground);
    inv.dropped -= ground;
    inv.stored -= box;
    return ground + box;
  }

  const arrivals = bookings.slice().sort((a, b) => a.eta - b.eta);
  const inventory = { stored: stock.stored, dropped: stock.dropped };
  let last = 0;
  let index = 0;
  while (index < arrivals.length && arrivals[index].eta <= eta) {
    const arrival = arrivals[index++];
    advance(inventory, last, arrival.eta);
    take(inventory, arrival.capacity);
    last = arrival.eta;
  }

  // First tick the box would fill after the preceding pickup, including a regeneration pause.
  let low = last;
  let high = last + CREEP_LIFE_TIME;
  const needed = Math.max(0, stock.capacity - inventory.stored);
  const targetProduction = production(stock, last) + needed;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (production(stock, mid) >= targetProduction) high = mid;
    else low = mid + 1;
  }
  const fullAt = inventory.dropped > 0 ? last : low;
  advance(inventory, last, eta);
  const afterPickup = { ...inventory };
  const load = take(afterPickup, space);
  const targetLoad = Math.min(stock.capacity, space);
  if (load <= 0 || (requireFullLoad && eta > 1 && stock.harvestRate > 0 && load < targetLoad))
    return { load: 0, fullAt };

  // An earlier arrival can take a load if the later, already-dispatched trucks can still collect theirs.
  last = eta;
  for (; index < arrivals.length; index++) {
    const arrival = arrivals[index];
    advance(inventory, last, arrival.eta);
    advance(afterPickup, last, arrival.eta);
    if (take(afterPickup, arrival.capacity) < take(inventory, arrival.capacity))
      return { load: 0, fullAt };
    last = arrival.eta;
  }
  return { load, fullAt };
}

/** Choose the route that brings the most mine energy home per tick of the truck's time. */
export function chooseMineTrip(
  stock: MineStock,
  bookings: MineArrival[],
  directEta: number,
  space: number,
  homeDistance: number,
  ticksToLive: number,
  viaStorage?: MineArrival,
) {
  let best: { load: number; fullAt: number; eta: number; unloadFirst: boolean } | undefined;
  let bestRate = 0;
  function consider(eta: number, capacity: number, unloadFirst: boolean, requireFullLoad: boolean) {
    const tripTicks = eta + homeDistance + 2; // Collect and deliver.
    if (capacity <= 0 || !Number.isFinite(tripTicks) || tripTicks >= ticksToLive) return;
    const plan = planMinePickup(stock, bookings, eta, capacity, requireFullLoad);
    const rate = plan.load / tripTicks;
    if (rate > bestRate) {
      bestRate = rate;
      best = { ...plan, eta, unloadFirst };
    }
  }
  consider(directEta, space, false, true);
  // If a direct pickup already justifies dispatch, freeing cargo space need not yield
  // a completely full truck. Compare the two deliverable loads over the whole trip.
  if (viaStorage) consider(viaStorage.eta, viaStorage.capacity, true, !best);
  return best;
}

// Only wait for the load promised at dispatch. Every extra tick should bring in
// at least as much as this truck could carry per tick on a fresh round trip.
export function mineWaitBudget(
  stock: MineStock,
  wanted: number,
  truckCapacity: number,
  homeDistance: number,
  ticksToLive: number,
) {
  const missing = wanted - stock.stored;
  if (missing <= 0 || stock.stored <= 0 || stock.dropped > 0 || stock.harvestRate <= 0) return 0;
  const budget = Math.floor(
    Math.min(
      (missing * (2 * homeDistance + 2)) / truckCapacity,
      homeDistance,
      ticksToLive - homeDistance - 2,
    ),
  );
  return budget > 0 && production(stock, budget) >= missing ? budget : 0;
}

/** Use the same weighted-energy-per-tick scale as other logistics requests. */
export function minePickupPriority(load: number, fullAt: number, travelTicks: number): number {
  const slack = fullAt - travelTicks;
  const urgency = 1 + Math.max(0, -slack) / travelTicks;
  return (load * urgency) / (travelTicks + Math.max(0, slack));
}
