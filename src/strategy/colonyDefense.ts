import type { Colony } from "../Colony";
import {
  getRoomClaimingPlayerHostiles,
  getRoomDangerousPlayerHostiles,
  getRoomPlayerHostiles,
} from "../game/Room";

/** Opt-in protection for a supported colony. The parent's policy is never inherited. */
export interface ColonyDefenseSettings {
  enabled: boolean;
  referenceDamage: number;
  referenceHealing: number;
  rampartHits: number;
  workstations?: Coord[];
  protectController?: boolean;
  priorityRamparts?: Coord[];
  perimeterRamparts?: Coord[];
  lastSafeModeAttempt?: number;
  lastSafeModeResult?: number;
  southDefenseSchedule?: {
    armedAt: number;
    remainingThreshold?: number;
    attackSeenAt?: number;
    safeModeSeenAt?: number;
    safeModeEndsAt?: number;
    mobilizedAt?: number;
  };
}

/** Legacy opt-in rooms mobilize immediately; scheduled rooms require observed game evidence. */
export function isSouthDefenseActive(colony: Colony): boolean {
  const policy = colony.memory.colonyDefense;
  return (
    !!policy?.enabled &&
    (!policy.southDefenseSchedule || policy.southDefenseSchedule.mobilizedAt !== undefined)
  );
}

export function updateSouthDefenseSchedule(colony: Colony): void {
  const policy = colony.memory.colonyDefense;
  const schedule = policy?.southDefenseSchedule;
  if (
    !policy?.enabled ||
    !schedule ||
    !colony.controller.my ||
    Game.time < schedule.armedAt ||
    schedule.mobilizedAt !== undefined
  )
    return;
  if (
    schedule.attackSeenAt === undefined &&
    (getRoomDangerousPlayerHostiles(colony.room).length > 0 ||
      getRoomClaimingPlayerHostiles(colony.room).length > 0)
  ) {
    schedule.attackSeenAt = Game.time;
  }
  // activateSafeMode() returning OK is an intent, not confirmation. Inspect the live timer.
  const remaining = colony.controller.safeMode || 0;
  if (remaining > 0 && schedule.attackSeenAt !== undefined) {
    const end = Game.time + remaining;
    const start = end - SAFE_MODE_DURATION;
    if (start >= schedule.armedAt && start >= schedule.attackSeenAt - 1) {
      schedule.safeModeSeenAt ??= Game.time;
      schedule.safeModeEndsAt = end;
    }
  }
  if (
    schedule.safeModeSeenAt !== undefined &&
    schedule.safeModeEndsAt !== undefined &&
    Game.time >= schedule.safeModeEndsAt - (schedule.remainingThreshold ?? 2500)
  ) {
    schedule.mobilizedAt = Game.time;
  }
}

export function isControllerRampartDeferred(colony: Colony, pos: Coord): boolean {
  const policy = colony.memory.colonyDefense;
  if (!policy?.enabled || policy.protectController !== false) return false;
  const distance = Math.max(
    Math.abs(pos.x - colony.controller.pos.x),
    Math.abs(pos.y - colony.controller.pos.y),
  );
  return (
    distance <= 3 &&
    (distance <= 1 || !(policy.perimeterRamparts || []).some((p) => p.x == pos.x && p.y == pos.y))
  );
}

export function colonySafeModeReason(colony: Colony): string | undefined {
  if (!colony.memory.colonyDefense?.enabled || !colony.controller.my) return;
  const controller = colony.controller;
  if (
    controller.safeMode ||
    !controller.safeModeAvailable ||
    controller.safeModeCooldown ||
    controller.upgradeBlocked ||
    controller.ticksToDowngrade <
      CONTROLLER_DOWNGRADE[controller.level] / 2 - CONTROLLER_DOWNGRADE_SAFEMODE_THRESHOLD
  )
    return;
  // Trigger before the CLAIM unit can issue attackController and block safe mode.
  if (getRoomClaimingPlayerHostiles(colony.room).some((c) => c.pos.getRangeTo(controller) <= 5)) {
    return "controller approach";
  }
  if (getRoomDangerousPlayerHostiles(colony.room).length > 0) return "colony invasion";
}

/** Includes every walkable attackController tile, plus economic workstations. */
export function colonyCriticalRamparts(colony: Colony): RoomPosition[] {
  const terrain = Game.map.getRoomTerrain(colony.name);
  const positions: Coord[] = [
    ...(colony.memory.colonyDefense?.priorityRamparts || []),
    ...colony.spawns.map((s) => s.pos),
    ...colony.towers.map((s) => s.pos),
    ...(colony.memory.colonyDefense?.workstations || []),
  ];
  const { x, y } = colony.controller.pos;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      if (dx || dy) positions.push({ x: x + dx, y: y + dy });
    }
  if (colony.storage) positions.push(colony.storage.pos);
  if (colony.terminal) positions.push(colony.terminal.pos);
  positions.push(...(colony.roomPlanner.memory.mapsByLevel?.[2]?.[STRUCTURE_CONTAINER] || []));
  const unique = new Map<string, RoomPosition>();
  for (const p of positions) {
    if (
      p.x > 0 &&
      p.x < 49 &&
      p.y > 0 &&
      p.y < 49 &&
      !(terrain.get(p.x, p.y) & TERRAIN_MASK_WALL) &&
      !isControllerRampartDeferred(colony, p)
    ) {
      unique.set(`${p.x}:${p.y}`, new RoomPosition(p.x, p.y, colony.name));
    }
  }
  return [...unique.values()];
}

/** Shared by sentinels and towers so they don't split damage across self-healing enemies. */
export function colonyDefenseTarget(
  colony: Colony,
  candidates = getRoomPlayerHostiles(colony.room),
): Creep | undefined {
  return candidates
    .slice()
    .sort(
      (a, b) =>
        Number(b.getActiveBodyparts(CLAIM) > 0 && b.pos.getRangeTo(colony.controller) <= 5) -
          Number(a.getActiveBodyparts(CLAIM) > 0 && a.pos.getRangeTo(colony.controller) <= 5) ||
        a.hits - b.hits ||
        a.id.localeCompare(b.id),
    )[0];
}

export function colonyRampartTarget(colony: Colony): number {
  return Math.min(
    colony.memory.colonyDefense?.rampartHits || 0,
    RAMPART_HITS_MAX[colony.level] || 0,
  );
}

export interface SupportCapacity {
  energy: number;
  reserve: number;
  bootstrapping: boolean;
  threatened: boolean;
  hasQueen: boolean;
  hasMiners: boolean;
  bucket: number;
}

export function hasColonySupportCapacity(capacity: SupportCapacity): boolean {
  return (
    capacity.energy >= capacity.reserve + 5000 &&
    !capacity.bootstrapping &&
    !capacity.threatened &&
    capacity.hasQueen &&
    capacity.hasMiners &&
    capacity.bucket >= 500
  );
}
