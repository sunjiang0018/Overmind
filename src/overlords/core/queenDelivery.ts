import { getRoomContainers, getRoomLinks } from "../../game/RoomStructures";
import { transferTaskName } from "../../tasks/instances/transfer";
import type { Zerg } from "../../zerg/Zerg";

export type SupplyStructure = StructureExtension | StructureSpawn | StructureTower | StructureLab;

export function isSupplyStructure(structure: Structure): structure is SupplyStructure {
  return (
    structure.structureType == STRUCTURE_EXTENSION ||
    structure.structureType == STRUCTURE_LAB ||
    structure.structureType == STRUCTURE_TOWER ||
    structure.structureType == STRUCTURE_SPAWN
  );
}

const roomBuffers = [getRoomContainers, getRoomLinks];

export function refillPassingQueen(queen: Zerg): void {
  const actions = queen.actionLog;
  if (!actions.move || actions.transfer || actions.withdraw) return;
  if (queen.store.energy >= 0.4 * queen.store.getCapacity()) return;
  const free = queen.store.getFreeCapacity();
  if (free <= 0) return;

  // Supply deliveries follow cargo loading. Deposits that make room for minerals must finish first.
  const task = queen.task;
  if (task?.name != transferTaskName) return;
  const target = task.target;
  if (!target || !isSupplyStructure(target)) return;

  let best: StructureContainer | StructureLink | undefined;
  let bestAmount = 0;
  for (const getBuffers of roomBuffers) {
    for (const buffer of getBuffers(queen.room)) {
      const energy = buffer.store.energy;
      if (energy <= bestAmount || !queen.pos.isNearTo(buffer.pos)) continue;
      if (energy >= free) {
        queen.withdraw(buffer, RESOURCE_ENERGY);
        return;
      }
      best = buffer;
      bestAmount = energy;
    }
  }
  if (best) queen.withdraw(best, RESOURCE_ENERGY);
}
