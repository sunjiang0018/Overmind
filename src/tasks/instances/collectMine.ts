import { Task } from "../Task";

// Keep the container as the task target throughout the trip, even when collecting a spill.
export class TaskCollectMine extends Task<StructureContainer> {
  constructor(container: StructureContainer, plannedLoad?: number) {
    super("collectMine", container);
    this.data.plannedLoad = plannedLoad;
  }

  isValidTask() {
    return this.data.collectedAt === undefined && this.creep.store.getFreeCapacity() > 0;
  }

  isValidTarget() {
    const container = this.target;
    if (!container) return false;
    return !this.isWorking || container.store.energy > 0 || !!this.drop(container);
  }

  private drop(container: StructureContainer) {
    return container.pos
      .lookFor(LOOK_RESOURCES)
      .find((resource) => resource.resourceType == RESOURCE_ENERGY);
  }

  work() {
    const container = this.target;
    if (!container) return ERR_INVALID_TARGET;
    const drop = this.drop(container);
    // Make room in a full box before the next harvest, then collect its ground pile.
    if (drop && (container.store.getFreeCapacity() > 0 || this.data.tookFromBox)) {
      const result = this.creep.pickup(drop);
      if (result == OK && this.data.plannedLoad !== undefined)
        this.data.plannedLoad -= Math.min(drop.amount, this.creep.store.getFreeCapacity());
      return result;
    }
    const wanted = Math.min(this.creep.store.getFreeCapacity(), this.data.plannedLoad ?? 0);
    if (
      !drop &&
      container.store.energy < wanted &&
      (this.data.waitUntil === undefined || Game.time < this.data.waitUntil)
    ) {
      const budget =
        this.creep.colony?.logisticsNetwork.mineWaitTime(this.creep, container, wanted) ?? 0;
      if (budget > 0) {
        this.data.waitUntil ??= Game.time + budget;
        return OK;
      }
    }
    const result = this.creep.withdraw(container, RESOURCE_ENERGY);
    // Keep this pickup visible to other vehicles until the engine applies the intent.
    if (result == OK) {
      this.data.tookFromBox = true;
      if (this.data.plannedLoad !== undefined)
        this.data.plannedLoad -= Math.min(
          container.store.energy,
          this.creep.store.getFreeCapacity(),
        );
      if (!drop || container.store.energy >= this.creep.store.getFreeCapacity())
        this.data.collectedAt = Game.time;
    }
    return result;
  }
}
