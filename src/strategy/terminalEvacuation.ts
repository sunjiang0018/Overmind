import type { Zerg } from "../zerg/Zerg";
import type { Colony } from "../Colony";
import { marketDeal } from "../game/Game";
import { isTerminalReady } from "../game/Structures";
import { getRoomPlayerHostiles } from "../game/Room";
import { protectsSouthGate, southRamparts, isSiegeUnit } from "./southGate";

export interface TerminalEvacuation {
  armedAt: number;
  returnEnergy?: boolean;
  breachedAt?: number;
  gate?: Id<StructureRampart>[];
  lastSale?: {
    tick: number;
    resource: ResourceConstant;
    amount: number;
    credits: number;
    fee: number;
  };
}

export function returningTerminalEnergy(colony: Colony): boolean {
  const policy = colony.memory.terminalEvacuation;
  return !!policy?.returnEnergy && policy.breachedAt === undefined;
}

export function stagingLoad(
  colony: Colony,
  capacity: number,
): { resource: ResourceConstant; amount: number } | undefined {
  const policy = colony.memory.terminalEvacuation,
    storage = colony.storage,
    terminal = colony.terminal;
  if (!policy || !storage || !terminal) return;
  const free = terminal.store.getFreeCapacity();
  // Ready both labs, two waves of spawns, and tower/worker supply before shipping excess energy.
  const reserve =
    policy.breachedAt === undefined ? Math.max(20000, 10 * colony.room.energyCapacityAvailable) : 0;
  const keys = Object.keys(storage.store) as ResourceConstant[];
  keys.sort(
    (a, b) =>
      +(a === RESOURCE_ENERGY) - +(b === RESOURCE_ENERGY) || storage.store[b] - storage.store[a],
  );
  for (const resource of keys) {
    if (resource === RESOURCE_ENERGY && returningTerminalEnergy(colony)) continue;
    const amount = Math.min(
      capacity,
      free,
      storage.store[resource] - (resource === RESOURCE_ENERGY ? reserve : 0),
    );
    if (amount > 0) return { resource, amount };
  }
}

// In E58S42, two walkable service tiles touch both stores. Avoid crossing the bunker between loads.
export function shuttleToTerminal(colony: Colony, unit: Zerg): boolean {
  const terminal = colony.terminal,
    bank = colony.storage;
  if (!colony.memory.terminalEvacuation || !terminal || !bank) return false;
  const load = stagingLoad(colony, unit.store.getFreeCapacity());
  const reverse = returningTerminalEnergy(colony);
  const receiver = (r: ResourceConstant) => (reverse && r === RESOURCE_ENERGY ? bank : terminal);
  const carried = (Object.keys(unit.store) as ResourceConstant[]).find(
    (r) => unit.store[r] > 0 && receiver(r).store.getFreeCapacity(r) > 0,
  );
  // Keep a single first-sale fuel reserve for the still-armed breach order.
  const back = reverse
    ? Math.min(
        unit.store.getFreeCapacity(),
        bank.store.getFreeCapacity(),
        Math.max(0, terminal.store.energy - 1000),
      )
    : 0;
  if (!carried && !load && !back) return false;
  const stop = carried ? receiver(carried) : back ? terminal : bank;
  if (!unit.pos.isNearTo(stop)) {
    const target = [39, 40]
      .map((y) => colony.room.getPositionAt(23, y)!)
      .find(
        (p) =>
          p.isNearTo(terminal) &&
          p.isNearTo(bank) &&
          !p.lookFor(LOOK_CREEPS).length &&
          !p
            .lookFor(LOOK_STRUCTURES)
            .some(
              (s) =>
                s.structureType !== STRUCTURE_ROAD &&
                s.structureType !== STRUCTURE_CONTAINER &&
                !(s.structureType === STRUCTURE_RAMPART && s.my),
            ),
      );
    unit.goTo(target || stop, {
      range: target ? 0 : 1,
      pathOpts: { maxRooms: 1, blockExits: true },
    });
  } else if (carried) unit.creep.transfer(receiver(carried), carried);
  else if (back) unit.creep.withdraw(terminal, RESOURCE_ENERGY, back);
  else if (load) unit.creep.withdraw(bank, load.resource, load.amount);
  unit.blockMovement = true;
  return true;
}

export function checkTerminalBreach(colony: Colony): void {
  const p = colony.memory.terminalEvacuation;
  if (!p || p.breachedAt !== undefined || !protectsSouthGate(colony) || colony.controller.safeMode)
    return;
  const walls = southRamparts(colony.room);
  const prior = p.gate || [];
  const enemies = getRoomPlayerHostiles(colony.room).filter(isSiegeUnit);
  const lost = colony.room
    .getEventLog()
    .some(
      (e) =>
        e.event === EVENT_OBJECT_DESTROYED &&
        e.data.type === STRUCTURE_RAMPART &&
        prior.some((id) => id === e.objectId),
    );
  const interior = enemies.some(
    (e) => e.pos.y <= 46 && e.pos.y >= 42 && e.pos.x >= 17 && e.pos.x <= 34,
  );
  const coreHit = colony.room
    .getEventLog()
    .some(
      (e) =>
        e.event === EVENT_ATTACK &&
        enemies.some((h) => h.id === e.objectId) &&
        [colony.terminal, colony.storage, ...colony.spawns].some((s) => s?.id === e.data.targetId),
    );
  if ((lost && enemies.length) || interior || coreHit) p.breachedAt = Game.time;
  p.gate = walls.map((w) => w.id);
}

export function sellOnBreach(colony: Colony): void {
  const policy = colony.memory.terminalEvacuation,
    terminal = colony.terminal;
  if (
    !policy ||
    policy.breachedAt === undefined ||
    !terminal?.my ||
    !isTerminalReady(terminal) ||
    policy.lastSale?.tick === Game.time
  )
    return;
  const energy = terminal.store.energy;
  if (!energy) return;
  let best:
    | { order: Order; resource: ResourceConstant; amount: number; credits: number; fee: number }
    | undefined;
  const held = (Object.keys(terminal.store) as ResourceConstant[]).filter(
    (r) => terminal.store[r] > 0 && r !== RESOURCE_ENERGY,
  );
  // Search all active buy orders only on a tick in which the terminal can actually sell.
  // Keep fuel for the remaining minerals (including storage still being hauled); if a mineral
  // has no buyer, the rest of the energy above that reserve can still be sold.
  const waiting =
    held.reduce((n, r) => n + terminal.store[r], 0) +
    Object.entries(colony.storage?.store || {}).reduce(
      (n, [r, a]) => n + (r === RESOURCE_ENERGY ? 0 : a),
      0,
    );
  const buyOrders = Game.market
    .getAllOrders({ type: ORDER_BUY })
    .filter((o) => o.roomName && o.amount > 0 && o.price > 0 && !Game.market.orders[o.id]);
  for (const order of buyOrders) {
    const resource = order.resourceType as ResourceConstant;
    const isEnergy = resource === RESOURCE_ENERGY;
    if (!terminal.store[resource] || (isEnergy && best && best.resource !== RESOURCE_ENERGY))
      continue;
    const fuel = isEnergy ? Math.max(0, energy - waiting) : energy;
    if (!fuel) continue;
    let lo = 0,
      hi = Math.min(order.amount, terminal.store[resource]);
    while (lo < hi) {
      const n = Math.ceil((lo + hi) / 2);
      if (
        Game.market.calcTransactionCost(n, colony.name, order.roomName!) + (isEnergy ? n : 0) <=
        fuel
      )
        lo = n;
      else hi = n - 1;
    }
    if (!lo) continue;
    const credits = lo * order.price,
      fee = Game.market.calcTransactionCost(lo, colony.name, order.roomName!);
    if (
      !best ||
      (!isEnergy && best.resource === RESOURCE_ENERGY) ||
      credits > best.credits ||
      (credits === best.credits && fee < best.fee)
    )
      best = { order, resource, amount: lo, credits, fee };
  }
  if (best && marketDeal(best.order.id, best.amount, colony.name) === OK) {
    policy.lastSale = {
      tick: Game.time,
      resource: best.resource,
      amount: best.amount,
      credits: best.credits,
      fee: best.fee,
    };
  }
}
