import type { OverlordMemory } from "../overlords/Overlord";

export const RAID_ROLES = ["medic", "tank", "interceptor", "breaker", "hauler"] as const;
export type RaidRole = (typeof RAID_ROLES)[number];
export type RaidPhase =
  | "assembling"
  | "draining"
  | "breaching"
  | "looting"
  | "retreating"
  | "complete";

export interface RaidSpawnReceipt {
  name: string;
  role: RaidRole;
  cost: number;
  parts: number;
  tick: number;
  state: "reserved" | "spawned" | "failed" | "uncertain";
  result?: number;
}

export interface LimitedRaidMemory extends OverlordMemory {
  version: 1;
  target: string;
  owner: string;
  budget: number;
  created: number;
  deadline: number;
  phase: RaidPhase;
  route: string[];
  entry: ProtoPos;
  staging: ProtoPos;
  receipts: RaidSpawnReceipt[];
  stopReason?: string;
  stoppedAt?: number;
  finishedAt?: number;
  lastSeen?: number;
  towerEnergy?: number;
  minimumTowerEnergy?: number;
  lastProgress?: number;
  drainStarted?: number;
  coldSince?: number;
  tankRecovering?: boolean;
  tankEntered?: number;
  targetHits?: { id: string; hits: number };
  delivered?: { [resource: string]: number };
  supportEnergy?: number;
  supportTowerTicks?: { [tower: string]: number };
  status?: { tick: number; spent: number; remaining: number; units: number; phase: RaidPhase };
}

export function raidBody(role: RaidRole): BodyPartConstant[] {
  const parts = (part: BodyPartConstant, amount: number) =>
    Array<BodyPartConstant>(amount).fill(part);
  switch (role) {
    // Preserve the last MOVE and the threatening ATTACK part after front-loaded damage.
    case "tank":
      return [...parts(TOUGH, 20), ...parts(MOVE, 20), ATTACK, MOVE];
    case "medic":
      return [...parts(MOVE, 6), ...parts(HEAL, 7), MOVE];
    case "interceptor":
      return [...parts(MOVE, 9), ...parts(RANGED_ATTACK, 7), ...parts(HEAL, 3), MOVE];
    case "breaker":
      return [...parts(MOVE, 14), ...parts(WORK, 15), MOVE];
    case "hauler":
      return [...parts(CARRY, 20), ...parts(MOVE, 10)];
  }
}

export function raidBodyCost(body: BodyPartConstant[]): number {
  return body.reduce((cost, part) => cost + BODYPART_COST[part], 0);
}

/** Reservations remain charged across resets, including an interrupted spawn call. */
export function raidCommitted(memory: LimitedRaidMemory): number {
  return (
    (memory.supportEnergy || 0) +
    memory.receipts.reduce(
      (cost, receipt) => cost + (receipt.state === "failed" ? 0 : receipt.cost),
      0,
    )
  );
}

/** Native home-tower healing is part of the same cap, even during withdrawal. */
export function healWithRaidBudget(
  tower: StructureTower,
  creep: Creep,
): ScreepsReturnCode | undefined {
  const ref = creep.memory.O;
  const flag = ref && Memory.flags[ref.slice(0, ref.lastIndexOf(">"))];
  const memory = (flag as (FlagMemory & { raid?: LimitedRaidMemory }) | undefined)?.raid;
  if (
    !memory ||
    !memory.receipts.some((receipt) => receipt.name === creep.name && receipt.state === "spawned")
  )
    return undefined;
  if (memory.supportTowerTicks?.[tower.id] === Game.time) return OK;
  if (raidCommitted(memory) + TOWER_ENERGY_COST > Math.min(memory.budget, 10000)) {
    stopRaid(memory, "budget limit");
    return ERR_NOT_ENOUGH_RESOURCES;
  }
  memory.supportEnergy = (memory.supportEnergy || 0) + TOWER_ENERGY_COST;
  const result = tower.heal(creep);
  if (result === OK) (memory.supportTowerTicks ??= {})[tower.id] = Game.time;
  else memory.supportEnergy -= TOWER_ENERGY_COST;
  return result;
}

export function stopRaid(memory: LimitedRaidMemory, reason: string): void {
  if (memory.phase === "retreating" || memory.phase === "complete") return;
  memory.stopReason = reason;
  memory.stoppedAt = Game.time;
  memory.phase = "retreating";
}

export function raidHasRole(memory: LimitedRaidMemory, role: RaidRole): boolean {
  return memory.receipts.some((receipt) => receipt.role === role && receipt.state !== "failed");
}

export function reserveRaidSpawn(
  memory: LimitedRaidMemory,
  role: RaidRole,
  creep: ProtoCreep,
): boolean {
  if (memory.phase === "retreating" || memory.phase === "complete" || memory.stopReason)
    return false;
  if (raidHasRole(memory, role)) return false;
  const expected = raidBody(role);
  if (
    creep.body.length !== expected.length ||
    creep.body.some((part, i) => part !== expected[i]) ||
    creep.memory.needBoosts?.length
  ) {
    stopRaid(memory, "unexpected spawn body or boosts");
    return false;
  }
  const cost = raidBodyCost(creep.body);
  if (
    !Number.isFinite(memory.budget) ||
    memory.budget <= 0 ||
    raidCommitted(memory) + cost > Math.min(memory.budget, 10000)
  ) {
    stopRaid(memory, "budget limit");
    return false;
  }
  memory.receipts.push({
    name: creep.name,
    role,
    cost,
    parts: creep.body.length,
    tick: Game.time,
    state: "reserved",
  });
  return true;
}

export function settleRaidSpawn(memory: LimitedRaidMemory, name: string, result: number): void {
  const receipt = memory.receipts.find(
    (entry) => entry.name === name && entry.state === "reserved",
  );
  if (!receipt) {
    stopRaid(memory, "missing spawn receipt");
    return;
  }
  receipt.result = result;
  receipt.state = result === OK ? "spawned" : "failed";
}

export function reconcileRaidSpawns(memory: LimitedRaidMemory): void {
  if (
    !Array.isArray(memory.receipts) ||
    memory.receipts.some(
      (receipt) =>
        !RAID_ROLES.includes(receipt.role) ||
        !Number.isFinite(receipt.cost) ||
        receipt.cost !== raidBodyCost(raidBody(receipt.role)),
    )
  ) {
    stopRaid(memory, "invalid cost ledger");
    return;
  }
  if (raidCommitted(memory) > Math.min(memory.budget, 10000)) stopRaid(memory, "budget limit");
  for (const receipt of memory.receipts) {
    if (receipt.state === "reserved" && Game.time > receipt.tick) {
      if (Game.creeps[receipt.name]) receipt.state = "spawned";
      else {
        receipt.state = "uncertain";
        stopRaid(memory, "unconfirmed spawn; reservation retained");
      }
    }
    if (receipt.state === "spawned" && Game.time > receipt.tick + 1 && !Game.creeps[receipt.name]) {
      stopRaid(memory, `lost ${receipt.role}; no replacements`);
    }
  }
}

export function raidMilitary(creep: Creep, includeClaim = false): boolean {
  return [ATTACK, RANGED_ATTACK, HEAL, ...(includeClaim ? [CLAIM] : [])].some(
    (part) => creep.getActiveBodyparts(part as BodyPartConstant) > 0,
  );
}
