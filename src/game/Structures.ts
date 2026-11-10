import { getTerminalState } from "./terminalState";
import { MY_USERNAME } from "../~settings";
import { sum } from "../utilities/native";

export function isStructureWalkable(structure: Structure): boolean {
  if (structure.structureType === STRUCTURE_RAMPART) {
    const rampart = structure as StructureRampart;
    return rampart.my || rampart.isPublic;
  }
  return (
    structure.structureType === STRUCTURE_ROAD ||
    structure.structureType === STRUCTURE_CONTAINER ||
    structure.structureType === STRUCTURE_PORTAL
  );
}

export function isControllerReservedByMe(structure: StructureController): boolean | undefined {
  return structure.reservation && structure.reservation.username == MY_USERNAME;
}

export function isControllerSignedByMe(structure: StructureController): boolean | undefined {
  return (
    structure.sign &&
    structure.sign.username == MY_USERNAME &&
    structure.sign.text == Memory.settings.signature &&
    Game.time - structure.sign.time < 250000
  );
}

export function isControllerSignedByScreeps(structure: StructureController): boolean | undefined {
  return structure.sign && structure.sign.username == "Screeps";
}

export function structureControllerNeedsReserving(
  structure: StructureController,
  reserveBuffer: number,
): boolean | undefined {
  return (
    !structure.reservation ||
    (isControllerReservedByMe(structure) && structure.reservation.ticksToEnd < reserveBuffer)
  );
}

export function getStructureLinkStoreCapacity(structure: StructureLink): number {
  return getEnergyCapacity(structure);
}

export function getStoreContents(store: ResourceAmounts): [ResourceConstant, number][] {
  return Object.entries(store) as [ResourceConstant, number][];
}

export function isTerminalReady(structure: StructureTerminal): boolean {
  return structure.cooldown == 0 && !getTerminalState(structure).notReady;
}

export function hasTerminalReceived(structure: StructureTerminal): boolean | undefined {
  return getTerminalState(structure).hasReceived;
}

/** Creates resource-specific accessors by closing over the resource type. */
const createResourceAccessors = (resourceType: ResourceConstant) => {
  const getStored = (object: { store: StoreDefinition }): number => object.store[resourceType];
  const getCapacity = (object: { store: StoreDefinition }): number =>
    object.store.getCapacity(resourceType);
  return { getStored, getCapacity };
};

const energyAccessors = createResourceAccessors(RESOURCE_ENERGY);
const powerAccessors = createResourceAccessors(RESOURCE_POWER);
const ghodiumAccessors = createResourceAccessors(RESOURCE_GHODIUM);
const opsAccessors = createResourceAccessors(RESOURCE_OPS);

export const getStoredEnergy = energyAccessors.getStored;
export const getEnergyCapacity = energyAccessors.getCapacity;
export const getStoredPower = powerAccessors.getStored;
export const getPowerCapacity = powerAccessors.getCapacity;
export const getStoredGhodium = ghodiumAccessors.getStored;
export const getGhodiumCapacity = ghodiumAccessors.getCapacity;
export const getStoredOps = opsAccessors.getStored;
export const getOpsCapacity = opsAccessors.getCapacity;

type FillableStructure =
  | StorageUnit
  | StructureExtension
  | StructureLink
  | StructureSpawn
  | StructureTower;

export function isStructureFull(structure: FillableStructure): boolean {
  if (
    structure.structureType === STRUCTURE_CONTAINER ||
    structure.structureType === STRUCTURE_STORAGE ||
    structure.structureType === STRUCTURE_TERMINAL
  ) {
    return sum(structure.store) >= structure.store.getCapacity();
  }
  return getStoredEnergy(structure) >= getEnergyCapacity(structure);
}

export function isStructureEmpty(structure: FillableStructure): boolean {
  if (
    structure.structureType === STRUCTURE_CONTAINER ||
    structure.structureType === STRUCTURE_STORAGE ||
    structure.structureType === STRUCTURE_TERMINAL
  ) {
    return sum(structure.store) === 0;
  }
  return getStoredEnergy(structure) === 0;
}

/** Record a successful intent without adding bookkeeping fields to engine terminals. */
export function sendTerminalResources(
  terminal: StructureTerminal,
  resourceType: ResourceConstant,
  amount: number,
  destination: string,
  description?: string,
): ScreepsReturnCode {
  const response = terminal.send(resourceType, amount, destination, description);
  if (response === OK) {
    getTerminalState(terminal).notReady = true;
    const receiver = Game.rooms[destination]?.terminal;
    if (receiver) getTerminalState(receiver).hasReceived = true;
  }
  return response;
}
