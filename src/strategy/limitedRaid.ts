import type { OverlordMemory } from "../overlords/Overlord";

export const RAID_REINFORCEMENT_ROLES = [
  "supportMedicA",
  "supportMedicB",
  "supportMedicC",
  "extraTank",
] as const;
export const RAID_ROLES = [
  "medic",
  "tank",
  "interceptor",
  ...RAID_REINFORCEMENT_ROLES,
  "breaker",
  "hauler",
  "skirmisher",
] as const;
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
  tactics?: "attrition";
  launch?: { notBefore: number; startedAt?: number };
  breachAndLure?: { maxDepth: number; probeTicks: number };
  lure?: {
    mode:
      | "draining"
      | "opening"
      | "probing"
      | "fighting"
      | "pulling"
      | "arena"
      | "pressure"
      | "recovering";
    since: number;
    probeStarted?: number;
    lastProbeEnded?: number;
    attempts: number;
    noPursuit: number;
    defender?: string;
    arenaSeenAt?: number;
    arenaAttackAt?: number;
    arenaAttackResult?: number;
    arenaDamageObservedAt?: number;
    arenaTarget?: { name: string; hits: number; tick: number };
    reason?: string;
    engagement?: {
      tick: number;
      canWin: boolean;
      friendlyDamage: number;
      enemyDamage: number;
      enemyHealing: number;
      killTicks: number;
      survivalTicks: number;
    };
  };
  reinforcements?: boolean;
  replacing?: string[];
  retiring?: string[];
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
  recruitmentPaused?: { tick: number; role: RaidRole; remaining: number };
  status?: { tick: number; spent: number; remaining: number; units: number; phase: RaidPhase };
}

export function raidBody(role: RaidRole): BodyPartConstant[] {
  const parts = (part: BodyPartConstant, amount: number) =>
    Array<BodyPartConstant>(amount).fill(part);
  switch (role) {
    // Preserve the last MOVE and the threatening ATTACK part after front-loaded damage.
    case "extraTank":
    case "tank":
      return [...parts(TOUGH, 20), ...parts(MOVE, 20), ATTACK, MOVE];
    case "supportMedicA":
    case "supportMedicB":
    case "supportMedicC":
    case "medic":
      return [...parts(MOVE, 6), ...parts(HEAL, 7), MOVE];
    case "interceptor":
      return [...parts(MOVE, 9), ...parts(RANGED_ATTACK, 7), ...parts(HEAL, 3), MOVE];
    case "breaker":
      return [...parts(MOVE, 14), ...parts(WORK, 15), MOVE];
    case "hauler":
      return [...parts(CARRY, 20), ...parts(MOVE, 10)];
    case "skirmisher":
      return [...parts(MOVE, 2), ...parts(RANGED_ATTACK, 3), MOVE];
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

export function raidBudgetLimit(memory: LimitedRaidMemory): number {
  return Number.isFinite(memory.budget) && memory.budget > 0 ? Math.min(memory.budget, 30000) : 0;
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
  if (raidCommitted(memory) + TOWER_ENERGY_COST > raidBudgetLimit(memory)) {
    if (memory.tactics !== "attrition") stopRaid(memory, "budget limit");
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
  return memory.receipts.some(
    (receipt) =>
      receipt.role === role &&
      receipt.state !== "failed" &&
      !memory.retiring?.includes(receipt.name) &&
      !memory.replacing?.includes(receipt.name) &&
      (memory.tactics !== "attrition" ||
        receipt.state !== "spawned" ||
        !!Game.creeps[receipt.name]),
  );
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
  if (!Number.isFinite(memory.budget) || memory.budget <= 0) {
    stopRaid(memory, "budget limit");
    return false;
  }
  if (raidCommitted(memory) + cost > raidBudgetLimit(memory)) {
    if (memory.tactics === "attrition") {
      memory.recruitmentPaused = {
        tick: Game.time,
        role,
        remaining: Math.max(0, raidBudgetLimit(memory) - raidCommitted(memory)),
      };
    } else stopRaid(memory, "budget limit");
    return false;
  }
  delete memory.recruitmentPaused;
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
  // Names can be reused after recycling; never classify a later replacement as retired.
  if (memory.retiring) memory.retiring = memory.retiring.filter((name) => !!Game.creeps[name]);
  if (memory.replacing) memory.replacing = memory.replacing.filter((name) => !!Game.creeps[name]);
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
  if (raidCommitted(memory) > raidBudgetLimit(memory)) stopRaid(memory, "budget limit");
  for (const receipt of memory.receipts) {
    if (receipt.state === "reserved" && Game.time > receipt.tick) {
      if (Game.creeps[receipt.name]) receipt.state = "spawned";
      else {
        receipt.state = "uncertain";
        stopRaid(memory, "unconfirmed spawn; reservation retained");
      }
    }
    if (receipt.state === "spawned" && Game.time > receipt.tick + 1 && !Game.creeps[receipt.name]) {
      if (memory.tactics !== "attrition") stopRaid(memory, `lost ${receipt.role}; no replacements`);
    }
  }
}

export function raidMilitary(creep: Creep, includeClaim = false): boolean {
  return [ATTACK, RANGED_ATTACK, HEAL, ...(includeClaim ? [CLAIM] : [])].some(
    (part) => creep.getActiveBodyparts(part as BodyPartConstant) > 0,
  );
}
