import type { Colony } from "../Colony";
import { packCoordList } from "../utilities/packrat";
import { E58S42_PLAN } from "./layouts/E58S42";
import type { RoomPlannerMemory } from "./RoomPlanner";

const VERSION = "E58S42-terrain-v5";

export function hasRoomOverride(roomName: string): boolean {
  return Game.shard.name == "shard3" && roomName == "E58S42";
}

/** Install once, before Colony selects its hatchery/manager implementation. */
export function installRoomOverride(colony: Colony, memory: RoomPlannerMemory): void {
  if (!hasRoomOverride(colony.name) || !colony.controller.my || memory.customLayout == VERSION)
    return;
  const terrain = Game.map.getRoomTerrain(colony.name);
  const buildings: { [type: string]: Coord[] } = E58S42_PLAN.buildings;
  for (const type in buildings) {
    for (const pos of buildings[type]) {
      if (
        type != STRUCTURE_ROAD &&
        type != STRUCTURE_EXTRACTOR &&
        terrain.get(pos.x, pos.y) == TERRAIN_MASK_WALL
      ) {
        throw new Error(`Invalid ${VERSION}: ${type} at ${pos.x},${pos.y}`);
      }
    }
  }
  // Reject a stale profile instead of relocating buildings added since this survey.
  for (const structure of colony.room.find(FIND_MY_STRUCTURES)) {
    const type = structure.structureType;
    if (type == STRUCTURE_RAMPART || type == STRUCTURE_CONTROLLER || type == STRUCTURE_LINK)
      continue;
    if (!(buildings[type] || []).some((p) => p.x == structure.pos.x && p.y == structure.pos.y)) {
      throw new Error(`${VERSION} needs review: existing ${type} at ${structure.pos}`);
    }
  }
  memory.mapsByLevel = {};
  for (let level = 1; level <= 8; level++) {
    const map: { [type: string]: ProtoPos[] } = {};
    for (const type in buildings) {
      const limit = CONTROLLER_STRUCTURES[type as BuildableStructureConstant][level];
      map[type] = buildings[type].slice(0, limit).map((p) => ({ ...p, roomName: colony.name }));
    }
    memory.mapsByLevel[level] = map;
  }
  delete memory.bunkerData;
  memory.active = false;
  memory.savedFlags = [];
  memory.relocating = false;
  memory.misplacedStructures = false;
  memory.lastGenerated = Game.time;
  memory.recheckStructuresAt = Game.time + 1;
  memory.customLayout = VERSION;
  Object.assign(colony.memory, {
    barrierPlanner: { barrierCoordsPacked: packCoordList(E58S42_PLAN.barriers) },
    roadPlanner: {
      roadCoordsPacked: { [colony.name]: packCoordList(E58S42_PLAN.buildings.road) },
      roadCoverage: 0,
      roadCoverages: {},
    },
  });
  console.log(
    `Installed ${VERSION}: mining bypass reserved at (27,30); source workstations stay clear of traffic.`,
  );
}
